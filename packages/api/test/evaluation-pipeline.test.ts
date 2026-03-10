/**
 * evaluation-pipeline.test.ts — unit tests for EvaluationStore lifecycle,
 * eligibility rules, freeze cutoff, and metrics engine.
 *
 * Tests are organized by the 9 structural gaps from the hardening spec.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  EvaluationStore,
  type MatchForFreeze,
} from '../../../server/prediction/evaluation-store.js';
import { computeMetrics } from '../../../server/prediction/metrics-engine.js';
import type { PredictionSnapshot } from '../../../server/prediction/prediction-store.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const KICKOFF_FUTURE = '2026-06-15T20:00:00.000Z';
const KICKOFF_PAST = '2026-01-01T20:00:00.000Z';

function makeMatch(overrides: Partial<MatchForFreeze> = {}): MatchForFreeze {
  return {
    matchId: 'match-001',
    homeTeamId: 'team-home',
    awayTeamId: 'team-away',
    startTimeUtc: KICKOFF_FUTURE,
    status: 'SCHEDULED',
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<PredictionSnapshot> = {}): PredictionSnapshot {
  const response = {
    eligibility_status: 'FULL_MODE',
    predictions: {
      core: {
        p_home_win: 0.55,
        p_draw: 0.25,
        p_away_win: 0.2,
        predicted_result: 'HOME_WIN',
        expected_goals_home: 1.8,
        expected_goals_away: 1.1,
      },
    },
    internals: { calibration_mode: 'calibrated' },
    reasons: ['ELO_DIFF', 'HOME_ADVANTAGE'],
    data_integrity_flags: [],
  };

  return {
    match_id: 'match-001',
    competition_id: 'comp:football-data:PD',
    generated_at: '2026-06-15T18:00:00.000Z', // 2h before kickoff
    engine_version: '1.3',
    spec_version: '1.3',
    request_payload_json: '{}',
    response_payload_json: JSON.stringify(response),
    mode: 'FULL_MODE',
    calibration_mode: 'calibrated',
    reasons_json: JSON.stringify(['ELO_DIFF', 'HOME_ADVANTAGE']),
    degradation_flags_json: '[]',
    generation_status: 'ok',
    ...overrides,
  };
}

function makeStore(): EvaluationStore {
  return new EvaluationStore({ filePath: `/tmp/eval-test-${Date.now()}.json` });
}

// ── Gap 1: Every in-scope match gets a record ─────────────────────────────────

describe('Gap 1 — every in-scope match gets an EvaluationRecord', () => {
  it('registerMatch creates a PENDING record', () => {
    const store = makeStore();
    store.registerMatch('comp:football-data:PD', makeMatch());
    const r = store.findByMatch('match-001');
    expect(r).toBeDefined();
    expect(r!.record_status).toBe('PENDING');
    expect(r!.prediction_available).toBe(false);
    expect(r!.mode).toBe('UNKNOWN');
  });

  it('registerMatch is a no-op if record already exists', () => {
    const store = makeStore();
    store.registerMatch('comp:football-data:PD', makeMatch());
    store.registerMatch('comp:football-data:PD', makeMatch({ homeTeamId: 'other' }));
    const r = store.findByMatch('match-001');
    expect(r!.home_team_id).toBe('team-home'); // original preserved
  });

  it('registerMatch without kickoff is ignored', () => {
    const store = makeStore();
    store.registerMatch('comp:football-data:PD', makeMatch({ startTimeUtc: null }));
    expect(store.findByMatch('match-001')).toBeUndefined();
  });

  it('record exists even if prediction fails — stays PENDING', () => {
    const store = makeStore();
    store.registerMatch('comp:football-data:PD', makeMatch());
    // No freezeSnapshot call (simulating adapter/engine failure)
    const r = store.findByMatch('match-001');
    expect(r!.record_status).toBe('PENDING');
    expect(r!.evaluation_eligible).toBe(false);
  });
});

// ── Gap 2: One official snapshot per match_id ─────────────────────────────────

describe('Gap 2 — one official snapshot per match_id', () => {
  it('first freezeSnapshot wins; second is ignored', () => {
    const store = makeStore();
    const match = makeMatch();
    const snap1 = makeSnapshot({ generated_at: '2026-06-15T18:00:00.000Z' });
    const snap2 = makeSnapshot({
      generated_at: '2026-06-15T19:00:00.000Z',
      response_payload_json: JSON.stringify({
        eligibility_status: 'LIMITED_MODE',
        predictions: {
          core: { predicted_result: 'DRAW', p_home_win: 0.3, p_draw: 0.4, p_away_win: 0.3 },
        },
        internals: { calibration_mode: 'bootstrap' },
        reasons: [],
        data_integrity_flags: [],
      }),
      mode: 'LIMITED_MODE',
    });

    store.freezeSnapshot('comp:football-data:PD', match, snap1);
    store.freezeSnapshot('comp:football-data:PD', match, snap2);

    const r = store.findByMatch('match-001');
    expect(r!.record_status).toBe('SNAPSHOT_FROZEN');
    expect(r!.snapshot_generated_at).toBe('2026-06-15T18:00:00.000Z');
    expect(r!.mode).toBe('FULL_MODE'); // first snapshot preserved
  });

  it('freezeSnapshot on COMPLETE record is a no-op', () => {
    const store = makeStore();
    const match = makeMatch({ startTimeUtc: KICKOFF_PAST });
    store.freezeSnapshot(
      'comp:football-data:PD',
      match,
      makeSnapshot({ generated_at: '2026-01-01T18:00:00.000Z' }),
    );
    store.captureGroundTruth('match-001', 2, 1);
    const before = store.findByMatch('match-001')!.record_status;
    store.freezeSnapshot(
      'comp:football-data:PD',
      match,
      makeSnapshot({ generated_at: '2026-01-01T19:30:00.000Z' }),
    );
    expect(store.findByMatch('match-001')!.record_status).toBe(before);
  });
});

// ── Gap 3: Strict pre-kickoff freeze cutoff ───────────────────────────────────

describe('Gap 3 — strict pre-kickoff freeze cutoff', () => {
  it('pre-kickoff snapshot → SNAPSHOT_FROZEN', () => {
    const store = makeStore();
    const match = makeMatch({ startTimeUtc: '2026-06-15T20:00:00.000Z' });
    const snap = makeSnapshot({ generated_at: '2026-06-15T19:59:59.999Z' }); // 1ms before
    store.freezeSnapshot('comp:football-data:PD', match, snap);
    expect(store.findByMatch('match-001')!.record_status).toBe('SNAPSHOT_FROZEN');
    expect(store.findByMatch('match-001')!.prediction_available).toBe(true);
  });

  it('post-kickoff snapshot (equal timestamp) → EXCLUDED/NO_PREGAME_SNAPSHOT', () => {
    const store = makeStore();
    const kickoff = '2026-06-15T20:00:00.000Z';
    const snap = makeSnapshot({ generated_at: kickoff }); // equal = not strictly less
    store.freezeSnapshot('comp:football-data:PD', makeMatch({ startTimeUtc: kickoff }), snap);
    const r = store.findByMatch('match-001')!;
    expect(r.record_status).toBe('EXCLUDED');
    expect(r.excluded_reason).toBe('NO_PREGAME_SNAPSHOT');
    expect(r.prediction_available).toBe(false);
    expect(r.evaluation_eligible).toBe(false);
  });

  it('post-kickoff snapshot (strictly after) → EXCLUDED/NO_PREGAME_SNAPSHOT', () => {
    const store = makeStore();
    const snap = makeSnapshot({ generated_at: '2026-06-15T20:01:00.000Z' });
    store.freezeSnapshot(
      'comp:football-data:PD',
      makeMatch({ startTimeUtc: '2026-06-15T20:00:00.000Z' }),
      snap,
    );
    expect(store.findByMatch('match-001')!.excluded_reason).toBe('NO_PREGAME_SNAPSHOT');
  });

  it('failed snapshot (generation_status=error) is ignored', () => {
    const store = makeStore();
    store.registerMatch('comp:football-data:PD', makeMatch());
    const errorSnap = makeSnapshot({ generation_status: 'error' });
    store.freezeSnapshot('comp:football-data:PD', makeMatch(), errorSnap);
    expect(store.findByMatch('match-001')!.record_status).toBe('PENDING');
  });
});

// ── Gap 4: Explicit scoring eligibility rules ─────────────────────────────────

describe('Gap 4 — scoring eligibility rules per mode', () => {
  function makeCompleteRecord(
    mode: string,
    predicted_result: string | null,
    scoreHome: number,
    scoreAway: number,
  ) {
    const store = makeStore();
    const match = makeMatch({ startTimeUtc: KICKOFF_PAST });
    const snap = makeSnapshot({
      generated_at: '2026-01-01T18:00:00.000Z',
      mode,
      response_payload_json: JSON.stringify({
        eligibility_status: mode,
        predictions: {
          core: {
            predicted_result,
            p_home_win: predicted_result ? 0.5 : null,
            p_draw: predicted_result ? 0.3 : null,
            p_away_win: predicted_result ? 0.2 : null,
          },
        },
        internals: { calibration_mode: 'calibrated' },
        reasons: [],
        data_integrity_flags: [],
      }),
    });
    store.freezeSnapshot('comp:football-data:PD', match, snap);
    store.captureGroundTruth('match-001', scoreHome, scoreAway);
    return store.findByMatch('match-001')!;
  }

  it('FULL_MODE + pre-kickoff snap + FINISHED → eligible', () => {
    const r = makeCompleteRecord('FULL_MODE', 'HOME_WIN', 2, 1);
    expect(r.record_status).toBe('COMPLETE');
    expect(r.evaluation_eligible).toBe(true);
    expect(r.excluded_reason).toBeNull();
  });

  it('LIMITED_MODE + pre-kickoff snap + FINISHED → eligible', () => {
    const r = makeCompleteRecord('LIMITED_MODE', 'DRAW', 1, 1);
    expect(r.evaluation_eligible).toBe(true);
    expect(r.excluded_reason).toBeNull();
  });

  it('NOT_ELIGIBLE + snap + FINISHED → not eligible (counted in coverage)', () => {
    const r = makeCompleteRecord('NOT_ELIGIBLE', null, 2, 0);
    expect(r.record_status).toBe('COMPLETE');
    expect(r.evaluation_eligible).toBe(false);
    expect(r.excluded_reason).toBe('NOT_ELIGIBLE');
  });

  it('no snapshot → PENDING then EXCLUDED when FINISHED → not eligible', () => {
    const store = makeStore();
    store.registerMatch('comp:football-data:PD', makeMatch({ startTimeUtc: KICKOFF_PAST }));
    store.captureGroundTruth('match-001', 1, 0);
    const r = store.findByMatch('match-001')!;
    expect(r.record_status).toBe('EXCLUDED');
    expect(r.excluded_reason).toBe('NO_PREGAME_SNAPSHOT');
    expect(r.evaluation_eligible).toBe(false);
  });

  it('MISSING_PROBS → not eligible', () => {
    const store = makeStore();
    const match = makeMatch({ startTimeUtc: KICKOFF_PAST });
    const snap = makeSnapshot({
      generated_at: '2026-01-01T18:00:00.000Z',
      mode: 'FULL_MODE',
      response_payload_json: JSON.stringify({
        eligibility_status: 'FULL_MODE',
        predictions: { core: { predicted_result: null } }, // no prediction
        internals: { calibration_mode: null },
        reasons: [],
        data_integrity_flags: [],
      }),
    });
    store.freezeSnapshot('comp:football-data:PD', match, snap);
    store.captureGroundTruth('match-001', 2, 0);
    const r = store.findByMatch('match-001')!;
    expect(r.excluded_reason).toBe('MISSING_PROBS');
    expect(r.evaluation_eligible).toBe(false);
  });

  it('ABNORMAL_END → not eligible', () => {
    const store = makeStore();
    store.registerMatch('comp:football-data:PD', makeMatch());
    store.markAbnormalEnd('match-001');
    const r = store.findByMatch('match-001')!;
    expect(r.excluded_reason).toBe('ABNORMAL_END');
    expect(r.evaluation_eligible).toBe(false);
    expect(r.ground_truth_status).toBe('UNAVAILABLE');
  });
});

// ── Gap 5: EvaluationRecord lifecycle model ───────────────────────────────────

describe('Gap 5 — EvaluationRecord lifecycle model', () => {
  it('full happy path: PENDING → SNAPSHOT_FROZEN → COMPLETE', () => {
    const store = makeStore();
    const match = makeMatch({ startTimeUtc: KICKOFF_PAST });
    store.registerMatch('comp:football-data:PD', match);
    expect(store.findByMatch('match-001')!.record_status).toBe('PENDING');

    store.freezeSnapshot(
      'comp:football-data:PD',
      match,
      makeSnapshot({ generated_at: '2026-01-01T18:00:00.000Z' }),
    );
    expect(store.findByMatch('match-001')!.record_status).toBe('SNAPSHOT_FROZEN');

    store.captureGroundTruth('match-001', 3, 1);
    const r = store.findByMatch('match-001')!;
    expect(r.record_status).toBe('COMPLETE');
    expect(r.ground_truth_status).toBe('CAPTURED');
    expect(r.actual_result).toBe('HOME_WIN');
    expect(r.evaluation_eligible).toBe(true);
  });

  it('PENDING → COMPLETE skips to EXCLUDED/NO_PREGAME_SNAPSHOT when no snapshot', () => {
    const store = makeStore();
    store.registerMatch('comp:football-data:PD', makeMatch({ startTimeUtc: KICKOFF_PAST }));
    store.captureGroundTruth('match-001', 0, 0);
    const r = store.findByMatch('match-001')!;
    expect(r.record_status).toBe('EXCLUDED');
    expect(r.excluded_reason).toBe('NO_PREGAME_SNAPSHOT');
    expect(r.actual_result).toBe('DRAW'); // ground truth still captured
    expect(r.evaluation_eligible).toBe(false);
  });

  it('captureGroundTruth is no-op on COMPLETE', () => {
    const store = makeStore();
    const match = makeMatch({ startTimeUtc: KICKOFF_PAST });
    store.freezeSnapshot(
      'comp:football-data:PD',
      match,
      makeSnapshot({ generated_at: '2026-01-01T18:00:00.000Z' }),
    );
    store.captureGroundTruth('match-001', 2, 1);
    const result = store.captureGroundTruth('match-001', 0, 0); // second call
    expect(result).toBe(false);
    expect(store.findByMatch('match-001')!.actual_result).toBe('HOME_WIN'); // unchanged
  });

  it('markAbnormalEnd is no-op on COMPLETE', () => {
    const store = makeStore();
    const match = makeMatch({ startTimeUtc: KICKOFF_PAST });
    store.freezeSnapshot(
      'comp:football-data:PD',
      match,
      makeSnapshot({ generated_at: '2026-01-01T18:00:00.000Z' }),
    );
    store.captureGroundTruth('match-001', 1, 0);
    const result = store.markAbnormalEnd('match-001');
    expect(result).toBe(false);
    expect(store.findByMatch('match-001')!.record_status).toBe('COMPLETE');
  });
});

// ── Gap 6: CANCELED / POSTPONED handling ─────────────────────────────────────

describe('Gap 6 — abnormal terminal states', () => {
  it('PENDING → EXCLUDED/ABNORMAL_END on markAbnormalEnd', () => {
    const store = makeStore();
    store.registerMatch('comp:football-data:PD', makeMatch());
    store.markAbnormalEnd('match-001');
    const r = store.findByMatch('match-001')!;
    expect(r.record_status).toBe('EXCLUDED');
    expect(r.excluded_reason).toBe('ABNORMAL_END');
    expect(r.ground_truth_status).toBe('UNAVAILABLE');
    expect(r.evaluation_eligible).toBe(false);
  });

  it('SNAPSHOT_FROZEN → EXCLUDED/ABNORMAL_END on markAbnormalEnd', () => {
    const store = makeStore();
    store.freezeSnapshot('comp:football-data:PD', makeMatch(), makeSnapshot());
    store.markAbnormalEnd('match-001');
    const r = store.findByMatch('match-001')!;
    expect(r.record_status).toBe('EXCLUDED');
    expect(r.excluded_reason).toBe('ABNORMAL_END');
  });

  it('markAbnormalEnd on unknown matchId returns false', () => {
    const store = makeStore();
    expect(store.markAbnormalEnd('non-existent')).toBe(false);
  });

  it('EXCLUDED record cannot transition further via captureGroundTruth', () => {
    const store = makeStore();
    store.registerMatch('comp:football-data:PD', makeMatch());
    store.markAbnormalEnd('match-001');
    store.captureGroundTruth('match-001', 1, 0);
    const r = store.findByMatch('match-001')!;
    expect(r.record_status).toBe('EXCLUDED');
    expect(r.actual_result).toBeNull(); // not captured
  });
});

// ── Gap 7: Coverage funnel ────────────────────────────────────────────────────

describe('Gap 7 — staged coverage funnel', () => {
  it('funnel counts are non-increasing (Stage N+1 ≤ Stage N)', () => {
    const store = makeStore();
    const PAST = KICKOFF_PAST;

    // Match A: COMPLETE eligible
    store.registerMatch('comp', makeMatch({ matchId: 'A', startTimeUtc: PAST }));
    store.freezeSnapshot(
      'comp',
      makeMatch({ matchId: 'A', startTimeUtc: PAST }),
      makeSnapshot({ match_id: 'A', generated_at: '2026-01-01T18:00:00.000Z' }),
    );
    store.captureGroundTruth('A', 2, 1);

    // Match B: SNAPSHOT_FROZEN, no ground truth
    store.registerMatch('comp', makeMatch({ matchId: 'B', startTimeUtc: KICKOFF_FUTURE }));
    store.freezeSnapshot(
      'comp',
      makeMatch({ matchId: 'B', startTimeUtc: KICKOFF_FUTURE }),
      makeSnapshot({ match_id: 'B' }),
    );

    // Match C: PENDING (no snapshot)
    store.registerMatch('comp', makeMatch({ matchId: 'C', startTimeUtc: KICKOFF_FUTURE }));

    // Match D: EXCLUDED/ABNORMAL_END
    store.registerMatch('comp', makeMatch({ matchId: 'D', startTimeUtc: PAST }));
    store.markAbnormalEnd('D');

    const metrics = computeMetrics(store.findAll());
    const f = metrics.coverage_funnel;

    expect(f.total_in_scope).toBe(4); // Stage 1
    expect(f.with_pregame_snapshot).toBe(2); // Stage 2: A (COMPLETE) + B (SNAPSHOT_FROZEN)
    expect(f.with_ground_truth).toBe(1); // Stage 3: A only
    expect(f.fully_evaluable).toBe(1); // Stage 4: A only
    expect(f.with_ui_observation).toBe(0); // Stage 5: none recorded

    // Non-increasing invariant
    expect(f.with_pregame_snapshot).toBeLessThanOrEqual(f.total_in_scope);
    expect(f.with_ground_truth).toBeLessThanOrEqual(f.with_pregame_snapshot);
    expect(f.fully_evaluable).toBeLessThanOrEqual(f.with_ground_truth);
    expect(f.with_ui_observation).toBeLessThanOrEqual(f.total_in_scope);
  });

  it('exclusion breakdown sums correctly', () => {
    const store = makeStore();
    // NOT_ELIGIBLE
    const matchNE = makeMatch({ matchId: 'NE', startTimeUtc: KICKOFF_PAST });
    store.freezeSnapshot(
      'comp',
      matchNE,
      makeSnapshot({
        match_id: 'NE',
        mode: 'NOT_ELIGIBLE',
        generated_at: '2026-01-01T18:00:00.000Z',
      }),
    );
    store.captureGroundTruth('NE', 0, 1);

    // ABNORMAL_END
    store.registerMatch('comp', makeMatch({ matchId: 'AB' }));
    store.markAbnormalEnd('AB');

    const metrics = computeMetrics(store.findAll());
    const f = metrics.coverage_funnel;
    expect(f.NOT_ELIGIBLE_count).toBe(1);
    expect(f.ABNORMAL_END_count).toBe(1);
  });
});

// ── Gap 8: snapshot_id is stored ─────────────────────────────────────────────

describe('Gap 8 — snapshot_id stored on freeze', () => {
  it('snapshot_id is set to eval:matchId:generatedAt', () => {
    const store = makeStore();
    const snap = makeSnapshot({ generated_at: '2026-06-15T18:00:00.000Z' });
    store.freezeSnapshot('comp:football-data:PD', makeMatch(), snap);
    const r = store.findByMatch('match-001')!;
    expect(r.snapshot_id).toBe('eval:match-001:2026-06-15T18:00:00.000Z');
  });

  it('snapshot_id is null on PENDING record', () => {
    const store = makeStore();
    store.registerMatch('comp:football-data:PD', makeMatch());
    expect(store.findByMatch('match-001')!.snapshot_id).toBeNull();
  });
});

// ── Gap 9: runtime_issue categories ──────────────────────────────────────────

describe('Gap 9 — runtime_issue categories', () => {
  it('EvaluationRecord has all expected runtime_issue values as valid type', () => {
    // Type-level check via runtime construction
    const validValues: Array<string | null> = [
      'NONE',
      'FETCH_ERROR',
      'SNAPSHOT_MISS',
      'SCOPE_MISMATCH',
      'RENDER_CRASH',
      'OTHER',
      null,
    ];
    const store = makeStore();
    store.registerMatch('comp:football-data:PD', makeMatch());
    const r = store.findByMatch('match-001')!;
    // Verify null is the initial state
    expect(validValues).toContain(r.runtime_issue);
    expect(r.runtime_issue).toBeNull();
  });
});

// ── Metrics: Baseline B only ──────────────────────────────────────────────────

describe('Metrics — Baseline B (naïve class frequency)', () => {
  it('baseline_b_accuracy reflects most-common-class frequency', () => {
    const store = makeStore();
    // 3 HOME_WIN, 1 DRAW → most common = HOME_WIN, baseline_b = 3/4 = 0.75
    for (let i = 0; i < 3; i++) {
      const mid = `hm-${i}`;
      store.freezeSnapshot(
        'comp',
        makeMatch({ matchId: mid, startTimeUtc: KICKOFF_PAST }),
        makeSnapshot({ match_id: mid, generated_at: '2026-01-01T18:00:00.000Z' }),
      );
      store.captureGroundTruth(mid, 2, 1); // HOME_WIN
    }
    const mid = 'draw-0';
    store.freezeSnapshot(
      'comp',
      makeMatch({ matchId: mid, startTimeUtc: KICKOFF_PAST }),
      makeSnapshot({ match_id: mid, generated_at: '2026-01-01T18:00:00.000Z' }),
    );
    store.captureGroundTruth(mid, 1, 1); // DRAW

    const metrics = computeMetrics(store.findAll());
    expect(metrics.performance.baseline_b_accuracy).toBeCloseTo(0.75, 5);
  });

  it('baseline_b_accuracy is null with no evaluable records', () => {
    const store = makeStore();
    store.registerMatch('comp', makeMatch());
    const metrics = computeMetrics(store.findAll());
    expect(metrics.performance.baseline_b_accuracy).toBeNull();
  });
});

// ── Metrics: NOT_ELIGIBLE excluded from denominators ─────────────────────────

describe('Metrics — NOT_ELIGIBLE excluded from metric denominators', () => {
  it('NOT_ELIGIBLE records do not appear in accuracy denominator', () => {
    const store = makeStore();

    // 1 eligible FULL_MODE record → accuracy 1.0
    const mFull = makeMatch({ matchId: 'full-1', startTimeUtc: KICKOFF_PAST });
    store.freezeSnapshot(
      'comp',
      mFull,
      makeSnapshot({ match_id: 'full-1', generated_at: '2026-01-01T18:00:00.000Z' }),
    );
    store.captureGroundTruth('full-1', 2, 1); // HOME_WIN, predicted HOME_WIN

    // 1 NOT_ELIGIBLE record
    const mNE = makeMatch({ matchId: 'ne-1', startTimeUtc: KICKOFF_PAST });
    store.freezeSnapshot(
      'comp',
      mNE,
      makeSnapshot({
        match_id: 'ne-1',
        generated_at: '2026-01-01T18:00:00.000Z',
        mode: 'NOT_ELIGIBLE',
        response_payload_json: JSON.stringify({
          eligibility_status: 'NOT_ELIGIBLE',
          predictions: { core: {} },
          internals: { calibration_mode: null },
          reasons: [],
          data_integrity_flags: [],
        }),
      }),
    );
    store.captureGroundTruth('ne-1', 0, 2);

    const metrics = computeMetrics(store.findAll());
    expect(metrics.coverage_funnel.total_in_scope).toBe(2);
    expect(metrics.coverage_funnel.fully_evaluable).toBe(1); // only FULL_MODE
    expect(metrics.coverage_funnel.NOT_ELIGIBLE_count).toBe(1);
    expect(metrics.performance.accuracy_total).toBeCloseTo(1.0, 5); // 1/1, not 1/2
  });
});
