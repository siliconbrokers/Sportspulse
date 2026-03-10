/**
 * branded-factories.ts — Test helpers for constructing branded probability types.
 *
 * Spec authority: §19.5, §16.1, §14.2
 *
 * PURPOSE:
 *   `Raw1x2Probs`, `Calibrated1x2Probs`, and `RawMatchDistribution` are branded
 *   types. Tests must NOT use `as any` to bypass the contract — doing so would
 *   make the test incapable of catching type-level family cross-contamination bugs.
 *
 *   These helpers satisfy the branded type contracts using the same pattern used
 *   by the implementation's own factory functions (`buildRaw1x2Probs` in
 *   raw-aggregator.ts, `buildRawMatchDistribution` in scoreline-matrix.ts).
 *
 *   Using `as unknown as BrandedType` is the sole legitimate escape hatch in
 *   test helpers that are themselves the producers of branded values — it mirrors
 *   exactly what the implementation does and is the prescribed pattern.
 *
 *   These helpers MUST NOT be used to cross-assign (e.g., building a
 *   Raw1x2Probs and assigning it to a Calibrated1x2Probs slot). That would
 *   defeat the purpose of the brand.
 *
 * ANTI-PATTERNS (forbidden here):
 *   - Using these helpers to suppress type errors in non-producer test code
 *   - Using `as any` anywhere in test files that already import these helpers
 *   - Passing a `buildTestRaw1x2Probs` result where `Calibrated1x2Probs` is expected
 */

import type {
  Raw1x2Probs,
  Calibrated1x2Probs,
  RawMatchDistribution,
  ScorelineKey,
} from '../../src/contracts/index.js';

// ── Raw1x2Probs factory ───────────────────────────────────────────────────

/**
 * Build a `Raw1x2Probs` branded value for tests.
 *
 * Caller is responsible for ensuring values are in [0, 1] and
 * sum to approximately 1 - tail_mass_raw for the associated distribution.
 *
 * Mirrors the implementation pattern in raw-aggregator.ts `buildRaw1x2Probs`.
 * §16.1, §19.5
 */
export function buildTestRaw1x2Probs(home: number, draw: number, away: number): Raw1x2Probs {
  return { home, draw, away } as unknown as Raw1x2Probs;
}

// ── Calibrated1x2Probs factory ────────────────────────────────────────────

/**
 * Build a `Calibrated1x2Probs` branded value for tests.
 *
 * Caller is responsible for ensuring values are in [0, 1] and
 * abs(home + draw + away - 1) <= epsilon_probability (§19.1).
 *
 * This is the only place in tests that may use `as unknown as Calibrated1x2Probs`.
 * §16.2, §19.1, §19.5
 */
export function buildTestCalibratedProbs(
  home: number,
  draw: number,
  away: number,
): Calibrated1x2Probs {
  return { home, draw, away } as unknown as Calibrated1x2Probs;
}

// ── RawMatchDistribution factory ──────────────────────────────────────────

/**
 * Build a `RawMatchDistribution` branded value for tests from a plain scoreline map.
 *
 * Keys must be "i-j" strings. Values must be in [0, 1].
 * The sum of all values equals 1 - tail_mass_raw (i.e., the raw distribution
 * does NOT necessarily sum to 1 — renormalization is the caller's concern).
 *
 * Mirrors the cast used in `buildRawMatchDistribution` in scoreline-matrix.ts.
 * §14.2, §19.2
 */
export function buildTestRawDistribution(cells: Record<string, number>): RawMatchDistribution {
  return cells as unknown as RawMatchDistribution;
}

/**
 * Build a minimal valid `RawMatchDistribution` with a single scoreline having
 * probability 1.0 (after renormalization). Useful for structural tests that
 * do not need a realistic distribution.
 *
 * §14.2: single-cell distribution is a degenerate but valid edge case.
 */
export function buildTestSingleCellDistribution(
  homeGoals: number,
  awayGoals: number,
  probability: number = 1.0,
): RawMatchDistribution {
  const key: ScorelineKey = `${homeGoals}-${awayGoals}`;
  return { [key]: probability } as unknown as RawMatchDistribution;
}
