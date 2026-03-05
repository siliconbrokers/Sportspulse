# Plan: SP-0204 — PROXIMITY_BUCKET Helper

## Tier: sonnet (no Opus design needed)

## Spec refs
- snapshot-engine-spec-corrected.md §7.3c
- signals-spec.md PROXIMITY_BUCKET

## Implementation
Create `packages/signals/src/compute/proximity-bucket.ts`:

```ts
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
```

## Files
- Create: `packages/signals/src/compute/proximity-bucket.ts`
- Modify: `packages/signals/src/index.ts` (add exports)
- Create: `packages/signals/test/proximity-bucket.test.ts`

## Tests: B-06
- 0h → D1, 24h → D1, 25h → D3, 72h → D3, 73h → W1, 168h → W1, 169h → LATER
- missing signal → NONE
- no hours param → NONE
