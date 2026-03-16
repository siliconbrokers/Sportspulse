/**
 * Tests para dc-rho-estimator.ts
 *
 * Invariantes verificados:
 * 1. Fallback a DC_RHO si hay < MIN_MATCHES (20) partidos
 * 2. Resultado siempre en [-0.25, 0.0]
 * 3. Liga con muchos 0-0 y 1-1 → ρ más negativo que liga con distribución uniforme
 * 4. Liga con solo resultados altos → ρ ≈ 0 (datos de low-score insuficientes → fallback)
 * 5. Determinismo: misma entrada → mismo resultado
 */

import { describe, it, expect } from 'vitest';
import { estimateDcRho } from '../../src/engine/v3/dc-rho-estimator.js';
import { DC_RHO } from '../../src/engine/v3/constants.js';
import type { V3MatchRecord, LeagueBaselines } from '../../src/engine/v3/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const BASELINES: LeagueBaselines = {
  league_home_goals_pg: 1.45,
  league_away_goals_pg: 1.15,
  league_goals_pg: 1.30,
};

function makeMatch(h: number, a: number, daysAgo = 30): V3MatchRecord {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  return {
    homeTeamId: 'T1',
    awayTeamId: 'T2',
    utcDate: d.toISOString(),
    homeGoals: h,
    awayGoals: a,
  };
}

/** Genera N partidos con el score indicado. */
function makeNMatches(h: number, a: number, n: number): V3MatchRecord[] {
  return Array.from({ length: n }, (_, i) => makeMatch(h, a, i + 1));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('estimateDcRho — fallback por datos insuficientes', () => {
  it('retorna DC_RHO si hay 0 partidos', () => {
    expect(estimateDcRho([], BASELINES)).toBe(DC_RHO);
  });

  it('retorna DC_RHO si hay < 20 partidos', () => {
    const matches = makeNMatches(1, 0, 19);
    expect(estimateDcRho(matches, BASELINES)).toBe(DC_RHO);
  });

  it('intenta estimar con exactamente 20 partidos (frontera del threshold)', () => {
    const matches = makeNMatches(0, 0, 20);
    const rho = estimateDcRho(matches, BASELINES);
    // No necesariamente es DC_RHO — el estimador tiene suficientes datos
    expect(typeof rho).toBe('number');
    expect(rho).toBeGreaterThanOrEqual(-0.25);
    expect(rho).toBeLessThanOrEqual(0.0);
  });
});

describe('estimateDcRho — rango de resultado', () => {
  it('resultado siempre en [-0.25, 0.0] con datos mixtos', () => {
    const matches = [
      ...makeNMatches(0, 0, 10),
      ...makeNMatches(0, 1, 5),
      ...makeNMatches(1, 0, 5),
      ...makeNMatches(1, 1, 5),
      ...makeNMatches(2, 1, 5),
      ...makeNMatches(1, 2, 5),
    ];
    const rho = estimateDcRho(matches, BASELINES);
    expect(rho).toBeGreaterThanOrEqual(-0.25);
    expect(rho).toBeLessThanOrEqual(0.0);
  });

  it('resultado siempre en [-0.25, 0.0] con muchos 0-0', () => {
    const matches = [
      ...makeNMatches(0, 0, 30),
      ...makeNMatches(2, 1, 10),
    ];
    const rho = estimateDcRho(matches, BASELINES);
    expect(rho).toBeGreaterThanOrEqual(-0.25);
    expect(rho).toBeLessThanOrEqual(0.0);
  });
});

describe('estimateDcRho — sensibilidad a la distribución de scores bajos', () => {
  it('liga con muchos 0-0 y 1-1 → ρ más negativo que liga sin patrón de scores bajos', () => {
    // Liga con sobrerepresentación de 0-0 y 1-1 (patrón DC)
    const highCorrelationLeague = [
      ...makeNMatches(0, 0, 15),
      ...makeNMatches(1, 1, 10),
      ...makeNMatches(2, 1, 10),
      ...makeNMatches(1, 2, 5),
    ];

    // Liga con distribución uniforme de scores bajos (sin patrón DC)
    const uniformLeague = [
      ...makeNMatches(0, 0, 5),
      ...makeNMatches(0, 1, 10),
      ...makeNMatches(1, 0, 10),
      ...makeNMatches(1, 1, 5),
      ...makeNMatches(2, 1, 10),
    ];

    const rhoCorrelated = estimateDcRho(highCorrelationLeague, BASELINES);
    const rhoUniform    = estimateDcRho(uniformLeague, BASELINES);

    // Liga con más 0-0 y 1-1 debe tener ρ más negativo (o igual si ambos tocan el límite)
    expect(rhoCorrelated).toBeLessThanOrEqual(rhoUniform);
  });

  it('solo partidos de score alto (>1 goles) → ρ = DC_RHO (datos de low-score ausentes)', () => {
    // Con solo scores altos, lowScoreMatches.length = 0 → fallback a DC_RHO
    const matches = makeNMatches(3, 2, 25);
    expect(estimateDcRho(matches, BASELINES)).toBe(DC_RHO);
  });
});

describe('estimateDcRho — determinismo', () => {
  it('misma entrada produce el mismo resultado en múltiples llamadas', () => {
    const matches = [
      ...makeNMatches(0, 0, 12),
      ...makeNMatches(1, 1, 8),
      ...makeNMatches(2, 1, 10),
    ];
    const r1 = estimateDcRho(matches, BASELINES);
    const r2 = estimateDcRho(matches, BASELINES);
    const r3 = estimateDcRho(matches, BASELINES);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
  });
});

describe('estimateDcRho — resolución del grid', () => {
  it('resultado es múltiplo de 0.01 (grid step)', () => {
    const matches = [
      ...makeNMatches(0, 0, 15),
      ...makeNMatches(1, 0, 5),
      ...makeNMatches(2, 1, 10),
    ];
    const rho = estimateDcRho(matches, BASELINES);
    // Debe ser un múltiplo exacto de 0.01 (sin drift de FP)
    expect(Math.abs(Math.round(rho * 100) - rho * 100)).toBeLessThan(1e-8);
  });
});
