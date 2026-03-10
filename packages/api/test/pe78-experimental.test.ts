/**
 * PE-78 Integration Tests — Experimental Prediction Endpoint
 *
 * Tests the six cases required by the stabilization gate:
 *   T0. Missing params → 400
 *   T1. Flag off → 404
 *   T2. Flag on, prediction available → 200 with correct data
 *   T3. Flag on, no prediction → 404
 *   T4. NOT_ELIGIBLE → reasons present, no probabilities
 *   T5. LIMITED_MODE → degradation notice fields present
 *   T6. FULL_MODE → probabilities present, no degradation reasons
 *
 * Plus: Cache-Control: no-store header, PredictionStore unit tests,
 * buildSnapshot helper tests.
 *
 * Spec authority: PE-78 rollout doc, experimental-route.ts, prediction-store.ts
 */

import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ── Mock prediction-flags before any imports that transitively use it ──────────

vi.mock('../../../server/prediction/prediction-flags.js', () => ({
  isExperimentalEnabled: vi.fn(),
  isShadowEnabled: vi.fn(),
  isInternalViewEnabled: vi.fn(),
}));

import { isExperimentalEnabled } from '../../../server/prediction/prediction-flags.js';
import {
  PredictionStore,
  buildSnapshot,
  type PredictionSnapshot,
} from '../../../server/prediction/prediction-store.js';
import { registerExperimentalPredictionRoute } from '../../../server/prediction/experimental-route.js';

// ── Typed mock helper ─────────────────────────────────────────────────────────

const mockIsExperimentalEnabled = isExperimentalEnabled as MockedFunction<
  typeof isExperimentalEnabled
>;

// ── Test data factories ───────────────────────────────────────────────────────

const MATCH_ID = 'match:football-data:544570';
const COMP_ID = 'comp:football-data:PD';

/** Full PredictionResponse for FULL_MODE */
function fullModeResponse() {
  return {
    eligibility_status: 'FULL_MODE',
    predictions: {
      core: {
        p_home_win: 0.45,
        p_draw: 0.27,
        p_away_win: 0.28,
        predicted_result: 'HOME_WIN',
        expected_goals_home: 1.8,
        expected_goals_away: 1.2,
      },
    },
    reasons: [],
    internals: { calibration_mode: 'calibrated' },
    data_integrity_flags: [],
  };
}

/** PredictionResponse for NOT_ELIGIBLE */
function notEligibleResponse() {
  return {
    eligibility_status: 'NOT_ELIGIBLE',
    predictions: null,
    reasons: ['INSUFFICIENT_HISTORY_AND_NO_UTILIZABLE_PRIOR_RATING'],
    internals: null,
    data_integrity_flags: [],
  };
}

/** PredictionResponse for LIMITED_MODE (1X2 nulled, xG available) */
function limitedModeResponse() {
  return {
    eligibility_status: 'LIMITED_MODE',
    predictions: {
      core: {
        p_home_win: null,
        p_draw: null,
        p_away_win: null,
        predicted_result: null,
        expected_goals_home: 1.6,
        expected_goals_away: 1.1,
      },
    },
    reasons: ['INSUFFICIENT_BILATERAL_HISTORY'],
    internals: { calibration_mode: 'bootstrap' },
    data_integrity_flags: [],
  };
}

/** Minimal MatchInput (not validated by the route) */
function minimalRequest() {
  return { schemaVersion: 1, match_id: MATCH_ID, competition_id: COMP_ID };
}

/** Creates a PredictionStore backed by a non-existent temp path (starts empty). */
function freshStore(): PredictionStore {
  return new PredictionStore({
    filePath: `/tmp/pe78-test-${Date.now()}-${Math.random()}.json`,
  });
}

/** Creates and initialises a Fastify instance with the experimental route. */
async function buildTestApp(store: PredictionStore): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerExperimentalPredictionRoute(app, store);
  await app.ready();
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// Route integration tests
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/ui/predictions/experimental', () => {
  let store: PredictionStore;
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    store = freshStore();
    app = await buildTestApp(store);
  });

  // ── T0. Missing params ─────────────────────────────────────────────────────

  it('T0a: returns 400 when both params are missing', async () => {
    mockIsExperimentalEnabled.mockReturnValue(true);

    const res = await app.inject({ method: 'GET', url: '/api/ui/predictions/experimental' });
    expect(res.statusCode).toBe(400);
  });

  it('T0b: returns 400 when matchId is missing', async () => {
    mockIsExperimentalEnabled.mockReturnValue(true);

    const res = await app.inject({
      method: 'GET',
      url: `/api/ui/predictions/experimental?competitionId=${COMP_ID}`,
    });
    expect(res.statusCode).toBe(400);
  });

  it('T0c: returns 400 when competitionId is missing', async () => {
    mockIsExperimentalEnabled.mockReturnValue(true);

    const res = await app.inject({
      method: 'GET',
      url: `/api/ui/predictions/experimental?matchId=${MATCH_ID}`,
    });
    expect(res.statusCode).toBe(400);
  });

  // ── T1. Flag off → 404 ────────────────────────────────────────────────────

  it('T1: returns 404 when experimental flag is off for competition', async () => {
    mockIsExperimentalEnabled.mockReturnValue(false);

    store.save(buildSnapshot(MATCH_ID, COMP_ID, minimalRequest(), fullModeResponse()));

    const res = await app.inject({
      method: 'GET',
      url: `/api/ui/predictions/experimental?matchId=${MATCH_ID}&competitionId=${COMP_ID}`,
    });

    expect(res.statusCode).toBe(404);
    // isExperimentalEnabled was called with the correct competition
    expect(mockIsExperimentalEnabled).toHaveBeenCalledWith(COMP_ID);
  });

  // ── T2. Flag on, prediction available ─────────────────────────────────────

  it('T2: returns 200 with correct shape when flag is on and prediction exists', async () => {
    mockIsExperimentalEnabled.mockReturnValue(true);

    const response = fullModeResponse();
    store.save(buildSnapshot(MATCH_ID, COMP_ID, minimalRequest(), response));

    const res = await app.inject({
      method: 'GET',
      url: `/api/ui/predictions/experimental?matchId=${MATCH_ID}&competitionId=${COMP_ID}`,
    });

    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.match_id).toBe(MATCH_ID);
    expect(body.competition_id).toBe(COMP_ID);
    expect(body.engine_version).toBe('1.3');
    expect(body.mode).toBe('FULL_MODE');
    expect(typeof body.generated_at).toBe('string');
  });

  // ── T3. Flag on, no prediction → 404 ──────────────────────────────────────

  it('T3: returns 404 when flag is on but no prediction exists for match', async () => {
    mockIsExperimentalEnabled.mockReturnValue(true);

    // store is empty — no snapshot for this match
    const res = await app.inject({
      method: 'GET',
      url: `/api/ui/predictions/experimental?matchId=${MATCH_ID}&competitionId=${COMP_ID}`,
    });

    expect(res.statusCode).toBe(404);
  });

  // ── T4. NOT_ELIGIBLE — reasons present, no probabilities ──────────────────

  it('T4: NOT_ELIGIBLE returns reasons and null probabilities', async () => {
    mockIsExperimentalEnabled.mockReturnValue(true);

    store.save(buildSnapshot(MATCH_ID, COMP_ID, minimalRequest(), notEligibleResponse()));

    const res = await app.inject({
      method: 'GET',
      url: `/api/ui/predictions/experimental?matchId=${MATCH_ID}&competitionId=${COMP_ID}`,
    });

    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.mode).toBe('NOT_ELIGIBLE');
    expect(body.reasons).toContain('INSUFFICIENT_HISTORY_AND_NO_UTILIZABLE_PRIOR_RATING');

    // No probabilities for NOT_ELIGIBLE
    expect(body.p_home_win).toBeNull();
    expect(body.p_draw).toBeNull();
    expect(body.p_away_win).toBeNull();
    expect(body.predicted_result).toBeNull();
    expect(body.expected_goals_home).toBeNull();
    expect(body.expected_goals_away).toBeNull();
  });

  // ── T5. LIMITED_MODE — degradation reason + available fields ──────────────

  it('T5: LIMITED_MODE returns degradation reason and available xG fields', async () => {
    mockIsExperimentalEnabled.mockReturnValue(true);

    store.save(buildSnapshot(MATCH_ID, COMP_ID, minimalRequest(), limitedModeResponse()));

    const res = await app.inject({
      method: 'GET',
      url: `/api/ui/predictions/experimental?matchId=${MATCH_ID}&competitionId=${COMP_ID}`,
    });

    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.mode).toBe('LIMITED_MODE');
    expect(body.reasons).toContain('INSUFFICIENT_BILATERAL_HISTORY');
    expect(body.calibration_mode).toBe('bootstrap');

    // 1X2 nulled in LIMITED_MODE
    expect(body.p_home_win).toBeNull();
    expect(body.p_draw).toBeNull();
    expect(body.p_away_win).toBeNull();

    // xG available in LIMITED_MODE
    expect(body.expected_goals_home).toBeCloseTo(1.6);
    expect(body.expected_goals_away).toBeCloseTo(1.1);
  });

  // ── T6. FULL_MODE — probabilities present, no degradation reasons ──────────

  it('T6: FULL_MODE returns all probabilities with no degradation reason', async () => {
    mockIsExperimentalEnabled.mockReturnValue(true);

    store.save(buildSnapshot(MATCH_ID, COMP_ID, minimalRequest(), fullModeResponse()));

    const res = await app.inject({
      method: 'GET',
      url: `/api/ui/predictions/experimental?matchId=${MATCH_ID}&competitionId=${COMP_ID}`,
    });

    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.mode).toBe('FULL_MODE');
    expect(body.reasons).toHaveLength(0);
    expect(body.calibration_mode).toBe('calibrated');

    expect(body.p_home_win).toBeCloseTo(0.45);
    expect(body.p_draw).toBeCloseTo(0.27);
    expect(body.p_away_win).toBeCloseTo(0.28);
    expect(body.predicted_result).toBe('HOME_WIN');
    expect(body.expected_goals_home).toBeCloseTo(1.8);
    expect(body.expected_goals_away).toBeCloseTo(1.2);
  });

  // ── Cache-Control header ───────────────────────────────────────────────────

  it('always responds with Cache-Control: no-store', async () => {
    mockIsExperimentalEnabled.mockReturnValue(true);

    store.save(buildSnapshot(MATCH_ID, COMP_ID, minimalRequest(), fullModeResponse()));

    const res = await app.inject({
      method: 'GET',
      url: `/api/ui/predictions/experimental?matchId=${MATCH_ID}&competitionId=${COMP_ID}`,
    });

    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('responds with Cache-Control: no-store even on 404', async () => {
    mockIsExperimentalEnabled.mockReturnValue(false);

    const res = await app.inject({
      method: 'GET',
      url: `/api/ui/predictions/experimental?matchId=${MATCH_ID}&competitionId=${COMP_ID}`,
    });

    expect(res.headers['cache-control']).toBe('no-store');
  });

  // ── Most recent snapshot wins ──────────────────────────────────────────────

  it('returns the most recent snapshot when multiple exist for same match', async () => {
    mockIsExperimentalEnabled.mockReturnValue(true);

    // Save older NOT_ELIGIBLE then newer FULL_MODE
    store.save(buildSnapshot(MATCH_ID, COMP_ID, minimalRequest(), notEligibleResponse()));
    // Small delay to ensure different generated_at
    await new Promise((r) => setTimeout(r, 2));
    store.save(buildSnapshot(MATCH_ID, COMP_ID, minimalRequest(), fullModeResponse()));

    const res = await app.inject({
      method: 'GET',
      url: `/api/ui/predictions/experimental?matchId=${MATCH_ID}&competitionId=${COMP_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.mode).toBe('FULL_MODE');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PredictionStore unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('PredictionStore', () => {
  it('starts empty when file does not exist', () => {
    const store = freshStore();
    expect(store.findAll()).toHaveLength(0);
  });

  it('save() appends a snapshot', () => {
    const store = freshStore();
    store.save(buildSnapshot(MATCH_ID, COMP_ID, {}, notEligibleResponse()));
    expect(store.findAll()).toHaveLength(1);
  });

  it('findByMatch() returns only snapshots for the requested match', () => {
    const store = freshStore();
    store.save(buildSnapshot(MATCH_ID, COMP_ID, {}, fullModeResponse()));
    store.save(buildSnapshot('match:football-data:999', COMP_ID, {}, notEligibleResponse()));

    const results = store.findByMatch(MATCH_ID);
    expect(results).toHaveLength(1);
    expect(results[0].match_id).toBe(MATCH_ID);
  });

  it('findByMatch() returns results sorted by generated_at descending', async () => {
    const store = freshStore();

    store.save(buildSnapshot(MATCH_ID, COMP_ID, {}, notEligibleResponse()));
    await new Promise((r) => setTimeout(r, 2));
    store.save(buildSnapshot(MATCH_ID, COMP_ID, {}, fullModeResponse()));

    const results = store.findByMatch(MATCH_ID);
    expect(results[0].mode).toBe('FULL_MODE');
    expect(results[1].mode).toBe('NOT_ELIGIBLE');
  });

  it('findByCompetition() filters by competitionId and respects limit', () => {
    const store = freshStore();
    store.save(buildSnapshot(MATCH_ID, COMP_ID, {}, fullModeResponse()));
    store.save(buildSnapshot('match:football-data:2', COMP_ID, {}, fullModeResponse()));
    store.save(
      buildSnapshot('match:football-data:3', 'comp:football-data:PL', {}, fullModeResponse()),
    );

    const pdResults = store.findByCompetition(COMP_ID);
    expect(pdResults).toHaveLength(2);

    const limited = store.findByCompetition(COMP_ID, 1);
    expect(limited).toHaveLength(1);
  });

  it('findAll() returns all snapshots with limit support', () => {
    const store = freshStore();
    store.save(buildSnapshot(MATCH_ID, COMP_ID, {}, fullModeResponse()));
    store.save(buildSnapshot('match:football-data:2', COMP_ID, {}, notEligibleResponse()));

    expect(store.findAll()).toHaveLength(2);
    expect(store.findAll(1)).toHaveLength(1);
  });

  it('saveError() records error snapshots with generation_status = error', () => {
    const store = freshStore();
    store.saveError(MATCH_ID, COMP_ID, new Error('engine crashed'));

    const results = store.findByMatch(MATCH_ID);
    expect(results).toHaveLength(1);
    expect(results[0].generation_status).toBe('error');
    expect(results[0].error_detail).toContain('engine crashed');
    expect(results[0].mode).toBe('ERROR');
  });

  it('saveError() handles non-Error objects', () => {
    const store = freshStore();
    store.saveError(MATCH_ID, COMP_ID, 'string error');

    const results = store.findByMatch(MATCH_ID);
    expect(results[0].error_detail).toBe('string error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildSnapshot helper tests
// ─────────────────────────────────────────────────────────────────────────────

describe('buildSnapshot', () => {
  it('sets engine_version and spec_version to 1.3', () => {
    const snap = buildSnapshot(MATCH_ID, COMP_ID, minimalRequest(), fullModeResponse());
    expect(snap.engine_version).toBe('1.3');
    expect(snap.spec_version).toBe('1.3');
  });

  it('extracts eligibility_status into mode', () => {
    const snap = buildSnapshot(MATCH_ID, COMP_ID, {}, notEligibleResponse());
    expect(snap.mode).toBe('NOT_ELIGIBLE');
  });

  it('extracts reasons_json as a valid JSON array', () => {
    const snap = buildSnapshot(MATCH_ID, COMP_ID, {}, notEligibleResponse());
    const parsed = JSON.parse(snap.reasons_json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toContain('INSUFFICIENT_HISTORY_AND_NO_UTILIZABLE_PRIOR_RATING');
  });

  it('extracts calibration_mode from internals', () => {
    const snap = buildSnapshot(MATCH_ID, COMP_ID, {}, fullModeResponse());
    expect(snap.calibration_mode).toBe('calibrated');
  });

  it('sets calibration_mode to null when internals is null', () => {
    const snap = buildSnapshot(MATCH_ID, COMP_ID, {}, notEligibleResponse());
    expect(snap.calibration_mode).toBeNull();
  });

  it('sets generation_status to ok', () => {
    const snap = buildSnapshot(MATCH_ID, COMP_ID, {}, fullModeResponse());
    expect(snap.generation_status).toBe('ok');
  });

  it('stores request and response as JSON strings', () => {
    const req = minimalRequest();
    const res = fullModeResponse();
    const snap = buildSnapshot(MATCH_ID, COMP_ID, req, res);

    expect(() => JSON.parse(snap.request_payload_json)).not.toThrow();
    expect(() => JSON.parse(snap.response_payload_json)).not.toThrow();

    const parsedReq = JSON.parse(snap.request_payload_json);
    expect(parsedReq.match_id).toBe(MATCH_ID);
  });

  it('unknown eligibility_status falls back to UNKNOWN', () => {
    const snap = buildSnapshot(MATCH_ID, COMP_ID, {}, { unexpected: true });
    expect(snap.mode).toBe('UNKNOWN');
  });
});
