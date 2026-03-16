# Radar SportPulse — AI-Assisted Development Implementation Guide

Version: 1.0  
Status: Consolidated  
Scope: MVP  
Audience: AI coding agents, Backend, Frontend, QA

---

## 1. Objective

This guide exists to constrain AI-assisted implementation so the feature does not drift away from the product and editorial decisions already made.

The AI agent must implement Radar as a **league-filtered, matchday-scoped, snapshot-driven editorial module**.

It must not reinterpret unspecified areas creatively.

---

## 2. Non-negotiable rules

The AI implementation must not:

- introduce a database for Radar MVP
- recalculate editorial logic in the frontend
- silently rebuild historical Radar output and present it as original
- replace the existing match list or match detail flow
- introduce new mandatory data providers
- use free-form LLM prose generation for pre-match text, reasons, or verdicts
- use betting language anywhere in the UI

---

## 3. Mandatory architecture split

### Live layer
The existing provider integration remains responsible for:

- match state
- score
- kickoff
- standings
- current match detail data

### Radar editorial layer
The new Radar module is responsible for:

- candidate selection
- signal scoring
- label assignment
- subtype assignment
- template-based pre-match text
- template-based reasons
- post-match verdict generation
- JSON snapshot persistence

---

## 4. Required implementation artifacts

The implementation should create or adapt these logical pieces:

### Backend / domain
- canonical Radar builder
- matchday-scoped candidate evaluator
- label assignment engine
- template renderer
- reason selector
- snapshot writer
- snapshot resolver

### Frontend
- Radar section component
- Radar card component
- empty/unavailable states
- snapshot read integration
- merge layer between editorial snapshot and live match data

### QA
- unit tests for label assignment and verdict logic
- snapshot contract validation tests
- UI rendering tests per editorial state

---

## 5. Suggested implementation flow

### Step 1 — read scope from current route/filter context
The feature must read:

- selected competition / league
- selected season
- selected matchday

### Step 2 — resolve Radar snapshot scope
Canonical key:

`competitionKey + seasonKey + matchday`

### Step 3 — build candidate pool
Load all matches belonging to that scope.

### Step 4 — compute signal families
Calculate the six signal families:

- attention
- hidden value
- favorite vulnerability
- surface contradiction
- open game
- tight game

### Step 5 — assign dominant signal and label
Apply thresholds and label precedence.

### Step 6 — generate editorial payload
For each selected card:

- resolve subtype
- render `preMatchText`
- generate reasons
- persist match snapshot

### Step 7 — persist section snapshot
Write `radar-index.json` last.

### Step 8 — render in UI
Read snapshot and merge with live score/state from existing provider-based state.

### Step 9 — resolve post-match verdicts
When final score becomes available, update only the post-match fields.

---

## 6. Required file naming

All generated documentation and implementation artifacts created for this feature should include the word `radar` in their names to avoid confusion with other project files.

Examples:

- `radar-index.json`
- `radar-match-<id>.json`
- `radar-section.tsx`
- `radar-card.tsx`
- `radar-builder.ts`
- `radar-verdict.ts`
- `radar-policy.ts`

---

## 7. Backend design recommendations

### Strong recommendation
Keep Radar logic modular.

Suggested separation:

- `radar-candidate-builder`
- `radar-signal-evaluator`
- `radar-label-resolver`
- `radar-text-renderer`
- `radar-reason-selector`
- `radar-snapshot-service`
- `radar-verdict-resolver`

Do not bury all logic inside one large service or controller.

---

## 8. Frontend design recommendations

### Strong recommendation
The frontend should treat Radar as a dedicated section, not as a mutated form of the standard fixture list.

Recommended components:

- `radar-section`
- `radar-card`
- `radar-empty-state`
- `radar-unavailable-state`
- optional `radar-outcome-block`

### Frontend rules

- never derive label in UI
- never derive reasons in UI
- never derive verdict in UI
- keep pre-match reading visible after resolution

---

## 9. Snapshot write rules for implementation

### Build phase
1. compute all card detail payloads
2. write each `radar-match-*.json`
3. write `radar-index.json`

### Resolve phase
1. update individual match snapshot
2. update `radar-index.json`

### Technical safety
- atomic temp-file write + rename
- one writer per scope
- validated JSON before rename

---

## 10. Season-start logic

The implementation must not block Radar until matchday 4.

Instead, it must implement the evidence-tier policy:

- `BOOTSTRAP` for matchdays 1–3
- `EARLY` for matchdays 4–6
- `STABLE` for matchday 7+

### Important
A small current-season sample is not a reason to disable the product.

It is a reason to:

- lower reliance on current-season-only evidence
- use comparable prior-season evidence when allowed
- restrict strong analytical labels when evidence is weak

---

## 11. Historical behavior rules for implementation

When the UI requests a past matchday:

- read the stored Radar snapshot for that scope
- do not run a fresh editorial classification by default
- if a rebuild mechanism exists, it must be explicit and marked as rebuild

This is a trust requirement, not just a technical preference.

---

## 12. Verdict implementation rules

The verdict resolver must use only:

- final score
- final live status
- pre-match frozen label
- pre-match frozen favorite side when relevant

Do not depend on advanced post-match stats for MVP.

The verdict resolver is not allowed to rewrite:

- label
- pre-match text
- reasons

It may only append resolution fields.

---

## 13. Minimum testing obligations

### Unit tests
- label assignment precedence
- subtype resolution
- pre-match template sanitization
- reason count by evidence tier
- verdict resolution per analytical label

### Contract tests
- `radar-index.json` schema validation
- `radar-match-*.json` schema validation

### UI tests
- pre-match rendering
- in-play rendering
- post-match rendering
- empty state
- unavailable state
- historical rendering

---

## 14. Logging and observability

At minimum, implementation should expose logs or events for:

- Radar build success/failure
- Radar resolve success/failure
- snapshot corruption
- missing snapshot for historical matchday
- mismatch between editorial snapshot and live provider status

If this is not observable, debugging the feature later will become needlessly expensive.

---

## 15. Delivery definition

An AI-assisted implementation of Radar is only acceptable if it delivers all of the following:

- section appears only within selected league + selected matchday
- historical behavior is honest
- snapshot contracts are respected
- pre-match narrative is frozen before kickoff
- post-match resolution appends rather than rewrites
- UI remains additive and does not damage current flows
- early season works from matchday 1 under evidence-tier rules

---

## 16. Final instruction to the AI coding agent

Implement Radar as a **controlled editorial system**, not as an experimental content generator.

If the specification is silent on a behavior, prefer:

- determinism
- reversibility
- low complexity
- safe degradation
- consistency with the current SportPulse architecture

Do not invent product behavior to fill gaps.

