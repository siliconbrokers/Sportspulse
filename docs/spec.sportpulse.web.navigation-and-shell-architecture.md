---
artifact_id: SPEC-SPORTPULSE-WEB-NAVIGATION-AND-SHELL-ARCHITECTURE
title: "Web Navigation and Shell Architecture"
artifact_class: spec
status: proposed
version: 0.1.0
project: sportpulse
domain: web
slug: navigation-and-shell-architecture
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
  - SPEC-SPORTPULSE-WEB-SITE-EXPERIENCE-CONFIG
  - SPEC-SPORTPULSE-WEB-THEME-AND-GLOBAL-ANNOUNCEMENT-SYSTEM
canonical_path: docs/web/spec.sportpulse.web.navigation-and-shell-architecture.md
---

# SportPulse — Web Navigation and Shell Architecture

Version: 0.1  
Status: Proposed  
Scope: Product-surface-first navigation, global shell, route model, competition context model, announcement placement, account/Pro entry points  
Audience: Product, Frontend, Backend, QA, AI-assisted development workflows

---

## 1. Purpose

This document defines the authoritative navigation and app-shell architecture for the SportPulse web product.

It exists to replace incremental navigation growth with a coherent structure that:

- scales to multiple competitions,
- preserves the two co-equal MVP pillars,
- exposes public trust surfaces clearly,
- supports auth/session and Pro flows without dominating first use,
- supports global announcements and future themed experiences,
- remains mobile-usable without collapsing into compression-only layout.

This spec is about structural information architecture and shell behavior.
It is not a visual design spec.

---

## 2. Authority and boundaries

This document is subordinate to:

1. Constitution
2. MVP Execution Scope
3. Acceptance Test Matrix
4. Implementation Backlog
5. Auth and Freemium Surface
6. Site Experience Config
7. Theme and Global Announcement System

This document is authoritative for:

- top-level product surfaces,
- primary navigation structure,
- shell composition,
- route semantics,
- global competition context,
- placement of account/session and Pro entry points,
- placement of global announcements,
- route/shareability expectations.

This document is not authoritative for:

- design tokens,
- payment processor behavior,
- prediction semantics,
- track record computation,
- subscription ledger design,
- API payload schemas beyond navigation needs.

---

## 3. Governing product decisions

The following product decisions are fixed for v1:

### 3.1 Product-surface-first shell
SportPulse navigation is organized by product surfaces, not by competition-first menu trees.

### 3.2 Global competition context
Competition is a persistent global context selector, not the primary navigation pillar.

### 3.3 Two-pillar MVP visibility
The product must visibly preserve:
- attention/dashboard surface,
- prediction + trust surface.

Neither pillar may be buried as a secondary or hidden feature.

### 3.4 Public trust surface
Track record is a primary public surface, not a hidden sub-feature.

### 3.5 Pro as upgrade surface, not core navigation blocker
Pro is visible as a first-class upgrade destination, but the navigation model must not imply that the core product is paywalled.

### 3.6 Account as persistent shell action
Auth/session/account is represented as a persistent shell action, not as one of the primary product pillars.

---

## 4. Non-negotiable invariants

### 4.1 Frontend-honest
The shell and routing layer must not invent semantic truth about predictions, eligibility, warnings, or track record.

### 4.2 Snapshot-first compatibility
Routes and shell state must remain compatible with snapshot-first consumption. UI navigation cannot imply ad hoc provider-driven truth or hidden recomputation.

### 4.3 Public value before auth
The primary navigation must remain meaningfully usable to anonymous users.

### 4.4 No competition hardcoding in shell logic
The navigation architecture must not depend on hardcoded competition-specific branches in top-level application code.

### 4.5 Mobile hierarchy, not compression-only behavior
The mobile shell must remain structurally understandable. Shrinking desktop layouts is not enough.

### 4.6 Announcements do not override product truth
Global announcements may appear in the shell, but they must not obscure operational warnings or alter semantic routing behavior.

---

## 5. Primary information architecture

### 5.1 Primary product surfaces
The primary navigation surfaces for v1 are:

1. `Resumen`
2. `Predicciones`
3. `Track record`
4. `Pro`

### 5.2 Persistent shell actions
The following are persistent shell actions, not primary pillars:

- competition selector
- date/jornada/ronda selector where relevant
- account/session entry point
- global announcement surface

### 5.3 Surface meanings

#### Resumen
The dashboard/attention surface.
Includes:
- dashboard overview
- treemap
- focused detail flow
- explainability
- warnings/degraded-state visibility

#### Predicciones
The match-centric prediction surface.
Includes:
- fixture/match list for active context
- 1X2 public predictions
- operating mode visibility
- Pro-depth entry points

#### Track record
The public trust/credibility surface.
Includes:
- aggregate track record by competition
- publication threshold handling
- walk-forward disclosure where applicable

#### Pro
The commercial/upgrade surface.
Includes:
- value proposition
- pricing/subscription entry point
- explanation of what Pro unlocks

### 5.4 Explicit non-pillars
The following are not primary navigation pillars in v1:
- login
- account settings
- checkout return
- legal pages
- support/help
- saved/followed entities
- competition-specific marketing pages

These may exist as secondary routes or shell actions, but not as primary product pillars.

---

## 6. Shell architecture

### 6.1 Shell layers
The v1 shell is composed of the following ordered layers:

1. global announcement strip (when active)
2. primary header / app bar
3. primary navigation row or mobile equivalent
4. contextual controls row
5. route content area

### 6.2 Global announcement strip
The announcement strip sits above the app bar when active.

It is reserved for:
- operational notices,
- editorial/product announcements,
- commercial or seasonal campaign messages,
subject to separate precedence rules in the announcement spec.

It must not replace system warnings that belong inside product content.

### 6.3 Primary header / app bar
The primary header must include:
- brand/home anchor
- competition selector
- account/session action
- space for Pro/account status cue if useful

### 6.4 Primary navigation row
The primary navigation row exposes:
- Resumen
- Predicciones
- Track record
- Pro

On narrow viewports this may become:
- top tabs,
- segmented header nav,
- bottom nav,
or equivalent, provided the four surfaces remain obvious.

### 6.5 Contextual controls row
The contextual controls row may include:
- date selector
- jornada/ronda selector
- group selector
- competition-specific filters

This row is context-dependent and must not become the primary navigation itself.

### 6.6 Content area
The content area renders the active route surface and may use surface-specific layouts.
The shell must remain stable while route content changes.

---

## 7. Competition context model

### 7.1 Competition as global context
Competition is a global product context that influences Resumen, Predicciones, and Track record.

### 7.2 Route-visible context
Competition must be reflected in the route, not only in local state.

### 7.3 Selector behavior
The competition selector must:
- list available competitions dynamically,
- avoid hardcoded top-level branches,
- keep current surface when switching competition where meaningful.

### 7.4 Context persistence
The application may persist last-used competition locally as convenience, but URL-visible context remains authoritative for navigation/shareability.

### 7.5 Surface-specific interaction
When competition changes:
- Resumen updates to that competition context,
- Predicciones updates to that competition context,
- Track record updates to that competition context,
- Pro remains global and may optionally preserve last context in CTA metadata only.

---

## 8. Route model

### 8.1 Route design goals
Routes must be:
- shareable,
- bookmarkable,
- deep-link-capable,
- recoverable on refresh,
- compatible with browser back/forward.

### 8.2 Canonical route shape
The canonical v1 route model is surface-first with competition in path context:

- `/:competitionId/resumen`
- `/:competitionId/predicciones`
- `/:competitionId/track-record`
- `/pro`
- `/cuenta`
- `/login`
- `/auth/callback` or equivalent if needed
- `/checkout/return` or equivalent if needed

### 8.3 Query parameters
Query params may be used only for secondary state such as:
- focused team/match
- selected jornada/ronda/group
- temporary UI focus state

They must not replace primary surface routing.

### 8.4 Forbidden route patterns
The following are forbidden in v1:
- top-level hardcoded route trees per competition in app shell code
- entire navigation encoded only in query params
- auth hidden behind opaque modal-only state with no recoverable route
- Pro-only route gates for the whole prediction surface

---

## 9. Surface-by-surface shell behavior

### 9.1 Resumen surface
The shell must provide:
- clear active-surface indication
- competition context visible
- contextual controls if needed for dashboard focus/date
- uninterrupted access to detail flow

This surface is the dashboard pillar.

### 9.2 Predicciones surface
The shell must provide:
- active-surface indication
- competition context visible
- date/jornada/ronda/group controls where relevant
- clear visibility of public prediction surface
- contextual path into Pro-depth gates

This surface is not itself paywalled.

### 9.3 Track record surface
The shell must provide:
- active-surface indication
- competition context visible
- no auth requirement in v1
- clear threshold/disclosure states

This surface exists to expose trust publicly.

### 9.4 Pro surface
The shell must provide:
- clear upgrade destination
- account/session awareness when helpful
- no confusion with account settings

Pro is commercial surface, not product-admin surface.

### 9.5 Account/session surface
Account/session is reached through shell action, not primary tab.
It may expose:
- login / session state
- subscription status
- account basics

Detailed account management is not a primary product pillar.

---

## 10. Mobile behavior requirements

### 10.1 Structural requirement
Mobile must preserve the same primary IA:
- Resumen
- Predicciones
- Track record
- Pro

### 10.2 Allowed mobile nav patterns
Allowed patterns include:
- bottom navigation
- top tab navigation
- compact segmented nav
- hybrid header + overflow menu

Only if the four primary surfaces remain obvious and first-class.

### 10.3 Forbidden mobile degradations
The following are forbidden:
- hiding Track record in a secondary drawer by default
- burying Pro only inside account menu
- making competition switching inaccessible without excessive drill-down
- converting shell into a dense desktop header squeezed into mobile width

### 10.4 Detail interactions
Surface-specific detail flows on mobile may use:
- full-screen overlays
- sheets
- routed detail screens

provided they preserve return-path clarity and do not break shell comprehension.

---

## 11. Auth and Pro interactions with navigation

### 11.1 Anonymous usability
Anonymous users must be able to navigate:
- Resumen
- Predicciones
- Track record
- Pro
without being blocked by login.

### 11.2 Login placement
Login/auth is initiated from:
- shell account action, or
- inline gated action when attempting Pro depth.

### 11.3 Pro placement
Pro remains a visible public route even for anonymous users.
This allows users to understand upgrade value without first authenticating.

### 11.4 No auth-first shell
The shell must not center login/account as the default purpose of the product.

---

## 12. Announcement and notice placement

### 12.1 Shell placement
Global announcements render at shell level, above the app bar.

### 12.2 Content-level warnings
Prediction/dashboard warnings and degraded-state indicators remain inside relevant product surfaces.
They are not replaced by generic shell banners.

### 12.3 Priority principle
Operational truth has higher priority than decorative or campaign messaging.

### 12.4 Pro users
Pro users may continue to see:
- operational notices,
- product-owned notices,
while commercial display ads follow separate tier rules.

---

## 13. Competition registry and scalability rules

### 13.1 Dynamic registry
Available competitions must come from a dynamic competition registry, not shell hardcoding.

### 13.2 Registry responsibilities
The registry should expose enough metadata to render:
- competition label
- canonical route slug/id
- availability status
- optional ordering metadata
- optional tournament structure metadata if needed later

### 13.3 No route duplication per competition
Shell code must not duplicate route definitions for each competition.

### 13.4 Tournament structure growth
Future structured tournaments may add contextual controls, but must not force a new primary IA if the current shell is correct.

---

## 14. Error and fallback behavior

### 14.1 Unknown competition
If a route references an unknown or unavailable competition:
- fail gracefully,
- show recoverable state,
- provide return path to valid context.

### 14.2 Missing session state
Navigation must not collapse if auth/session state is unknown or loading.
Primary surfaces remain navigable.

### 14.3 Announcement/config failure
If shell-level announcement/config data fails:
- fallback to no announcement,
- do not block primary navigation.

### 14.4 Route recovery
Refresh/re-entry on any canonical product route must recover to the same product surface and context whenever possible.

---

## 15. Acceptance mapping

This spec is structurally linked to:

- dashboard visibility and detail flow expectations
- prediction public/free surface
- public track record visibility
- K-04 / K-05 / K-06 via correct entry points into auth/paywall flows

Follow-up navigation-specific acceptance cases should be added or refined if not already covered, including:

- N-01 — canonical route recovery by surface and competition
- N-02 — competition switch preserves surface when valid
- N-03 — anonymous user can access Resumen/Predicciones/Track record/Pro without login
- N-04 — mobile shell exposes all four primary surfaces
- N-05 — Track record remains a first-class public route

---

## 16. Implementation notes (non-authoritative)

The following are implementation-direction notes only:

- shell should likely be driven by a centralized route config
- competition registry should be shared data, not view-local branching
- top-level app component should lose competition-specific branching logic
- session/account cue should be injected into shell, not duplicated across surfaces
- mobile nav selection should come from the same primary IA source as desktop nav

These notes do not override module boundaries.

---

## 17. Explicit non-goals

This spec does not define:

- final visual styling,
- design tokens,
- bottom-nav vs top-tab visual choice as final art direction,
- subscription billing mechanics,
- saved/favorites feature behavior,
- SEO strategy,
- native app navigation,
- CMS/editorial tooling,
- competition-specific microsites.

---

## 18. Deferred future considerations

### 18.1 Future surface expansion
Potential future surfaces may include:
- Following/Saved
- Alerts/Notifications
- Account preferences
- Editorial hubs

Not in v1 because they are not required to validate the current MVP pillars.

### 18.2 Future competition-specific experiences
Some tournaments may later justify special shell overlays or event modes.
That does not change the primary IA in v1.

### 18.3 Future audience targeting in shell
Audience-specific shell variants may later exist, but v1 must keep the shell globally understandable.

### 18.4 Future native parity
Native-app navigation may later diverge where platform conventions justify it.
That is out of scope for the current web architecture.

---

## 19. One-paragraph summary

SportPulse web navigation in v1 is product-surface-first, not competition-first. The primary pillars are Resumen, Predicciones, Track record, and Pro; competition is a persistent global context, while account/auth remains a shell action rather than a primary pillar. Routes must be canonical, shareable, and recoverable, and the shell must support announcements, competition switching, and auth/paywall entry points without compromising anonymous usability or the public visibility of trust surfaces.
