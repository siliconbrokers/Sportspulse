/**
 * Radar SportPulse v2 — Family Resolver
 * Spec: spec.sportpulse.radar-v2-core.md §12 (Step 2 & 3)
 *
 * Resolves:
 *   - which families are active
 *   - dominant family
 *   - secondary badges from non-dominant active families
 */

import type { RadarV2Family, RadarV2Label, FamilyScore } from './radar-v2-types.js';
import { LABEL_TO_FAMILY } from './radar-v2-types.js';
import type { V2EvaluatedMatch } from './radar-v2-candidate-evaluator.js';

export interface FamilyResolution {
  dominantFamily: RadarV2Family;
  primaryLabel: RadarV2Label;
  secondaryBadges: RadarV2Label[];
  activeFamilies: RadarV2Family[];
}

/**
 * Resolves secondary badges from non-dominant active families.
 * Returns up to 2 secondary badges (one per non-dominant active family).
 *
 * Badge selection: the best label from each active non-dominant family,
 * only if that label passes its threshold.
 */
export function resolveSecondaryBadges(
  evaluated: V2EvaluatedMatch,
): RadarV2Label[] {
  const { familyScores, dominantFamily, primaryLabel } = evaluated;

  const badges: RadarV2Label[] = [];

  // Get active families that are not the dominant one
  const nonDominant = familyScores
    .filter((fs) => fs.active && fs.family !== dominantFamily)
    .sort((a, b) => b.score - a.score); // strongest first

  for (const fs of nonDominant) {
    if (badges.length >= 2) break;
    // Skip if the best label is the same as primary (shouldn't happen across families, but guard)
    if (fs.bestLabel === primaryLabel) continue;
    badges.push(fs.bestLabel);
  }

  return badges;
}

/**
 * Full family resolution for a V2EvaluatedMatch.
 */
export function resolveFamilies(evaluated: V2EvaluatedMatch): FamilyResolution {
  const activeFamilies = evaluated.familyScores
    .filter((fs) => fs.active)
    .map((fs) => fs.family);

  const secondaryBadges = resolveSecondaryBadges(evaluated);

  return {
    dominantFamily: evaluated.dominantFamily,
    primaryLabel: evaluated.primaryLabel,
    secondaryBadges,
    activeFamilies,
  };
}
