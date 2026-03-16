/**
 * Tests para los módulos Tier 2: rest-adjustment, h2h-adjustment, goal-form.
 *
 * Invariantes verificados por módulo:
 *
 * rest-adjustment:
 *   1. < 4 días → REST_MULT_SEVERE (0.92)
 *   2. 4–5 días → REST_MULT_MILD (0.97)
 *   3. 6–8 días → 1.00
 *   4. 9–14 días → REST_MULT_OPTIMAL (1.03)
 *   5. > 14 días → 1.00
 *   6. null → 1.00
 *   7. daysToLastMatch: retorna null si no hay partidos anteriores
 *   8. daysToLastMatch: calcula correctamente los días
 *
 * h2h-adjustment:
 *   9.  < H2H_MIN_MATCHES → not applied, mult = 1.0
 *  10.  ≥ H2H_MIN_MATCHES → applied = true
 *  11.  mult clamp: nunca fuera de [H2H_MULT_MIN, H2H_MULT_MAX]
 *  12.  equipo que siempre anota más de lo esperado → mult > 1.0
 *  13.  equipo que nunca anota → mult < 1.0
 *  14.  partido perfectamente promedio → mult ≈ 1.0 (cerca por shrinkage)
 *
 * goal-form:
 *  15.  sin partidos → todos los campos = 0, n_matches = 0
 *  16.  equipo que siempre anota → scoring_rate = 1.0
 *  17.  equipo que nunca concede → clean_sheet_rate = 1.0
 *  18.  goals_scored_form ≈ promedio de goles anotados (con decay)
 *  19.  n_matches ≤ GOAL_FORM_WINDOW
 *  20.  clean_sheet_rate ∈ [0, 1], scoring_rate ∈ [0, 1]
 */

import { describe, it, expect } from 'vitest';
import {
  daysToLastMatch,
  restMultiplier,
  REST_MULT_SEVERE,
  REST_MULT_MILD,
  REST_MULT_OPTIMAL,
} from '../../src/engine/v3/rest-adjustment.js';
import {
  computeH2HAdjustment,
  H2H_MIN_MATCHES,
  H2H_MULT_MIN,
  H2H_MULT_MAX,
} from '../../src/engine/v3/h2h-adjustment.js';
import {
  computeGoalForm,
  GOAL_FORM_WINDOW,
} from '../../src/engine/v3/goal-form.js';
import type { V3MatchRecord, LeagueBaselines } from '../../src/engine/v3/types.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const BASELINES: LeagueBaselines = {
  league_home_goals_pg: 1.45,
  league_away_goals_pg: 1.15,
  league_goals_pg: 1.30,
};

function makeMatch(
  home: string,
  away: string,
  daysAgo: number,
  hg: number,
  ag: number,
  anchor = '2026-04-01T15:00:00Z',
): V3MatchRecord {
  const ms = new Date(anchor).getTime() - daysAgo * 86_400_000;
  return { homeTeamId: home, awayTeamId: away, utcDate: new Date(ms).toISOString(), homeGoals: hg, awayGoals: ag };
}

// ── restMultiplier ─────────────────────────────────────────────────────────────

describe('restMultiplier', () => {
  it('null → 1.0', () => { expect(restMultiplier(null)).toBe(1.0); });
  it('< 4 días → REST_MULT_SEVERE', () => {
    expect(restMultiplier(0)).toBe(REST_MULT_SEVERE);
    expect(restMultiplier(2)).toBe(REST_MULT_SEVERE);
    expect(restMultiplier(3.9)).toBe(REST_MULT_SEVERE);
  });
  it('4 días → REST_MULT_MILD', () => { expect(restMultiplier(4)).toBe(REST_MULT_MILD); });
  it('5 días → REST_MULT_MILD', () => { expect(restMultiplier(5.9)).toBe(REST_MULT_MILD); });
  it('6 días → 1.0', () => { expect(restMultiplier(6)).toBe(1.0); });
  it('8 días → 1.0', () => { expect(restMultiplier(8)).toBe(1.0); });
  it('9 días → REST_MULT_OPTIMAL', () => { expect(restMultiplier(9)).toBe(REST_MULT_OPTIMAL); });
  it('14 días → REST_MULT_OPTIMAL', () => { expect(restMultiplier(14)).toBe(REST_MULT_OPTIMAL); });
  it('15 días → 1.0 (ritmo perdido)', () => { expect(restMultiplier(15)).toBe(1.0); });
  it('30 días → 1.0', () => { expect(restMultiplier(30)).toBe(1.0); });
});

// ── daysToLastMatch ────────────────────────────────────────────────────────────

describe('daysToLastMatch', () => {
  const ANCHOR = '2026-04-01T15:00:00Z';

  it('sin partidos → null', () => {
    expect(daysToLastMatch('T1', [], ANCHOR)).toBeNull();
  });

  it('retorna null si todos los partidos son después del kickoff', () => {
    const future = makeMatch('T1', 'T2', -5, 1, 0, ANCHOR); // 5 días DESPUÉS del anchor
    expect(daysToLastMatch('T1', [future], ANCHOR)).toBeNull();
  });

  it('calcula correctamente ~7 días', () => {
    const m = makeMatch('T1', 'T2', 7, 1, 0, ANCHOR);
    const days = daysToLastMatch('T1', [m], ANCHOR);
    expect(days).not.toBeNull();
    expect(days!).toBeCloseTo(7, 1);
  });

  it('retorna el partido MÁS RECIENTE (no el más antiguo)', () => {
    const old  = makeMatch('T1', 'T2', 14, 1, 0, ANCHOR);
    const recent = makeMatch('T1', 'T3', 3, 2, 1, ANCHOR);
    const days = daysToLastMatch('T1', [old, recent], ANCHOR);
    expect(days!).toBeCloseTo(3, 1);
  });

  it('funciona cuando el equipo es visitante', () => {
    const m = makeMatch('T2', 'T1', 5, 0, 1, ANCHOR);
    const days = daysToLastMatch('T1', [m], ANCHOR);
    expect(days!).toBeCloseTo(5, 1);
  });
});

// ── computeH2HAdjustment ──────────────────────────────────────────────────────

describe('computeH2HAdjustment', () => {
  const H = 'home-team';
  const A = 'away-team';
  const ANCHOR = '2026-04-01T15:00:00Z';

  function h2hMatch(homeId: string, awayId: string, daysAgo: number, hg: number, ag: number) {
    return makeMatch(homeId, awayId, daysAgo, hg, ag, ANCHOR);
  }

  it('< H2H_MIN_MATCHES → not applied, mult = 1.0', () => {
    const matches = [h2hMatch(H, A, 30, 2, 1), h2hMatch(A, H, 60, 1, 1)];
    const result = computeH2HAdjustment(H, A, matches, [], BASELINES);
    expect(result.applied).toBe(false);
    expect(result.mult_home).toBe(1.0);
    expect(result.mult_away).toBe(1.0);
    expect(result.n_matches).toBe(2);
  });

  it(`≥ ${H2H_MIN_MATCHES} partidos → applied = true`, () => {
    const matches = [
      h2hMatch(H, A, 10, 2, 1),
      h2hMatch(A, H, 20, 1, 1),
      h2hMatch(H, A, 30, 2, 0),
    ];
    const result = computeH2HAdjustment(H, A, matches, [], BASELINES);
    expect(result.applied).toBe(true);
  });

  it('mult siempre en [H2H_MULT_MIN, H2H_MULT_MAX]', () => {
    // H siempre marca muchísimos goles
    const matches = Array.from({ length: 5 }, (_, i) =>
      h2hMatch(H, A, (i + 1) * 10, 10, 0),
    );
    const result = computeH2HAdjustment(H, A, matches, [], BASELINES);
    expect(result.mult_home).toBeGreaterThanOrEqual(H2H_MULT_MIN);
    expect(result.mult_home).toBeLessThanOrEqual(H2H_MULT_MAX);
    expect(result.mult_away).toBeGreaterThanOrEqual(H2H_MULT_MIN);
    expect(result.mult_away).toBeLessThanOrEqual(H2H_MULT_MAX);
  });

  it('H siempre supera expectativa → mult_home > 1.0', () => {
    // league_home_goals_pg = 1.45, H marca 3 cuando es local
    const matches = [
      h2hMatch(H, A, 10, 3, 0),
      h2hMatch(H, A, 20, 3, 0),
      h2hMatch(H, A, 30, 3, 0),
    ];
    const result = computeH2HAdjustment(H, A, matches, [], BASELINES);
    expect(result.mult_home).toBeGreaterThan(1.0);
  });

  it('H nunca anota → mult_home < 1.0', () => {
    const matches = [
      h2hMatch(H, A, 10, 0, 2),
      h2hMatch(H, A, 20, 0, 1),
      h2hMatch(H, A, 30, 0, 2),
    ];
    const result = computeH2HAdjustment(H, A, matches, [], BASELINES);
    expect(result.mult_home).toBeLessThan(1.0);
  });

  it('matches exactamente en la media → mult ≈ 1.0 (ajustado por shrinkage)', () => {
    // league_home_goals_pg = 1.45 → marcar 1.45 exactamente es "promedio"
    // Con shrinkage, se acercará a 1.0 pero no será exactamente 1.0
    const matches = [
      h2hMatch(H, A, 10, 1, 1), // ~1 gol, cercano a 1.45 pero no exacto
      h2hMatch(H, A, 20, 2, 1),
      h2hMatch(H, A, 30, 1, 1),
    ];
    const result = computeH2HAdjustment(H, A, matches, [], BASELINES);
    // Con 3 partidos y shrinkage de 8, el ajuste es pequeño
    expect(result.mult_home).toBeGreaterThan(0.92);
    expect(result.mult_home).toBeLessThan(1.08);
  });

  it('ignora partidos que no son H2H entre H y A', () => {
    const h2h = [
      h2hMatch(H, A, 10, 2, 1),
      h2hMatch(H, A, 20, 2, 0),
      h2hMatch(H, A, 30, 1, 1),
    ];
    const noise = [
      makeMatch('X', 'Y', 15, 3, 0, ANCHOR),
      makeMatch(H, 'Z', 25, 2, 1, ANCHOR),
    ];
    const resultWith = computeH2HAdjustment(H, A, [...h2h, ...noise], [], BASELINES);
    const resultWithout = computeH2HAdjustment(H, A, h2h, [], BASELINES);
    expect(resultWith.mult_home).toBeCloseTo(resultWithout.mult_home, 10);
  });
});

// ── computeGoalForm ───────────────────────────────────────────────────────────

describe('computeGoalForm', () => {
  const T = 'team-X';
  const ANCHOR = '2026-04-01T15:00:00Z';

  it('sin partidos → todo 0, n_matches = 0', () => {
    const gf = computeGoalForm(T, [], ANCHOR);
    expect(gf.goals_scored_form).toBe(0);
    expect(gf.goals_conceded_form).toBe(0);
    expect(gf.clean_sheet_rate).toBe(0);
    expect(gf.scoring_rate).toBe(0);
    expect(gf.n_matches).toBe(0);
  });

  it('equipo que siempre anota 2 → scoring_rate = 1.0', () => {
    const matches = Array.from({ length: 5 }, (_, i) =>
      makeMatch(T, `opp${i}`, (i + 1) * 7, 2, 0, ANCHOR),
    );
    const gf = computeGoalForm(T, matches, ANCHOR);
    expect(gf.scoring_rate).toBeCloseTo(1.0, 10);
    expect(gf.clean_sheet_rate).toBeCloseTo(1.0, 10);
  });

  it('equipo que nunca anota → scoring_rate = 0.0', () => {
    const matches = Array.from({ length: 5 }, (_, i) =>
      makeMatch(T, `opp${i}`, (i + 1) * 7, 0, 2, ANCHOR),
    );
    const gf = computeGoalForm(T, matches, ANCHOR);
    expect(gf.scoring_rate).toBeCloseTo(0.0, 10);
    expect(gf.clean_sheet_rate).toBeCloseTo(0.0, 10);
  });

  it('n_matches ≤ GOAL_FORM_WINDOW aunque haya más partidos', () => {
    const matches = Array.from({ length: GOAL_FORM_WINDOW + 5 }, (_, i) =>
      makeMatch(T, `opp${i}`, (i + 1) * 3, 1, 1, ANCHOR),
    );
    const gf = computeGoalForm(T, matches, ANCHOR);
    expect(gf.n_matches).toBeLessThanOrEqual(GOAL_FORM_WINDOW);
  });

  it('clean_sheet_rate ∈ [0,1]', () => {
    const matches = [
      makeMatch(T, 'A', 7, 1, 0, ANCHOR),
      makeMatch(T, 'B', 14, 2, 1, ANCHOR),
      makeMatch(T, 'C', 21, 0, 0, ANCHOR),
    ];
    const gf = computeGoalForm(T, matches, ANCHOR);
    expect(gf.clean_sheet_rate).toBeGreaterThanOrEqual(0);
    expect(gf.clean_sheet_rate).toBeLessThanOrEqual(1);
  });

  it('partidos futuros (daysAgo < 0) son ignorados', () => {
    const past   = makeMatch(T, 'A', 7, 2, 0, ANCHOR);
    const future = makeMatch(T, 'B', -1, 3, 0, ANCHOR); // después del anchor
    const gf = computeGoalForm(T, [past, future], ANCHOR);
    expect(gf.n_matches).toBe(1);
  });

  it('funciona cuando el equipo es visitante', () => {
    const m = makeMatch('opponent', T, 7, 0, 2, ANCHOR); // T es visitante, marca 2
    const gf = computeGoalForm(T, [m], ANCHOR);
    expect(gf.goals_scored_form).toBeCloseTo(2.0, 5);
    expect(gf.goals_conceded_form).toBeCloseTo(0.0, 5);
  });
});
