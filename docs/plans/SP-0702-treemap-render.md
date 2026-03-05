# Plan: SP-0702 — Treemap Rendering Using Backend rect

## Spec refs
- frontend-architecture-corrected.md §7.3 (geometry ownership: backend rect is authoritative)
- ui-spec-corrected.md §4 (treemap: size rule, ordering, color, tile contents)
- Interaction Specification (hover scale 1.03, 120ms)
- Acceptance_Test_Matrix §H-01 (renders using rect, no client treemap solving)

## Design decisions

### NO client-side treemap solver
Per spec §7.3: "If backend returns treemap geometry (rect), frontend must render it as authoritative."
The backend already returns `rect: { x, y, w, h }` per team. Frontend simply positions divs.

### Rendering approach: Absolute positioning
```tsx
<div className="treemap-container" style={{ position: 'relative', width, height }}>
  {teams.map(team => (
    <TeamTile key={team.teamId} team={team} />
  ))}
</div>
```
Each TeamTile uses `position: absolute; left: rect.x; top: rect.y; width: rect.w; height: rect.h`.

### TeamTile content (per spec §4.5)
- Team name (truncate for small tiles)
- Optional short next-match label (opponent + time)
- Optional badge (proximity bucket derived from displayScore bands)
- Hover: scale 1.03, transition 120ms

### Color strategy
- MVP: Use displayScore bands to map to color intensity
  - Bands: high (>70), medium (30-70), low (<30) — or based on relative position
- Two theme palettes (night/day) — defer to SP-0704 for full theme
- MVP default: single color with opacity variation based on displayScore

### Tile size adaptation
- If tile is too small (w < 80 or h < 40): hide next-match label
- If tile is too small (w < 50 or h < 30): show only team initials
- This prevents text overflow

## Files to create
1. `packages/web/src/components/TreemapCanvas.tsx` — Container + tile mapping
2. `packages/web/src/components/TeamTile.tsx` — Individual tile
3. `packages/web/src/components/TileTooltip.tsx` — Hover tooltip with details
4. `packages/web/src/styles/treemap.module.css` — Treemap styles (or inline)

## Tests
- H-01: No treemap solver imported or executed in web package
- Unit: TreemapCanvas renders N tiles for N teams
- Unit: TeamTile positions at rect coordinates
- Unit: Small tiles degrade label gracefully
- Unit: Hover applies scale transform

## Implementation notes for Sonnet
- Container dimensions come from snapshot.layout.container
- Teams array comes from useDashboardSnapshot hook
- onClick on tile → dispatch focus to URL state (useUrlState from SP-0701)
- Use CSS transitions for hover, not JS animation
- Do NOT import @sportpulse/layout — boundary rule forbids web → layout
- Tooltip: simple div positioned relative to cursor, show on mouseEnter, hide on mouseLeave
- Keyboard: tiles should be focusable (tabIndex=0) with Enter to select
