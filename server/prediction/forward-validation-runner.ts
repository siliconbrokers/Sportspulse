/**
 * forward-validation-runner.ts — generates pre-kickoff frozen snapshots for
 * UPCOMING matches under two variants:
 *   - BASELINE_REFERENCE: raw Poisson probabilities (no CTI)
 *   - CTI_ALPHA_0_4:      CTI-adjusted probabilities with α=0.4
 *
 * For each SCHEDULED/TIMED match not yet frozen:
 *   1. Get current-season Elo state from HistoricalStateService
 *   2. Build MatchInput via match-input-adapter
 *   3. Run PredictionService to get lambdas + raw probs
 *   4. Save BASELINE_REFERENCE record (raw probs)
 *   5. Apply CTI(α=0.4) inline, save CTI_ALPHA_0_4 record
 *
 * Segregation guarantee:
 *   - Writes ONLY to ForwardValidationStore
 *   - source_type = 'FORWARD_OFFICIAL' hardcoded on every record
 *   - Never touches PredictionStore, EvaluationStore, or HistoricalBacktestStore
 *
 * H11 — Controlled Forward Validation
 */

import type { DataSource } from '@sportpulse/snapshot';
import type { Competition, Season, Match } from '@sportpulse/canonical';
import { buildMatchInput, type TeamMatchCounts } from './match-input-adapter.js';
import { PredictionService } from './prediction-service.js';
import { HistoricalStateService } from './historical-state-service.js';
import {
  ForwardValidationStore,
  type ForwardValidationRecord,
  type ForwardVariant,
} from './forward-validation-store.js';

// ── Official freeze-window constants (H11-fix: v2_window_based policy) ─────
//
// A forward snapshot is officially frozen only when:
//   FREEZE_WINDOW_MIN_LEAD_H ≤ hoursBeforeKickoff ≤ FREEZE_WINDOW_MAX_LEAD_H
//
// Too early  (> MAX_LEAD_H): skip silently — will enter window in a future refresh.
// Too late   (< MIN_LEAD_H): store diagnostic record with excluded_reason = 'MISSED_FREEZE_WINDOW'.
// Inside window: freeze and lock snapshot_frozen_at immutably.

const FREEZE_WINDOW_MAX_LEAD_H = 48;   // no earlier than 48h before kickoff
const FREEZE_WINDOW_MIN_LEAD_H = 0.5;  // no later than 30min before kickoff

const FREEZE_WINDOW_MAX_LEAD_MS = FREEZE_WINDOW_MAX_LEAD_H * 60 * 60 * 1000;
const FREEZE_WINDOW_MIN_LEAD_MS = FREEZE_WINDOW_MIN_LEAD_H * 60 * 60 * 1000;

// Statuses eligible for forward freeze (strictly pre-match only)
const ELIGIBLE_PRE_MATCH_STATUSES = new Set(['SCHEDULED', 'TIMED']);

// ── Frozen CTI constants (same as H8/H9/H10b offline analysis) ─────────────

const ALPHA_FROZEN = 0.4;
const CTI_SIGMA_BALANCE = 0.5;
const CTI_LAMBDA_CRIT = 3.0;
const CTI_SIGMA_INTENSITY = 1.0;
const TOO_CLOSE_THRESHOLD = 0.02;
const MAX_GOALS = 7;

// ── Types ──────────────────────────────────────────────────────────────────

export interface RunnerResult {
  frozen: number;
  skipped: number;
  errors: number;
  competitions: string[];
}

// ── CTI math (inline — same as offline scripts, do not import) ─────────────

const _logFact: number[] = [0];
for (let k = 1; k <= 20; k++) {
  _logFact.push(_logFact[k - 1]! + Math.log(k));
}

function poissonLogPmf(k: number, lambda: number): number {
  if (k < 0 || k > 20) return -Infinity;
  return k * Math.log(lambda) - lambda - _logFact[k]!;
}

function buildMatrix(lH: number, lA: number): number[][] {
  const m: number[][] = [];
  for (let i = 0; i <= MAX_GOALS; i++) {
    m.push([]);
    for (let j = 0; j <= MAX_GOALS; j++) {
      m[i]!.push(Math.exp(poissonLogPmf(i, lH) + poissonLogPmf(j, lA)));
    }
  }
  return m;
}

function matrix1x2(m: number[][]): { home: number; draw: number; away: number } {
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let i = 0; i <= MAX_GOALS; i++) {
    for (let j = 0; j <= MAX_GOALS; j++) {
      const p = m[i]![j]!;
      if (i > j) home += p;
      else if (i === j) draw += p;
      else away += p;
    }
  }
  // Normalise to handle truncation at MAX_GOALS
  const total = home + draw + away;
  if (total <= 0) return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
  return { home: home / total, draw: draw / total, away: away / total };
}

function ctiGate(lH: number, lA: number): number {
  const lambdaTotal = lH + lA;
  const lambdaBalance = Math.abs(lH - lA);
  const gateBalance = Math.exp(-0.5 * Math.pow(lambdaBalance / CTI_SIGMA_BALANCE, 2));
  const gateIntensity = 1 - Math.exp(-0.5 * Math.pow(lambdaTotal / CTI_LAMBDA_CRIT, 2) / Math.pow(CTI_SIGMA_INTENSITY, 2));
  return gateBalance * gateIntensity;
}

function applyCTI(
  lH: number,
  lA: number,
  alpha: number,
): { home: number; draw: number; away: number } {
  const base = matrix1x2(buildMatrix(lH, lA));
  const gate = ctiGate(lH, lA);
  const effectiveAlpha = alpha * gate;

  // CTI adjustment: draw probability boosted proportionally to the gate
  // Home and away absorb the draw increase proportional to their share
  const drawBoost = effectiveAlpha * gate;
  const newDraw = Math.min(base.draw + drawBoost, 1);
  const homeAwaySum = base.home + base.away;
  let newHome: number;
  let newAway: number;
  if (homeAwaySum > 0) {
    const reduction = newDraw - base.draw;
    newHome = base.home - reduction * (base.home / homeAwaySum);
    newAway = base.away - reduction * (base.away / homeAwaySum);
  } else {
    newHome = 0;
    newAway = 0;
  }

  // Clamp and normalise
  const h = Math.max(0, newHome);
  const d = Math.max(0, newDraw);
  const a = Math.max(0, newAway);
  const total = h + d + a;
  if (total <= 0) return base;
  return { home: h / total, draw: d / total, away: a / total };
}

// ── Decision helpers ───────────────────────────────────────────────────────

function computeDecision(p: { home: number; draw: number; away: number }): string {
  const sorted: [string, number][] = [
    ['HOME', p.home],
    ['DRAW', p.draw],
    ['AWAY', p.away],
  ].sort((a, b) => (b[1] as number) - (a[1] as number)) as [string, number][];
  const margin = (sorted[0]![1] as number) - (sorted[1]![1] as number);
  return margin < TOO_CLOSE_THRESHOLD ? 'TOO_CLOSE' : (sorted[0]![0] as string);
}

// ── extractProbs — same pattern as historical-backtest-runner.ts ───────────

function extractProbs(response: unknown): {
  mode: string;
  lambda_home: number | null;
  lambda_away: number | null;
  raw_p_home_win: number | null;
  raw_p_draw: number | null;
  raw_p_away_win: number | null;
  expected_goals_home: number | null;
  expected_goals_away: number | null;
  predicted_result: string | null;
} {
  const r = response as Record<string, unknown> | null | undefined;
  const mode =
    typeof r?.['operating_mode'] === 'string'
      ? (r['operating_mode'] as string)
      : typeof r?.['eligibility_status'] === 'string'
        ? (r['eligibility_status'] as string)
        : 'UNKNOWN';

  const predictions = r?.['predictions'] as Record<string, unknown> | null | undefined;
  const core = predictions?.['core'] as Record<string, unknown> | null | undefined;
  const internals = r?.['internals'] as Record<string, unknown> | null | undefined;
  const rawProbs = internals?.['raw_1x2_probs'] as Record<string, unknown> | null | undefined;

  return {
    mode,
    lambda_home:
      typeof internals?.['lambda_home'] === 'number' ? internals['lambda_home'] : null,
    lambda_away:
      typeof internals?.['lambda_away'] === 'number' ? internals['lambda_away'] : null,
    raw_p_home_win:
      typeof rawProbs?.['home'] === 'number' ? rawProbs['home'] : null,
    raw_p_draw:
      typeof rawProbs?.['draw'] === 'number' ? rawProbs['draw'] : null,
    raw_p_away_win:
      typeof rawProbs?.['away'] === 'number' ? rawProbs['away'] : null,
    expected_goals_home:
      typeof core?.['expected_goals_home'] === 'number' ? core['expected_goals_home'] : null,
    expected_goals_away:
      typeof core?.['expected_goals_away'] === 'number' ? core['expected_goals_away'] : null,
    predicted_result:
      typeof core?.['predicted_result'] === 'string' ? (core['predicted_result'] as string) : null,
  };
}

// ── Helper: competition code from canonical competitionId ──────────────────

function competitionCodeFromId(competitionId: string): string {
  // 'comp:football-data:PD' → 'PD'
  return competitionId.split(':')[2] ?? competitionId;
}

// ── Helper: build a diagnostic-only record (no prediction snapshot) ────────
//
// Diagnostic records carry an excluded_reason and have snapshot_frozen_at = null.
// They are NOT used in evaluation metrics — only for diagnostics / monitoring.

function buildDiagnosticRecord(
  match: Match,
  competitionCode: string,
  variant: ForwardVariant,
  nowIso: string,
  excludedReason: 'MISSED_FREEZE_WINDOW' | 'NO_START_TIME',
): ForwardValidationRecord {
  return {
    record_id: `fwd:${competitionCode}:${match.matchId}:${variant}`,
    source_type: 'FORWARD_OFFICIAL',
    competition_code: competitionCode,
    match_id: match.matchId,
    kickoff_utc: match.startTimeUtc ?? '',
    home_team_id: match.homeTeamId,
    away_team_id: match.awayTeamId,
    variant,
    snapshot_generated_at: nowIso,
    snapshot_frozen_at: null,     // no official snapshot taken
    freeze_lead_hours: null,
    mode: 'NOT_ELIGIBLE',
    predicted_result: null,
    p_home_win: null,
    p_draw: null,
    p_away_win: null,
    expected_goals_home: null,
    expected_goals_away: null,
    lambda_home: null,
    lambda_away: null,
    actual_result: null,
    home_goals: null,
    away_goals: null,
    result_captured_at: null,
    evaluation_eligible: false,
    excluded_reason: excludedReason,
  };
}

// ── ForwardValidationRunner ────────────────────────────────────────────────

export class ForwardValidationRunner {
  private readonly dataSource: DataSource;
  private readonly predictionService: PredictionService;
  private readonly historicalStateService: HistoricalStateService;
  private readonly store: ForwardValidationStore;

  constructor(
    dataSource: DataSource,
    predictionService: PredictionService,
    historicalStateService: HistoricalStateService,
    store: ForwardValidationStore,
  ) {
    this.dataSource = dataSource;
    this.predictionService = predictionService;
    this.historicalStateService = historicalStateService;
    this.store = store;
  }

  /**
   * Generates frozen pre-kickoff snapshots for all UPCOMING matches in scope.
   *
   * @param competitionIds   Canonical IDs, e.g. ['comp:football-data:PD']
   * @param seasonStartYear  Start year of the current season (e.g. 2025 for 2025-26)
   */
  async run(competitionIds: string[], seasonStartYear: number): Promise<RunnerResult> {
    let frozen = 0;
    let skipped = 0;
    let errors = 0;
    const processedCompetitions: string[] = [];

    for (const competitionId of competitionIds) {
      const competitionCode = competitionCodeFromId(competitionId);

      try {
        const seasonId = this.dataSource.getSeasonId(competitionId);
        if (!seasonId) {
          console.warn(`[ForwardValRunner] No seasonId for ${competitionId} — skipping`);
          skipped++;
          continue;
        }

        const allMatches = this.dataSource.getMatches(seasonId);
        const nowMs = Date.now();

        // Candidate matches: anything not already finished or live.
        // Window filtering is done per-match below.
        const candidateMatches = allMatches.filter(
          (m) =>
            m.status !== 'FINISHED' &&
            m.status !== 'IN_PLAY' &&
            m.status !== 'PAUSED',
        );

        if (candidateMatches.length === 0) {
          continue;
        }

        // Pre-warm historical state cache for the competition
        await this.historicalStateService.warmUp(competitionCode, seasonStartYear);

        // Build minimal Competition + Season stubs for match-input-adapter
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
          label: `${seasonStartYear}-${String(seasonStartYear + 1).slice(-2)}`,
          startDate: '',
          endDate: '',
        };

        for (const match of candidateMatches) {
          const nowIsoLoop = new Date().toISOString();

          // ── Guard: already processed (frozen or diagnostic for both variants) ──
          const baselineRecorded = this.store.hasRecord(match.matchId, 'BASELINE_REFERENCE');
          const ctiRecorded = this.store.hasRecord(match.matchId, 'CTI_ALPHA_0_4');

          if (baselineRecorded && ctiRecorded) {
            // Both variants are either officially frozen or marked diagnostic.
            // Officially frozen records are immutable; diagnostic records are only
            // replaced if the match enters the valid window (handled in save()).
            skipped += 2;
            continue;
          }

          // ── Guard: eligible status ──────────────────────────────────────────
          if (!ELIGIBLE_PRE_MATCH_STATUSES.has(match.status)) {
            // POSTPONED, SUSPENDED, CANCELLED, etc. — skip silently.
            // POSTPONED matches may be rescheduled; no diagnostic stored so the
            // match can be picked up again once it returns to SCHEDULED/TIMED.
            skipped += 2;
            continue;
          }

          // ── Guard: start time present ───────────────────────────────────────
          if (!match.startTimeUtc) {
            const diagBase = buildDiagnosticRecord(
              match, competitionCode, 'BASELINE_REFERENCE', nowIsoLoop, 'NO_START_TIME',
            );
            const diagCti = buildDiagnosticRecord(
              match, competitionCode, 'CTI_ALPHA_0_4', nowIsoLoop, 'NO_START_TIME',
            );
            if (!baselineRecorded) this.store.save(diagBase);
            if (!ctiRecorded) this.store.save(diagCti);
            skipped += 2;
            continue;
          }

          // ── Window check ────────────────────────────────────────────────────
          const kickoffMs = new Date(match.startTimeUtc).getTime();
          const leadMs = kickoffMs - nowMs;

          if (leadMs > FREEZE_WINDOW_MAX_LEAD_MS) {
            // Too early — the match will enter the window in a future refresh.
            // Do NOT store any record; simply skip.
            continue;
          }

          if (leadMs < FREEZE_WINDOW_MIN_LEAD_MS) {
            // Too late — missed the valid freeze window for this match.
            // Store diagnostic for any unprocessed variants.
            if (!baselineRecorded) {
              this.store.save(buildDiagnosticRecord(
                match, competitionCode, 'BASELINE_REFERENCE',
                nowIsoLoop, 'MISSED_FREEZE_WINDOW',
              ));
            }
            if (!ctiRecorded) {
              this.store.save(buildDiagnosticRecord(
                match, competitionCode, 'CTI_ALPHA_0_4',
                nowIsoLoop, 'MISSED_FREEZE_WINDOW',
              ));
            }
            skipped += 2;
            continue;
          }

          // ── Inside official window — freeze ─────────────────────────────────
          const baselineFrozen = this.store.isFrozen(match.matchId, 'BASELINE_REFERENCE');
          const ctiFrozen = this.store.isFrozen(match.matchId, 'CTI_ALPHA_0_4');

          if (baselineFrozen && ctiFrozen) {
            skipped += 2;
            continue;
          }

          const freezeLeadHours = leadMs / (60 * 60 * 1000);

          try {
            // ── 1. Get current-season Elo state ──────────────────────────
            const teamState = await this.historicalStateService.getPreMatchTeamState(
              competitionCode,
              seasonStartYear,
              match.homeTeamId,
              match.awayTeamId,
              match.startTimeUtc!,
            );

            // ── 2. Build MatchInput ───────────────────────────────────────
            const matchCounts: { home: TeamMatchCounts; away: TeamMatchCounts } = {
              home: { completed_365d: teamState.homeTeam.completedMatches365d },
              away: { completed_365d: teamState.awayTeam.completedMatches365d },
            };
            const adapterResult = buildMatchInput(match, competition, season, matchCounts);

            if (!adapterResult.ok) {
              console.warn(
                `[ForwardValRunner] Adapter failed for ${match.matchId}: ${adapterResult.reason}`,
              );
              errors++;
              continue;
            }

            // ── 3. Run prediction pipeline ────────────────────────────────
            const response = await this.predictionService.predict(adapterResult.input, {
              home: teamState.homeTeam.eloRating,
              away: teamState.awayTeam.eloRating,
            });

            const probs = extractProbs(response);
            const nowIso = new Date().toISOString();

            // ── 4. Compute BASELINE decision from raw probs ───────────────
            const baselineP =
              probs.raw_p_home_win !== null &&
              probs.raw_p_draw !== null &&
              probs.raw_p_away_win !== null
                ? {
                    home: probs.raw_p_home_win,
                    draw: probs.raw_p_draw,
                    away: probs.raw_p_away_win,
                  }
                : null;

            const baselineDecision = baselineP ? computeDecision(baselineP) : null;

            // ── 5. Compute CTI decision ───────────────────────────────────
            let ctiP: { home: number; draw: number; away: number } | null = null;
            let ctiDecision: string | null = null;

            if (probs.lambda_home !== null && probs.lambda_away !== null) {
              ctiP = applyCTI(probs.lambda_home, probs.lambda_away, ALPHA_FROZEN);
              ctiDecision = computeDecision(ctiP);
            }

            const isEligible = probs.mode !== 'NOT_ELIGIBLE' && baselineP !== null;

            // ── 6. Save BASELINE_REFERENCE ────────────────────────────────
            if (!baselineFrozen) {
              const baselineRecord: ForwardValidationRecord = {
                record_id: `fwd:${competitionCode}:${match.matchId}:BASELINE_REFERENCE`,
                source_type: 'FORWARD_OFFICIAL',
                competition_code: competitionCode,
                match_id: match.matchId,
                kickoff_utc: match.startTimeUtc!,
                home_team_id: match.homeTeamId,
                away_team_id: match.awayTeamId,
                variant: 'BASELINE_REFERENCE',
                snapshot_generated_at: nowIso,
                snapshot_frozen_at: nowIso,
                freeze_lead_hours: freezeLeadHours,
                mode: probs.mode,
                predicted_result: baselineDecision,
                p_home_win: baselineP?.home ?? null,
                p_draw: baselineP?.draw ?? null,
                p_away_win: baselineP?.away ?? null,
                expected_goals_home: probs.expected_goals_home,
                expected_goals_away: probs.expected_goals_away,
                lambda_home: probs.lambda_home,
                lambda_away: probs.lambda_away,
                actual_result: null,
                home_goals: null,
                away_goals: null,
                result_captured_at: null,
                evaluation_eligible: isEligible,
                excluded_reason: isEligible ? null : `mode=${probs.mode}`,
              };
              this.store.save(baselineRecord);
              frozen++;
            }

            // ── 7. Save CTI_ALPHA_0_4 ────────────────────────────────────
            if (!ctiFrozen) {
              const ctiRecord: ForwardValidationRecord = {
                record_id: `fwd:${competitionCode}:${match.matchId}:CTI_ALPHA_0_4`,
                source_type: 'FORWARD_OFFICIAL',
                competition_code: competitionCode,
                match_id: match.matchId,
                kickoff_utc: match.startTimeUtc!,
                home_team_id: match.homeTeamId,
                away_team_id: match.awayTeamId,
                variant: 'CTI_ALPHA_0_4',
                snapshot_generated_at: nowIso,
                snapshot_frozen_at: nowIso,
                freeze_lead_hours: freezeLeadHours,
                mode: probs.mode,
                predicted_result: ctiDecision,
                p_home_win: ctiP?.home ?? null,
                p_draw: ctiP?.draw ?? null,
                p_away_win: ctiP?.away ?? null,
                expected_goals_home: probs.expected_goals_home,
                expected_goals_away: probs.expected_goals_away,
                lambda_home: probs.lambda_home,
                lambda_away: probs.lambda_away,
                actual_result: null,
                home_goals: null,
                away_goals: null,
                result_captured_at: null,
                evaluation_eligible: isEligible && ctiP !== null,
                excluded_reason:
                  !isEligible
                    ? `mode=${probs.mode}`
                    : ctiP === null
                      ? 'missing_lambda'
                      : null,
              };
              this.store.save(ctiRecord);
              frozen++;
            }
          } catch (matchErr) {
            console.error(`[ForwardValRunner] Error processing ${match.matchId}:`, matchErr);
            errors++;
          }
        }

        processedCompetitions.push(competitionCode);
      } catch (compErr) {
        console.error(`[ForwardValRunner] Error processing competition ${competitionId}:`, compErr);
        errors++;
      }
    }

    // Persist after processing all competitions (frozen snapshots or new diagnostics)
    if (frozen > 0 || errors > 0) {
      await this.store.persist();
    }

    return { frozen, skipped, errors, competitions: processedCompetitions };
  }
}
