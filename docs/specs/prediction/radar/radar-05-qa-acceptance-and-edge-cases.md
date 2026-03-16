# Radar SportPulse — QA, Acceptance Criteria, and Edge Cases

Version: 1.0  
Status: Consolidated  
Scope: MVP  
Audience: QA, Product, Backend, Frontend

---

## 1. Acceptance objective

QA for Radar must verify three things:

1. Radar respects scope and does not leak outside the selected league+matchday
2. Radar remains editorially consistent from pre-match through post-match
3. Radar fails safely without damaging the rest of the portal

---

## 2. Functional acceptance criteria

### 2.1 Scope
- Radar only uses the selected league
- Radar only uses the selected matchday
- Radar never mixes leagues
- Radar never mixes matchdays

### 2.2 Selection
- Radar shows at most 3 cards
- Radar may show 0, 1, 2, or 3 cards
- Radar never fills cards artificially just to avoid emptiness
- eligible cards respect thresholds and label precedence

### 2.3 Historical behavior
- past matchdays use persisted snapshots
- past matchdays do not silently rebuild from current context and present that as original history
- if no historical snapshot exists, UI falls back safely

### 2.4 Pre-match text
- exactly one sentence
- no team names
- no forbidden betting/prediction language
- no contradiction with the assigned label
- length stays within limits

### 2.5 Reasons
- count matches the evidence tier rules
- reasons are not semantically duplicated
- reasons are compatible with the label
- reasons do not contradict the pre-match text

### 2.6 Verdicts
- verdict exists only for analytical labels
- `En la mira` and `Bajo el radar` do not show analytical verdicts
- verdict is calculated only after final state
- verdict does not modify original pre-match reading

### 2.7 UI
- Radar section renders without breaking the rest of the page
- CTA navigates to the existing match detail
- live status/score comes from the live layer
- editorial content comes from the snapshot layer

---

## 3. Required test cases

### 3.1 Current matchday with 3 valid cards
Expected:
- 3 cards render
- cards ordered by editorial rank / radar score logic
- no obvious duplication in label pattern unless justified

### 3.2 Matchday with only 1 valid card
Expected:
- 1 card renders
- no fake filler cards

### 3.3 Matchday with no valid cards
Expected:
- `EMPTY` state renders cleanly
- no low-quality fallback cards appear

### 3.4 Historical matchday with valid snapshot
Expected:
- snapshot renders as historical editorial truth
- preserved label, text, reasons, and post-match outcome if already resolved

### 3.5 Historical matchday with missing snapshot
Expected:
- controlled fallback
- no silent recreation presented as original history

### 3.6 Pre-match card
Expected:
- no verdict shown
- `preMatchText` shown
- reasons shown
- scheduled time shown

### 3.7 In-play card
Expected:
- original pre-match reading preserved
- live score/state shown
- no verdict yet
- optional `Lectura previa` marker present if implemented

### 3.8 Post-match analytical card
Expected:
- original pre-match reading preserved
- final score shown
- `Desenlace` block shown
- `verdictTitle` and `verdictText` shown

### 3.9 Post-match editorial-only card
Expected:
- no analytical verdict shown
- neutral post-match note or equivalent behavior only

### 3.10 Live API failure while snapshot exists
Expected:
- Radar editorial layer may still render from snapshot
- live score/state degrades gracefully if needed
- the rest of the page still works

### 3.11 Snapshot corruption
Expected:
- Radar fails safely
- rest of the portal remains functional
- no partially broken editorial section is shown

---

## 4. Season-phase test coverage

### 4.1 Bootstrap phase (matchdays 1–3)
Expected:
- Radar still works from matchday 1
- cards may have 2 or 3 reasons
- strong analytical labels only appear when bootstrap evidence is defensible
- promoted teams without comparable evidence are not forced into misleading analytical labels

### 4.2 Early phase (matchdays 4–6)
Expected:
- current season becomes the dominant source
- previous season may still appear as support
- reasons count may still be 2 in justified cases

### 4.3 Stable phase (matchday 7+)
Expected:
- current season dominates
- 3 reasons are required
- label assignment behaves normally with no early-season accommodations

---

## 5. Edge cases

### 5.1 Promoted team without comparable same-competition history
Expected:
- no forced strong analytical label based on non-comparable history
- editorial-only label or exclusion is acceptable

### 5.2 Match postponed after snapshot generation
Expected:
- snapshot persists
- resolution remains non-final
- no verdict generated

### 5.3 Match cancelled
Expected:
- snapshot remains historical record
- `resolutionState = CANCELLED`
- no verdict

### 5.4 Result corrected after publication by provider
Expected:
- final score updates
- verdict recalculates if needed
- original `generatedAt` remains unchanged

### 5.5 Duplicate match across providers
Expected:
- Radar uses canonical deduped match identity
- no duplicate card appears

### 5.6 Provider disagreement on live status
Expected:
- Radar follows the portal’s canonical live-state resolution logic
- Radar does not invent its own parallel truth

### 5.7 Missing detail file while index exists
Expected:
- minimal card can still render from `index.json` if safe
- no detail-specific invented content appears

### 5.8 Snapshot exists but live match no longer found
Expected:
- Radar historical editorial layer remains valid
- live rendering degrades safely

---

## 6. Integrity validations

### 6.1 `radar-index.json`
- `cardsCount` matches actual number of cards
- no duplicate `matchId` entries
- every `detailFile` exists or is explicitly degraded
- `moduleState` is a valid enum
- `policyVersion` exists

### 6.2 `radar-match-<id>.json`
- `labelKey` compatible with `signalKey`
- `signalSubtype` allowed for that label
- reasons compatible with label
- `verdict` null when label is editorial-only
- `editorialState` consistent with verdict and resolution state

### 6.3 UI-layer integrity
- no verdict shown before final match state
- original pre-match text still visible after final match state
- only one primary label visible
- CTA remains valid

---

## 7. Verdict-specific validation

### Señal de alerta
Validate:
- confirmed when favorite fails to win or wins narrowly while conceding
- partial in intermediate cases
- rejected when favorite wins cleanly and comfortably

### Partido engañoso
Validate:
- confirmed when the match proves less simple than the surface suggested
- rejected when the surface reading ends up clearly correct

### Partido abierto
Validate:
- confirmed with exchange or clear total-goal openness
- rejected when the game stays contained

### Duelo cerrado
Validate:
- confirmed when low-margin / low-amplitude reading holds
- rejected when the match opens too much

---

## 8. UI acceptance checks

### Placement
- Radar appears where specified
- map visibility follows feature flags

### Density
- card height remains reasonable
- reasons do not overflow badly
- no hidden carousel on mobile

### Readability
- label remains visible
- pre-match text remains readable
- verdict block remains visually separate from original reading

### Navigation
- card click and CTA click open the existing match detail view

---

## 9. Failure safety criteria

Radar must never:

- crash the full page if it fails
- block standings or match list rendering
- expose raw broken JSON to the user
- display editorial output that contradicts its own snapshot rules

---

## 10. Observability minimum

Track at least:

- `radar_module_impression`
- `radar_card_click`
- `radar_cta_click`
- `radar_render_empty`
- `radar_render_unavailable`

Internal system logs should capture:

- snapshot build success/failure
- snapshot resolve success/failure
- snapshot corruption detection
- snapshot/live mismatch events

---

## 11. Acceptance summary

Radar MVP is acceptable only if:

- scope is correct
- historical behavior is honest
- editorial persistence works
- pre-match and post-match continuity is preserved
- degraded states fail safely
- early-season behavior works from matchday 1 without fake certainty

