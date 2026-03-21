---
artifact_id: AUDIT-SPORTPULSE-FRONTEND-PRODUCT-SURFACE-GAP-ANALYSIS
title: "Frontend Product Surface Gap Analysis"
artifact_class: audit
status: final
version: 0.1.0
project: sportpulse
domain: web
owner: architect
created_at: 2026-03-20
auditor: architect (Opus)
scope: Structural risk assessment and modernization preconditions for packages/web
governing_specs:
  - SPEC-SPORTPULSE-CORE-CONSTITUTION (v2.0) -- Constitution ss3.1, ss25
  - SPEC-SPORTPULSE-CORE-MVP-EXECUTION-SCOPE (v2.0) -- ss4-7, ss5.6, ss5.7, ss9, ss17
  - SPEC-SPORTPULSE-WEB-FRONTEND-ARCHITECTURE (v1.1) -- ss2-4, ss7
  - SPEC-SPORTPULSE-WEB-UI (v1.1) -- ss2-7
  - SPEC-SPORTPULSE-PRODUCT-FEATURE-EVOLUTION (v1.0) -- ss2-3
---

# Frontend Product Surface Gap Analysis -- Formal Audit Report

Sections 7.7, 7.8, 11, 12

Auditor: Architect Agent (Opus)
Date: 2026-03-20
Input: Exhaustive frontend inventory (63 components, 19 endpoints, 10 competitions, zero auth, zero monetization)

---

## 7.7 STRUCTURAL RISK REGISTER

---

### RISK-01: Competition Routing Hardcoding

```
Riesgo: COMPETITION_ROUTING_HARDCODING
Descripcion: All competition routing is hardcoded in App.tsx via explicit competitionId guards
Causa: Original frontend architecture spec (v1.1 ss3) scoped MVP to "single competition enabled". The product outgrew this to 10 competitions without refactoring the routing model.
Impacto probable: Adding competition N+1 requires editing App.tsx guards, Navbar items, HomePortal sections, and LiveCarousel filters. Each addition increases cyclomatic complexity and introduces silent regression risk (forgotten guard = broken view).
Severidad: high
Accion recomendada: Extract competition routing to a data-driven registry. Route pattern becomes /:competitionId/* with a single resolution layer. App.tsx drops from ~15 useState to a CompetitionContext provider.
Clasificacion: STRUCTURAL_COUPLING
```

---

### RISK-02: State Model Fragmentation

```
Riesgo: STATE_MODEL_FRAGMENTATION
Descripcion: App.tsx holds ~15 independent useState hooks (competitionId, matchday, view, subTournamentKey, standingsFocusId, tournamentFocusId, tvTab, hasLiveMatches) with no centralized store or context hierarchy.
Causa: Organic growth from single-competition MVP to multi-competition portal without introducing a state management layer.
Impacto probable: (a) Props drill 3-5 levels deep to leaf components, making refactors fragile. (b) State synchronization bugs when two useState hooks must change atomically (e.g., competitionId + subTournamentKey). (c) No way to persist or restore user session beyond theme in localStorage. (d) URL state is decoupled from React state -- deep links are not possible for most views.
Severidad: high
Accion recomendada: Introduce a lightweight global store (Zustand or React Context with reducer) that owns navigation-level state (competition, matchday, view, subTournament). Keep component-local state for ephemeral UI only. Wire URL params to store for shareable deep links.
Clasificacion: STATE_MODEL_GAP
```

---

### RISK-03: Zero User Authentication

```
Riesgo: ZERO_USER_AUTH
Descripcion: The portal has no user identity layer. Admin auth exists (ADMIN_SECRET in React state) but is not a user auth system.
Causa: MVP Execution Scope (v2.0 ss9.4) excluded "multi-tenant enterprise controls" and the original frontend architecture (v1.1 ss3) listed auth as out of scope.
Impacto probable: (a) Freemium paywall (Constitution ss3.1: "1X2 free / depth Pro-only") cannot be implemented without user identity. (b) Track record personalization (per-user prediction history) is impossible. (c) MVP Execution Scope ss4.7 states "freemium conversion surface" is an MVP goal and ss17 note says "Pro tier monetization is a Day-1 concern, not a post-MVP question." Without auth, this goal is structurally blocked.
Severidad: critical
Accion recomendada: Define the auth model (anonymous-first with optional signup, OAuth, or magic link). This is a product decision that must precede any frontend implementation. The frontend needs: auth context provider, token storage, route guards for Pro content, and an unauthenticated fallback that still renders free content.
Clasificacion: MISSING_SURFACE
```

---

### RISK-04: Zero Monetization Surface

```
Riesgo: ZERO_MONETIZATION_SURFACE
Descripcion: No paywall, no Stripe integration, no subscription management, no tier differentiation in the UI.
Causa: Auth (RISK-03) is a hard prerequisite. Without user identity, there is no entity to attach a subscription to.
Impacto probable: Constitution ss3.1 and MVP Scope ss5.6 define a freemium split: free users see 1X2 probabilities; Pro users see scoreline distribution, xG, derived markets, historical accuracy. None of this gating exists. The product currently gives away everything or nothing. MVP Scope ss17 note is explicit: "The funnel architecture must be in place before the product goes to general users."
Severidad: critical
Accion recomendada: (1) Resolve auth model first. (2) Define paywall trigger points (which components, which data fields). (3) Implement a PaywallGate component that wraps Pro-only sections. (4) Integrate payment provider. This is a multi-sprint effort that cannot start until RISK-03 is resolved.
Clasificacion: MONETIZATION_GAP
```

---

### RISK-05: Missing Public Track Record Surface

```
Riesgo: MISSING_TRACK_RECORD_SURFACE
Descripcion: MVP Scope ss5.7 requires a publicly visible track record (accuracy %, count, last updated). No such surface exists in the 63-component inventory. Labs pages exist but are internal and not linked from navigation.
Causa: Predictive Engine shipped recently; the focus was on engine correctness, not on the public-facing display.
Impacto probable: The track record is defined as "the core competitive asset" (MVP Scope ss3). Without a public surface, the product cannot build trust or differentiate from competitors. The 200-prediction publication threshold (ss5.7) is a backend concern, but the frontend must have the rendering surface ready before that threshold is reached.
Severidad: high
Accion recomendada: Create a TrackRecordSection component (or dedicated view) that displays per-competition accuracy aggregate from a backend endpoint. Gate numeric accuracy display behind the 200-prediction threshold. Include walk-forward disclosure when showing historical data.
Clasificacion: MISSING_SURFACE
```

---

### RISK-06: Zero UI Test Coverage

```
Riesgo: ZERO_UI_TEST_COVERAGE
Descripcion: No component unit tests, no snapshot tests, no Storybook, no visual regression testing for the 63 .tsx files in packages/web.
Causa: Development velocity prioritized feature delivery. The backend pipeline has strong test coverage (2141 tests); the frontend has none.
Impacto probable: (a) Any refactor (state management, routing, design system) has no safety net. (b) Responsive regressions are only caught by manual testing. (c) Theme (night/day) regressions are invisible. (d) The larger the frontend grows, the more expensive this debt becomes to repay.
Severidad: high
Accion recomendada: Phase 1: Add Vitest + React Testing Library for critical path components (LiveCarousel, DetailPanel, TreemapTile, Navbar). Phase 2: Add Storybook for design system components. Phase 3: Visual regression with Chromatic or Percy for responsive/theme matrix.
Clasificacion: TESTABILITY_GAP
```

---

### RISK-07: Navbar Collapse Under Competition Growth

```
Riesgo: NAVBAR_COLLAPSE
Descripcion: Navbar renders competition items as a flat horizontal list. With 10 competitions already and potential growth, the navigation will overflow or compress to unreadable sizes on both mobile and desktop.
Causa: Original design assumed 3-4 competitions (PD, PL, BL1, URU). The portal now serves 10.
Impacto probable: (a) Mobile: horizontal overflow or hamburger menu that hides all competitions behind a tap. (b) Desktop: items shrink or wrap, breaking visual hierarchy. (c) Adding Copa Sudamericana, Serie A, Ligue 1, or any new competition makes this worse with each addition.
Severidad: medium
Accion recomendada: Redesign navigation as a two-level structure: primary nav (views: home, partidos, standings, pronosticos) + secondary nav (competition selector as dropdown or segmented control). This decouples view navigation from competition selection.
Clasificacion: NAVIGATION_COLLAPSE_RISK
```

---

### RISK-08: API Client Without Abstraction Layer

```
Riesgo: API_CLIENT_NO_ABSTRACTION
Descripcion: 19 endpoints are consumed via raw fetch() in individual hooks. No shared error handling, no retry logic, no request deduplication, no cache layer. AbortController exists only in useDashboardSnapshot.
Causa: Incremental feature addition -- each hook was written independently.
Impacto probable: (a) A transient network error on any endpoint produces an unhandled rejection or silent failure. (b) Rapid navigation can fire duplicate requests for the same data. (c) Adding auth tokens later requires touching all 19 hooks. (d) No centralized place to add request logging, latency tracking, or offline fallback.
Severidad: medium
Accion recomendada: Extract a thin API client module (apiClient.get/post with base URL, error normalization, optional retry, and auth header injection point). Refactor hooks to use this client. This is a prerequisite for auth (RISK-03) because every authenticated request needs a token header.
Clasificacion: STRUCTURAL_COUPLING
```

---

### RISK-09: Partial Design System Tokens

```
Riesgo: PARTIAL_DESIGN_SYSTEM
Descripcion: ~30 CSS custom properties exist for theming. Tailwind extend config is coherent but incomplete. No formal design token layer (no JSON, no Style Dictionary, no Figma sync). Dark/light theming works via CSS vars but color semantics are not documented.
Causa: Theming was implemented pragmatically. No design system spec exists.
Impacto probable: (a) New components may use raw hex values instead of tokens, creating theme inconsistencies. (b) A third theme (e.g., high contrast, AMOLED) requires auditing all 63 components. (c) Without a documented token contract, frontend contributors (human or AI) make inconsistent color/spacing choices.
Severidad: medium
Accion recomendada: (1) Document existing ~30 tokens as the canonical token set. (2) Add lint rule or Tailwind plugin that flags raw hex/rgb in component files. (3) Extend tokens to cover spacing, typography scale, and elevation consistently. A full Style Dictionary migration is not required for MVP but the documentation step is.
Clasificacion: THEME_SYSTEM_DEBT
```

---

### RISK-10: Prediction Surface Split (Labs vs Production)

```
Riesgo: PREDICTION_SURFACE_SPLIT
Descripcion: Prediction-related UI is split between production components (PredictionExperimentalSection, RadarSection) and internal Labs pages (evaluation, historical, training). The Labs pages are not linked from Navbar and serve a different audience (developers, not users). The production prediction surface lacks the track record view and the Pro-depth gating defined in MVP Scope ss5.6.
Causa: PE development prioritized engine correctness. The frontend surface was added incrementally with an "experimental" label.
Impacto probable: (a) Users see predictions but have no way to evaluate model credibility (no track record). (b) The "experimental" framing undermines trust. (c) Labs pages contain useful visualizations that will never reach users without a deliberate promotion path.
Severidad: medium
Accion recomendada: (1) Promote PredictionExperimentalSection to a first-class PredictionSection (remove "experimental" qualifier). (2) Add TrackRecordSection (RISK-05). (3) Define which Labs visualizations, if any, should graduate to Pro-only user-facing content. (4) Gate Pro content behind PaywallGate when auth exists.
Clasificacion: PARTIAL_SURFACE
```

---

### RISK-11: Responsive Compression vs Restructuring

```
Riesgo: RESPONSIVE_COMPRESSION
Descripcion: Mobile responsiveness is achieved primarily by compressing desktop layouts (smaller fonts, hidden columns, overflow-x-auto on tables) rather than restructuring information architecture for mobile-first consumption. useWindowWidth() exists but is used as a visibility toggle, not as an IA restructuring signal.
Causa: CLAUDE.md mandates mobile-first but the actual implementation pattern is desktop-first with mobile compression -- a common anti-pattern when mobile support is retrofitted.
Impacto probable: (a) Complex views (standings tables, detail panels with multiple sections) become cramped on small screens. (b) Touch targets may fall below 44px in dense areas. (c) As more data surfaces are added (predictions, track record, Pro content), the compression approach scales poorly.
Severidad: medium
Accion recomendada: For new surfaces (track record, prediction detail, paywall), design mobile-first with dedicated mobile layouts. For existing surfaces, audit touch targets and information density on 375px viewport. Restructure standings and detail panels to use vertical stacking on mobile instead of horizontal compression.
Clasificacion: RESPONSIVE_DEBT
```

---

### RISK-12: No Lazy Loading or Code Splitting

```
Riesgo: NO_CODE_SPLITTING
Descripcion: All 63 components are bundled into a single entry point. No React.lazy, no route-based splitting, no dynamic imports. Labs pages (which most users never visit) and Admin pages are included in the main bundle.
Causa: Vite handles bundling efficiently enough that performance has not been a visible problem yet. No deliberate optimization pass has occurred.
Impacto probable: (a) Initial bundle size grows linearly with feature additions. (b) Admin and Labs code ships to all users. (c) As prediction surfaces, track record, and paywall components are added, the bundle will cross the threshold where loading time degrades mobile experience on slower connections.
Severidad: low
Accion recomendada: Add route-based code splitting for /admin, /labs, and /eventos. Use React.lazy + Suspense. This is straightforward with Vite and can be done independently of other refactors.
Clasificacion: STRUCTURAL_COUPLING
```

---

### RISK-13: Component Fragmentation Without Composition Contracts

```
Riesgo: COMPONENT_FRAGMENTATION
Descripcion: 63 .tsx files with no documented component hierarchy, no prop interface catalog, no composition contracts between container and presentational components.
Causa: Components were created per-feature without a component architecture guide.
Impacto probable: (a) Duplicate UI patterns across components (e.g., match card rendering in LiveCarousel vs MatchCardList vs EventCard). (b) Inconsistent prop naming conventions. (c) Difficult to identify which components are reusable vs page-specific. (d) A redesign cannot safely determine which components to keep, merge, or replace.
Severidad: low
Accion recomendada: Create a component inventory document that classifies each component as: layout shell, page, section, card, primitive, or utility. Identify duplicated patterns. This inventory is a prerequisite for any design system or shell redesign.
Clasificacion: COMPONENT_FRAGMENTATION
```

---

## 7.8 MODERNIZATION PRECONDITIONS

Before any systemic frontend redesign can begin, the following must be true.

---

### PRECOND-01: Information Architecture Clarification

```
Precondicion: IA_CLARIFICATION
Estado actual: not clarified
Bloqueante: si
Accion requerida: Define the product information architecture formally. Currently the IA is implicit in App.tsx ViewMode enum (home, tv, partidos, standings, pronosticos) plus a competition selector. Questions that must be answered: (a) Is the primary navigation axis "view type" or "competition"? (b) Should predictions be a top-level view or a section within match detail? (c) Where does the track record live -- standalone page, tab within pronosticos, or always-visible widget? (d) How do free vs Pro users experience the same IA? Without answers, any shell redesign is speculative.
```

---

### PRECOND-02: Auth Model Clarification

```
Precondicion: AUTH_MODEL_CLARIFICATION
Estado actual: missing
Bloqueante: si
Accion requerida: Choose an auth strategy. Options: (a) anonymous-first with optional email signup, (b) OAuth-only (Google/Apple), (c) magic link, (d) hybrid. Define: token storage (httpOnly cookie vs localStorage), session lifetime, refresh strategy, and what happens to an unauthenticated user viewing Pro-gated content. This decision affects every component that will need to conditionally render free vs Pro content.
```

---

### PRECOND-03: Paywall Flow Clarification

```
Precondicion: PAYWALL_FLOW_CLARIFICATION
Estado actual: missing
Bloqueante: si (for monetization surfaces only)
Accion requerida: Define: (a) which exact prediction fields trigger the paywall (MVP Scope ss5.6 says scoreline distribution, xG, derived markets, per-team historical accuracy), (b) the UI pattern for the paywall (blur + CTA overlay, modal, redirect to pricing page), (c) payment provider (Stripe, Mercado Pago, both), (d) whether free users see a teaser of Pro content or just a locked icon. This is a product design decision, not a frontend engineering decision.
```

---

### PRECOND-04: Shell Redesign Requirements

```
Precondicion: SHELL_REDESIGN_REQUIREMENTS
Estado actual: not clarified
Bloqueante: si (for navigation refactor)
Accion requerida: The current shell (Navbar + App.tsx ViewMode routing) must be redesigned to support: (a) growing competition count, (b) auth state in header, (c) Pro badge/upgrade CTA, (d) deep linkable routes. Before implementation, produce a wireframe or spec that defines the shell layout for mobile and desktop, including the competition selector pattern, the view navigation pattern, and the auth/profile widget placement. Depends on PRECOND-01 (IA).
```

---

### PRECOND-05: Design System Foundation

```
Precondicion: DESIGN_SYSTEM_FOUNDATION
Estado actual: clarified (partial -- tokens exist but undocumented)
Bloqueante: no (for incremental work), si (for systemic redesign)
Accion requerida: Document the existing ~30 CSS custom properties as the v1.0 token set. Add semantic aliases (e.g., --color-surface-primary, --color-text-muted) if not already present. This does not require Style Dictionary or Figma -- just a markdown spec that names and constrains the tokens. New components and redesigned components must reference this spec. Existing components are grandfathered until touched.
```

---

### PRECOND-06: Component Inventory and Classification

```
Precondicion: COMPONENT_INVENTORY
Estado actual: not clarified
Bloqueante: no (for new features), si (for shell redesign)
Accion requerida: Classify all 63 .tsx files into: shell (2-3), page (5-7), section (15-20), card (10-15), primitive (10-15), utility/hook (remaining). Identify duplication. Identify which components are candidates for replacement vs preservation in a redesign. This is a one-time analysis task, not an ongoing process.
```

---

### PRECOND-07: Route Architecture Clarification

```
Precondicion: ROUTE_ARCHITECTURE
Estado actual: not clarified
Bloqueante: si (for competition scaling)
Accion requerida: Define whether the app uses: (a) react-router with URL params (/:competition/:view), (b) continues with ViewMode enum + state, or (c) a hybrid. URL-based routing is required for deep linking (MVP Scope ss5.5), shareable state, and SEO. The current approach (state-only routing) cannot support deep links, browser back/forward, or bookmarkable views. This decision must be made before the shell redesign.
```

---

### PRECOND-08: State Management Approach

```
Precondicion: STATE_MANAGEMENT_APPROACH
Estado actual: not clarified
Bloqueante: no (for new features), si (for shell redesign)
Accion requerida: Decide between: (a) Zustand (minimal, recommended for this scale), (b) React Context + useReducer (no dependency), (c) Jotai/Recoil (atomic). The choice must support: navigation state synchronization, URL param binding, auth state, and portal config. The decision is low-stakes (all options work) but must be made once to avoid fragmentation.
```

---

### PRECOND-09: Runtime and Storage Clarification

```
Precondicion: RUNTIME_STORAGE
Estado actual: clarified (partial)
Bloqueante: no
Accion requerida: Currently the frontend is a pure SPA served by Vite (dev) and Fastify static (prod). The frontend architecture spec (v1.1 ss4) mentions Next.js App Router -- this is stale and does not reflect reality. Clarify: (a) the SPA model is intentional and will continue, (b) SSR is not planned for MVP, (c) localStorage is acceptable for theme + optional session persistence. Update the frontend architecture spec to match reality.
```

---

## 11. VEREDICTO FINAL

---

### Verdict

**BLOCK_PENDING_FOUNDATIONS**

### Reason

The frontend successfully delivers the dashboard, treemap, team detail, and explainability surfaces defined in MVP Execution Scope ss5.1-5.5. These surfaces work, are responsive, and degrade gracefully under stale data. The backend pipeline (2141 tests, 8 packages, deterministic snapshot engine) is solid.

However, two MVP goals are structurally blocked by missing foundations:

1. **Freemium conversion surface** (MVP Scope ss4.7, ss5.6, ss17 note): requires auth + paywall. Neither exists. The Constitution (ss3.1) defines "freemium tier separation: 1X2 free / depth Pro-only" as a core product pillar. The MVP Scope is unambiguous: "Pro tier monetization is a Day-1 concern, not a post-MVP question. The funnel architecture must be in place before the product goes to general users."

2. **Public track record** (MVP Scope ss5.7): requires a user-facing rendering surface that does not exist. The track record is described as "the core competitive asset" (ss3). Labs pages are internal and do not satisfy this requirement.

Additionally, the state management model (15 useState in App.tsx) and hardcoded competition routing create compounding structural risk that will make implementing the above foundations significantly more expensive if not addressed first.

The verdict is not REDESIGN_SYSTEMIC because the existing component quality is adequate -- the problem is missing architectural layers (auth, state, routing), not broken existing surfaces. The path forward is to lay foundations, then build the missing surfaces on top.

### Immediate next actions

1. **[PRODUCT DECISION]** Clarify information architecture: primary nav axis, prediction placement, track record placement, free vs Pro experience map. Output: IA wireframe or spec. (Unblocks PRECOND-01)

2. **[PRODUCT DECISION]** Choose auth model: provider (OAuth / magic link / email-pass), token strategy, session lifetime. Output: auth spec addendum to MVP Scope. (Unblocks PRECOND-02)

3. **[PRODUCT DECISION]** Define paywall trigger points and payment provider. Output: paywall flow spec. (Unblocks PRECOND-03)

4. **[ENGINEERING]** Extract API client abstraction layer with error normalization and auth header injection point. Refactor 19 hooks. (Resolves RISK-08; prerequisite for auth integration)

5. **[ENGINEERING]** Introduce route-based navigation (react-router or equivalent) replacing ViewMode state. URL pattern: `/:competition/:view`. (Resolves RISK-01; unblocks PRECOND-07)

6. **[ENGINEERING]** Introduce lightweight global state (Zustand recommended) for navigation-level state. Wire to URL params. (Resolves RISK-02; unblocks PRECOND-08)

7. **[ENGINEERING]** Build TrackRecordSection component consuming a backend track-record endpoint. Gate numeric accuracy behind 200-prediction threshold. (Resolves RISK-05)

8. **[ENGINEERING]** Add component test coverage for critical path (LiveCarousel, DetailPanel, TreemapTile, Navbar) using Vitest + React Testing Library. (Resolves RISK-06 phase 1)

9. **[ENGINEERING]** Document existing CSS tokens as v1.0 design token spec. (Resolves RISK-09 phase 1; unblocks PRECOND-05)

10. **[ENGINEERING]** Add route-based code splitting for /admin, /labs, /eventos. (Resolves RISK-12)

### Deferred items

- Navbar two-level redesign (RISK-07): not blocking until competition count exceeds ~15. Current 10 is manageable with a dropdown selector as interim fix.
- Full Storybook setup (RISK-06 phase 2): useful but not blocking. Can follow after test coverage phase 1.
- Component inventory classification (RISK-13): useful for a future shell redesign but not blocking incremental feature work.
- Responsive restructuring audit (RISK-11): defer until new surfaces (predictions, track record, paywall) are designed -- apply mobile-first correctly on those from the start rather than retrofitting existing surfaces.

---

## 12. FOLLOW-UP ARTIFACTS

### spec.sportpulse.web.frontend-modernization.md

**Recommendation: YES -- create.**

Rationale: The current frontend architecture spec (v1.1) is stale -- it references Next.js App Router, single-competition model, and excludes predictions and auth. A modernization spec is needed to define: the target architecture (SPA with react-router, global state, API client layer, code splitting), the migration path from current state, and the constraints that apply during migration (no breaking existing surfaces). This spec governs items 4-6 and 10 from the immediate next actions.

---

### spec.sportpulse.web.design-system-foundation.md

**Recommendation: YES -- create (lightweight).**

Rationale: A full design system spec is premature, but documenting the existing ~30 CSS tokens, the Tailwind extend config, and the theming contract is necessary to prevent further fragmentation (RISK-09). This can be a single-page spec that names each token, its semantic purpose, and its allowed values per theme. It does not need to be a Style Dictionary migration plan.

---

### spec.sportpulse.web.navigation-and-shell-architecture.md

**Recommendation: YES -- create, but after PRECOND-01 is resolved.**

Rationale: The shell redesign (Navbar, routing, competition selector, auth widget) is the highest-impact structural change. It cannot be specced without IA clarification (PRECOND-01) and auth model clarification (PRECOND-02). Once those product decisions are made, this spec defines the target shell layout, route patterns, and navigation state model. Creating it prematurely would be speculative.

---

### spec.sportpulse.web.auth-and-freemium-surface.md

**Recommendation: YES -- create, but after PRECOND-02 and PRECOND-03 are resolved.**

Rationale: This spec defines the frontend auth flow (login/signup UI, token handling, route guards), the paywall component contract (which sections are gated, what the unauthenticated fallback looks like), and the freemium UX (teaser patterns, upgrade CTAs). It is the most product-dependent spec -- it cannot be written without auth model and paywall flow decisions from product. Once those decisions exist, this spec is mandatory before any auth implementation begins.

---

## Appendix: Spec Compliance Cross-Reference

| MVP Scope Requirement | Section | Frontend Status | Blocking Risk |
|---|---|---|---|
| Dashboard rendering | ss5.1 | DELIVERED | -- |
| Team detail / drill-down | ss5.2 | DELIVERED | -- |
| Explainability surface | ss5.3 | DELIVERED | -- |
| Warning visibility | ss5.4 | DELIVERED | -- |
| Basic navigation state | ss5.5 | PARTIAL (no deep links, no URL state) | RISK-01, RISK-02 |
| Prediction surface (free) | ss5.6 | PARTIAL (experimental label, no track record) | RISK-05, RISK-10 |
| Prediction surface (Pro) | ss5.6 | NOT IMPLEMENTED | RISK-03, RISK-04 |
| Track record visibility | ss5.7 | NOT IMPLEMENTED | RISK-05 |
| Freemium conversion surface | ss4.7 | NOT IMPLEMENTED | RISK-03, RISK-04 |
| Responsive behavior | ss7.3 | DELIVERED (compression model) | RISK-11 |

| Constitution Pillar | Section | Frontend Status |
|---|---|---|
| Freemium tier separation | ss3.1 | NOT IMPLEMENTED |
| Track record accumulation | ss3.1 | Backend exists, frontend surface missing |
| Prediction operating modes | ss3.1 | DELIVERED (mode indicator shown) |

---

End of audit report.
