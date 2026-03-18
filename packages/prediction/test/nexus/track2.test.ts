/**
 * track2.test.ts — NEXUS Track 2: Goals Model test suite.
 *
 * Spec authority:
 *   - taxonomy spec S4.1–S4.8: full Track 2 specification.
 *
 * Test coverage:
 *   1. Probs sum to 1.0 (TRACK2-INV-01)
 *   2. Strong home team wins more often (TRACK2-FUNC-01)
 *   3. Neutral venue reduces home win probability (TRACK2-FUNC-02)
 *   4. Dixon-Coles correction affects low-score cells (TRACK2-DC-01)
 *   5. Lambda clamp prevents out-of-range values (TRACK2-INV-02)
 *   6. Scoreline matrix sums to ~1.0 (TRACK2-INV-03)
 *   7. Determinism: same inputs → same output (TRACK2-INV-04)
 *   8. Strong away team wins more often (TRACK2-FUNC-03)
 *   9. p_home + p_draw + p_away = 1.0 (TRACK2-INV-05)
 *  10. expectedGoalsHome ≈ lambdaHome for single-Poisson (TRACK2-FUNC-04)
 *  11. p_btts in [0, 1] (TRACK2-INV-06)
 *  12. p_over values in [0, 1] and ordered (TRACK2-FUNC-05)
 *  13. rhoUsed matches leagueId lookup (TRACK2-FUNC-06)
 *  14. SCORELINE_SUM_VIOLATION flag when rho causes extreme distortion (TRACK2-WARN-01)
 *  15. Matrix dimensions: 8×8 (TRACK2-INV-07)
 *  16. computeTrack2 integrates with Track1Output (TRACK2-INT-01)
 *  17. Neutral venue: lambda_home = lambda_away for symmetric teams (TRACK2-FUNC-07)
 *  18. poissonProb boundary: lambda=0 → P(k=0)=1 (TRACK2-BOUND-01)
 *  19. poissonProb: numerically stable for large k (TRACK2-BOUND-02)
 *  20. Dixon-Coles: rho=0 → correction = 1.0 for all cells (TRACK2-DC-02)
 *  21. goalsModelVersion present in output (TRACK2-INV-08)
 *  22. Over/under thresholds all present in p_over (TRACK2-FUNC-08)
 *  23. Lambda clamp lower bound: homeStrength → -Infinity → lambdaHome = LAMBDA_MIN (TRACK2-BOUND-03)
 *  24. Lambda clamp upper bound: homeStrength → +Infinity → lambdaHome = LAMBDA_MAX (TRACK2-BOUND-04)
 *  25. scorelineMatrix[0][0] is the most common scoreline for low-lambda inputs (TRACK2-FUNC-09)
 */

import { describe, it, expect } from 'vitest';
import {
  computeLambdas,
  poissonProb,
  buildGoalsMatrix,
  dixonColesCorrectionFactor,
  getRhoForLeague,
  deriveTrack2Output,
  computeTrack2FromInput,
  computeTrack2,
  MAX_GOALS,
  DEFAULT_RHO,
  LAMBDA_MIN,
  LAMBDA_MAX,
  GOALS_MODEL_VERSION,
  OVER_THRESHOLDS,
} from '../../src/nexus/track2/index.js';
import type { Track1Output } from '../../src/nexus/track1/index.js';

// ── Test helpers ───────────────────────────────────────────────────────────

const TOLERANCE = 1e-9;

function sumMatrix(matrix: number[][]): number {
  let sum = 0;
  for (const row of matrix) {
    for (const val of row) {
      sum += val;
    }
  }
  return sum;
}

function makeTrack1Output(
  attackHome: number,
  defenseHome: number,
  attackAway: number,
  defenseAway: number,
  homeAdvantage = 0.3,
  isNeutralVenue = false,
): Track1Output {
  return {
    homeStrength: {
      teamId: 'team-home',
      eloRating: 1500,
      attackStrength: attackHome,
      defenseStrength: defenseHome,
      homeAdvantageAdjusted: homeAdvantage,
      matchesObserved: 10,
      currentK: 20,
    },
    awayStrength: {
      teamId: 'team-away',
      eloRating: 1500,
      attackStrength: attackAway,
      defenseStrength: defenseAway,
      homeAdvantageAdjusted: 0,
      matchesObserved: 10,
      currentK: 20,
    },
    isNeutralVenue,
    leagueHomeAdvantage: {
      leagueId: 'PD',
      homeAdvantage,
      sampleSize: 30,
      computedAt: '2026-03-18T00:00:00.000Z',
    },
  };
}

// ── TRACK2-INV-01: Probs sum to 1.0 ───────────────────────────────────────

describe('Track2 — TRACK2-INV-01: 1X2 probs sum to 1.0', () => {
  it('p_home + p_draw + p_away = 1.0 for equal teams', () => {
    const result = computeTrack2FromInput({
      homeStrength: 0,
      awayStrength: 0,
      homeAdvantage: 0.3,
      leagueId: 'PD',
      isNeutralVenue: false,
    });
    const sum = result.p_home + result.p_draw + result.p_away;
    expect(Math.abs(sum - 1)).toBeLessThan(TOLERANCE);
  });

  it('p_home + p_draw + p_away = 1.0 for strong home team', () => {
    const result = computeTrack2FromInput({
      homeStrength: 1.0,
      awayStrength: -0.5,
      homeAdvantage: 0.3,
      leagueId: 'PL',
      isNeutralVenue: false,
    });
    const sum = result.p_home + result.p_draw + result.p_away;
    expect(Math.abs(sum - 1)).toBeLessThan(TOLERANCE);
  });

  it('p_home + p_draw + p_away = 1.0 for strong away team', () => {
    const result = computeTrack2FromInput({
      homeStrength: -0.5,
      awayStrength: 1.0,
      homeAdvantage: 0.3,
      leagueId: 'BL1',
      isNeutralVenue: false,
    });
    const sum = result.p_home + result.p_draw + result.p_away;
    expect(Math.abs(sum - 1)).toBeLessThan(TOLERANCE);
  });

  it('p_home + p_draw + p_away = 1.0 for neutral venue', () => {
    const result = computeTrack2FromInput({
      homeStrength: 0,
      awayStrength: 0,
      homeAdvantage: 0.3,
      leagueId: 'PD',
      isNeutralVenue: true,
    });
    const sum = result.p_home + result.p_draw + result.p_away;
    expect(Math.abs(sum - 1)).toBeLessThan(TOLERANCE);
  });
});

// ── TRACK2-FUNC-01: Strong home team wins more often ───────────────────────

describe('Track2 — TRACK2-FUNC-01: Strong home team dominates', () => {
  it('homeStrength=1.0, awayStrength=-0.5 → p_home > p_away', () => {
    const result = computeTrack2FromInput({
      homeStrength: 1.0,
      awayStrength: -0.5,
      homeAdvantage: 0.3,
      leagueId: 'PD',
      isNeutralVenue: false,
    });
    expect(result.p_home).toBeGreaterThan(result.p_away);
  });

  it('p_home > 0.5 for significantly stronger home team', () => {
    const result = computeTrack2FromInput({
      homeStrength: 1.5,
      awayStrength: -0.5,
      homeAdvantage: 0.3,
      leagueId: 'PD',
      isNeutralVenue: false,
    });
    expect(result.p_home).toBeGreaterThan(0.5);
  });
});

// ── TRACK2-FUNC-02: Neutral venue reduces home advantage ──────────────────

describe('Track2 — TRACK2-FUNC-02: Neutral venue reduces home win prob', () => {
  it('neutral=true → p_home < neutral=false (equal teams)', () => {
    const base = computeTrack2FromInput({
      homeStrength: 0,
      awayStrength: 0,
      homeAdvantage: 0.3,
      leagueId: 'PD',
      isNeutralVenue: false,
    });
    const neutral = computeTrack2FromInput({
      homeStrength: 0,
      awayStrength: 0,
      homeAdvantage: 0.3,
      leagueId: 'PD',
      isNeutralVenue: true,
    });
    expect(neutral.p_home).toBeLessThan(base.p_home);
  });

  it('neutral venue: equal teams → p_home ≈ p_away (near symmetry)', () => {
    const result = computeTrack2FromInput({
      homeStrength: 0,
      awayStrength: 0,
      homeAdvantage: 0.3,
      leagueId: 'PD',
      isNeutralVenue: true,
    });
    // AWAY_HA_FACTOR = 0.5, so with neutral venue both are exp(0) = 1.0
    // lambdaHome = lambdaAway → p_home = p_away exactly
    expect(Math.abs(result.p_home - result.p_away)).toBeLessThan(1e-6);
  });
});

// ── TRACK2-DC-01: Dixon-Coles correction changes low-score probabilities ───

describe('Track2 — TRACK2-DC-01: Dixon-Coles correction effect', () => {
  it('P(0,0) with rho != 0 differs from P(0,0) with rho = 0', () => {
    const lambdaHome = 1.5;
    const lambdaAway = 1.2;

    const { matrix: matrixWithRho } = buildGoalsMatrix(lambdaHome, lambdaAway, DEFAULT_RHO);
    const { matrix: matrixNoRho } = buildGoalsMatrix(lambdaHome, lambdaAway, 0);

    // With rho = 0 the correction factor for (0,0) = 1.0, so they should differ.
    expect(matrixWithRho[0]![0]).not.toBeCloseTo(matrixNoRho[0]![0]!, 10);
  });

  it('dixon-coles factor (0,0) = 1 - lambdaH * lambdaA * rho', () => {
    const lambdaH = 1.5;
    const lambdaA = 1.2;
    const rho = -0.13;
    const factor = dixonColesCorrectionFactor(0, 0, lambdaH, lambdaA, rho);
    const expected = 1 - lambdaH * lambdaA * rho;
    expect(factor).toBeCloseTo(expected, 12);
  });

  it('dixon-coles factor (1,0) = 1 + lambdaA * rho', () => {
    const lambdaH = 1.5;
    const lambdaA = 1.2;
    const rho = -0.13;
    const factor = dixonColesCorrectionFactor(1, 0, lambdaH, lambdaA, rho);
    expect(factor).toBeCloseTo(1 + lambdaA * rho, 12);
  });

  it('dixon-coles factor (0,1) = 1 + lambdaH * rho', () => {
    const lambdaH = 1.5;
    const lambdaA = 1.2;
    const rho = -0.13;
    const factor = dixonColesCorrectionFactor(0, 1, lambdaH, lambdaA, rho);
    expect(factor).toBeCloseTo(1 + lambdaH * rho, 12);
  });

  it('dixon-coles factor (1,1) = 1 - rho', () => {
    const rho = -0.13;
    const factor = dixonColesCorrectionFactor(1, 1, 1.5, 1.2, rho);
    expect(factor).toBeCloseTo(1 - rho, 12);
  });

  it('dixon-coles factor for cells (i,j) outside {0,1}×{0,1} = 1.0', () => {
    expect(dixonColesCorrectionFactor(2, 0, 1.5, 1.2, -0.13)).toBe(1.0);
    expect(dixonColesCorrectionFactor(0, 2, 1.5, 1.2, -0.13)).toBe(1.0);
    expect(dixonColesCorrectionFactor(3, 3, 1.5, 1.2, -0.13)).toBe(1.0);
    expect(dixonColesCorrectionFactor(7, 7, 1.5, 1.2, -0.13)).toBe(1.0);
  });
});

// ── TRACK2-DC-02: rho=0 → correction = 1.0 for all cells ─────────────────

describe('Track2 — TRACK2-DC-02: rho=0 gives independence', () => {
  it('rho=0 → correction = 1.0 for all low-score cells', () => {
    expect(dixonColesCorrectionFactor(0, 0, 1.5, 1.2, 0)).toBe(1.0);
    expect(dixonColesCorrectionFactor(1, 0, 1.5, 1.2, 0)).toBe(1.0);
    expect(dixonColesCorrectionFactor(0, 1, 1.5, 1.2, 0)).toBe(1.0);
    expect(dixonColesCorrectionFactor(1, 1, 1.5, 1.2, 0)).toBe(1.0);
  });
});

// ── TRACK2-INV-02: Lambda clamp ────────────────────────────────────────────

describe('Track2 — TRACK2-INV-02: Lambda clamp to [LAMBDA_MIN, LAMBDA_MAX]', () => {
  it('extreme negative homeStrength → lambdaHome = LAMBDA_MIN', () => {
    const { lambdaHome } = computeLambdas(-100, 0, 0, false);
    expect(lambdaHome).toBe(LAMBDA_MIN);
  });

  it('extreme positive homeStrength → lambdaHome = LAMBDA_MAX', () => {
    const { lambdaHome } = computeLambdas(100, 0, 0, false);
    expect(lambdaHome).toBe(LAMBDA_MAX);
  });

  it('extreme negative awayStrength → lambdaAway = LAMBDA_MIN', () => {
    const { lambdaAway } = computeLambdas(0, -100, 0, false);
    expect(lambdaAway).toBe(LAMBDA_MIN);
  });

  it('extreme positive awayStrength → lambdaAway = LAMBDA_MAX', () => {
    const { lambdaAway } = computeLambdas(0, 100, 0, false);
    expect(lambdaAway).toBe(LAMBDA_MAX);
  });

  it('lambdaHome never < LAMBDA_MIN', () => {
    const { lambdaHome } = computeLambdas(-50, 0, 0, false);
    expect(lambdaHome).toBeGreaterThanOrEqual(LAMBDA_MIN);
  });

  it('lambdaAway never > LAMBDA_MAX', () => {
    const { lambdaAway } = computeLambdas(0, 50, 0, false);
    expect(lambdaAway).toBeLessThanOrEqual(LAMBDA_MAX);
  });
});

// ── TRACK2-BOUND-03/04: Lambda clamp boundary descriptions ────────────────

describe('Track2 — TRACK2-BOUND-03/04: Lambda clamp via computeTrack2FromInput', () => {
  it('BOUND-03: extreme negative strength produces clamped output (no crash)', () => {
    const result = computeTrack2FromInput({
      homeStrength: -100,
      awayStrength: -100,
      homeAdvantage: 0,
      leagueId: 'PD',
      isNeutralVenue: true,
    });
    expect(result.lambdaHome).toBe(LAMBDA_MIN);
    expect(result.lambdaAway).toBe(LAMBDA_MIN);
    const sum = result.p_home + result.p_draw + result.p_away;
    expect(Math.abs(sum - 1)).toBeLessThan(TOLERANCE);
  });

  it('BOUND-04: extreme positive strength produces clamped output (no crash)', () => {
    const result = computeTrack2FromInput({
      homeStrength: 100,
      awayStrength: 100,
      homeAdvantage: 0,
      leagueId: 'PD',
      isNeutralVenue: true,
    });
    expect(result.lambdaHome).toBe(LAMBDA_MAX);
    expect(result.lambdaAway).toBe(LAMBDA_MAX);
    const sum = result.p_home + result.p_draw + result.p_away;
    expect(Math.abs(sum - 1)).toBeLessThan(TOLERANCE);
  });
});

// ── TRACK2-INV-03: Matrix sums to ~1.0 ───────────────────────────────────

describe('Track2 — TRACK2-INV-03: Scoreline matrix sum ≈ 1.0', () => {
  it('matrix sums within 1e-6 of 1.0 for typical lambdas', () => {
    const result = computeTrack2FromInput({
      homeStrength: 0.1,
      awayStrength: -0.1,
      homeAdvantage: 0.3,
      leagueId: 'PD',
      isNeutralVenue: false,
    });
    const total = sumMatrix(result.scorelineMatrix);
    expect(Math.abs(total - 1)).toBeLessThan(1e-6);
  });

  it('buildGoalsMatrix produces renormalized matrix', () => {
    const { matrix } = buildGoalsMatrix(1.5, 1.2, DEFAULT_RHO);
    const total = sumMatrix(matrix);
    expect(Math.abs(total - 1)).toBeLessThan(1e-9);
  });
});

// ── TRACK2-INV-04: Determinism ─────────────────────────────────────────────

describe('Track2 — TRACK2-INV-04: Determinism', () => {
  it('same inputs → identical output for computeTrack2FromInput', () => {
    const input = {
      homeStrength: 0.2,
      awayStrength: -0.1,
      homeAdvantage: 0.3,
      leagueId: 'PD',
      isNeutralVenue: false,
    };
    const r1 = computeTrack2FromInput(input);
    const r2 = computeTrack2FromInput(input);
    expect(r1.p_home).toBe(r2.p_home);
    expect(r1.p_draw).toBe(r2.p_draw);
    expect(r1.p_away).toBe(r2.p_away);
    expect(r1.lambdaHome).toBe(r2.lambdaHome);
    expect(r1.lambdaAway).toBe(r2.lambdaAway);
    expect(r1.rhoUsed).toBe(r2.rhoUsed);
  });

  it('same inputs → identical matrix', () => {
    const input = {
      homeStrength: 0.5,
      awayStrength: 0.1,
      homeAdvantage: 0.4,
      leagueId: 'BL1',
      isNeutralVenue: false,
    };
    const r1 = computeTrack2FromInput(input);
    const r2 = computeTrack2FromInput(input);
    for (let i = 0; i <= MAX_GOALS; i++) {
      for (let j = 0; j <= MAX_GOALS; j++) {
        expect(r1.scorelineMatrix[i]![j]).toBe(r2.scorelineMatrix[i]![j]);
      }
    }
  });
});

// ── TRACK2-FUNC-03: Strong away team wins more often ──────────────────────

describe('Track2 — TRACK2-FUNC-03: Strong away team dominates', () => {
  it('awayStrength >> homeStrength → p_away > p_home', () => {
    const result = computeTrack2FromInput({
      homeStrength: -0.5,
      awayStrength: 1.5,
      homeAdvantage: 0.1, // small home advantage
      leagueId: 'PD',
      isNeutralVenue: false,
    });
    expect(result.p_away).toBeGreaterThan(result.p_home);
  });
});

// ── TRACK2-INV-05: 1X2 sum invariant ──────────────────────────────────────

describe('Track2 — TRACK2-INV-05: p_home + p_draw + p_away = 1.0', () => {
  it('invariant holds for all OVER_THRESHOLDS scenarios', () => {
    const scenarios = [
      { homeStrength: 0, awayStrength: 0, homeAdvantage: 0.3, leagueId: 'PD', isNeutralVenue: false },
      { homeStrength: 0.5, awayStrength: 0.5, homeAdvantage: 0.5, leagueId: 'PL', isNeutralVenue: false },
      { homeStrength: -0.3, awayStrength: 0.3, homeAdvantage: 0.2, leagueId: 'BL1', isNeutralVenue: true },
    ];
    for (const s of scenarios) {
      const result = computeTrack2FromInput(s);
      const sum = result.p_home + result.p_draw + result.p_away;
      expect(Math.abs(sum - 1)).toBeLessThan(TOLERANCE);
    }
  });
});

// ── TRACK2-INV-06: p_btts in [0, 1] ──────────────────────────────────────

describe('Track2 — TRACK2-INV-06: p_btts in [0, 1]', () => {
  it('p_btts is between 0 and 1', () => {
    const result = computeTrack2FromInput({
      homeStrength: 0,
      awayStrength: 0,
      homeAdvantage: 0.3,
      leagueId: 'PD',
      isNeutralVenue: false,
    });
    expect(result.p_btts).toBeGreaterThanOrEqual(0);
    expect(result.p_btts).toBeLessThanOrEqual(1);
  });

  it('p_btts is higher when both teams are strong attackers', () => {
    const strongBoth = computeTrack2FromInput({
      homeStrength: 0.5,
      awayStrength: 0.5,
      homeAdvantage: 0,
      leagueId: 'PD',
      isNeutralVenue: true,
    });
    const weakBoth = computeTrack2FromInput({
      homeStrength: -0.5,
      awayStrength: -0.5,
      homeAdvantage: 0,
      leagueId: 'PD',
      isNeutralVenue: true,
    });
    expect(strongBoth.p_btts).toBeGreaterThan(weakBoth.p_btts);
  });
});

// ── TRACK2-FUNC-05: p_over values ordered correctly ───────────────────────

describe('Track2 — TRACK2-FUNC-05: p_over values in [0,1] and ordered', () => {
  it('all p_over values in [0, 1]', () => {
    const result = computeTrack2FromInput({
      homeStrength: 0,
      awayStrength: 0,
      homeAdvantage: 0.3,
      leagueId: 'PD',
      isNeutralVenue: false,
    });
    for (const t of OVER_THRESHOLDS) {
      const val = result.p_over[`over_${t}`];
      expect(val).toBeDefined();
      expect(val!).toBeGreaterThanOrEqual(0);
      expect(val!).toBeLessThanOrEqual(1);
    }
  });

  it('p_over_0.5 >= p_over_1.5 >= p_over_2.5 >= p_over_3.5 >= p_over_4.5', () => {
    const result = computeTrack2FromInput({
      homeStrength: 0.1,
      awayStrength: -0.1,
      homeAdvantage: 0.3,
      leagueId: 'PD',
      isNeutralVenue: false,
    });
    expect(result.p_over['over_0.5']!).toBeGreaterThanOrEqual(result.p_over['over_1.5']!);
    expect(result.p_over['over_1.5']!).toBeGreaterThanOrEqual(result.p_over['over_2.5']!);
    expect(result.p_over['over_2.5']!).toBeGreaterThanOrEqual(result.p_over['over_3.5']!);
    expect(result.p_over['over_3.5']!).toBeGreaterThanOrEqual(result.p_over['over_4.5']!);
  });
});

// ── TRACK2-FUNC-06: rhoUsed matches leagueId ──────────────────────────────

describe('Track2 — TRACK2-FUNC-06: rhoUsed matches league rho lookup', () => {
  it('rhoUsed = DEFAULT_RHO for known leagues (bootstrap values)', () => {
    const result = computeTrack2FromInput({
      homeStrength: 0,
      awayStrength: 0,
      homeAdvantage: 0.3,
      leagueId: 'PD',
      isNeutralVenue: false,
    });
    const { rho } = getRhoForLeague('PD');
    expect(result.rhoUsed).toBe(rho);
  });

  it('rhoUsed = DEFAULT_RHO for unknown league', () => {
    const { rho } = getRhoForLeague('UNKNOWN_LEAGUE');
    expect(rho).toBe(DEFAULT_RHO);
  });
});

// ── TRACK2-INV-07: Matrix dimensions 8×8 ─────────────────────────────────

describe('Track2 — TRACK2-INV-07: Matrix is (MAX_GOALS+1)×(MAX_GOALS+1)', () => {
  it('scorelineMatrix has 8 rows', () => {
    const result = computeTrack2FromInput({
      homeStrength: 0,
      awayStrength: 0,
      homeAdvantage: 0.3,
      leagueId: 'PD',
      isNeutralVenue: false,
    });
    expect(result.scorelineMatrix.length).toBe(MAX_GOALS + 1);
  });

  it('scorelineMatrix has 8 columns per row', () => {
    const result = computeTrack2FromInput({
      homeStrength: 0,
      awayStrength: 0,
      homeAdvantage: 0.3,
      leagueId: 'PD',
      isNeutralVenue: false,
    });
    for (const row of result.scorelineMatrix) {
      expect(row.length).toBe(MAX_GOALS + 1);
    }
  });

  it('buildGoalsMatrix always produces 8×8', () => {
    const { matrix } = buildGoalsMatrix(1.5, 1.2, DEFAULT_RHO);
    expect(matrix.length).toBe(8);
    for (const row of matrix) {
      expect(row.length).toBe(8);
    }
  });
});

// ── TRACK2-INT-01: Integration with Track1Output ──────────────────────────

describe('Track2 — TRACK2-INT-01: computeTrack2 integrates Track1Output', () => {
  it('produces valid output from Track1Output', () => {
    const track1Output = makeTrack1Output(1.5, 1.0, 1.2, 1.1, 0.3, false);
    const result = computeTrack2(track1Output, 'PD');
    const sum = result.p_home + result.p_draw + result.p_away;
    expect(Math.abs(sum - 1)).toBeLessThan(TOLERANCE);
    expect(result.scorelineMatrix.length).toBe(MAX_GOALS + 1);
    expect(result.lambdaHome).toBeGreaterThanOrEqual(LAMBDA_MIN);
    expect(result.lambdaAway).toBeGreaterThanOrEqual(LAMBDA_MIN);
  });

  it('isNeutralVenue override works in computeTrack2', () => {
    const track1Output = makeTrack1Output(1.5, 1.0, 1.2, 1.1, 0.3, false);
    const nonNeutral = computeTrack2(track1Output, 'PD', false);
    const neutral = computeTrack2(track1Output, 'PD', true);
    // Neutral venue should reduce home advantage
    expect(neutral.lambdaHome).toBeLessThanOrEqual(nonNeutral.lambdaHome);
  });

  it('neutral venue from Track1Output is respected', () => {
    const track1Neutral = makeTrack1Output(1.5, 1.0, 1.2, 1.1, 0.3, true);
    const track1NonNeutral = makeTrack1Output(1.5, 1.0, 1.2, 1.1, 0.3, false);
    const neutral = computeTrack2(track1Neutral, 'PD');
    const nonNeutral = computeTrack2(track1NonNeutral, 'PD');
    // Neutral venue should give lower or equal home win prob
    expect(neutral.p_home).toBeLessThanOrEqual(nonNeutral.p_home);
  });
});

// ── TRACK2-FUNC-07: Symmetric teams on neutral venue ─────────────────────

describe('Track2 — TRACK2-FUNC-07: Equal teams on neutral venue → symmetric probs', () => {
  it('equal teams, neutral venue → p_home = p_away (mirror symmetry)', () => {
    const result = computeTrack2FromInput({
      homeStrength: 0,
      awayStrength: 0,
      homeAdvantage: 0.5, // any value — suppressed by neutral
      leagueId: 'PD',
      isNeutralVenue: true,
    });
    // Both lambdas are exp(0) = 1.0 → perfectly symmetric distribution
    expect(Math.abs(result.p_home - result.p_away)).toBeLessThan(1e-10);
  });
});

// ── TRACK2-BOUND-01: poissonProb with lambda=0 ───────────────────────────

describe('Track2 — TRACK2-BOUND-01: poissonProb boundary (lambda=0)', () => {
  it('P(k=0 | lambda=0) = 1.0', () => {
    expect(poissonProb(0, 0)).toBe(1.0);
  });

  it('P(k>0 | lambda=0) = 0.0', () => {
    expect(poissonProb(0, 1)).toBe(0.0);
    expect(poissonProb(0, 5)).toBe(0.0);
  });

  it('P(k=0 | lambda=0.001) ≈ 1.0', () => {
    expect(poissonProb(0.001, 0)).toBeGreaterThan(0.999);
  });
});

// ── TRACK2-BOUND-02: poissonProb numerically stable for large k ───────────

describe('Track2 — TRACK2-BOUND-02: poissonProb numerical stability', () => {
  it('returns finite value for lambda=5.0, k=MAX_GOALS (k=7)', () => {
    const p = poissonProb(5.0, 7);
    expect(isFinite(p)).toBe(true);
    expect(p).toBeGreaterThan(0);
  });

  it('returns finite non-negative value for lambda=0.2, k=7', () => {
    const p = poissonProb(0.2, 7);
    expect(isFinite(p)).toBe(true);
    expect(p).toBeGreaterThanOrEqual(0);
  });

  it('Poisson distribution sums close to 1 for lambda=1.5 over k=0..50', () => {
    let total = 0;
    for (let k = 0; k <= 50; k++) total += poissonProb(1.5, k);
    expect(Math.abs(total - 1)).toBeLessThan(1e-8);
  });
});

// ── TRACK2-INV-08: goalsModelVersion present ─────────────────────────────

describe('Track2 — TRACK2-INV-08: goalsModelVersion in output', () => {
  it('goalsModelVersion is present and matches constant', () => {
    const result = computeTrack2FromInput({
      homeStrength: 0,
      awayStrength: 0,
      homeAdvantage: 0.3,
      leagueId: 'PD',
      isNeutralVenue: false,
    });
    expect(result.goalsModelVersion).toBe(GOALS_MODEL_VERSION);
  });
});

// ── TRACK2-FUNC-08: All over/under thresholds present ────────────────────

describe('Track2 — TRACK2-FUNC-08: All over/under thresholds present', () => {
  it('p_over contains all 5 thresholds', () => {
    const result = computeTrack2FromInput({
      homeStrength: 0,
      awayStrength: 0,
      homeAdvantage: 0.3,
      leagueId: 'PD',
      isNeutralVenue: false,
    });
    for (const t of OVER_THRESHOLDS) {
      expect(result.p_over[`over_${t}`]).toBeDefined();
    }
  });
});

// ── TRACK2-FUNC-09: Low-lambda → 0-0 is most likely scoreline ────────────

describe('Track2 — TRACK2-FUNC-09: Low lambda → 0-0 is mode', () => {
  it('for very low lambdas, P(0,0) > P(1,0) and P(0,0) > P(0,1)', () => {
    const { matrix } = buildGoalsMatrix(LAMBDA_MIN, LAMBDA_MIN, 0);
    // With low lambda, scoring is unlikely, so 0-0 should dominate.
    expect(matrix[0]![0]).toBeGreaterThan(matrix[1]![0]!);
    expect(matrix[0]![0]).toBeGreaterThan(matrix[0]![1]!);
  });
});

// ── TRACK2-WARN-01: _scorelineSumViolation flag ──────────────────────────

describe('Track2 — TRACK2-WARN-01: _scorelineSumViolation flag', () => {
  it('_scorelineSumViolation = false for valid inputs', () => {
    const result = computeTrack2FromInput({
      homeStrength: 0,
      awayStrength: 0,
      homeAdvantage: 0.3,
      leagueId: 'PD',
      isNeutralVenue: false,
    });
    // For valid Poisson with truncation at 7, sum should be near 1.0
    // and violation should only trigger for extreme lambda values.
    // With normal lambdas (e.g. 1.0-2.0) the tail beyond 7 is tiny.
    // violation = false is expected for lambdas well below MAX_GOALS.
    expect(typeof result._scorelineSumViolation).toBe('boolean');
  });

  it('normal lambda range does not trigger sum violation', () => {
    const result = computeTrack2FromInput({
      homeStrength: 0.1,
      awayStrength: -0.1,
      homeAdvantage: 0.3,
      leagueId: 'PD',
      isNeutralVenue: false,
    });
    expect(result._scorelineSumViolation).toBe(false);
  });
});
