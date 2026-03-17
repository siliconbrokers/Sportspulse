/**
 * v3-engine.test.ts — Tests del Motor Predictivo V3.
 *
 * Spec: SP-PRED-V3-Unified-Engine-Spec.md §20 (Invariantes) + §23 Fase 1
 *
 * Casos cubiertos:
 * 1. Determinismo
 * 2. NOT_ELIGIBLE con < THRESHOLD_NOT_ELIGIBLE partidos
 * 3. DC-correction: P(0-0) difiere de poissonPMF(lh,0)*poissonPMF(la,0)
 * 4. Venue split activo: ≥ MIN_GAMES_VENUE partidos en casa → venueSplit=true
 * 5. Venue split inactivo: < MIN_GAMES_VENUE en casa → venueSplit=false, HOME_ADVANTAGE_MULT aplicado
 * 6. Prior ausente: prevSeasonMatches=[] → prior_quality=LEAGUE_BASELINE, effective=attack_shrunk
 * 7. Recency neutro: games < MIN_GAMES_FOR_RECENCY → deltas = 1.0 (applied=false)
 * 8. Suma de probabilidades = 1 (tolerancia 1e-9)
 * 9. Lambda clipping: lambda forzada a extremo queda en [LAMBDA_MIN, LAMBDA_MAX]
 * 10. predicted_result null cuando TOO_CLOSE
 */

import { describe, it, expect } from 'vitest';
import {
  runV3Engine,
  computePoissonMatrix,
  computeEligibility,
  computeConfidence,
  computeRecencyDeltas,
  resolveTeamStats,
  computePredictedResult,
  THRESHOLD_NOT_ELIGIBLE,
  MIN_GAMES_VENUE,
  MIN_GAMES_FOR_RECENCY,
  HOME_ADVANTAGE_MULT,
  LAMBDA_MIN,
  LAMBDA_MAX,
  TOO_CLOSE_THRESHOLD,
  DC_RHO,
} from '../src/engine/v3/index.js';
import type { V3MatchRecord, V3EngineInput } from '../src/engine/v3/index.js';

// ── Helpers de fixtures ────────────────────────────────────────────────────

const KICKOFF = '2026-04-01T15:00:00Z';
const BUILD_NOW = '2026-04-01T10:00:00Z';
const HOME = 'team-home';
const AWAY = 'team-away';

/** Genera N partidos de historial para un equipo dado. */
function makeMatches(
  teamId: string,
  asHome: boolean,
  count: number,
  goalsScored: number,
  goalsConceded: number,
  baseDate: string = '2026-01-01T15:00:00Z',
): V3MatchRecord[] {
  const matches: V3MatchRecord[] = [];
  for (let i = 0; i < count; i++) {
    const date = new Date(new Date(baseDate).getTime() + i * 7 * 24 * 3600 * 1000).toISOString();
    matches.push(
      asHome
        ? {
            homeTeamId: teamId,
            awayTeamId: `opponent-${i}`,
            utcDate: date,
            homeGoals: goalsScored,
            awayGoals: goalsConceded,
          }
        : {
            homeTeamId: `opponent-${i}`,
            awayTeamId: teamId,
            utcDate: date,
            homeGoals: goalsConceded,
            awayGoals: goalsScored,
          },
    );
  }
  return matches;
}

/** Crea un input completo con N partidos de historial para cada equipo. */
function makeInput(
  homeGames: number,
  awayGames: number,
  opts: {
    homeGoals?: number;
    awayGoals?: number;
    prevSeasonMatches?: V3MatchRecord[];
  } = {},
): V3EngineInput {
  const { homeGoals = 2, awayGoals = 1, prevSeasonMatches = [] } = opts;

  // Mezclar partidos de local y visitante para los dos equipos
  const homeMatchesAsHome = makeMatches(HOME, true, Math.ceil(homeGames / 2), homeGoals, 0);
  const homeMatchesAsAway = makeMatches(HOME, false, Math.floor(homeGames / 2), homeGoals, 0);
  const awayMatchesAsAway = makeMatches(AWAY, false, Math.ceil(awayGames / 2), awayGoals, 0);
  const awayMatchesAsHome = makeMatches(AWAY, true, Math.floor(awayGames / 2), awayGoals, 0);

  // Combinar sin duplicados (equipos distintos en cada partido)
  const current = [
    ...homeMatchesAsHome,
    ...homeMatchesAsAway,
    ...awayMatchesAsAway,
    ...awayMatchesAsHome,
  ];

  return {
    homeTeamId: HOME,
    awayTeamId: AWAY,
    kickoffUtc: KICKOFF,
    buildNowUtc: BUILD_NOW,
    currentSeasonMatches: current,
    prevSeasonMatches,
  };
}

// ── Test 1: Determinismo ───────────────────────────────────────────────────

describe('V3 Engine — Determinismo', () => {
  it('mismo input produce exactamente el mismo output en dos llamadas', () => {
    const input = makeInput(15, 15);
    const out1 = runV3Engine(input);
    const out2 = runV3Engine(input);
    expect(out1).toEqual(out2);
  });

  it('engine_id es siempre v3_unified', () => {
    const input = makeInput(15, 15);
    const out = runV3Engine(input);
    expect(out.engine_id).toBe('v3_unified');
  });

  it('engine_version es siempre 3.0', () => {
    const input = makeInput(15, 15);
    const out = runV3Engine(input);
    expect(out.engine_version).toBe('3.0');
  });
});

// ── Test 2: NOT_ELIGIBLE ───────────────────────────────────────────────────

describe('V3 Engine — NOT_ELIGIBLE', () => {
  it(`equipo con ${THRESHOLD_NOT_ELIGIBLE - 1} partido → eligibility = NOT_ELIGIBLE`, () => {
    const input = makeInput(THRESHOLD_NOT_ELIGIBLE - 1, 10);
    const out = runV3Engine(input);
    expect(out.eligibility).toBe('NOT_ELIGIBLE');
  });

  it('NOT_ELIGIBLE → prob_home_win es null', () => {
    const input = makeInput(1, 10);
    const out = runV3Engine(input);
    expect(out.prob_home_win).toBeNull();
  });

  it('NOT_ELIGIBLE → prob_draw es null', () => {
    const input = makeInput(1, 10);
    const out = runV3Engine(input);
    expect(out.prob_draw).toBeNull();
  });

  it('NOT_ELIGIBLE → prob_away_win es null', () => {
    const input = makeInput(1, 10);
    const out = runV3Engine(input);
    expect(out.prob_away_win).toBeNull();
  });

  it('NOT_ELIGIBLE → lambda_home es null', () => {
    const input = makeInput(1, 10);
    const out = runV3Engine(input);
    expect(out.lambda_home).toBeNull();
  });

  it('NOT_ELIGIBLE → lambda_away es null', () => {
    const input = makeInput(1, 10);
    const out = runV3Engine(input);
    expect(out.lambda_away).toBeNull();
  });

  it('NOT_ELIGIBLE → predicted_result es null', () => {
    const input = makeInput(1, 10);
    const out = runV3Engine(input);
    expect(out.predicted_result).toBeNull();
  });

  it('NOT_ELIGIBLE → confidence = INSUFFICIENT', () => {
    const input = makeInput(1, 10);
    const out = runV3Engine(input);
    expect(out.confidence).toBe('INSUFFICIENT');
  });

  it('computeEligibility directo: 1 juego → NOT_ELIGIBLE', () => {
    expect(computeEligibility(1, 15)).toBe('NOT_ELIGIBLE');
  });

  it('computeEligibility directo: ambos por debajo → NOT_ELIGIBLE', () => {
    expect(computeEligibility(2, 2)).toBe('NOT_ELIGIBLE');
  });
});

// ── Test 3: DC-Correction ──────────────────────────────────────────────────

describe('V3 Engine — Dixon-Coles correction', () => {
  it('P(0-0) con DC-correction difiere de poissonPMF(lh,0)*poissonPMF(la,0)', () => {
    const lh = 1.5;
    const la = 1.2;
    const dcRho = DC_RHO; // -0.13

    // P(0-0) con DC = poissonPMF(lh,0) * poissonPMF(la,0) * tau(0,0,lh,la)
    // tau(0,0,lh,la) = 1 - lh * la * DC_RHO
    const poissonP00 = Math.exp(-lh) * Math.exp(-la); // = Math.exp(-(lh+la))
    const tau00 = 1 - lh * la * dcRho;
    const dcP00 = poissonP00 * tau00;

    expect(dcP00).not.toBeCloseTo(poissonP00, 10);
    expect(Math.abs(dcP00 - poissonP00)).toBeGreaterThan(1e-4);
  });

  it('tau(0,0) con DC_RHO=-0.13 amplifica P(0-0) cuando rho es negativo', () => {
    // tau(0,0) = 1 - lh * la * DC_RHO = 1 - 1.5 * 1.2 * (-0.13) = 1 + 0.234 = 1.234
    // Esto AUMENTA la probabilidad de 0-0
    const lh = 1.5;
    const la = 1.2;
    const tau = 1 - lh * la * DC_RHO;
    expect(tau).toBeGreaterThan(1.0);
  });

  it('computePoissonMatrix produce probs que suman 1', () => {
    const { prob_home_win, prob_draw, prob_away_win } = computePoissonMatrix(1.5, 1.1);
    const total = prob_home_win + prob_draw + prob_away_win;
    expect(Math.abs(total - 1.0)).toBeLessThan(1e-9);
  });
});

// ── Test 4: Venue split activo ─────────────────────────────────────────────

describe('V3 Engine — Venue split activo', () => {
  it(`equipo con ${MIN_GAMES_VENUE} partidos en casa usa stats de venue (venueSplit=true)`, () => {
    // Crear matches solo como local con MIN_GAMES_VENUE o más
    const matches = makeMatches(HOME, true, MIN_GAMES_VENUE + 1, 2, 0, '2025-08-01T15:00:00Z');
    const stats = resolveTeamStats(HOME, matches, BUILD_NOW, 'HOME');
    expect(stats.venueSplit).toBe(true);
    expect(stats.games).toBeGreaterThanOrEqual(MIN_GAMES_VENUE);
  });

  it('con venue split activo en ambos → home_advantage_applied = false', () => {
    // Necesitamos ≥ MIN_GAMES_VENUE partidos en cada venue para cada equipo
    const homeAsHomeMatches = makeMatches(
      HOME, true, MIN_GAMES_VENUE + 1, 2, 1, '2025-08-01T15:00:00Z',
    );
    const awayAsAwayMatches = makeMatches(
      AWAY, false, MIN_GAMES_VENUE + 1, 1, 2, '2025-08-15T15:00:00Z',
    );
    // Agregar también algunos partidos para el otro equipo para que no sea NOT_ELIGIBLE
    const homeAsAwayMatches = makeMatches(
      HOME, false, MIN_GAMES_VENUE, 1, 1, '2025-09-01T15:00:00Z',
    );
    const awayAsHomeMatches = makeMatches(
      AWAY, true, MIN_GAMES_VENUE, 1, 1, '2025-09-15T15:00:00Z',
    );

    const input: V3EngineInput = {
      homeTeamId: HOME,
      awayTeamId: AWAY,
      kickoffUtc: KICKOFF,
      buildNowUtc: BUILD_NOW,
      currentSeasonMatches: [
        ...homeAsHomeMatches,
        ...awayAsAwayMatches,
        ...homeAsAwayMatches,
        ...awayAsHomeMatches,
      ],
      prevSeasonMatches: [],
    };

    const out = runV3Engine(input);
    if (out.eligibility !== 'NOT_ELIGIBLE') {
      expect(out.explanation.venue_split_home).toBe(true);
      expect(out.explanation.venue_split_away).toBe(true);
      expect(out.explanation.home_advantage_applied).toBe(false);
    }
  });
});

// ── Test 5: Venue split inactivo ───────────────────────────────────────────

describe('V3 Engine — Venue split inactivo', () => {
  it(`equipo con < ${MIN_GAMES_VENUE} partidos en casa usa stats totales (venueSplit=false)`, () => {
    // Solo 3 partidos como local → menor que MIN_GAMES_VENUE=5
    const matches = makeMatches(HOME, true, MIN_GAMES_VENUE - 2, 2, 0, '2025-08-01T15:00:00Z');
    // Agregar partidos como visitante para tener suficientes totales
    const awayMatches = makeMatches(HOME, false, 8, 1, 1, '2025-09-01T15:00:00Z');
    const stats = resolveTeamStats(HOME, [...matches, ...awayMatches], BUILD_NOW, 'HOME');
    expect(stats.venueSplit).toBe(false);
  });

  it('sin venue split → HOME_ADVANTAGE_MULT aplicado → home_advantage_applied = true', () => {
    // Partidos mixtos pero pocos en venue específico
    const current: V3MatchRecord[] = [
      // HOME: 3 como local, 5 como visitante (no llega a MIN_GAMES_VENUE=5 en HOME)
      ...makeMatches(HOME, true, 3, 2, 1, '2025-08-01T15:00:00Z'),
      ...makeMatches(HOME, false, 5, 1, 2, '2025-09-01T15:00:00Z'),
      // AWAY: similar
      ...makeMatches(AWAY, false, 3, 1, 2, '2025-08-10T15:00:00Z'),
      ...makeMatches(AWAY, true, 5, 2, 1, '2025-09-10T15:00:00Z'),
    ];

    const input: V3EngineInput = {
      homeTeamId: HOME,
      awayTeamId: AWAY,
      kickoffUtc: KICKOFF,
      buildNowUtc: BUILD_NOW,
      currentSeasonMatches: current,
      prevSeasonMatches: [],
    };

    const out = runV3Engine(input);
    if (out.eligibility !== 'NOT_ELIGIBLE') {
      expect(out.explanation.home_advantage_applied).toBe(true);
    }
  });
});

// ── Test 6: Prior ausente ──────────────────────────────────────────────────

describe('V3 Engine — Prior ausente', () => {
  it('prevSeasonMatches=[] → prior_quality_home = LEAGUE_BASELINE', () => {
    const input = makeInput(10, 10, { prevSeasonMatches: [] });
    const out = runV3Engine(input);
    if (out.eligibility !== 'NOT_ELIGIBLE') {
      expect(out.explanation.prior_quality_home).toBe('LEAGUE_BASELINE');
    }
  });

  it('prevSeasonMatches=[] → prior_quality_away = LEAGUE_BASELINE', () => {
    const input = makeInput(10, 10, { prevSeasonMatches: [] });
    const out = runV3Engine(input);
    if (out.eligibility !== 'NOT_ELIGIBLE') {
      expect(out.explanation.prior_quality_away).toBe('LEAGUE_BASELINE');
    }
  });

  it('prevSeasonMatches=[] → warning NO_PRIOR incluido', () => {
    const input = makeInput(10, 10, { prevSeasonMatches: [] });
    const out = runV3Engine(input);
    if (out.eligibility !== 'NOT_ELIGIBLE') {
      expect(out.warnings).toContain('NO_PRIOR');
    }
  });
});

// ── Test 7: Recency neutro ─────────────────────────────────────────────────

describe('V3 Engine — Recency neutro', () => {
  it(`equipo con < ${MIN_GAMES_FOR_RECENCY} partidos → deltas = 1.0 (applied=false)`, () => {
    const signals = [
      { utcDate: '2026-01-01T15:00:00Z', attack_signal: 2.5, defense_signal: 0.8 },
      { utcDate: '2026-01-08T15:00:00Z', attack_signal: 1.5, defense_signal: 1.2 },
    ];
    // totalGames < MIN_GAMES_FOR_RECENCY
    const result = computeRecencyDeltas(signals, MIN_GAMES_FOR_RECENCY - 1, 1.5, 1.2);
    expect(result.delta_attack).toBe(1.0);
    expect(result.delta_defense).toBe(1.0);
    expect(result.applied).toBe(false);
  });

  it('con 0 señales → deltas = 1.0 (applied=false)', () => {
    const result = computeRecencyDeltas([], MIN_GAMES_FOR_RECENCY + 5, 1.5, 1.2);
    expect(result.delta_attack).toBe(1.0);
    expect(result.delta_defense).toBe(1.0);
    expect(result.applied).toBe(false);
  });

  it('con suficientes partidos y señales → applied=true', () => {
    const signals = Array.from({ length: 10 }, (_, i) => ({
      utcDate: new Date(new Date('2026-01-01T15:00:00Z').getTime() + i * 7 * 86400000).toISOString(),
      attack_signal: 1.5,
      defense_signal: 1.0,
    }));
    const result = computeRecencyDeltas(signals, MIN_GAMES_FOR_RECENCY + 2, 1.5, 1.0);
    expect(result.applied).toBe(true);
  });
});

// ── Test 8: Suma de probabilidades = 1 ────────────────────────────────────

describe('V3 Engine — Suma de probabilidades = 1', () => {
  it('prob_home + prob_draw + prob_away ≈ 1.0 (tolerancia 1e-9)', () => {
    const input = makeInput(15, 15);
    const out = runV3Engine(input);

    if (out.prob_home_win !== null && out.prob_draw !== null && out.prob_away_win !== null) {
      const sum = out.prob_home_win + out.prob_draw + out.prob_away_win;
      expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
    }
  });

  it('computePoissonMatrix suma = 1 con lambdas simétricas', () => {
    const { prob_home_win, prob_draw, prob_away_win } = computePoissonMatrix(1.3, 1.3);
    const sum = prob_home_win + prob_draw + prob_away_win;
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
  });

  it('computePoissonMatrix suma = 1 con lambdas asimétricas', () => {
    const { prob_home_win, prob_draw, prob_away_win } = computePoissonMatrix(2.5, 0.8);
    const sum = prob_home_win + prob_draw + prob_away_win;
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
  });

  it('computePoissonMatrix sumas con lambdas extremas (dentro de clip)', () => {
    const { prob_home_win, prob_draw, prob_away_win } = computePoissonMatrix(
      LAMBDA_MAX,
      LAMBDA_MIN,
    );
    const sum = prob_home_win + prob_draw + prob_away_win;
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
  });
});

// ── Test 9: Lambda clipping ────────────────────────────────────────────────

describe('V3 Engine — Lambda clipping', () => {
  it('lambda nunca excede LAMBDA_MAX', () => {
    const input = makeInput(20, 20, { homeGoals: 10 }); // goles absurdamente altos
    const out = runV3Engine(input);
    if (out.lambda_home !== null) {
      expect(out.lambda_home).toBeLessThanOrEqual(LAMBDA_MAX);
    }
    if (out.lambda_away !== null) {
      expect(out.lambda_away).toBeLessThanOrEqual(LAMBDA_MAX);
    }
  });

  it('lambda nunca es menor que LAMBDA_MIN', () => {
    const input = makeInput(20, 20, { homeGoals: 0, awayGoals: 0 }); // sin goles
    const out = runV3Engine(input);
    if (out.lambda_home !== null) {
      expect(out.lambda_home).toBeGreaterThanOrEqual(LAMBDA_MIN);
    }
    if (out.lambda_away !== null) {
      expect(out.lambda_away).toBeGreaterThanOrEqual(LAMBDA_MIN);
    }
  });

  it(`LAMBDA_MIN = ${LAMBDA_MIN}`, () => {
    expect(LAMBDA_MIN).toBe(0.3);
  });

  it(`LAMBDA_MAX = ${LAMBDA_MAX}`, () => {
    expect(LAMBDA_MAX).toBe(4.0);
  });
});

// ── Test 10: predicted_result null cuando TOO_CLOSE ───────────────────────

describe('V3 Engine — predicted_result null cuando TOO_CLOSE', () => {
  it('computePredictedResult: probs exactamente iguales → predicted_result null', () => {
    // 33.3% / 33.3% / 33.3% — diferencia es 0 < TOO_CLOSE_THRESHOLD
    const result = computePredictedResult(1 / 3, 1 / 3, 1 / 3);
    expect(result.predicted_result).toBeNull();
  });

  it('computePredictedResult: probs con diferencia justo bajo el umbral → null', () => {
    const delta = TOO_CLOSE_THRESHOLD - 0.001;
    const result = computePredictedResult(0.36 + delta / 2, 0.36, 0.28 - delta / 2);
    // La diferencia max−second debería ser < TOO_CLOSE_THRESHOLD
    if (result.favorite_margin < TOO_CLOSE_THRESHOLD) {
      expect(result.predicted_result).toBeNull();
    }
  });

  it('computePredictedResult: probs con diferencia sobre el umbral → no null', () => {
    // HOME gana claramente
    const result = computePredictedResult(0.60, 0.25, 0.15);
    expect(result.predicted_result).not.toBeNull();
    expect(result.predicted_result).toBe('HOME_WIN');
  });

  it('computePredictedResult: DRAW gana claramente', () => {
    const result = computePredictedResult(0.20, 0.60, 0.20);
    expect(result.predicted_result).toBe('DRAW');
  });

  it('computePredictedResult: AWAY_WIN claramente', () => {
    const result = computePredictedResult(0.15, 0.25, 0.60);
    expect(result.predicted_result).toBe('AWAY_WIN');
  });

  it('TOO_CLOSE_THRESHOLD es 0.05', () => {
    expect(TOO_CLOSE_THRESHOLD).toBe(0.05);
  });
});

// ── Constantes del spec §19 ────────────────────────────────────────────────

describe('V3 Constants — valores del spec §19', () => {
  it('DECAY_XI = 0.006', async () => {
    const { DECAY_XI } = await import('../src/engine/v3/constants.js');
    expect(DECAY_XI).toBe(0.006);
  });

  it('MIN_GAMES_VENUE = 5', async () => {
    const { MIN_GAMES_VENUE: v } = await import('../src/engine/v3/constants.js');
    expect(v).toBe(5);
  });

  it('K_SHRINK = 4', async () => {
    // Optimizado de 3→4 (backtest 2025-26 walk-forward: +1.3pp accuracy total)
    const { K_SHRINK } = await import('../src/engine/v3/constants.js');
    expect(K_SHRINK).toBe(4);
  });

  it('PRIOR_EQUIV_GAMES = 12', async () => {
    // Optimizado de 8→12 (más peso a temporada anterior mejora LaLiga +3pp y BL1 +2pp)
    const { PRIOR_EQUIV_GAMES } = await import('../src/engine/v3/constants.js');
    expect(PRIOR_EQUIV_GAMES).toBe(12);
  });

  it('HOME_ADVANTAGE_MULT = 1.12', () => {
    expect(HOME_ADVANTAGE_MULT).toBe(1.12);
  });

  it('DC_RHO = -0.13', () => {
    expect(DC_RHO).toBe(-0.13);
  });

  it('BETA_RECENT = 0.15', async () => {
    // Optimizado de 0.45→0.15 (reducir peso de recency mejora accuracy +1.3pp, reduces noise)
    const { BETA_RECENT } = await import('../src/engine/v3/constants.js');
    expect(BETA_RECENT).toBe(0.15);
  });
});

// ── Tests de integración adicionales ──────────────────────────────────────

describe('V3 Engine — Integración', () => {
  it('anti-lookahead: partido con utcDate >= kickoffUtc no se incluye en el cómputo', () => {
    // Agregar un partido futuro (después del kickoff) y verificar que no afecta el resultado
    const base = makeInput(15, 15);
    const futureMatch: V3MatchRecord = {
      homeTeamId: HOME,
      awayTeamId: AWAY,
      utcDate: '2026-04-02T15:00:00Z', // DESPUÉS del kickoff
      homeGoals: 99,
      awayGoals: 99,
    };
    const withFuture: V3EngineInput = {
      ...base,
      currentSeasonMatches: [...base.currentSeasonMatches, futureMatch],
    };

    const out1 = runV3Engine(base);
    const out2 = runV3Engine(withFuture);

    // El partido futuro no debería cambiar el output (anti-lookahead lo filtra)
    expect(out1.prob_home_win).toBeCloseTo(out2.prob_home_win ?? 0, 10);
    expect(out1.lambda_home).toBeCloseTo(out2.lambda_home ?? 0, 10);
  });

  it('equipo con suficientes datos → eligibility = ELIGIBLE', () => {
    const input = makeInput(15, 15);
    const out = runV3Engine(input);
    expect(out.eligibility).toBe('ELIGIBLE');
  });

  it('equipo con pocos datos pero suficientes → eligibility = LIMITED', () => {
    expect(computeEligibility(5, 5)).toBe('LIMITED');
  });

  it('computeConfidence con >= 20 juegos → HIGH', () => {
    expect(computeConfidence(20, 22, 'PREV_SEASON', 'PREV_SEASON')).toBe('HIGH');
  });

  it('computeConfidence con 7-11 y LEAGUE_BASELINE → LOW', () => {
    expect(computeConfidence(8, 9, 'LEAGUE_BASELINE', 'LEAGUE_BASELINE')).toBe('LOW');
  });

  it('computeConfidence: >= 20 juegos sin favoriteMargin → HIGH (backward-compat)', () => {
    // Parámetro opcional ausente: no debe cambiar comportamiento previo
    expect(computeConfidence(20, 22, 'PREV_SEASON', 'PREV_SEASON')).toBe('HIGH');
  });

  it('computeConfidence: >= 20 juegos con favoriteMargin < 0.12 → MEDIUM (margin downgrade)', () => {
    // Partido equilibrado: margen 0.10 < MARGIN_FOR_HIGH_CONFIDENCE → HIGH se degrada a MEDIUM
    expect(computeConfidence(20, 22, 'PREV_SEASON', 'PREV_SEASON', 0.10)).toBe('MEDIUM');
  });

  it('computeConfidence: >= 20 juegos con favoriteMargin >= 0.12 → HIGH', () => {
    // Margen suficiente: favorito claro → HIGH se mantiene
    expect(computeConfidence(20, 22, 'PREV_SEASON', 'PREV_SEASON', 0.15)).toBe('HIGH');
  });

  it('computeConfidence: 12-19 juegos con PREV_SEASON y favoriteMargin < 0.12 → MEDIUM', () => {
    // HIGH candidate (12-19 con PREV_SEASON) pero margen equilibrado → degrada a MEDIUM
    expect(computeConfidence(14, 16, 'PREV_SEASON', 'PREV_SEASON', 0.08)).toBe('MEDIUM');
  });

  it('pre_match_text no es null cuando ELIGIBLE', () => {
    const input = makeInput(15, 15);
    const out = runV3Engine(input);
    if (out.eligibility !== 'NOT_ELIGIBLE') {
      expect(out.pre_match_text).not.toBeNull();
      expect(typeof out.pre_match_text).toBe('string');
    }
  });

  it('explanation contiene games_home y games_away correctos', () => {
    const input = makeInput(10, 12);
    const out = runV3Engine(input);
    expect(out.explanation.games_home).toBe(10);
    expect(out.explanation.games_away).toBe(12);
  });

  it('dc_correction_applied = true cuando hay probs', () => {
    const input = makeInput(15, 15);
    const out = runV3Engine(input);
    if (out.eligibility !== 'NOT_ELIGIBLE') {
      expect(out.explanation.dc_correction_applied).toBe(true);
    }
  });
});
