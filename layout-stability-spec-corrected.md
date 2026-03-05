# SportPulse — Layout Stability Specification

Version: 1.1  
Status: Draft for review  
Scope: Visual stability rules for treemap layout across snapshots  
Audience: Backend, Frontend, QA, Ops

---

## 1. Purpose

Treemap layouts can become visually chaotic across snapshots even when the system is technically deterministic.

This specification defines how SportPulse preserves **visual stability**, **spatial memory**, and **predictable motion** across snapshots **without corrupting scoring semantics or hiding layout logic in the frontend**.

This document is aligned with:

- `treemap-algorithm-spec.md`
- `dashboard-snapshot-dto.md`
- `snapshot-engine-spec.md`
- `frontend-architecture.md`
- `ui-spec.md`
- `scoring-policy-spec.md`

---

## 2. Critical design decision

For MVP v1, layout stability is achieved primarily through:

1. deterministic input ordering  
2. deterministic server-side geometry generation  
3. deterministic color assignment  
4. bounded, data-driven frontend animation  
5. explicit movement/change metadata

MVP v1 does **not** use:

- favorites anchoring
- cluster anchoring
- weight smoothing
- seeded ordering from previous snapshots
- inertia corrections that override canonical ordering
- score bonuses for visual persistence

Those are potential future layout versions, not part of the current contract.

---

## 3. Stability goals

The system must:

- remain deterministic
- preserve spatial memory as much as possible under deterministic treemap rules
- avoid unnecessary tile movement caused by non-essential randomness or hidden heuristics
- expose when layout shifts materially
- keep appearance cues stable across snapshots

The system must **not**:

- sacrifice score ordering correctness
- mutate weights for aesthetic convenience
- use UI-only hacks to fake stability

---

## 4. MVP v1 stability model

### 4.1 What creates stability in v1

Stability in MVP v1 comes from:

- canonical ordering: `layoutWeight desc, teamId asc`
- fixed treemap algorithm and rounding rules
- fixed container config per responsive profile
- server-owned `rect` output
- stable visual identity rules (color, labels, badge semantics)
- transition animation using previous and next `rect`

### 4.2 What v1 does not promise

MVP v1 does **not** promise:

- minimum movement between consecutive days
- anchored regions for specific teams
- preserved quadrant placement when weights materially change
- special protection for favorites
- cluster-local reflow

If weights or entity set change, movement is allowed as a consequence of the deterministic layout.

---

## 5. Deterministic ordering rule

Before layout, entities must be ordered by:

1. `layoutWeight` descending  
2. `teamId` ascending

No hash-based tie-breakers are allowed.

No previous-index reordering is allowed in MVP v1.

This is the foundational stability rule.  
If ordering is not stable, every later “stability” claim is fake.

---

## 6. Stable geometry preconditions

Layout stability claims are valid only if all of these remain constant between the compared snapshots:

- same ordered entity list
- same `layoutAlgorithmKey`
- same `layoutAlgorithmVersion`
- same container dimensions
- same `outerPadding`
- same `innerGutter`
- same rounding/residual distribution rules

If any of these change, geometry differences are expected and must not be mislabeled as instability regressions.

---

## 7. Visual identity stability

### 7.1 Color stability

Color assignment must be deterministic across snapshots.

Recommended rule:

```ts
colorToken = palette[stableHash(teamId) mod paletteSize]
```

Rules:

- color assignment depends on stable identity, not current score rank
- theme changes may change the palette set, but the mapping rule must remain deterministic within each theme
- color must not oscillate between snapshots for the same team under the same theme

### 7.2 Badge stability

Badges must be driven by snapshot data and stable rules.

A badge may change only when its underlying data changes (e.g., next match enters a threshold bucket, match becomes postponed, data becomes stale).

Badges must not flicker due to layout or animation alone.

### 7.3 Label behavior

Label truncation, font scaling, and placement must follow deterministic UI rules.

Recommended MVP rule:

- labels centered within the tile
- label truncation based on available width/height bands
- no random abbreviation or line-breaking choices

---

## 8. Layout movement metrics

Snapshot generation must compute movement/change metrics by comparing the current snapshot with the immediately previous snapshot for the same competition/view profile, when available.

### 8.1 Per-tile movement

For any tile that exists in both snapshots:

```ts
oldCenter = (oldRect.x + oldRect.w / 2, oldRect.y + oldRect.h / 2)
newCenter = (newRect.x + newRect.w / 2, newRect.y + newRect.h / 2)
movementPx = distance(oldCenter, newCenter)
movementRatio = movementPx / containerDiagonal
```

### 8.2 Aggregate metrics

Recommended snapshot-level metrics:

- `tileMovementAverage`
- `tileMovementMax`
- `tilesAdded`
- `tilesRemoved`
- `resizedTileCount`
- `reorderedTileCount` (optional; based on canonical order changes)

### 8.3 Material layout shift warning

If movement exceeds a configured threshold, snapshot warnings should include a layout-shift signal.

Recommended MVP default:

- `tileMovementAverage > 0.25` => add warning code `LAYOUT_SHIFT`
- severity: `INFO` or `WARN` depending on product preference

This warning informs operators/QA; it does not trigger client-side corrections.

---

## 9. New and removed entities

### 9.1 New entities

If a new entity appears in the current snapshot:

- it enters the canonical ordering normally
- it receives geometry from the standard layout algorithm
- frontend may animate its entry from low-opacity or scale-up state

Backend must not inject fake bonus weights to “protect” older tiles.

### 9.2 Removed entities

If an entity disappears:

- it is removed from the current snapshot
- layout is recomputed deterministically from the remaining ordered items
- frontend may animate exit if comparing old/new snapshots locally

Backend must not preserve ghost tiles in the materialized snapshot.

---

## 10. Frontend transition rules

Frontend may animate between old and new `rect` values.

Recommended MVP defaults:

- duration: `250ms` to `300ms`
- easing: `ease-out`
- interpolate:
  - `x`
  - `y`
  - `w`
  - `h`

Avoid:

- opacity-only transitions for major layout moves
- animations that imply score changes not present in snapshot data
- client-side reordering during animation

The animation system is presentational only.  
It must not mutate snapshot order, weight, or geometry.

---

## 11. Snapshot metadata requirements

To make stability observable and debuggable, snapshot payloads should carry:

### 11.1 Required

- `layout.algorithmKey`
- `layout.algorithmVersion`
- `layout.container`
- `teams[].rect`

### 11.2 Recommended

A `layoutDiagnostics` block in snapshot metadata:

```ts
type LayoutDiagnosticsDTO = {
  previousSnapshotKey?: string;
  tileMovementAverage?: number;
  tileMovementMax?: number;
  tilesAdded?: number;
  tilesRemoved?: number;
  resizedTileCount?: number;
  layoutShift?: boolean;
};
```

If included, it must be derived server-side.

---

## 12. Acceptance criteria

Layout stability is acceptable in MVP v1 when:

1. Same inputs produce identical geometry.
2. Same team under same theme keeps the same deterministic color token.
3. Badge changes occur only when underlying snapshot data changes.
4. Frontend animations interpolate returned geometry; they do not invent new layout.
5. Large layout movement is measurable through server-side diagnostics.
6. No score bonuses or layout hacks are applied for favorites or legacy stability tricks.
7. Stability behavior remains consistent with `layoutAlgorithmVersion`.

---

## 13. Explicit removals from previous draft

The following ideas from the earlier draft are **not valid in MVP v1**:

- cluster anchoring
- favorites anchoring
- `favoriteBonus = +15% sizeScore`
- seeded ordering from previous snapshot
- inertia correction that overrides canonical sort
- cluster-region-only reflow
- score mutation for stability purposes

These may be reconsidered only in a future **new layout algorithm version**.

---

## 14. Future extension path (not active now)

Future versions may introduce:

- anchored favorites region
- cluster-local treemap packing
- previous-layout-aware inertia
- bounded reordering heuristics
- explicit movement budgets

If any of these are introduced, they require:

- new `layoutAlgorithmVersion`
- updated `treemap-algorithm-spec.md`
- updated `dashboard-snapshot-dto.md` if metadata shape changes
- new acceptance tests demonstrating preserved determinism
