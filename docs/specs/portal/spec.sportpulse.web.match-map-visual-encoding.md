---
artifact_id: SPEC-SPORTPULSE-WEB-MATCH-MAP-VISUAL-ENCODING
title: "Match Map Visual Encoding Specification"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: web
slug: match-map-visual-encoding
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/specs/portal/spec.sportpulse.web.match-map-visual-encoding.md
---
# SportPulse — Match Map Visual Encoding & Interactions

Version: 1.0  
Status: Draft (implementation-ready)  
Scope: Visual encoding (size/color/border) + “WOW” interactions for the **Match Map** screen (one tile per match)  
Audience: Frontend, Backend (hints), QA, Design

---

## 1) Purpose

Define a **non-standard** “Match Map” screen that communicates **importance + urgency + form** at a glance, while delivering a **WOW** interaction on hover/selection.

Key principles:

- **1 match = 1 tile** (dedupe by `matchId`)
- **Backend supplies tileHints** (deterministic); frontend renders & animates
- Visual encoding must remain understandable “for dummies”
- Animations must be smooth, performant, and respectful of `prefers-reduced-motion`

---

## 2) Dimensions and what they mean

### Size = Importance (within this matchday)
- Communicates “how important is this match to look at today”.

### Background color = Time urgency
- Communicates “how soon is it”.

### Border/halo = “Picante” (form narrative)
- Communicates “is there heat/story in the teams’ form”.

These must not conflict:
- **Color never means form**
- **Border never means time**
- **Size never means time**

---

## 3) Backend tile hints (contract)

Each `MatchCardDTO` must include:

```ts
type MatchTileHintsDTO = {
  sizeBucket: "S" | "M" | "L" | "XL";
  urgencyColorKey: "LIVE" | "TODAY" | "TOMORROW" | "D2_3" | "D4_7" | "LATER" | "UNKNOWN";
  heatBorderKey: "NONE" | "ONE_HOT" | "BOTH_HOT" | "DATA_MISSING";
  featuredRank: "NONE" | "FEATURED"; // derived rule below
};
```

And:

```ts
type MatchCardDTO = {
  matchId: string;
  kickoffUtc?: string;
  status?: "SCHEDULED" | "LIVE" | "FINISHED" | "UNKNOWN";
  timeChip: DisplayChipDTO;
  home: { teamId: string; name: string; crestUrl?: string; formChip?: DisplayChipDTO; };
  away: { teamId: string; name: string; crestUrl?: string; formChip?: DisplayChipDTO; };
  rankScore?: number;           // optional for debugging (DO NOT show in UI)
  tileHints: MatchTileHintsDTO; // REQUIRED
};
```

Frontend rule: **never recompute** buckets if `tileHints` are present.

---

## 4) Deterministic ranking → size buckets

### 4.1 Match rank score (ordering only)
Backend computes:

`matchRankScore = 1 - (1-home.displayScore)*(1-away.displayScore)`  
Fallbacks:
- if one missing → use available displayScore
- both missing → 0

### 4.2 Bucket assignment (per matchday)
Sort matches by `(matchRankScore desc, matchId asc)`.

Let `n = matchCount` and `i = 0..n-1` index in sorted list.

Assign:

- `XL`: `i < ceil(0.10 * n)` (top 10%)
- `L`:  `ceil(0.10*n) <= i < ceil(0.30*n)` (next 20%)
- `M`:  `ceil(0.30*n) <= i < ceil(0.70*n)` (next 40%)
- `S`:  remainder

> Rationale: adapts to each day’s distribution and always yields a visible “top”.

---

## 5) Urgency color keys (time semantics)

Based on `hoursUntilKickoff` (or status LIVE):

- `LIVE`      → playing now
- `TODAY`     → 0 < hours < 24
- `TOMORROW`  → 24 <= hours < 48
- `D2_3`      → 48 <= hours < 96
- `D4_7`      → 96 <= hours <= 168
- `LATER`     → hours > 168
- `UNKNOWN`   → missing kickoff

Frontend maps these keys to a **sports palette** tokens, e.g.:

- LIVE: red
- TODAY: red-orange
- TOMORROW: orange
- D2_3: amber/yellow
- D4_7: green
- LATER: blue/steel
- UNKNOWN: gray

> Do not encode form with background hue.

---

## 6) Heat border keys (form narrative)

Derive from team form chips:

- `BOTH_HOT`: home formChip = `🔥 Picante` AND away formChip = `🔥 Picante`
- `ONE_HOT`: exactly one side is `🔥 Picante`
- `DATA_MISSING`: either side is missing form (`⚠️ Sin datos`)
- `NONE`: otherwise

Frontend mapping:
- BOTH_HOT: thicker border + outer glow
- ONE_HOT: medium border + subtle glow
- DATA_MISSING: dashed border (subtle) or muted warning ring
- NONE: normal border

---

## 7) Featured matches (WOW baseline)

### 7.1 Featured rule (deterministic)
A match is `FEATURED` if ANY is true:

- `sizeBucket == XL`  
OR
- `heatBorderKey == BOTH_HOT` AND `urgencyColorKey in {LIVE, TODAY, TOMORROW}`

> This creates “hero matches” even on quiet days.

### 7.2 Featured visuals (idle)
Featured tiles have an **ambient effect** even before hover:

- very subtle animated gradient border (slow)
- gentle breathing glow (low amplitude)
- small “🔥” badge if BOTH_HOT

Constraints:
- must not be noisy
- must not distract from reading the grid

---

## 8) Hover / focus / tap interactions (WOW but controlled)

### 8.1 Universal interaction goals
On hover/focus/press the tile should feel:
- “lifted”
- “alive”
- “clickable”
- but never jittery

Use only GPU-friendly properties:
- `transform`
- `opacity`
- `filter` (careful)
- `box-shadow`
Avoid layout-affecting changes (no width/height changes on hover).

### 8.2 Hover effect (desktop pointer)
When hovering a tile:

1) **Lift + scale**  
- `translateY(-6px)` and `scale(1.02)`  
- `transition: 140–180ms ease-out`

2) **Shadow intensification**  
- increase shadow softness and depth

3) **Color “sheen” overlay**  
- add a diagonal soft highlight overlay (opacity ~ 6–10%)
- moves slightly with cursor (optional micro-parallax)

4) **Border/halo intensifies**  
- BOTH_HOT gets the strongest ring
- ONE_HOT moderate ring
- NONE minimal ring

5) **Bring forward**  
- `z-index` above neighbors so it doesn’t look clipped

### 8.3 Featured hover “wow” (only for FEATURED tiles)
On hover for FEATURED tiles add:

- short “pulse” of the border (single pulse, not looping)
- subtle animated spark line around the border (1 cycle)
- micro “pop” of the 🔥 badge (scale + fade-in)

This is the WOW moment. Keep it short (<= 600ms total).

### 8.4 Keyboard focus
When focused (tab navigation):

- show a clear focus ring distinct from heat border (e.g., white/primary)
- apply the same lift as hover but without parallax

### 8.5 Mobile tap
On tap:

- tile briefly compresses (`scale(0.98)`) then returns
- opens detail panel/modal
- selected tile stays “active” with a stable ring until dismissed

---

## 9) Selected state (sticky highlight)

When a match is selected:

- apply a persistent ring (slightly stronger than hover)
- dim non-selected tiles slightly (optional: opacity 0.92) to guide attention
- keep selected tile at higher z-index
- ensure the detail panel uses the same chips and time label (no recompute)

---

## 10) Information density inside the tile

Must remain readable on small tiles:

### Always show
- Home crest + short name
- Away crest + short name
- Time chip (compact)
- Form chips under each crest (compact)

### Optional (only on L/XL)
- one-line explainLine

Rule:
- never cram explainLine into S tiles; it becomes clutter.

---

## 11) Accessibility and motion safety

### 11.1 Reduced motion
Respect `prefers-reduced-motion`:

- disable parallax
- disable breathing glow
- keep only instant highlight + focus ring

### 11.2 Contrast
Ensure text remains readable on colored backgrounds:
- use a translucent overlay or gradient mask behind text
- or use darkened background variants for bright colors

### 11.3 Color not the only signal
Always keep:
- time icon (`⏳/📅/🗓️/🔴`)
- border for heat
So meaning survives color blindness.

---

## 12) QA acceptance checklist

- [ ] Exactly 1 tile per `matchId` (no duplicates)
- [ ] SizeBucket distribution matches percentile rule for the day
- [ ] UrgencyColorKey matches time rule (LIVE/TODAY/…)
- [ ] HeatBorderKey matches form chips (ONE_HOT/BOTH_HOT/…)
- [ ] Featured rule triggers correctly
- [ ] Hover uses transform/opacity/shadow only (no layout shifts)
- [ ] Selected state stable and dismissible
- [ ] Reduced motion disables looping effects
- [ ] S tiles remain readable (no overflow)

---

## 13) Example JSON (single match card)

```json
{
  "matchId": "match:123",
  "status": "SCHEDULED",
  "timeChip": { "icon": "⏳", "label": "Mañana · en 30 h", "level": "OK", "kind": "TIME_TOMORROW_HOURS" },
  "home": { "teamId": "team:a", "name": "Athletic", "formChip": { "icon": "🔥", "label": "Picante", "level": "HOT", "kind": "FORM_HOT" } },
  "away": { "teamId": "team:b", "name": "Betis",    "formChip": { "icon": "✅", "label": "Viene bien", "level": "OK", "kind": "FORM_GOOD" } },
  "tileHints": {
    "sizeBucket": "XL",
    "urgencyColorKey": "TOMORROW",
    "heatBorderKey": "ONE_HOT",
    "featuredRank": "FEATURED"
  }
}
```

---

## 14) Summary

The Match Map screen is a **priority surface**, not a chronological list.  
Use deterministic visual encoding: **size = importance**, **color = urgency**, **border = heat**, plus a controlled WOW hover for featured matches. All mapping is backend-owned via `tileHints`, ensuring reproducibility and preventing UI drift.
