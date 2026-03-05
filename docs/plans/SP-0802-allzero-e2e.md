# Plan: SP-0802 — Validate All-Zero Layout Fallback End-to-End

## Spec refs
- Acceptance_Test_Matrix §D-04 (all-zero layoutWeight fallback)
- Golden_Snapshot_Fixtures §6.6 (F6 layout degenerate)
- treemap-algorithm-spec-corrected.md (equal synthetic weights)

## Design decisions

### End-to-end path
Test the full pipeline: API request → snapshot build → all-zero detection → equal fallback → valid geometry → response.

### What to validate
1. All teams have layoutWeight=0 in scored output
2. LAYOUT_DEGRADED warning present
3. Geometry still produced (all rects have w>0, h>0)
4. Tiles are approximately equal area (equal fallback)
5. No overlap, within bounds
6. API returns 200 (not error)

## Files to create
1. `packages/api/test/allzero-layout-e2e.test.ts` — Full API test:
   - DataSource returns teams with no matches (→ zero scores)
   - GET /api/ui/dashboard → 200
   - Response contains LAYOUT_DEGRADED warning
   - All teams have rect with positive dimensions
   - All rects fit within container bounds

## Tests (mapped to acceptance)
- D-04: All-zero layoutWeight produces valid equal-area fallback
- E-03: Even degraded teams have rect

## Implementation notes for Sonnet
- Use buildApp with mock DataSource that returns teams but no matches
- Verify geometry using simple bounds check (x >= padding, x+w <= container.width - padding)
- Compare tile areas: they should be approximately equal (within rounding tolerance)
- Verify LAYOUT_DEGRADED in response warnings array
