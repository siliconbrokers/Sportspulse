# Prompt maestro — Claude — Paquete B / Trust Surface Squad

You are operating as the SportPulse Trust Surface Executor under strict SDD.

Your job is to implement ONLY Package B / Trust Surface Squad of the approved web roadmap.

You are NOT allowed to broaden scope.
You are NOT allowed to implement auth, Stripe, paywall logic, or theme-system rollout.
You are NOT allowed to hide the trust surface behind login or treat it as a lab-only artifact.
You must execute narrowly, grounded in the active specs and acceptance contracts.

---

## 0. EXECUTION GOAL

Implement ONLY these tickets from the approved roadmap:

- SPF-TRK-001
- SPF-TRK-002
- SPF-TRK-003
- SPF-TRK-004

This package exists to make the **public competition track record** a first-class product surface.

It must establish:
- a clear frontend contract for the public track record surface,
- a real public route and render states,
- discoverability from the primary shell,
- QA coverage for threshold and disclosure behavior.

This package must preserve the product truth that **track record is public, aggregated by competition, and does not depend on auth**.

---

## 1. AUTHORITATIVE CORPUS (READ FIRST)

Treat these as governing and active, in this order for this slice:

1. `spec.sportpulse.core.ai-sdd-operating-protocol.md`
2. `spec.sportpulse.web.frontend-execution-backlog.md`
3. `spec.sportpulse.web.frontend-modernization.md`
4. `spec.sportpulse.web.navigation-and-shell-architecture.md`
5. `spec.sportpulse.qa.acceptance-test-matrix.md`
6. `spec.sportpulse.qa.prediction-track-record-fixtures.md`
7. `spec.sportpulse.web.auth-and-freemium-surface.md`
8. `spec.sportpulse.core.repo-structure-and-module-boundaries.md`
9. `spec.sportpulse.core.subagents-definition.md`
10. `spec.sportpulse.core.mvp-execution-scope.md`

You must obey:
- snapshot-first
- frontend-honest
- backend-owned truth
- no provider logic in frontend
- no semantic recomputation in UI
- no cherry-picking or misleading track record presentation
- no auth dependency for public track record
- no scope creep into Pro, auth, or premium analytics

If any file conflicts with another:
- stop,
- surface the conflict,
- classify it,
- do not silently reconcile it.

---

## 2. THIS PACKAGE EXISTS TO ACHIEVE THESE PRODUCT TRUTHS

You are implementing the trust surface package described by the active backlog and modernization plan.

The product truths you must preserve are:

- Track record is a **core trust surface**, not a secondary feature.
- Track record is **public** and must be reachable without login.
- Track record is **aggregated by competition**.
- When evaluated prediction count is **< 200**, numeric accuracy must NOT be shown.
- When the surface is historical or walk-forward derived, disclosure must be explicit.
- The shell must expose Track record as a first-class public route.

This package is intended to unlock:
- public product credibility,
- shell legitimacy,
- later monetization without hiding the trust moat.

---

## 3. EXACT TICKETS IN SCOPE

Implement ONLY these tickets.

### SPF-TRK-001
**Define frontend contract for public competition track record surface**

Requirements:
- define route and surface placement,
- define required UI fields,
- define required states,
- define below-threshold behavior,
- define disclosure behavior,
- define competition context handling.

Minimum states that must be explicitly modeled:
- loading
- empty
- unavailable
- below-threshold
- available
- disclosure-present historical/walk-forward state

Out of scope:
- per-user history
- premium analytics inside track record
- saved comparisons
- auth-filtered track record

---

### SPF-TRK-002
**Implement public track-record route and render states**

Requirements:
- create the actual public route `/:competitionId/track-record`
- render all required states
- consume existing backend endpoint/contract if available
- support competition context cleanly
- remain readable in narrow/mobile layouts
- no auth requirement

Out of scope:
- backend statistical recomputation
- per-user segmentation
- personalized history

---

### SPF-TRK-003
**Integrate Track record into primary shell and contextual discovery surfaces**

Requirements:
- primary navigation entry exists
- shell highlights route correctly
- track record is not hidden in a drawer or labs-only affordance
- optional contextual entry from predictions/pro may be added only if already supported cleanly by current shell

Out of scope:
- aggressive marketing CTA placement
- duplicate cluttered entry points

---

### SPF-TRK-004
**Add QA coverage for track record threshold and disclosure behavior**

Requirements:
- test threshold `< 200`
- test threshold `>= 200`
- test disclosure rendering when applicable
- use deterministic fixtures where possible
- keep tests fast and focused

Out of scope:
- re-validating backend statistics math beyond contract shape and rendering rules

---

## 4. EXPLICIT NON-GOALS

Do NOT do any of the following in this slice:

- no auth/session implementation
- no magic-link flow
- no Stripe or Pro checkout work
- no Pro-depth gating
- no ad suppression logic
- no personalization
- no account/history by user
- no premium upsell redesign
- no design-system migration beyond minimal safe consumption of already existing primitives
- no theme system rollout
- no remote config work
- no shell redesign beyond what is strictly required to expose Track record as a first-class route
- no backend endpoint redesign unless absolutely necessary for compatibility and already aligned with active contracts

---

## 5. IMPLEMENTATION RULES

### 5.1 Route and shell rules
You must align to the surface-first shell model:
- Resumen
- Predicciones
- Track record
- Pro
- Cuenta/Auth as shell action

Competition is global context.
Track record must be a real product surface, not a hidden sub-feature.

### 5.2 Public access rule
Track record must remain accessible to anonymous users.
Do not add guards, modal friction, or login dependencies.

### 5.3 Trust rule
If count is `< 200`, the UI must not display numeric accuracy.
It must render a below-threshold state that is clear, non-misleading, and consistent with fixtures and acceptance.

### 5.4 Disclosure rule
If the record shown is not yet full operational trust history and requires a historical/walk-forward disclosure, that disclosure must render clearly.
Do not bury it in tooltip-only UX.

### 5.5 Data truth rule
Frontend must render backend-provided truth.
Do not compute accuracy percentages, confidence judgments, or quality summaries locally.
Do not infer hidden states from heuristic logic.

### 5.6 Competition context rule
The route must bind to competition context cleanly.
Changing competition must change the track-record surface correctly.
Do not hardcode competition-specific route logic in App.tsx.

---

## 6. ACCEPTANCE TARGETS YOU MUST SATISFY

You must implement toward these acceptance truths:

### K-03 — Track record aggregate correctness
The UI must correctly represent:
- below-threshold state when count < 200,
- numeric accuracy only when threshold is satisfied,
- correct rendering of the returned contract,
- no fabricated metrics.

### Navigation truth from shell architecture
The route must be canonical and public:
- `/:competitionId/track-record`
- reachable from primary navigation
- competition-aware

### Modernization truth
Track record must be a first-class route/surface, not an internal or lab-only concern.
It may and should ship before auth.

---

## 7. EXPECTED OUTPUT

You must return exactly this structure:

# 1. Pre-check
- authoritative docs read
- conflicts found or none
- assumptions kept minimal

# 2. Implementation plan
For each of the 4 tickets:
- files/modules to touch
- what you will introduce
- what you will not touch

# 3. Contract definition
Produce the explicit frontend contract for the public track-record surface.
This must include:
- route placement
- shell placement
- required fields
- required states
- below-threshold rule
- disclosure rule
- competition-context behavior

# 4. Code changes
Provide the actual implementation changes.

# 5. Test additions
Provide focused tests for threshold and disclosure behavior.

# 6. Compliance check
Explicitly verify:
- no auth dependency added
- no Pro logic mixed in
- no frontend truth invention
- no provider calls in frontend
- no hiding of track record behind labs-only patterns

# 7. Residual risks
Only real remaining risks after this slice.

---

## 8. QUALITY BAR

Your output is bad if:
- Track record still feels like a hidden/internal feature
- login is introduced anywhere in the trust surface flow
- numeric accuracy appears below threshold
- disclosure is vague or absent when required
- shell discoverability remains weak
- route semantics are not canonical
- track-record rendering depends on local heuristics instead of contract truth
- you widen scope into auth, Pro, or design-system rollout

Your output is good only if:
- the trust surface becomes public and first-class,
- it is route-stable and shell-legible,
- it is epistemically honest under threshold/disclosure conditions,
- and it prepares later monetization without contaminating the free experience.

---

## 9. FINAL INSTRUCTION

Be strict.
Be narrow.
Implement only Package B.
Do not “help” by doing future slices early.
