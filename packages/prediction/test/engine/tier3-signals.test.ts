/**
 * tier3-signals.test.ts — Tests para módulos Tier 3 del Motor Predictivo V3.
 *
 * Spec: SP-MKT-T3-00 §12 (Acceptance Test Mapping)
 *
 * Casos cubiertos:
 *
 * T3-01a: augmentMatchesWithXg con cobertura total — todos los goals reemplazados por xG
 * T3-01b: augmentMatchesWithXg con cobertura parcial — solo matches con xG los usan
 * T3-01c: augmentMatchesWithXg con undefined/empty xG — output === input
 * T3-01d: runV3Engine con xG — explanation.xg_used = true, xg_coverage reportado
 * T3-01e: runV3Engine sin xG — identical output (regression baseline — xg_used = false)
 *
 * T3-02a: computeAbsenceMultiplier con 3 injuries — correct weighted score + mult
 * T3-02b: computeAbsenceMultiplier con DOUBTFUL — 50% weight aplicado
 * T3-02c: computeAbsenceMultiplier clamp en ABSENCE_MULT_MIN
 * T3-02d: computeAbsenceMultiplier sin injuries — mult = 1.0
 *
 * T3-03a: Lineup detecta starter adicional no en injuries
 * T3-03b: Lineup + injuries — sin doble conteo del mismo jugador
 * T3-03c: Sin lineup, sin injuries — absence_adjustment_applied = false
 *
 * T3-04a: blendWithMarketOdds con odds válidas — probs blended correctamente
 * T3-04b: blendWithMarketOdds con suma inválida — retorna modelo + invalidOdds = true
 * T3-04c: blendWithMarketOdds con undefined — sin cambio
 * T3-04d: runV3Engine con marketOdds — explanation traza pre-blend y market values
 *
 * T3-REG: runV3Engine con TODOS los campos T3 en undefined produce mismo output que sin ellos
 */

import { describe, it, expect } from 'vitest';
import {
  augmentMatchesWithXg,
  computeXgCoverage,
} from '../../src/engine/v3/xg-augment.js';
import {
  computeAbsenceMultiplier,
} from '../../src/engine/v3/absence-adjustment.js';
import {
  blendWithMarketOdds,
} from '../../src/engine/v3/market-blend.js';
import { runV3Engine } from '../../src/engine/v3/v3-engine.js';
import type {
  V3MatchRecord,
  XgRecord,
  InjuryRecord,
  ConfirmedLineupRecord,
  MarketOddsRecord,
  V3EngineInput,
} from '../../src/engine/v3/types.js';
import {
  ABSENCE_IMPACT_FACTOR,
  ABSENCE_MULT_MIN,
  LINEUP_MISSING_STARTER_IMPORTANCE,
  DOUBTFUL_WEIGHT,
  MARKET_WEIGHT,
  MARKET_ODDS_SUM_TOLERANCE,
  POSITION_IMPACT,
} from '../../src/engine/v3/constants.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const KICKOFF = '2026-04-15T15:00:00Z';
const BUILD_NOW = '2026-04-15T10:00:00Z';
const HOME = 'home-team';
const AWAY = 'away-team';
const OPPONENT = 'other-team';

function makeMatch(
  home: string,
  away: string,
  daysBeforeKickoff: number,
  hg: number,
  ag: number,
): V3MatchRecord {
  const ms = new Date(KICKOFF).getTime() - daysBeforeKickoff * 86_400_000;
  return {
    homeTeamId: home,
    awayTeamId: away,
    utcDate: new Date(ms).toISOString(),
    homeGoals: hg,
    awayGoals: ag,
  };
}

/**
 * Genera un input V3 mínimo válido con partidos suficientes para ELIGIBLE.
 * HOME juega 8 partidos en casa, AWAY juega 8 partidos fuera.
 */
function makeBaseInput(overrides: Partial<V3EngineInput> = {}): V3EngineInput {
  const matches: V3MatchRecord[] = [];
  // 8 partidos del HOME como local
  for (let i = 0; i < 8; i++) {
    matches.push(makeMatch(HOME, OPPONENT, 90 - i * 7, 2, 1));
  }
  // 8 partidos del AWAY como visitante
  for (let i = 0; i < 8; i++) {
    matches.push(makeMatch(OPPONENT, AWAY, 90 - i * 7, 1, 1));
  }
  // Algunos cruces HOME vs AWAY (para H2H)
  matches.push(makeMatch(HOME, AWAY, 200, 1, 0));
  matches.push(makeMatch(AWAY, HOME, 220, 0, 1));

  return {
    homeTeamId: HOME,
    awayTeamId: AWAY,
    kickoffUtc: KICKOFF,
    buildNowUtc: BUILD_NOW,
    currentSeasonMatches: matches,
    prevSeasonMatches: [],
    ...overrides,
  };
}

// ── T3-01: xg-augment ─────────────────────────────────────────────────────────

describe('T3-01: augmentMatchesWithXg', () => {
  it('T3-01a: cobertura total — todos los goals reemplazados por xG', () => {
    const matches: V3MatchRecord[] = [
      { homeTeamId: HOME, awayTeamId: AWAY, utcDate: '2026-01-10T15:00:00Z', homeGoals: 2, awayGoals: 1 },
      { homeTeamId: AWAY, awayTeamId: HOME, utcDate: '2026-01-20T15:00:00Z', homeGoals: 0, awayGoals: 3 },
    ];
    const xgRecords: XgRecord[] = [
      { utcDate: '2026-01-10T15:00:00Z', homeTeamId: HOME, awayTeamId: AWAY, xgHome: 1.5, xgAway: 0.8 },
      { utcDate: '2026-01-20T15:00:00Z', homeTeamId: AWAY, awayTeamId: HOME, xgHome: 0.3, xgAway: 2.1 },
    ];

    const result = augmentMatchesWithXg(matches, xgRecords);

    expect(result).toHaveLength(2);
    expect(result[0]!.homeGoals).toBe(1.5);
    expect(result[0]!.awayGoals).toBe(0.8);
    expect(result[1]!.homeGoals).toBe(0.3);
    expect(result[1]!.awayGoals).toBe(2.1);
    // Estructura preservada
    expect(result[0]!.homeTeamId).toBe(HOME);
    expect(result[0]!.awayTeamId).toBe(AWAY);
  });

  it('T3-01b: cobertura parcial — solo matches con xG los usan, el resto retiene goles reales', () => {
    const matches: V3MatchRecord[] = [
      { homeTeamId: HOME, awayTeamId: AWAY, utcDate: '2026-01-10T15:00:00Z', homeGoals: 2, awayGoals: 1 },
      { homeTeamId: AWAY, awayTeamId: HOME, utcDate: '2026-01-20T15:00:00Z', homeGoals: 0, awayGoals: 3 },
    ];
    const xgRecords: XgRecord[] = [
      // Solo cubre el primer partido
      { utcDate: '2026-01-10T15:00:00Z', homeTeamId: HOME, awayTeamId: AWAY, xgHome: 1.5, xgAway: 0.8 },
    ];

    const result = augmentMatchesWithXg(matches, xgRecords);

    expect(result).toHaveLength(2);
    // Primer match: xG
    expect(result[0]!.homeGoals).toBe(1.5);
    expect(result[0]!.awayGoals).toBe(0.8);
    // Segundo match: goles reales preservados
    expect(result[1]!.homeGoals).toBe(0);
    expect(result[1]!.awayGoals).toBe(3);
  });

  it('T3-01c: undefined xG → retorna misma referencia sin cambios', () => {
    const matches: V3MatchRecord[] = [
      { homeTeamId: HOME, awayTeamId: AWAY, utcDate: '2026-01-10T15:00:00Z', homeGoals: 2, awayGoals: 1 },
    ];

    const result = augmentMatchesWithXg(matches, undefined);
    expect(result).toBe(matches); // misma referencia
  });

  it('T3-01c: xG vacío → retorna misma referencia sin cambios', () => {
    const matches: V3MatchRecord[] = [
      { homeTeamId: HOME, awayTeamId: AWAY, utcDate: '2026-01-10T15:00:00Z', homeGoals: 2, awayGoals: 1 },
    ];

    const result = augmentMatchesWithXg(matches, []);
    expect(result).toBe(matches); // misma referencia
  });

  it('T3-01c: sin matches con xG → retorna misma referencia sin cambios', () => {
    // xG existe pero no hay match correspondiente
    const matches: V3MatchRecord[] = [
      { homeTeamId: HOME, awayTeamId: AWAY, utcDate: '2026-01-10T15:00:00Z', homeGoals: 2, awayGoals: 1 },
    ];
    const xgRecords: XgRecord[] = [
      { utcDate: '2026-02-01T15:00:00Z', homeTeamId: HOME, awayTeamId: AWAY, xgHome: 1.5, xgAway: 0.8 },
    ];

    const result = augmentMatchesWithXg(matches, xgRecords);
    expect(result).toBe(matches); // misma referencia — no hubo augmentación
  });

  it('computeXgCoverage: undefined → xgUsed = false, coverageMatches = 0', () => {
    const matches: V3MatchRecord[] = [
      makeMatch(HOME, AWAY, 10, 1, 0),
      makeMatch(AWAY, HOME, 20, 2, 1),
    ];
    const cov = computeXgCoverage(matches, undefined);
    expect(cov.xgUsed).toBe(false);
    expect(cov.coverageMatches).toBe(0);
    expect(cov.totalMatches).toBe(2);
  });

  it('computeXgCoverage: cobertura total → coverageMatches = totalMatches', () => {
    const matches: V3MatchRecord[] = [
      { homeTeamId: HOME, awayTeamId: AWAY, utcDate: '2026-01-10T15:00:00Z', homeGoals: 2, awayGoals: 1 },
      { homeTeamId: AWAY, awayTeamId: HOME, utcDate: '2026-01-20T15:00:00Z', homeGoals: 0, awayGoals: 3 },
    ];
    const xgRecords: XgRecord[] = [
      { utcDate: '2026-01-10T15:00:00Z', homeTeamId: HOME, awayTeamId: AWAY, xgHome: 1.5, xgAway: 0.8 },
      { utcDate: '2026-01-20T15:00:00Z', homeTeamId: AWAY, awayTeamId: HOME, xgHome: 0.3, xgAway: 2.1 },
    ];
    const cov = computeXgCoverage(matches, xgRecords);
    expect(cov.xgUsed).toBe(true);
    expect(cov.coverageMatches).toBe(2);
    expect(cov.totalMatches).toBe(2);
  });

  it('T3-01d: runV3Engine con xG — explanation.xg_used = true, xg_coverage_matches reportado', () => {
    const input = makeBaseInput();
    // Crear xG para los primeros 4 partidos de HOME
    const xgRecords: XgRecord[] = input.currentSeasonMatches.slice(0, 4).map((m) => ({
      utcDate: m.utcDate,
      homeTeamId: m.homeTeamId,
      awayTeamId: m.awayTeamId,
      xgHome: m.homeGoals * 0.9,  // ligeramente diferente a goles reales
      xgAway: m.awayGoals * 0.9,
    }));

    const result = runV3Engine({ ...input, historicalXg: xgRecords });

    expect(result.explanation.xg_used).toBe(true);
    expect(result.explanation.xg_coverage_matches).toBe(4);
    expect(result.explanation.xg_total_matches).toBeGreaterThan(0);
    expect(result.explanation.xg_total_matches).toBe(
      input.currentSeasonMatches.filter((m) => m.utcDate < KICKOFF).length
    );
  });

  it('T3-01e: runV3Engine sin xG — xg_used = false, xg_coverage_matches = 0', () => {
    const input = makeBaseInput();
    const result = runV3Engine(input);

    expect(result.explanation.xg_used).toBe(false);
    expect(result.explanation.xg_coverage_matches).toBe(0);
  });
});

// ── T3-02: absence-adjustment (injuries) ──────────────────────────────────────

describe('T3-02: computeAbsenceMultiplier — injuries', () => {
  it('T3-02a: 3 injuries → correct weighted score + mult (§SP-V4-13 positional)', () => {
    const injuries: InjuryRecord[] = [
      { teamId: HOME, playerName: 'Player A', position: 'FWD', absenceType: 'INJURY', importance: 0.8 },
      { teamId: HOME, playerName: 'Player B', position: 'MID', absenceType: 'SUSPENSION', importance: 0.6 },
      { teamId: HOME, playerName: 'Player C', position: 'DEF', absenceType: 'INJURY', importance: 0.4 },
    ];

    const result = computeAbsenceMultiplier(HOME, AWAY, injuries, undefined);

    // absence_score_home (unified) = 0.8*1.0 + 0.6*1.0 + 0.4*1.0 = 1.8
    expect(result.absence_score_home).toBeCloseTo(1.8, 6);

    // §SP-V4-13: attackScore uses positional factors
    // FWD: 0.8 * 1.0 * POSITION_IMPACT.FWD.attackFactor / ABSENCE_IMPACT_FACTOR
    // MID: 0.6 * 1.0 * POSITION_IMPACT.MID.attackFactor / ABSENCE_IMPACT_FACTOR
    // DEF: 0.4 * 1.0 * POSITION_IMPACT.DEF.attackFactor / ABSENCE_IMPACT_FACTOR
    const attackScore =
      0.8 * POSITION_IMPACT['FWD']!.attackFactor / ABSENCE_IMPACT_FACTOR +
      0.6 * POSITION_IMPACT['MID']!.attackFactor / ABSENCE_IMPACT_FACTOR +
      0.4 * POSITION_IMPACT['DEF']!.attackFactor / ABSENCE_IMPACT_FACTOR;
    const expectedMult = Math.max(ABSENCE_MULT_MIN, 1 - attackScore * ABSENCE_IMPACT_FACTOR);
    expect(result.mult_home).toBeCloseTo(expectedMult, 6);
    expect(result.mult_home).toBeLessThan(1.0);
    expect(result.mult_away).toBe(1.0);
    expect(result.absence_count_home).toBe(3);
    expect(result.absence_count_away).toBe(0);
    expect(result.applied).toBe(true);
  });

  it('T3-02b: DOUBTFUL → 50% weight aplicado (§SP-V4-13 positional)', () => {
    const injuries: InjuryRecord[] = [
      { teamId: AWAY, playerName: 'Player D', position: 'FWD', absenceType: 'DOUBTFUL', importance: 1.0 },
    ];

    const result = computeAbsenceMultiplier(HOME, AWAY, injuries, undefined);

    // absence_score_away (unified) = 1.0 * DOUBTFUL_WEIGHT = 0.5
    expect(result.absence_score_away).toBeCloseTo(1.0 * DOUBTFUL_WEIGHT, 6);

    // §SP-V4-13: attackScore uses DOUBTFUL_WEIGHT and FWD position
    const attackScore = (1.0 * DOUBTFUL_WEIGHT) * POSITION_IMPACT['FWD']!.attackFactor / ABSENCE_IMPACT_FACTOR;
    const expectedMult = Math.max(ABSENCE_MULT_MIN, 1 - attackScore * ABSENCE_IMPACT_FACTOR);
    expect(result.mult_away).toBeCloseTo(expectedMult, 6);
    expect(result.mult_home).toBe(1.0);
    expect(result.applied).toBe(true);
  });

  it('T3-02c: score muy alto → mult clamped en ABSENCE_MULT_MIN', () => {
    // Con importance=1.0 cada uno y 6 jugadores → score = 6.0
    // mult = 1 - 6.0 * 0.04 = 0.76 < ABSENCE_MULT_MIN (0.85) → clamp
    const injuries: InjuryRecord[] = Array.from({ length: 6 }, (_, i) => ({
      teamId: HOME,
      playerName: `Player ${i}`,
      position: 'MID' as const,
      absenceType: 'INJURY' as const,
      importance: 1.0,
    }));

    const result = computeAbsenceMultiplier(HOME, AWAY, injuries, undefined);

    expect(result.mult_home).toBe(ABSENCE_MULT_MIN);
    expect(result.absence_score_home).toBe(6.0);
    expect(result.applied).toBe(true);
  });

  it('T3-02d: sin injuries → mult = 1.0, applied = false', () => {
    const result = computeAbsenceMultiplier(HOME, AWAY, undefined, undefined);

    expect(result.mult_home).toBe(1.0);
    expect(result.mult_away).toBe(1.0);
    expect(result.applied).toBe(false);
    expect(result.absence_score_home).toBe(0);
    expect(result.absence_score_away).toBe(0);
    expect(result.absence_count_home).toBe(0);
    expect(result.absence_count_away).toBe(0);
  });
});

// ── T3-POS: §SP-V4-13 Positional factors ──────────────────────────────────────

describe('T3-POS: §SP-V4-13 positional absence factors', () => {
  it('T3-POS-01: GK absence penalizes defense more than attack', () => {
    const injuries: InjuryRecord[] = [
      { teamId: HOME, playerName: 'GK Player', position: 'GK', absenceType: 'INJURY', importance: 1.0 },
    ];
    const result = computeAbsenceMultiplier(HOME, AWAY, injuries, undefined);

    // GK: attackFactor=0.01 (very small), defenseFactor=0.06 (large)
    // mult_home (attack) should be close to 1.0 (small penalty)
    // mult_defense_home should be significantly below 1.0
    expect(result.mult_home).toBeGreaterThan(result.mult_defense_home);
    // Verify actual values match formula:
    // attackScore = 1.0 * 0.01 / 0.04 = 0.25 → mult_home = 1 - 0.25*0.04 = 0.99
    expect(result.mult_home).toBeCloseTo(1 - (POSITION_IMPACT['GK']!.attackFactor / ABSENCE_IMPACT_FACTOR) * ABSENCE_IMPACT_FACTOR, 9);
    // defenseScore = 1.0 * 0.06 / 0.04 = 1.5 → mult_defense_home = 1 - 1.5*0.04 = 0.94
    expect(result.mult_defense_home).toBeCloseTo(1 - (POSITION_IMPACT['GK']!.defenseFactor / ABSENCE_IMPACT_FACTOR) * ABSENCE_IMPACT_FACTOR, 9);
  });

  it('T3-POS-02: FWD absence penalizes attack more than defense', () => {
    const injuries: InjuryRecord[] = [
      { teamId: AWAY, playerName: 'FWD Player', position: 'FWD', absenceType: 'INJURY', importance: 1.0 },
    ];
    const result = computeAbsenceMultiplier(HOME, AWAY, injuries, undefined);

    // FWD: attackFactor=0.05 (large), defenseFactor=0.01 (small)
    // mult_away (attack) should be significantly below 1.0
    // mult_defense_away should be close to 1.0
    expect(result.mult_away).toBeLessThan(result.mult_defense_away);
    // attackScore = 1.0 * 0.05 / 0.04 = 1.25 → mult_away = 1 - 1.25*0.04 = 0.95
    expect(result.mult_away).toBeCloseTo(1 - (POSITION_IMPACT['FWD']!.attackFactor / ABSENCE_IMPACT_FACTOR) * ABSENCE_IMPACT_FACTOR, 9);
    // defenseScore = 1.0 * 0.01 / 0.04 = 0.25 → mult_defense_away = 1 - 0.25*0.04 = 0.99
    expect(result.mult_defense_away).toBeCloseTo(1 - (POSITION_IMPACT['FWD']!.defenseFactor / ABSENCE_IMPACT_FACTOR) * ABSENCE_IMPACT_FACTOR, 9);
  });

  it('T3-POS-03: DEF absence has more defense impact than attack', () => {
    const injuries: InjuryRecord[] = [
      { teamId: HOME, playerName: 'DEF Player', position: 'DEF', absenceType: 'INJURY', importance: 1.0 },
    ];
    const result = computeAbsenceMultiplier(HOME, AWAY, injuries, undefined);

    // DEF: attackFactor=0.01, defenseFactor=0.035
    expect(result.mult_home).toBeGreaterThan(result.mult_defense_home);
    expect(result.mult_defense_home).toBeCloseTo(1 - (POSITION_IMPACT['DEF']!.defenseFactor / ABSENCE_IMPACT_FACTOR) * ABSENCE_IMPACT_FACTOR, 9);
  });

  it('T3-POS-04: MID absence is balanced (both attack and defense)', () => {
    const injuries: InjuryRecord[] = [
      { teamId: HOME, playerName: 'MID Player', position: 'MID', absenceType: 'INJURY', importance: 1.0 },
    ];
    const result = computeAbsenceMultiplier(HOME, AWAY, injuries, undefined);

    // MID: attackFactor=0.03, defenseFactor=0.02 — attack slightly higher
    expect(result.mult_home).toBeLessThan(result.mult_defense_home);
    expect(result.mult_home).toBeCloseTo(1 - (POSITION_IMPACT['MID']!.attackFactor / ABSENCE_IMPACT_FACTOR) * ABSENCE_IMPACT_FACTOR, 9);
    expect(result.mult_defense_home).toBeCloseTo(1 - (POSITION_IMPACT['MID']!.defenseFactor / ABSENCE_IMPACT_FACTOR) * ABSENCE_IMPACT_FACTOR, 9);
  });

  it('T3-POS-05: cross-team application — GK home absence increases lambda_away', () => {
    // GK absent from home team → home defense weakens → more goals FOR away team
    // In engine: lambda_away *= mult_away * mult_defense_home
    // mult_defense_home should be < 1 when home has GK absent
    const injuries: InjuryRecord[] = [
      { teamId: HOME, playerName: 'GK', position: 'GK', absenceType: 'INJURY', importance: 1.0 },
    ];
    const result = computeAbsenceMultiplier(HOME, AWAY, injuries, undefined);

    // mult_defense_home < 1 → away's score amplified
    expect(result.mult_defense_home).toBeLessThan(1.0);
    // mult_home (home attack) barely reduced
    expect(result.mult_home).toBeGreaterThan(result.mult_defense_home);
    // away attack unchanged
    expect(result.mult_away).toBe(1.0);
    expect(result.mult_defense_away).toBe(1.0);
  });

  it('T3-POS-06: FWD away absence → away attack penalty only (not home defense)', () => {
    const injuries: InjuryRecord[] = [
      { teamId: AWAY, playerName: 'Striker', position: 'FWD', absenceType: 'INJURY', importance: 1.0 },
    ];
    const result = computeAbsenceMultiplier(HOME, AWAY, injuries, undefined);

    // mult_away (away attack) should be penalized
    expect(result.mult_away).toBeLessThan(1.0);
    // mult_defense_away (away defense) should barely change
    expect(result.mult_defense_away).toBeGreaterThan(result.mult_away);
    // home side unaffected
    expect(result.mult_home).toBe(1.0);
    expect(result.mult_defense_home).toBe(1.0);
  });

  it('T3-POS-07: no data → all multipliers = 1.0, applied = false', () => {
    const result = computeAbsenceMultiplier(HOME, AWAY, undefined, undefined);

    expect(result.mult_home).toBe(1.0);
    expect(result.mult_away).toBe(1.0);
    expect(result.mult_defense_home).toBe(1.0);
    expect(result.mult_defense_away).toBe(1.0);
    expect(result.applied).toBe(false);
  });
});

// ── T3-03: absence-adjustment (lineup) ───────────────────────────────────────

describe('T3-03: computeAbsenceMultiplier — confirmed lineup', () => {
  it('T3-03a: Lineup detecta starter adicional no en injuries', () => {
    // No injuries. Lineup contiene un jugador con isRegularStarter=true.
    // El engine lo cuenta como starter detectado por lineup.
    const lineup: ConfirmedLineupRecord = {
      teamId: HOME,
      players: [
        { playerName: 'Starter A', position: 'FWD', isRegularStarter: true },
        { playerName: 'Sub B', position: 'DEF', isRegularStarter: false },
      ],
    };

    const result = computeAbsenceMultiplier(HOME, AWAY, undefined, [lineup]);

    // Starter A contribuye LINEUP_MISSING_STARTER_IMPORTANCE (no está en injuries)
    expect(result.absence_score_home).toBeCloseTo(LINEUP_MISSING_STARTER_IMPORTANCE, 6);
    expect(result.absence_count_home).toBe(1);
    expect(result.lineup_used_home).toBe(true);
    expect(result.applied).toBe(true);
    // AWAY sin datos
    expect(result.absence_score_away).toBe(0);
    expect(result.absence_count_away).toBe(0);
    expect(result.lineup_used_away).toBe(false);
  });

  it('T3-03b: Lineup + injuries — sin doble conteo del mismo jugador', () => {
    const injuries: InjuryRecord[] = [
      { teamId: HOME, playerName: 'Star Player', position: 'FWD', absenceType: 'INJURY', importance: 0.9 },
    ];
    const lineup: ConfirmedLineupRecord = {
      teamId: HOME,
      players: [
        // El mismo jugador que está en injuries — no debe contarse dos veces
        { playerName: 'Star Player', position: 'FWD', isRegularStarter: true },
        { playerName: 'Other Player', position: 'MID', isRegularStarter: false },
      ],
    };

    const result = computeAbsenceMultiplier(HOME, AWAY, injuries, [lineup]);

    // Solo la injury cuenta (0.9 * 1.0 = 0.9). El lineup marca lineup_used=true.
    expect(result.absence_score_home).toBeCloseTo(0.9, 6);
    expect(result.absence_count_home).toBe(1); // solo la injury
    expect(result.lineup_used_home).toBe(true); // el lineup fue consultado
    expect(result.applied).toBe(true);
  });

  it('T3-03c: Sin lineup, sin injuries → absence_adjustment_applied = false', () => {
    const result = computeAbsenceMultiplier(HOME, AWAY, undefined, undefined);

    expect(result.applied).toBe(false);
    expect(result.absence_score_home).toBe(0);
    expect(result.absence_score_away).toBe(0);
    expect(result.lineup_used_home).toBe(false);
    expect(result.lineup_used_away).toBe(false);
    expect(result.mult_home).toBe(1.0);
    expect(result.mult_away).toBe(1.0);
  });
});

// ── T3-04: market-blend ───────────────────────────────────────────────────────

describe('T3-04: blendWithMarketOdds', () => {
  it('T3-04a: odds válidas → probs blended correctamente', () => {
    const modelH = 0.50;
    const modelD = 0.25;
    const modelA = 0.25;
    const marketOdds: MarketOddsRecord = {
      probHome: 0.60,
      probDraw: 0.20,
      probAway: 0.20,
      capturedAtUtc: '2026-04-15T09:00:00Z',
    };

    const result = blendWithMarketOdds(modelH, modelD, modelA, marketOdds);

    expect(result.applied).toBe(true);
    expect(result.blend_weight).toBe(MARKET_WEIGHT);
    expect(result.invalidOdds).toBe(false);

    // Verifica valores pre-blend
    expect(result.model_prob_home_pre_blend).toBe(modelH);
    expect(result.model_prob_draw_pre_blend).toBe(modelD);
    expect(result.model_prob_away_pre_blend).toBe(modelA);
    expect(result.market_prob_home).toBe(0.60);
    expect(result.market_prob_draw).toBe(0.20);
    expect(result.market_prob_away).toBe(0.20);

    // Verifica blend: blended = (1-w)*model + w*market
    const w = MARKET_WEIGHT;
    const rawH = (1 - w) * modelH + w * 0.60;
    const rawD = (1 - w) * modelD + w * 0.20;
    const rawA = (1 - w) * modelA + w * 0.20;
    const sum = rawH + rawD + rawA;
    expect(result.prob_home).toBeCloseTo(rawH / sum, 9);
    expect(result.prob_draw).toBeCloseTo(rawD / sum, 9);
    expect(result.prob_away).toBeCloseTo(rawA / sum, 9);

    // Suma = 1.0
    expect(result.prob_home + result.prob_draw + result.prob_away).toBeCloseTo(1.0, 9);
  });

  it('T3-04b: suma de odds inválida → retorna modelo sin cambios + invalidOdds = true', () => {
    const modelH = 0.50;
    const modelD = 0.25;
    const modelA = 0.25;
    const marketOdds: MarketOddsRecord = {
      probHome: 0.50,
      probDraw: 0.30,
      probAway: 0.30, // suma = 1.10 — inválido
      capturedAtUtc: '2026-04-15T09:00:00Z',
    };

    const result = blendWithMarketOdds(modelH, modelD, modelA, marketOdds);

    expect(result.applied).toBe(false);
    expect(result.invalidOdds).toBe(true);
    expect(result.prob_home).toBe(modelH);
    expect(result.prob_draw).toBe(modelD);
    expect(result.prob_away).toBe(modelA);
    // market probs deben estar trazados
    expect(result.market_prob_home).toBe(0.50);
    expect(result.market_prob_draw).toBe(0.30);
    expect(result.market_prob_away).toBe(0.30);
  });

  it('T3-04c: undefined odds → retorna modelo sin cambios, applied = false', () => {
    const modelH = 0.50;
    const modelD = 0.25;
    const modelA = 0.25;

    const result = blendWithMarketOdds(modelH, modelD, modelA, undefined);

    expect(result.applied).toBe(false);
    expect(result.invalidOdds).toBe(false);
    expect(result.prob_home).toBe(modelH);
    expect(result.prob_draw).toBe(modelD);
    expect(result.prob_away).toBe(modelA);
    expect(result.model_prob_home_pre_blend).toBeNull();
    expect(result.market_prob_home).toBeNull();
    expect(result.blend_weight).toBe(0);
  });

  it('T3-04a: blend con odds en el borde de tolerancia (suma exactamente 1.0) — applied = true', () => {
    const marketOdds: MarketOddsRecord = {
      probHome: 1/3,
      probDraw: 1/3,
      probAway: 1/3,
      capturedAtUtc: '2026-04-15T09:00:00Z',
    };

    const result = blendWithMarketOdds(0.5, 0.3, 0.2, marketOdds);
    expect(result.applied).toBe(true);
    expect(result.prob_home + result.prob_draw + result.prob_away).toBeCloseTo(1.0, 9);
  });

  it('T3-04d: runV3Engine con marketOdds — explanation traza pre-blend y market values', () => {
    const marketOdds: MarketOddsRecord = {
      probHome: 0.55,
      probDraw: 0.25,
      probAway: 0.20,
      capturedAtUtc: '2026-04-15T09:00:00Z',
    };

    const input = makeBaseInput({ marketOdds });
    const result = runV3Engine(input);

    expect(result.explanation.market_blend_applied).toBe(true);
    expect(result.explanation.market_blend_weight).toBe(MARKET_WEIGHT);
    expect(result.explanation.market_prob_home).toBe(0.55);
    expect(result.explanation.market_prob_draw).toBe(0.25);
    expect(result.explanation.market_prob_away).toBe(0.20);
    // Pre-blend values deben estar presentes
    expect(result.explanation.model_prob_home_pre_blend).not.toBeNull();
    expect(result.explanation.model_prob_draw_pre_blend).not.toBeNull();
    expect(result.explanation.model_prob_away_pre_blend).not.toBeNull();
    // Las probs finales deben sumar 1.0
    expect(result.prob_home_win! + result.prob_draw! + result.prob_away_win!).toBeCloseTo(1.0, 9);
    // Las probs finales difieren de las pre-blend (por el blend)
    expect(result.prob_home_win).not.toBeCloseTo(result.explanation.model_prob_home_pre_blend!, 6);
  });
});

// ── T3-REG: Retrocompatibilidad ───────────────────────────────────────────────

describe('T3-REG: retrocompatibilidad — campos T3 undefined = output idéntico', () => {
  it('T3-REG: runV3Engine sin T3 campos vs con T3 campos en undefined — mismos valores númericos', () => {
    const inputBase = makeBaseInput();

    // Input sin campos T3 (explícitamente omitidos)
    const resultBase = runV3Engine(inputBase);

    // Input con campos T3 en undefined (explícitamente)
    const resultWithUndefined = runV3Engine({
      ...inputBase,
      historicalXg: undefined,
      injuries: undefined,
      confirmedLineups: undefined,
      marketOdds: undefined,
    });

    // Valores de predicción deben ser idénticos
    expect(resultWithUndefined.prob_home_win).toBe(resultBase.prob_home_win);
    expect(resultWithUndefined.prob_draw).toBe(resultBase.prob_draw);
    expect(resultWithUndefined.prob_away_win).toBe(resultBase.prob_away_win);
    expect(resultWithUndefined.lambda_home).toBe(resultBase.lambda_home);
    expect(resultWithUndefined.lambda_away).toBe(resultBase.lambda_away);
    expect(resultWithUndefined.predicted_result).toBe(resultBase.predicted_result);
    expect(resultWithUndefined.eligibility).toBe(resultBase.eligibility);
    expect(resultWithUndefined.confidence).toBe(resultBase.confidence);
  });

  it('T3-REG: defaults T3 en explanation cuando todos los campos son undefined', () => {
    const result = runV3Engine(makeBaseInput());

    // T3-01 defaults
    expect(result.explanation.xg_used).toBe(false);
    expect(result.explanation.xg_coverage_matches).toBe(0);
    expect(result.explanation.xg_total_matches).toBeGreaterThan(0);

    // T3-02/03 defaults
    expect(result.explanation.absence_score_home).toBe(0);
    expect(result.explanation.absence_score_away).toBe(0);
    expect(result.explanation.absence_mult_home).toBe(1.0);
    expect(result.explanation.absence_mult_away).toBe(1.0);
    expect(result.explanation.absence_adjustment_applied).toBe(false);
    expect(result.explanation.absence_count_home).toBe(0);
    expect(result.explanation.absence_count_away).toBe(0);
    expect(result.explanation.lineup_used_home).toBe(false);
    expect(result.explanation.lineup_used_away).toBe(false);

    // T3-04 defaults
    expect(result.explanation.market_blend_applied).toBe(false);
    expect(result.explanation.market_blend_weight).toBe(0);
    expect(result.explanation.model_prob_home_pre_blend).toBeNull();
    expect(result.explanation.model_prob_draw_pre_blend).toBeNull();
    expect(result.explanation.model_prob_away_pre_blend).toBeNull();
    expect(result.explanation.market_prob_home).toBeNull();
    expect(result.explanation.market_prob_draw).toBeNull();
    expect(result.explanation.market_prob_away).toBeNull();
  });

  it('T3-REG: NOT_ELIGIBLE output incluye defaults T3 en explanation', () => {
    // Solo 2 partidos — NOT_ELIGIBLE
    const input: V3EngineInput = {
      homeTeamId: HOME,
      awayTeamId: AWAY,
      kickoffUtc: KICKOFF,
      buildNowUtc: BUILD_NOW,
      currentSeasonMatches: [
        makeMatch(HOME, OPPONENT, 10, 1, 0),
        makeMatch(OPPONENT, AWAY, 20, 0, 1),
      ],
      prevSeasonMatches: [],
    };

    const result = runV3Engine(input);
    expect(result.eligibility).toBe('NOT_ELIGIBLE');

    // Verificar defaults T3 en NOT_ELIGIBLE
    expect(result.explanation.xg_used).toBe(false);
    expect(result.explanation.absence_adjustment_applied).toBe(false);
    expect(result.explanation.market_blend_applied).toBe(false);
    expect(result.explanation.market_prob_home).toBeNull();
  });

  it('T3-REG: injuries + marketOdds combinados — probs suman 1.0, determinismo', () => {
    const injuries: InjuryRecord[] = [
      { teamId: HOME, playerName: 'Key Player', position: 'FWD', absenceType: 'INJURY', importance: 0.8 },
    ];
    const marketOdds: MarketOddsRecord = {
      probHome: 0.45,
      probDraw: 0.28,
      probAway: 0.27,
      capturedAtUtc: '2026-04-15T09:00:00Z',
    };

    const input = makeBaseInput({ injuries, marketOdds });
    const result1 = runV3Engine(input);
    const result2 = runV3Engine(input); // mismo input → mismo output

    // Determinismo
    expect(result1.prob_home_win).toBe(result2.prob_home_win);
    expect(result1.lambda_home).toBe(result2.lambda_home);

    // Suma de probs = 1.0
    expect(result1.prob_home_win! + result1.prob_draw! + result1.prob_away_win!).toBeCloseTo(1.0, 9);

    // Absence aplica
    expect(result1.explanation.absence_adjustment_applied).toBe(true);
    // Market blend aplica
    expect(result1.explanation.market_blend_applied).toBe(true);
  });
});

// ── T3-WARN: Warning codes ────────────────────────────────────────────────────

describe('T3-WARN: warning codes T3', () => {
  it('XG_PARTIAL_COVERAGE warning cuando cobertura < 50%', () => {
    const input = makeBaseInput();
    // Crear xG solo para 1 de los ~18 partidos → cobertura < 50%
    const singleMatch = input.currentSeasonMatches.find(
      (m) => m.utcDate < KICKOFF,
    )!;
    const xgRecords: XgRecord[] = [
      {
        utcDate: singleMatch.utcDate,
        homeTeamId: singleMatch.homeTeamId,
        awayTeamId: singleMatch.awayTeamId,
        xgHome: 1.2,
        xgAway: 0.9,
      },
    ];

    const result = runV3Engine({ ...input, historicalXg: xgRecords });
    expect(result.warnings).toContain('XG_PARTIAL_COVERAGE');
  });

  it('MARKET_ODDS_INVALID warning cuando odds no suman 1.0', () => {
    const marketOdds: MarketOddsRecord = {
      probHome: 0.5,
      probDraw: 0.4,
      probAway: 0.4, // suma = 1.3 — inválido
      capturedAtUtc: '2026-04-15T09:00:00Z',
    };

    const result = runV3Engine(makeBaseInput({ marketOdds }));
    expect(result.warnings).toContain('MARKET_ODDS_INVALID');
    // Market blend NO se aplica
    expect(result.explanation.market_blend_applied).toBe(false);
  });

  it('Sin warnings T3 cuando todos los inputs T3 son válidos y undefined', () => {
    const result = runV3Engine(makeBaseInput());
    expect(result.warnings).not.toContain('XG_PARTIAL_COVERAGE');
    expect(result.warnings).not.toContain('MARKET_ODDS_INVALID');
    expect(result.warnings).not.toContain('ABSENCE_DATA_STALE');
  });
});

// ── T3-V4-12: Importance threshold (§SP-V4-12) ────────────────────────────────

describe('T3-V4-12: importance threshold in absence model', () => {
  it('Player with importance >= MIN_IMPORTANCE_THRESHOLD is included', () => {
    // MIN_IMPORTANCE_THRESHOLD = 0.3; importance=0.5 → should be included
    const injuries: InjuryRecord[] = [
      { teamId: HOME, playerName: 'Regular Starter', position: 'MID', absenceType: 'INJURY', importance: 0.5 },
    ];
    const result = computeAbsenceMultiplier(HOME, AWAY, injuries, undefined);

    // Player counted
    expect(result.absence_count_home).toBe(1);
    expect(result.absence_score_home).toBeGreaterThan(0);
    expect(result.applied).toBe(true);
  });

  it('Player with importance below threshold still affects absence score (threshold is server-side filter)', () => {
    // The engine itself has no threshold — the MIN_IMPORTANCE_THRESHOLD is applied
    // in injury-source.ts before records reach the engine.
    // A player with importance=0.1 passed to the engine WILL be counted.
    const injuries: InjuryRecord[] = [
      { teamId: HOME, playerName: 'Squad Player', position: 'MID', absenceType: 'INJURY', importance: 0.1 },
    ];
    const result = computeAbsenceMultiplier(HOME, AWAY, injuries, undefined);

    // Engine is pure — it uses what it's given (threshold enforced upstream)
    expect(result.absence_count_home).toBe(1);
    expect(result.absence_score_home).toBeCloseTo(0.1, 6);
  });

  it('Empty injuries array → no effect regardless of threshold', () => {
    const result = computeAbsenceMultiplier(HOME, AWAY, [], undefined);
    expect(result.applied).toBe(false);
    expect(result.absence_count_home).toBe(0);
  });

  it('minutesPlayed field is passthrough (informational only in engine)', () => {
    const injuries: InjuryRecord[] = [
      { teamId: HOME, playerName: 'Player', position: 'FWD', absenceType: 'INJURY', importance: 0.8, minutesPlayed: 1800 },
    ];
    const result = computeAbsenceMultiplier(HOME, AWAY, injuries, undefined);

    // minutesPlayed doesn't change engine behavior — importance is what matters
    const attackScore = 0.8 * POSITION_IMPACT['FWD']!.attackFactor / ABSENCE_IMPACT_FACTOR;
    const expectedMult = Math.max(ABSENCE_MULT_MIN, 1 - attackScore * ABSENCE_IMPACT_FACTOR);
    expect(result.mult_home).toBeCloseTo(expectedMult, 6);
  });
});
