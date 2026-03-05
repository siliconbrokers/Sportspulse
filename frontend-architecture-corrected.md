# SportPulse — Frontend Architecture

Version: 1.1  
Status: Draft for review  
Scope: Frontend architecture for SportPulse MVP dashboard consuming snapshot-based APIs  
Audience: Frontend, Backend, QA, Ops

---

## 1. Scope

- Product: SportPulse
- MVP mode: **Form + agenda**
- Sport: **football**
- Competition model in MVP: **single competition enabled**
- Provider: **football-data.org**, normalized by backend before reaching frontend
- Themes: Night (default) and Day

This architecture must support future expansion to additional sports and competitions **without forcing provider-specific or score-computation logic into the frontend**.

---

## 2. Architecture principles

### 2.1 Snapshot-driven UI

The frontend consumes **backend-generated snapshots** only.

Allowed flow:

Provider API  
→ Backend ingestion  
→ Canonical storage  
→ Snapshot builder  
→ Internal API  
→ Frontend

The frontend must never call the provider directly.

### 2.2 Deterministic rendering

All visual state for the dashboard must derive from snapshot DTO fields only.

This includes:

- tile geometry
- tile sizing
- score labels
- badges
- detail panel content
- stale/partial-data warnings

The frontend must not compute or re-derive scoring signals.

### 2.3 Backend-owned scoring

The frontend consumes:

- `attentionScore`
- `displayScore`
- `layoutWeight`

The frontend must **not** compute:

- `sizeScore`
- `proximityBonus`
- derived weights from hours/form values
- alternative tile importance formulas

### 2.4 Provider isolation

The frontend must depend only on internal DTOs, never on provider schemas, provider IDs, or provider-specific field naming.

### 2.5 Graceful degradation

If ingestion fails or data is stale, the frontend must continue rendering the last valid snapshot and display warning state based on snapshot metadata.

---

## 3. Non-goals (MVP)

Out of scope for MVP:

- direct provider fetches from browser
- live minute-by-minute updates
- client-side score computation
- multi-competition switching
- prediction engines
- advanced analytics overlays
- mixed entity-kind treemap rendering

MVP v1 treemap renders **TEAM entities only**.

---

## 4. Technology stack

- Framework: Next.js (App Router)
- Language: TypeScript
- Styling: Tailwind CSS + design tokens
- State:
  - URL state for shareable dashboard state
  - local component state for ephemeral UI only
- Rendering:
  - server rendering for initial dashboard response
  - client hydration for interactions
- Caching:
  - server-side response caching for snapshot fetches

---

## 5. Data flow

### 5.1 Request flow

1. User requests dashboard route
2. Server fetches `DashboardSnapshotDTO` from internal API
3. Server renders HTML using snapshot data
4. Client hydrates interactive components
5. Subsequent navigations may reuse cached snapshot data according to API/cache policy

### 5.2 Snapshot contract usage

The frontend uses:

- `header` for metadata, warnings, and debug identity
- `teams[]` as treemap input
- `nextMatch` for agenda/detail display
- `topContributions` and optional `signals[]` for explainability UI

The frontend must treat the snapshot as **authoritative**.

---

## 6. Snapshot identity and cache semantics

Frontend-visible snapshot identity is defined by:

- `competitionId`
- `seasonId`
- `buildNowUtc`
- `policyKey`
- `policyVersion`

If any of the above changes, the snapshot is a different scoring/rendering artifact even if the competition is the same.

The frontend may use `snapshotKey` as a convenience cache/debug key if the backend provides it, but identity semantics come from the tuple above.

---

## 7. Frontend DTO expectations

### 7.1 Root payload

The frontend expects `DashboardSnapshotDTO` with:

- `header`
- `teams[]`

Optional future payloads may add:

- `matches[]`
- richer detail blocks
- additional explainability metadata

### 7.2 Team tile data

Each team tile must consume:

- `teamId`
- `teamName`
- `displayScore`
- `layoutWeight`
- `nextMatch`
- optional `topContributions`
- optional `signals[]`

Forbidden legacy assumptions:

- tile size derived from `formPoints5 + proximityBonus`
- tile size derived from `NEXT_MATCH_HOURS` in UI
- tile urgency computed in frontend formulas

### 7.3 Geometry ownership

If backend returns treemap geometry (`rect`), frontend must render it as authoritative.

If backend returns only ordered weighted items, frontend may pass `layoutWeight` into the deterministic treemap renderer defined elsewhere.

In either case, frontend input for sizing is **`layoutWeight`**, not legacy size formulas.

---

## 8. URL state

Dashboard shareable state must remain encoded in the URL.

Allowed MVP parameters:

- `mode=form|agenda`
- `focus=<teamId>`
- `sheet=agenda|detail` (mobile/detail presentation)

Rules:

- URL is source of truth for navigation state
- snapshot identity is **not** reconstructed from URL-only heuristics
- score-related state must not be synthesized in the client

---

## 9. Rendering strategy

### 9.1 Server rendering

Dashboard pages should render on the server using snapshot data to avoid empty first paint.

### 9.2 Hydration

After initial render, client hydration enables:

- tile hover
- tile focus/select
- detail panel open/close
- mode switching
- agenda navigation

Hydration must not recompute weights or score mappings.

### 9.3 Loading/fallback states

Supported states:

- loading
- empty competition day
- stale snapshot
- partial data
- provider error fallback

If provider fails, frontend renders last valid snapshot with warning indicators.

---

## 10. State model

### 10.1 Persistent/shareable state

- dashboard mode
- focused team
- mobile sheet selection
- theme preference (optionally shareable only if product wants it; default no)

### 10.2 Ephemeral UI state

- hovered tile
- tooltip visibility
- local animation state

### 10.3 Forbidden state ownership

Frontend must not own:

- signal normalization parameters
- score policy logic
- weight formulas
- policy version inference

Those belong to backend contracts.

---

## 11. Treemap rendering contract

### 11.1 Ordering

Treemap input order must follow snapshot order:

- `teams[]` sorted by `layoutWeight desc, teamId asc`

Frontend must not reorder by name, next match time, or local heuristics before layout/render.

### 11.2 Size semantics

Tile area corresponds to `layoutWeight`.

This is the only score-to-area contract the frontend may rely on.

### 11.3 Labeling semantics

Frontend may display:

- team name
- next match summary
- display score-derived styling
- deterministic badges

But labels must not imply hidden formulas that are not present in backend policy.

---

## 12. Explainability UI

Frontend may expose:

- top contributions
- stable explanation strings from signals
- recent form visual summaries if included in snapshot

Explainability must be **data-driven** from backend payloads.

Frontend must not generate pseudo-explanations such as:

- “bigger because next match is very close”
unless that statement is grounded in returned contributions/signals.

---

## 13. Theme and design system

Two themes in MVP:

- Night Stadium
- Day Mode

Theme system responsibilities:

- token-based color application
- spacing, typography, radius, motion tokens
- deterministic color mapping for stable UI appearance if specified by design system

Theme must not alter score semantics.

---

## 14. Error handling

The frontend must support:

- stale data warning
- partial data warning
- provider failure fallback
- no-data state
- malformed snapshot defensive handling

If snapshot shape is invalid for required fields, fail safely with error boundary rather than silently inventing score defaults.

---

## 15. Definition of done

Frontend implementation is complete when:

- dashboard renders from `DashboardSnapshotDTO`
- treemap tile size is driven only by `layoutWeight`
- tile click opens detail panel
- URL state restores mode/focus deterministically
- stale/partial warnings render correctly
- frontend does not compute score formulas
- theme switching works
- provider failure fallback works

---

## 16. Explicit migration notes from legacy frontend docs

The following legacy assumptions are invalid and must not appear in implementation:

- `TreemapTileDTO.formPoints5`
- `TreemapTileDTO.proximityBonus`
- `TreemapTileDTO.sizeScore`
- tile size = `formPoints5 + proximityBonus`
- UI-owned urgency bonus formulas

All such logic is superseded by backend-owned scoring outputs and the corrected snapshot DTO contract.
