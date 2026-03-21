# Prompt maestro — Claude — Paquete D — Monetization squad

You are operating as the SportPulse Monetization Executor under strict SDD.

Your job is to implement ONLY the monetization/commercial-gating slice of the approved web roadmap.

You are NOT allowed to broaden scope.
You are NOT allowed to redesign the product visually.
You are NOT allowed to re-open product decisions already closed.
You must follow the active specs and backlog exactly.

======================================================================
0. EXECUTION GOAL
======================================================================

Implement Package D / Monetization squad for SportPulse web:

- SPF-PRO-001
- SPF-PRO-002
- SPF-PRO-003
- SPF-PRO-004
- SPF-PRO-005
- SPF-QA-004
- SPF-QA-005

This slice establishes:
- the canonical Pro-depth UI contract,
- the inline paywall gate,
- checkout handoff + post-checkout entitlement refresh,
- Pro commercial-ad suppression,
- the `/pro` route as stable commercial surface,
- automated coverage for the commercial critical path.

This slice must preserve the anonymous-first free experience.
This slice must NOT change the free/public contract of the product.

Do NOT implement new premium tiers.
Do NOT move track record behind auth.
Do NOT lock the whole prediction route.
Do NOT add marketing/CMS systems.

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
9. `spec.sportpulse.web.site-experience-config.md`
10. `spec.sportpulse.web.theme-and-global-announcement-system.md`

You must obey:
- frontend-honest
- snapshot-first
- backend-owned truth
- anonymous-first product behavior
- free/public value must remain visible before monetization friction
- no semantic recomputation in UI
- no scope creep
- no alternative pricing or product strategy invention

If any file conflicts with another:
- stop,
- surface the conflict,
- classify it,
- do not silently reconcile it.

======================================================================
2. THIS SLICE EXISTS TO ACHIEVE THESE PHASE TARGETS
======================================================================

You are implementing the monetization/commercial slice described by the active backlog and modernization plan.

This slice exists to unlock:
- real free vs Pro behavioral separation,
- in-context upgrade flow,
- in-session Pro unlock after checkout,
- ad suppression for Pro as secondary commercial benefit,
- launch-grade coverage for the highest-value commercial journey.

It must preserve the approved product rules:
- 1X2 stays public/free,
- track record stays public,
- dashboard/treemap/detail/explainability stay public,
- Pro unlocks depth,
- registration/auth is deferred until the user attempts a gated action,
- operational notices remain visible even for Pro.

======================================================================
3. EXACT TICKETS IN SCOPE
======================================================================

Implement ONLY these tickets:

### SPF-PRO-001
Define Pro-depth UI contract and locked-state rendering rules.
Requirements:
- define exactly which prediction fields are Pro depth,
- define locked-state rendering contract,
- define teaser/placeholder behavior without leaking actual values,
- make the contract reusable across prediction surfaces.

### SPF-PRO-002
Implement inline paywall gate for Pro-depth actions.
Requirements:
- render locked depth block,
- trigger auth first for anonymous users,
- trigger upgrade/paywall for authenticated non-Pro users,
- render depth directly for Pro users,
- keep the gate contextual and inline, not route-wide.

### SPF-PRO-003
Integrate checkout handoff and post-checkout session refresh.
Requirements:
- integrate checkout handoff from paywall/upgrade surface,
- implement return-route handling if not already present,
- refresh/rehydrate entitlement in-session after successful checkout,
- explicitly handle stale/intermediate return states.

### SPF-PRO-004
Suppress commercial display ads for Pro while preserving operational notices.
Requirements:
- add/consume clean slot classification for commercial ads,
- hide commercial display ads for Pro users,
- preserve operational/system notices for all tiers,
- do not suppress warnings/service-status banners.

### SPF-PRO-005
Create `/pro` route for pricing, value explanation, and upgrade entry.
Requirements:
- build stable `/pro` surface,
- reflect actual free vs Pro contract,
- provide upgrade CTA,
- keep copy aligned to approved product decision.

### SPF-QA-004
Add automated journey coverage for anonymous → auth → Pro upgrade path.
Requirements:
- simulate anonymous entry,
- simulate auth gate,
- simulate non-Pro paywall,
- simulate post-upgrade Pro unlock,
- keep tests deterministic and not dependent on real payment providers.

### SPF-QA-005
Add automated coverage for Pro ad suppression behavior.
Requirements:
- verify ad slot may render for free/non-Pro,
- verify ad slot does not render for Pro,
- verify operational notice remains visible regardless of tier.

======================================================================
4. EXPLICIT NON-GOALS
======================================================================

Do NOT do any of the following in this slice:

- no new auth architecture beyond what Package C already established
- no social login
- no password login
- no redesign of public prediction semantics
- no route-wide paywall for predictions
- no gating of track record
- no gating of dashboard/resumen
- no multiple plans/tiers
- no free-trial system unless already present and explicitly required by corpus (assume not)
- no ad network integration
- no CMS or campaign system
- no design-system rollout outside the minimum needed to render locked/paywall/pro surfaces coherently
- no pricing experimentation framework
- no backend billing ledger redesign unless required to consume an already-supported checkout/entitlement contract
- no visual beautification pass unrelated to the commercial flow

======================================================================
5. IMPLEMENTATION RULES
======================================================================

### 5.1 Public/free contract rule
The following must remain publicly accessible and visible:
- dashboard/resumen surfaces,
- 1X2 prediction surface,
- model status / operating mode,
- explainability stub,
- track record public aggregate,
- warnings / degraded-state visibility.

If your implementation reduces public value, it is wrong.

### 5.2 Pro-depth rule
The following are Pro-only depth surfaces in v1:
- scoreline distribution,
- xG-related depth fields,
- O/U,
- BTTS,
- equivalent approved depth analytics.

Do not invent extra Pro fields unless already backed by the existing prediction surface contract.

### 5.3 Gate rule
The gate must be:
- inline,
- intent-triggered,
- contextual to the depth block,
- invisible until the user attempts depth access,
- not a first-visit interruption,
- not a route-level lock.

### 5.4 Anonymous-first rule
For anonymous users:
- first attempt to access depth triggers auth entry first,
- after auth success, tier is re-evaluated,
- only then may paywall/upgrade appear if the user remains non-Pro.

Do not skip auth for anonymous users when depth access requires identity.

### 5.5 Session/entitlement rule
Frontend may only consume derived session/entitlement state.
Do not invent Pro truth in the client.
Do not assume successful checkout without confirmed refresh/rehydration.

### 5.6 Ad suppression rule
Commercial display ads are suppressed for Pro.
Operational notices, degraded-state warnings, and service-status banners are not ads and must remain visible.
Do not blur these categories.

### 5.7 `/pro` route rule
`/pro` is a supporting commercial surface.
It must explain the actual contract:
- free = public value,
- Pro = depth + no commercial display ads.

Do not turn `/pro` into a separate product universe.

### 5.8 Testing rule
Tests must prove:
- anonymous users are not blocked on first visit,
- auth is deferred to the correct user intent,
- non-Pro sees paywall CTA in the correct place,
- Pro sees depth directly,
- checkout return can refresh session state,
- commercial ads are suppressed for Pro,
- operational notices remain visible.

======================================================================
6. ACCEPTANCE ORIENTATION
======================================================================

This slice is directly responsible for satisfying:
- K-04 — Pro depth paywall gate
- K-05 — Pro subscription flow
- K-06 — Registration deferral
- K-07 — Pro commercial ad suppression

Implementation must be explicitly checked against these acceptance items.

If your implementation passes internal reasoning but would fail K-04/K-05/K-06/K-07, it is wrong.

======================================================================
7. EXPECTED OUTPUT
======================================================================

You must return:

# 1. Pre-check
- authoritative docs read
- conflicts found or none
- assumptions kept minimal

# 2. Implementation plan
For each in-scope ticket:
- what files/modules you will touch
- what you will introduce
- what you will not touch

# 3. Code changes
Provide the actual implementation changes.

# 4. Test additions
Provide the tests needed for SPF-QA-004 and SPF-QA-005.

# 5. Compliance check
Explicitly verify:
- public/free contract preserved
- no route-wide paywall introduced
- anonymous-first preserved
- no frontend truth invention
- operational notices not suppressed for Pro

# 6. Residual risks
Only real risks left after this slice.

======================================================================
8. QUALITY BAR
======================================================================

Your output is bad if:
- you gate 1X2 or track record
- you show paywall on first visit
- you add a route-wide lock
- you leak Pro values in hidden DOM/placeholder rendering
- you suppress warnings/notices together with ads
- you assume checkout success without entitlement refresh
- you invent extra plans or marketing systems
- you mix theme/config rollout into this slice beyond necessity

Your output is good only if:
- the public product remains credible and usable,
- the commercial path becomes real,
- the gate is contextual,
- Pro unlock feels immediate after checkout,
- and the implementation remains tight to the approved specs.

======================================================================
9. FINAL INSTRUCTION
======================================================================

Be strict.
Be narrow.
Implement only Package D.
Do not “help” by doing future slices early.
