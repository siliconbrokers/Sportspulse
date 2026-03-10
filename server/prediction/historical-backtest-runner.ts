/**
 * historical-backtest-runner.ts — builds synthetic historical pre-match
 * prediction snapshots for one competition slice.
 *
 * For each FINISHED match in scope:
 *   1. Reconstruct pre-match team state as-of kickoff using H2 HistoricalStateService
 *   2. Build MatchInput with real 365d match counts
 *   3. Run prediction pipeline with real pre-match Elo (via PredictionService eloOverride)
 *   4. Run baseline prediction at symmetric DEFAULT_ELO (no override) for comparison
 *   5. Store result in HistoricalBacktestStore (source_type = HISTORICAL_BACKTEST)
 *
 * Segregation guarantee:
 *   - Writes ONLY to HistoricalBacktestStore — never touches PredictionStore
 *     or EvaluationStore.
 *   - source_type = 'HISTORICAL_BACKTEST' is hardcoded on every record.
 *
 * H3 — Historical Snapshot Builder
 */

import type { DataSource } from '@sportpulse/snapshot';
import type { Competition, Season, Match } from '@sportpulse/canonical';
import { buildMatchInput, type TeamMatchCounts } from './match-input-adapter.js';
import { PredictionService } from './prediction-service.js';
import { HistoricalStateService } from './historical-state-service.js';
import {
  HistoricalBacktestStore,
  type HistoricalBacktestSnapshot,
} from './historical-backtest-store.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface BacktestRunOptions {
  /**
   * Maximum number of FINISHED matches to process per run.
   * Use to limit scope during initial validation; undefined = process all.
   */
  maxMatches?: number;
  /** Verbose logging per match (useful for sample inspection). Default: false. */
  verbose?: boolean;
  /**
   * Override for HOME_ADVANTAGE_ELO_DELTA used in lambda computation.
   * H6a sensitivity test only — never change the production default via this option.
   * If omitted, the module-level constant is used (currently 100).
   */
  homeAdvantageDeltaOverride?: number;
}

export interface BacktestRunSummary {
  competition_code: string;
  matches_processed: number;
  build_status_counts: Record<string, number>;
  mode_distribution: Record<string, number>;
  as_of_quality_distribution: Record<string, number>;
  /** Predicted result distribution for the historical slice. */
  predicted_result_distribution: Record<string, number>;
  /** Actual result distribution (ground truth). */
  actual_result_distribution: Record<string, number>;
  /**
   * Symmetry evidence: count of matches where historical prediction ≠ baseline.
   * A non-zero value proves historical Elo is influencing predictions.
   */
  elo_breaks_symmetry_count: number;
  /** Accuracy of historical predictions vs ground truth (null if no evaluable records). */
  accuracy: number | null;
  /** Accuracy of baseline predictions vs ground truth. */
  baseline_accuracy: number | null;
  /** Sample: first N snapshots for manual inspection. */
  sample: HistoricalBacktestSnapshot[];
  run_at: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function competitionCodeFromId(competitionId: string): string {
  // 'comp:football-data:PD' → 'PD'
  return competitionId.split(':')[2] ?? competitionId;
}

function seasonStartYearFromLabel(seasonLabel: string): number {
  // '2025-26' → 2025, '2025' → 2025
  return parseInt(seasonLabel.slice(0, 4), 10);
}

function actualResult(
  match: Match,
): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null {
  if (match.scoreHome === null || match.scoreAway === null) return null;
  if (match.scoreHome > match.scoreAway) return 'HOME_WIN';
  if (match.scoreHome < match.scoreAway) return 'AWAY_WIN';
  return 'DRAW';
}

/**
 * Normalize predicted_result from decision-policy format ('HOME'|'AWAY'|'DRAW'|'TOO_CLOSE')
 * to the canonical actual_result format ('HOME_WIN'|'AWAY_WIN'|'DRAW') for accuracy comparison.
 * Returns null for 'TOO_CLOSE' (not evaluable).
 */
function normalizePredictedResult(
  predicted: string | null,
): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null {
  if (predicted === 'HOME') return 'HOME_WIN';
  if (predicted === 'AWAY') return 'AWAY_WIN';
  if (predicted === 'DRAW') return 'DRAW';
  return null; // TOO_CLOSE or null
}

function extractProbs(response: unknown): {
  p_home_win: number | null;
  p_draw: number | null;
  p_away_win: number | null;
  expected_goals_home: number | null;
  expected_goals_away: number | null;
  predicted_result: string | null;
  mode: string;
  reasons: string[];
  // H6b: raw probability layer fields from internals
  raw_p_home_win: number | null;
  raw_p_draw: number | null;
  raw_p_away_win: number | null;
  lambda_home: number | null;
  lambda_away: number | null;
  effective_elo_home: number | null;
  effective_elo_away: number | null;
  calibration_mode: string | null;
} {
  const r = response as Record<string, unknown> | null | undefined;
  const mode = typeof r?.['operating_mode'] === 'string'
    ? (r['operating_mode'] as string)
    : typeof r?.['eligibility_status'] === 'string'
      ? (r['eligibility_status'] as string)
      : 'UNKNOWN';

  // PredictionResponse shape: { predictions: { core: {...}, secondary, explainability }, ... }
  // NOT_ELIGIBLE responses have no predictions field.
  const predictions = r?.['predictions'] as Record<string, unknown> | null | undefined;
  const core = predictions?.['core'] as Record<string, unknown> | null | undefined;
  const rawReasons = r?.['reasons'];
  const reasons = Array.isArray(rawReasons) ? (rawReasons as string[]) : [];

  // H6b: internals contains raw_1x2_probs, lambda_home/away, effective Elo. §15.4
  const internals = r?.['internals'] as Record<string, unknown> | null | undefined;
  const rawProbs = internals?.['raw_1x2_probs'] as Record<string, unknown> | null | undefined;

  return {
    p_home_win: typeof core?.['p_home_win'] === 'number' ? core['p_home_win'] : null,
    p_draw:     typeof core?.['p_draw']     === 'number' ? core['p_draw']     : null,
    p_away_win: typeof core?.['p_away_win'] === 'number' ? core['p_away_win'] : null,
    // expected_goals are in core (lambda-derived), not secondary. §15.1
    expected_goals_home: typeof core?.['expected_goals_home'] === 'number'
      ? core['expected_goals_home'] : null,
    expected_goals_away: typeof core?.['expected_goals_away'] === 'number'
      ? core['expected_goals_away'] : null,
    predicted_result: typeof core?.['predicted_result'] === 'string'
      ? (core['predicted_result'] as string) : null,
    mode,
    reasons,
    // H6b: raw layer from internals
    raw_p_home_win: typeof rawProbs?.['home'] === 'number' ? rawProbs['home'] : null,
    raw_p_draw:     typeof rawProbs?.['draw'] === 'number' ? rawProbs['draw'] : null,
    raw_p_away_win: typeof rawProbs?.['away'] === 'number' ? rawProbs['away'] : null,
    lambda_home: typeof internals?.['lambda_home'] === 'number' ? internals['lambda_home'] : null,
    lambda_away: typeof internals?.['lambda_away'] === 'number' ? internals['lambda_away'] : null,
    effective_elo_home: typeof internals?.['elo_home_pre'] === 'number' ? internals['elo_home_pre'] : null,
    effective_elo_away: typeof internals?.['elo_away_pre'] === 'number' ? internals['elo_away_pre'] : null,
    calibration_mode: typeof internals?.['calibration_mode'] === 'string'
      ? (internals['calibration_mode'] as string) : null,
  };
}

// ── Main runner ────────────────────────────────────────────────────────────

export class HistoricalBacktestRunner {
  private readonly dataSource: DataSource;
  private readonly predictionService: PredictionService;
  private readonly historicalStateService: HistoricalStateService;
  private readonly store: HistoricalBacktestStore;

  constructor(
    dataSource: DataSource,
    predictionService: PredictionService,
    historicalStateService: HistoricalStateService,
    store: HistoricalBacktestStore,
  ) {
    this.dataSource = dataSource;
    this.predictionService = predictionService;
    this.historicalStateService = historicalStateService;
    this.store = store;
  }

  /**
   * Run the historical backtest for a single competition.
   *
   * Returns a summary with mode distribution, symmetry evidence, and accuracy.
   * Overwrites any existing snapshots for this competition in the store.
   *
   * @param competitionId  Canonical competition ID, e.g. 'comp:football-data:PD'
   * @param seasonLabel    Season string, e.g. '2025-26' (from FootballDataSource)
   * @param options        Run configuration
   */
  async run(
    competitionId: string,
    seasonLabel: string,
    options: BacktestRunOptions = {},
  ): Promise<BacktestRunSummary> {
    const competitionCode = competitionCodeFromId(competitionId);
    const currentSeasonStartYear = seasonStartYearFromLabel(seasonLabel);
    const { maxMatches, verbose = false, homeAdvantageDeltaOverride } = options;

    console.log(
      `[BacktestRunner] Starting backtest: ${competitionCode} season=${seasonLabel}` +
      (maxMatches ? ` (max=${maxMatches})` : ' (all FINISHED matches)'),
    );

    // ── 1. Get FINISHED matches from DataSource ──────────────────────────
    const seasonId = this.dataSource.getSeasonId(competitionId);
    if (!seasonId) {
      throw new Error(`[BacktestRunner] No seasonId for competition ${competitionId}`);
    }

    const allMatches = this.dataSource.getMatches(seasonId);
    let finishedMatches = allMatches.filter(
      (m) => m.status === 'FINISHED' && m.startTimeUtc !== null,
    );

    // Sort chronologically — ensures deterministic ordering
    finishedMatches.sort((a, b) =>
      (a.startTimeUtc ?? '').localeCompare(b.startTimeUtc ?? ''),
    );

    if (maxMatches !== undefined) {
      finishedMatches = finishedMatches.slice(0, maxMatches);
    }

    console.log(
      `[BacktestRunner] ${finishedMatches.length} FINISHED matches to process for ${competitionCode}`,
    );

    // ── 2. Build minimal Competition and Season objects ──────────────────
    const competition: Competition = {
      competitionId,
      sportId: 'FOOTBALL',
      providerKey: '',
      providerCompetitionCode: '',
      name: competitionId,
      formatType: 'LEAGUE',
      isEnabled: true,
    };
    const season: Season = {
      seasonId,
      competitionId,
      label: seasonLabel,
      startDate: '',
      endDate: '',
    };

    // ── 3. Pre-warm historical state cache ───────────────────────────────
    await this.historicalStateService.warmUp(competitionCode, currentSeasonStartYear);

    // ── 4. Process each finished match ───────────────────────────────────
    const newSnapshots: HistoricalBacktestSnapshot[] = [];
    let snapshotIndex = 0;

    for (const match of finishedMatches) {
      snapshotIndex++;
      const snapshotId = `hbt:${competitionCode}:${match.matchId}`;

      try {
        // Ground truth
        const result = actualResult(match);
        if (result === null) {
          // Missing score — skip
          console.warn(`[BacktestRunner] Skipping ${match.matchId}: missing score`);
          continue;
        }

        // ── H2: Get pre-match team state ─────────────────────────────────
        const teamState = await this.historicalStateService.getPreMatchTeamState(
          competitionCode,
          currentSeasonStartYear,
          match.homeTeamId,
          match.awayTeamId,
          match.startTimeUtc!,
        );

        // ── Build MatchInput with historical 365d counts ─────────────────
        const matchCounts: { home: TeamMatchCounts; away: TeamMatchCounts } = {
          home: { completed_365d: teamState.homeTeam.completedMatches365d },
          away: { completed_365d: teamState.awayTeam.completedMatches365d },
        };
        const adapterResult = buildMatchInput(match, competition, season, matchCounts);

        if (!adapterResult.ok) {
          newSnapshots.push({
            snapshot_id: snapshotId,
            source_type: 'HISTORICAL_BACKTEST',
            competition_code: competitionCode,
            match_id: match.matchId,
            kickoff_utc: match.startTimeUtc!,
            home_team_id: match.homeTeamId,
            away_team_id: match.awayTeamId,
            actual_result: result,
            home_goals: match.scoreHome!,
            away_goals: match.scoreAway!,
            as_of_quality: teamState.dataCompleteness,
            elo_home_pre: teamState.homeTeam.eloRating,
            elo_away_pre: teamState.awayTeam.eloRating,
            elo_home_update_count: teamState.homeTeam.updateCount,
            elo_away_update_count: teamState.awayTeam.updateCount,
            matches_365d_home: teamState.homeTeam.completedMatches365d,
            matches_365d_away: teamState.awayTeam.completedMatches365d,
            total_historical_matches: teamState.totalHistoricalMatches,
            mode: 'NOT_ELIGIBLE',
            predicted_result: null,
            p_home_win: null,
            p_draw: null,
            p_away_win: null,
            expected_goals_home: null,
            expected_goals_away: null,
            reasons: [`ADAPTER_FAILED: ${adapterResult.reason}`],
            baseline_predicted_result: null,
            baseline_p_home_win: null,
            baseline_p_draw: null,
            baseline_p_away_win: null,
            build_status: 'ERROR',
            error_detail: `adapter failed: ${adapterResult.reason}`,
            generated_at: new Date().toISOString(),
          });
          continue;
        }

        // ── Historical prediction with real Elo ──────────────────────────
        const historicalResponse = await this.predictionService.predict(
          adapterResult.input,
          {
            home: teamState.homeTeam.eloRating,
            away: teamState.awayTeam.eloRating,
            ...(homeAdvantageDeltaOverride !== undefined ? { homeAdvantageDeltaOverride } : {}),
          },
        );
        const hist = extractProbs(historicalResponse);

        // ── Baseline prediction with symmetric DEFAULT_ELO ───────────────
        const baselineResponse = await this.predictionService.predict(adapterResult.input);
        const base = extractProbs(baselineResponse);

        // Normalize decision-policy values ('HOME'→'HOME_WIN') for accuracy comparison
        const normalizedPred = normalizePredictedResult(hist.predicted_result);
        const normalizedBase = normalizePredictedResult(base.predicted_result);

        const snapshot: HistoricalBacktestSnapshot = {
          snapshot_id: snapshotId,
          source_type: 'HISTORICAL_BACKTEST',
          competition_code: competitionCode,
          match_id: match.matchId,
          kickoff_utc: match.startTimeUtc!,
          home_team_id: match.homeTeamId,
          away_team_id: match.awayTeamId,
          actual_result: result,
          home_goals: match.scoreHome!,
          away_goals: match.scoreAway!,
          as_of_quality: teamState.dataCompleteness,
          elo_home_pre: teamState.homeTeam.eloRating,
          elo_away_pre: teamState.awayTeam.eloRating,
          elo_home_update_count: teamState.homeTeam.updateCount,
          elo_away_update_count: teamState.awayTeam.updateCount,
          matches_365d_home: teamState.homeTeam.completedMatches365d,
          matches_365d_away: teamState.awayTeam.completedMatches365d,
          total_historical_matches: teamState.totalHistoricalMatches,
          mode: hist.mode,
          predicted_result: normalizedPred,
          p_home_win: hist.p_home_win,
          p_draw: hist.p_draw,
          p_away_win: hist.p_away_win,
          expected_goals_home: hist.expected_goals_home,
          expected_goals_away: hist.expected_goals_away,
          reasons: hist.reasons,
          // H6b: raw probability layer from internals
          raw_p_home_win: hist.raw_p_home_win,
          raw_p_draw: hist.raw_p_draw,
          raw_p_away_win: hist.raw_p_away_win,
          lambda_home: hist.lambda_home,
          lambda_away: hist.lambda_away,
          effective_elo_home: hist.effective_elo_home,
          effective_elo_away: hist.effective_elo_away,
          calibration_mode: hist.calibration_mode,
          baseline_predicted_result: normalizedBase,
          baseline_p_home_win: base.p_home_win,
          baseline_p_draw: base.p_draw,
          baseline_p_away_win: base.p_away_win,
          build_status: hist.mode === 'NOT_ELIGIBLE' ? 'NOT_ELIGIBLE' : 'SUCCESS',
          generated_at: new Date().toISOString(),
        };

        newSnapshots.push(snapshot);

        if (verbose) {
          console.log(
            `[BacktestRunner] [${snapshotIndex}/${finishedMatches.length}]` +
            ` ${match.matchId} elo=${teamState.homeTeam.eloRating.toFixed(0)}/` +
            `${teamState.awayTeam.eloRating.toFixed(0)}` +
            ` mode=${hist.mode}` +
            ` pred=${normalizedPred ?? hist.predicted_result ?? 'null'}` +
            ` actual=${result}` +
            ` 365d=${teamState.homeTeam.completedMatches365d}/${teamState.awayTeam.completedMatches365d}`,
          );
        }

      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[BacktestRunner] Error for ${match.matchId}: ${msg}`);
        newSnapshots.push({
          snapshot_id: snapshotId,
          source_type: 'HISTORICAL_BACKTEST',
          competition_code: competitionCode,
          match_id: match.matchId,
          kickoff_utc: match.startTimeUtc ?? '',
          home_team_id: match.homeTeamId,
          away_team_id: match.awayTeamId,
          actual_result: actualResult(match) ?? 'DRAW',
          home_goals: match.scoreHome ?? 0,
          away_goals: match.scoreAway ?? 0,
          as_of_quality: 'BOOTSTRAP',
          elo_home_pre: 1500,
          elo_away_pre: 1500,
          elo_home_update_count: 0,
          elo_away_update_count: 0,
          matches_365d_home: 0,
          matches_365d_away: 0,
          total_historical_matches: 0,
          mode: 'ERROR',
          predicted_result: null,
          p_home_win: null,
          p_draw: null,
          p_away_win: null,
          expected_goals_home: null,
          expected_goals_away: null,
          reasons: [],
          baseline_predicted_result: null,
          baseline_p_home_win: null,
          baseline_p_draw: null,
          baseline_p_away_win: null,
          build_status: 'ERROR',
          error_detail: msg,
          generated_at: new Date().toISOString(),
        });
      }
    }

    // ── 5. Persist (replace existing for this competition) ───────────────
    this.store.replaceForCompetition(competitionCode, newSnapshots);
    await this.store.persist();

    // ── 6. Build summary ─────────────────────────────────────────────────
    return this._buildSummary(competitionCode, newSnapshots);
  }

  // ── Private: summary builder ──────────────────────────────────────────────

  private _buildSummary(
    competitionCode: string,
    snapshots: HistoricalBacktestSnapshot[],
  ): BacktestRunSummary {
    const buildStatusCounts: Record<string, number> = {};
    const modeDist: Record<string, number> = {};
    const qualityDist: Record<string, number> = {};
    const predictedDist: Record<string, number> = {};
    const actualDist: Record<string, number> = {};
    let eloBreaksSymmetry = 0;

    // Accuracy tracking
    let correctHist = 0, correctBase = 0, evaluableHist = 0, evaluableBase = 0;

    for (const s of snapshots) {
      buildStatusCounts[s.build_status] = (buildStatusCounts[s.build_status] ?? 0) + 1;
      modeDist[s.mode] = (modeDist[s.mode] ?? 0) + 1;
      qualityDist[s.as_of_quality] = (qualityDist[s.as_of_quality] ?? 0) + 1;
      actualDist[s.actual_result] = (actualDist[s.actual_result] ?? 0) + 1;

      if (s.predicted_result) {
        predictedDist[s.predicted_result] = (predictedDist[s.predicted_result] ?? 0) + 1;
      }

      // Symmetry evidence: does historical Elo change the prediction vs baseline?
      if (
        s.build_status === 'SUCCESS' &&
        (s.p_home_win !== s.baseline_p_home_win ||
         s.p_draw    !== s.baseline_p_draw    ||
         s.p_away_win !== s.baseline_p_away_win)
      ) {
        eloBreaksSymmetry++;
      }

      // Accuracy
      if (s.build_status === 'SUCCESS' && s.predicted_result !== null) {
        evaluableHist++;
        if (s.predicted_result === s.actual_result) correctHist++;
      }
      if (s.build_status === 'SUCCESS' && s.baseline_predicted_result !== null) {
        evaluableBase++;
        if (s.baseline_predicted_result === s.actual_result) correctBase++;
      }
    }

    const accuracy = evaluableHist > 0 ? correctHist / evaluableHist : null;
    const baselineAccuracy = evaluableBase > 0 ? correctBase / evaluableBase : null;

    const summary: BacktestRunSummary = {
      competition_code: competitionCode,
      matches_processed: snapshots.length,
      build_status_counts: buildStatusCounts,
      mode_distribution: modeDist,
      as_of_quality_distribution: qualityDist,
      predicted_result_distribution: predictedDist,
      actual_result_distribution: actualDist,
      elo_breaks_symmetry_count: eloBreaksSymmetry,
      accuracy,
      baseline_accuracy: baselineAccuracy,
      sample: snapshots.slice(0, 5),
      run_at: new Date().toISOString(),
    };

    console.log(
      `[BacktestRunner] Summary ${competitionCode}:` +
      ` processed=${snapshots.length}` +
      ` modes=${JSON.stringify(modeDist)}` +
      ` eloBreaksSymmetry=${eloBreaksSymmetry}` +
      ` accuracy=${accuracy !== null ? (accuracy * 100).toFixed(1) + '%' : 'n/a'}`,
    );

    return summary;
  }
}
