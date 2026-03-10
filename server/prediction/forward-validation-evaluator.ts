/**
 * forward-validation-evaluator.ts — closes forward validation records after
 * matches complete.
 *
 * Scans all pending forward records (actual_result === null). For each match
 * that is now FINISHED in the DataSource, fills in actual_result, goals, and
 * result_captured_at.
 *
 * This is the result-capture half of the forward validation pipeline. It runs
 * out-of-band and is fault-isolated (errors never propagate to the refresh cycle).
 *
 * H11 — Controlled Forward Validation
 */

import type { DataSource } from '@sportpulse/snapshot';
import type { Match } from '@sportpulse/canonical';
import { ForwardValidationStore, type ForwardVariant } from './forward-validation-store.js';

// ── ForwardValidationEvaluator ─────────────────────────────────────────────

export class ForwardValidationEvaluator {
  constructor(
    private readonly store: ForwardValidationStore,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Scans all pending forward records. For each match that is now FINISHED
   * in the DataSource, closes the record with actual_result, goals, and
   * result_captured_at.
   *
   * @param competitionIds  Canonical competition IDs in scope
   * @returns count of newly closed records and still-pending count
   */
  async closeCompleted(
    competitionIds: string[],
  ): Promise<{ closed: number; stillPending: number }> {
    const pending = this.store.findPending();
    if (pending.length === 0) {
      return { closed: 0, stillPending: 0 };
    }

    // Build a lookup of all matches across scoped competitions
    const matchLookup = new Map<string, Match>();
    for (const competitionId of competitionIds) {
      const seasonId = this.dataSource.getSeasonId(competitionId);
      if (!seasonId) continue;
      const matches = this.dataSource.getMatches(seasonId);
      for (const m of matches) {
        matchLookup.set(m.matchId, m);
      }
    }

    let closed = 0;

    for (const record of pending) {
      const match = matchLookup.get(record.match_id);
      if (!match) continue;

      if (
        match.status === 'FINISHED' &&
        match.scoreHome !== null &&
        match.scoreAway !== null
      ) {
        const actualResult = computeActualResult(match.scoreHome, match.scoreAway);

        try {
          this.store.closeRecord(record.match_id, record.variant as ForwardVariant, {
            actual_result: actualResult,
            home_goals: match.scoreHome,
            away_goals: match.scoreAway,
          });
          closed++;
        } catch (err) {
          console.error(
            `[ForwardValEvaluator] Error closing record ${record.record_id}:`,
            err,
          );
        }
      }
    }

    // Persist only if something changed
    if (closed > 0) {
      await this.store.persist();
    }

    const stillPending = this.store.findPending().length;
    return { closed, stillPending };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function computeActualResult(
  scoreHome: number,
  scoreAway: number,
): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' {
  if (scoreHome > scoreAway) return 'HOME_WIN';
  if (scoreHome < scoreAway) return 'AWAY_WIN';
  return 'DRAW';
}
