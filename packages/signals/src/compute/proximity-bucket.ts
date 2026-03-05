import type { SignalDTO } from '../registry/signal-dto.js';

/**
 * Computes a proximity bucket from a NEXT_MATCH_HOURS signal.
 *
 * Spec refs:
 * - snapshot-engine-spec-corrected.md §7.3c
 * - signals-spec.md PROXIMITY_BUCKET
 *
 * Buckets:
 *   0..24h   → D1
 *   24..72h  → D3
 *   72..168h → W1
 *   >168h    → LATER
 *   missing  → NONE
 */

export enum ProximityBucket {
  D1 = 'D1',       // 0..24h
  D3 = 'D3',       // 24..72h
  W1 = 'W1',       // 72..168h
  LATER = 'LATER', // >168h
  NONE = 'NONE',   // missing signal
}

export function computeProximityBucket(nextMatchHoursSignal: SignalDTO): ProximityBucket {
  if (nextMatchHoursSignal.quality.missing) return ProximityBucket.NONE;
  const hours = nextMatchHoursSignal.params?.hours as number | undefined;
  if (hours === undefined) return ProximityBucket.NONE;
  if (hours <= 24) return ProximityBucket.D1;
  if (hours <= 72) return ProximityBucket.D3;
  if (hours <= 168) return ProximityBucket.W1;
  return ProximityBucket.LATER;
}
