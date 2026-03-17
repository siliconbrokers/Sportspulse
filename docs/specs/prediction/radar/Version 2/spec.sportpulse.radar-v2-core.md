---
artifact_id: SPEC-SPORTPULSE-RADAR-V2-CORE
title: "Radar SportPulse — Core Specification v2"
artifact_class: spec
status: draft
version: 2.0.0
project: sportpulse
domain: radar
slug: radar-v2-core
owner: team
created_at: 2026-03-16
updated_at: 2026-03-16
canonical_path: docs/specs/prediction/radar/Version 2/spec.sportpulse.radar-v2-core.md
---

# Radar SportPulse — Core Specification v2

## 1. Purpose

Radar v2 defines the standalone logical core of the Radar module.

Radar v2 is a frozen, matchday-scoped, editorially controlled system that selects and
describes up to 3 noteworthy matches inside the currently selected competition and matchday.

Radar v2 is not a prediction engine.
Radar v2 is not a betting product.
Radar v2 is not a match list replacement.

Radar v2 is a classification and editorialization layer.

## 2. Goals

Radar v2 must:

- preserve v1 operational strengths
- correct v1 semantic weaknesses
- remain deployable without predictor integration
- expose a future-compatible structure without depending on future systems

## 3. Non-Goals

Radar v2 must not:

- expose probabilities
- consume prediction contracts
- reference betting odds
- imply guaranteed outcomes
- recompute itself in frontend
- rewrite historical pre-match text
- exceed 3 cards per scope
- create filler cards to reach 3

## 4. Canonical Scope

The canonical Radar scope remains:

- `competitionKey`
- `seasonKey`
- `matchday`

Radar is always closed to the user-selected scope.
It may not mix competitions, seasons, or matchdays.

## 5. Core Principles

### 5.1 Additive Module

Radar is additive.
Failure, absence, or degradation of Radar must never block the rest of the page.

### 5.2 Snapshot Truth

Radar frontend renders the persisted snapshot.
Frontend does not recompute editorial logic.

### 5.3 Frozen Pre-Match Reading

The original pre-match reading is frozen once published.
Post-match logic may append contrast, but may not rewrite the original interpretation.

### 5.4 Internal Richness, External Simplicity

Radar may internally activate multiple candidate readings.
UI may still expose exactly one primary visible label per card.

### 5.5 Honest Editorial Framing

Radar speaks in editorial football language.
Radar does not speak like a bookmaker, trader, or certainty machine.

## 6. Ontology

Radar v2 divides readings into 3 semantic families.

### 6.1 CONTEXT

Purpose: explain why the match deserves attention inside the matchday.

Allowed labels:

- `EN_LA_MIRA`
- `BAJO_EL_RADAR`

### 6.2 DYNAMICS

Purpose: describe the expected shape of the match.

Allowed labels:

- `PARTIDO_ABIERTO`
- `DUELO_CERRADO`

### 6.3 MISALIGNMENT

Purpose: describe contradiction, fragility, or deceptive surface reading.

Allowed labels:

- `SENAL_DE_ALERTA`
- `PARTIDO_ENGANOSO`

## 7. Critical Semantic Rule

The 6 labels are not peers in a flat semantic plane.

The old v1 idea of letting all 6 compete under one blind linear precedence is deprecated.

Radar v2 must evaluate candidate readings by family first, then resolve dominant reading.

## 8. Internal Model

Each Radar candidate match must support an internal structure that distinguishes:

- family scores
- label scores
- active families
- active labels
- dominant family
- primary label
- secondary badges
- evidence tier
- confidence band
- reasons

## 9. External Visual Model

Each visible card exposes:

- exactly 1 primary label
- 0 to 2 secondary badges
- 1 pre-match text
- optional verdict block after match conclusion

The rule "one visible primary label" is a UI constraint, not an internal truth constraint.

## 10. Evidence Tiers

Radar v2 preserves 3 evidence tiers:

- `BOOTSTRAP`
- `EARLY`
- `STABLE`

### 10.1 BOOTSTRAP

Used when current-season evidence is too thin and Radar must operate conservatively.

### 10.2 EARLY

Used when there is enough season data to start forming non-trivial readings, but not enough for full confidence.

### 10.3 STABLE

Used when current-season evidence is sufficiently mature for normal Radar operation.

## 11. Family-Level Intent

### 11.1 EN_LA_MIRA

Use when the match carries obvious matchday significance, narrative gravity, competitive relevance, or broad user attention.

It does not mean "most likely to be won by someone".
It means "hard to ignore inside this matchday".

### 11.2 BAJO_EL_RADAR

Use when the match has lower surface visibility but meaningful reasons to deserve attention.

It does not mean irrelevant.
It means underexposed but interesting.

### 11.3 PARTIDO_ABIERTO

Use when the expected match shape suggests openness, exchanges, or higher scoring rhythm.

Without predictor integration, this remains a Radar reading, not a probability product.

### 11.4 DUELO_CERRADO

Use when the expected match shape suggests tension, containment, caution, low fluidity, or limited scoring rhythm.

### 11.5 SENAL_DE_ALERTA

Use when a superficially stronger side, cleaner narrative, or comfortable expectation appears more fragile than it looks.

### 11.6 PARTIDO_ENGANOSO

Use when the surface story of the match is misleading and the deeper Radar reading points elsewhere.

This is the most demanding label.
It must be used sparingly.

## 12. Resolution Logic

Radar v2 resolves cards in 4 steps.

### Step 1 — Candidate Evaluation

Evaluate all eligible matches inside scope.

### Step 2 — Family Activation

Determine which families are active for each match.

### Step 3 — Dominant Reading Resolution

Resolve a primary reading using:

1. score strength
2. reading coherence
3. editorial usefulness inside the current matchday
4. evidence tier discipline

### Step 4 — UI Projection

Project one primary label and up to two secondary badges.

## 13. Deprecated v1 Laws

The following v1 ideas are deprecated as core laws:

- fixed blind precedence between all 6 labels
- single internal label as total truth
- treating all labels as semantically equivalent
- using UI simplification as model simplification

## 14. Card Count Rules

Per scope, Radar may output:

- 0 cards
- 1 card
- 2 cards
- 3 cards

Radar may never output more than 3 cards.

Radar may never manufacture filler to force 3 cards.

## 15. Standalone Operation Rule

Radar v2 must be fully operable without predictor integration.

All contracts, evaluation rules, lifecycle behavior, and rendering laws in this package must remain valid even if no predictor exists.

## 16. Success Condition

Radar v2 core is successful when:

- the module remains semantically coherent
- the UI stays simple
- the backend preserves richer internal truth
- the system remains honest, frozen, deterministic, and standalone
