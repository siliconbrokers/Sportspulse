/**
 * WP-05 — GET /api/ui/track-record
 * Tests: K-03 (track-record public surface)
 *
 * Test matrix:
 *   1. unavailable — no data at all → state=unavailable, accuracy=null, TRACK_RECORD_UNAVAILABLE
 *   2. below-threshold — data but < 200 → state=below_threshold, accuracy=null
 *   3. available — ≥200 FULL_MODE resolved records → state=available, accuracy>0, operational
 *   4. invalid-competition-id — empty competitionId → 400 INVALID_COMPETITION_ID
 *   5. competition-not-enabled — not in registry → 404 COMPETITION_NOT_ENABLED
 *   6. disabled competition → 404 COMPETITION_NOT_ENABLED
 *   7. forward-validation path — FVS data present → evaluationType=historical_walk_forward
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerTrackRecordRoute } from '../track-record-route.js';
import type { EvaluationStore, EvaluationRecord } from '../../prediction/evaluation-store.js';
import type { ForwardValidationStore, ForwardValidationRecord } from '../../prediction/forward-validation-store.js';

// ── Mocks ──────────────────────────────────────────────────────────────────────

// Mock portal-config-store so tests are not file-system dependent
vi.mock('../../portal-config-store.js', () => ({
  isCompetitionActive: vi.fn((id: string) => {
    // 'comp:apifootball:140' = LaLiga/PD — active
    // 'comp:apifootball:39'  = Premier League — active
    // 'comp:apifootball:999' = does not exist in registry
    // 'comp:apifootball:disabled' = in registry but disabled via test override
    return id !== 'comp:apifootball:disabled';
  }),
}));

// Use a real REGISTRY_BY_ID structure by mocking competition-registry for known IDs
vi.mock('../../competition-registry.js', () => {
  const COMPETITION_REGISTRY = [
    {
      id: 'comp:apifootball:140',
      leagueId: 140,
      slug: 'PD',
      displayName: 'La Liga',
      shortName: 'LaLiga',
      normalizedLeague: 'LALIGA',
      newsKey: 'LL',
      accentColor: '#f59e0b',
      logoUrl: '',
      seasonLabel: '25/26',
      seasonKind: 'cross-year',
      isTournament: false,
    },
    {
      id: 'comp:apifootball:39',
      leagueId: 39,
      slug: 'PL',
      displayName: 'Premier League',
      shortName: 'Premier',
      normalizedLeague: 'PREMIER_LEAGUE',
      newsKey: 'EPL',
      accentColor: '#a855f7',
      logoUrl: '',
      seasonLabel: '25/26',
      seasonKind: 'cross-year',
      isTournament: false,
    },
    // Simulated disabled competition (exists in registry, portal-config returns disabled)
    {
      id: 'comp:apifootball:disabled',
      leagueId: 9999,
      slug: 'DIS',
      displayName: 'Disabled Competition',
      shortName: 'Disabled',
      normalizedLeague: 'DISABLED',
      newsKey: null,
      accentColor: '#000000',
      logoUrl: '',
      seasonLabel: '2026',
      seasonKind: 'calendar',
      isTournament: false,
    },
  ];
  const REGISTRY_BY_ID = new Map(COMPETITION_REGISTRY.map((e) => [e.id, e]));
  return { COMPETITION_REGISTRY, REGISTRY_BY_ID };
});

// ── Builders ──────────────────────────────────────────────────────────────────

function makeEvalRecord(overrides: Partial<EvaluationRecord> = {}): EvaluationRecord {
  return {
    match_id: `match:apifootball:140:${Math.random()}`,
    competition_id: 'comp:apifootball:140',
    home_team_id: 'team:1',
    away_team_id: 'team:2',
    scheduled_kickoff_utc: '2026-01-10T20:00:00Z',
    record_status: 'COMPLETE',
    snapshot_id: 'eval:match:1:2026-01-10T18:00:00Z',
    snapshot_frozen_at: '2026-01-10T18:00:00Z',
    snapshot_generated_at: '2026-01-10T18:00:00Z',
    engine_version: 'v3',
    spec_version: '1.3',
    prediction_available: true,
    evaluation_eligible: true,
    excluded_reason: null,
    mode: 'FULL_MODE',
    calibration_mode: 'logistic',
    predicted_result: 'HOME_WIN',
    p_home_win: 0.55,
    p_draw: 0.25,
    p_away_win: 0.20,
    expected_goals_home: 1.5,
    expected_goals_away: 1.0,
    reasons: [],
    ground_truth_status: 'CAPTURED',
    ground_truth_captured_at: '2026-01-10T22:00:00Z',
    final_home_goals: 2,
    final_away_goals: 1,
    actual_result: 'HOME_WIN',
    market_prob_home: null,
    market_prob_draw: null,
    market_prob_away: null,
    market_odds_captured_at: null,
    market_bookmaker_count: null,
    edge_home: null,
    edge_draw: null,
    edge_away: null,
    blend_applied: null,
    blend_market_prob_home: null,
    blend_market_prob_draw: null,
    blend_market_prob_away: null,
    ui_render_result: null,
    ui_clear_or_confusing: null,
    runtime_issue: null,
    runtime_notes: null,
    ...overrides,
  };
}

function makeFwdRecord(overrides: Partial<ForwardValidationRecord> = {}): ForwardValidationRecord {
  return {
    record_id: `fwd:PD:match:1:BASELINE_REFERENCE`,
    source_type: 'FORWARD_OFFICIAL',
    competition_code: 'PD',
    match_id: `match:apifootball:140:${Math.random()}`,
    kickoff_utc: '2026-01-10T20:00:00Z',
    home_team_id: 'team:1',
    away_team_id: 'team:2',
    variant: 'BASELINE_REFERENCE',
    snapshot_generated_at: '2026-01-10T18:00:00Z',
    snapshot_frozen_at: '2026-01-10T18:00:00Z',
    freeze_lead_hours: 2,
    mode: 'FULL_MODE',
    predicted_result: 'HOME_WIN',
    p_home_win: 0.55,
    p_draw: 0.25,
    p_away_win: 0.20,
    expected_goals_home: 1.5,
    expected_goals_away: 1.0,
    lambda_home: 1.5,
    lambda_away: 1.0,
    actual_result: 'HOME_WIN',
    home_goals: 2,
    away_goals: 1,
    result_captured_at: '2026-01-10T22:00:00Z',
    evaluation_eligible: true,
    excluded_reason: null,
    blend_applied: null,
    blend_market_prob_home: null,
    blend_market_prob_draw: null,
    blend_market_prob_away: null,
    ...overrides,
  };
}

// ── Store mocks ───────────────────────────────────────────────────────────────

function makeEvalStore(records: EvaluationRecord[] = []): EvaluationStore {
  return {
    findByCompetition: (id: string) => records.filter((r) => r.competition_id === id),
    findAll: () => records,
    findByMatch: (id: string) => records.find((r) => r.match_id === id),
  } as unknown as EvaluationStore;
}

function makeFwdStore(records: ForwardValidationRecord[] = []): ForwardValidationStore {
  return {
    findByCompetition: (code: string) => records.filter((r) => r.competition_code === code),
    findAll: () => records,
    findCompleted: () => records.filter((r) => r.actual_result !== null && r.snapshot_frozen_at !== null),
    findPending: () => records.filter((r) => r.actual_result === null && r.snapshot_frozen_at !== null),
  } as unknown as ForwardValidationStore;
}

// ── Test harness ──────────────────────────────────────────────────────────────

async function buildApp(
  evalStore: EvaluationStore,
  fwdStore: ForwardValidationStore,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerTrackRecordRoute(app, evalStore, fwdStore);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/ui/track-record', () => {
  describe('400 — invalid-competition-id', () => {
    it('returns 400 INVALID_COMPETITION_ID when competitionId is empty string', async () => {
      const app = await buildApp(makeEvalStore(), makeFwdStore());
      const res = await app.inject({ method: 'GET', url: '/api/ui/track-record?competitionId=' });
      expect(res.statusCode).toBe(400);
      const body = res.json<{ error: { code: string } }>();
      expect(body.error.code).toBe('INVALID_COMPETITION_ID');
    });

    it('returns 400 INVALID_COMPETITION_ID when competitionId is missing', async () => {
      const app = await buildApp(makeEvalStore(), makeFwdStore());
      const res = await app.inject({ method: 'GET', url: '/api/ui/track-record' });
      expect(res.statusCode).toBe(400);
      const body = res.json<{ error: { code: string } }>();
      expect(body.error.code).toBe('INVALID_COMPETITION_ID');
    });

    it('returns 400 INVALID_COMPETITION_ID when competitionId is whitespace only', async () => {
      const app = await buildApp(makeEvalStore(), makeFwdStore());
      const res = await app.inject({ method: 'GET', url: '/api/ui/track-record?competitionId=%20%20' });
      expect(res.statusCode).toBe(400);
      const body = res.json<{ error: { code: string } }>();
      expect(body.error.code).toBe('INVALID_COMPETITION_ID');
    });
  });

  describe('404 — competition-not-enabled', () => {
    it('returns 404 COMPETITION_NOT_ENABLED when competitionId is not in registry', async () => {
      const app = await buildApp(makeEvalStore(), makeFwdStore());
      const res = await app.inject({
        method: 'GET',
        url: '/api/ui/track-record?competitionId=comp:apifootball:999',
      });
      expect(res.statusCode).toBe(404);
      const body = res.json<{ error: { code: string } }>();
      expect(body.error.code).toBe('COMPETITION_NOT_ENABLED');
    });

    it('returns 404 COMPETITION_NOT_ENABLED when competition is disabled in portal-config', async () => {
      const app = await buildApp(makeEvalStore(), makeFwdStore());
      const res = await app.inject({
        method: 'GET',
        url: '/api/ui/track-record?competitionId=comp:apifootball:disabled',
      });
      expect(res.statusCode).toBe(404);
      const body = res.json<{ error: { code: string } }>();
      expect(body.error.code).toBe('COMPETITION_NOT_ENABLED');
    });
  });

  describe('unavailable — no data', () => {
    it('returns state=unavailable when evaluation store has no records for competition', async () => {
      const app = await buildApp(makeEvalStore([]), makeFwdStore([]));
      const res = await app.inject({
        method: 'GET',
        url: '/api/ui/track-record?competitionId=comp:apifootball:140',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        state: string;
        accuracy: number | null;
        disclosureMessageKey: string;
        predictionCount: number;
        belowThreshold: boolean;
      }>();
      expect(body.state).toBe('unavailable');
      expect(body.accuracy).toBeNull();
      expect(body.disclosureMessageKey).toBe('TRACK_RECORD_UNAVAILABLE');
      expect(body.predictionCount).toBe(0);
      expect(body.belowThreshold).toBe(false);
    });

    it('returns state=unavailable when records exist but none are FULL_MODE + evaluation_eligible', async () => {
      // Records that are NOT_ELIGIBLE should not count
      const records = Array.from({ length: 50 }, (_, i) =>
        makeEvalRecord({
          match_id: `match:apifootball:140:${i}`,
          mode: 'NOT_ELIGIBLE',
          evaluation_eligible: false,
          excluded_reason: 'NOT_ELIGIBLE',
        }),
      );
      const app = await buildApp(makeEvalStore(records), makeFwdStore([]));
      const res = await app.inject({
        method: 'GET',
        url: '/api/ui/track-record?competitionId=comp:apifootball:140',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ state: string }>();
      expect(body.state).toBe('unavailable');
    });
  });

  describe('below_threshold — data but < 200', () => {
    it('returns state=below_threshold when eligible records < 200', async () => {
      const records = Array.from({ length: 50 }, (_, i) =>
        makeEvalRecord({ match_id: `match:apifootball:140:${i}` }),
      );
      const app = await buildApp(makeEvalStore(records), makeFwdStore([]));
      const res = await app.inject({
        method: 'GET',
        url: '/api/ui/track-record?competitionId=comp:apifootball:140',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        state: string;
        accuracy: number | null;
        belowThreshold: boolean;
        predictionCount: number;
        evaluationType: string;
        disclosureMessageKey: string;
        threshold: number;
      }>();
      expect(body.state).toBe('below_threshold');
      expect(body.accuracy).toBeNull();
      expect(body.belowThreshold).toBe(true);
      expect(body.predictionCount).toBe(50);
      expect(body.evaluationType).toBe('operational');
      expect(body.disclosureMessageKey).toBe('TRACK_RECORD_UNAVAILABLE');
      expect(body.threshold).toBe(200);
    });

    it('returns state=below_threshold at exactly 199 records', async () => {
      const records = Array.from({ length: 199 }, (_, i) =>
        makeEvalRecord({ match_id: `match:apifootball:140:${i}` }),
      );
      const app = await buildApp(makeEvalStore(records), makeFwdStore([]));
      const res = await app.inject({
        method: 'GET',
        url: '/api/ui/track-record?competitionId=comp:apifootball:140',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ state: string; predictionCount: number }>();
      expect(body.state).toBe('below_threshold');
      expect(body.predictionCount).toBe(199);
    });
  });

  describe('available — ≥200 FULL_MODE resolved records', () => {
    it('returns state=available with correct accuracy and evaluationType=operational', async () => {
      // 200 records: 130 correct HOME_WIN predictions, 70 wrong (predicted HOME_WIN, actual DRAW)
      const records = [
        ...Array.from({ length: 130 }, (_, i) =>
          makeEvalRecord({
            match_id: `match:apifootball:140:correct:${i}`,
            predicted_result: 'HOME_WIN',
            actual_result: 'HOME_WIN',
          }),
        ),
        ...Array.from({ length: 70 }, (_, i) =>
          makeEvalRecord({
            match_id: `match:apifootball:140:wrong:${i}`,
            predicted_result: 'HOME_WIN',
            actual_result: 'DRAW',
          }),
        ),
      ];
      const app = await buildApp(makeEvalStore(records), makeFwdStore([]));
      const res = await app.inject({
        method: 'GET',
        url: '/api/ui/track-record?competitionId=comp:apifootball:140',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        state: string;
        accuracy: number;
        belowThreshold: boolean;
        predictionCount: number;
        evaluationType: string;
        disclosureMessageKey: string;
        competitionId: string;
        threshold: number;
      }>();
      expect(body.state).toBe('available');
      expect(body.belowThreshold).toBe(false);
      expect(body.predictionCount).toBe(200);
      expect(body.evaluationType).toBe('operational');
      expect(body.disclosureMessageKey).toBe('TRACK_RECORD_OPERATIONAL');
      expect(body.competitionId).toBe('comp:apifootball:140');
      expect(body.threshold).toBe(200);
      // accuracy = 130/200 = 0.65
      expect(body.accuracy).toBeCloseTo(0.65, 5);
    });

    it('returns state=available at exactly 200 records', async () => {
      const records = Array.from({ length: 200 }, (_, i) =>
        makeEvalRecord({ match_id: `match:apifootball:140:${i}` }),
      );
      const app = await buildApp(makeEvalStore(records), makeFwdStore([]));
      const res = await app.inject({
        method: 'GET',
        url: '/api/ui/track-record?competitionId=comp:apifootball:140',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ state: string; predictionCount: number }>();
      expect(body.state).toBe('available');
      expect(body.predictionCount).toBe(200);
    });

    it('only counts FULL_MODE records — excludes LIMITED_MODE', async () => {
      // 150 FULL_MODE + 100 LIMITED_MODE = only 150 should count
      const records = [
        ...Array.from({ length: 150 }, (_, i) =>
          makeEvalRecord({ match_id: `match:apifootball:140:full:${i}`, mode: 'FULL_MODE' }),
        ),
        ...Array.from({ length: 100 }, (_, i) =>
          makeEvalRecord({ match_id: `match:apifootball:140:limited:${i}`, mode: 'LIMITED_MODE' }),
        ),
      ];
      const app = await buildApp(makeEvalStore(records), makeFwdStore([]));
      const res = await app.inject({
        method: 'GET',
        url: '/api/ui/track-record?competitionId=comp:apifootball:140',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ state: string; predictionCount: number }>();
      // 150 FULL_MODE < 200 threshold → below_threshold
      expect(body.state).toBe('below_threshold');
      expect(body.predictionCount).toBe(150);
    });

    it('does not include records from other competitions', async () => {
      // 200 records for PL, 0 for PD
      const records = Array.from({ length: 200 }, (_, i) =>
        makeEvalRecord({
          match_id: `match:apifootball:39:${i}`,
          competition_id: 'comp:apifootball:39',
        }),
      );
      const app = await buildApp(makeEvalStore(records), makeFwdStore([]));
      const res = await app.inject({
        method: 'GET',
        url: '/api/ui/track-record?competitionId=comp:apifootball:140',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ state: string }>();
      expect(body.state).toBe('unavailable');
    });
  });

  describe('forward-validation path', () => {
    it('uses ForwardValidationStore data when available → evaluationType=historical_walk_forward', async () => {
      // 10 FVS records (below threshold), but FVS path takes priority over EvalStore
      const fwdRecords = Array.from({ length: 10 }, (_, i) =>
        makeFwdRecord({ record_id: `fwd:PD:match:${i}:BASELINE_REFERENCE`, match_id: `match:apifootball:140:${i}` }),
      );
      // Also add some eval records — FVS should win
      const evalRecords = Array.from({ length: 200 }, (_, i) =>
        makeEvalRecord({ match_id: `match:apifootball:140:eval:${i}` }),
      );
      const app = await buildApp(makeEvalStore(evalRecords), makeFwdStore(fwdRecords));
      const res = await app.inject({
        method: 'GET',
        url: '/api/ui/track-record?competitionId=comp:apifootball:140',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        evaluationType: string;
        state: string;
        predictionCount: number;
      }>();
      expect(body.evaluationType).toBe('historical_walk_forward');
      // 10 FVS records < 200 → below_threshold
      expect(body.state).toBe('below_threshold');
      expect(body.predictionCount).toBe(10);
    });

    it('returns available with historical_walk_forward when FVS has ≥200 eligible records', async () => {
      const fwdRecords = [
        ...Array.from({ length: 120 }, (_, i) =>
          makeFwdRecord({
            record_id: `fwd:PD:match:${i}:BASELINE_REFERENCE`,
            match_id: `match:apifootball:140:fwd:${i}`,
            predicted_result: 'HOME_WIN',
            actual_result: 'HOME_WIN',
          }),
        ),
        ...Array.from({ length: 80 }, (_, i) =>
          makeFwdRecord({
            record_id: `fwd:PD:match:${i + 120}:BASELINE_REFERENCE`,
            match_id: `match:apifootball:140:fwd:${i + 120}`,
            predicted_result: 'HOME_WIN',
            actual_result: 'DRAW',
          }),
        ),
      ];
      const app = await buildApp(makeEvalStore([]), makeFwdStore(fwdRecords));
      const res = await app.inject({
        method: 'GET',
        url: '/api/ui/track-record?competitionId=comp:apifootball:140',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        state: string;
        evaluationType: string;
        accuracy: number;
        predictionCount: number;
        disclosureMessageKey: string;
      }>();
      expect(body.state).toBe('available');
      expect(body.evaluationType).toBe('historical_walk_forward');
      expect(body.predictionCount).toBe(200);
      expect(body.disclosureMessageKey).toBe('TRACK_RECORD_HISTORICAL_WALK_FORWARD');
      // accuracy = 120/200 = 0.60
      expect(body.accuracy).toBeCloseTo(0.60, 5);
    });

    it('skips FVS diagnostic records (snapshot_frozen_at=null)', async () => {
      // Diagnostic record has snapshot_frozen_at=null — must not count
      const diagnosticRecords = Array.from({ length: 300 }, (_, i) =>
        makeFwdRecord({
          record_id: `fwd:PD:match:${i}:BASELINE_REFERENCE`,
          match_id: `match:apifootball:140:diag:${i}`,
          snapshot_frozen_at: null,
          actual_result: 'HOME_WIN',
        }),
      );
      const app = await buildApp(makeEvalStore([]), makeFwdStore(diagnosticRecords));
      const res = await app.inject({
        method: 'GET',
        url: '/api/ui/track-record?competitionId=comp:apifootball:140',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ state: string; evaluationType: string }>();
      // FVS path sees 0 valid records → falls through to EvalStore (also 0) → unavailable
      expect(body.state).toBe('unavailable');
      expect(body.evaluationType).toBe('operational');
    });
  });

  describe('response shape invariants', () => {
    it('accuracy is null when state=below_threshold', async () => {
      const records = Array.from({ length: 100 }, (_, i) =>
        makeEvalRecord({ match_id: `match:apifootball:140:${i}` }),
      );
      const app = await buildApp(makeEvalStore(records), makeFwdStore([]));
      const res = await app.inject({
        method: 'GET',
        url: '/api/ui/track-record?competitionId=comp:apifootball:140',
      });
      const body = res.json<{ state: string; accuracy: unknown }>();
      expect(body.state).toBe('below_threshold');
      expect(body.accuracy).toBeNull();
    });

    it('belowThreshold=false when state=available', async () => {
      const records = Array.from({ length: 200 }, (_, i) =>
        makeEvalRecord({ match_id: `match:apifootball:140:${i}` }),
      );
      const app = await buildApp(makeEvalStore(records), makeFwdStore([]));
      const res = await app.inject({
        method: 'GET',
        url: '/api/ui/track-record?competitionId=comp:apifootball:140',
      });
      const body = res.json<{ belowThreshold: boolean }>();
      expect(body.belowThreshold).toBe(false);
    });

    it('belowThreshold=false when state=unavailable', async () => {
      const app = await buildApp(makeEvalStore([]), makeFwdStore([]));
      const res = await app.inject({
        method: 'GET',
        url: '/api/ui/track-record?competitionId=comp:apifootball:140',
      });
      const body = res.json<{ belowThreshold: boolean }>();
      expect(body.belowThreshold).toBe(false);
    });

    it('threshold is always 200 in response', async () => {
      const app = await buildApp(makeEvalStore([]), makeFwdStore([]));
      const res = await app.inject({
        method: 'GET',
        url: '/api/ui/track-record?competitionId=comp:apifootball:140',
      });
      const body = res.json<{ threshold: number }>();
      expect(body.threshold).toBe(200);
    });
  });
});
