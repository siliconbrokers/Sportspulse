---
artifact_id: SPEC-SPORTPULSE-WEB-FRONTEND-EXECUTION-BACKLOG
title: "Web Frontend Execution Backlog"
artifact_class: spec
status: proposed
version: 0.2.0
project: sportpulse
domain: web
slug: frontend-execution-backlog
owner: team
created_at: 2026-03-21
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-WEB-AUTH-AND-FREEMIUM-SURFACE
  - SPEC-SPORTPULSE-WEB-NAVIGATION-AND-SHELL-ARCHITECTURE
  - SPEC-SPORTPULSE-WEB-FRONTEND-MODERNIZATION
  - SPEC-SPORTPULSE-WEB-DESIGN-SYSTEM-FOUNDATION
  - SPEC-SPORTPULSE-WEB-THEME-AND-GLOBAL-ANNOUNCEMENT-SYSTEM
  - SPEC-SPORTPULSE-WEB-SITE-EXPERIENCE-CONFIG
  - SPEC-SPORTPULSE-WEB-FUTURE-EXPERIENCE-ROADMAP
canonical_path: docs/web/spec.sportpulse.web.frontend-execution-backlog.md
---

# SportPulse — Web Frontend Execution Backlog

Version: 0.2  
Status: Proposed  
Scope: Dependency-aware execution backlog for frontend, public track record, auth/session, paywall, Pro-depth, theming foundations, and testability.

---

## 1. Operational restatement

Public launch is blocked by missing auth/session, Pro subscription flow, paywall behavior, and public track record surface. Engineering work is **not** blocked for foundations, route architecture, design-system base, theme/config base, and public track record preparation.

This backlog assumes these decisions are already fixed:

- Primary IA: product-surface-first shell with global competition context.
- Auth: anonymous-first, email magic link, web session.
- Paywall: inline, intent-triggered on Pro-depth access.
- Pro offer: depth analytics + suppression of commercial display ads.

---

## 2. Product-owner decisions already closed

### D-01 — Navigation hierarchy
- Surface-first shell: `Resumen`, `Predicciones`, `Track record`, `Pro`.
- Competition is global context, not the primary navigation axis.

### D-02 — Auth model
- Anonymous-first.
- Email magic link.
- Session-backed web auth.
- No password flow in v1.
- No social login in v1.

### D-03 — Freemium/paywall model
- 1X2 stays public.
- Pro-depth is gated inline on intent.
- Track record stays public.
- Pro suppresses commercial display ads.

---

## 3. Dependency-aware execution streams

### Stream 1 — Foundations
Purpose:
Stabilize the frontend architecture so future work lands on reusable, testable primitives instead of App-level hardcoding.

Scope:
- API client unification.
- Route-based navigation.
- Competition registry/data-driven surface.
- Shell cleanup.
- Lightweight global app state.
- Design-system foundations adoption hooks.
- Critical-path UI test harness.

Non-goals:
- Full visual redesign.
- Subscription or checkout implementation.
- Prediction semantics changes.

Deliverables:
- Central API client.
- Stable route map.
- App shell state model.
- Reduced App.tsx orchestration.
- Test harness for routes and main surfaces.

Dependencies:
- None for kickoff.

### Stream 2 — Public track record surface
Purpose:
Expose the public trust surface required by product and MVP.

Scope:
- Public competition-level track record rendering.
- Below-threshold behavior.
- Walk-forward disclosure when applicable.
- Surface placement in IA.
- Loading / empty / unavailable states.

Non-goals:
- User-specific history.
- Premium analytics within track record.
- Portfolio/reporting surfaces.

Deliverables:
- Public track record route/surface.
- UI contract and state model.
- QA coverage for threshold and disclosure behavior.

Dependencies:
- Basic route and shell support from Foundations.
- Backend/UI API contract availability.

### Stream 3 — Auth + session foundations
Purpose:
Introduce identity only where needed for freemium conversion and Pro entitlement.

Scope:
- Auth context.
- Session hydration.
- Anonymous-first user state.
- Login entry from gated actions.
- Post-auth state restoration.

Non-goals:
- Password account system.
- Social login.
- Profile settings.
- Preference center.

Deliverables:
- Session provider.
- Session endpoint contract.
- Magic-link flow integration points.
- State transition model.

Dependencies:
- Route model.
- Shell account entry point.
- Backend auth capability.

### Stream 4 — Subscription / paywall / Pro-depth
Purpose:
Implement the commercial contract of Pro without breaking free value surfaces.

Scope:
- Pro-depth gating.
- Inline paywall surface.
- Upgrade CTA.
- Checkout handoff.
- Post-checkout entitlement refresh.
- Ad suppression for Pro.

Non-goals:
- Multi-tier pricing.
- Trials.
- Coupon systems.
- Advanced upsell experimentation.

Deliverables:
- Pro-gated depth component contract.
- Paywall interaction flow.
- Checkout return handling.
- Commercial ad suppression by tier.

Dependencies:
- Auth/session model.
- Public free surface rendering.
- Pricing/checkout endpoints.

### Stream 5 — Responsive hardening + QA
Purpose:
Reduce current known UI risk and create a baseline that makes refactor safe.

Scope:
- DetailPanel iOS-safe behavior.
- Treemap visibility in HomePortal.
- Breakpoint behavior for key surfaces.
- UI smoke tests and journey coverage.

Non-goals:
- Pixel-perfect redesign.
- Broad visual regression framework rollout.

Deliverables:
- Fixed critical responsive defects.
- Test coverage for main states.
- Confidence for subsequent shell work.

Dependencies:
- Some items can start immediately.
- Route-based navigation helps test stability.

#### Ticket ID: SPF-QA-006
- **Priority**: P2
- **Title**: Validate Level B global theme propagation readiness across active product surfaces
- **Why**: A product-wide style propagation claim needs verification, not belief.
- **Scope**:
  - Verify theme swap across the active product surface inventory.
  - Validate notices, warnings, paywall, and free-vs-Pro surfaces retain semantic distinction under theme change.
  - Confirm no undocumented raw style leakage remains in active product surfaces.
- **Out of scope**:
  - Subjective visual polish judgments.
  - Future/deferred surfaces outside the active product footprint.
- **Dependencies**: SPF-EXP-004
- **Acceptance criteria**:
  - Theme swap passes across the active product inventory.
  - Semantic distinctions remain intact under theme change.
  - K-08 or equivalent acceptance case is passing.
- **Risks / notes**:
  - Do not execute this before Level A and the active-surface pass exist.
- **Owner suggestion**: frontend / QA
- **Blocking type**: FOUNDATION_ENABLER

## Stream 6 — Experience/theming foundation and style-safety rollout
Purpose:
Prepare stable visual grammar, theme variation, and site experience config without overbuilding runtime personalization.

Scope:
- Design token adoption plan.
- Theme registry hooks.
- Global announcement model hooks.
- Site experience config integration points.

Non-goals:
- White-label.
- CMS.
- Advanced targeting.
- A/B testing.

Deliverables:
- Tokenized surfaces.
- Theme-safe shell primitives.
- Announcement slot primitives.
- Experience config consumption pattern.

Dependencies:
- Shell architecture.
- Foundational component cleanup.

---

## 4. Technical backlog

## Stream 1 — Foundations

### Ticket ID: SPF-FND-001
- **Priority**: P0
- **Title**: Create centralized web API client and remove ad hoc fetch calls
- **Why**: Current fragmented request usage increases coupling, inconsistent error handling, and makes auth/session and route-driven data flows harder.
- **Scope**:
  - Introduce a shared API client abstraction in web.
  - Normalize error handling and request configuration.
  - Migrate critical-path calls from raw fetch to the client.
- **Out of scope**:
  - Full API surface migration in one pass.
  - Backend endpoint redesign.
- **Dependencies**: None.
- **Acceptance criteria**:
  - Shared API client exists and is used by dashboard/prediction/track-record critical surfaces.
  - Raw fetch no longer appears in critical-path route components.
  - Error and loading handling are standardized for migrated calls.
- **Risks / notes**:
  - Avoid bundling this with auth token/cookie policy prematurely.
- **Owner suggestion**: frontend
- **Blocking type**: FOUNDATION_ENABLER

### Ticket ID: SPF-FND-002
- **Priority**: P0
- **Title**: Introduce route-based navigation skeleton for surface-first shell
- **Why**: Current App-level hardcoding does not scale to shell architecture, track record, Pro, or account/session surfaces.
- **Scope**:
  - Define route map for `resumen`, `predicciones`, `track-record`, `pro`, `cuenta`/auth flows.
  - Preserve competition as contextual route parameter or equivalent global route context.
  - Add route shells and placeholders as needed.
- **Out of scope**:
  - Final visual redesign.
  - Full auth gating logic.
- **Dependencies**: None.
- **Acceptance criteria**:
  - Route table exists and is canonical in frontend.
  - Users can navigate across core surfaces without App.tsx conditional spaghetti.
  - Deep linking works for main surfaces.
- **Risks / notes**:
  - Keep route naming aligned to navigation-and-shell spec.
- **Owner suggestion**: frontend
- **Blocking type**: FOUNDATION_ENABLER

### Ticket ID: SPF-FND-003
- **Priority**: P0
- **Title**: Extract competition registry and surface metadata from App.tsx hardcoding
- **Why**: Hardcoded competition definitions in App.tsx are a structural scaling risk for more competitions and tournament types.
- **Scope**:
  - Create competition registry module.
  - Move labels, slugs, ordering, visibility, and metadata out of App.tsx.
  - Support navigation consumption and shell context.
- **Out of scope**:
  - Admin/back-office management.
  - Runtime remote config.
- **Dependencies**: SPF-FND-002
- **Acceptance criteria**:
  - Competition metadata is consumed from registry, not hardcoded in App.tsx.
  - Adding/removing a competition does not require touching routing logic.
- **Risks / notes**:
  - Keep registry minimal; do not invent CMS-like behavior.
- **Owner suggestion**: frontend
- **Blocking type**: FOUNDATION_ENABLER

### Ticket ID: SPF-FND-004
- **Priority**: P1
- **Title**: Introduce lightweight global app state for shell/session/navigation context
- **Why**: App-level local state fragmentation makes shell, announcements, auth, and Pro behavior brittle.
- **Scope**:
  - Add minimal shared state for competition context, shell state, session summary, and announcement rendering state.
  - Keep domain truth external.
- **Out of scope**:
  - Domain-store replacement for backend truth.
  - Heavy client-state framework migration.
- **Dependencies**: SPF-FND-002
- **Acceptance criteria**:
  - Shared shell context exists.
  - App.tsx no longer owns excessive local orchestration.
  - Session shell state and competition context are readable across surface routes.
- **Risks / notes**:
  - Keep it thin; do not recreate backend models in client state.
- **Owner suggestion**: frontend
- **Blocking type**: FOUNDATION_ENABLER

### Ticket ID: SPF-FND-005
- **Priority**: P1
- **Title**: Refactor App.tsx into route shell plus surface containers
- **Why**: Excessive top-level orchestration blocks maintainability and makes incremental modernization risky.
- **Scope**:
  - Extract route shell.
  - Move surface-specific logic into dedicated route containers.
  - Reduce orchestration burden in App.tsx.
- **Out of scope**:
  - Full component redesign.
- **Dependencies**: SPF-FND-002, SPF-FND-004
- **Acceptance criteria**:
  - App.tsx becomes a thin composition layer.
  - Surface concerns are separated into route-level containers.
- **Risks / notes**:
  - Avoid refactor churn without matching tests.
- **Owner suggestion**: frontend
- **Blocking type**: PARALLELIZABLE

### Ticket ID: SPF-FND-006
- **Priority**: P1
- **Title**: Mark stale frontend architecture docs and align active specs
- **Why**: Documentation drift causes agents and engineers to implement against false architecture assumptions.
- **Scope**:
  - Identify stale docs.
  - Mark or update them.
  - Add references to new active web specs.
- **Out of scope**:
  - Rewriting unrelated core specs.
- **Dependencies**: None.
- **Acceptance criteria**:
  - Stale frontend architecture assumptions are explicitly marked.
  - New active specs are cross-linked from current documentation index or relevant surfaces.
- **Risks / notes**:
  - Do not silently overwrite historical docs without status labeling.
- **Owner suggestion**: shared
- **Blocking type**: PARALLELIZABLE

## Stream 2 — Public track record surface

### Ticket ID: SPF-TRK-001
- **Priority**: P0
- **Title**: Define frontend contract for public competition track record surface
- **Why**: Public track record is a core trust surface and must be visible without auth.
- **Scope**:
  - Define route/surface placement.
  - Define required UI fields.
  - Define below-threshold and disclosure states.
- **Out of scope**:
  - Per-user history.
  - Premium analytics within track record.
- **Dependencies**: SPF-FND-002
- **Acceptance criteria**:
  - Track record UI contract exists and matches public MVP intent.
  - Below-threshold rendering rules are explicit.
  - Walk-forward disclosure state is explicit.
- **Risks / notes**:
  - Must not imply certainty when under threshold.
- **Owner suggestion**: frontend / product
- **Blocking type**: LAUNCH_BLOCKER

### Ticket ID: SPF-TRK-002
- **Priority**: P0
- **Title**: Implement public track record route and render states
- **Why**: The public product lacks a visible trust surface even though the capability exists internally.
- **Scope**:
  - Create `track-record` surface.
  - Render loading, empty, below-threshold, available, unavailable, and disclosure states.
  - Support competition context.
- **Out of scope**:
  - Auth-based filtering.
  - Saved comparisons.
- **Dependencies**: SPF-TRK-001, SPF-FND-001, SPF-FND-002, backend endpoint availability
- **Acceptance criteria**:
  - Public users can reach track-record route.
  - Surface renders correctly across all expected states.
  - No auth required.
- **Risks / notes**:
  - Must stay readable on mobile/narrow layouts.
- **Owner suggestion**: frontend
- **Blocking type**: LAUNCH_BLOCKER

### Ticket ID: SPF-TRK-003
- **Priority**: P1
- **Title**: Integrate track record entry point into primary shell and contextual CTA surfaces
- **Why**: A public trust surface hidden from navigation does not solve the product problem.
- **Scope**:
  - Add primary nav entry.
  - Add optional contextual entry from predictions/pro if approved.
- **Out of scope**:
  - Aggressive marketing placement.
- **Dependencies**: SPF-TRK-002, SPF-FND-002
- **Acceptance criteria**:
  - Track record is discoverable from primary navigation.
  - Shell state correctly reflects current route.
- **Risks / notes**:
  - Avoid cluttering shell with duplicate entry points.
- **Owner suggestion**: frontend
- **Blocking type**: LAUNCH_BLOCKER

### Ticket ID: SPF-TRK-004
- **Priority**: P1
- **Title**: Add QA coverage for track record threshold and disclosure behavior
- **Why**: Trust surfaces are dangerous if they show wrong metrics or wrong disclosure state.
- **Scope**:
  - Add tests for threshold < 200.
  - Add tests for threshold >= 200.
  - Add tests for disclosure rendering.
- **Out of scope**:
  - Backend statistical validation.
- **Dependencies**: SPF-TRK-002, SPF-QA-001
- **Acceptance criteria**:
  - Automated tests cover below-threshold and available states.
  - Disclosure state is asserted when applicable.
- **Risks / notes**:
  - Prefer deterministic fixtures.
- **Owner suggestion**: frontend / QA
- **Blocking type**: PARALLELIZABLE

## Stream 3 — Auth + session foundations

### Ticket ID: SPF-AUTH-001
- **Priority**: P0
- **Title**: Define frontend session model and hydration contract
- **Why**: Auth/session flows cannot be implemented cleanly without a minimal, canonical frontend session model.
- **Scope**:
  - Define `anonymous | loading | authenticated | expired` states.
  - Define minimal session payload consumed by frontend.
  - Define initial hydration flow.
- **Out of scope**:
  - Backend auth provider internals.
- **Dependencies**: SPF-FND-001
- **Acceptance criteria**:
  - Session model is documented in code/spec alignment.
  - Frontend has a single source of session summary truth.
- **Risks / notes**:
  - Do not expose more identity data than necessary.
- **Owner suggestion**: shared
- **Blocking type**: LAUNCH_BLOCKER

### Ticket ID: SPF-AUTH-002
- **Priority**: P0
- **Title**: Implement AuthContext/session provider in app shell
- **Why**: Gated actions and account shell behavior require a stable session provider.
- **Scope**:
  - Add shell-level session provider.
  - Hydrate on app start.
  - Expose minimal auth state to route surfaces.
- **Out of scope**:
  - Full account management.
- **Dependencies**: SPF-AUTH-001, SPF-FND-002, SPF-FND-004
- **Acceptance criteria**:
  - Shell can distinguish anonymous/loading/authenticated states.
  - Route surfaces can consume session summary without duplicating logic.
- **Risks / notes**:
  - Prevent auth flash exposing wrong Pro state.
- **Owner suggestion**: frontend
- **Blocking type**: LAUNCH_BLOCKER

### Ticket ID: SPF-AUTH-003
- **Priority**: P0
- **Title**: Integrate deferred magic-link auth entry from gated actions
- **Why**: Registration deferral is a core product rule; auth must start only on meaningful user intent.
- **Scope**:
  - Create auth prompt entry for Pro-depth actions.
  - Support redirect/return to requested action after successful auth.
- **Out of scope**:
  - Signup wall on first visit.
  - Social login.
- **Dependencies**: SPF-AUTH-001, SPF-AUTH-002
- **Acceptance criteria**:
  - Anonymous users are not blocked on first visit.
  - Gated action triggers auth prompt.
  - Successful auth returns user to context.
- **Risks / notes**:
  - Keep auth UI lightweight and contextual.
- **Owner suggestion**: frontend / backend
- **Blocking type**: LAUNCH_BLOCKER

### Ticket ID: SPF-AUTH-004
- **Priority**: P1
- **Title**: Add account shell entry and minimal authenticated state UI
- **Why**: Users need clear shell-level access to session/account state without account-first IA.
- **Scope**:
  - Add shell action for account/session.
  - Show anonymous vs authenticated indicator.
  - Show tier summary if useful.
- **Out of scope**:
  - Full settings page.
  - Billing management UI.
- **Dependencies**: SPF-AUTH-002
- **Acceptance criteria**:
  - Shell reflects auth state.
  - Users can access login or account summary from shell.
- **Risks / notes**:
  - Keep account surface secondary, not a product pillar.
- **Owner suggestion**: frontend
- **Blocking type**: PARALLELIZABLE

## Stream 4 — Subscription / paywall / Pro-depth

### Ticket ID: SPF-PRO-001
- **Priority**: P0
- **Title**: Define Pro-depth UI contract and locked-state rendering rules
- **Why**: The paywall cannot be implemented correctly if the depth block contract is fuzzy.
- **Scope**:
  - Define which fields are Pro depth.
  - Define locked-state component behavior.
  - Define teaser/placeholder behavior without leaking values.
- **Out of scope**:
  - Pricing experiments.
  - Alternative premium tiers.
- **Dependencies**: None.
- **Acceptance criteria**:
  - Pro-depth block contract is explicit and reusable.
  - Non-Pro locked state does not expose actual depth values.
- **Risks / notes**:
  - Keep field classification aligned to auth-and-freemium spec.
- **Owner suggestion**: frontend / product
- **Blocking type**: LAUNCH_BLOCKER

### Ticket ID: SPF-PRO-002
- **Priority**: P0
- **Title**: Implement inline paywall gate for Pro-depth actions
- **Why**: The product requires contextual gating, not route-level blocking.
- **Scope**:
  - Render locked depth block.
  - Trigger auth first for anonymous users.
  - Trigger upgrade for authenticated non-Pro users.
- **Out of scope**:
  - Full-screen hard paywall.
  - Route-wide lock for predictions.
- **Dependencies**: SPF-PRO-001, SPF-AUTH-002, SPF-AUTH-003
- **Acceptance criteria**:
  - Anonymous users are prompted to authenticate when accessing depth.
  - Authenticated non-Pro users see paywall CTA.
  - Pro users see depth directly.
- **Risks / notes**:
  - Avoid duplicate gate logic scattered through components.
- **Owner suggestion**: frontend
- **Blocking type**: LAUNCH_BLOCKER

### Ticket ID: SPF-PRO-003
- **Priority**: P0
- **Title**: Integrate checkout handoff and post-checkout session refresh
- **Why**: Successful payment must unlock Pro in the same session or the subscription flow feels broken.
- **Scope**:
  - Checkout handoff UI integration.
  - Return route handling.
  - Session refresh / entitlement rehydration.
- **Out of scope**:
  - Backend billing reconciliation internals.
  - Invoice history UI.
- **Dependencies**: SPF-AUTH-002, SPF-PRO-002, backend checkout support
- **Acceptance criteria**:
  - Successful checkout updates UI entitlement in-session.
  - Stale intermediate state is handled explicitly.
- **Risks / notes**:
  - Must avoid contradictory UI state on return.
- **Owner suggestion**: shared
- **Blocking type**: LAUNCH_BLOCKER

### Ticket ID: SPF-PRO-004
- **Priority**: P1
- **Title**: Suppress commercial display ads for Pro tier while preserving operational notices
- **Why**: Pro includes ad suppression as a secondary commercial benefit; operational truth must remain visible.
- **Scope**:
  - Add commercial ad slot classification.
  - Hide commercial display ads for Pro users.
  - Preserve operational/system notices.
- **Out of scope**:
  - Ad network integration.
  - Editorial banner suppression rules beyond explicit spec.
- **Dependencies**: SPF-AUTH-002, SPF-PRO-003 or equivalent entitlement-ready session state, SPF-EXP-003 if experience-config hook needed
- **Acceptance criteria**:
  - Non-Pro users can render commercial ad slots if active.
  - Pro users do not render commercial ad slots.
  - Operational notices remain visible for both tiers.
- **Risks / notes**:
  - Requires clean distinction between ad, announcement, and warning types.
- **Owner suggestion**: frontend / shared
- **Blocking type**: LAUNCH_BLOCKER

### Ticket ID: SPF-PRO-005
- **Priority**: P1
- **Title**: Create Pro page route for pricing, value explanation, and upgrade entry
- **Why**: Inline paywall needs a stable supporting surface for deeper explanation and direct upgrade entry.
- **Scope**:
  - Build `/pro` route.
  - Explain free vs Pro.
  - Provide upgrade CTA.
- **Out of scope**:
  - Marketing campaign CMS.
  - Multiple product plans.
- **Dependencies**: SPF-FND-002, SPF-PRO-001
- **Acceptance criteria**:
  - Pro page exists in primary navigation.
  - It reflects the actual free/Pro contract.
- **Risks / notes**:
  - Keep copy aligned with auth-and-freemium spec.
- **Owner suggestion**: frontend / product
- **Blocking type**: PARALLELIZABLE

## Stream 5 — Responsive hardening + QA

### Ticket ID: SPF-QA-001
- **Priority**: P0
- **Title**: Establish critical-path UI test harness for route/surface journeys
- **Why**: Major refactor without test scaffolding will create regressions faster than the team can reason about them.
- **Scope**:
  - Add test harness for main routes and state permutations.
  - Cover dashboard, predictions, track record, auth gate, Pro gate.
- **Out of scope**:
  - Full visual snapshot matrix.
- **Dependencies**: SPF-FND-002
- **Acceptance criteria**:
  - Critical routes have baseline automated coverage.
  - Main user states can be simulated.
- **Risks / notes**:
  - Avoid slow, brittle tests; favor critical-path coverage.
- **Owner suggestion**: frontend / QA
- **Blocking type**: FOUNDATION_ENABLER

### Ticket ID: SPF-QA-002
- **Priority**: P0
- **Title**: Fix DetailPanel overlay behavior for iOS-safe rendering
- **Why**: Current fixed/backdrop behavior is a known mobile risk and undermines confidence in route/shell modernization.
- **Scope**:
  - Rework DetailPanel overlay rendering.
  - Use portal-safe approach if needed.
  - Validate mobile behavior.
- **Out of scope**:
  - General modal system redesign unless directly required.
- **Dependencies**: None.
- **Acceptance criteria**:
  - DetailPanel works on target mobile browsers without overlay breakage.
  - Scroll/stacking/backdrop behavior is stable.
- **Risks / notes**:
  - Coordinate with shell-level overlay conventions.
- **Owner suggestion**: frontend
- **Blocking type**: PARALLELIZABLE

### Ticket ID: SPF-QA-003
- **Priority**: P0
- **Title**: Restore or redesign treemap visibility on HomePortal narrow layouts
- **Why**: Treemap is a core dashboard surface and cannot disappear or become useless in responsive contexts.
- **Scope**:
  - Diagnose current visibility problem.
  - Apply responsive rendering fix or alternate layout treatment.
- **Out of scope**:
  - New treemap semantics.
- **Dependencies**: None.
- **Acceptance criteria**:
  - Treemap is visible and understandable on supported responsive states.
  - No silent disappearance of the main dashboard asset.
- **Risks / notes**:
  - Do not solve by burying treemap behind hidden navigation.
- **Owner suggestion**: frontend
- **Blocking type**: PARALLELIZABLE

### Ticket ID: SPF-QA-004
- **Priority**: P1
- **Title**: Add automated journey coverage for anonymous → auth → Pro upgrade path
- **Why**: The highest-value commercial path must not rely on manual testing.
- **Scope**:
  - Simulate anonymous entry.
  - Simulate auth gate.
  - Simulate non-Pro paywall.
  - Simulate Pro unlock state.
- **Out of scope**:
  - Real external payment integration in end-to-end tests.
- **Dependencies**: SPF-QA-001, SPF-AUTH-003, SPF-PRO-002
- **Acceptance criteria**:
  - Automated journey verifies the expected gated transitions.
- **Risks / notes**:
  - Use deterministic mocks for auth/billing return states.
- **Owner suggestion**: frontend / QA
- **Blocking type**: LAUNCH_BLOCKER

### Ticket ID: SPF-QA-005
- **Priority**: P1
- **Title**: Add automated coverage for Pro ad suppression behavior
- **Why**: Pro ad suppression is a product contract and must be verified explicitly.
- **Scope**:
  - Test free user with active ad slot.
  - Test Pro user with active ad slot.
  - Test operational notice unaffected.
- **Out of scope**:
  - Third-party ad network QA.
- **Dependencies**: SPF-PRO-004, SPF-QA-001
- **Acceptance criteria**:
  - Commercial ad slots do not render for Pro users.
  - Operational notices still render when active.
- **Risks / notes**:
  - Requires semantic slot classification, not CSS hacks.
- **Owner suggestion**: frontend / QA
- **Blocking type**: LAUNCH_BLOCKER

## Stream 6 — Experience/theming foundation

### Ticket ID: SPF-EXP-001
- **Priority**: P1
- **Title**: Tokenize critical surfaces for Level A style safety
- **Why**: Controlled theme evolution is not credible until critical surfaces are tokenized and style-safe by contract.
- **Scope**:
  - Apply semantic tokens to the critical-surface set:
    - app shell,
    - primary navigation,
    - competition context controls,
    - dashboard containers,
    - treemap wrapper/surrounds,
    - detail panel,
    - match cards,
    - prediction cards/blocks,
    - track record surfaces,
    - paywall surfaces,
    - notices/announcement bar.
  - Replace raw hardcoded visual values in those surfaces except documented exceptions.
  - Produce or update the active critical-surface inventory used by design-system rollout tracking.
- **Out of scope**:
  - Full active-product tokenization.
  - Future/deferred surfaces not yet in active product footprint.
- **Dependencies**: SPF-FND-005
- **Acceptance criteria**:
  - Every critical surface consumes semantic tokens.
  - No raw hex values remain in critical surfaces except documented exceptions.
  - Theme swap changes critical surfaces without per-component edits.
  - Level A style safety can be asserted with evidence.
- **Risks / notes**:
  - Do not let this turn into a full redesign pass.
  - This ticket establishes Level A only, not product-wide propagation readiness.
- **Owner suggestion**: frontend
- **Blocking type**: PARALLELIZABLE

### Ticket ID: SPF-EXP-002
- **Priority**: P1
- **Title**: Create global announcement slot in app shell with type-aware rendering
- **Why**: Operational notices and editorial/commercial announcements need a controlled, non-hacky shell placement.
- **Scope**:
  - Add shell slot for announcements/notices.
  - Differentiate rendering classes by announcement type.
- **Out of scope**:
  - Full remote-config announcement orchestration.
- **Dependencies**: SPF-FND-002, SPF-EXP-001
- **Acceptance criteria**:
  - Shell supports controlled announcement rendering.
  - Type-aware rendering prevents conflating operational notices with commercial banners.
- **Risks / notes**:
  - Keep precedence rules aligned to announcement-system spec.
- **Owner suggestion**: frontend
- **Blocking type**: PARALLELIZABLE

### Ticket ID: SPF-EXP-003
- **Priority**: P2
- **Title**: Implement minimal site-experience-config consumption for active theme and announcement set
- **Why**: Future seasonal themes and global messaging should not require broad hardcoded changes.
- **Scope**:
  - Add minimal config consumption path for active theme and announcements.
  - Provide fallback behavior.
- **Out of scope**:
  - Full remote config service.
  - Advanced targeting.
- **Dependencies**: SPF-EXP-001, SPF-EXP-002
- **Acceptance criteria**:
  - Active theme and announcements can be derived from a single config source.
  - Missing config falls back safely.
- **Risks / notes**:
  - Keep v1 pragmatic; avoid overbuilding config runtime.
- **Owner suggestion**: frontend / shared
- **Blocking type**: NICE_TO_HAVE

### Ticket ID: SPF-EXP-004
- **Priority**: P2
- **Title**: Complete full active-surface tokenization for Level B style propagation readiness
- **Why**: The product cannot honestly claim that a global style change propagates everywhere until all active surfaces are tokenized or explicitly excepted.
- **Scope**:
  - Extend token adoption from Level A critical surfaces to the full active product surface inventory.
  - Cover auth/session surfaces, Pro page surfaces, loading/empty/error/degraded states, and remaining ancillary active panels.
  - Eliminate undocumented raw visual values from active product surfaces.
  - Close or explicitly register all remaining style exceptions.
- **Out of scope**:
  - Future/deferred routes and speculative surfaces.
  - White-label or advanced targeting.
- **Dependencies**: SPF-EXP-001, SPF-EXP-002, SPF-EXP-003
- **Acceptance criteria**:
  - Full active surface inventory is tokenized or documented as approved exceptions.
  - No undocumented raw visual values remain in active product surfaces.
  - Theme swap propagates across the active product without per-surface manual patching.
  - Level B style propagation readiness can be asserted.
- **Risks / notes**:
  - This is where the stronger promise becomes real; do not claim it before this ticket closes.
- **Owner suggestion**: frontend
- **Blocking type**: FOUNDATION_ENABLER

### Ticket ID: SPF-SPEC-001
- **Priority**: P1
- **Title**: Align frontend implementation notes with design-system/theme/config spec package
- **Why**: The new spec package must become actionable implementation guidance, not detached documentation.
- **Scope**:
  - Cross-link implementation notes.
  - Mark adoption targets in code comments or engineering notes where useful.
- **Out of scope**:
  - Design-system rollout across all components.
- **Dependencies**: SPF-EXP-001
- **Acceptance criteria**:
  - New specs are referenced from the active frontend work context.
- **Risks / notes**:
  - Keep documentation additive and low-friction.
- **Owner suggestion**: shared
- **Blocking type**: NICE_TO_HAVE

---

## 5. Phase plan

### Phase 0 — Formalization and backbone
**Objective**: Establish the route, data, and documentation backbone so later work lands cleanly.

**Included tickets**:
- SPF-FND-001
- SPF-FND-002
- SPF-FND-003
- SPF-FND-006
- SPF-QA-001

**Exit criteria**:
- Central API client exists.
- Core routes exist.
- Competition registry is externalized.
- Stale-doc risk is labeled.
- Baseline route test harness exists.

**Unlocks**:
- Track record route.
- Auth shell integration.
- Paywall route/context work.

### Phase 1 — Shell stabilization and public trust surface
**Objective**: Make the product navigable as a real product and expose track record publicly.

**Included tickets**:
- SPF-FND-004
- SPF-FND-005
- SPF-TRK-001
- SPF-TRK-002
- SPF-TRK-003
- SPF-TRK-004
- SPF-QA-002
- SPF-QA-003

**Exit criteria**:
- Surface-first shell is functioning.
- Track record is publicly reachable.
- Responsive high-risk defects are fixed.

**Unlocks**:
- Clean auth entry points.
- Pro value story with public trust surface visible.

### Phase 2 — Auth and session foundation
**Objective**: Introduce minimal identity without violating anonymous-first UX.

**Included tickets**:
- SPF-AUTH-001
- SPF-AUTH-002
- SPF-AUTH-003
- SPF-AUTH-004

**Exit criteria**:
- Session model exists.
- Shell auth state exists.
- Deferred auth can start from gated actions.

**Unlocks**:
- In-context Pro gate.
- Post-checkout entitlement refresh.

### Phase 3 — Pro monetization contract
**Objective**: Implement the actual commercial behavior of the product.

**Included tickets**:
- SPF-PRO-001
- SPF-PRO-002
- SPF-PRO-003
- SPF-PRO-004
- SPF-PRO-005
- SPF-QA-004
- SPF-QA-005

**Exit criteria**:
- Pro-depth is gated correctly.
- Checkout return restores entitlement in-session.
- Commercial ads are suppressed for Pro.
- Critical monetization path is tested.

**Unlocks**:
- General-public product launch readiness.

### Phase 4 — Experience foundation and Level A style safety
**Objective**: Prepare safe theme/announcement/config capability and reach critical-surface style safety without overbuilding.

**Included tickets**:
- SPF-EXP-001
- SPF-EXP-002
- SPF-EXP-003
- SPF-SPEC-001

**Exit criteria**:
- Level A critical surfaces are tokenized.
- Announcement slot exists.
- Minimal site-experience-config consumption path exists.
- Controlled theme change works across critical surfaces.

**Unlocks**:
- Seasonal themes on critical surfaces.
- Global notices.
- Controlled visual evolution without critical-surface patching.

### Phase 5 — Full active-surface style propagation readiness
**Objective**: Extend token safety from critical surfaces to the full active product footprint.

**Included tickets**:
- SPF-EXP-004
- SPF-QA-006

**Exit criteria**:
- Active product surface inventory is closed.
- Remaining exceptions are documented and bounded.
- K-08 or equivalent style-propagation readiness verification passes.

**Unlocks**:
- Honest claim that global style changes propagate across the active product.

---

## 6. Dependency map

- SPF-FND-002 depends on no prior app architecture changes and should start immediately.
- SPF-FND-003 depends on SPF-FND-002 because competition registry should align to route/shell model.
- SPF-FND-004 depends on SPF-FND-002 because shared state must support route-driven shell behavior.
- SPF-FND-005 depends on SPF-FND-002 and SPF-FND-004 because App.tsx refactor should land on top of route and shell state foundations.
- SPF-TRK-001 can start once route architecture direction is fixed; it does not depend on auth.
- SPF-TRK-002 depends on SPF-TRK-001, SPF-FND-001, SPF-FND-002, and backend endpoint availability.
- SPF-TRK-003 depends on SPF-TRK-002 because shell placement should point to an existing surface.
- SPF-AUTH-001 depends on SPF-FND-001 because session access should use the canonical client path.
- SPF-AUTH-002 depends on SPF-AUTH-001 and on shell foundations from SPF-FND-002 and SPF-FND-004.
- SPF-AUTH-003 depends on SPF-AUTH-001 and SPF-AUTH-002 because deferred auth requires shell session state.
- SPF-PRO-001 can start before auth implementation because it is a UI contract definition ticket.
- SPF-PRO-002 depends on SPF-PRO-001, SPF-AUTH-002, and SPF-AUTH-003.
- SPF-PRO-003 depends on SPF-AUTH-002 and SPF-PRO-002 plus backend checkout capability.
- SPF-PRO-004 depends on entitlement-aware session state; it should not land before Pro state exists.
- SPF-QA-001 should start in Phase 0 because later refactor/test coverage depends on it.
- SPF-QA-004 depends on SPF-AUTH-003 and SPF-PRO-002 because it validates that full gated journey.
- SPF-QA-005 depends on SPF-PRO-004 because ad suppression cannot be tested before it exists.
- SPF-EXP-001 depends on foundational shell/component cleanup; do not start it as a product-wide redesign.
- SPF-EXP-002 depends on SPF-EXP-001 because announcement slots should use semantic shell primitives.
- SPF-EXP-003 depends on SPF-EXP-001 and SPF-EXP-002 because config should drive already-existing theme/announcement hooks.
- SPF-EXP-004 depends on SPF-EXP-001, SPF-EXP-002, and SPF-EXP-003 because product-wide propagation cannot be asserted before critical surfaces, shell announcement hooks, and minimal config path exist.
- SPF-QA-006 depends on SPF-EXP-004 because product-wide style propagation readiness is not testable before the full active-surface pass exists.

---

## 7. Temporary assumptions

### TA-01 — Session transport assumption
Assume session-backed web auth with secure cookie/session endpoint pattern.

Why acceptable temporarily:
- aligns with current direction without forcing backend implementation details into frontend.

Final decision replacement:
- backend auth implementation details can refine transport while preserving session semantics.

### TA-02 — Track record route placement assumption
Assume track record is a top-level primary surface in the shell.

Why acceptable temporarily:
- aligns with public trust requirement and avoids burying the moat.

Final decision replacement:
- only replace if product-owner explicitly repositions it without violating public visibility.

### TA-03 — Primary Pro trigger assumption
Assume the first Pro trigger is expansion/opening of the prediction depth block.

Why acceptable temporarily:
- aligns to the accepted inline intent-triggered paywall model.

Final decision replacement:
- additional Pro entry points may be added later, but not as hard gates on public value surfaces.

### TA-04 — Ads assumption
Assume commercial display ads may exist in free tier and are suppressed for Pro.

Why acceptable temporarily:
- establishes a clean commercial rule without needing ad-network detail.

Final decision replacement:
- ad slot strategy may be refined later without changing the core tier rule.

### TA-05 — Theme/config assumption
Assume theme and announcement changes can be driven by a minimal config source, with safe defaults if missing.

Why acceptable temporarily:
- supports future evolution without requiring remote config overbuild now.

Final decision replacement:
- a stronger remote-config strategy can replace the minimal source later.

---

## 8. Specs to create or update

### Create
- `spec.sportpulse.web.auth-and-freemium-surface.md`
- `spec.sportpulse.web.navigation-and-shell-architecture.md`
- `spec.sportpulse.web.frontend-modernization.md`
- `spec.sportpulse.web.design-system-foundation.md`
- `spec.sportpulse.web.theme-and-global-announcement-system.md`
- `spec.sportpulse.web.site-experience-config.md`
- `spec.sportpulse.web.future-experience-roadmap.md`

### Update
- `spec.sportpulse.qa.acceptance-test-matrix.md`
  - Add K-07 for Pro commercial ad suppression.
- Any active frontend architecture doc that still claims obsolete routing or framework assumptions.

### Mark stale / correct
- Any stale doc describing obsolete frontend architecture not matching current SPA/web reality.
- Any internal note implying auth is required for public track record.
- Any internal note implying Pro is route-level access instead of inline depth gating.

---

## 9. Anti-actions

Do not do these now:

1. Do not start a full visual redesign before shell/foundation work lands.
2. Do not block all engineering until auth is fully implemented.
3. Do not make public track record dependent on login.
4. Do not introduce route-level hard paywalls for public prediction surfaces.
5. Do not add password auth or social login in v1.
6. Do not turn theme/config work into a CMS or remote-config platform project.
7. Do not mix operational notices with commercial ad logic.
8. Do not expose Pro values in hidden DOM for free users.
9. Do not use App.tsx as the long-term orchestration center.
10. Do not inflate Pro with speculative perks before core Pro value is working.

---

## 10. Final execution recommendation

### What should start first
Start immediately with:
- SPF-FND-001
- SPF-FND-002
- SPF-FND-003
- SPF-QA-001
- SPF-TRK-001

This gives the team a stable execution backbone and starts the public trust surface without waiting on auth.

### What should be delegated immediately
- Frontend engineer/agent: SPF-FND-001 / 002 / 003
- Frontend + product pairing: SPF-TRK-001
- QA-focused agent: SPF-QA-001
- Spec/documentation steward: SPF-FND-006 and acceptance-matrix update prep

### What must wait a little
- Full paywall implementation until session model and deferred auth entry exist.
- Ad suppression until Pro entitlement is actually represented in-session.
- Theme/config runtime refinements until shell primitives and token adoption are in place.

### What success looks like in the next execution slice
Success in the next slice means:
- route-based shell exists,
- competition registry is externalized,
- API client is centralized,
- baseline UI test harness exists,
- public track record surface contract is defined,
- and the team is no longer building on top of App.tsx hardcoding.

That is the correct transition from analysis to controlled execution.
