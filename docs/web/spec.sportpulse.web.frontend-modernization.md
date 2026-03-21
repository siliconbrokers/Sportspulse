---
artifact_id: SPEC-SPORTPULSE-WEB-FRONTEND-MODERNIZATION
title: "Frontend Modernization"
artifact_class: spec
status: proposed
version: 0.2.0
project: sportpulse
domain: web
slug: frontend-modernization
owner: team
created_at: 2026-03-21
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-CORE-CONSTITUTION
  - SPEC-SPORTPULSE-CORE-MVP-EXECUTION-SCOPE
  - SPEC-SPORTPULSE-CORE-IMPLEMENTATION-BACKLOG
  - SPEC-SPORTPULSE-QA-ACCEPTANCE-TEST-MATRIX
  - SPEC-SPORTPULSE-WEB-AUTH-AND-FREEMIUM-SURFACE
  - SPEC-SPORTPULSE-WEB-NAVIGATION-AND-SHELL-ARCHITECTURE
  - SPEC-SPORTPULSE-WEB-DESIGN-SYSTEM-FOUNDATION
  - SPEC-SPORTPULSE-WEB-THEME-AND-GLOBAL-ANNOUNCEMENT-SYSTEM
  - SPEC-SPORTPULSE-WEB-SITE-EXPERIENCE-CONFIG
canonical_path: docs/web/spec.sportpulse.web.frontend-modernization.md
---

# SportPulse — Frontend Modernization

Version: 0.2  
Status: Proposed  
Scope: system-level modernization of the SportPulse web frontend while preserving snapshot-first, backend-owned truth and MVP commercial constraints  
Audience: Product, Frontend, Backend, QA, Ops, AI-assisted development workflows

---

## 1. Purpose

This document defines the modernization program for the SportPulse web frontend.

It does **not** exist to justify a cosmetic redesign.

It exists to move the current web frontend from an incrementally assembled, desktop-biased internal product surface toward a production-grade, route-driven, mobile-respectful, freemium-capable product shell that can support:

- multiple competitions,
- public track record,
- anonymous-first usage,
- deferred auth,
- Pro conversion,
- seasonal/theme variation,
- announcements,
- future competition growth,
- and stable component evolution.

This spec is a modernization contract, not an art direction brief.

---

## 2. Authority and boundaries

This document is subordinate to:

1. Constitution  
2. MVP Execution Scope  
3. Acceptance Test Matrix  
4. Implementation Backlog  
5. Auth and Freemium Surface  
6. Navigation and Shell Architecture  
7. Design System Foundation  
8. Theme and Global Announcement System  
9. Site Experience Config

This document is authoritative for:

- frontend modernization principles,
- phased migration boundaries,
- what must change structurally,
- what must remain stable during modernization,
- sequencing rules,
- anti-patterns and forbidden shortcuts.

This document is not authoritative for:

- prediction math,
- snapshot semantics,
- layout algorithm semantics,
- track record computation,
- payment provider internals,
- backend persistence design,
- business pricing.

---

## 3. Why modernization is required

The frontend was initially assembled around a smaller competition footprint and a desktop-biased internal usage pattern.

That state is no longer sufficient.

The product now requires a frontend that can support, coherently and without ad hoc accretion:

- dashboard + treemap,
- detail panel and explainability,
- multi-competition navigation,
- public predictions surface,
- public track record surface,
- Pro depth gating,
- deferred auth,
- Stripe return-state recovery,
- future theme variants,
- global notices,
- mobile-usable shell and routing.

The current system may still be functionally usable, but usability alone is no longer the standard.

The standard is now:

- structural coherence,
- commercial readiness,
- route/shareability,
- mobile-respectful interaction,
- maintainability,
- and testability.

---

## 4. Non-negotiable modernization invariants

### 4.1 Frontend-honest invariant

The frontend may own:

- rendering,
- interaction,
- presentation,
- navigation state,
- theming,
- session rendering,
- paywall display,
- ad/notices display.

The frontend must not own:

- provider access,
- prediction recomputation,
- layout/treemap solving,
- hidden urgency logic,
- track record computation,
- subscription truth by local guesswork.

### 4.2 Snapshot-first invariant

Dashboard and related product surfaces remain snapshot-first.

Modernization must not reintroduce direct provider-driven UI logic or page-local semantic recomputation.

### 4.3 Backend-owned truth invariant

If frontend and backend disagree, backend truth wins.

Modernization must not create a second semantic authority inside the web layer.

### 4.4 Public-value-before-friction invariant

The modernization must preserve the free/public value contract:

- dashboard remains public,
- 1X2 prediction remains public,
- track record remains public,
- depth remains Pro,
- registration stays deferred,
- paywall remains intent-triggered.

### 4.5 Incremental migration invariant

Modernization must be executable in slices.

A “rewrite everything first” approach is forbidden.

### 4.6 Route legitimacy invariant

Primary product surfaces must be route-addressable and shareable.

Important state may use query params or route params, but critical navigation must not remain trapped inside opaque local component state.

---

## 5. Modernization goals

The modernization program must achieve the following.

### 5.1 Product-shell coherence

The app must behave as one product with a stable shell, not as a pile of independently evolved panels.

### 5.2 Competition scalability

Competition growth must be data-driven and route-safe, not hardcoded in top-level application files.

### 5.3 Mobile respectability

The frontend must become mobile-usable by hierarchy and flow, not merely by CSS compression.

### 5.4 Commercial readiness

The frontend must support:

- public track record,
- deferred auth,
- Pro gating,
- checkout return,
- Pro tier display state,
- commercial ad suppression for Pro,
- global product notices.

### 5.5 Design-system alignment

Visual evolution must be token-driven and theme-compatible.

### 5.6 Testability baseline

Critical user journeys must become testable at UI level.

---

## 6. Explicit non-goals

This modernization does not include, in v1:

- native mobile app implementation,
- SSR/SEO initiative,
- backend prediction redesign,
- white-label architecture,
- personalization by user history,
- multi-tier monetization beyond free/Pro,
- experimental feature programs,
- visual rebranding disconnected from product structure.

If any of these become desirable later, they must enter through separate approved artifacts.

---

## 7. Target product architecture (frontend view)

The target frontend architecture must be understood as these layers:

### 7.1 App shell layer

Owns:

- top-level navigation,
- competition context bar,
- announcement surface,
- account/session entry point,
- page container,
- route transitions.

### 7.2 Surface layer

Owns primary product pages:

- Resumen,
- Predicciones,
- Track record,
- Pro,
- Cuenta/Auth-related surfaces,
- checkout return / auth completion technical surfaces.

### 7.3 Shared component layer

Owns composable product primitives:

- cards,
- panels,
- stat blocks,
- locks/gates,
- notices,
- tabs/filters,
- route-aware controls,
- forms,
- modal/sheet primitives.

### 7.4 State layer

Owns frontend-only state such as:

- session render state,
- current competition/date context,
- route-derived UI state,
- local interaction state,
- loading/error states.

It must not own business truth better owned by backend.

### 7.5 Theme and experience layer

Owns:

- design tokens,
- theme selection,
- announcements rendering,
- experience-config-derived presentation behavior.

---

## 8. Modernization target surfaces

The modernization program must explicitly account for these surfaces.

### 8.1 Resumen

Must support:

- dashboard snapshot rendering,
- treemap,
- focus/detail behavior,
- explainability,
- warnings,
- competition context,
- mobile-respectful detail access.

### 8.2 Predicciones

Must support:

- public 1X2 presentation,
- Pro-depth gate,
- model mode visibility,
- graceful NOT_ELIGIBLE,
- auth deferral,
- context-preserving paywall trigger.

### 8.3 Track record

Must support:

- public aggregate by competition,
- below-threshold handling,
- walk-forward disclosure,
- loading/empty/unavailable states,
- route-level visibility.

### 8.4 Pro

Must support:

- pricing/benefit explanation,
- upgrade CTA,
- commercial differentiation,
- non-confusing tier explanation,
- relation to current viewed context when relevant.

### 8.5 Cuenta/Auth

Must support:

- anonymous entry,
- magic-link auth initiation/completion,
- session state display,
- Pro status display,
- logout/session expiration handling.

### 8.6 Technical return surfaces

Must support:

- checkout return,
- auth completion,
- session refresh/reconciliation,
- recoverable loading states.

---

## 9. Structural gaps this modernization must resolve

The following gap classes are considered in-scope structural targets.

### 9.1 Hardcoded competition/routing logic

Top-level hardcoded competition definitions are not acceptable as final architecture.

### 9.2 Opaque top-level state concentration

Excessive `useState` accumulation in top-level app composition is not acceptable as final architecture.

### 9.3 Missing public track record surface

Track record must become a first-class route/surface, not an internal or lab-only concern.

### 9.4 Missing auth/session shell integration

Auth and tier state must integrate cleanly into the shell instead of being added later as bolt-ons.

### 9.5 Missing commercial gating architecture

The Pro gate must become a stable surface pattern rather than an ad hoc conditional block.

### 9.6 Weak testability

Critical user journeys cannot remain effectively untested.

### 9.7 Weak theme/token governance

The frontend cannot continue to evolve through scattered hardcoded styling.

### 9.8 Mobile interaction debt

Fixed panels, backdrop hacks, hidden treemap cases, and narrow-layout hierarchy failures must be addressed deliberately.


### 9.8 Style-propagation guarantee boundary

Visual modernization must distinguish between two milestones:

#### Level A — Critical-surface style safety
Level A means the following surfaces are token-safe and theme-safe:
- shell,
- navigation,
- competition controls,
- dashboard containers,
- treemap surrounds,
- detail panel,
- match/prediction cards,
- track record,
- paywall,
- notices.

Level A is sufficient for:
- controlled theme evolution,
- seasonal overlays on critical surfaces,
- announcement styling without per-component rewrites.

Level A is **not** sufficient to claim that the entire active product will restyle globally without manual patching.

#### Level B — Full active-product style propagation readiness
Level B means the full active product surface inventory is tokenized or explicitly documented as approved exceptions.

Only Level B permits the stronger product claim that a global style change propagates across the active product without per-surface rework.

---

## 10. Phase model

Modernization must execute in controlled phases.

### 10.1 Phase 0 — Spec freeze and architectural alignment

Objective:

- freeze product decisions,
- align docs,
- identify stale documents,
- confirm architecture targets.

Completion criteria:

- auth/freemium spec approved,
- shell/navigation spec approved,
- modernization spec approved,
- stale-doc list documented.

### 10.2 Phase 1 — Foundations and routing

Objective:

- centralize API client,
- establish data-driven competition registry,
- implement route-based surface navigation,
- reduce top-level state concentration,
- create shell scaffolding.

Completion criteria:

- product surfaces route correctly,
- competition routing no longer hardcoded in top-level app,
- core shell exists,
- current functionality preserved.

### 10.3 Phase 2 — Public trust/commercial readiness

Objective:

- ship public track record surface,
- establish Pro-depth gate pattern,
- establish auth/session entry points,
- prepare session-aware shell behavior.

Completion criteria:

- track record is visible and public,
- public/free prediction flow remains coherent,
- depth gate pattern is stable.

### 10.4 Phase 3 — Auth, subscription, Pro behavior

Objective:

- implement magic-link auth,
- session hydration,
- checkout return,
- Pro flag propagation,
- ad suppression by tier.

Completion criteria:

- deferred auth works,
- K-04/K-05/K-06 behavior is implementable and testable,
- Pro users see no commercial display ads.

### 10.5 Phase 4 — Visual/system hardening (Level A)

Objective:

- align critical components to design-system foundation,
- stabilize theme/announcement integration,
- resolve responsive debt,
- add UI test baseline,
- reach critical-surface style safety.

Completion criteria:

- critical surfaces use token-driven styling,
- critical path UI tests exist,
- responsive debt items are closed or explicitly deferred,
- Level A style safety can be asserted.

### 10.6 Phase 5 — Full active-surface style propagation readiness (Level B)

Objective:

- close token gaps across the full active product footprint,
- eliminate undocumented raw visual values from active surfaces,
- verify global style propagation readiness.

Completion criteria:

- full active product surface inventory is covered,
- remaining exceptions are documented and bounded,
- K-08 or equivalent style-propagation readiness validation passes,
- Level B can be asserted honestly.

### 10.7 Phase 6 — Controlled UX refinement

Objective:

- refine density,
- improve friction points,
- improve discoverability,
- polish shell interactions.

Completion criteria:

- no structural blockers remain,
- refinements occur on top of stable foundations.

---

## 11. Stream model

The work should also be understood as parallelizable streams under the phase model.

### 11.1 Stream A — Frontend foundations

Includes:

- API client centralization,
- route foundation,
- competition registry,
- top-level state cleanup,
- shell scaffolding.

### 11.2 Stream B — Public track record

Includes:

- public route/surface,
- track record UI contract,
- below-threshold states,
- disclosure states.

### 11.3 Stream C — Auth/session

Includes:

- auth context,
- session hydration,
- anonymous/authenticated rendering,
- auth completion and expiry handling.

### 11.4 Stream D — Paywall / Pro depth

Includes:

- locked-depth pattern,
- paywall surface,
- upgrade path,
- Pro rendering state,
- ad suppression by tier.

### 11.5 Stream E — Visual and test hardening

Includes:

- Level A critical-surface token adoption,
- Level B full active-surface token closure,
- theme integration,
- responsive fixes,
- critical-path tests,
- style-propagation readiness validation.

---

## 12. Routing modernization rules

### 12.1 Product surfaces must be explicit

At minimum, the modernization target must support explicit routes for:

- `/:competitionId/resumen`
- `/:competitionId/predicciones`
- `/:competitionId/track-record`
- `/pro`
- `/cuenta`
- `/login`
- technical auth/checkout return routes as needed

Equivalent patterns are acceptable only if they preserve the same clarity.

### 12.2 Competition is context, not menu explosion

Competition must be handled as context/selector, not as separate hardcoded menu structures.

### 12.3 Route params vs query params

Use route params for major surface identity and competition context.  
Use query params only for secondary focus/filter state where appropriate.

### 12.4 Back/forward legitimacy

Surface navigation must behave correctly under browser back/forward usage.

---

## 13. Shell modernization rules

### 13.1 The shell is a product contract

The shell must consistently provide:

- primary navigation,
- competition context,
- global notice surface,
- account/session access,
- stable page container.

### 13.2 Shell must not hide critical trust/commercial surfaces

Track record and Pro must be shell-legible and not buried under hidden secondary patterns.

### 13.3 Shell must remain compatible with anonymous-first usage

Account state must not dominate the primary product experience.

### 13.4 Shell must tolerate future theme/announcement overlays

The shell must not be visually or structurally brittle under theme or seasonal presentation changes.

---

## 14. State modernization rules

### 14.1 Route-derived state first

Whenever state represents navigation identity, derive it from route/state contract, not arbitrary local state.

### 14.2 Lift only what deserves lifting

Do not centralize every interaction state globally.

### 14.3 Session state is special

Session and tier rendering state must be handled centrally enough to avoid contradictory UI.

### 14.4 Backend truth wins

Frontend state must never invent or cache entitlement truth beyond safe rendering needs.

---

## 15. Visual modernization rules

### 15.1 Token-first, not component-by-component improvisation

Visual modernization must happen through the design-system foundation and semantic tokens.

### 15.2 Theming is a layer, not a rewrite

Seasonal or event themes must not require rewriting component CSS.

### 15.3 Commercial gating must look intentional, not broken

Locked Pro-depth sections must present as gated value, not as missing data or rendering failure.

### 15.4 Public trust surfaces must look first-class

Track record must not appear as a hidden lab artifact.

---

## 16. Responsive modernization rules

### 16.1 Mobile by hierarchy, not by compression

The mobile target is not “desktop but narrower.”

It must prioritize:

- clear route orientation,
- readable cards,
- understandable locked-depth pattern,
- manageable filters/selectors,
- recoverable detail interactions.

### 16.2 Detail access pattern must be narrow-safe

The detail interaction model must avoid brittle fixed-position hacks that fail on mobile browsers.

### 16.3 Treemap is not license for unusability

Treemap must remain visible and meaningful where supported, but mobile UX must prioritize legibility and flow over ritual fidelity to desktop layout.

### 16.4 Responsive debt must be named, not waved away

Known defects must either be fixed or carried explicitly as deferred debt with reason.

---

## 17. Commercial and auth integration rules

### 17.1 Public prediction surface remains public

Modernization must not accidentally move free prediction value behind auth.

### 17.2 Paywall is local to intent

Modernization must preserve the inline, intent-triggered gate model.

### 17.3 Auth is additive, not disruptive

Auth must be integrated as deferred capability, not as front-door friction.

### 17.4 Pro users suppress commercial display ads

Commercial display ad rendering must respect Pro entitlement.

### 17.5 Operational notices remain universal

Operational notices are not monetization assets and remain visible to all tiers.

---

## 18. Testing and acceptance modernization rules

### 18.1 Critical path journeys must become testable

At minimum, the modernization program must enable stable testing of:

- dashboard route rendering,
- competition navigation,
- track record public visibility,
- free prediction visibility,
- Pro-depth gate behavior,
- auth deferral flow,
- checkout return / Pro state refresh,
- ad suppression for Pro,
- degraded notice visibility.

### 18.2 Acceptance matrix remains binding

This modernization must preserve or enable conformance to active acceptance criteria.

### 18.3 Responsive issues must have verification targets

High-risk mobile/responsive issues must become explicitly verifiable.

---

## 19. Migration rules

### 19.1 No big-bang rewrite

The current app must be migrated incrementally.

### 19.2 Preserve working behavior while replacing structure

Do not discard working user value merely because the implementation is inelegant.

### 19.3 Replace top-level fragility first

The highest leverage targets are:

- routing,
- shell,
- competition registry,
- session-aware surface structure,
- track record visibility.

### 19.4 Visual polish comes after structural legitimacy

No major aesthetic pass should begin before shell, auth/freemium flow, and route structure are legitimate.

---

## 20. Forbidden shortcuts

The following are forbidden during modernization:

- adding more hardcoded competition branches to top-level app composition,
- introducing page-local provider calls,
- rendering Pro values in hidden DOM for free users,
- putting registration walls in first-visit flow,
- burying track record behind auth,
- solving theme changes with scattered one-off styling,
- shipping a “new look” without route/shell foundation,
- conflating operational warnings with commercial banners,
- treating responsive issues as cosmetic if they break flow,
- rewriting large surfaces without acceptance mapping.

---

## 21. Dependency guidance

The following dependency logic is binding at planning level.

### 21.1 Track record does not depend on auth

Public track record can and should ship before auth.

### 21.2 Paywall depends on auth assumptions but not on final visual polish

The gate pattern can be implemented before the final visual system is fully polished.

### 21.3 Route/shell work should begin before major visual redesign

Route and shell legitimacy are prerequisites to meaningful modernization.

### 21.4 Theme/announcement integration depends on design-system foundation

Do not build event/seasonal styling before token/semantic layer legitimacy exists.

### 21.5 Ad suppression depends on tier truth

Commercial ad suppression depends on reliable Pro-state rendering.

---

## 22. Completion criteria

This modernization program is only considered structurally successful when all of the following are true:

- primary product surfaces are route-addressable,
- competition context is data-driven,
- shell is coherent and stable,
- track record is public and first-class,
- deferred auth works,
- Pro gating is intentional and stable,
- commercial ads are suppressed for Pro,
- operational notices remain universal,
- major responsive debt items are addressed,
- critical-path UI tests exist,
- theme/token evolution no longer requires styling chaos.

A prettier interface without these properties is not success.

---

## 23. Deferred future considerations

### 23.1 Future SEO/SSR question

This modernization does not adopt SSR or SEO-led architecture now.

If discoverability requirements later justify it, that must enter as a separate decision backed by evidence.

### 23.2 Future experimentation

A/B testing of shell, paywall placement, or themes is deferred until foundations are stable.

### 23.3 Future white-labeling

Partner skins or multi-branding are explicitly out of scope for this modernization.

### 23.4 Future personalization

User-specific content tailoring remains outside the current frontend modernization program.

### 23.5 Future native adaptation

This program should make future native product work easier, but it does not directly design native app architecture.

---

## 24. One-paragraph summary

SportPulse frontend modernization is a structural program to evolve the current web app into a route-driven, mobile-respectful, freemium-capable product shell without violating snapshot-first, backend-owned truth. It prioritizes shell legitimacy, data-driven competition handling, public track record, deferred auth, Pro-depth gating, Pro ad suppression, theme/token discipline, responsive hardening, and testability. It forbids big-bang rewrites, cosmetic-only redesigns, and frontend semantic drift.
