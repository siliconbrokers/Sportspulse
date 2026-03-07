/**
 * Radar SportPulse — Diversity Filter
 * Spec: radar-01-product-functional-spec.md §18
 * Rules: max 2 cards with the same label; replace 3rd duplicate if gap is not too large.
 */

import type { RadarEvaluatedMatch } from './radar-types.js';

const MAX_SAME_LABEL = 2;
const MAX_SCORE_GAP_FOR_REPLACEMENT = 15;

/**
 * Applies diversity rules to the sorted candidate list.
 * Returns up to 3 cards respecting the max-same-label constraint.
 */
export function applyDiversityFilter(
  sorted: RadarEvaluatedMatch[],
  maxCards = 3,
): RadarEvaluatedMatch[] {
  const selected: RadarEvaluatedMatch[] = [];
  const labelCount = new Map<string, number>();

  // First pass: fill greedily respecting max-same-label
  const remaining: RadarEvaluatedMatch[] = [];

  for (const candidate of sorted) {
    const count = labelCount.get(candidate.labelKey) ?? 0;
    if (count < MAX_SAME_LABEL) {
      selected.push(candidate);
      labelCount.set(candidate.labelKey, count + 1);
      if (selected.length >= maxCards) break;
    } else {
      remaining.push(candidate);
    }
  }

  // Second pass: if we need more cards, check if a diverse replacement exists
  if (selected.length < maxCards && remaining.length > 0) {
    for (const candidate of remaining) {
      const count = labelCount.get(candidate.labelKey) ?? 0;
      if (count < MAX_SAME_LABEL) {
        selected.push(candidate);
        labelCount.set(candidate.labelKey, count + 1);
        if (selected.length >= maxCards) break;
      }
    }
  }

  // Third pass: if all top-3 have the same label, replace the 3rd with a diverse one
  if (selected.length === maxCards) {
    const labels = selected.map((s) => s.labelKey);
    const uniqueLabels = new Set(labels);

    if (uniqueLabels.size === 1) {
      // All 3 same label — try to replace the 3rd
      const thirdScore = selected[2].radarScore;
      const diverse = sorted.find(
        (s) =>
          s.labelKey !== selected[0].labelKey &&
          !selected.includes(s) &&
          thirdScore - s.radarScore <= MAX_SCORE_GAP_FOR_REPLACEMENT,
      );
      if (diverse) {
        selected[2] = diverse;
      }
    }
  }

  return selected;
}
