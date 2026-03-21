# SPF — Frontend Execution Plan for Public Launch

**Date:** 2026-03-20
**Author:** Architect (Opus)
**Status:** Stage 2 — Design Proposal (awaiting product decisions for Streams 3-4)
**Governing specs:** MVP Execution Scope v2.0, Acceptance Test Matrix v1.1 (K-01 through K-06), Frontend Architecture v1.1, Constitution v2.0

---

# 1. Executive verdict

The frontend is production-grade for the attention dashboard pillar but structurally unprepared for the prediction/monetization pillar. Three things block public launch: (1) no user auth/session system, (2) no paywall/Pro gating, (3) no public track record surface. Of these, only track record has zero external dependencies and can ship now. Auth and paywall require product decisions on provider choice and trigger model. The App.tsx monolith (~15 useState, manual pathname routing, no URL state sync) is the single largest source of engineering risk for all remaining work and must be decomposed first.

---

# 2. Corrected interpretation of the audit

## What blocks public launch (all must ship before GA)

- **FACT:** No user authentication or session management exists. K-04 (Pro depth paywall), K-05 (subscription flow), K-06 (registration deferral) are all untestable.
- **FACT:** No paywall or Pro gating exists. The `PredictionExperimentalSection` renders ALL depth fields (scoreline, xG, O/U, BTTS, markets) to every visitor. MVP Exec Scope ss5.6 requires depth to be Pro-only.
- **FACT:** No public track record surface exists. `evaluation-route.ts` is internal-only (gated by `PREDICTION_INTERNAL_VIEW_ENABLED`). K-03 has no public endpoint and no frontend component.
- **FACT:** No `GET /api/ui/track-record` endpoint exists. The `EvaluationStore` has the data; the public endpoint + DTO are missing.

## What does NOT block continued engineering work

- **FACT:** Dashboard, treemap, team detail, explainability, warnings, responsive behavior, dark/light theming — all functional.
- **FACT:** Prediction computation pipeline (PE v3 + NEXUS) operational with 1479/1480 tests passing.
- **FACT:** `EvaluationStore` and `forward-validation-store.ts` contain the raw data needed for track record; only the public surface is missing.
- **FACT:** 8 web test files exist (not zero as the audit states — but coverage is thin, limited to specific components).

## True launch blockers vs parallelizable debt

| Finding | Launch blocker? | Parallelizable? |
|---------|----------------|-----------------|
| Auth/session (RISK-03) | YES | No — requires product decision first |
| Paywall/Pro gating (RISK-04) | YES | No — depends on auth |
| Track record surface (RISK-05) | YES | YES — no auth required |
| App.tsx monolith / routing (RISK-01/02) | NO but high risk | YES — start immediately |
| API client abstraction (RISK-08) | NO but prerequisite for auth | YES — start immediately |
| Test coverage (RISK-06) | NO | YES — start immediately |
| Navbar scalability (RISK-07) | NO | YES |
| Design system tokens (RISK-09) | NO | YES |
| Code splitting (RISK-12) | NO | DEFERRED |

## High-severity findings that can proceed NOW

- SPF-FND-* (foundations): API client, routing, App.tsx decomposition — zero product decisions needed
- SPF-TRK-* (track record): backend endpoint + frontend component — public aggregate data, no auth
- SPF-QA-* (testing): component tests for critical path — zero dependencies

---

# 3. Product-owner decisions required

### Decision 1: Information Architecture — Primary Navigation Hierarchy

**Why it matters:** Current Navbar has 5 tabs (Inicio/TV/Partidos/Tabla/Pronosticos). Track record needs a home. Pro depth surfaces need placement. The IA determines URL structure, which determines the routing refactor scope.

**Options:**
1. **Add "Track Record" as a sub-section of Pronosticos tab** — minimal Navbar change, track record lives at `/pronosticos/track-record` or as a section within the Pronosticos view.
2. **Add a new top-level tab** — "Pronosticos" becomes the parent for both match predictions and track record. Possibly rename to "Predicciones" with sub-navigation.
3. **Track record as a standalone page** — accessible from Pronosticos via a link/card but has its own route `/track-record`.

**Recommendation:** Option 1. Track record is aggregate data that supports the prediction surface — it belongs with Pronosticos. Avoids Navbar growth (RISK-07). Route: `/pronosticos` shows match predictions, scrolling to a "Track Record" section at the bottom or accessible via an anchor.

**Tradeoff:** Less prominent than a top-level tab; may reduce discoverability.

**Temporary assumption:** ASSUMPTION-1 — Track record is a section within the Pronosticos view, not a separate top-level route.

### Decision 2: Auth Model

**Why it matters:** Blocks K-04, K-05, K-06. Determines session persistence, token format, backend middleware, and frontend context shape.

**Options:**
1. **Supabase Auth** — managed auth, supports email/password + OAuth, JWT-based, generous free tier, Stripe integration via webhooks.
2. **Custom JWT auth** — self-hosted, email/password + magic link, full control, more implementation work.
3. **Third-party auth (Auth0/Clerk)** — fastest integration, managed, but adds vendor dependency and cost.

**Recommendation:** Option 1 (Supabase). Fastest path to K-05 (Stripe integration), JWT session fits the existing Fastify backend, anonymous-first (K-06) is natural with Supabase's anon sessions. Free tier covers MVP scale.

**Tradeoff:** Vendor dependency on Supabase; migration cost if Supabase changes pricing or is deprecated.

**Temporary assumption:** ASSUMPTION-2 — Auth will be JWT-based with anonymous-first session. Frontend stores JWT in memory (not localStorage). Backend validates JWT on protected endpoints only. Prediction payloads remain unprotected (gating is presentation-only per K-04).

### Decision 3: Paywall / Freemium Trigger Model

**Why it matters:** Determines when the paywall appears, what the CTA looks like, and how aggressive the conversion funnel is. Directly implements K-04 and K-06.

**Options:**
1. **Lazy paywall** — user sees "Pro" badge on depth fields, clicking reveals paywall modal. No modal until user actively seeks depth. Registration prompt only on Pro-gated action (K-06 compliant).
2. **Inline paywall** — depth fields are always visible but blurred/locked with an overlay CTA. More aggressive conversion but may feel intrusive.
3. **Hybrid** — first N visits show nothing; after threshold, subtle "Unlock depth" CTA appears near depth fields. Balances discovery with non-intrusiveness.

**Recommendation:** Option 1 (Lazy paywall). Directly satisfies K-06 (no registration prompt on first visit, prompt only on Pro-gated action). Simplest to implement. Least risk of annoying free users.

**Tradeoff:** Lower conversion rate than inline paywall; Pro features are less discoverable.

**Temporary assumption:** ASSUMPTION-3 — Paywall is triggered only when user clicks/taps a Pro-gated element. The element shows a "Pro" badge but no modal appears until interaction. Anonymous users see the badge; clicking triggers auth flow first, then subscription flow.

---

# 4. Dependency-aware execution streams

## Stream 1 — Frontend Technical Foundations (starts now, no product decisions needed)

**Purpose:** Decompose the App.tsx monolith, introduce proper routing, extract a typed API client, and create the shell architecture that all subsequent streams depend on.

**Scope:**
- Extract App.tsx state into a lightweight global store (Zustand or React Context)
- Introduce react-router-dom with URL-synced state (competition, matchday, view, subTournament)
- Extract a typed API client module replacing 28 raw `fetch()` calls
- Extract the app shell (Navbar + layout chrome) from App.tsx
- Lazy-load route-level components (code splitting)

**Non-goals:**
- Auth integration (Stream 3)
- New features or views
- Changing any existing API endpoints
- SSR or Next.js migration (explicitly out of scope per Constitution)

**Deliverables:**
- `packages/web/src/lib/api-client.ts` — typed fetch wrapper with AbortController, error handling, base URL
- `packages/web/src/store/app-store.ts` — global state (competition, matchday, view, subTournament)
- `packages/web/src/router.tsx` — react-router-dom route definitions
- `packages/web/src/layouts/AppShell.tsx` — Navbar + chrome extracted from App.tsx
- App.tsx reduced to <50 lines (router mount + providers)

**Dependencies:** None. Can start immediately.

## Stream 2 — Public Track Record Surface (starts now, no auth needed)

**Purpose:** Ship the public track record per K-03 and MVP Exec Scope ss5.7. This is public aggregate data — no auth required.

**Scope:**
- Backend: new `GET /api/ui/track-record?competitionId=X` endpoint returning `{ accuracy, predictionCount, lastEvaluatedAt, belowThreshold }` — reads from existing `EvaluationStore`
- Frontend: `TrackRecordSection` component showing accuracy per competition, prediction count, last evaluated timestamp
- Publication threshold: suppress numeric accuracy when `predictionCount < 200` (show count only + "Acumulando historial" message)
- Walk-forward disclosure: if historical data is included, show explicit disclaimer per ss5.7

**Why no auth is needed:** Track record is public aggregate data (ss5.7: "The MVP must make the track record publicly visible"). The endpoint returns competition-level aggregates, not user-specific data. K-03 acceptance criteria make no mention of auth.

**Non-goals:**
- Per-team historical accuracy (Pro-only per ss5.6)
- Interactive filtering or drill-down (ss5.7: "A static aggregate per competition is sufficient")
- Auth gating

**Deliverables:**
- `server/prediction/track-record-route.ts` — public endpoint
- `packages/web/src/hooks/use-track-record.ts` — data hook
- `packages/web/src/components/pronosticos/TrackRecordSection.tsx` — display component
- Integration into PronosticosView (or standalone section within Pronosticos tab)

**Dependencies:**
- SPF-TRK-001 (backend endpoint) has no frontend dependency — can ship independently
- SPF-TRK-002 (frontend component) depends on SPF-TRK-001
- SPF-TRK-003 (placement + disclosure) depends on SPF-TRK-002

## Stream 3 — Auth + Session Foundations (starts after product decision #2)

**Purpose:** Implement user authentication, anonymous-first sessions, and the `AuthContext` that Stream 4 depends on.

**Scope:**
- Auth provider integration (Supabase or chosen provider per Decision 2)
- `AuthProvider` React context with `{ user, isAnonymous, isPro, isLoading, signIn, signUp, signOut }`
- Session hydration on app mount (check for existing JWT)
- Anonymous-first behavior: no registration prompt until Pro-gated action (K-06)
- Backend JWT validation middleware for protected endpoints (if any — note: prediction payloads are NOT protected per K-04)
- Route guards for authenticated-only pages (e.g., account settings)

**Non-goals:**
- Stripe integration (Stream 4)
- Paywall UI (Stream 4)
- Admin auth changes (existing ADMIN_SECRET is separate)
- Social login (post-MVP)

**Deliverables:**
- `packages/web/src/providers/AuthProvider.tsx`
- `packages/web/src/hooks/use-auth.ts`
- `packages/web/src/components/auth/SignInModal.tsx`
- `packages/web/src/components/auth/SignUpModal.tsx`
- Backend: auth middleware in `server/auth/` (JWT validation, user lookup)
- Backend: `POST /api/auth/session` or equivalent

**Dependencies:**
- Product Decision #2 (auth model) — BLOCKING
- SPF-FND-001 (API client) — auth token injection requires centralized fetch

## Stream 4 — Subscription / Paywall / Pro-depth Experience (depends on Stream 3)

**Purpose:** Implement the freemium conversion surface per K-04, K-05, K-06 and MVP Exec Scope ss5.6.

**Scope:**
- `PaywallGate` component: wraps Pro-only content, shows CTA if `!isPro`
- Pro badge on depth fields (scoreline, xG, O/U, BTTS, per-team accuracy)
- Stripe Checkout integration: redirect to Stripe, handle success callback
- Post-checkout Pro flag propagation within same session (K-05)
- Presentation-only gating: backend returns full payload always; frontend hides depth fields for free users (K-04 invariant)

**Non-goals:**
- Subscription management (cancel, upgrade, downgrade) — post-MVP
- Webhooks for subscription lifecycle — minimal viable: checkout success only
- Multiple Pro tiers

**Deliverables:**
- `packages/web/src/components/paywall/PaywallGate.tsx`
- `packages/web/src/components/paywall/ProBadge.tsx`
- `packages/web/src/components/paywall/CheckoutButton.tsx`
- Backend: `POST /api/subscription/create-checkout-session` (Stripe)
- Backend: `GET /api/subscription/status` (verify Pro flag)
- Modified `PredictionExperimentalSection.tsx` — wrap depth fields with `PaywallGate`

**Dependencies:**
- SPF-AUTH-001 through SPF-AUTH-004 (Stream 3) — HARD DEPENDENCY
- Product Decision #3 (paywall trigger model)
- Stripe account setup (external)

## Stream 5 — Responsive Hardening + Testability (starts now, parallel to all others)

**Purpose:** Increase test coverage for critical-path components and harden responsive behavior.

**Scope:**
- Component tests for: PaywallGate (when built), TrackRecordSection, DetailPanel prediction module, PronosticoCard
- Integration tests for the routing layer (when built)
- Design system tokens documentation (formalize existing ~30 CSS custom properties)
- Fix any iOS Safari rendering issues in DetailPanel

**Non-goals:**
- E2E browser tests (post-MVP)
- Visual regression testing
- Full design system component library

**Deliverables:**
- Test files in `packages/web/test/` for each new component
- `packages/web/src/styles/tokens.md` — design token inventory
- Responsive fixes as discovered

**Dependencies:** None for existing components. New component tests depend on those components being built (Streams 2, 3, 4).

## Stream 6 — Spec Hygiene (starts now, parallel)

**Purpose:** Correct stale spec documentation that creates confusion and onboarding risk.

**Scope:**
- Update `spec.sportpulse.web.frontend-architecture.md` to reflect actual SPA architecture (not Next.js)
- Create auth/session spec
- Create track record API spec

**Non-goals:**
- Full spec rewrite
- New constitutional changes

**Deliverables:** See Section 9.

**Dependencies:** None.

---

# 5. Technical backlog

## Stream 1 — Frontend Technical Foundations

```
**SPF-FND-001** | P0 | FOUNDATION_ENABLER
**Title:** Extract typed API client from raw fetch() calls
**Why:** 28 files use raw fetch() with no shared error handling, no AbortController consistency, no auth token injection point. Auth integration (Stream 3) requires a single place to attach JWT headers.
**Scope:**
- Create `packages/web/src/lib/api-client.ts` with typed methods per endpoint
- Implement shared error handling (non-2xx throws typed ApiError)
- Implement AbortController support on all requests (not just useDashboardSnapshot)
- Implement request/response interceptor pattern for future auth token injection
- Migrate all 28 fetch() call sites to use the new client
**Out of scope:** Auth token injection (Stream 3). Changing any API endpoint shape. Adding caching layer.
**Dependencies:** None — start immediately
**Acceptance criteria:**
- [ ] Zero raw fetch() calls remain in packages/web/src/ (grep confirms)
- [ ] All existing functionality works identically (manual smoke test)
- [ ] AbortController cleanup on unmount for all data-fetching hooks
- [ ] TypeScript types for all API responses (derived from existing inline types)
**Owner:** frontend
**Risks/notes:** Large surface area (28 files). Should be done as one atomic change to avoid mixed patterns. Existing AbortController in useDashboardSnapshot must be preserved.
```

```
**SPF-FND-002** | P0 | FOUNDATION_ENABLER
**Title:** Introduce react-router-dom with URL-synced navigation state
**Why:** MVP Exec Scope ss5.5 requires "minimal shareable navigation state" via "route or query params". Current routing is manual pathname checks + ViewMode useState — no deep links, no back button, no shareable URLs.
**Scope:**
- Add react-router-dom dependency
- Define route structure: `/` (home), `/:competition/tv`, `/:competition/partidos`, `/:competition/standings`, `/:competition/pronosticos`, `/admin`, `/admin/ops`, `/labs/*`, `/eventos/*`
- Sync competitionId, matchday, subTournamentKey to URL params
- Preserve existing ViewMode semantics through route mapping
- Handle back/forward browser navigation
**Out of scope:** Auth route guards (Stream 3). New routes for track record (Stream 2 will add). Changing Navbar visual design.
**Dependencies:** None — start immediately. SPF-FND-003 (state extraction) should be coordinated but is not blocking.
**Acceptance criteria:**
- [ ] All 5 ViewModes are URL-addressable (copy URL, paste in new tab, same view loads)
- [ ] Browser back/forward works for view transitions
- [ ] Competition switch updates URL
- [ ] Matchday selection persists in URL params
- [ ] /admin, /admin/ops, /labs/*, /eventos/* routes still work
- [ ] No regressions in existing navigation behavior
**Owner:** frontend
**Risks/notes:** Largest single refactor. App.tsx will need significant restructuring. Coordinate with SPF-FND-003. The existing `use-url-state.ts` hook (mode + focus) should be absorbed into the router.
```

```
**SPF-FND-003** | P1 | FOUNDATION_ENABLER
**Title:** Extract App.tsx state into global store and decompose into AppShell
**Why:** App.tsx holds ~15 useState declarations, 3 useEffect hooks, and all view rendering logic in one 330+ line component. This makes every subsequent feature harder to build and test.
**Scope:**
- Create `packages/web/src/store/app-store.ts` (Zustand or Context — small enough for Context)
- Move competitionId, matchday, view, subTournamentKey, tvTab, hasLiveMatches to store
- Extract `AppShell.tsx` (Navbar + layout chrome)
- Extract each view branch into its own route component
- App.tsx becomes: router mount + provider wrappers, <50 lines
**Out of scope:** Changing any component's props or behavior. Auth provider (Stream 3).
**Dependencies:** SPF-FND-002 (routing) — these two are tightly coupled and may be implemented together
**Acceptance criteria:**
- [ ] App.tsx is <50 lines
- [ ] No useState in App.tsx except provider-level state
- [ ] Each view is a separate file imported by the router
- [ ] All existing behavior preserved (manual smoke test)
**Owner:** frontend
**Risks/notes:** High coordination with SPF-FND-002. Consider doing these as a single PR.
```

```
**SPF-FND-004** | P2 | PARALLELIZABLE
**Title:** Implement route-level code splitting with React.lazy
**Why:** 66 .tsx components loaded eagerly. Not a launch blocker but affects initial load performance.
**Scope:**
- Wrap route-level components with React.lazy + Suspense
- Add loading fallback component (reuse ServerBootScreen or lighter skeleton)
- Verify Vite produces separate chunks per route
**Out of scope:** Component-level splitting. SSR preloading.
**Dependencies:** SPF-FND-002 (routing must exist first)
**Acceptance criteria:**
- [ ] Network tab shows separate JS chunks for each major route
- [ ] No flash of unstyled content during chunk load
- [ ] Initial bundle size reduced by >20%
**Owner:** frontend
**Risks/notes:** Low risk. Standard React pattern.
```

```
**SPF-FND-005** | P2 | PARALLELIZABLE
**Title:** Formalize API response types into shared type module
**Why:** API response types are scattered across 21 hooks as inline interfaces. No single source of truth for the frontend API contract.
**Scope:**
- Create `packages/web/src/types/api.ts` consolidating all API response types
- Types must match actual backend response shapes (verify against existing code)
- Update all hooks to import from shared types
**Out of scope:** Generating types from OpenAPI (no OpenAPI spec exists). Changing backend response shapes.
**Dependencies:** SPF-FND-001 (API client will reference these types)
**Acceptance criteria:**
- [ ] All API response types defined in one file
- [ ] Zero inline response type definitions in hooks
- [ ] TypeScript compiles without errors
**Owner:** frontend
**Risks/notes:** Mostly mechanical. Can be done alongside SPF-FND-001.
```

## Stream 2 — Public Track Record

```
**SPF-TRK-001** | P0 | LAUNCH_BLOCKER
**Title:** Create public GET /api/ui/track-record endpoint
**Why:** K-03 requires a public track record endpoint. Currently only internal evaluation endpoint exists (gated by PREDICTION_INTERNAL_VIEW_ENABLED). No public surface for track record data.
**Scope:**
- Create `server/prediction/track-record-route.ts`
- Endpoint: `GET /api/ui/track-record?competitionId=X`
- Response shape: `{ accuracy: number | null, predictionCount: number, lastEvaluatedAt: string | null, belowThreshold: boolean, competitionId: string }`
- When `predictionCount < 200`: return `{ accuracy: null, belowThreshold: true, predictionCount, lastEvaluatedAt }`
- When `predictionCount >= 200`: return `{ accuracy: <computed>, belowThreshold: false, predictionCount, lastEvaluatedAt }`
- Read from existing `EvaluationStore` — filter to COMPLETE + FULL_MODE records
- Only pre-kickoff predictions count (enforced by EvaluationStore lifecycle: SNAPSHOT_FROZEN before kickoff)
- Cache-Control: public, max-age=300 (5 min)
- NO auth gating — this is public data
**Out of scope:** Per-team accuracy (Pro-only). Interactive filtering. Walk-forward historical data mixing (deferred until walk-forward data exists).
**Dependencies:** None — EvaluationStore already exists and has data
**Acceptance criteria:**
- [ ] K-03 pass: >=200 predictions returns accuracy + count + belowThreshold:false
- [ ] K-03 pass: <200 predictions returns accuracy:null + count + belowThreshold:true
- [ ] Only COMPLETE + FULL_MODE records counted
- [ ] Accuracy matches manual computation from evaluation store
- [ ] Endpoint is public (no auth header required)
- [ ] 200 threshold is configurable via constant (not hardcoded in route logic)
**Owner:** backend
**Risks/notes:** Must verify EvaluationStore has enough COMPLETE records for at least one competition. If zero records exist, endpoint should return predictionCount:0, belowThreshold:true gracefully.
```

```
**SPF-TRK-002** | P0 | LAUNCH_BLOCKER
**Title:** Create TrackRecordSection frontend component
**Why:** K-03 requires frontend display of track record. No component exists.
**Scope:**
- Create `packages/web/src/components/pronosticos/TrackRecordSection.tsx`
- Create `packages/web/src/hooks/use-track-record.ts`
- Display per-competition: accuracy percentage (large, prominent), prediction count, last evaluated date
- When belowThreshold=true: show prediction count + "Acumulando historial — se requieren 200+ predicciones evaluadas para mostrar precision" (or equivalent)
- When belowThreshold=false: show accuracy + count + last evaluated
- Walk-forward disclosure: if walk-forward data is present, show explicit disclaimer per MVP Exec Scope ss5.7: "Evaluacion walk-forward historica — no es historial operativo en tiempo real"
- Responsive: works on mobile and desktop
- Respects dark/light theme
**Out of scope:** Per-team accuracy (Pro). Interactive drill-down. Historical charts.
**Dependencies:** SPF-TRK-001 (backend endpoint must exist)
**Acceptance criteria:**
- [ ] Renders accuracy when belowThreshold=false
- [ ] Suppresses accuracy when belowThreshold=true, shows count + message
- [ ] Walk-forward disclosure visible when applicable
- [ ] Responsive on mobile (no horizontal overflow)
- [ ] Theme-aware (dark/light)
**Owner:** frontend
**Risks/notes:** Design is simple — aggregate stats card. Keep it minimal per ss5.7 ("static aggregate per competition is sufficient").
```

```
**SPF-TRK-003** | P1 | LAUNCH_BLOCKER
**Title:** Integrate TrackRecordSection into Pronosticos view with placement and all-competition aggregation
**Why:** Track record must be discoverable. Users must be able to see it without navigating to a separate page.
**Scope:**
- Place TrackRecordSection at the bottom of PronosticosView (below match prediction cards)
- Show track record for the currently selected competition
- Optionally: show a summary row for each enabled competition (aggregate view)
- Link to more detailed view if future expansion is planned (but no separate page needed for MVP)
**Out of scope:** Separate /track-record route. Per-match accuracy breakdown. Historical charts.
**Dependencies:** SPF-TRK-002, ASSUMPTION-1 (placement within Pronosticos view)
**Acceptance criteria:**
- [ ] TrackRecordSection visible when user navigates to Pronosticos tab
- [ ] Shows data for the active competition
- [ ] Scrolling to bottom reveals the section naturally
- [ ] No layout shift or jank
**Owner:** frontend
**Risks/notes:** If Decision 1 changes placement, this ticket's scope changes accordingly. Low risk.
```

## Stream 3 — Auth + Session

```
**SPF-AUTH-001** | P0 | LAUNCH_BLOCKER
**Title:** Create AuthProvider context and useAuth hook
**Why:** K-04, K-05, K-06 all require knowledge of user auth state. No auth system exists.
**Scope:**
- Create `packages/web/src/providers/AuthProvider.tsx`
- Create `packages/web/src/hooks/use-auth.ts`
- Context shape: `{ user: User | null, isAnonymous: boolean, isPro: boolean, isLoading: boolean, signIn, signUp, signOut }`
- isPro derived from user metadata (subscription status)
- Anonymous-first: on mount, if no session exists, user is anonymous (K-06)
- Wrap app in AuthProvider at router level
**Out of scope:** Auth provider integration (SPF-AUTH-002). Stripe (Stream 4). UI components (SPF-AUTH-003).
**Dependencies:** Product Decision #2 (auth model) — BLOCKING. SPF-FND-001 (API client for token injection).
**Acceptance criteria:**
- [ ] useAuth() returns user state from any component
- [ ] isAnonymous=true when no session exists
- [ ] isPro=false by default
- [ ] isLoading=true during session hydration, false after
- [ ] No registration prompt on initial mount (K-06)
**Owner:** frontend
**Risks/notes:** Interface is stable regardless of auth provider choice. Implementation details change based on Decision #2.
```

```
**SPF-AUTH-002** | P0 | LAUNCH_BLOCKER
**Title:** Integrate auth provider (Supabase or chosen provider) with backend validation
**Why:** AuthProvider needs a real backend. JWT must be validated server-side for subscription status.
**Scope:**
- Backend: create `server/auth/` module with JWT validation middleware
- Backend: endpoint to verify/refresh session
- Frontend: integrate chosen auth provider SDK into AuthProvider
- Session persistence: JWT in memory (httpOnly cookie or secure storage per provider)
- Token refresh flow
**Out of scope:** Social login. Password reset flow (minimal: email/password + magic link). Admin auth (separate system).
**Dependencies:** SPF-AUTH-001, Product Decision #2
**Acceptance criteria:**
- [ ] User can sign up with email/password
- [ ] User can sign in and session persists across page refresh
- [ ] JWT validated server-side
- [ ] Invalid/expired JWT returns 401 on protected endpoints
- [ ] Anonymous user can browse all public content without auth prompt
**Owner:** backend + frontend (shared)
**Risks/notes:** Largest new backend surface area. If Supabase, most of this is SDK integration. If custom, significant implementation effort.
```

```
**SPF-AUTH-003** | P1 | LAUNCH_BLOCKER
**Title:** Build SignIn/SignUp modal components with anonymous-first UX
**Why:** K-06 requires registration prompt only on Pro-gated action. Need modal components that can be triggered contextually.
**Scope:**
- Create `packages/web/src/components/auth/AuthModal.tsx` (sign in / sign up tabs)
- Trigger: called programmatically when user attempts Pro-gated action while anonymous
- Must NOT appear on first visit or during first N interactions (K-06: "First 5 interactions: no modal")
- Interaction counter in session storage
- Mobile-responsive modal (full-screen on mobile, centered on desktop)
**Out of scope:** Social login buttons. Profile page. Account settings.
**Dependencies:** SPF-AUTH-001, SPF-AUTH-002
**Acceptance criteria:**
- [ ] K-06 pass: no registration prompt on first visit
- [ ] K-06 pass: prompt appears only on Pro-gated action
- [ ] K-06 pass: first 5 interactions produce no modal
- [ ] Modal works on mobile and desktop
- [ ] Successful auth closes modal and returns to original context
**Owner:** frontend
**Risks/notes:** "First 5 interactions" counter needs definition. Proposal: count clicks on Pro-gated elements specifically, not all interactions.
```

```
**SPF-AUTH-004** | P1 | FOUNDATION_ENABLER
**Title:** Inject auth token into API client for protected endpoints
**Why:** Once auth exists, protected endpoints need the JWT attached to requests.
**Scope:**
- Modify `api-client.ts` (from SPF-FND-001) to accept an auth token interceptor
- AuthProvider provides token to API client on session change
- Protected endpoints receive Authorization header automatically
- Unprotected endpoints (dashboard, track-record, predictions) work without token
**Out of scope:** Per-endpoint auth requirement mapping (that is defined by backend routes).
**Dependencies:** SPF-FND-001, SPF-AUTH-001
**Acceptance criteria:**
- [ ] Protected endpoints receive JWT in Authorization header
- [ ] Unprotected endpoints work without token
- [ ] Token refresh triggers re-injection
- [ ] 401 response triggers session invalidation + re-auth flow
**Owner:** frontend
**Risks/notes:** Low complexity if SPF-FND-001 was built with interceptor pattern.
```

## Stream 4 — Subscription / Paywall / Pro

```
**SPF-PRO-001** | P0 | LAUNCH_BLOCKER
**Title:** Create PaywallGate component and ProBadge
**Why:** K-04 requires depth fields hidden from free users with visible CTA. No gating component exists. Currently PredictionExperimentalSection shows ALL fields to everyone.
**Scope:**
- Create `packages/web/src/components/paywall/PaywallGate.tsx` — wrapper component
- Props: `children` (Pro content), `fallback` (CTA content shown to free users)
- Reads `isPro` from `useAuth()` — if true, renders children; if false, renders fallback
- Create `packages/web/src/components/paywall/ProBadge.tsx` — small visual indicator
- Fallback includes CTA text + button that triggers auth modal (if anonymous) or checkout (if authenticated)
**Out of scope:** Stripe integration (SPF-PRO-003). Actual payment flow. Blurred content preview.
**Dependencies:** SPF-AUTH-001 (useAuth hook must exist)
**Acceptance criteria:**
- [ ] K-04 pass (free): depth fields not visible in DOM
- [ ] K-04 pass (free): paywall CTA visible
- [ ] K-04 pass (Pro): all depth fields visible
- [ ] K-04 invariant: backend returns full payload regardless (verify in Network tab)
- [ ] ProBadge visible on gated elements
**Owner:** frontend
**Risks/notes:** Presentation-only gating means determined users can inspect Network tab and see full data. This is by design per K-04 invariant. Backend does NOT filter.
```

```
**SPF-PRO-002** | P0 | LAUNCH_BLOCKER
**Title:** Wrap PredictionExperimentalSection depth fields with PaywallGate
**Why:** Currently all depth fields (scoreline, xG, O/U, BTTS, markets) are visible to everyone. Must gate per ss5.6.
**Scope:**
- Identify depth fields in PredictionExperimentalSection: top_scorelines, expected_goals, MarketsPanel (O/U, BTTS, double_chance, DNB, asian_handicap)
- Wrap each depth section with PaywallGate
- Keep 1X2 calibrated probabilities + operating mode indicator visible to all (ss5.6 free tier)
- Keep model explanation stub visible to all (ss5.6: "visible to all users")
**Out of scope:** Redesigning the prediction section layout. Adding new Pro-only fields.
**Dependencies:** SPF-PRO-001
**Acceptance criteria:**
- [ ] 1X2 probs visible to anonymous/free users
- [ ] Operating mode indicator visible to all
- [ ] Scoreline distribution NOT visible to free users
- [ ] xG NOT visible to free users
- [ ] O/U, BTTS markets NOT visible to free users
- [ ] All above visible to Pro users
**Owner:** frontend
**Risks/notes:** This is the highest-value freemium boundary. Get the line right.
```

```
**SPF-PRO-003** | P0 | LAUNCH_BLOCKER
**Title:** Implement Stripe Checkout integration for Pro subscription
**Why:** K-05 requires functional payment flow. No Stripe integration exists.
**Scope:**
- Backend: `POST /api/subscription/create-checkout-session` — creates Stripe Checkout session, returns URL
- Backend: `GET /api/subscription/status` — returns `{ isPro: boolean, expiresAt: string | null }`
- Backend: Stripe webhook handler for `checkout.session.completed` — updates user record
- Frontend: CheckoutButton component that calls create-checkout-session and redirects
- Frontend: on return from Stripe, refresh session to pick up Pro flag (K-05)
**Out of scope:** Subscription management (cancel/upgrade). Multiple tiers. Invoice history. Stripe Customer Portal integration.
**Dependencies:** SPF-AUTH-002 (user must exist to associate subscription), Stripe account (external)
**Acceptance criteria:**
- [ ] K-05 pass: after checkout, Pro flag propagates within same session
- [ ] K-05 pass: no paywall after confirmed payment
- [ ] Stripe webhook correctly updates user Pro status
- [ ] Checkout failure does not corrupt user state
**Owner:** backend + frontend (shared)
**Risks/notes:** Stripe webhook requires a public URL (Render provides this). Test with Stripe test mode first.
```

```
**SPF-PRO-004** | P1 | LAUNCH_BLOCKER
**Title:** Post-checkout session refresh and Pro state propagation
**Why:** K-05 specifically requires Pro flag to propagate "within same session". After Stripe redirect, the frontend must know the user is now Pro without requiring a page refresh.
**Scope:**
- On Stripe checkout success redirect (URL contains session_id), call `GET /api/subscription/status`
- Update AuthProvider's isPro flag immediately
- PaywallGate components re-render to show depth content
- If status endpoint returns isPro=false (webhook hasn't processed yet), poll with exponential backoff (max 30s)
**Out of scope:** Real-time webhook push to frontend (post-MVP). WebSocket notification.
**Dependencies:** SPF-PRO-003, SPF-AUTH-001
**Acceptance criteria:**
- [ ] Pro content visible within 10s of checkout completion
- [ ] No paywall flash after payment
- [ ] Graceful handling of webhook delay (polling with user-visible "Activating..." state)
**Owner:** frontend
**Risks/notes:** Stripe webhook can take 1-5s. Polling is the pragmatic approach for MVP.
```

## Stream 5 — Responsive Hardening + Testability

```
**SPF-QA-001** | P1 | PARALLELIZABLE
**Title:** Add component tests for prediction critical path (K-01, K-02 frontend assertions)
**Why:** K-01 and K-02 have frontend assertions (probs visible, mode indicator visible, NOT_ELIGIBLE shows message). No tests validate these.
**Scope:**
- Test PredictionExperimentalSection with FULL_MODE mock data: verify probs rendered, mode indicator visible
- Test PredictionExperimentalSection with NOT_ELIGIBLE mock: verify "Prediccion no disponible" message, no numeric values in DOM
- Test PronosticoCard with prediction data: verify probability bars render
- Use vitest + @testing-library/react (already in devDeps based on existing tests)
**Out of scope:** E2E tests. Visual regression. Testing backend endpoints.
**Dependencies:** None for existing components. PaywallGate tests depend on SPF-PRO-001.
**Acceptance criteria:**
- [ ] K-01 frontend assertion: FULL_MODE renders 3 probability values summing to ~1.0
- [ ] K-02 frontend assertion: NOT_ELIGIBLE renders unavailability message, zero numeric prob values in DOM
- [ ] Tests pass in CI (vitest)
**Owner:** frontend
**Risks/notes:** 8 test files already exist. Extend, don't rewrite.
```

```
**SPF-QA-002** | P2 | PARALLELIZABLE
**Title:** Add PaywallGate and TrackRecordSection component tests (K-03, K-04 frontend assertions)
**Why:** K-03 and K-04 have frontend-specific assertions that must be validated.
**Scope:**
- Test TrackRecordSection with belowThreshold=true: verify no numeric accuracy in DOM, count visible
- Test TrackRecordSection with belowThreshold=false: verify accuracy displayed
- Test PaywallGate with isPro=false: verify children not in DOM, CTA visible
- Test PaywallGate with isPro=true: verify children rendered, no CTA
**Out of scope:** Integration tests with real API. E2E checkout flow.
**Dependencies:** SPF-TRK-002, SPF-PRO-001
**Acceptance criteria:**
- [ ] K-03 frontend: belowThreshold=true suppresses numeric accuracy
- [ ] K-03 frontend: belowThreshold=false shows accuracy
- [ ] K-04 frontend: free user DOM has no depth values
- [ ] K-04 frontend: Pro user DOM has depth values
**Owner:** frontend
**Risks/notes:** Straightforward unit tests with mocked auth context.
```

```
**SPF-QA-003** | P2 | NICE_TO_HAVE
**Title:** Document design system tokens and audit responsive breakpoints
**Why:** ~30 CSS custom properties exist undocumented. Responsive behavior is functional but not systematized.
**Scope:**
- Create `packages/web/src/styles/TOKENS.md` documenting all `--sp-*` CSS custom properties with semantic meaning
- Audit all components for consistent breakpoint usage (useWindowWidth)
- Identify and fix any components that don't use the standard mobile breakpoint
**Out of scope:** Building a component library. Storybook. New design tokens.
**Dependencies:** None
**Acceptance criteria:**
- [ ] All --sp-* tokens documented with semantic meaning and value
- [ ] All components use useWindowWidth for responsive behavior (no raw matchMedia)
- [ ] No horizontal scroll on 375px viewport width
**Owner:** frontend
**Risks/notes:** Documentation task. Low risk, high long-term value.
```

## Stream 6 — Spec Hygiene

```
**SPF-SPEC-001** | P1 | PARALLELIZABLE
**Title:** Correct frontend architecture spec to reflect actual SPA stack
**Why:** spec.sportpulse.web.frontend-architecture.md v1.1 ss4 says "Framework: Next.js (App Router)" and ss5.1 describes server rendering + client hydration. The actual stack is React SPA + Vite. This creates onboarding confusion and violates SDD principle of spec-code alignment.
**Scope:**
- Update ss4 Technology stack: Framework → React SPA (Vite), remove Next.js references
- Update ss5.1 Request flow: remove server rendering, describe SPA fetch flow
- Update ss3 Non-goals: add "SSR/Next.js migration" explicitly
- Bump version to 1.2
**Out of scope:** Rewriting the entire spec. Adding new sections.
**Dependencies:** None
**Acceptance criteria:**
- [ ] No Next.js references in the spec
- [ ] Technology stack matches actual stack (React, Vite, Tailwind, SPA)
- [ ] Data flow describes SPA pattern (mount → fetch → render)
**Owner:** shared (architect + spec guardian)
**Risks/notes:** Must follow SDD spec change request process. Low risk.
```

```
**SPF-SPEC-002** | P1 | FOUNDATION_ENABLER
**Title:** Create track record API contract spec
**Why:** K-03 defines acceptance criteria but no spec defines the endpoint contract. Backend (SPF-TRK-001) needs a spec before implementation per SDD.
**Scope:**
- Create `docs/specs/api/spec.sportpulse.api.track-record.md`
- Define: endpoint path, query params, response shape, error cases, cache policy, threshold constant
- Reference: MVP Exec Scope ss5.7, K-03
**Out of scope:** Per-team accuracy endpoint (Pro, post-MVP iteration).
**Dependencies:** None
**Acceptance criteria:**
- [ ] Endpoint contract fully specified
- [ ] Response shape matches K-03 requirements
- [ ] 200-prediction threshold documented
- [ ] Walk-forward disclosure rules documented
**Owner:** shared (architect)
**Risks/notes:** Small spec. Should be written before SPF-TRK-001 implementation per SDD.
```

```
**SPF-SPEC-003** | P2 | PARALLELIZABLE
**Title:** Create auth/session architecture spec
**Why:** No spec governs auth behavior. K-04/K-05/K-06 define acceptance criteria but no architectural spec exists for auth provider, token format, session lifecycle, or anonymous-first behavior.
**Scope:**
- Create `docs/specs/auth/spec.sportpulse.auth.session-architecture.md`
- Define: auth provider interface, token format, session lifecycle, anonymous-first rules, Pro flag derivation, protected vs public endpoints
- Reference: K-04, K-05, K-06, MVP Exec Scope ss5.6 note on presentation-only gating
**Out of scope:** Choosing the auth provider (that is Decision #2).
**Dependencies:** Product Decision #2 (can write provider-agnostic spec first, amend after decision)
**Acceptance criteria:**
- [ ] Anonymous-first behavior specified
- [ ] Pro flag derivation specified
- [ ] Presentation-only gating rule specified
- [ ] Session lifecycle (create, refresh, expire, invalidate) specified
**Owner:** shared (architect)
**Risks/notes:** Can start with provider-agnostic version. Amend after Decision #2.
```

---

# 6. Phase plan

## Phase 0 — Parallel Foundations + Track Record (no product decisions needed)
**Objective:** Build the technical foundations that all subsequent streams depend on, and ship the only launch blocker that has zero external dependencies (track record).
**Tickets:** SPF-FND-001, SPF-FND-002, SPF-FND-003, SPF-FND-005, SPF-TRK-001, SPF-TRK-002, SPF-TRK-003, SPF-QA-001, SPF-SPEC-001, SPF-SPEC-002
**Exit criteria:**
- API client extracted, zero raw fetch() calls
- react-router-dom routes working with URL sync
- App.tsx decomposed into AppShell + route components
- Track record endpoint live and returning data
- TrackRecordSection rendering in Pronosticos view
- K-03 frontend assertions passing
- Frontend architecture spec corrected
**Unlocks:** Auth integration (needs API client). Paywall (needs routing). All Stream 3/4 work.

## Phase 1 — Auth + Session (after product Decision #2)
**Objective:** Implement user authentication with anonymous-first UX, satisfying K-06.
**Tickets:** SPF-AUTH-001, SPF-AUTH-002, SPF-AUTH-003, SPF-AUTH-004, SPF-SPEC-003
**Exit criteria:**
- Users can sign up and sign in
- Anonymous users browse freely with no auth prompts
- Auth modal triggers only on Pro-gated action
- JWT validated server-side
- K-06 passing
**Unlocks:** Paywall implementation. Subscription flow. Pro gating.

## Phase 2 — Paywall + Pro Subscription (after Phase 1)
**Objective:** Implement the freemium conversion surface, satisfying K-04 and K-05.
**Tickets:** SPF-PRO-001, SPF-PRO-002, SPF-PRO-003, SPF-PRO-004, SPF-QA-002
**Exit criteria:**
- Free users see 1X2 only; depth fields gated
- Pro users see all depth fields
- Stripe checkout works end-to-end
- Pro flag propagates within same session after payment
- K-04, K-05 passing
**Unlocks:** Public launch readiness (all K tests passing).

## Phase 3 — Hardening + Launch Prep (after Phase 2)
**Objective:** Final polish, test coverage, performance, and launch readiness verification.
**Tickets:** SPF-FND-004, SPF-QA-003
**Exit criteria:**
- Code splitting active
- Design tokens documented
- All K-01 through K-06 passing
- Smoke test passes against staging
- No P0 bugs open
**Unlocks:** Public launch (GA).

---

# 7. Dependency map

## No external dependencies (start immediately)
- SPF-FND-001 has no external dependencies → start immediately
- SPF-FND-002 has no external dependencies → start immediately
- SPF-FND-005 has no external dependencies → start immediately (coordinate with SPF-FND-001)
- SPF-SPEC-001 has no external dependencies → start immediately
- SPF-SPEC-002 has no external dependencies → start immediately
- SPF-QA-001 has no external dependencies → start immediately
- SPF-QA-003 has no external dependencies → start immediately

## Internal dependencies only
- SPF-FND-003 depends on SPF-FND-002 (routing must exist to decompose App.tsx views)
- SPF-FND-004 depends on SPF-FND-002 (routing must exist for route-level splitting)
- SPF-TRK-001 requires no frontend work — backend only → start immediately after SPF-SPEC-002
- SPF-TRK-002 depends on SPF-TRK-001 (backend endpoint must exist)
- SPF-TRK-003 depends on SPF-TRK-002

## Product decision dependencies
- SPF-AUTH-001 depends on Product Decision #2 (auth model) AND SPF-FND-001 (API client)
- SPF-AUTH-002 depends on SPF-AUTH-001 AND Product Decision #2
- SPF-AUTH-003 depends on SPF-AUTH-001 AND SPF-AUTH-002
- SPF-AUTH-004 depends on SPF-FND-001 AND SPF-AUTH-001
- SPF-SPEC-003 can start provider-agnostic now; amend after Decision #2

## Hard chain dependencies
- SPF-PRO-001 depends on SPF-AUTH-001 (needs useAuth hook)
- SPF-PRO-002 depends on SPF-PRO-001
- SPF-PRO-003 depends on SPF-AUTH-002 (needs real auth backend) AND external Stripe account
- SPF-PRO-004 depends on SPF-PRO-003
- SPF-QA-002 depends on SPF-TRK-002 AND SPF-PRO-001

## Backend dependency note

The following tickets require NEW backend endpoints:

| Ticket | Endpoint | Purpose |
|--------|----------|---------|
| SPF-TRK-001 | `GET /api/ui/track-record?competitionId=X` | Public track record aggregate |
| SPF-AUTH-002 | `POST /api/auth/session` (or provider equivalent) | Session create/verify |
| SPF-PRO-003 | `POST /api/subscription/create-checkout-session` | Stripe checkout |
| SPF-PRO-003 | `GET /api/subscription/status` | Pro flag check |
| SPF-PRO-003 | `POST /api/webhooks/stripe` | Stripe webhook handler |

---

# 8. Temporary assumptions

```
**Assumption 1:** Track record is placed as a section within the Pronosticos view, not a separate top-level route.
**Acceptable because:** MVP Exec Scope ss5.7 says "static aggregate per competition is sufficient" — a section is the minimal viable placement. Changing placement later is trivial (move a component).
**Replaced by:** Product Decision #1 (IA / navigation hierarchy).
```

```
**Assumption 2:** Auth will be JWT-based with anonymous-first session. Frontend stores JWT in memory. Backend validates JWT on protected endpoints only. Prediction payloads remain unprotected (gating is presentation-only per K-04).
**Acceptable because:** K-04 explicitly states "backend returns full payload; gating is PRESENTATION ONLY". Any JWT-based auth system supports this model. The AuthProvider interface is stable regardless of provider.
**Replaced by:** Product Decision #2 (auth model/provider choice).
```

```
**Assumption 3:** Paywall is triggered only when user clicks/taps a Pro-gated element. No unprompted modals. Anonymous users see Pro badge; clicking triggers auth first, then subscription.
**Acceptable because:** K-06 says "no registration prompt on first visit" and "registration prompt ONLY when attempting Pro-gated action". Lazy paywall directly satisfies this. PaywallGate component interface is the same regardless of trigger model.
**Replaced by:** Product Decision #3 (paywall trigger model).
```

```
**Assumption 4:** "First 5 interactions" in K-06 means first 5 clicks on Pro-gated elements, not 5 total interactions with the app.
**Acceptable because:** K-06 says "First 5 interactions: no modal" in the context of registration prompts. Counting only Pro-gated clicks is the interpretation most consistent with "registration prompt ONLY when attempting Pro-gated action". A global interaction counter would conflict with the lazy paywall model.
**Replaced by:** Clarification from product owner on K-06 interaction definition.
```

```
**Assumption 5:** Supabase is the auth provider. Engineering can build the AuthProvider interface now (provider-agnostic) and plug in Supabase later.
**Acceptable because:** The AuthProvider interface (`user, isAnonymous, isPro, signIn, signUp, signOut`) is identical regardless of provider. SPF-AUTH-001 can ship with a mock provider; SPF-AUTH-002 plugs in the real one.
**Replaced by:** Product Decision #2.
```

---

# 9. Specs to create, update, or mark stale

## 9.1 Create (new specs needed)

| Spec | Purpose | Blocks | When to create |
|------|---------|--------|----------------|
| `docs/specs/api/spec.sportpulse.api.track-record.md` | Track record endpoint contract | SPF-TRK-001 (backend implementation) | Before Phase 0 backend work (SPF-SPEC-002) |
| `docs/specs/auth/spec.sportpulse.auth.session-architecture.md` | Auth/session architecture | SPF-AUTH-002 (full implementation) | During Phase 0, amend in Phase 1 (SPF-SPEC-003) |

## 9.2 Update (existing specs need amendment)

| Spec | What is stale | Required correction | Urgency |
|------|--------------|--------------------| --------|
| `docs/architecture/spec.sportpulse.web.frontend-architecture.md` v1.1 | ss4: "Framework: Next.js (App Router)"; ss5.1: server rendering + hydration flow; ss3: no mention of SSR exclusion | Replace Next.js with React SPA + Vite. Rewrite ss5.1 data flow. Add SSR to non-goals. Bump to v1.2. | HIGH — active source of confusion (SPF-SPEC-001) |
| `docs/core/spec.sportpulse.core.mvp-execution-scope.md` v2.0 | ss3: "prediction engines" listed under frontend non-goals, but frontend now renders predictions (PredictionExperimentalSection). ss7.3 non-goals list is stale ("multi-competition switching" is shipped). | Amend ss3 to clarify frontend renders prediction data but does not compute it. Remove shipped items from non-goals or mark as delivered. | MEDIUM — cosmetic but creates audit confusion |

## 9.3 Mark stale / correct

| Spec | What is wrong | Risk if uncorrected |
|------|--------------|---------------------|
| `docs/architecture/spec.sportpulse.web.frontend-architecture.md` ss4, ss5.1 | Next.js App Router references do not match any code in the repository. React SPA + Vite is the actual stack. | New contributors will attempt Next.js patterns. AI agents will propose SSR solutions. Onboarding friction. |

---

# 10. Anti-actions

- DO NOT start SPF-AUTH-* implementation before Product Decision #2 is made, because the auth provider choice determines SDK, token format, and backend integration pattern. The AuthProvider interface (SPF-AUTH-001) can be built with a mock provider, but SPF-AUTH-002+ requires the real decision.
- DO NOT build a subscription management page (cancel, upgrade, invoices) because MVP Exec Scope does not include it and it requires Stripe Customer Portal integration that is post-MVP scope.
- DO NOT add server-side filtering of prediction depth fields in the API because K-04 explicitly states "backend returns full payload; gating is PRESENTATION ONLY". Adding server-side filtering would violate the spec and create a second gating layer to maintain.
- DO NOT introduce a state management library larger than Zustand (no Redux, no MobX) because the app state is small (~10 values) and Context or Zustand is sufficient. Over-engineering state management would delay SPF-FND-003.
- DO NOT add react-router-dom with nested layouts and complex loader patterns because the current app is simple enough for flat routes. Keep the routing refactor minimal — URL sync is the goal, not a framework migration.
- DO NOT migrate from raw CSS custom properties to a CSS-in-JS solution because the existing token system works and theming is functional. SPF-QA-003 documents tokens, it does not replace them.
- DO NOT build a registration wall or login-required landing page because K-06 mandates anonymous-first access and no registration prompt on first visit.
- DO NOT create an OpenAPI spec or auto-generate types because no OpenAPI tooling exists in the project and adding it is scope creep. SPF-FND-005 manually consolidates types.
- DO NOT attempt SSR, server components, or Next.js migration because Constitution and MVP Exec Scope explicitly exclude SSR and the current SPA architecture is adequate.
- DO NOT build per-team historical accuracy (Pro-only) in SPF-TRK-* because it is a Pro depth feature that depends on Stream 4 (paywall) and is a separate ticket post-paywall.

---

# 11. Final execution recommendation

## 1. What should the product owner decide FIRST?

1. **Decision #2: Auth provider** — this is the longest-lead decision because it determines backend integration work, SDK choice, and has infrastructure implications (Supabase project setup, or custom auth tables, or third-party account). Recommend Supabase; confirm or reject.
2. **Decision #1: Track record placement** — low-stakes but should be confirmed before SPF-TRK-003 ships. Default assumption (within Pronosticos) is safe.
3. **Decision #3: Paywall trigger model** — can wait until Phase 1 is underway. Lazy paywall (Assumption 3) is the safe default.

## 2. What should be delegated immediately to engineering?

1. **SPF-SPEC-002** — write track record API spec (architect, 1 hour)
2. **SPF-FND-001** — extract API client (frontend-engineer, 2-3 days)
3. **SPF-TRK-001** — build track record endpoint (backend-engineer, 1 day, after spec)
4. **SPF-SPEC-001** — correct frontend architecture spec (architect, 1 hour)
5. **SPF-QA-001** — add prediction component tests (frontend-engineer, 1 day, parallel)
6. **SPF-FND-002 + SPF-FND-003** — routing + App.tsx decomposition (frontend-engineer, 3-4 days, parallel to TRK)

Items 1-6 can all start in the same sprint with zero product decisions needed.

## 3. What should the team be explicitly forbidden from doing?

1. Do not implement auth backend until the auth provider is chosen (Decision #2)
2. Do not add server-side prediction payload filtering (violates K-04 invariant)
3. Do not build subscription management UI (out of MVP scope)
4. Do not introduce SSR or Next.js (out of scope per Constitution)
5. Do not attempt Stripe integration until auth + user model is operational (hard dependency chain)

## 4. What does success look like in 2-3 weeks?

- **Track record is live and public** — `GET /api/ui/track-record` returns data, TrackRecordSection renders in Pronosticos view, K-03 passing (even if belowThreshold=true due to prediction count)
- **App.tsx is decomposed** — react-router-dom active, URL state synced, App.tsx <50 lines, all views are separate route components
- **API client extracted** — zero raw fetch() calls, AbortController on all hooks, auth token injection point ready
- **Frontend architecture spec corrected** — no more Next.js references
- **Product Decision #2 confirmed** — auth implementation can begin in week 3-4
- **8+ additional component tests** — K-01, K-02, K-03 frontend assertions covered

This represents Phase 0 completion and readiness to begin Phase 1.
