/**
 * Radar SportPulse — Evidence Tier Resolver
 * Spec: radar-01-product-functional-spec.md §10, §11
 */

import type { RadarEvidenceTier } from './radar-types.js';

/**
 * Resolves the evidence tier for a given matchday.
 * - BOOTSTRAP: matchdays 1–3
 * - EARLY: matchdays 4–6
 * - STABLE: matchday 7+
 */
export function resolveEvidenceTier(matchday: number): RadarEvidenceTier {
  if (matchday <= 3) return 'BOOTSTRAP';
  if (matchday <= 6) return 'EARLY';
  return 'STABLE';
}

/**
 * Minimum reasons required per evidence tier.
 * Spec: radar-02-editorial-policy.md §17
 */
export function minReasonsForTier(tier: RadarEvidenceTier): number {
  if (tier === 'STABLE') return 3;
  return 2;
}

/**
 * Maximum reasons allowed per evidence tier.
 */
export function maxReasonsForTier(tier: RadarEvidenceTier): number {
  return 3;
}
