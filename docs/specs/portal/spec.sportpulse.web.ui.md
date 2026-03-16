---
artifact_id: SPEC-SPORTPULSE-WEB-UI
title: "UI Specification"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: web
slug: ui
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/specs/spec.sportpulse.web.ui.md
---
# SportPulse — UI Specification

Version: 1.1  
Status: Draft for review  
Scope: MVP dashboard UI behavior and visual rules aligned with snapshot-driven scoring  
Audience: Product, Frontend, Backend, QA, Design

---

## 1. Purpose

This document defines the UI behavior for SportPulse MVP dashboard.

It assumes the frontend consumes `DashboardSnapshotDTO` and that backend already provides:

- `attentionScore`
- `displayScore`
- `layoutWeight`

This specification does **not** define score formulas. It defines how the UI presents and interacts with the data returned by backend snapshots.

---

## 2. MVP screen model

The MVP dashboard has three main presentation areas:

1. **Header**
2. **Treemap**
3. **Detail / agenda surface**

Optional arrangements may differ by viewport, but the information contract remains the same.

---

## 3. Header

Header includes:

- product identity
- competition label
- date / logical snapshot context
- mode toggle (`form`, `agenda`)
- theme toggle
- stale/partial-data warning indicators when present

Header must be driven by snapshot/header metadata and current UI route state.

---

## 4. Treemap

### 4.1 Input contract

Treemap uses `teams[]` from `DashboardSnapshotDTO`.

For each tile, the UI reads:

- `teamId`
- `teamName`
- `displayScore`
- `layoutWeight`
- `nextMatch`
- optional `topContributions`
- optional `signals[]`

### 4.2 Size rule

Tile area is driven by **`layoutWeight`**.

No other client-side formula is allowed.

Forbidden examples:

- `sizeScore = formPoints5 + proximityBonus`
- `sizeWeight = hoursBasedBonus + formMetric`
- reweighting for visual preference in UI code

### 4.3 Ordering rule

The treemap must preserve snapshot ordering unless the treemap layout contract explicitly says otherwise.

Stable expected order for MVP input:
- `layoutWeight desc`
- `teamId asc` as tie-breaker

### 4.4 Color rule

Color styling may depend on:

- theme
- deterministic color mapping strategy
- score bands derived from **returned** `displayScore`
- status badges

Color must not imply a score model different from the policy.

### 4.5 Tile contents

Recommended tile content:

- team name
- optional short next-match label
- optional badge
- optional small explanation hint on hover/focus

Tile content must degrade gracefully for very small tiles.

---

## 5. Badges

Badge rendering is UI presentation, but badge inputs must come from snapshot data.

Allowed badge semantics in MVP:

- next match soon
- postponed event
- recently finished event
- none

If badge logic requires thresholds, those thresholds must be documented in a dedicated badge rule or returned explicitly by backend metadata. UI must not silently invent score-affecting meaning.

Badges are informational, not score inputs.

---

## 6. Hover and focus behavior

### 6.1 Hover

On hover:

- apply subtle scale or elevation
- show tooltip if allowed by viewport
- keep interaction deterministic and lightweight

Hover must not change tile ranking or recompute layout.

### 6.2 Focus / selection

On click or keyboard selection:

- set focused team
- open or update detail panel
- optionally highlight related agenda item

Focused state must be reflected in URL/shareable state where applicable.

---

## 7. Detail panel

The detail panel presents data for the selected team.

Recommended contents:

- team header
- recent form summary
- next match preview
- explanation section using `topContributions`
- optional signal-level details when available

Explainability must rely on returned backend data.

The panel must not compute new metrics or infer alternative score formulas.

---

## 8. Agenda view

Agenda mode may list upcoming matches and connect them to treemap tiles.

Agenda click behavior:

- highlight teams involved
- focus selected team or related detail surface

Agenda highlighting must not mutate scores or tile weights in the client.

---

## 9. Animation rules

Allowed animations:

- tile hover scale
- treemap transition between snapshots
- detail panel slide
- focus highlight emphasis

Animation may interpolate:
- x
- y
- width
- height
- opacity
- transform

Animation must not create false semantic meaning about score changes.

---

## 10. Empty, stale, and partial states

### 10.1 Empty state

If there are no teams/events for the requested snapshot, render an explicit empty state.

### 10.2 Stale state

If `header` / warnings indicate stale data, display a visible but non-blocking warning.

### 10.3 Partial data state

If some signals or data are missing, UI should continue rendering available information without synthesizing replacements.

---

## 11. Accessibility and interaction quality

Minimum requirements:

- keyboard-accessible tiles
- visible focus state
- meaningful aria labels for tiles and detail actions
- non-color-only differentiation where practical
- readable text contrast in both themes

Small tiles must remain navigable even if labels are truncated.

---

## 12. Responsive behavior

### 12.1 Desktop

Preferred layout:
- treemap primary
- detail panel secondary
- agenda rail visible when appropriate

### 12.2 Mobile

Preferred layout:
- treemap primary
- detail/agenda in sheet or panel form
- URL state still restores focused entity and mode

Responsive changes must not alter scoring semantics.

---

## 13. UI acceptance criteria

The UI is acceptable when:

- tile area is driven only by `layoutWeight`
- treemap renders deterministically from snapshot inputs
- detail panel uses returned explainability data
- stale/partial states are visible and non-breaking
- mode and focus can be restored from URL state
- no frontend code computes `sizeScore`, `proximityBonus`, or alternative weighting formulas

---

## 14. Explicit removals from legacy UI spec

The following legacy rules are invalid and removed:

- `size_score = form_points_5 + proximity_bonus`
- `+5 if next match < 48h`
- `+2 if next match < 96h`
- `TreemapTileDTO` fields based on `formPoints5`, `proximityBonus`, `sizeScore`

These are superseded by:

- backend-generated `displayScore`
- backend-generated `layoutWeight`
- optional explainability helpers such as `NEXT_MATCH_HOURS` or `PROXIMITY_BUCKET`, when provided
