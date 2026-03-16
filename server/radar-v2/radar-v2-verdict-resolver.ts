/**
 * Radar SportPulse v2 — Verdict Resolver
 * Wraps v1 verdict logic and outputs v2 verdict contract.
 * Spec: spec.sportpulse.radar-v2-json-contracts-and-lifecycle.md §7, §15
 *
 * Verdict is append-only. It never rewrites preMatchText.
 */

import type { RadarV2Card, RadarV2Verdict, RadarV2Label } from './radar-v2-types.js';
import {
  resolveVerdict as v1ResolveVerdict,
  supportsVerdict as v1SupportsVerdict,
} from '../radar/radar-verdict-resolver.js';
import type { RadarLabelKey } from '../radar/radar-types.js';

/**
 * Returns true if this label supports post-match verdict.
 * Only analytical labels (DYNAMICS + MISALIGNMENT) get verdicts.
 */
export function supportsV2Verdict(label: RadarV2Label): boolean {
  return v1SupportsVerdict(label as RadarLabelKey);
}

/**
 * Resolves the v2 verdict for a completed match.
 * Returns null if the label does not support verdicts.
 */
export function resolveV2Verdict(
  card: RadarV2Card,
  scoreHome: number,
  scoreAway: number,
  favoriteSide: 'HOME' | 'AWAY' | null,
  resolvedAt: string,
): RadarV2Verdict | null {
  if (!supportsV2Verdict(card.primaryLabel)) return null;

  const v1Result = v1ResolveVerdict(
    card.primaryLabel as RadarLabelKey,
    scoreHome,
    scoreAway,
    favoriteSide,
  );

  if (!v1Result) return null;

  return {
    status: v1Result.verdict,
    label: card.primaryLabel,
    verdictText: v1Result.verdictText,
    resolvedAt,
  };
}
