/**
 * track1-1b.test.ts — NEXUS Track 1 Phase 1B: Injury Impact + Lineup Adjustment.
 *
 * Spec authority:
 *   - taxonomy spec S3.2 Extension 2: Injury-Adjusted Team Strength
 *   - NEXUS-0 S6.1: MISSING sentinel — never 0.0/null for absent data
 *   - entity-identity S8.1: AvailabilityState exhaustive union
 *   - entity-identity S7.1: UNRESOLVED/CONFLICTED excluded from adjustments
 *   - entity-identity types: PositionGroup = 'GK' | 'DEF' | 'MID' | 'FWD'
 *   - entity-identity constants: DOUBT_WEIGHT = 0.5
 *
 * NOTE: PositionGroup per spec uses 'FWD' (not 'ATK').
 * entity-identity/types.ts line 101: export type PositionGroup = 'GK' | 'DEF' | 'MID' | 'FWD'
 */

import { describe, test, expect } from 'vitest';
import { MISSING } from '../../src/nexus/feature-store/types.js';
import {
  computeInjuryImpact,
  DEFAULT_POSITION_IMPACT_WEIGHTS,
  MAX_ABSENCE_ADJUSTMENT,
  type PlayerAbsence,
  type InjuryImpactResult,
} from '../../src/nexus/track1/injury-impact.js';
import {
  computeLineupAdjustment,
  type LineupAdjustmentResult,
} from '../../src/nexus/track1/lineup-adjuster.js';
import { computeTrack1 } from '../../src/nexus/track1/track1-engine.js';
import type { BaselineSquad, CanonicalPlayer } from '../../src/nexus/entity-identity/types.js';
import type { HistoricalMatch } from '../../src/nexus/track1/types.js';

// ── Test fixtures ──────────────────────────────────────────────────────────

const BUILD_NOW = '2025-01-15T10:00:00Z';

function makeGkPlayer(id: string): CanonicalPlayer {
  return {
    canonicalPlayerId: id,
    resolution: 'RESOLVED',
    externalIds: {},
    displayName: `Player ${id}`,
    normalizedName: `player ${id}`,
    dateOfBirth: null,
    primaryPosition: 'GK',
    secondaryPosition: null,
    nationality: null,
  };
}

function makeOutfieldPlayer(id: string): CanonicalPlayer {
  return {
    canonicalPlayerId: id,
    resolution: 'RESOLVED',
    externalIds: {},
    displayName: `Player ${id}`,
    normalizedName: `player ${id}`,
    dateOfBirth: null,
    primaryPosition: 'CB',
    secondaryPosition: null,
    nationality: null,
  };
}

function makeMatch(
  homeGoals: number,
  awayGoals: number,
  homeTeamId = 'teamA',
  awayTeamId = 'teamB',
): HistoricalMatch {
  return {
    homeTeamId,
    awayTeamId,
    utcDate: '2024-10-01T20:00:00Z',
    homeGoals,
    awayGoals,
    isNeutralVenue: false,
  };
}

const mockHistory: HistoricalMatch[] = [
  makeMatch(2, 1),
  makeMatch(1, 1),
  makeMatch(3, 0),
];

// ── computeInjuryImpact tests ──────────────────────────────────────────────

describe('computeInjuryImpact', () => {
  // Test 1: GK absence > MID absence
  test('T1B-01: arquero ausente confirmado tiene mayor impact que mediocampista ausente', () => {
    // taxonomy spec S3.2 Extension 2: position weights GK > MID
    const gkAbsence: PlayerAbsence[] = [
      { canonicalPlayerId: 'p1', position: 'GK', availability: 'CONFIRMED_ABSENT' },
    ];
    const midAbsence: PlayerAbsence[] = [
      { canonicalPlayerId: 'p2', position: 'MID', availability: 'CONFIRMED_ABSENT' },
    ];

    const gkResult = computeInjuryImpact(gkAbsence, true, BUILD_NOW);
    const midResult = computeInjuryImpact(midAbsence, true, BUILD_NOW);

    // Both should be numbers when data is available
    expect(typeof gkResult.injury_impact_score.value).toBe('number');
    expect(typeof midResult.injury_impact_score.value).toBe('number');

    // GK weight (0.18) > MID weight (0.08)
    expect(gkResult.injury_impact_score.value as number).toBeGreaterThan(
      midResult.injury_impact_score.value as number,
    );
  });

  // Test 2: No data → MISSING, not 0.0
  test('T1B-02: sin datos de lesiones retorna MISSING, no cero', () => {
    // NEXUS-0 S6.1: "Missing data is information, not an error."
    // Never represent absence of data as 0.0 or null.
    const result = computeInjuryImpact([], false, BUILD_NOW);

    expect(result.injury_data_available).toBe(false);
    expect(result.injury_impact_score.value).toBe(MISSING);
    // Explicit check: not zero (0 == false in JS, so check both)
    expect(result.injury_impact_score.value).not.toBe(0);
    expect(result.injury_impact_score.value).not.toBe(0.0);
    expect(result.injury_impact_score.value).not.toBeNull();
    expect(result.injury_impact_score.value).not.toBe(undefined);
  });

  // Test 3: DOUBT applies 50% weight
  test('T1B-03: DOUBT aplica 50% del peso vs CONFIRMED_ABSENT', () => {
    // entity-identity DOUBT_WEIGHT = 0.5
    // taxonomy spec S3.2 Ext 2: DOUBT treated with partial confidence
    const confirmed: PlayerAbsence[] = [
      { canonicalPlayerId: 'p1', position: 'DEF', availability: 'CONFIRMED_ABSENT' },
    ];
    const doubt: PlayerAbsence[] = [
      { canonicalPlayerId: 'p1', position: 'DEF', availability: 'DOUBT' },
    ];

    const scoreConfirmed = computeInjuryImpact(confirmed, true, BUILD_NOW)
      .injury_impact_score.value as number;
    const scoreDoubt = computeInjuryImpact(doubt, true, BUILD_NOW)
      .injury_impact_score.value as number;

    expect(scoreDoubt).toBeCloseTo(scoreConfirmed * 0.5, 5);
  });

  // Test 4: dataAvailable=true, empty absences → 0 (no absences = 0 impact)
  test('T1B-04: sin ausencias pero con datos disponibles retorna 0 (no impact)', () => {
    const result = computeInjuryImpact([], true, BUILD_NOW);

    expect(result.injury_data_available).toBe(true);
    expect(result.injury_impact_score.value).toBe(0);
    expect(result.injury_impact_score.value).not.toBe(MISSING);
  });

  // Test 5: Multiple absences accumulate and cap at MAX_ABSENCE_ADJUSTMENT
  test('T1B-05: muchas ausencias se acumulan y capcean en MAX_ABSENCE_ADJUSTMENT (0.20)', () => {
    // taxonomy spec S3.2 Ext 2: "capped by MAX_ABSENCE_ADJUSTMENT (default 0.20)"
    const absences: PlayerAbsence[] = [
      { canonicalPlayerId: 'p1', position: 'GK', availability: 'CONFIRMED_ABSENT' },  // 0.18
      { canonicalPlayerId: 'p2', position: 'DEF', availability: 'CONFIRMED_ABSENT' }, // 0.12
      { canonicalPlayerId: 'p3', position: 'MID', availability: 'CONFIRMED_ABSENT' }, // 0.08
      { canonicalPlayerId: 'p4', position: 'FWD', availability: 'CONFIRMED_ABSENT' }, // 0.06
    ];
    // Sum = 0.44, cap = 0.20

    const result = computeInjuryImpact(absences, true, BUILD_NOW);
    expect(result.injury_impact_score.value as number).toBe(MAX_ABSENCE_ADJUSTMENT);
    expect(result.injury_impact_score.value as number).toBeLessThanOrEqual(0.20);
  });

  // Test 6: absences_by_position counts correctly
  test('T1B-06: absences_by_position contabiliza correctamente por posición', () => {
    const absences: PlayerAbsence[] = [
      { canonicalPlayerId: 'p1', position: 'DEF', availability: 'CONFIRMED_ABSENT' },
      { canonicalPlayerId: 'p2', position: 'DEF', availability: 'DOUBT' },
      { canonicalPlayerId: 'p3', position: 'MID', availability: 'CONFIRMED_ABSENT' },
    ];

    const result = computeInjuryImpact(absences, true, BUILD_NOW);

    expect(result.absences_by_position['DEF']).toBe(2);
    expect(result.absences_by_position['MID']).toBe(1);
    expect(result.absences_by_position['GK']).toBeUndefined();
  });

  // Test 7: doubt_weight_applied is true when any DOUBT absence
  test('T1B-07: doubt_weight_applied=true cuando hay al menos un DOUBT', () => {
    const withDoubt: PlayerAbsence[] = [
      { canonicalPlayerId: 'p1', position: 'MID', availability: 'DOUBT' },
    ];
    const withoutDoubt: PlayerAbsence[] = [
      { canonicalPlayerId: 'p2', position: 'MID', availability: 'CONFIRMED_ABSENT' },
    ];

    expect(computeInjuryImpact(withDoubt, true, BUILD_NOW).doubt_weight_applied).toBe(true);
    expect(computeInjuryImpact(withoutDoubt, true, BUILD_NOW).doubt_weight_applied).toBe(false);
  });

  // Test 8: provenance source is 'api-football'
  test('T1B-08: provenance source es api-football', () => {
    const result = computeInjuryImpact([], true, BUILD_NOW);
    expect(result.injury_impact_score.provenance.source).toBe('api-football');
  });

  // Test 9: MISSING state → confidence is UNKNOWN
  test('T1B-09: estado MISSING → confidence es UNKNOWN', () => {
    const result = computeInjuryImpact([], false, BUILD_NOW);
    expect(result.injury_impact_score.provenance.confidence).toBe('UNKNOWN');
  });

  // Test 10: FWD position weight matches DEFAULT
  test('T1B-10: peso FWD en DEFAULT_POSITION_IMPACT_WEIGHTS es 0.06', () => {
    // Confirm 'FWD' is the correct key (not 'ATK') per entity-identity types
    expect(DEFAULT_POSITION_IMPACT_WEIGHTS['FWD']).toBe(0.06);
    expect(DEFAULT_POSITION_IMPACT_WEIGHTS['GK']).toBe(0.18);
    expect(DEFAULT_POSITION_IMPACT_WEIGHTS['DEF']).toBe(0.12);
    expect(DEFAULT_POSITION_IMPACT_WEIGHTS['MID']).toBe(0.08);
  });

  // Test 11: FWD absence impact is correct
  test('T1B-11: delantero (FWD) ausente usa peso 0.06', () => {
    const fwdAbsence: PlayerAbsence[] = [
      { canonicalPlayerId: 'p1', position: 'FWD', availability: 'CONFIRMED_ABSENT' },
    ];

    const result = computeInjuryImpact(fwdAbsence, true, BUILD_NOW);
    expect(result.injury_impact_score.value as number).toBeCloseTo(0.06, 5);
  });
});

// ── computeLineupAdjustment tests ─────────────────────────────────────────

describe('computeLineupAdjustment', () => {
  // Test 12: null lineup → MISSING
  test('T1B-12: squad sin confirmed_lineup retorna MISSING en strength_delta', () => {
    // NEXUS-0 S4.4, entity-identity S8.3: lineup never inferred.
    const squad: BaselineSquad = {
      teamId: 't1',
      baselinePlayers: [],
      confirmedAbsences: [],
      confirmedLineup: null,
    };

    const result = computeLineupAdjustment(squad, BUILD_NOW);

    expect(result.lineup_available).toBe(false);
    expect(result.strength_delta.value).toBe(MISSING);
    expect(result.strength_delta.value).not.toBe(0);
    expect(result.strength_delta.value).not.toBeNull();
  });

  // Test 13: Lineup available → numeric strength_delta
  test('T1B-13: lineup confirmada retorna strength_delta numérico', () => {
    const gk = makeGkPlayer('gk1');
    const squad: BaselineSquad = {
      teamId: 't1',
      baselinePlayers: [gk],
      confirmedAbsences: [],
      confirmedLineup: [gk],
    };

    const result = computeLineupAdjustment(squad, BUILD_NOW);

    expect(result.lineup_available).toBe(true);
    expect(typeof result.strength_delta.value).toBe('number');
    expect(result.strength_delta.value).not.toBe(MISSING);
  });

  // Test 14: GK in lineup → neutral delta (0)
  test('T1B-14: arquero de baseline en lineup → delta neutro (0)', () => {
    const gk = makeGkPlayer('gk1');
    const squad: BaselineSquad = {
      teamId: 't1',
      baselinePlayers: [gk],
      confirmedAbsences: [],
      confirmedLineup: [gk],
    };

    const result = computeLineupAdjustment(squad, BUILD_NOW);
    expect(result.strength_delta.value).toBe(0);
  });

  // Test 15: GK NOT in lineup → negative delta
  test('T1B-15: arquero de baseline ausente en lineup → delta negativo', () => {
    const gk = makeGkPlayer('gk1');
    const outfield = makeOutfieldPlayer('def1');
    const squad: BaselineSquad = {
      teamId: 't1',
      baselinePlayers: [gk, outfield],
      confirmedAbsences: [],
      // Lineup published without the baseline GK
      confirmedLineup: [outfield],
    };

    const result = computeLineupAdjustment(squad, BUILD_NOW);

    expect(result.lineup_available).toBe(true);
    expect(result.strength_delta.value as number).toBeLessThan(0);
  });

  // Test 16: No baseline GK → neutral delta (no GK to miss)
  test('T1B-16: sin arquero en baseline → delta neutro (ninguno que echar de menos)', () => {
    const outfield = makeOutfieldPlayer('def1');
    const squad: BaselineSquad = {
      teamId: 't1',
      baselinePlayers: [outfield],
      confirmedAbsences: [],
      confirmedLineup: [outfield],
    };

    const result = computeLineupAdjustment(squad, BUILD_NOW);
    expect(result.strength_delta.value).toBe(0);
  });

  // Test 17: effective_squad_size matches confirmed lineup size
  test('T1B-17: effective_squad_size refleja el tamaño del lineup confirmado', () => {
    const players = [
      makeGkPlayer('gk1'),
      makeOutfieldPlayer('def1'),
      makeOutfieldPlayer('def2'),
    ];
    const squad: BaselineSquad = {
      teamId: 't1',
      baselinePlayers: players,
      confirmedAbsences: [],
      confirmedLineup: players,
    };

    const result = computeLineupAdjustment(squad, BUILD_NOW);
    expect(result.effective_squad_size).toBe(3);
  });

  // Test 18: MISSING lineup → confidence is UNKNOWN
  test('T1B-18: lineup no disponible → confidence es UNKNOWN', () => {
    const squad: BaselineSquad = {
      teamId: 't1',
      baselinePlayers: [],
      confirmedAbsences: [],
      confirmedLineup: null,
    };

    const result = computeLineupAdjustment(squad, BUILD_NOW);
    expect(result.strength_delta.provenance.confidence).toBe('UNKNOWN');
  });

  // Test 19: Available lineup → confidence is HIGH
  test('T1B-19: lineup disponible → confidence es HIGH', () => {
    const gk = makeGkPlayer('gk1');
    const squad: BaselineSquad = {
      teamId: 't1',
      baselinePlayers: [gk],
      confirmedAbsences: [],
      confirmedLineup: [gk],
    };

    const result = computeLineupAdjustment(squad, BUILD_NOW);
    expect(result.strength_delta.provenance.confidence).toBe('HIGH');
  });
});

// ── computeTrack1 Phase 1B integration tests ──────────────────────────────

describe('computeTrack1 Phase 1B integration', () => {
  // Test 20: Without phase1bOptions → injury_data_available=false for both
  test('T1B-20: computeTrack1 sin absences → injury_data_available=false para ambos equipos', () => {
    // NEXUS-0 S6.1: explicit missingness when no injury data provided
    const output = computeTrack1(
      'teamA',
      'teamB',
      mockHistory,
      false,
      'PD',
      BUILD_NOW,
      undefined,
      undefined, // no phase1bOptions
    );

    // Both injury impacts present (default MISSING state)
    expect(output.homeStrength.injuryImpact).toBeDefined();
    expect(output.awayStrength.injuryImpact).toBeDefined();
    expect(output.homeStrength.injuryImpact!.injury_data_available).toBe(false);
    expect(output.awayStrength.injuryImpact!.injury_data_available).toBe(false);
    // MISSING sentinel, not 0
    expect(output.homeStrength.injuryImpact!.injury_impact_score.value).toBe(MISSING);
    expect(output.awayStrength.injuryImpact!.injury_impact_score.value).toBe(MISSING);
  });

  // Test 21: With injuryDataAvailable=false → MISSING for both
  test('T1B-21: phase1bOptions con injuryDataAvailable=false → MISSING para ambos', () => {
    const output = computeTrack1(
      'teamA',
      'teamB',
      mockHistory,
      false,
      'PD',
      BUILD_NOW,
      undefined,
      { injuryDataAvailable: false },
    );

    expect(output.homeStrength.injuryImpact!.injury_data_available).toBe(false);
    expect(output.awayStrength.injuryImpact!.injury_data_available).toBe(false);
    expect(output.homeStrength.injuryImpact!.injury_impact_score.value).toBe(MISSING);
  });

  // Test 22: With injury data and absences → numeric impact
  test('T1B-22: con datos de lesiones y ausencias → impact numérico', () => {
    const homeAbsences: PlayerAbsence[] = [
      { canonicalPlayerId: 'p1', position: 'GK', availability: 'CONFIRMED_ABSENT' },
    ];

    const output = computeTrack1(
      'teamA',
      'teamB',
      mockHistory,
      false,
      'PD',
      BUILD_NOW,
      undefined,
      {
        injuryDataAvailable: true,
        homeAbsences,
        awayAbsences: [],
      },
    );

    expect(output.homeStrength.injuryImpact!.injury_data_available).toBe(true);
    expect(typeof output.homeStrength.injuryImpact!.injury_impact_score.value).toBe('number');
    expect(output.homeStrength.injuryImpact!.injury_impact_score.value).toBe(
      DEFAULT_POSITION_IMPACT_WEIGHTS['GK'],
    );
    // Away with no absences → 0
    expect(output.awayStrength.injuryImpact!.injury_impact_score.value).toBe(0);
  });

  // Test 23: Without squad → lineupAdjustment=undefined
  test('T1B-23: sin homeSquad/awaySquad → lineupAdjustment=undefined', () => {
    const output = computeTrack1(
      'teamA',
      'teamB',
      mockHistory,
      false,
      'PD',
      BUILD_NOW,
    );

    expect(output.homeStrength.lineupAdjustment).toBeUndefined();
    expect(output.awayStrength.lineupAdjustment).toBeUndefined();
  });

  // Test 24: With squad provided → lineupAdjustment defined
  test('T1B-24: con homeSquad provisto → lineupAdjustment definido', () => {
    const gk = makeGkPlayer('gk1');
    const squad: BaselineSquad = {
      teamId: 'teamA',
      baselinePlayers: [gk],
      confirmedAbsences: [],
      confirmedLineup: [gk],
    };

    const output = computeTrack1(
      'teamA',
      'teamB',
      mockHistory,
      false,
      'PD',
      BUILD_NOW,
      undefined,
      { homeSquad: squad },
    );

    expect(output.homeStrength.lineupAdjustment).toBeDefined();
    expect(output.homeStrength.lineupAdjustment!.lineup_available).toBe(true);
    // Away squad not provided → undefined
    expect(output.awayStrength.lineupAdjustment).toBeUndefined();
  });

  // Test 25: Phase 1A backward compatibility — no phase1bOptions, existing tests still pass
  test('T1B-25: compatibilidad hacia atrás — sin phase1bOptions, output Phase 1A intacto', () => {
    const output = computeTrack1(
      'teamA',
      'teamB',
      mockHistory,
      false,
      'PD',
      BUILD_NOW,
    );

    // Phase 1A fields all intact
    expect(output.homeStrength.teamId).toBe('teamA');
    expect(output.awayStrength.teamId).toBe('teamB');
    expect(typeof output.homeStrength.eloRating).toBe('number');
    expect(typeof output.awayStrength.eloRating).toBe('number');
    expect(output.isNeutralVenue).toBe(false);
    expect(output.leagueHomeAdvantage.leagueId).toBe('PD');
    // Phase 1A didn't have lineupAdjustment → should be undefined when no squad passed
    expect(output.homeStrength.lineupAdjustment).toBeUndefined();
  });

  // Test 26: neutral venue + Phase 1B injury data
  test('T1B-26: venue neutral + datos de lesiones → homeAdvantageAdjusted=0, injury_impact numérico', () => {
    const homeAbsences: PlayerAbsence[] = [
      { canonicalPlayerId: 'p1', position: 'DEF', availability: 'CONFIRMED_ABSENT' },
    ];

    const output = computeTrack1(
      'teamA',
      'teamB',
      mockHistory,
      true, // neutral venue
      'PD',
      BUILD_NOW,
      undefined,
      { injuryDataAvailable: true, homeAbsences },
    );

    // taxonomy spec S3.2 Ext 1: neutral venue → homeAdvantageAdjusted = 0
    expect(output.homeStrength.homeAdvantageAdjusted).toBe(0);
    // Phase 1B injury impact still computed
    expect(output.homeStrength.injuryImpact!.injury_data_available).toBe(true);
    expect(output.homeStrength.injuryImpact!.injury_impact_score.value).toBe(
      DEFAULT_POSITION_IMPACT_WEIGHTS['DEF'],
    );
  });

  // Test 27: DOUBT in track1 produces correct impact (50% of DEF weight)
  test('T1B-27: DOUBT via computeTrack1 produce 50% del peso DEF', () => {
    const absencesDoubt: PlayerAbsence[] = [
      { canonicalPlayerId: 'p1', position: 'DEF', availability: 'DOUBT' },
    ];
    const absencesConfirmed: PlayerAbsence[] = [
      { canonicalPlayerId: 'p1', position: 'DEF', availability: 'CONFIRMED_ABSENT' },
    ];

    const outputDoubt = computeTrack1(
      'teamA', 'teamB', mockHistory, false, 'PD', BUILD_NOW,
      undefined,
      { injuryDataAvailable: true, homeAbsences: absencesDoubt },
    );
    const outputConfirmed = computeTrack1(
      'teamA', 'teamB', mockHistory, false, 'PD', BUILD_NOW,
      undefined,
      { injuryDataAvailable: true, homeAbsences: absencesConfirmed },
    );

    const doubtImpact = outputDoubt.homeStrength.injuryImpact!.injury_impact_score.value as number;
    const confirmedImpact = outputConfirmed.homeStrength.injuryImpact!.injury_impact_score.value as number;

    expect(doubtImpact).toBeCloseTo(confirmedImpact * 0.5, 5);
  });
});
