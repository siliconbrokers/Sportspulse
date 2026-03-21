---
artifact_id: SPEC-SPORTPULSE-WEB-AUTH-AND-FREEMIUM-SURFACE
title: "Web Auth and Freemium Surface"
artifact_class: spec
status: proposed
version: 0.1.0
project: sportpulse
domain: web
slug: auth-and-freemium-surface
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
  - SPEC-SPORTPULSE-WEB-NAVIGATION-AND-SHELL-ARCHITECTURE
  - SPEC-SPORTPULSE-WEB-SITE-EXPERIENCE-CONFIG
  - SPEC-SPORTPULSE-WEB-THEME-AND-GLOBAL-ANNOUNCEMENT-SYSTEM
canonical_path: docs/web/spec.sportpulse.web.auth-and-freemium-surface.md
---

# SportPulse — Web Auth and Freemium Surface

Version: 0.1  
Status: Proposed  
Scope: Auth model, session model, freemium split, paywall trigger rules, Pro-state behavior, ad suppression for Pro  
Audience: Product, Frontend, Backend, QA, Ops, AI-assisted development workflows

---

## 1. Purpose

This document defines the web-product contract for:

- anonymous vs authenticated behavior,
- free vs Pro behavior,
- auth entry points,
- paywall trigger behavior,
- post-checkout session behavior,
- ad visibility rules by tier.

It exists to remove ambiguity before implementing:

- auth/session,
- Stripe subscription flow,
- Pro gating,
- freemium UX,
- ad suppression behavior.

This spec is authoritative for user-facing tier behavior in the web product.

---

## 2. Authority and boundaries

This document is subordinate to:

1. Constitution
2. MVP Execution Scope
3. Acceptance Test Matrix
4. Implementation Backlog
5. Navigation and Shell Architecture
6. Site Experience Config
7. Theme and Global Announcement System

This document is authoritative for:

- auth entry and session rules,
- free/Pro surface split,
- paywall trigger semantics,
- ad suppression rules by subscription tier,
- unauthenticated fallback behavior.

This document is not authoritative for:

- payment processor internals,
- backend subscription ledger design,
- visual design tokens,
- prediction semantics,
- track record computation logic,
- runtime config transport details.

---

## 3. Governing product decisions

The following product decisions are fixed for v1:

### 3.1 Navigation assumption
SportPulse uses a product-surface-first shell:
- Resumen
- Predicciones
- Track record
- Pro
- Cuenta/Auth as persistent shell action

Competition is global context, not primary navigation axis.

### 3.2 Auth model
Auth is:
- anonymous-first
- email magic link based
- session-based in web
- no password flow in v1
- no OAuth/social login in v1

### 3.3 Paywall model
The paywall is:
- inline
- intent-triggered
- attached to Pro-depth access
- never shown on first visit
- never used to hide the basic prediction or public track record

### 3.4 Tier commercial rule
Pro subscribers do not see commercial display ads in the web product.

Operational notices remain visible to all tiers.

---

## 4. Non-negotiable invariants

### 4.1 Frontend-honest
The frontend must not compute subscription truth, prediction truth, or track record truth.
It only renders backend-provided state and applies presentation gating.

### 4.2 Public value before friction
The product must show enough value before requiring registration or payment.

### 4.3 Public trust surfaces remain public
The following are not gated behind auth or Pro in v1:
- dashboard
- prediction 1X2 surface
- track record aggregate
- model availability / operating mode
- degraded-state warnings

### 4.4 Pro depth is a presentation gate
Backend may return the full prediction payload; frontend applies display gating for non-Pro states.

### 4.5 Registration deferral is mandatory
The product must not request registration on first visit.
Registration is triggered only by:
- a Pro-gated action, or
- an explicit persistence action such as save/bookmark if later introduced.

### 4.6 Operational notices are not ads
Operational notices, degraded-state warnings, and service-status banners are not suppressed for Pro users.

---

## 5. User state model

The web product recognizes the following user states:

### 5.1 Anonymous
- no authenticated session
- can consume all public/free surfaces
- cannot access Pro depth
- can be prompted to authenticate when attempting a gated action

### 5.2 Authenticated / non-Pro
- valid authenticated session
- active user identity exists
- no active Pro entitlement
- can consume all public/free surfaces
- sees paywall CTA when attempting Pro depth

### 5.3 Authenticated / Pro
- valid authenticated session
- active Pro entitlement
- sees all public/free surfaces
- sees all Pro depth surfaces
- does not see commercial display ads

### 5.4 Session-loading
- transient client state during hydration / refresh
- UI must avoid flashing contradictory tier states
- Pro depth must remain withheld until session state is resolved

### 5.5 Session-expired
- previously authenticated state is no longer valid
- user returns to anonymous behavior
- Pro-only surfaces must re-gate cleanly
- no stale Pro unlock may persist in UI

---

## 6. Auth model (v1)

### 6.1 Entry principle
The site is usable without login.

Auth is requested only when the user attempts:
- to access Pro depth, or
- a later-defined persistence action.

### 6.2 Auth method
The v1 auth method is:
- email magic link
- no password
- no OAuth/social identity
- no profile-completion wizard

### 6.3 Session transport
The v1 web session is server-backed and represented in the browser via secure session mechanism.

Preferred implementation direction:
- secure httpOnly cookie
- frontend-visible derived session state from API/session endpoint

### 6.4 Minimal session shape exposed to frontend
Frontend may consume only a minimal derived session model:

- `sessionStatus`: `anonymous | loading | authenticated | expired`
- `userId`
- `email`
- `tier`: `free | pro`
- `isPro`
- `sessionIssuedAt` or equivalent freshness indicator if useful

Frontend must not infer entitlement from local heuristics.

### 6.5 Out of scope in v1
- password login
- forgot-password flow
- social login
- profile customization
- multi-account linking
- user preference center
- personalized prediction history

---

## 7. Freemium surface contract

### 7.1 Public / free surfaces
The following remain visible to all users:

#### Dashboard pillar
- dashboard
- treemap
- team detail
- explainability
- warnings / degraded-state indicators

#### Prediction pillar
- 1X2 calibrated probabilities
- operating mode / availability state
- NOT_ELIGIBLE graceful message
- lightweight model explanation stub

#### Trust / moat surface
- public aggregate track record by competition
- prediction count
- last evaluated timestamp or equivalent freshness field
- below-threshold message when applicable
- walk-forward disclosure when historical evaluation is shown before operational threshold

### 7.2 Pro-only surfaces
The following are Pro-only in v1:

- scoreline distribution
- xG-related depth fields
- O/U markets
- BTTS markets
- any equivalent depth analytics explicitly classified as Pro depth

### 7.3 What free users must still understand
A free user must still understand:
- that a prediction exists,
- what the basic 1X2 view is,
- whether the model was eligible,
- that deeper analysis exists,
- why Pro may be worth paying for.

The free experience must not feel empty or fake.

---

## 8. Paywall trigger rules

### 8.1 Primary trigger
The primary paywall trigger is:
- user intent to access the Pro-depth section of a prediction surface.

This may be implemented as:
- expanding a locked depth block,
- tapping a “Ver análisis Pro” CTA,
- opening a gated detail subsection.

### 8.2 Anonymous user behavior
If the user is anonymous and attempts a Pro-gated action:

1. show auth prompt first
2. complete auth if successful
3. re-evaluate tier
4. if still non-Pro, show paywall / upgrade surface
5. if Pro, open the requested depth surface directly

### 8.3 Authenticated non-Pro behavior
If the user is authenticated but non-Pro and attempts a Pro-gated action:

- show paywall surface immediately
- explain what Pro unlocks
- allow upgrade path to checkout
- preserve context of attempted action when practical

### 8.4 Authenticated Pro behavior
If the user is Pro:

- no paywall
- no intermediate gate
- depth renders directly

### 8.5 Forbidden trigger patterns
The following are forbidden in v1:

- registration modal on first visit
- hard route-level lock for the entire prediction surface
- hiding track record behind auth
- hiding 1X2 behind auth
- paywalling dashboard or explainability
- generic full-screen subscription interruption before value is shown

---

## 9. Paywall surface contract

### 9.1 Minimum contents
The paywall surface must state clearly:

- what is currently visible for free
- what Pro unlocks
- why the depth is useful
- how to upgrade
- that public track record remains visible

### 9.2 Placement
The primary paywall surface is inline or context-attached to the gated depth region.

Secondary entry points may exist in:
- Pro page
- contextual CTA blocks in relevant product areas

### 9.3 Anti-patterns
The paywall must not:
- replace the whole screen unexpectedly
- look like an error state
- conceal the fact that basic prediction remains public
- render actual Pro values in hidden DOM for free users

---

## 10. Post-checkout behavior

### 10.1 Subscription completion
After successful checkout, the product must reflect Pro entitlement in the same browsing session.

### 10.2 Required frontend behavior
After checkout return:

- session must refresh or rehydrate
- Pro state must become visible without requiring manual relogin
- paywall block must disappear for now-entitled users
- the previously requested Pro depth should be recoverable when practical

### 10.3 Failure handling
If checkout succeeds but session is temporarily stale:

- show a transitional “verificando suscripción” state
- retry session refresh
- avoid showing contradictory free/paywall states as final truth
- provide fallback action to refresh entitlement manually

---

## 11. Ads and notices by tier

### 11.1 Commercial ads
Commercial display ads are allowed only for non-Pro users, subject to separate placement rules.

### 11.2 Pro ad suppression
Authenticated Pro users do not see commercial display ads anywhere in the web product.

### 11.3 What is NOT suppressed for Pro
The following remain visible to Pro users:

- operational notices
- degraded-state warnings
- service-status banners
- mandatory legal/compliance notices
- product-owned informational notices that are not commercial ads

### 11.4 Distinction requirement
The system must distinguish clearly between:

- commercial ads
- editorial/product announcements
- operational notices
- system warnings

These categories must not share accidental rendering rules.

### 11.5 No fake suppression
If an ad slot is empty because Pro suppresses commercial ads, the UI must not leave broken chrome or placeholder gaps.

---

## 12. Route and shell interaction rules

### 12.1 Public routes
These routes remain publicly accessible:
- dashboard/resumen
- predicciones
- track-record
- pro page (pricing/info)

### 12.2 Auth routes
Login/auth completion routes are public-entry technical routes but only relevant during auth flow.

### 12.3 Account surface
The account surface is visible only as shell action or session entry point.
It is not a primary product pillar.

### 12.4 No route-level Pro wall in v1
The Pro contract in v1 is depth gating, not full-route gating.

---

## 13. Error and degraded behavior

### 13.1 Session uncertainty
When auth/session state is loading, Pro depth must remain gated until the tier is known.

### 13.2 Subscription lookup failure
If entitlement cannot be confirmed:
- fail closed for Pro depth
- do not expose Pro content optimistically
- show recoverable status message if needed

### 13.3 Track record threshold
If the competition is below the publication threshold:
- show non-numeric below-threshold state
- do not fabricate or expose premature accuracy metrics

### 13.4 Operational degradation
If the product is degraded:
- warnings remain visible to all users
- Pro status does not suppress operational truth

---

## 14. Acceptance mapping

This spec maps directly to the following acceptance obligations:

- K-04 — Pro depth paywall gate
- K-05 — Pro subscription flow
- K-06 — Registration deferral

A follow-up acceptance test should be added:

- K-07 — Pro commercial ad suppression

### Proposed K-07
**Precondition (free tier):** active commercial ad slot configured.  
**Expected:** commercial ad slot may render for anonymous/free user.

**Precondition (Pro tier):** authenticated user with active Pro subscription.  
**Expected:** commercial ad slot does not render.

**Invariant:** operational notices and mandatory service-status banners still render for all tiers.  
**Pass gate:** Pro user DOM contains no commercial ad slot output; operational/system notices remain visible when active.

---

## 15. Implementation notes (non-authoritative)

The following are implementation-direction notes, not product truth:

- frontend likely needs `AuthContext` or equivalent session provider
- session hydration should happen once near app shell
- paywall gate component should wrap only Pro-depth regions
- ad suppression should use semantic slot classification, not ad-hoc per-component checks
- post-checkout rehydration should be explicit, not assumed

These notes guide engineering but do not override package boundaries.

---

## 16. Explicit non-goals

This spec does not define:

- Stripe backend ledger design
- revenue analytics
- user account settings
- saved matches/favorites implementation
- mobile-native auth UX
- multi-device subscription reconciliation
- notification loops
- personalized prediction history

---

## 17. Deferred future considerations

### 17.1 Future auth expansion
Possible future additions:
- social login
- multi-method auth
- account preferences

Not in v1 because they increase complexity without helping the current MVP proof.

### 17.2 Future freemium refinement
Possible future additions:
- multiple Pro tiers
- temporary premium unlocks
- trial logic
- campaign-based upgrade offers

Not in v1 because the first requirement is a clean, binary free/Pro contract.

### 17.3 Future ad model refinement
Possible future additions:
- ad targeting by audience or route
- reduced-ad tier
- sponsor surfaces by competition

Not in v1 because the current decision only needs binary suppression for Pro.

### 17.4 Future persistence actions
Save/bookmark/follow actions may later become auth-triggering surfaces.
They are not part of the current MVP unless separately approved.

---

## 18. One-paragraph summary

SportPulse web auth and freemium behavior in v1 is anonymous-first, magic-link-based, session-backed, and designed to show public value before asking for identity or payment. Dashboard, 1X2 predictions, operating mode, warnings, and public track record remain visible to all users. Pro depth is gated only at the moment of intent, first through deferred auth when needed and then through an inline paywall for non-Pro users. Successful checkout must unlock Pro depth in the same session. Commercial ads are shown only to non-Pro users; operational truth remains visible to all tiers.
