# Plan: SP-0701 — Dashboard Page Rendering from Snapshot DTO

## Spec refs
- frontend-architecture-corrected.md §2.1 (snapshot-driven UI), §5 (data flow), §7 (DTO expectations)
- ui-spec-corrected.md §2 (screen model), §3 (header), §4 (treemap)
- Acceptance_Test_Matrix §H-01 (renders using rect)
- Component Map: App → Layout → Header + Dashboard → TreemapCanvas

## Design decisions

### MVP simplification: React SPA, NOT Next.js
The spec mentions Next.js App Router, but for MVP we use React + Vite (already scaffolded in packages/web with react 19). Server rendering is deferred to post-MVP. The web package is a client-side SPA that fetches from /api/ui/dashboard.

### Architecture
```
App
└── DashboardLayout
    ├── DashboardHeader (competition label, date, warning indicators)
    ├── TreemapCanvas (SP-0702)
    └── DetailPanel (SP-0703, initially hidden)
```

### Data fetching
- Custom hook `useDashboardSnapshot(competitionId, dateLocal, timezone)`
- Uses `fetch()` to GET /api/ui/dashboard
- Returns `{ data, loading, error }` tuple
- No external state management library (React state + context)

### URL state (per spec §8)
- `?mode=form|agenda` — dashboard mode
- `?focus=<teamId>` — selected team
- Read from URL search params, write via `history.replaceState`
- Use a custom `useUrlState()` hook

### Types
The web package imports NO backend packages (boundary rule). Instead, create local DTO types that mirror the API contract:
```
packages/web/src/types/snapshot.ts
```
These are frontend-local type definitions matching DashboardSnapshotDTO shape.

## Files to create

1. `packages/web/src/types/snapshot.ts` — Frontend DTO types
2. `packages/web/src/hooks/use-dashboard-snapshot.ts` — Data fetching hook
3. `packages/web/src/hooks/use-url-state.ts` — URL state management
4. `packages/web/src/components/DashboardLayout.tsx` — Main layout shell
5. `packages/web/src/components/DashboardHeader.tsx` — Header with metadata
6. `packages/web/src/App.tsx` — Root component
7. `packages/web/src/main.tsx` — Vite entry point
8. `packages/web/index.html` — Vite HTML entry
9. `packages/web/src/index.ts` — Update with exports
10. `packages/web/vite.config.ts` — Vite config for dev server with API proxy

## Files to modify
- `packages/web/package.json` — Add vite as devDep

## Tests (mapped to acceptance)
- H-01: Renders tiles using returned rect coordinates (no client-side treemap solver)
- Unit: useDashboardSnapshot returns loading → data states
- Unit: useUrlState reads/writes mode and focus correctly
- Unit: DashboardHeader shows competition and date from snapshot.header
- Unit: DashboardHeader shows warning indicator when warnings present

## Implementation notes for Sonnet
- Use vitest + @testing-library/react for component tests
- Mock fetch in tests using vi.fn()
- Frontend DTO types should match DashboardSnapshotDTO exactly but be locally defined (no cross-package import)
- Start with skeleton — treemap and detail panel come in SP-0702/SP-0703
- TreemapCanvas placeholder: render a div with "Treemap loading..." until SP-0702
- DetailPanel placeholder: null until SP-0703
- CSS: use CSS modules or inline styles for MVP, no Tailwind setup yet
- API proxy: Vite dev server proxies /api/* to localhost:3000 (Fastify)
