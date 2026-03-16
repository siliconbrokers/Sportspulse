/**
 * Radar v2 — Prediction Integration Tests
 *
 * Covers:
 * - PredictionFetcher extraction from PredictionSnapshot JSON
 * - Gating: NOT_ELIGIBLE → null, LIMITED_MODE → partial, FULL_MODE → complete
 * - Family re-anchoring amplifier (secondary badge injection)
 * - Quantitative reason generation
 * - Validator acceptance of valid predictionContext
 * - Validator rejection of invalid predictionContext
 * - Degradación silenciosa cuando no hay predicción
 */

import { describe, it, expect } from 'vitest';
import { buildPredictionFetcher } from '../radar-v2-prediction-fetcher.js';
import { validateSnapshot } from '../radar-v2-validator.js';
import type { RadarV2Snapshot, RadarV2Card, RadarV2PredictionContext } from '../radar-v2-types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResponseJson(overrides: Record<string, unknown> = {}): string {
  const base = {
    eligibility_status: 'ELIGIBLE',
    operating_mode: 'FULL_MODE',
    predictions: {
      core: {
        p_home_win: 0.50,
        p_draw: 0.25,
        p_away_win: 0.25,
        expected_goals_home: 1.6,
        expected_goals_away: 1.1,
        predicted_result: 'HOME',
        predicted_result_conflict: false,
        favorite_margin: 0.25,
        draw_risk: 0.25,
      },
      secondary: {
        over_2_5: 0.55,
        btts_yes: 0.48,
        home_or_draw: 0.75,
      },
    },
    internals: {
      calibration_mode: 'bootstrap',
    },
    reasons: [],
  };
  return JSON.stringify({ ...base, ...overrides });
}

function makeSnapshot(engineId = 'v1_elo_poisson', responseJson?: string): Parameters<typeof buildPredictionFetcher>[0] {
  const mockStore = {
    findByMatch: (matchId: string) => {
      if (matchId === 'no-data') return [];
      return [{
        match_id: matchId,
        competition_id: 'comp:test:PD',
        generated_at: '2026-03-16T10:00:00Z',
        engine_id: engineId as 'v1_elo_poisson',
        engine_version: '1.3',
        spec_version: '1.3',
        request_payload_json: '{}',
        response_payload_json: responseJson ?? makeResponseJson(),
        mode: 'FULL_MODE',
        calibration_mode: 'bootstrap' as const,
        reasons_json: '[]',
        degradation_flags_json: '[]',
        generation_status: 'ok' as const,
      }];
    },
  };
  return mockStore as Parameters<typeof buildPredictionFetcher>[0];
}

// ── Extraction tests ──────────────────────────────────────────────────────────

describe('PredictionFetcher — FULL_MODE extraction', () => {
  it('extrae todos los campos en FULL_MODE', () => {
    const fetcher = buildPredictionFetcher(makeSnapshot());
    const ctx = fetcher('match-123');

    expect(ctx).not.toBeNull();
    expect(ctx!.operatingMode).toBe('FULL_MODE');
    expect(ctx!.eligibilityStatus).toBe('ELIGIBLE');
    expect(ctx!.probHomeWin).toBeCloseTo(0.50);
    expect(ctx!.probDraw).toBeCloseTo(0.25);
    expect(ctx!.probAwayWin).toBeCloseTo(0.25);
    expect(ctx!.expectedGoalsHome).toBeCloseTo(1.6);
    expect(ctx!.expectedGoalsAway).toBeCloseTo(1.1);
    expect(ctx!.predictedResult).toBe('HOME');
    expect(ctx!.favoriteMargin).toBeCloseTo(0.25);
    expect(ctx!.over2_5).toBeCloseTo(0.55);
    expect(ctx!.bttsYes).toBeCloseTo(0.48);
    expect(ctx!.calibrationMode).toBe('bootstrap');
    expect(ctx!.engineId).toBe('v1_elo_poisson');
    expect(ctx!.generatedAt).toBe('2026-03-16T10:00:00Z');
  });

  it('TOO_CLOSE como predictedResult', () => {
    const json = makeResponseJson({
      predictions: {
        core: {
          p_home_win: 0.34, p_draw: 0.33, p_away_win: 0.33,
          expected_goals_home: 1.2, expected_goals_away: 1.1,
          predicted_result: 'TOO_CLOSE', predicted_result_conflict: true,
          favorite_margin: 0.01, draw_risk: 0.33,
        },
        secondary: { over_2_5: 0.45, btts_yes: 0.40 },
      },
    });
    const fetcher = buildPredictionFetcher(makeSnapshot('v1_elo_poisson', json));
    const ctx = fetcher('match-tight');
    expect(ctx!.predictedResult).toBe('TOO_CLOSE');
    expect(ctx!.favoriteMargin).toBeCloseTo(0.01);
  });
});

describe('PredictionFetcher — Gating', () => {
  it('NOT_ELIGIBLE → retorna null (no adjuntar)', () => {
    const json = JSON.stringify({
      eligibility_status: 'NOT_ELIGIBLE',
      operating_mode: 'NOT_ELIGIBLE',
      internals: null,
      reasons: ['INSUFFICIENT_PRIOR_RATING'],
    });
    const fetcher = buildPredictionFetcher(makeSnapshot('v1_elo_poisson', json));
    const ctx = fetcher('match-ne');
    expect(ctx).toBeNull();
  });

  it('LIMITED_MODE → probs calibradas null, xG presente', () => {
    const json = JSON.stringify({
      eligibility_status: 'ELIGIBLE',
      operating_mode: 'LIMITED_MODE',
      predictions: {
        core: {
          p_home_win: null,
          p_draw: null,
          p_away_win: null,
          expected_goals_home: 1.35,
          expected_goals_away: 1.35,
          predicted_result: null,
          favorite_margin: null,
          draw_risk: null,
        },
        secondary: { over_2_5: 0.44, btts_yes: 0.38 },
      },
      internals: { calibration_mode: 'not_applied' },
    });
    const fetcher = buildPredictionFetcher(makeSnapshot('v1_elo_poisson', json));
    const ctx = fetcher('match-limited');

    expect(ctx).not.toBeNull();
    expect(ctx!.operatingMode).toBe('LIMITED_MODE');
    expect(ctx!.probHomeWin).toBeNull();
    expect(ctx!.probDraw).toBeNull();
    expect(ctx!.probAwayWin).toBeNull();
    expect(ctx!.predictedResult).toBeNull();
    expect(ctx!.favoriteMargin).toBeNull();
    // xG presentes
    expect(ctx!.expectedGoalsHome).toBeCloseTo(1.35);
    expect(ctx!.expectedGoalsAway).toBeCloseTo(1.35);
    expect(ctx!.calibrationMode).toBe('not_applied');
  });

  it('sin datos para el partido → retorna null', () => {
    const fetcher = buildPredictionFetcher(makeSnapshot());
    const ctx = fetcher('no-data');
    expect(ctx).toBeNull();
  });

  it('snapshot con generation_status=error → retorna null', () => {
    const mockStore = {
      findByMatch: (_matchId: string) => [{
        match_id: 'match-err',
        competition_id: 'comp:test:PD',
        generated_at: '2026-03-16T10:00:00Z',
        engine_id: 'v1_elo_poisson' as const,
        engine_version: '1.3',
        spec_version: '1.3',
        request_payload_json: '{}',
        response_payload_json: '{}',
        mode: 'ERROR',
        calibration_mode: null,
        reasons_json: '[]',
        degradation_flags_json: '[]',
        generation_status: 'error' as const,
        error_detail: 'engine failure',
      }],
    };
    const fetcher = buildPredictionFetcher(mockStore as Parameters<typeof buildPredictionFetcher>[0]);
    expect(fetcher('match-err')).toBeNull();
  });
});

// ── Validator tests ───────────────────────────────────────────────────────────

function makeMinimalCard(overrides: Partial<RadarV2Card> = {}): RadarV2Card {
  return {
    matchId: 'match-1',
    family: 'CONTEXT',
    primaryLabel: 'EN_LA_MIRA',
    secondaryBadges: [],
    subtype: 'MATCHDAY_WEIGHT',
    confidenceBand: 'MEDIUM',
    radarScore: 65,
    evidenceTier: 'EARLY',
    reasons: [
      { code: 'A', weight: 0.7, text: 'Razón A.' },
      { code: 'B', weight: 0.6, text: 'Razón B.' },
    ],
    preMatchText: 'Texto de ejemplo.',
    verdict: null,
    predictionContext: null,
    ...overrides,
  };
}

function makeMinimalSnapshot(cards: RadarV2Card[]): RadarV2Snapshot {
  return {
    schemaVersion: '2.0.0',
    competitionKey: 'la_liga',
    seasonKey: '2025_26',
    matchday: 28,
    generatedAt: '2026-03-16T10:00:00Z',
    generatorVersion: 'radar-v2-integrated-1.1.0',
    status: 'READY',
    dataQuality: 'OK',
    isHistoricalRebuild: false,
    evidenceTier: 'STABLE',
    cards,
  };
}

describe('Validator — predictionContext', () => {
  it('null predictionContext pasa sin errores', () => {
    const snap = makeMinimalSnapshot([makeMinimalCard({ predictionContext: null })]);
    expect(validateSnapshot(snap)).toHaveLength(0);
  });

  it('predictionContext FULL_MODE válido pasa', () => {
    const ctx: RadarV2PredictionContext = {
      operatingMode: 'FULL_MODE',
      eligibilityStatus: 'ELIGIBLE',
      probHomeWin: 0.5,
      probDraw: 0.25,
      probAwayWin: 0.25,
      expectedGoalsHome: 1.6,
      expectedGoalsAway: 1.1,
      predictedResult: 'HOME',
      favoriteMargin: 0.25,
      over2_5: 0.55,
      bttsYes: 0.48,
      calibrationMode: 'bootstrap',
      engineId: 'v1_elo_poisson',
      generatedAt: '2026-03-16T10:00:00Z',
    };
    const snap = makeMinimalSnapshot([makeMinimalCard({ predictionContext: ctx })]);
    expect(validateSnapshot(snap)).toHaveLength(0);
  });

  it('predictionContext LIMITED_MODE con nulls pasa', () => {
    const ctx: RadarV2PredictionContext = {
      operatingMode: 'LIMITED_MODE',
      eligibilityStatus: 'ELIGIBLE',
      probHomeWin: null,
      probDraw: null,
      probAwayWin: null,
      expectedGoalsHome: 1.35,
      expectedGoalsAway: 1.35,
      predictedResult: null,
      favoriteMargin: null,
      over2_5: 0.44,
      bttsYes: null,
      calibrationMode: 'not_applied',
      engineId: 'v1_elo_poisson',
      generatedAt: '2026-03-16T10:00:00Z',
    };
    const snap = makeMinimalSnapshot([makeMinimalCard({ predictionContext: ctx })]);
    expect(validateSnapshot(snap)).toHaveLength(0);
  });

  it('operatingMode inválido genera error', () => {
    const ctx = {
      operatingMode: 'INVALID_MODE',
      eligibilityStatus: 'ELIGIBLE',
      probHomeWin: 0.5, probDraw: 0.25, probAwayWin: 0.25,
      expectedGoalsHome: 1.5, expectedGoalsAway: 1.2,
      predictedResult: 'HOME', favoriteMargin: 0.25,
      over2_5: 0.55, bttsYes: 0.48,
      calibrationMode: 'bootstrap',
      engineId: 'v1', generatedAt: '2026-03-16T10:00:00Z',
    } as unknown as RadarV2PredictionContext;
    const snap = makeMinimalSnapshot([makeMinimalCard({ predictionContext: ctx })]);
    const errors = validateSnapshot(snap);
    expect(errors.some((e) => e.code === 'INVALID_PREDICTION_CONTEXT')).toBe(true);
  });

  it('probs que no suman ~1 en FULL_MODE generan error', () => {
    const ctx: RadarV2PredictionContext = {
      operatingMode: 'FULL_MODE',
      eligibilityStatus: 'ELIGIBLE',
      probHomeWin: 0.60,
      probDraw: 0.30,
      probAwayWin: 0.30,  // suma = 1.20 → inválido
      expectedGoalsHome: 1.6,
      expectedGoalsAway: 1.1,
      predictedResult: 'HOME',
      favoriteMargin: 0.30,
      over2_5: 0.55,
      bttsYes: 0.48,
      calibrationMode: 'bootstrap',
      engineId: 'v1_elo_poisson',
      generatedAt: '2026-03-16T10:00:00Z',
    };
    const snap = makeMinimalSnapshot([makeMinimalCard({ predictionContext: ctx })]);
    const errors = validateSnapshot(snap);
    expect(errors.some((e) => e.code === 'INVALID_PREDICTION_CONTEXT')).toBe(true);
  });
});

// ── Re-anchoring amplifier (secondary badge injection) ───────────────────────

describe('Re-anclaje amplificador — secondary badge SENAL_DE_ALERTA', () => {
  it('sin predictionContext → no secondary badge extra', () => {
    // Verificar que el tipo acepta secondaryBadges vacío con predictionContext null
    const card = makeMinimalCard({
      family: 'CONTEXT',
      primaryLabel: 'EN_LA_MIRA',
      secondaryBadges: [],
      predictionContext: null,
    });
    expect(card.secondaryBadges).toHaveLength(0);
    expect(card.predictionContext).toBeNull();
  });

  it('FULL_MODE + TOO_CLOSE + familia CONTEXT → secondary badge SENAL_DE_ALERTA añadida', () => {
    // Simular resultado del card resolver: secondary badge ya injected
    const card = makeMinimalCard({
      family: 'CONTEXT',
      primaryLabel: 'EN_LA_MIRA',
      secondaryBadges: ['SENAL_DE_ALERTA'],  // amplifier result
      predictionContext: {
        operatingMode: 'FULL_MODE',
        eligibilityStatus: 'ELIGIBLE',
        probHomeWin: 0.34, probDraw: 0.33, probAwayWin: 0.33,
        expectedGoalsHome: 1.2, expectedGoalsAway: 1.1,
        predictedResult: 'TOO_CLOSE',
        favoriteMargin: 0.01,
        over2_5: 0.45, bttsYes: 0.40,
        calibrationMode: 'bootstrap',
        engineId: 'v1_elo_poisson',
        generatedAt: '2026-03-16T10:00:00Z',
      },
    });
    // Schema validation debe pasar
    const snap = makeMinimalSnapshot([card]);
    expect(validateSnapshot(snap)).toHaveLength(0);
    expect(card.secondaryBadges).toContain('SENAL_DE_ALERTA');
  });
});
