# SportPulse — Treemap Algorithm Specification

Version: 1.1  
Status: Draft for review  
Scope: Deterministic treemap geometry generation for SportPulse dashboard snapshots  
Audience: Backend, Frontend, QA, Ops

---

## 1. Purpose

This document defines the **treemap layout algorithm contract** for SportPulse MVP.

It answers one specific question:

> Given a deterministic ordered set of entities with `layoutWeight`, how must the system produce stable treemap geometry for the dashboard?

This specification is aligned with:

- `signals-spec.md`
- `metrics-spec.md`
- `scoring-policy-spec.md`
- `snapshot-engine-spec.md`
- `dashboard-snapshot-dto.md`
- `frontend-architecture.md`
- `ui-spec.md`

---

## 2. Foundational decision: layout is backend-owned

Treemap geometry is **computed server-side** and embedded in the dashboard snapshot.

The frontend must render the geometry returned by backend.  
The frontend must **not**:

- run its own treemap solver
- reorder entities before layout
- perturb tile sizes for aesthetic reasons
- apply local weight transforms
- invent inertia or pinning behavior in MVP v1

This follows the project constitution rule that the frontend must not compute layout.

**Consequent DTO requirement**

Each team tile in `DashboardSnapshotDTO` must include a `rect` field:

```ts
type RectDTO = {
  x: number;   // px, relative to treemap container origin
  y: number;   // px, relative to treemap container origin
  w: number;   // px
  h: number;   // px
};
```

If current DTOs omit `rect`, they must be patched.  
Without `rect`, the project contradicts its own “backend owns layout” rule.

---

## 3. MVP scope

MVP v1 scope:

- entity kind: `TEAM`
- one competition snapshot at a time
- one treemap container per snapshot
- no subgroup nesting
- no favorites anchoring
- no inertia memory algorithm
- no mixed TEAM/MATCH layout
- no client-side recomputation

Future versions may add:

- pinned favorites
- low-movement relayout
- grouped regions
- mixed entity kinds

Those are **not** part of MVP v1.

---

## 4. Inputs

### 4.1 Required inputs

Treemap layout consumes:

- ordered `teams[]`
- each item with:
  - `teamId`
  - `layoutWeight`
- container configuration:
  - `containerWidth`
  - `containerHeight`
  - `outerPadding`
  - `innerGutter`

### 4.2 Input ordering rule

Input order is already determined upstream and must be preserved.

The input list passed into the layout algorithm must be sorted by:

1. `layoutWeight` descending
2. `teamId` ascending (tie-breaker)

No hash-based tie-breakers are allowed in MVP v1.

This explicitly removes the older `stableIndex = hash(entityId)` style rule, because that creates opaque and non-debuggable ordering behavior.

### 4.3 Weight constraints

Rules:

- `layoutWeight` must be finite
- `layoutWeight >= 0`
- if all weights are zero, fallback behavior must apply (see section 8)
- negative weights are invalid and must fail snapshot build validation

---

## 5. Layout container model

### 5.1 Treemap frame

The treemap container is defined by:

```ts
type TreemapContainerDTO = {
  width: number;
  height: number;
  outerPadding: number;
  innerGutter: number;
};
```

Effective layout area:

- `usableX = outerPadding`
- `usableY = outerPadding`
- `usableWidth = width - 2 * outerPadding`
- `usableHeight = height - 2 * outerPadding`

The algorithm must never place tiles outside this usable area.

### 5.2 Pixel coordinate system

Coordinates are expressed:

- in pixels
- relative to the top-left corner of the treemap container
- with origin `(0, 0)` at top-left

All output rectangles must satisfy:

- `x >= outerPadding`
- `y >= outerPadding`
- `w >= 0`
- `h >= 0`

---

## 6. Algorithm choice for MVP v1

MVP v1 uses:

- **Squarified Treemap**
- deterministic implementation
- no randomization
- no heuristic perturbation based on prior frame state

Reason:

- visually balanced enough for MVP
- widely understood
- easy to test
- deterministic given stable input order and fixed arithmetic rules

---

## 7. Normalized area allocation

### 7.1 Area basis

Let:

- `W = usableWidth`
- `H = usableHeight`
- `A = W * H`
- `sumWeights = Σ(layoutWeight_i)`

For each tile:

- `idealArea_i = A * (layoutWeight_i / sumWeights)`

### 7.2 Zero-weight handling at item level

If an item has `layoutWeight = 0`:

- it remains part of the sorted list
- its `idealArea_i = 0`

Rendering policy for zero-area items in MVP v1:

- they may be omitted from geometry output **or**
- emitted with zero rect

Choose one behavior and keep it consistent project-wide.

**Recommended MVP rule:** omit zero-area tiles from `teams[]` treemap geometry output but keep them available in non-layout lists if needed elsewhere.

---

## 8. All-zero fallback behavior

If `sumWeights == 0`, the snapshot builder must not fail.

Fallback rule for MVP v1:

- assign equal synthetic weights to all eligible teams for layout only
- keep original score fields unchanged
- emit warning:
  - `code = "LAYOUT_DEGRADED"`
  - `severity = "WARN"`

This preserves usability without lying about score values.

Example:

If 20 teams and all `layoutWeight = 0`, layout uses `1/20` each for geometry only.

---

## 9. Row construction and determinism

The squarified treemap implementation must be deterministic.

Requirements:

- rows are built in input order
- aspect ratio comparison must use stable arithmetic
- no randomized row splitting
- no floating-point tolerance branches that depend on runtime/platform quirks without explicit rounding rules

### 9.1 Recommended arithmetic rule

Before final pixel assignment, internal area calculations may use floating point.

For persisted geometry output, the implementation must apply canonical rounding rules (section 10).

---

## 10. Pixel rounding and residual distribution

This is where many “deterministic” treemaps become fake-deterministic.

### 10.1 Canonical rounding rule

Geometry persistence must follow this sequence:

1. compute ideal rectangles in floating point
2. floor intermediate widths/heights to integer pixels
3. track residual pixels per row/column
4. distribute residual pixels deterministically in input order within the affected row/column
5. ensure final union exactly fills the usable area except gutters

### 10.2 Residual distribution rule

When a row/column has remaining pixels after flooring:

- assign extra pixels one by one
- in tile order within that row/column
- earlier tiles receive extra pixels first

No random distribution and no hash-based distribution.

### 10.3 Last-tile closure rule

To avoid cumulative drift:

- the last tile in each row/column must absorb any final remaining pixel remainder necessary to close the row/column exactly

This rule overrides naive rounding if needed.

---

## 11. Gutter handling

### 11.1 Inner gutter semantics

`innerGutter` is the spacing between adjacent rectangles.

Rules:

- gutter exists only between tiles, not between tile and container edge
- outer edge spacing is controlled only by `outerPadding`
- total gutter subtraction must be accounted for during row/column packing

### 11.2 Deterministic gutter application

Gutter placement must be applied uniformly across rows/columns.

No style-layer margin hacks are allowed to simulate gutters after geometry output.  
Gutters are part of layout, not decoration.

---

## 12. Output contract

Each laid-out team tile must include:

```ts
type TreemapTeamTileDTO = {
  teamId: string;
  teamName: string;

  policyKey: string;
  policyVersion: number;
  buildNowUtc: string;

  rawScore: number;
  attentionScore: number;
  displayScore: number;
  layoutWeight: number;

  rect: {
    x: number;
    y: number;
    w: number;
    h: number;
  };

  topContributions: ContributionDTO[];
  signals?: SignalDTO[];
  nextMatch?: {
    matchId: string;
    kickoffUtc: string;
    opponentTeamId?: string;
    opponentName?: string;
    venue?: "HOME" | "AWAY" | "NEUTRAL" | "UNKNOWN";
  };
};
```

The frontend uses:

- `rect` for geometry
- `displayScore` for labels/color bands if needed
- `layoutWeight` only as explanatory/debug value, not for recomputation

---

## 13. Stability guarantees

MVP v1 guarantees:

- same ordered inputs + same container config + same algorithm version
- same output geometry

This means:

- tile movement is a consequence of changed `layoutWeight` or changed entity set
- not of hidden randomness

MVP v1 does **not** guarantee minimal movement across days.  
That would require a future “layout inertia” or “anchored treemap” version.

---

## 14. Versioning

Treemap behavior is versioned independently.

Recommended metadata:

- `layoutAlgorithmKey = "treemap.squarified"`
- `layoutAlgorithmVersion = 1`

These values should be stored in snapshot metadata so historical snapshots remain interpretable.

Any change to:

- packing algorithm
- rounding rules
- residual distribution
- gutter semantics
- fallback behavior

requires a new `layoutAlgorithmVersion`.

---

## 15. Validation rules

Snapshot build must validate:

- container dimensions > 0
- usable width/height > 0 after padding
- all `layoutWeight` finite and non-negative
- input order already canonical
- output rects do not overlap except at shared boundaries/gutters
- output rects stay within usable bounds
- output rects close rows/columns exactly under canonical rounding rules

If validation fails:

- snapshot build fails
- API may serve last good snapshot with warning per snapshot fallback rules

---

## 16. Acceptance criteria

The treemap algorithm is acceptable when:

1. Same inputs produce identical `rect` outputs.
2. No client-side layout computation is required.
3. Input ordering is `layoutWeight desc, teamId asc`.
4. Residual pixel handling is deterministic and testable.
5. All-zero weights degrade gracefully using equal synthetic layout weights plus warning.
6. Geometry respects `outerPadding` and `innerGutter`.
7. Historical snapshots remain renderable using stored layout algorithm metadata.

---

## 17. Example metadata block

```json
{
  "layout": {
    "algorithmKey": "treemap.squarified",
    "algorithmVersion": 1,
    "container": {
      "width": 1200,
      "height": 700,
      "outerPadding": 8,
      "innerGutter": 6
    }
  }
}
```

---

## 18. Explicit removals from the previous draft

The following legacy ideas are invalid in MVP v1:

- `stableIndex = hash(entityId)` as ordering tie-breaker
- frontend-owned treemap computation
- geometry inferred from `sizeScore` in UI
- non-versioned layout changes
- hidden layout heuristics that are not captured in snapshot metadata
