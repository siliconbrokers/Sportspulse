/**
 * shadow-runner.ts — out-of-band shadow execution of the prediction engine.
 *
 * Runs predictions for all eligible pre-match fixtures without blocking the
 * portal response path. Designed to be called fire-and-forget from runRefresh().
 *
 * Fault isolation guarantee:
 * - Errors at the per-match level are caught, logged, and never propagated.
 * - The outer try/catch ensures runShadow() itself never throws.
 *
 * Evaluation pipeline integration:
 * - registerMatch() is called for EVERY in-scope SCHEDULED match, ensuring
 *   every match gets an EvaluationRecord even if prediction fails.
 * - freezeSnapshot() is called only after a successful prediction snapshot,
 *   upgrading the PENDING record to SNAPSHOT_FROZEN.
 *
 * PE-72
 */

import type { DataSource } from '@sportpulse/snapshot';
import type { Competition, Season } from '@sportpulse/canonical';
import { PredictionService } from './prediction-service.js';
import { PredictionStore, buildSnapshot } from './prediction-store.js';
import { EvaluationStore } from './evaluation-store.js';
import { isShadowEnabled } from './prediction-flags.js';
import { buildMatchInput, type TeamMatchCounts } from './match-input-adapter.js';

export async function runShadow(
  dataSource: DataSource,
  competitionIds: string[],
  predictionService: PredictionService,
  store: PredictionStore,
  evaluationStore?: EvaluationStore,
): Promise<void> {
  try {
    for (const competitionId of competitionIds) {
      // ── 1. Check flag ────────────────────────────────────────────────────
      if (!isShadowEnabled(competitionId)) continue;

      // ── 2. Obtain canonical data ─────────────────────────────────────────
      const seasonId = dataSource.getSeasonId(competitionId);
      if (!seasonId) continue;

      const matches = dataSource.getMatches(seasonId);

      // ── 3. Build per-team match-count lookup from standings ──────────────
      // Standings.playedGames reflects completed official matches for each
      // team in the current season. For a domestic league running ≤ 12 months,
      // these games are all within the last 365 days — satisfying §7.4 CLUB
      // history requirements without requiring an Elo/prior_rating system.
      const standingsMap = new Map<string, TeamMatchCounts>();
      const standings = dataSource.getStandings?.(competitionId) ?? [];
      for (const row of standings) {
        standingsMap.set(row.teamId, {
          completed_365d: row.playedGames,
          completed_730d: row.playedGames, // conservative: same value for longer window
        });
      }

      // ── 4. Filter eligible pre-match fixtures ────────────────────────────
      const eligible = matches.filter(
        (m) =>
          m.status === 'SCHEDULED' &&
          m.startTimeUtc !== null &&
          new Date(m.startTimeUtc).getTime() > Date.now(),
      );

      // ── 4. Minimal Competition and Season objects for the adapter ─────────
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
        label: '',
        startDate: '',
        endDate: '',
      };

      // ── 5. Predict each eligible match ───────────────────────────────────
      for (const match of eligible) {
        const matchRef = {
          matchId: match.matchId,
          homeTeamId: match.homeTeamId,
          awayTeamId: match.awayTeamId,
          startTimeUtc: match.startTimeUtc,
          status: match.status,
        };

        // OE-1: register every in-scope match so it always has an EvaluationRecord
        evaluationStore?.registerMatch(competitionId, matchRef);

        try {
          const matchCounts = standingsMap.size > 0
            ? {
                home: standingsMap.get(match.homeTeamId) ?? { completed_365d: 0 },
                away: standingsMap.get(match.awayTeamId) ?? { completed_365d: 0 },
              }
            : undefined;
          const adapterResult = buildMatchInput(match, competition, season, matchCounts);

          if (!adapterResult.ok) {
            console.log(
              `[ShadowRunner] adapter failed for ${match.matchId}: ${adapterResult.reason}`,
            );
            continue;
          }

          const response = await predictionService.predict(adapterResult.input);
          const snapshot = buildSnapshot(match.matchId, competitionId, adapterResult.input, response);
          store.save(snapshot);

          // OE-2: attach snapshot to evaluation record (freeze if pre-kickoff)
          evaluationStore?.freezeSnapshot(competitionId, matchRef, snapshot);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`[ShadowRunner] prediction failed for ${match.matchId}: ${msg}`);
          store.saveError(match.matchId, competitionId, err);
          // Record stays PENDING — will be resolved when match finishes
        }
      }

      // ── 6. Persist after processing all matches for this competition ──────
      store.persist().catch(console.error);
      evaluationStore?.persist().catch(console.error);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ShadowRunner] unexpected outer error: ${msg}`);
  }
}
