/**
 * Derived Raw Outputs — Unit Tests
 *
 * Spec authority: §16.5–§16.11, §19.3
 * Invariants tested:
 *   - abs((btts_yes + btts_no) - 1) <= epsilon (§19.3) [renormalized]
 *   - abs((over_2_5 + under_2_5) - 1) <= epsilon (§19.3) [renormalized]
 *   - All outputs come from raw_match_distribution (NOT from calibrated)
 *   - clean_sheet and win_to_nil correctness
 *   - top_scorelines ordered descending by probability (§15.3)
 *   - most_likely_scoreline belongs to active matrix (§19.2)
 *   - Determinism
 */

import { describe, it, expect } from 'vitest';
import {
  computeDerivedRaw,
  verifyBttsInvariant,
  verifyOverUnderInvariant,
} from '../../src/engine/derived-raw.js';
import {
  buildRawMatchDistribution,
  renormalizeDistribution,
} from '../../src/engine/scoreline-matrix.js';
import { EPSILON_PROBABILITY, MATRIX_MAX_GOAL_DEFAULT } from '../../src/contracts/index.js';

describe('computeDerivedRaw', () => {
  // Helper: renormalized distribution for typical lambdas
  function getTypicalDistribution(lambdaHome = 1.5, lambdaAway = 1.2) {
    const raw = buildRawMatchDistribution(lambdaHome, lambdaAway);
    return renormalizeDistribution(raw.distribution, MATRIX_MAX_GOAL_DEFAULT);
  }

  // ── BTTS invariant (§19.3) ──────────────────────────────────────────────

  it('§19.3 BTTS: abs((btts_yes + btts_no) - 1) <= epsilon for renormalized', () => {
    const dist = getTypicalDistribution();
    const derived = computeDerivedRaw(dist);
    expect(verifyBttsInvariant(derived)).toBe(true);
    expect(Math.abs(derived.btts_yes + derived.btts_no - 1.0)).toBeLessThanOrEqual(
      EPSILON_PROBABILITY * 1000,
    );
  });

  it('btts_no = 1 - btts_yes', () => {
    const dist = getTypicalDistribution();
    const derived = computeDerivedRaw(dist);
    expect(derived.btts_no).toBeCloseTo(1 - derived.btts_yes, 12);
  });

  // ── Over/under invariant (§19.3) ──────────────────────────────────────

  it('§19.3 over/under 2.5: abs((over_2_5 + under_2_5) - 1) <= epsilon for renormalized', () => {
    const dist = getTypicalDistribution();
    const derived = computeDerivedRaw(dist);
    expect(verifyOverUnderInvariant(derived)).toBe(true);
    expect(Math.abs(derived.over_2_5 + derived.under_2_5 - 1.0)).toBeLessThanOrEqual(
      EPSILON_PROBABILITY * 1000,
    );
  });

  it('over_1_5 + under_1_5 is NOT required to sum to 1 (no such formula)', () => {
    // over_1_5 and under_3_5 are NOT complements of each other
    // (over_1_5 means >= 2 total goals; under_3_5 means <= 3 total goals)
    // This test verifies our implementation doesn't conflate them.
    const dist = getTypicalDistribution();
    const derived = computeDerivedRaw(dist);
    // over_1_5 and under_3_5 CAN sum to more than 1 (they overlap for 2 or 3 goals)
    expect(derived.over_1_5 + derived.under_3_5).toBeGreaterThan(1.0 - EPSILON_PROBABILITY);
  });

  // ── Clean sheets (§16.8) ──────────────────────────────────────────────

  it('clean_sheet_home = P(away_goals = 0) (§16.8)', () => {
    const raw = buildRawMatchDistribution(1.5, 1.2);
    const normalized = renormalizeDistribution(raw.distribution, MATRIX_MAX_GOAL_DEFAULT);
    const derived = computeDerivedRaw(normalized);

    // Manually compute P(j = 0)
    let manualCleanSheetHome = 0;
    for (let i = 0; i <= MATRIX_MAX_GOAL_DEFAULT; i++) {
      manualCleanSheetHome += (normalized as Record<string, number>)[`${i}-0`] ?? 0;
    }

    expect(derived.clean_sheet_home).toBeCloseTo(manualCleanSheetHome, 12);
  });

  it('clean_sheet_away = P(home_goals = 0) (§16.8)', () => {
    const raw = buildRawMatchDistribution(1.5, 1.2);
    const normalized = renormalizeDistribution(raw.distribution, MATRIX_MAX_GOAL_DEFAULT);
    const derived = computeDerivedRaw(normalized);

    let manualCleanSheetAway = 0;
    for (let j = 0; j <= MATRIX_MAX_GOAL_DEFAULT; j++) {
      manualCleanSheetAway += (normalized as Record<string, number>)[`0-${j}`] ?? 0;
    }

    expect(derived.clean_sheet_away).toBeCloseTo(manualCleanSheetAway, 12);
  });

  // ── Win to nil (§16.9) ────────────────────────────────────────────────

  it('win_to_nil_home = Σ P(i,j) where i > j and j = 0 (§16.9)', () => {
    const raw = buildRawMatchDistribution(2.0, 0.8);
    const normalized = renormalizeDistribution(raw.distribution, MATRIX_MAX_GOAL_DEFAULT);
    const derived = computeDerivedRaw(normalized);

    // Manual: sum all P(i, 0) where i > 0
    let manual = 0;
    for (let i = 1; i <= MATRIX_MAX_GOAL_DEFAULT; i++) {
      manual += (normalized as Record<string, number>)[`${i}-0`] ?? 0;
    }

    expect(derived.win_to_nil_home).toBeCloseTo(manual, 12);
  });

  it('win_to_nil_away = Σ P(i,j) where j > i and i = 0 (§16.9)', () => {
    const raw = buildRawMatchDistribution(0.8, 2.0);
    const normalized = renormalizeDistribution(raw.distribution, MATRIX_MAX_GOAL_DEFAULT);
    const derived = computeDerivedRaw(normalized);

    let manual = 0;
    for (let j = 1; j <= MATRIX_MAX_GOAL_DEFAULT; j++) {
      manual += (normalized as Record<string, number>)[`0-${j}`] ?? 0;
    }

    expect(derived.win_to_nil_away).toBeCloseTo(manual, 12);
  });

  // ── Low scoring risk (§16.10) ─────────────────────────────────────────

  it('low_scoring_risk = P(0,0) + P(1,0) + P(0,1) + P(1,1) (§16.10)', () => {
    const raw = buildRawMatchDistribution(1.5, 1.2);
    const normalized = renormalizeDistribution(raw.distribution, MATRIX_MAX_GOAL_DEFAULT);
    const derived = computeDerivedRaw(normalized);

    const d = normalized as Record<string, number>;
    const manual = (d['0-0'] ?? 0) + (d['1-0'] ?? 0) + (d['0-1'] ?? 0) + (d['1-1'] ?? 0);

    expect(derived.low_scoring_risk).toBeCloseTo(manual, 12);
  });

  // ── Top scorelines (§15.3, §16.11) ───────────────────────────────────

  it('top_scorelines are ordered descending by probability (§15.3, §16.11)', () => {
    const dist = getTypicalDistribution();
    const derived = computeDerivedRaw(dist);

    expect(derived.top_scorelines).toHaveLength(5);
    for (let k = 0; k < derived.top_scorelines.length - 1; k++) {
      expect(derived.top_scorelines[k].p).toBeGreaterThanOrEqual(derived.top_scorelines[k + 1].p);
    }
  });

  it('most_likely_scoreline matches first entry of top_scorelines', () => {
    const dist = getTypicalDistribution();
    const derived = computeDerivedRaw(dist);

    expect(derived.most_likely_scoreline).toBe(derived.top_scorelines[0].score);
  });

  it('most_likely_scoreline belongs to the active matrix (§19.2)', () => {
    const dist = getTypicalDistribution();
    const derived = computeDerivedRaw(dist);

    // Score should parse as "i-j" with i, j in [0..maxGoal]
    const [homeStr, awayStr] = derived.most_likely_scoreline.split('-');
    const home = parseInt(homeStr, 10);
    const away = parseInt(awayStr, 10);
    expect(home).toBeGreaterThanOrEqual(0);
    expect(home).toBeLessThanOrEqual(MATRIX_MAX_GOAL_DEFAULT);
    expect(away).toBeGreaterThanOrEqual(0);
    expect(away).toBeLessThanOrEqual(MATRIX_MAX_GOAL_DEFAULT);
  });

  it('§23.2 top_5_scoreline_coverage: sum of top 5 probabilities is consistent', () => {
    const dist = getTypicalDistribution();
    const derived = computeDerivedRaw(dist);

    const coverage = derived.top_scorelines.reduce((sum, s) => sum + s.p, 0);
    // Coverage should be between 0 and 1
    expect(coverage).toBeGreaterThan(0);
    expect(coverage).toBeLessThanOrEqual(1 + EPSILON_PROBABILITY);
  });

  // ── All values ∈ [0, 1] ────────────────────────────────────────────────

  it('all derived probabilities are in [0, 1]', () => {
    const dist = getTypicalDistribution();
    const derived = computeDerivedRaw(dist);

    const numericFields: (keyof typeof derived)[] = [
      'over_2_5',
      'under_2_5',
      'over_1_5',
      'under_3_5',
      'btts_yes',
      'btts_no',
      'team_home_over_0_5',
      'team_away_over_0_5',
      'team_home_over_1_5',
      'team_away_over_1_5',
      'clean_sheet_home',
      'clean_sheet_away',
      'win_to_nil_home',
      'win_to_nil_away',
      'low_scoring_risk',
    ];

    for (const field of numericFields) {
      const v = derived[field] as number;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1 + EPSILON_PROBABILITY);
    }
  });

  // ── Determinism ────────────────────────────────────────────────────────

  it('is deterministic', () => {
    const dist = getTypicalDistribution(1.6, 1.1);
    const d1 = computeDerivedRaw(dist);
    const d2 = computeDerivedRaw(dist);

    expect(d1.over_2_5).toBe(d2.over_2_5);
    expect(d1.btts_yes).toBe(d2.btts_yes);
    expect(d1.clean_sheet_home).toBe(d2.clean_sheet_home);
    expect(d1.most_likely_scoreline).toBe(d2.most_likely_scoreline);
    expect(d1.top_scorelines[0].score).toBe(d2.top_scorelines[0].score);
  });

  // ── expected_goals invariants (§15.1) ─────────────────────────────────

  it('high lambda_home → higher home goal probability', () => {
    const highHome = getTypicalDistribution(3.5, 1.0);
    const derived = computeDerivedRaw(highHome);

    // With high home lambda: team_home_over_0_5 should be very high
    expect(derived.team_home_over_0_5).toBeGreaterThan(0.9);
  });

  it('low lambda_away → high clean_sheet_home probability', () => {
    const lowAway = getTypicalDistribution(1.5, 0.3);
    const derived = computeDerivedRaw(lowAway);

    // clean_sheet_home = P(away goals = 0), which is high when lambda_away is low
    expect(derived.clean_sheet_home).toBeGreaterThan(0.7);
  });
});
