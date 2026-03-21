# Prompt maestro Claude — SportPulse Web — Paquete A

You are operating as the SportPulse Frontend Foundation Executor under strict SDD.

Your job is to implement ONLY the first execution slice of the approved web roadmap.

You are NOT allowed to broaden scope.
You are NOT allowed to redesign the product visually.
You are NOT allowed to “interpret around” unclear areas.
You must follow the active specs and backlog exactly.

======================================================================
0. EXECUTION GOAL
======================================================================

Implement Package A / first slice of execution for SportPulse web:

- SPF-FND-001
- SPF-FND-002
- SPF-FND-003
- SPF-QA-001

This is the Phase 0 / backbone package that establishes:
- canonical frontend API access,
- route-based shell skeleton,
- externalized competition registry,
- baseline route/surface test harness.

Do NOT implement auth.
Do NOT implement Stripe.
Do NOT implement Pro gating.
Do NOT implement design-system rollout.
Do NOT implement full shell redesign.
Do NOT implement track record surface yet unless strictly needed as placeholder route only.

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

You must obey:
- frontend-honest
- snapshot-first
- backend-owned truth
- no provider calls in frontend
- no semantic recomputation in UI
- no scope creep
- no legacy reintroduction
- no speculative architecture beyond current slice

If any file conflicts with another:
- stop,
- surface the conflict,
- classify it,
- do not silently reconcile it.

======================================================================
2. THIS SLICE EXISTS TO ACHIEVE THESE PHASE TARGETS
======================================================================

You are implementing the foundation package described by the active backlog and modernization plan:

- central API client,
- route-based surface navigation,
- competition registry extracted from App.tsx hardcoding,
- baseline critical-path UI test harness.

This slice is meant to unlock:
- track record public route,
- auth shell integration,
- paywall route/context work later.

You must preserve current functionality while changing the structure underneath.

======================================================================
3. EXACT TICKETS IN SCOPE
======================================================================

Implement ONLY these tickets:

### SPF-FND-001
Shared API client abstraction in web.
Requirements:
- centralize critical-path calls behind a canonical client
- standardize loading/error handling for migrated calls
- remove raw fetch from critical-path route components

### SPF-FND-002
Introduce route-based navigation skeleton for surface-first shell.
Requirements:
- canonical route table exists
- core routes exist for:
  - `/:competitionId/resumen`
  - `/:competitionId/predicciones`
  - `/:competitionId/track-record`
  - `/pro`
  - `/cuenta`
  - `/login`
  - technical auth/checkout return placeholders only if structurally needed
- no App.tsx conditional spaghetti for main surfaces

### SPF-FND-003
Extract competition registry and surface metadata from App.tsx hardcoding.
Requirements:
- competition metadata moves out of App.tsx
- registry includes only what is necessary:
  - ids/slugs
  - labels
  - ordering
  - visibility
  - minimal shell-consumable metadata
- no CMS-like abstraction
- adding/removing a competition must not require touching route logic

### SPF-QA-001
Establish critical-path UI test harness.
Requirements:
- baseline automated coverage for main routes and state permutations
- cover at least:
  - dashboard/resumen route
  - predicciones route
  - track-record route placeholder reachability
  - shell navigation transitions
- tests should be fast and stable
- do NOT build a huge visual matrix

======================================================================
4. EXPLICIT NON-GOALS
======================================================================

Do NOT do any of the following in this slice:

- no auth/session implementation
- no magic-link flow
- no Pro paywall
- no Stripe integration
- no ad suppression logic
- no track record data implementation beyond route/surface placeholder support
- no design-system migration
- no theme/announcement system
- no deep responsive redesign
- no domain/business-truth caching in frontend
- no backend endpoint redesign unless absolutely required for API client typing and already compatible with existing contracts
- no speculative state framework migration
- no component beautification pass

======================================================================
5. IMPLEMENTATION RULES
======================================================================

### 5.1 Route and shell rules
You must align to the surface-first shell model:
- Resumen
- Predicciones
- Track record
- Pro
- Cuenta/Auth as shell action

Competition is global context, not a menu explosion.

Use route params for major surface identity and competition context.
Use query params only for secondary focus/filter state where necessary.

### 5.2 API client rules
The shared API client must:
- be thin
- normalize fetch configuration and error handling
- avoid entangling auth/session policy prematurely
- support current and near-term critical surfaces
- not become a giant SDK

### 5.3 State rules
If any shared state is needed in this slice, keep it minimal.
Do NOT recreate backend truth in client state.
Do NOT introduce a heavy client-store architecture.

### 5.4 Testing rules
Tests must prove:
- route table works
- shell can navigate between surfaces
- competition context is route-driven or route-derived
- migrated critical surfaces do not rely on raw fetch in route components

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
Provide the test harness and tests for SPF-QA-001.

# 5. Compliance check
Explicitly verify:
- no scope creep
- no frontend truth invention
- no provider access in frontend
- no auth/paywall implementation leaked into this slice

# 6. Residual risks
Only real risks left after this slice.

======================================================================
7. QUALITY BAR
======================================================================

Your output is bad if:
- you widen scope
- you mix in auth/paywall/theme work
- you leave App.tsx still acting as routing brain
- you invent a CMS-like competition registry
- you create brittle or massive tests
- you move business truth into frontend state
- you silently change route semantics away from the approved shell

Your output is good only if:
- the app gets a real structural backbone,
- current behavior is preserved,
- the next slices become easier,
- and nothing unrelated is smuggled in.

======================================================================
8. FINAL INSTRUCTION
======================================================================

Be strict.
Be narrow.
Implement only Package A.
Do not “help” by doing future slices early.
