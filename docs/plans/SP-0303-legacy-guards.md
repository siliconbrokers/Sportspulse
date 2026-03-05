# Plan: SP-0303 — Legacy Resistance Guard Tests

## Tier: sonnet (no Opus design needed)

## Spec refs
- CLAUDE.md "Prohibited Legacy Constructs"
- Constitution §22 (legacy terms)

## Implementation
Create `packages/scoring/test/legacy-resistance.test.ts`:

Grep all .ts files in packages/scoring/src/ for forbidden terms:
- `SIZE_SCORE`
- `PROXIMITY_BONUS`
- `HOT_MATCH_SCORE`
- `scoreVersion` (must use policyKey + policyVersion)
- `sizeScore`
- `proximityBonus`

Pattern: same approach as boundary-check.test.ts — read files, assert no matches.

Also verify in packages/signals/src/ and packages/snapshot/src/:
- Same forbidden terms

## Files
- Create: `packages/scoring/test/legacy-resistance.test.ts`

## Tests: C-04
- No forbidden legacy terms in scoring/src
- No forbidden legacy terms in signals/src
- No forbidden legacy terms in snapshot/src
