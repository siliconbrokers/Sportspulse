# Plan: SP-0704 — Degraded State Visuals

## Spec refs
- ui-spec-corrected.md §10 (empty, stale, partial states)
- frontend-architecture-corrected.md §2.5 (graceful degradation), §14 (error handling)
- Errors_and_Warnings_Taxonomy_v1.0.md
- Acceptance_Test_Matrix §H-03 (warning display)

## Design decisions

### Warning indicator in header
When `snapshot.warnings.length > 0`:
- Show a warning badge/icon in DashboardHeader
- Click expands a small warning list
- Color: yellow for WARN severity, red for ERROR

### Warning types and visual mapping

| Warning Code | Severity | Visual |
|---|---|---|
| STALE_DATA | WARN | Yellow banner "Data may be outdated" |
| PARTIAL_DATA | WARN | Yellow banner "Some data incomplete" |
| LAYOUT_DEGRADED | WARN | Yellow banner "Layout in fallback mode" |
| MISSING_SIGNAL | INFO | (not shown in header, only in detail panel) |
| INSUFFICIENT_HISTORY | INFO | (shown per-team in detail panel) |
| NO_UPCOMING_MATCH | INFO | (shown per-team in detail panel) |
| PROVIDER_ERROR | ERROR | Red banner "Data source error" |

### Loading state
- While `useDashboardSnapshot` is loading: show skeleton/placeholder treemap
- Skeleton: gray boxes with pulse animation

### Empty state
- When teams array is empty: show centered message "No teams available for this date"

### Error state
- When fetch fails entirely: show error message with retry button
- Map HTTP status to user-friendly message:
  - 400: "Invalid request"
  - 404: "Competition not found"
  - 503: "Service temporarily unavailable"
  - Other: "Something went wrong"

### Stale indicator on tiles
When snapshot source is 'stale_fallback' (from X-Snapshot-Source header):
- Add subtle dashed border or desaturated overlay to all tiles
- Show "Last updated: {computedAtUtc}" in header

## Files to create
1. `packages/web/src/components/WarningBanner.tsx` — Warning display component
2. `packages/web/src/components/LoadingSkeleton.tsx` — Treemap placeholder
3. `packages/web/src/components/EmptyState.tsx` — No data message
4. `packages/web/src/components/ErrorState.tsx` — Error + retry
5. `packages/web/src/utils/warning-display.ts` — Warning severity/code → text mapping

## Files to modify
- `packages/web/src/components/DashboardLayout.tsx` — Integrate all states
- `packages/web/src/components/DashboardHeader.tsx` — Warning badge
- `packages/web/src/hooks/use-dashboard-snapshot.ts` — Track X-Snapshot-Source header

## Tests
- H-03: Warning indicators appear when warnings present
- Unit: WarningBanner renders correct text for STALE_DATA
- Unit: LoadingSkeleton shows during loading
- Unit: EmptyState shows when teams=[]
- Unit: ErrorState shows on fetch failure
- Unit: Stale indicator visible when source is stale_fallback

## Implementation notes for Sonnet
- WarningBanner: collapsible list at top of dashboard, below header
- Warning severity filtering: only show WARN and ERROR in banner, INFO only in detail
- LoadingSkeleton: simple CSS animation (opacity pulse), 4-6 gray rectangles
- ErrorState retry: call refetch() from hook
- X-Snapshot-Source header: read from fetch response, store in hook state
- Theme colors for warnings: use CSS custom properties --warning-color, --error-color
