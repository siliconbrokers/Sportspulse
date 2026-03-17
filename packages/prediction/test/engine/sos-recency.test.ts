/**
 * sos-recency.test.ts — SP-V4-05: SoS-weighted recency delta.
 *
 * Invariants tested:
 *   1. SOS_SENSITIVITY=0 → result is bit-exact to pre-SP-V4-05 uniform average
 *   2. SOS_SENSITIVITY>0 + all rivalStrength undefined → bit-exact to uniform (fallback weight=1.0)
 *   3. SOS_SENSITIVITY>0 + stronger rivals → higher effective weight on those matches
 *   4. SOS_SENSITIVITY>0 + weaker rivals → lower effective weight on those matches
 *   5. Weight floor: weight = max(0, ...) — never negative
 *   6. totalGames < MIN_GAMES_FOR_RECENCY → always returns deltas=1.0 regardless of SoS
 *   7. All rivalStrengths=1.0 → result equals uniform average
 *   8. MatchSignalRA.rivalStrength field is optional (backward-compatible)
 *   9. computeMatchSignalsRA populates rivalStrength when opp has sufficient games
 *  10. computeMatchSignalsRA sets rivalStrength=undefined when opp has < RA_MIN_RIVAL_GAMES
 */

import { describe, it, expect } from 'vitest';
import { computeRecencyDeltas } from '../../src/engine/v3/recency.js';
import { computeMatchSignalsRA } from '../../src/engine/v3/rival-adjustment.js';
import {
  SOS_SENSITIVITY,
  MIN_GAMES_FOR_RECENCY,
  N_RECENT,
  RA_MIN_RIVAL_GAMES,
  RECENCY_DELTA_MIN,
  RECENCY_DELTA_MAX,
} from '../../src/engine/v3/constants.js';
import type { MatchSignalRA, V3MatchRecord } from '../../src/engine/v3/types.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeSignal(attack: number, defense: number, rivalStrength?: number): MatchSignalRA {
  return { utcDate: '2025-10-01T00:00:00Z', attack_signal: attack, defense_signal: defense, rivalStrength };
}

/** Build N signals with sequential dates so slice(-N_RECENT) is deterministic */
function makeSignals(count: number, attack: number, defense: number, rivalStrength?: number): MatchSignalRA[] {
  return Array.from({ length: count }, (_, i) => ({
    utcDate: `2025-${String(Math.floor(i / 30) + 10).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
    attack_signal: attack,
    defense_signal: defense,
    rivalStrength,
  }));
}

// ── Test 1: SOS_SENSITIVITY = 0 → bit-exact to uniform average ────────────

describe('SP-V4-05 — SoS Weighted Recency', () => {
  it('1. SOS_SENSITIVITY=0 → bit-exact match to uniform average', () => {
    const signals = makeSignals(MIN_GAMES_FOR_RECENCY + 2, 1.5, 0.8, 1.3);
    const seasonAttack = 1.2;
    const seasonDefense = 1.0;

    const resultUniform = computeRecencyDeltas(signals, MIN_GAMES_FOR_RECENCY + 2, seasonAttack, seasonDefense, 0.0);
    const resultDefault = computeRecencyDeltas(signals, MIN_GAMES_FOR_RECENCY + 2, seasonAttack, seasonDefense);

    // SOS_SENSITIVITY is 0 by default
    expect(SOS_SENSITIVITY).toBe(0.0);
    // Results should match because both use uniform weights
    expect(resultUniform.delta_attack).toBeCloseTo(resultDefault.delta_attack, 12);
    expect(resultUniform.delta_defense).toBeCloseTo(resultDefault.delta_defense, 12);
    expect(resultUniform.applied).toBe(true);
  });

  // ── Test 2: SOS > 0 + all rivalStrength undefined → uniform fallback ───

  it('2. SOS_SENSITIVITY>0 + all rivalStrength undefined → equals uniform average', () => {
    const signals = makeSignals(MIN_GAMES_FOR_RECENCY + 3, 2.0, 1.2, undefined); // no rivalStrength
    const seasonAttack = 1.8;
    const seasonDefense = 1.1;

    const uniformResult = computeRecencyDeltas(signals, MIN_GAMES_FOR_RECENCY + 3, seasonAttack, seasonDefense, 0.0);
    const sosResult     = computeRecencyDeltas(signals, MIN_GAMES_FOR_RECENCY + 3, seasonAttack, seasonDefense, 0.2);

    // When all rivalStrength = undefined → weight = 1.0 for all → same as uniform
    expect(sosResult.delta_attack).toBeCloseTo(uniformResult.delta_attack, 12);
    expect(sosResult.delta_defense).toBeCloseTo(uniformResult.delta_defense, 12);
  });

  // ── Test 3: SOS > 0 + stronger rivals → higher effective weight ────────

  it('3. SOS_SENSITIVITY>0: match against stronger rival has higher weight', () => {
    // Last N_RECENT signals: 4 signals with weak rival (rs=0.5) + 1 signal with strong rival (rs=2.0)
    // The strong-rival match has a high attack value; with SoS weighting it should pull the avg up
    const weakBase = makeSignals(MIN_GAMES_FOR_RECENCY, 1.0, 1.0, 0.5); // weak rivals
    const strongMatch: MatchSignalRA = {
      utcDate: '2026-03-01T00:00:00Z',
      attack_signal: 3.0, // high attack vs strong rival
      defense_signal: 0.5,
      rivalStrength: 2.0,
    };
    const signals = [...weakBase, strongMatch]; // strongMatch is the last one (most recent)
    const seasonAttack = 1.2;
    const seasonDefense = 1.0;

    const uniformResult = computeRecencyDeltas(signals, signals.length, seasonAttack, seasonDefense, 0.0);
    const sosResult     = computeRecencyDeltas(signals, signals.length, seasonAttack, seasonDefense, 0.3);

    // With SoS weighting, the strong-rival match gets weight = 1 + 0.3*(2.0-1.0) = 1.3
    // Weak rivals get weight = 1 + 0.3*(0.5-1.0) = 0.85
    // → SoS result should emphasize the 3.0 attack match more → higher delta_attack
    expect(sosResult.delta_attack).toBeGreaterThan(uniformResult.delta_attack);
  });

  // ── Test 4: SOS > 0 + weaker rivals → lower effective weight ──────────

  it('4. SOS_SENSITIVITY>0: match against weaker rival has lower weight', () => {
    // Last N_RECENT signals: 4 signals with strong rival (rs=2.0) + 1 signal with weak rival (rs=0.3)
    // The weak-rival match has a high attack value; with SoS weighting it should pull the avg down
    const strongBase = makeSignals(MIN_GAMES_FOR_RECENCY, 1.0, 1.0, 2.0); // strong rivals
    const weakMatch: MatchSignalRA = {
      utcDate: '2026-03-01T00:00:00Z',
      attack_signal: 4.0, // very high attack vs weak rival
      defense_signal: 0.2,
      rivalStrength: 0.3, // weak rival
    };
    const signals = [...strongBase, weakMatch];
    const seasonAttack = 1.2;
    const seasonDefense = 1.0;

    const uniformResult = computeRecencyDeltas(signals, signals.length, seasonAttack, seasonDefense, 0.0);
    const sosResult     = computeRecencyDeltas(signals, signals.length, seasonAttack, seasonDefense, 0.3);

    // With SoS weighting, the weak-rival match gets weight = 1 + 0.3*(0.3-1.0) = 0.79
    // → the inflated 4.0 attack vs weak rival is downweighted → lower delta_attack vs uniform
    expect(sosResult.delta_attack).toBeLessThan(uniformResult.delta_attack);
  });

  // ── Test 5: Weight floor — never negative ──────────────────────────────

  it('5. Weight floor: weight = max(0, ...) → non-negative even with extreme SoS + weak rival', () => {
    // rivalStrength = 0.0 (extreme), SOS_SENSITIVITY = 5.0 → raw weight = 1 + 5*(0-1) = -4 → clipped to 0
    const signals: MatchSignalRA[] = [
      makeSignal(2.0, 2.0, 0.0), // extreme weak rival
      makeSignal(1.0, 1.0, 1.0), // neutral
      makeSignal(1.0, 1.0, 1.0),
      makeSignal(1.0, 1.0, 1.0),
      makeSignal(1.0, 1.0, 1.0),
    ];
    // Should not throw; when extreme signal weight=0, total weight may be non-zero from others
    const result = computeRecencyDeltas(signals, MIN_GAMES_FOR_RECENCY, 1.0, 1.0, 5.0);
    expect(result.delta_attack).toBeGreaterThanOrEqual(RECENCY_DELTA_MIN);
    expect(result.delta_attack).toBeLessThanOrEqual(RECENCY_DELTA_MAX);
    expect(result.delta_defense).toBeGreaterThanOrEqual(RECENCY_DELTA_MIN);
    expect(result.delta_defense).toBeLessThanOrEqual(RECENCY_DELTA_MAX);
  });

  // ── Test 6: Not enough games → deltas = 1.0 regardless of SoS ─────────

  it('6. totalGames < MIN_GAMES_FOR_RECENCY → deltas=1.0 regardless of SoS', () => {
    const signals = makeSignals(5, 3.0, 0.1, 2.0); // strong rivals, high attack
    const result = computeRecencyDeltas(signals, MIN_GAMES_FOR_RECENCY - 1, 1.5, 1.0, 0.3);
    expect(result.delta_attack).toBe(1.0);
    expect(result.delta_defense).toBe(1.0);
    expect(result.applied).toBe(false);
  });

  // ── Test 7: All rivalStrength = 1.0 → equals uniform average ──────────

  it('7. All rivalStrength = 1.0 → equals uniform average at any SoS', () => {
    const signals = makeSignals(MIN_GAMES_FOR_RECENCY + 2, 1.8, 0.9, 1.0); // all rivalStrength=1.0
    const seasonAttack = 1.4;
    const seasonDefense = 1.0;

    const uniformResult = computeRecencyDeltas(signals, MIN_GAMES_FOR_RECENCY + 2, seasonAttack, seasonDefense, 0.0);
    const sosResult     = computeRecencyDeltas(signals, MIN_GAMES_FOR_RECENCY + 2, seasonAttack, seasonDefense, 0.25);

    // weight_i = 1 + SoS * (1.0 - 1.0) = 1 → all weights equal → same as uniform
    expect(sosResult.delta_attack).toBeCloseTo(uniformResult.delta_attack, 12);
    expect(sosResult.delta_defense).toBeCloseTo(uniformResult.delta_defense, 12);
  });

  // ── Test 8: MatchSignalRA.rivalStrength is optional (type check) ───────

  it('8. MatchSignalRA.rivalStrength is optional — signals without it are valid', () => {
    // Verify that signals without rivalStrength compile and run correctly
    const signals: MatchSignalRA[] = makeSignals(MIN_GAMES_FOR_RECENCY + 1, 1.5, 0.8); // no rivalStrength
    const result = computeRecencyDeltas(signals, MIN_GAMES_FOR_RECENCY + 1, 1.2, 1.0, 0.15);
    expect(result.applied).toBe(true);
    expect(result.delta_attack).toBeGreaterThanOrEqual(RECENCY_DELTA_MIN);
    expect(result.delta_attack).toBeLessThanOrEqual(RECENCY_DELTA_MAX);
  });

  // ── Test 9: computeMatchSignalsRA populates rivalStrength when opp has data ──

  it('9. computeMatchSignalsRA: rivalStrength populated when opp has >= RA_MIN_RIVAL_GAMES', () => {
    // Build RA_MIN_RIVAL_GAMES matches for opponent so it has enough data
    const teamId = 'team-A';
    const opponentId = 'team-B';
    const matches: V3MatchRecord[] = Array.from({ length: RA_MIN_RIVAL_GAMES + 2 }, (_, i) => ({
      homeTeamId: teamId,
      awayTeamId: opponentId,
      utcDate: `2025-10-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      homeGoals: 2,
      awayGoals: 1,
    }));

    const signals = computeMatchSignalsRA(
      matches,
      teamId,
      (_oppId) => ({ attack_eff: 1.2, defense_eff: 0.9, games: RA_MIN_RIVAL_GAMES + 2 }),
    );

    expect(signals.length).toBeGreaterThan(0);
    for (const s of signals) {
      // rivalStrength should be populated: (1.2 + 0.9) / 2 = 1.05
      expect(s.rivalStrength).toBeDefined();
      expect(s.rivalStrength).toBeCloseTo((1.2 + 0.9) / 2, 10);
    }
  });

  // ── Test 10: computeMatchSignalsRA sets rivalStrength=undefined for insufficient opp data ──

  it('10. computeMatchSignalsRA: rivalStrength=undefined when opp has < RA_MIN_RIVAL_GAMES', () => {
    const teamId = 'team-A';
    const opponentId = 'team-B';
    const matches: V3MatchRecord[] = Array.from({ length: 5 }, (_, i) => ({
      homeTeamId: teamId,
      awayTeamId: opponentId,
      utcDate: `2025-10-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      homeGoals: 1,
      awayGoals: 0,
    }));

    const signals = computeMatchSignalsRA(
      matches,
      teamId,
      (_oppId) => ({ attack_eff: 1.1, defense_eff: 0.8, games: RA_MIN_RIVAL_GAMES - 1 }), // not enough
    );

    expect(signals.length).toBeGreaterThan(0);
    for (const s of signals) {
      expect(s.rivalStrength).toBeUndefined();
    }
  });

  // ── SoS_SENSITIVITY = 0 is the global default (verified after sweep) ───

  it('SOS_SENSITIVITY constant is 0.0 (optimal per sweep — rival_adjustment already captures SoS effect)', () => {
    expect(SOS_SENSITIVITY).toBe(0.0);
  });
});
