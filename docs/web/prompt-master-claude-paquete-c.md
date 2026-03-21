# Prompt maestro — Claude — Paquete C — Identity squad

You are operating as the SportPulse Identity/Foundation Executor under strict SDD.

Your job is to implement ONLY the identity/session slice of the approved web roadmap.

You are NOT allowed to broaden scope.
You are NOT allowed to redesign visuals.
You are NOT allowed to implement monetization prematurely.
You must follow the active specs and backlog exactly.

======================================================================
0. EXECUTION GOAL
======================================================================

Implement Package C / Identity squad for SportPulse web:

- SPF-AUTH-001
- SPF-AUTH-002
- SPF-AUTH-003
- SPF-AUTH-004

This slice establishes:
- the canonical frontend session model,
- the app-level auth/session provider,
- deferred anonymous-first magic-link entry,
- a minimal shell account entry surface.

This slice must preserve the anonymous-first public experience.
This slice must NOT yet implement the commercial gate end-to-end.

Do NOT implement Stripe.
Do NOT implement Pro-depth gating.
Do NOT implement ad suppression logic.
Do NOT implement favorites/bookmarks or persistence actions beyond what is needed to support deferred auth entry.

======================================================================
1. AUTHORITATIVE CORPUS (READ FIRST)
======================================================================

Treat these as governing and active:

1. `spec.sportpulse.core.ai-sdd-operating-protocol.md`
2. `spec.sportpulse.web.auth-and-freemium-surface.md`
3. `spec.sportpulse.web.navigation-and-shell-architecture.md`
4. `spec.sportpulse.web.frontend-modernization.md`
5. `spec.sportpulse.web.frontend-execution-backlog.md`
6. `spec.sportpulse.qa.acceptance-test-matrix.md`
7. `spec.sportpulse.core.repo-structure-and-module-boundaries.md`
8. `spec.sportpulse.core.subagents-definition.md`
9. `spec.sportpulse.web.site-experience-config.md` (only to avoid future config coupling mistakes)

You must obey:
- frontend-honest
- snapshot-first
- backend-owned truth
- anonymous-first product behavior
- no provider logic in frontend
- no semantic recomputation in UI
- no scope creep
- no premature monetization coupling

If any file conflicts with another:
- stop,
- surface the conflict,
- classify it,
- do not silently reconcile it.

======================================================================
2. THIS SLICE EXISTS TO ACHIEVE THESE PHASE TARGETS
======================================================================

You are implementing the identity/session foundation slice described by the active backlog and modernization plan.

This slice exists to unlock later work on:
- inline paywall gate,
- checkout return / entitlement refresh,
- Pro-aware shell behavior,
- registration deferral flows.

It must NOT itself become the monetization implementation.

You must preserve the core product rule:
- the site is usable without login,
- auth is deferred,
- public value is visible before identity friction.

======================================================================
3. EXACT TICKETS IN SCOPE
======================================================================

Implement ONLY these tickets:

### SPF-AUTH-001
Canonical frontend session model.
Requirements:
- define the minimal session state shape used by web
- support at least:
  - `anonymous`
  - `loading`
  - `authenticated`
  - `expired`
- expose tier fields without inventing entitlement logic
- do not mirror backend internals unnecessarily
- keep the model compatible with later Pro gating

### SPF-AUTH-002
Auth/session provider at app shell level.
Requirements:
- create a minimal AuthContext or equivalent provider
- hydrate session once near app shell
- make session state consumable by shell/account entry and future gated surfaces
- do not push business truth into client state
- support explicit refresh/revalidation hook for later checkout return flow

### SPF-AUTH-003
Deferred anonymous-first magic-link auth entry.
Requirements:
- no login wall on first visit
- auth entry is initiated only from explicit auth-required actions
- provide minimal login route / entry surface and technical completion path if structurally needed
- support magic-link request/start flow scaffolding
- preserve return-to-context capability where practical
- do not build profile management or password flows

### SPF-AUTH-004
Minimal shell account entry.
Requirements:
- account/auth affordance exists in shell
- anonymous state shows clear sign-in entry
- authenticated state shows minimal signed-in affordance
- do not build full account center
- do not expose Pro upsell here as primary monetization surface

======================================================================
4. EXPLICIT NON-GOALS
======================================================================

Do NOT do any of the following in this slice:

- no Stripe integration
- no paywall modal or inline Pro gate implementation
- no depth-surface gating logic
- no commercial ad suppression behavior
- no favorites/bookmarks implementation
- no saved-user-content model
- no social login
- no password login
- no forgot-password flow
- no profile completion wizard
- no entitlement ledger in frontend
- no redesign of `/pro`
- no conversion-copy optimization
- no design-system rollout beyond minimal shell integration needed for the new auth affordance

======================================================================
5. IMPLEMENTATION RULES
======================================================================

### 5.1 Anonymous-first rule
The default user must remain anonymous.
The product must remain usable and valuable before sign-in.
No route that is public in the approved IA may become auth-blocked in this slice.

### 5.2 Session truth rule
Frontend may hold only the derived session model.
Frontend must not infer subscription truth from local heuristics.
Frontend must not persist privileged truth beyond what is needed for current session behavior.

### 5.3 Auth-trigger rule
Auth entry may be connected only to:
- explicit shell sign-in,
- a future auth-required action hook,
- or technical auth completion routes.

Do NOT proactively interrupt first-load public flows.

### 5.4 Shell rule
The shell must continue to align with the approved IA:
- Resumen
- Predicciones
- Track record
- Pro
- Cuenta/Auth as shell action

Auth lives as a shell action, not a primary product pillar.

### 5.5 Route rule
Routes may include what is minimally needed for auth flow support, such as:
- `/login`
- technical completion route(s) if necessary

Do not invent extra account routes unless structurally necessary.

### 5.6 Testing rule
Tests must prove:
- anonymous baseline remains public
- auth provider hydrates and exposes session state correctly
- deferred auth entry does not hijack first visit
- shell account entry changes state correctly between anonymous and authenticated session mocks

======================================================================
6. EXPECTED OUTPUT
======================================================================

You must return:

# 1. Pre-check
- authoritative docs read
- conflicts found or none
- assumptions kept minimal

# 2. Implementation plan
For each of the 4 tickets:
- what files/modules you will touch
- what you will introduce
- what you will not touch

# 3. Code changes
Provide the actual implementation changes.

# 4. Test additions
Provide the tests needed for this slice.

# 5. Compliance check
Explicitly verify:
- anonymous-first preserved
- no paywall/Stripe leakage
- no frontend truth invention
- no public-route auth wall introduced

# 6. Residual risks
Only real risks left after this slice.

======================================================================
7. ACCEPTANCE ORIENTATION
======================================================================

This slice should prepare, but not fully complete, the path to:
- K-05 (subscription flow)
- K-06 (registration deferral)

At the end of this slice, at minimum the implementation must already be compatible with K-06:
- no forced registration on first visit
- auth only from explicit action

If your implementation would make later K-06 compliance harder, it is wrong.

======================================================================
8. QUALITY BAR
======================================================================

Your output is bad if:
- you introduce a login wall
- you implement paywall/Pro logic early
- you treat account as a primary navigation pillar
- you create a bloated user model
- you entangle auth with theme/config work
- you require backend-truth duplication in client state
- you introduce password/social flows beyond scope

Your output is good only if:
- anonymous-first remains intact,
- identity foundation is real,
- later monetization work becomes easier,
- and no future slice is preemptively implemented.

======================================================================
9. FINAL INSTRUCTION
======================================================================

Be strict.
Be narrow.
Implement only Package C.
Do not “help” by doing Package D early.
