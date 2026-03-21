---
artifact_id: SPEC-SPORTPULSE-AUDIT-FRONTEND-PRODUCT-SURFACE-GAP-ANALYSIS
title: "Frontend Product Surface Gap Analysis"
artifact_class: spec
status: proposed
version: 0.1.0
project: sportpulse
domain: audit
slug: frontend-product-surface-gap-analysis
owner: team
created_at: 2026-03-20
updated_at: 2026-03-20
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-CORE-CONSTITUTION
  - SPEC-SPORTPULSE-CORE-MVP-EXECUTION-SCOPE
  - SPEC-SPORTPULSE-CORE-IMPLEMENTATION-BACKLOG
  - SPEC-SPORTPULSE-QA-ACCEPTANCE-TEST-MATRIX
  - SPEC-SPORTPULSE-CORE-REPO-STRUCTURE-AND-MODULE-BOUNDARIES
canonical_path: docs/audits/spec.sportpulse.audit.frontend-product-surface-gap-analysis.md
---

# SportPulse — Frontend Product Surface Gap Analysis

Version: 0.1
Status: Proposed
Scope: Auditoría estructural del frontend actual como superficie de producto completa — no solo UI visual
Audience: Product, Frontend, Backend, Design, QA, AI-assisted development workflows

---

## 1. Purpose

This audit exists to determine, with evidence, whether the current SportPulse frontend accurately and scalably represents the product that the active corpus already requires.

It does **not** define the final redesign.

It answers, first:

- what product surfaces exist today in reality
- what product surfaces are missing
- what surfaces are partially implemented, coupled, duplicated, or fragile
- what breaks in mobile / narrow layout
- what prevents the frontend from supporting freemium conversion, auth/session, Pro gating, and future competition growth
- what must be corrected before a frontend modernization effort can be considered valid

This audit is diagnostic, not aspirational.

---

## 2. Authority

This document is subordinate to:

1. Constitution
2. MVP Execution Scope
3. Repo Structure and Module Boundaries
4. Non-Functional Requirements
5. Acceptance Test Matrix
6. Active implementation backlog

This document is authoritative only for:
- auditing the current frontend/product surface state
- identifying structural gaps
- defining required audit outputs
- establishing go/no-go criteria for frontend modernization

It is **not** authoritative for changing product semantics or expanding MVP scope.

---

## 3. Why this audit is necessary

The current frontend was initially shaped for a smaller competition/menu footprint and for desktop-biased usage.

The product has since evolved into a broader surface that now includes, or must include:

- dashboard
- team detail / explainability
- prediction surface
- public track record
- Pro depth gating
- subscription flow
- auth/session state
- registration deferral
- responsive usability
- future scalability to more competitions and tournament structures

A visual refresh without first auditing the actual product surface would risk:
- beautifying structural incoherence
- hiding missing product states
- introducing front-end-owned semantics
- creating a responsive skin over a broken navigation and monetization model
- increasing implementation cost by redesigning before boundaries are clarified

---

## 4. Non-negotiable constraints

The audit must preserve the active constitutional and MVP boundaries.

### 4.1 Frontend-honest rule

The frontend may own:
- rendering
- interaction
- animation
- presentation
- navigation state
- theming

The frontend must not own:
- score computation
- treemap solving
- semantic ordering truth
- provider-specific logic
- hidden urgency formulas
- paywall semantics that contradict backend truth

### 4.2 Snapshot-first rule

The product must still be understood as a snapshot-first system.

The audit must not recommend:
- front-end direct provider reads
- ad hoc semantic recomputation in detail pages
- UI-local truth that contradicts snapshot/API contracts

### 4.3 MVP discipline

This audit may identify gaps and structural blockers, but it must not smuggle in speculative product scope that is outside MVP unless explicitly labeled as future-facing and non-binding.

---

## 5. Audit questions

The audit must answer, explicitly and with evidence, the following questions.

### 5.1 Product surface reality

What user-facing surfaces actually exist today?

At minimum, audit whether the current product contains:
- dashboard
- team detail / explainability
- prediction display
- track record display
- Pro-gated prediction depth
- paywall CTA
- pricing / upgrade entry point
- login
- registration
- session restoration
- post-checkout return state
- about / app information
- legal/privacy/basic informational pages if present
- ad placements if present or planned
- empty / error / degraded states

For each surface, classify:
- implemented and coherent
- implemented but partial
- implemented but structurally wrong
- missing
- intentionally deferred

### 5.2 Navigation architecture

Does the current navigation model scale to:
- 10+ competitions
- structured tournaments
- future competition growth
- prediction surfaces
- track record
- account/session surfaces
- pricing/paywall surfaces

The audit must identify:
- actual current navigation hierarchy
- route structure
- duplicated or conflicting navigation entry points
- whether overview/detail/account/commercial surfaces are mixed incoherently
- whether mobile navigation collapses under surface growth

### 5.3 Responsive behavior

Does the frontend remain understandable and operable on:
- desktop
- mobile / narrow layout

The audit must not stop at "it shrinks".

It must inspect:
- viewport hierarchy
- visual density
- CTA visibility
- readability of match/team cards
- behavior of long competition lists
- usability of filters/selectors in mobile
- detail presentation pattern
- scroll burden
- whether treemap remains understandable in mobile
- whether responsive behavior is compression-only instead of hierarchy-aware

### 5.4 User-state model

What user states exist in the frontend today, and how are they represented?

Minimum states to audit:
- anonymous
- registered but non-Pro
- Pro active
- session expired
- checkout in progress
- checkout success but stale frontend state
- registration deferred user
- free user hitting Pro-gated prediction depth

The audit must identify:
- state transitions
- missing transitions
- broken transitions
- hidden assumptions
- whether auth/session state silently mutates product truth

### 5.5 Freemium and monetization surfaces

The audit must inspect whether the frontend can support the active MVP commercial model.

At minimum:
- where 1X2 free visibility is shown
- where Pro depth is gated
- where the paywall CTA appears
- whether value is shown before conversion friction
- where registration is triggered
- where upgrade/subscription lives
- where Stripe return state is handled
- whether post-payment Pro state is reflected within the same session
- where ads could exist without destroying comprehension or conversion
- whether ad placement and paywall placement conflict

### 5.6 Surface coherence

The audit must determine whether the current frontend behaves like:
- a product with coherent user journeys
or
- a collection of individually functional widgets assembled incrementally

This judgment is mandatory.

---

## 6. Audit inputs

The audit must inspect all relevant current frontend code and configuration, including at minimum:

- `packages/web/src/app`
- `packages/web/src/components`
- `packages/web/src/state`
- `packages/web/src/theme`
- `packages/web/src/api-client`
- route definitions
- top-level layout/shell components
- auth/session wiring if any
- subscription/paywall entry points if any
- prediction-related UI surfaces
- track record UI surfaces
- reusable component primitives
- style system / theme tokens / CSS architecture
- mobile breakpoints / media-query logic
- any current design notes or screenshots available

It must also read the active governing docs before concluding.

---

## 7. Required audit outputs

The audit deliverable must include all sections below.

### 7.1 Current product surface inventory

A table covering:
- surface name
- route / entry point
- purpose
- supported user states
- responsive status
- implementation status
- issues
- severity

### 7.2 Navigation map

A concrete map of:
- current primary navigation
- secondary navigation
- contextual controls
- account / commercial entry points
- missing nodes
- broken hierarchy

### 7.3 State matrix

A state matrix crossing:
- anonymous / registered / Pro
with:
- dashboard
- detail
- predictions
- track record
- paywall
- registration prompt
- checkout
- post-checkout
- session restore

For each cell:
- supported
- unsupported
- inconsistent
- not modeled

### 7.4 Responsive gap report

A breakpoint-based report covering:
- desktop
- tablet if relevant
- mobile / narrow

For each main surface:
- what remains usable
- what degrades badly
- what becomes illegible
- what mixes concerns
- what needs redesign vs refinement

### 7.5 Design system maturity assessment

A direct assessment of whether the current frontend has:
- design tokens
- semantic colors
- typography scale
- spacing scale
- component variants
- theme architecture
- dark/light consistency
- layout primitives
- reusable shells
- state styling discipline

Classify maturity as one of:
- absent
- ad hoc
- partial
- coherent but incomplete
- production-ready baseline

### 7.6 Monetization-readiness assessment

Audit whether the current frontend is structurally ready for:
- Pro conversion
- registration deferral
- Stripe-based upgrade flow
- paywall messaging
- track record trust-building
- ads integration without UX collapse

### 7.7 Structural risk register

At minimum, identify:
- architectural risks
- product/UX risks
- responsive risks
- monetization risks
- maintainability risks
- testability risks

Each risk must include:
- description
- cause
- likely impact
- severity
- recommended action

### 7.8 Modernization preconditions

The audit must end with an explicit list of what must be true before a redesign begins.

Possible categories:
- IA clarification required
- shell redesign required
- auth model clarification required
- paywall flow clarification required
- design system foundation required
- component inventory cleanup required
- runtime/storage clarification required
- no blocker — redesign may proceed

---

## 8. Classification rules

Every finding must be classified using one of the following labels:

- `MISSING_SURFACE`
- `PARTIAL_SURFACE`
- `STRUCTURAL_COUPLING`
- `RESPONSIVE_DEBT`
- `NAVIGATION_COLLAPSE_RISK`
- `STATE_MODEL_GAP`
- `MONETIZATION_GAP`
- `THEME_SYSTEM_DEBT`
- `COMPONENT_FRAGMENTATION`
- `TESTABILITY_GAP`
- `NOT_AN_ISSUE`
- `OUT_OF_SCOPE`

No vague prose without classification.

---

## 9. Explicit non-goals of this audit

This audit must not:
- redesign the UI
- produce final component visuals
- invent native-app-specific requirements
- alter scoring, layout, or prediction semantics
- redefine DTO contracts
- decide ad monetization strategy in business terms
- invent speculative product modules beyond active scope

It may recommend follow-up work, but it must not silently turn into solution design.

---

## 10. Completion criteria

This audit is complete only when:

- every current product surface is inventoried
- every relevant missing commercial/account/session surface is classified
- responsive behavior is evaluated by surface, not generically
- user-state handling is mapped
- monetization-readiness is assessed
- design-system maturity is classified
- structural blockers to redesign are explicitly stated
- the output concludes with one of:
  - optimize current frontend
  - redesign frontend shell and IA
  - redesign frontend architecture in phases
  - block redesign until runtime/product-state issues are clarified

"It looks old" is not an acceptable conclusion.

---

## 11. Required recommendation format

The audit must end with a recommendation in exactly this format:

### Verdict
One of:
- `OPTIMIZE`
- `REDESIGN_PARTIAL`
- `REDESIGN_SYSTEMIC`
- `BLOCK_PENDING_FOUNDATIONS`

### Reason
A short paragraph explaining the ruling.

### Immediate next actions
Maximum 10 items, ordered by dependency.

### Deferred items
Only if explicitly non-blocking.

---

## 12. Suggested follow-up artifacts

If the audit finds material structural issues, it should recommend creation of one or more of:

- `spec.sportpulse.web.frontend-modernization.md`
- `spec.sportpulse.web.design-system-foundation.md`
- `spec.sportpulse.web.navigation-and-shell-architecture.md`
- `spec.sportpulse.web.auth-and-freemium-surface.md`

These are follow-up artifacts, not outputs of this audit itself.

---

## 13. One-paragraph summary

This audit determines whether the current SportPulse frontend is a coherent, scalable, monetizable product surface or merely an incrementally assembled interface. It inventories what exists, what is missing, what breaks under responsive use, how auth/session/freemium states are or are not modeled, how navigation scales under competition growth, and whether the system is structurally ready for redesign. It does not beautify; it classifies reality so that modernization can proceed on facts rather than assumptions.
