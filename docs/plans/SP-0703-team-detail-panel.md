# Plan: SP-0703 — Team Selection + Detail Panel

## Spec refs
- ui-spec-corrected.md §6 (hover/focus), §7 (detail panel)
- frontend-architecture-corrected.md §12 (explainability UI)
- Interaction Specification (detail panel: slide from right, 220ms; spotlight: selected highlight, others opacity 0.8)
- Acceptance_Test_Matrix §H-02 (detail uses snapshot/projection only)
- api-contract-corrected.md §8.2 (GET /api/ui/team)

## Design decisions

### Selection model
1. User clicks TeamTile → `focus=<teamId>` in URL state
2. DashboardLayout detects focus → fetches GET /api/ui/team
3. DetailPanel slides in from right (220ms)
4. Spotlight mode: focused tile highlighted, others opacity 0.8

### Data fetching for detail
- Hook: `useTeamDetail(competitionId, teamId, dateLocal, timezone)`
- Fetches GET /api/ui/team?competitionId=X&teamId=Y&dateLocal=D&timezone=Z
- Returns TeamDetailDTO (frontend-local type mirroring backend shape)
- Only fetches when teamId is set (focus active)

### Detail panel content (per spec §7)
```
DetailPanel
├── TeamHeader (name, badge)
├── ScoreSummary (rawScore, attentionScore, displayScore as visual)
├── NextMatchPreview (opponent, kickoff, venue)
├── ExplainSection
│   ├── TopContributions list (signal key + contribution value)
│   └── Optional signal details
└── CloseButton (clears focus from URL)
```

### Spotlight mode
When a team is focused:
- Selected tile: normal opacity, subtle border/glow
- Other tiles: opacity 0.8
- CSS class toggle on TreemapCanvas based on `focusedTeamId`

### Deselection
- Click outside detail panel → clear focus
- Press Escape → clear focus
- Click close button → clear focus
- All deselection methods remove `focus` from URL

## Files to create
1. `packages/web/src/components/DetailPanel.tsx` — Sliding panel container
2. `packages/web/src/components/TeamHeader.tsx` — Team identity in panel
3. `packages/web/src/components/ScoreSummary.tsx` — Score visualization
4. `packages/web/src/components/NextMatchPreview.tsx` — Next match info
5. `packages/web/src/components/ExplainSection.tsx` — Contributions + signals
6. `packages/web/src/hooks/use-team-detail.ts` — Data fetching for team detail
7. `packages/web/src/types/team-detail.ts` — Frontend TeamDetailDTO type

## Files to modify
- `packages/web/src/components/DashboardLayout.tsx` — Add DetailPanel + spotlight logic
- `packages/web/src/components/TreemapCanvas.tsx` — Add spotlight CSS class when focused
- `packages/web/src/components/TeamTile.tsx` — onClick dispatches focus

## Tests
- H-02: Detail view uses snapshot/projection data only
- Unit: DetailPanel renders team name from TeamDetailDTO
- Unit: Clicking tile sets focus in URL state
- Unit: Escape key clears focus
- Unit: Spotlight mode reduces opacity on non-focused tiles
- Unit: ExplainSection renders topContributions

## Implementation notes for Sonnet
- DetailPanel uses CSS transform: translateX(100%) → translateX(0) for slide animation
- Transition duration: 220ms ease-out
- On mobile: detail panel would be full-width sheet (defer responsive to post-MVP, use fixed width 360px for now)
- ExplainSection: render contributions as simple list items with signal key + formatted value
- Do NOT re-fetch dashboard snapshot — the team detail is a separate lightweight endpoint
- If team has no nextMatch, hide NextMatchPreview section
- Close button: simple X icon, positioned top-right of panel
