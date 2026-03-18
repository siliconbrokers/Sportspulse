/**
 * adaptive-k.ts — NEXUS Track 1: Adaptive K-factor computation.
 *
 * Spec authority:
 *   - taxonomy spec S3.2 Extension 3: Adaptive K-Factor
 *   - master spec S4.3: V3 limitation — "V3 uses a fixed K-factor";
 *     NEXUS replaces this with a K that adapts to competitive importance
 *
 * Phase 1A: decay-by-matches-observed baseline.
 * The full context multipliers (season opener 1.2x, final-8 0.9x,
 * relegation/title 1.1x) from taxonomy spec S3.2 Extension 3 table are
 * scaffolded here but applied in Phase 1B once matchday data is available.
 *
 * Formula (taxonomy spec S3.2 Extension 3, Phase 1A):
 *   k = max(k_floor, k_initial * exp(-decay_rate * matchesObserved))
 *
 * All functions are PURE — same inputs → same outputs. No IO.
 *
 * @module nexus/track1/adaptive-k
 */

import type { AdaptiveKConfig } from './types.js';

// ── Default configuration ─────────────────────────────────────────────────

/**
 * Default adaptive K configuration for standard domestic league matches.
 *
 * Grounded in Elo literature and aligned with V3's K_FACTOR_BASE = 20:
 *   k_initial = 32  — standard FIFA Elo K for initial estimation
 *   k_floor   = 16  — stabilises at half the initial value after ~20 matches
 *   decay_rate = 0.05 — decays significantly over ~20 matches
 *     (at n=20: k ≈ 32 * e^(-1.0) ≈ 11.8, floored to 16)
 *     (at n=10: k ≈ 32 * e^(-0.5) ≈ 19.4)
 *
 * taxonomy spec S3.2 Extension 3: "K-factor that adapts to the competitive
 * importance of the match". Phase 1A provides the decay baseline; context
 * multipliers are added in Phase 1B.
 */
export const DEFAULT_ADAPTIVE_K_CONFIG: Readonly<AdaptiveKConfig> = {
  k_initial: 32,
  k_floor: 16,
  decay_rate: 0.05,
};

/**
 * Context multipliers for match importance (taxonomy spec S3.2 Extension 3 table).
 * Applied as a multiplier on the base adaptive K.
 *
 * Phase 1A: these multipliers are defined but NOT applied in computeAdaptiveK
 * (Phase 1A delivers the decay baseline only). Callers that have matchday data
 * may apply them explicitly via computeAdaptiveKWithContext.
 */
export const K_CONTEXT_MULTIPLIERS = {
  /** Season opener (matchday 1): higher uncertainty early in season. */
  SEASON_OPENER: 1.2,
  /** Mid-season (matchday 5-30): baseline. */
  MID_SEASON: 1.0,
  /** Final 8 matchdays: ratings should be stable; large swings are noise. */
  FINAL_STRETCH: 0.9,
  /** Relegation / title-deciding match: high motivation. */
  HIGH_STAKES: 1.1,
} as const;

export type KContextType = keyof typeof K_CONTEXT_MULTIPLIERS;

// ── Core functions ─────────────────────────────────────────────────────────

/**
 * Compute the adaptive K-factor based on number of observed matches.
 *
 * taxonomy spec S3.2 Extension 3:
 *   "V3 uses a fixed K-factor for Elo updates (modulated only by time decay).
 *    NEXUS introduces a K-factor that adapts to the competitive importance
 *    of the match."
 *
 * Phase 1A: pure decay by observed matches. Context multipliers (season phase,
 * competitive importance) are not applied here — they require matchday data
 * which is in scope for Phase 1B.
 *
 * @param matchesObserved - Number of completed matches observed for the team
 *   in the current season. 0 = first match (maximum uncertainty).
 * @param config - Adaptive K configuration. Defaults to DEFAULT_ADAPTIVE_K_CONFIG.
 * @returns Adaptive K-factor (always >= config.k_floor).
 */
export function computeAdaptiveK(
  matchesObserved: number,
  config: AdaptiveKConfig = DEFAULT_ADAPTIVE_K_CONFIG,
): number {
  if (matchesObserved < 0) {
    // Guard: negative matchesObserved is a caller error; treat as 0.
    return config.k_initial;
  }
  // taxonomy spec S3.2 Extension 3: decay formula
  const raw = config.k_initial * Math.exp(-config.decay_rate * matchesObserved);
  return Math.max(config.k_floor, raw);
}

/**
 * Compute the adaptive K-factor with a context multiplier applied.
 *
 * taxonomy spec S3.2 Extension 3 table:
 *   season opener 1.2x, mid-season 1.0x, final 8 0.9x, high-stakes 1.1x.
 *
 * Phase 1B: callers with matchday context use this function.
 * Phase 1A: not invoked by track1-engine.ts — scaffolded here for Phase 1B.
 *
 * @param matchesObserved - Observed matches for the team this season.
 * @param context - Match context type.
 * @param config - Adaptive K configuration.
 * @returns Adaptive K-factor with context multiplier (always >= config.k_floor).
 */
export function computeAdaptiveKWithContext(
  matchesObserved: number,
  context: KContextType,
  config: AdaptiveKConfig = DEFAULT_ADAPTIVE_K_CONFIG,
): number {
  const baseK = computeAdaptiveK(matchesObserved, config);
  const multiplier = K_CONTEXT_MULTIPLIERS[context];
  // The floor is still respected after multiplier application.
  return Math.max(config.k_floor, baseK * multiplier);
}
