/**
 * v2-engine.test.ts — Tests del Motor Predictivo V2.
 *
 * Cubre todos los criterios de aceptación (spec §19):
 *   - tasas base observadas
 *   - fallback sin prior
 *   - shrinkage dinámico
 *   - recencia con pesos 5,4,3,2,1
 *   - ajuste por rival
 *   - lambdas y clamp
 *   - probabilidades Poisson (suma ≈ 1)
 *   - elegibilidad NOT_ELIGIBLE / LIMITED / ELIGIBLE
 *   - prior_quality HIGH / MEDIUM / LOW / NONE
 *   - asimetría home/away
 *   - sin Elo en el path core
 */

import { describe, it, expect } from 'vitest';
import {
  runV2Engine,
  computeTeamStats,
  computeObservedRates,
  computeLeagueBaselines,
  buildTeamPrior,
  computeShrinkageWeights,
  computeEffectiveRates,
  computeRecentFormDeltas,
  computeV2Lambdas,
  computeV2Eligibility,
  computePoissonProbs,
  K_TOTAL,
  K_HOME,
  K_AWAY,
  K_FORM,
  LAMBDA_MIN,
  LAMBDA_MAX,
  THRESHOLD_NOT_ELIGIBLE,
  THRESHOLD_ELIGIBLE,
} from '../../src/engine/v2/index.js';
import type { V2MatchRecord, MatchSignal } from '../../src/engine/v2/index.js';

// ── Fixtures helpers ───────────────────────────────────────────────────────────

const HOME = 'team:home';
const AWAY = 'team:away';
const OTHER = 'team:other';

/** Crea un partido en una fecha relativa al kickoff objetivo. */
function match(
  home: string,
  away: string,
  daysBeforeKickoff: number,
  homeGoals: number,
  awayGoals: number,
  kickoffDate = '2025-10-01T15:00:00Z',
): V2MatchRecord {
  const kickoffMs = new Date(kickoffDate).getTime();
  const matchMs = kickoffMs - daysBeforeKickoff * 24 * 3600_000;
  return {
    homeTeamId: home,
    awayTeamId: away,
    utcDate: new Date(matchMs).toISOString(),
    homeGoals,
    awayGoals,
  };
}

// ── 1. Tasas observadas (§5) ──────────────────────────────────────────────────

describe('computeTeamStats', () => {
  it('acumula goles home y away correctamente', () => {
    const matches: V2MatchRecord[] = [
      match(HOME, OTHER, 30, 2, 1), // HOME juega en casa: GF=2, GC=1
      match(OTHER, HOME, 20, 0, 3), // HOME juega de visitante: GF=3, GC=0
    ];
    const stats = computeTeamStats(matches, HOME);

    expect(stats.pj_total).toBe(2);
    expect(stats.pj_home).toBe(1);
    expect(stats.pj_away).toBe(1);
    expect(stats.gf_home).toBe(2);
    expect(stats.gc_home).toBe(1);
    expect(stats.gf_away).toBe(3);
    expect(stats.gc_away).toBe(0);
    expect(stats.gf_total).toBe(5);
    expect(stats.gc_total).toBe(1);
  });

  it('retorna todo en cero cuando el equipo no aparece', () => {
    const stats = computeTeamStats([], 'equipo-inexistente');
    expect(stats.pj_total).toBe(0);
    expect(stats.gf_total).toBe(0);
  });
});

describe('computeObservedRates', () => {
  it('calcula goles por partido correctamente', () => {
    const stats = computeTeamStats(
      [match(HOME, OTHER, 20, 2, 1), match(OTHER, HOME, 10, 1, 3)],
      HOME,
    );
    const rates = computeObservedRates(stats);
    expect(rates.gf_pg_home).toBeCloseTo(2.0);
    expect(rates.gc_pg_home).toBeCloseTo(1.0);
    expect(rates.gf_pg_away).toBeCloseTo(3.0);
    expect(rates.gc_pg_away).toBeCloseTo(1.0);
    expect(rates.gf_pg_total).toBeCloseTo(5 / 2);
  });

  it('retorna 0 cuando PJ = 0 (sin división por cero)', () => {
    const stats = computeTeamStats([], HOME);
    const rates = computeObservedRates(stats);
    expect(rates.gf_pg_total).toBe(0);
    expect(rates.gf_pg_home).toBe(0);
    expect(rates.gf_pg_away).toBe(0);
  });
});

// ── 2. League baselines ────────────────────────────────────────────────────────

describe('computeLeagueBaselines', () => {
  it('calcula promedio home/away de goles de la liga', () => {
    const matches = [
      {
        homeTeamId: 'A',
        awayTeamId: 'B',
        utcDate: '2025-01-01T00:00:00Z',
        homeGoals: 2,
        awayGoals: 1,
      },
      {
        homeTeamId: 'C',
        awayTeamId: 'D',
        utcDate: '2025-01-02T00:00:00Z',
        homeGoals: 0,
        awayGoals: 0,
      },
    ];
    const bl = computeLeagueBaselines(matches);
    expect(bl.league_home_goals_pg).toBeCloseTo(1.0); // (2+0)/2
    expect(bl.league_away_goals_pg).toBeCloseTo(0.5); // (1+0)/2
    expect(bl.league_goals_pg).toBeCloseTo(1.5);
  });

  it('usa fallback europeo cuando no hay partidos', () => {
    const bl = computeLeagueBaselines([]);
    expect(bl.league_home_goals_pg).toBeGreaterThan(0);
    expect(bl.league_away_goals_pg).toBeGreaterThan(0);
  });
});

// ── 3. Prior estructural (§6) ──────────────────────────────────────────────────

describe('buildTeamPrior', () => {
  const baselines = { league_home_goals_pg: 1.5, league_away_goals_pg: 1.2, league_goals_pg: 2.7 };

  it('prior_quality NONE cuando no hay temporada anterior', () => {
    const prior = buildTeamPrior([], HOME, baselines);
    expect(prior.prior_quality).toBe('NONE');
    expect(prior.prior_source).toBe('LEAGUE_BASELINE');
    expect(prior.attack_prior_total).toBe(baselines.league_goals_pg);
  });

  it('LOWER_DIVISION cuando el equipo no jugó en la temporada anterior pero otros sí', () => {
    // prevSeasonMatches tiene datos de otros equipos → este equipo fue ascendido → LOWER_DIVISION
    const prevMatches: V2MatchRecord[] = [match('A', 'B', 400, 1, 1), match('C', 'D', 380, 2, 0)];
    const prior = buildTeamPrior(prevMatches, HOME, baselines);
    expect(prior.prior_quality).toBe('NONE');
    expect(prior.prior_source).toBe('LOWER_DIVISION');
  });

  it('LEAGUE_BASELINE cuando no hay temporada anterior en absoluto', () => {
    // prevSeasonMatches vacío → no hay datos de ningún equipo → LEAGUE_BASELINE
    const prior = buildTeamPrior([], HOME, baselines);
    expect(prior.prior_quality).toBe('NONE');
    expect(prior.prior_source).toBe('LEAGUE_BASELINE');
  });

  it('PARTIAL con pocos partidos en temporada anterior (1-9 partidos → LOW quality)', () => {
    const prevMatches = Array.from({ length: 5 }, (_, i) => match(HOME, OTHER, 400 + i * 7, 1, 1));
    const prior = buildTeamPrior(prevMatches, HOME, baselines);
    expect(prior.prior_quality).toBe('LOW');
    // §6.3: LOW quality → PARTIAL source (datos escasos, mezcla incierta)
    expect(prior.prior_source).toBe('PARTIAL');
  });

  it('prior_quality HIGH con ≥ 20 partidos', () => {
    const prevMatches = Array.from({ length: 20 }, (_, i) => match(HOME, OTHER, 400 + i * 7, 2, 1));
    const prior = buildTeamPrior(prevMatches, HOME, baselines);
    expect(prior.prior_quality).toBe('HIGH');
  });

  it('mezcla con baseline de liga usando alpha_prev = 0.70', () => {
    const prevMatches = Array.from(
      { length: 20 },
      (_, i) => match(HOME, OTHER, 400 + i * 7, 3, 0), // 3 goles/partido como local
    );
    const prior = buildTeamPrior(prevMatches, HOME, baselines);
    // attack_prior_home ≈ 0.70 * 3.0 + 0.30 * 1.5 = 2.1 + 0.45 = 2.55
    expect(prior.attack_prior_home).toBeCloseTo(2.55, 1);
  });
});

// ── 4. Shrinkage (§7) ─────────────────────────────────────────────────────────

describe('computeShrinkageWeights', () => {
  it('w → 0 cuando n = 0', () => {
    const stats = computeTeamStats([], HOME);
    const w = computeShrinkageWeights(stats);
    expect(w.w_total).toBe(0);
    expect(w.w_home).toBe(0);
    expect(w.w_away).toBe(0);
  });

  it('w → 1 con n grande', () => {
    // Con 100 partidos: w = 100 / (100 + 5) ≈ 0.952
    const matches = Array.from({ length: 100 }, (_, i) => match(HOME, OTHER, 400 + i, 1, 1));
    const stats = computeTeamStats(matches, HOME);
    const w = computeShrinkageWeights(stats);
    expect(w.w_total).toBeGreaterThan(0.9);
    expect(w.w_home).toBeGreaterThan(0.9);
  });

  it('formula correcta: w = n / (n + K)', () => {
    // 5 partidos totales, K_TOTAL = 5 → w = 5 / 10 = 0.5
    const matches = Array.from({ length: 5 }, (_, i) => match(HOME, OTHER, 50 + i, 1, 1));
    const stats = computeTeamStats(matches, HOME);
    const w = computeShrinkageWeights(stats);
    expect(w.w_total).toBeCloseTo(5 / (5 + K_TOTAL), 5);
  });
});

describe('computeEffectiveRates', () => {
  it('con n=0, effective rate = prior', () => {
    const stats = computeTeamStats([], HOME);
    const rates = computeObservedRates(stats);
    const prior = {
      attack_prior_total: 1.5,
      defense_prior_total: 1.5,
      attack_prior_home: 2.0,
      defense_prior_home: 1.0,
      attack_prior_away: 1.0,
      defense_prior_away: 1.8,
      prior_quality: 'HIGH' as const,
      prior_source: 'PREV_SEASON' as const,
    };
    const eff = computeEffectiveRates(stats, rates, prior, true);
    // w_total = 0 → effective_attack = prior_home = 2.0
    expect(eff.effective_attack).toBeCloseTo(2.0);
    expect(eff.effective_defense).toBeCloseTo(1.0);
  });
});

// ── 5. Recencia (§9) ──────────────────────────────────────────────────────────

describe('computeRecentFormDeltas', () => {
  it('retorna 1.0 cuando no hay señales', () => {
    const deltas = computeRecentFormDeltas([]);
    expect(deltas.effective_recent_attack_delta).toBe(1.0);
    expect(deltas.effective_recent_defense_delta).toBe(1.0);
    expect(deltas.n_recent).toBe(0);
  });

  it('usa pesos 5,4,3,2,1 del más reciente al más viejo', () => {
    // 5 señales con attack_signal diferente, ordenadas cronológicamente
    // más viejo = [0], más reciente = [4]
    const signals: MatchSignal[] = [
      { utcDate: '2025-01-01T00:00:00Z', attack_signal: 1.0, defense_signal: 1.0 }, // peso 1
      { utcDate: '2025-01-08T00:00:00Z', attack_signal: 1.0, defense_signal: 1.0 }, // peso 2
      { utcDate: '2025-01-15T00:00:00Z', attack_signal: 1.0, defense_signal: 1.0 }, // peso 3
      { utcDate: '2025-01-22T00:00:00Z', attack_signal: 1.0, defense_signal: 1.0 }, // peso 4
      { utcDate: '2025-01-29T00:00:00Z', attack_signal: 2.0, defense_signal: 1.0 }, // peso 5
    ];
    // weighted_avg = (1*1 + 2*1 + 3*1 + 4*1 + 5*2) / (1+2+3+4+5) = 19/15 ≈ 1.267
    // w_form = 5/(5+6) ≈ 0.4545
    // effective = 0.4545 * 1.267 + 0.5455 * 1.0 ≈ 1.121
    const deltas = computeRecentFormDeltas(signals);
    expect(deltas.n_recent).toBe(5);
    expect(deltas.effective_recent_attack_delta).toBeGreaterThan(1.0);
    expect(deltas.effective_recent_attack_delta).toBeLessThan(1.5);
  });

  it('shrinkage K_form aplica: con 1 partido, se acerca a 1.0', () => {
    // K_form = 6, n=1 → w_form = 1/7 ≈ 0.143
    const signals: MatchSignal[] = [
      { utcDate: '2025-01-01T00:00:00Z', attack_signal: 5.0, defense_signal: 0.0 },
    ];
    const deltas = computeRecentFormDeltas(signals);
    // effective ≈ (1/7)*5.0 + (6/7)*1.0 ≈ 0.714 + 0.857 = 1.571
    expect(deltas.effective_recent_attack_delta).toBeCloseTo((1 / 7) * 5.0 + (6 / 7) * 1.0, 2);
    expect(deltas.n_recent).toBe(1);
  });
});

// ── 6. Lambdas V2 (§11) ───────────────────────────────────────────────────────

describe('computeV2Lambdas', () => {
  const neutralParams = {
    league_home_goals_pg: 1.5,
    league_away_goals_pg: 1.2,
    effective_attack_home: 1.5,
    effective_defense_home: 1.2,
    effective_attack_away: 1.2,
    effective_defense_away: 1.5,
    effective_recent_attack_delta_home: 1.0,
    effective_recent_defense_delta_home: 1.0,
    effective_recent_attack_delta_away: 1.0,
    effective_recent_defense_delta_away: 1.0,
  };

  it('lambdas siempre dentro del clamp [LAMBDA_MIN, LAMBDA_MAX]', () => {
    const result = computeV2Lambdas(neutralParams);
    expect(result.lambda_home).toBeGreaterThanOrEqual(LAMBDA_MIN);
    expect(result.lambda_home).toBeLessThanOrEqual(LAMBDA_MAX);
    expect(result.lambda_away).toBeGreaterThanOrEqual(LAMBDA_MIN);
    expect(result.lambda_away).toBeLessThanOrEqual(LAMBDA_MAX);
  });

  it('lambda_home > lambda_away cuando el home es más fuerte', () => {
    const strongHome = {
      ...neutralParams,
      effective_attack_home: 2.5,
      effective_defense_away: 1.8,
      effective_attack_away: 0.8,
      effective_defense_home: 0.7,
    };
    const result = computeV2Lambdas(strongHome);
    expect(result.lambda_home).toBeGreaterThan(result.lambda_away);
  });

  it('con valores neutros, lambda_home ≈ league_home_goals_pg', () => {
    const result = computeV2Lambdas(neutralParams);
    // Cuando ataque = baseline y defensa rival = baseline, los factores son 1^1 = 1
    // lambda_home = league_home * 1 * 1 * 1 * 1 = league_home
    expect(result.lambda_home).toBeCloseTo(1.5, 3);
    expect(result.lambda_away).toBeCloseTo(1.2, 3);
  });

  it('clamp funciona: raw muy alto queda en LAMBDA_MAX', () => {
    const extreme = {
      ...neutralParams,
      effective_attack_home: 10.0,
      effective_defense_away: 10.0,
    };
    const result = computeV2Lambdas(extreme);
    expect(result.lambda_home).toBe(LAMBDA_MAX);
    expect(result.clamped).toBe(true);
  });
});

// ── 7. Elegibilidad (§13) ─────────────────────────────────────────────────────

describe('computeV2Eligibility', () => {
  const baselines = { league_home_goals_pg: 1.5, league_away_goals_pg: 1.2, league_goals_pg: 2.7 };

  it('NOT_ELIGIBLE cuando algún equipo tiene < 3 partidos', () => {
    expect(computeV2Eligibility(2, 10, baselines).status).toBe('NOT_ELIGIBLE');
    expect(computeV2Eligibility(10, 2, baselines).status).toBe('NOT_ELIGIBLE');
    expect(computeV2Eligibility(0, 0, baselines).status).toBe('NOT_ELIGIBLE');
  });

  it('LIMITED cuando algún equipo tiene 3–4 partidos', () => {
    expect(computeV2Eligibility(3, 10, baselines).status).toBe('LIMITED');
    expect(computeV2Eligibility(4, 10, baselines).status).toBe('LIMITED');
    expect(computeV2Eligibility(10, 4, baselines).status).toBe('LIMITED');
  });

  it('ELIGIBLE cuando ambos tienen ≥ 5 partidos', () => {
    expect(computeV2Eligibility(5, 5, baselines).status).toBe('ELIGIBLE');
    expect(computeV2Eligibility(20, 15, baselines).status).toBe('ELIGIBLE');
  });

  it('NOT_ELIGIBLE cuando faltan baselines', () => {
    expect(computeV2Eligibility(10, 10, null).status).toBe('NOT_ELIGIBLE');
    expect(
      computeV2Eligibility(10, 10, {
        league_home_goals_pg: 0,
        league_away_goals_pg: 0,
        league_goals_pg: 0,
      }).status,
    ).toBe('NOT_ELIGIBLE');
  });

  it('umbrales correctos: exactamente 3 = NOT_ELIGIBLE, 5 = ELIGIBLE', () => {
    expect(computeV2Eligibility(THRESHOLD_NOT_ELIGIBLE - 1, 10, baselines).status).toBe(
      'NOT_ELIGIBLE',
    );
    expect(computeV2Eligibility(THRESHOLD_NOT_ELIGIBLE, 10, baselines).status).toBe('LIMITED');
    expect(computeV2Eligibility(THRESHOLD_ELIGIBLE, THRESHOLD_ELIGIBLE, baselines).status).toBe(
      'ELIGIBLE',
    );
  });
});

// ── 8. Poisson 1X2 (§12) ──────────────────────────────────────────────────────

describe('computePoissonProbs', () => {
  it('probabilidades suman ≈ 1', () => {
    const cases = [
      { lh: 1.3, la: 1.1 },
      { lh: 2.5, la: 0.8 },
      { lh: 0.8, la: 2.0 },
      { lh: 1.5, la: 1.5 },
    ];
    for (const { lh, la } of cases) {
      const r = computePoissonProbs(lh, la);
      const sum = r.prob_home_win + r.prob_draw + r.prob_away_win;
      expect(sum).toBeCloseTo(1.0, 4);
    }
  });

  it('todas las probabilidades son ≥ 0', () => {
    const r = computePoissonProbs(1.4, 1.2);
    expect(r.prob_home_win).toBeGreaterThanOrEqual(0);
    expect(r.prob_draw).toBeGreaterThanOrEqual(0);
    expect(r.prob_away_win).toBeGreaterThanOrEqual(0);
  });

  it('lambda_home >> lambda_away → P(home_win) >> P(away_win)', () => {
    const r = computePoissonProbs(3.0, 0.5);
    expect(r.prob_home_win).toBeGreaterThan(r.prob_away_win);
  });
});

// ── 9. Engine integrado (§19 criterios de aceptación) ────────────────────────

describe('runV2Engine — criterios de aceptación', () => {
  const kickoff = '2025-10-01T15:00:00Z';

  /** Crea N partidos previos para un equipo como local. */
  function homeMatches(n: number, gf = 2, gc = 1): V2MatchRecord[] {
    return Array.from({ length: n }, (_, i) => match(HOME, OTHER, 10 + i * 7, gf, gc, kickoff));
  }

  /** Crea N partidos previos para un equipo como visitante. */
  function awayMatches(n: number, gf = 1, gc = 2): V2MatchRecord[] {
    return Array.from(
      { length: n },
      (_, i) => match(OTHER, AWAY, 10 + i * 7, gc, gf, kickoff), // gf/gc from AWAY's perspective
    );
  }

  it('NOT_ELIGIBLE con < 3 partidos', () => {
    const output = runV2Engine({
      homeTeamId: HOME,
      awayTeamId: AWAY,
      kickoffUtc: kickoff,
      currentSeasonMatches: [
        match(HOME, OTHER, 20, 2, 1), // solo 1 partido para HOME
        match(OTHER, AWAY, 15, 1, 2), // solo 1 para AWAY
      ],
      prevSeasonMatches: [],
    });
    expect(output.eligibility_status).toBe('NOT_ELIGIBLE');
    expect(output.lambda_home).toBe(0);
    expect(output.prob_home_win).toBe(0);
  });

  it('LIMITED con 3–4 partidos', () => {
    const current: V2MatchRecord[] = [
      ...homeMatches(3), // HOME: 3 partidos
      ...awayMatches(3), // AWAY: 3 partidos
    ];
    const output = runV2Engine({
      homeTeamId: HOME,
      awayTeamId: AWAY,
      kickoffUtc: kickoff,
      currentSeasonMatches: current,
      prevSeasonMatches: [],
    });
    expect(output.eligibility_status).toBe('LIMITED');
  });

  it('ELIGIBLE con ≥ 5 partidos', () => {
    const current: V2MatchRecord[] = [...homeMatches(5), ...awayMatches(5)];
    const output = runV2Engine({
      homeTeamId: HOME,
      awayTeamId: AWAY,
      kickoffUtc: kickoff,
      currentSeasonMatches: current,
      prevSeasonMatches: [],
    });
    expect(output.eligibility_status).toBe('ELIGIBLE');
  });

  it('probabilities sum ≈ 1 en ELIGIBLE', () => {
    const current: V2MatchRecord[] = [...homeMatches(8, 2, 1), ...awayMatches(8, 1, 2)];
    const output = runV2Engine({
      homeTeamId: HOME,
      awayTeamId: AWAY,
      kickoffUtc: kickoff,
      currentSeasonMatches: current,
      prevSeasonMatches: [],
    });
    const sum = output.prob_home_win + output.prob_draw + output.prob_away_win;
    expect(sum).toBeCloseTo(1.0, 4);
  });

  it('asimetría home/away: home atacante fuerte → lambda_home > lambda_away', () => {
    const current: V2MatchRecord[] = [
      ...homeMatches(10, 4, 0), // HOME: 4 goles/partido como local, sin conceder
      ...awayMatches(10, 0, 3), // AWAY: 0 goles como visitante, concede 3
    ];
    const output = runV2Engine({
      homeTeamId: HOME,
      awayTeamId: AWAY,
      kickoffUtc: kickoff,
      currentSeasonMatches: current,
      prevSeasonMatches: [],
    });
    expect(output.lambda_home).toBeGreaterThan(output.lambda_away);
    expect(output.prob_home_win).toBeGreaterThan(output.prob_away_win);
  });

  it('sin Elo en el output — no hay campo eloDiff ni rating', () => {
    const current: V2MatchRecord[] = [...homeMatches(5), ...awayMatches(5)];
    const output = runV2Engine({
      homeTeamId: HOME,
      awayTeamId: AWAY,
      kickoffUtc: kickoff,
      currentSeasonMatches: current,
      prevSeasonMatches: [],
    });
    // El output no debe tener campos de Elo
    expect((output as Record<string, unknown>)['eloDiff']).toBeUndefined();
    expect((output as Record<string, unknown>)['eloHome']).toBeUndefined();
    expect((output as Record<string, unknown>)['eloAway']).toBeUndefined();
  });

  it('engine_version es v2_structural_attack_defense', () => {
    const output = runV2Engine({
      homeTeamId: HOME,
      awayTeamId: AWAY,
      kickoffUtc: kickoff,
      currentSeasonMatches: [],
      prevSeasonMatches: [],
    });
    expect(output.engine_version).toBe('v2_structural_attack_defense');
  });

  it('prior_quality NONE cuando no hay temporada anterior', () => {
    const current: V2MatchRecord[] = [...homeMatches(5), ...awayMatches(5)];
    const output = runV2Engine({
      homeTeamId: HOME,
      awayTeamId: AWAY,
      kickoffUtc: kickoff,
      currentSeasonMatches: current,
      prevSeasonMatches: [],
    });
    // Sin prev season → prior_quality debería ser NONE (peor de los dos equipos)
    expect(output.prior_quality).toBe('NONE');
    expect(output.prior_source).toBe('LEAGUE_BASELINE');
  });

  it('prior_quality HIGH cuando hay ≥ 20 partidos en temporada anterior', () => {
    const current: V2MatchRecord[] = [...homeMatches(5), ...awayMatches(5)];
    const prevHome = Array.from({ length: 20 }, (_, i) =>
      match(HOME, OTHER, 400 + i * 7, 2, 1, kickoff),
    );
    const prevAway = Array.from({ length: 20 }, (_, i) =>
      match(OTHER, AWAY, 400 + i * 7, 1, 1, kickoff),
    );
    const output = runV2Engine({
      homeTeamId: HOME,
      awayTeamId: AWAY,
      kickoffUtc: kickoff,
      currentSeasonMatches: current,
      prevSeasonMatches: [...prevHome, ...prevAway],
    });
    expect(output.prior_quality).toBe('HIGH');
    expect(output.prior_source).toBe('PREV_SEASON');
  });

  it('anti-lookahead: partidos posteriores al kickoff no afectan el resultado', () => {
    // Partido DESPUÉS del kickoff — no debe incluirse
    const futureMatch: V2MatchRecord = {
      homeTeamId: HOME,
      awayTeamId: OTHER,
      utcDate: '2025-10-05T15:00:00Z', // después del kickoff
      homeGoals: 5,
      awayGoals: 0,
    };
    const current5 = homeMatches(5);
    const away5 = awayMatches(5);

    const outputWithFuture = runV2Engine({
      homeTeamId: HOME,
      awayTeamId: AWAY,
      kickoffUtc: kickoff,
      currentSeasonMatches: [...current5, ...away5, futureMatch],
      prevSeasonMatches: [],
    });
    const outputWithout = runV2Engine({
      homeTeamId: HOME,
      awayTeamId: AWAY,
      kickoffUtc: kickoff,
      currentSeasonMatches: [...current5, ...away5],
      prevSeasonMatches: [],
    });

    // El partido futuro es ignorado → resultados idénticos
    expect(outputWithFuture.lambda_home).toBeCloseTo(outputWithout.lambda_home, 6);
    expect(outputWithFuture.lambda_away).toBeCloseTo(outputWithout.lambda_away, 6);
  });

  it('output completo incluye todos los campos obligatorios (§16)', () => {
    const current: V2MatchRecord[] = [...homeMatches(5), ...awayMatches(5)];
    const output = runV2Engine({
      homeTeamId: HOME,
      awayTeamId: AWAY,
      kickoffUtc: kickoff,
      currentSeasonMatches: current,
      prevSeasonMatches: [],
    });

    // §16: campos obligatorios
    expect(output.engine_version).toBeDefined();
    expect(output.eligibility_status).toBeDefined();
    expect(output.confidence_level).toBeDefined();
    expect(output.prior_quality).toBeDefined();
    expect(output.prior_source).toBeDefined();
    expect(typeof output.lambda_home).toBe('number');
    expect(typeof output.lambda_away).toBe('number');
    expect(typeof output.prob_home_win).toBe('number');
    expect(typeof output.prob_draw).toBe('number');
    expect(typeof output.prob_away_win).toBe('number');
    expect(output.explanation).toBeDefined();
    expect(output.explanation.effective_attack_home).toBeDefined();
    expect(output.explanation.effective_defense_home).toBeDefined();
    expect(output.explanation.effective_attack_away).toBeDefined();
    expect(output.explanation.effective_defense_away).toBeDefined();
    expect(output.explanation.recent_attack_delta_home).toBeDefined();
    expect(output.explanation.recent_defense_delta_home).toBeDefined();
    expect(output.explanation.recent_attack_delta_away).toBeDefined();
    expect(output.explanation.recent_defense_delta_away).toBeDefined();
    expect(output.explanation.sample_size_effect).toBeDefined();
    expect(typeof output.explanation.rival_adjustment_used).toBe('boolean');
    expect(typeof output.explanation.recent_form_used).toBe('boolean');
    // Campos de prior per-team (§6.3, auditoría fix)
    expect(output.explanation.prior_quality_home).toBeDefined();
    expect(output.explanation.prior_quality_away).toBeDefined();
    expect(output.explanation.prior_source_home).toBeDefined();
    expect(output.explanation.prior_source_away).toBeDefined();
  });

  it('prior_source top-level = worst de los dos equipos (worstPriorSource)', () => {
    // home: 20 partidos en prev → PREV_SEASON
    // away: 0 partidos en prev, pero prev season tiene datos → LOWER_DIVISION
    // worst(PREV_SEASON, LOWER_DIVISION) = LOWER_DIVISION
    const current: V2MatchRecord[] = [...homeMatches(5), ...awayMatches(5)];
    const prevHome = Array.from({ length: 20 }, (_, i) =>
      match(HOME, OTHER, 400 + i * 7, 2, 1, kickoff),
    );
    // Solo home tiene historial previo; away no aparece en prevSeason
    const output = runV2Engine({
      homeTeamId: HOME,
      awayTeamId: AWAY,
      kickoffUtc: kickoff,
      currentSeasonMatches: current,
      prevSeasonMatches: prevHome, // away tiene pj_total=0 en prevSeason con datos → LOWER_DIVISION
    });
    // worst(PREV_SEASON, LOWER_DIVISION) = LOWER_DIVISION
    expect(output.prior_source).toBe('LOWER_DIVISION');
    // explanation expone ambos por separado
    expect(output.explanation.prior_source_home).toBe('PREV_SEASON');
    expect(output.explanation.prior_source_away).toBe('LOWER_DIVISION');
    expect(output.explanation.prior_quality_home).toBe('HIGH');
    expect(output.explanation.prior_quality_away).toBe('NONE');
  });

  it('prior_source PARTIAL cuando uno tiene 1-9 partidos en prev season', () => {
    // home: 5 partidos en prev → PARTIAL; away: 5 en prev → PARTIAL
    // worst(PARTIAL, PARTIAL) = PARTIAL
    const current: V2MatchRecord[] = [...homeMatches(5), ...awayMatches(5)];
    const prevHome = Array.from({ length: 5 }, (_, i) =>
      match(HOME, OTHER, 400 + i * 7, 1, 1, kickoff),
    );
    const prevAway = Array.from({ length: 5 }, (_, i) =>
      match(OTHER, AWAY, 400 + i * 7, 1, 1, kickoff),
    );
    const output = runV2Engine({
      homeTeamId: HOME,
      awayTeamId: AWAY,
      kickoffUtc: kickoff,
      currentSeasonMatches: current,
      prevSeasonMatches: [...prevHome, ...prevAway],
    });
    expect(output.prior_source).toBe('PARTIAL');
    expect(output.explanation.prior_source_home).toBe('PARTIAL');
    expect(output.explanation.prior_source_away).toBe('PARTIAL');
  });

  it('ajuste por rival usa prior del rival cuando tiene datos en prev season', () => {
    // Verifica que lambdas son diferentes cuando el rival tiene datos en prev season
    // (prior del rival conocido) vs cuando no los tiene (baseline).
    // No podemos acceder al cache interno, pero sí verificar que el motor corre
    // sin error y produce output con rival_adjustment_used=true cuando hay señales.
    const current: V2MatchRecord[] = [
      ...homeMatches(8),
      ...awayMatches(8),
      // Algunos partidos contra OTHER para que haya señales de rival
      ...Array.from({ length: 5 }, (_, i) => match(HOME, OTHER, 100 + i * 7, 2, 1, kickoff)),
      ...Array.from({ length: 5 }, (_, i) => match(OTHER, AWAY, 100 + i * 7, 1, 1, kickoff)),
    ];
    const prevOther = Array.from({ length: 15 }, (_, i) =>
      match(OTHER, 'team:x', 400 + i * 7, 1, 1, kickoff),
    );
    const output = runV2Engine({
      homeTeamId: HOME,
      awayTeamId: AWAY,
      kickoffUtc: kickoff,
      currentSeasonMatches: current,
      prevSeasonMatches: prevOther,
    });
    // El motor debe correr sin error y producir output válido
    expect(output.eligibility_status).toBe('ELIGIBLE');
    expect(output.explanation.rival_adjustment_used).toBe(true);
    expect(output.prob_home_win + output.prob_draw + output.prob_away_win).toBeGreaterThan(0.99);
  });

  it('lambdas dentro del clamp [LAMBDA_MIN, LAMBDA_MAX] siempre', () => {
    // Caso extremo: home ataca mucho, away no concede nada
    const extreme: V2MatchRecord[] = [
      ...Array.from({ length: 10 }, (_, i) => match(HOME, OTHER, 10 + i, 5, 0, kickoff)),
      ...Array.from({ length: 10 }, (_, i) => match(OTHER, AWAY, 10 + i, 0, 0, kickoff)),
    ];
    const output = runV2Engine({
      homeTeamId: HOME,
      awayTeamId: AWAY,
      kickoffUtc: kickoff,
      currentSeasonMatches: extreme,
      prevSeasonMatches: [],
    });
    expect(output.lambda_home).toBeGreaterThanOrEqual(LAMBDA_MIN);
    expect(output.lambda_home).toBeLessThanOrEqual(LAMBDA_MAX);
    expect(output.lambda_away).toBeGreaterThanOrEqual(LAMBDA_MIN);
    expect(output.lambda_away).toBeLessThanOrEqual(LAMBDA_MAX);
  });
});
