/**
 * result-capture.ts — automatically fills ground truth and resolves terminal states.
 *
 * Called at the end of each runRefresh() cycle.
 *
 * Per-match logic:
 *   FINISHED             → captureGroundTruth (handles SNAPSHOT_FROZEN → COMPLETE
 *                          and PENDING → EXCLUDED/NO_PREGAME_SNAPSHOT)
 *   CANCELED / POSTPONED → markAbnormalEnd (→ EXCLUDED/ABNORMAL_END)
 *   SCHEDULED / IN_PROGRESS / TBD → no action (still active)
 *
 * Errors are always logged and never propagated.
 *
 * OE-3 — PE Observation & Evaluation Plan v1.1
 */

import type { DataSource } from '@sportpulse/snapshot';
import { EvaluationStore } from './evaluation-store.js';

// Terminal statuses that are NOT a normal FINISHED result
const ABNORMAL_TERMINAL_STATUSES = new Set(['CANCELED', 'POSTPONED']);

export function captureResults(
  dataSource: DataSource,
  evaluationStore: EvaluationStore,
  competitionIds: string[],
): void {
  try {
    let capturedCount = 0;
    let abnormalCount = 0;

    for (const competitionId of competitionIds) {
      const seasonId = dataSource.getSeasonId(competitionId);
      if (!seasonId) continue;

      const matches = dataSource.getMatches(seasonId);

      for (const match of matches) {
        const record = evaluationStore.findByMatch(match.matchId);
        if (!record) continue;

        // Already in a terminal evaluation state — skip
        if (record.record_status === 'COMPLETE' || record.record_status === 'EXCLUDED') continue;

        if (match.status === 'FINISHED') {
          const homeGoals = match.scoreHome;
          const awayGoals = match.scoreAway;

          if (typeof homeGoals !== 'number' || typeof awayGoals !== 'number') {
            // FINISHED but score not yet populated — wait for next cycle
            continue;
          }

          const didUpdate = evaluationStore.captureGroundTruth(match.matchId, homeGoals, awayGoals);
          if (didUpdate) {
            capturedCount++;
            console.log(
              `[ResultCapture] Ground truth: ${match.matchId} → ${homeGoals}:${awayGoals}` +
              ` (status=${record.record_status})`,
            );
          }
        } else if (ABNORMAL_TERMINAL_STATUSES.has(match.status)) {
          const didUpdate = evaluationStore.markAbnormalEnd(match.matchId);
          if (didUpdate) {
            abnormalCount++;
            console.log(
              `[ResultCapture] Abnormal end: ${match.matchId} (canonical_status=${match.status})`,
            );
          }
        }
        // SCHEDULED, IN_PROGRESS, TBD → no action
      }
    }

    if (capturedCount > 0 || abnormalCount > 0) {
      console.log(
        `[ResultCapture] Cycle complete: captured=${capturedCount}, abnormal=${abnormalCount}`,
      );
      evaluationStore.persist().catch((err) => {
        console.error('[ResultCapture] persist failed:', err);
      });
    }
  } catch (err) {
    console.error('[ResultCapture] unexpected error:', err);
  }
}
