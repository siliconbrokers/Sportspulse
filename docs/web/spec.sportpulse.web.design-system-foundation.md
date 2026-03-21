---
artifact_id: SPEC-SPORTPULSE-WEB-DESIGN-SYSTEM-FOUNDATION
title: "Web Design System Foundation"
artifact_class: spec
status: proposed
version: 0.2.0
project: sportpulse
domain: web
slug: design-system-foundation
owner: team
created_at: 2026-03-21
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-CORE-CONSTITUTION
  - SPEC-SPORTPULSE-CORE-MVP-EXECUTION-SCOPE
  - SPEC-SPORTPULSE-WEB-NAVIGATION-AND-SHELL-ARCHITECTURE
  - SPEC-SPORTPULSE-WEB-AUTH-AND-FREEMIUM-SURFACE
  - SPEC-SPORTPULSE-WEB-THEME-AND-GLOBAL-ANNOUNCEMENT-SYSTEM
  - SPEC-SPORTPULSE-WEB-SITE-EXPERIENCE-CONFIG
  - SPEC-SPORTPULSE-WEB-FRONTEND-EXECUTION-BACKLOG
  - SPEC-SPORTPULSE-QA-ACCEPTANCE-TEST-MATRIX
canonical_path: docs/web/spec.sportpulse.web.design-system-foundation.md
---

# SportPulse — Web Design System Foundation

Version: 0.2  
Status: Proposed  
Scope: Visual grammar, token model, semantic styling rules, component-state styling contract  
Audience: Product, Frontend, Design, QA, AI-assisted development workflows

---

## 1. Purpose

This document defines the visual foundation of the SportPulse web product.

It exists to stop visual drift, remove styling ambiguity, and create a reusable system that supports:

- a stable product identity,
- dark/light correctness,
- future theme variants,
- predictable component styling,
- responsive consistency,
- reduced frontend rework.

This document is not a moodboard and not a page-redesign document.
It defines the visual contract that all web surfaces must inherit.

---

## 2. Authority and scope

This document is subordinate to:

1. Constitution
2. MVP Execution Scope
3. Navigation and Shell Architecture
4. Auth and Freemium Surface
5. Theme and Global Announcement System
6. Site Experience Config

This document is authoritative for:

- design token categories,
- semantic token naming,
- typography scale,
- spacing scale,
- radius/elevation/border rules,
- state styling rules,
- dark/light token mapping,
- prohibited styling patterns.

This document is not authoritative for:

- business logic,
- routing,
- paywall rules,
- announcement targeting,
- runtime theme activation,
- subscription entitlements.

---

## 3. Design goals

The SportPulse web UI must feel:

- modern,
- compact without becoming cramped,
- credible,
- analytical,
- fast to scan,
- visually disciplined,
- themable without component rewrites.

The system must avoid two common failures:

1. generic betting-site visual noise,
2. enterprise-dashboard sterility disconnected from live sports energy.

The target posture is: **high-signal sports intelligence product**.

---

## 4. Core visual principles

### 4.1 Information-first
Visual design must clarify hierarchy and reduce cognitive load.
Decoration is allowed only if it preserves scan speed.

### 4.2 Brand through system, not hacks
Sport identity must emerge from token usage, density, typography, emphasis, and motion restraint.
It must not depend on ad hoc gradients, one-off shadows, or hand-tuned pages.

### 4.3 Semantic styling over raw values
Components must consume semantic tokens.
They must not hardcode raw color values except in narrowly approved low-level token definitions.

### 4.4 Calm surfaces, energetic accents
Base surfaces should remain controlled and legible.
Energy belongs in accents, status markers, selection states, live/context indicators, and event overlays.

### 4.5 Predictable contrast
All primary text, important numeric content, and critical state indicators must remain legible in both light and dark themes.

### 4.6 Density with discipline
The product may be information-dense, but density must be governed by scale rules, not by arbitrary padding collapse.

### 4.7 Theme-safe by construction
Every component must be styleable through tokens in a way that supports future theme packs without structural rewrites.

---

## 5. Token architecture

The design system uses three layers:

1. **Foundation tokens** — raw visual primitives
2. **Semantic tokens** — product-meaning aliases
3. **Component tokens/slots** — optional component-scoped mappings for complex reusable primitives

### 5.1 Foundation token rule
Foundation tokens define raw values only.
Examples:
- palette steps
- spacing units
- radius sizes
- shadow levels
- type sizes
- line heights

Foundation tokens must not encode business meaning.

### 5.2 Semantic token rule
Semantic tokens map product meaning to foundation tokens.
Examples:
- `surface-base`
- `text-primary`
- `accent-brand`
- `border-subtle`
- `state-success`

Components should consume semantic tokens by default.

### 5.3 Component token rule
Component tokens are allowed when semantic tokens alone are not precise enough.
Examples:
- `match-card-surface`
- `paywall-locked-surface`
- `notice-operational-border`

Component tokens must still be expressed in terms of semantic tokens, not raw values.

---

## 6. Foundation tokens

### 6.1 Color foundation
The system should define neutral, brand, and feedback families.

#### Required families
- neutral
- brand-primary
- brand-secondary
- success
- warning
- danger
- info
- premium-accent
- live-accent

#### Required steps
Each family should define a minimum usable scale for theme mapping, for example:
- 50
- 100
- 200
- 300
- 400
- 500
- 600
- 700
- 800
- 900

Exact numeric names may vary, but the system must provide enough steps for:
- surface usage,
- border usage,
- hover/active states,
- text/icon contrast,
- overlays.

### 6.2 Spacing foundation
Required spacing scale must be discrete and reusable.

Recommended v1 scale:
- 0
- 2
- 4
- 6
- 8
- 12
- 16
- 20
- 24
- 32
- 40
- 48
- 64

No arbitrary spacing values should appear in product components unless justified.

### 6.3 Typography foundation
Required font categories:
- display/headline
- body/ui
- mono/numeric-support (optional but recommended)

Required size ladder should support:
- page title
- section title
- card title
- body
- secondary body
- caption
- micro/meta

Typography must prioritize numeric clarity and compact scan performance.

### 6.4 Radius foundation
Required radius levels:
- none
- small
- medium
- large
- xlarge
- pill/full

### 6.5 Elevation foundation
Required elevation levels:
- none
- low
- medium
- high

Elevation must remain subtle.
The product is not a glassmorphism toy.

### 6.6 Border foundation
Required border widths:
- hairline/subtle
- default
- strong

### 6.7 Motion foundation
V1 motion must remain restrained.
Required categories:
- fast micro-interaction
- standard interaction
- overlay/sheet transition

Motion must never be required for comprehension.

---

## 7. Semantic token categories

The following semantic categories are mandatory.

### 7.1 Surface tokens
Examples:
- `surface-base`
- `surface-elevated`
- `surface-subtle`
- `surface-muted`
- `surface-overlay`
- `surface-inverse`
- `surface-premium`
- `surface-warning`
- `surface-danger`
- `surface-success`

### 7.2 Text tokens
Examples:
- `text-primary`
- `text-secondary`
- `text-tertiary`
- `text-inverse`
- `text-muted`
- `text-accent`
- `text-success`
- `text-warning`
- `text-danger`

### 7.3 Border tokens
Examples:
- `border-default`
- `border-subtle`
- `border-strong`
- `border-accent`
- `border-success`
- `border-warning`
- `border-danger`

### 7.4 Icon tokens
Examples:
- `icon-primary`
- `icon-secondary`
- `icon-accent`
- `icon-muted`
- `icon-inverse`

### 7.5 Accent tokens
Examples:
- `accent-brand`
- `accent-live`
- `accent-premium`
- `accent-selected`
- `accent-focus`

### 7.6 Feedback/state tokens
Examples:
- `state-success`
- `state-warning`
- `state-danger`
- `state-info`
- `state-disabled`

### 7.7 Overlay tokens
Examples:
- `overlay-backdrop`
- `overlay-scrim`
- `overlay-locked`
- `overlay-selected`

---

## 8. Product-specific semantic roles

The following semantic roles are explicitly relevant to SportPulse and must be supported:

### 8.1 Analytical surfaces
For dashboard, prediction, and detail surfaces.
They must appear trustworthy and data-forward.

### 8.2 Premium surfaces
Used for Pro depth teasers, locked states, upgrade prompts, and premium affordances.
These must signal differentiated value without looking gaudy.

### 8.3 Track record surfaces
Must emphasize credibility, comparability, historical grounding, and threshold honesty.

### 8.4 Operational notice surfaces
Must remain clearly distinct from promotional and commercial surfaces.

### 8.5 Seasonal/event overlays
Must be achievable by token overrides, not component rewrites.

---

## 9. Typography system

### 9.1 Typography intent
The typography system must support:
- rapid numeric comparison,
- compact card layouts,
- clear hierarchy,
- strong readability on mobile.

### 9.2 Required hierarchy
At minimum define:
- `display-lg`
- `display-md`
- `heading-lg`
- `heading-md`
- `heading-sm`
- `body-lg`
- `body-md`
- `body-sm`
- `label-md`
- `label-sm`
- `caption`
- `micro`

### 9.3 Numeric readability
Scores, probabilities, and key metrics should use a typography treatment that preserves alignment and scanability.
If a dedicated numeric style is introduced, it must be documented and reusable.

### 9.4 Font weight discipline
Do not simulate hierarchy by random weight jumps.
Define a small, repeatable set of weights.

---

## 10. Spacing and layout rhythm

### 10.1 Spacing rule
All component internal spacing and inter-component spacing must come from the spacing scale.

### 10.2 Density tiers
V1 should support at least conceptually:
- comfortable
- compact

If only one density is implemented now, it should map cleanly to a future density toggle.

### 10.3 Mobile rhythm
On small screens, spacing reductions must remain scale-based and not devolve into arbitrary compression.

---

## 11. Radius, border, and elevation rules

### 11.1 Radius
Rounded corners are allowed and encouraged, but radius choices must reinforce hierarchy.
Do not use a different radius on every card.

### 11.2 Borders
Borders are allowed to define grouping, separation, and state.
They should not compensate for poor spacing.

### 11.3 Elevation
Use elevation sparingly:
- overlays,
- floating elements,
- selected/high-focus surfaces,
- key CTA layers.

Do not stack shadows aggressively.

---

## 12. State styling rules

Every interactive component must define tokenized styles for:

- default
- hover
- active
- selected
- focus-visible
- disabled
- loading (if applicable)
- locked/gated (if applicable)

### 12.1 Focus-visible
Focus styling must be unambiguous and theme-safe.
It must not rely only on subtle color shifts.

### 12.2 Locked/gated state
Locked Pro surfaces must clearly communicate:
- accessible shell structure,
- unavailable depth content,
- CTA affordance,
- absence of exposed locked values.

### 12.3 Disabled vs unavailable
Disabled controls and unavailable product states must not share identical styling if they mean different things.

---

## 13. Dark/light theme mapping

### 13.1 Principle
Dark and light are not independent designs.
They are theme mappings of the same semantic system.

### 13.2 Rule
Components must consume semantic tokens in a way that allows the same component to render correctly in both modes.

### 13.3 Forbidden pattern
Do not create separate component CSS branches for light and dark if token mapping can solve it.

### 13.4 Contrast requirement
Text, icons, borders, and overlays must maintain legibility across both modes.

---

## 14. Component styling contract

The following product surfaces must be explicitly supported by the token model.

### 14.1 App shell
Must support:
- stable header/nav background,
- active state,
- global context controls,
- account action,
- announcements,
- operational notice stacking.

### 14.2 Competition context controls
Must support:
- selected state,
- hover/focus,
- compact mobile treatment,
- overflow-safe rendering.

### 14.3 Match cards
Must support:
- default analytical card styling,
- hover/focus,
- selected/expanded treatment,
- locked Pro depth subsection,
- operational/degraded inline state when needed.

### 14.4 Prediction cards / blocks
Must support:
- public 1X2 emphasis,
- clear depth boundary,
- premium accent without visual spam,
- stateful display for FULL_MODE, LIMITED_MODE, NOT_ELIGIBLE.

### 14.5 Track record surface
Must support:
- credibility-first visual tone,
- below-threshold state,
- numeric comparability,
- walk-forward disclosure styling.

### 14.6 Paywall surface
Must support:
- premium positioning,
- readable benefit hierarchy,
- non-error locked state,
- strong CTA emphasis.

### 14.7 Notices
Must distinguish clearly between:
- operational notices,
- editorial/product announcements,
- commercial banners,
- warning/error blocks.

---

## 15. Naming rules

### 15.1 Token naming
Naming must be:
- semantic,
- reusable,
- stable,
- not page-specific.

### 15.2 Forbidden names
Avoid names like:
- `homeCardBlue`
- `matchBgSpecial`
- `headerChristmasGreen`

These are implementation traps.

### 15.3 Preferred pattern
Use names like:
- `surface-base`
- `accent-brand`
- `notice-operational-surface`
- `paywall-border`

---

## 16. Allowed implementation forms

The design system may be implemented through:
- CSS custom properties,
- Tailwind theme extension,
- token files,
- typed theme objects,
- a combination of the above.

Implementation form is flexible.
Token contract is not.

---

## 17. Prohibited patterns

The following are prohibited except by narrow, documented exception:

- raw hex colors in product components,
- page-specific ad hoc token names,
- one-off box-shadow tuning in feature code,
- arbitrary spacing values,
- light/dark hardcoded branches per component,
- component styles coupled directly to event themes,
- using warning styling for promotions,
- using premium styling for operational alerts.

---

## 18. V1 scope

### 18.1 Included in v1
V1 must define:
- token architecture,
- semantic color model,
- typography scale,
- spacing scale,
- radius/elevation/border rules,
- state rules,
- dark/light mapping strategy,
- component-category styling expectations,
- anti-pattern rules.

### 18.2 Explicitly not required in v1
V1 does not require:
- full Figma library,
- exhaustive component catalog,
- animation system expansion,
- white-label support,
- accessibility preference themes beyond good baseline practice,
- CMS-driven styling,
- runtime theme targeting.

---

## 19. Product-wide style safety contract

### 19.1 Definitions

#### Active product surface
Any user-reachable web surface that is part of the current live product footprint, including:
- app shell,
- primary navigation,
- competition context controls,
- dashboard containers,
- treemap wrapper and surrounding chrome,
- detail panel,
- match cards,
- prediction cards/blocks,
- track record surfaces,
- paywall surfaces,
- auth/session surfaces,
- Pro page surfaces,
- notices/announcement bar,
- loading / empty / error / degraded states.

#### Critical surface
A subset of active product surfaces whose styling consistency is required before controlled visual evolution can begin safely.

#### Documented exception
A narrowly approved, temporary styling deviation that is:
- explicitly listed,
- justified,
- bounded in scope,
- time-limited or rollout-limited,
- not silently proliferated.

#### Style-safe surface
A surface that:
- consumes semantic tokens,
- does not rely on raw visual values in feature code,
- responds correctly to theme changes,
- does not require component-level rewrites when a theme pack changes.

#### Style-safe product
A product state where every active product surface is either:
- style-safe, or
- a documented exception.

### 19.2 Coverage levels

#### Level A — Critical-surface style safety
Level A is achieved when all critical surfaces are style-safe.

Level A is sufficient to support:
- shell-safe theme changes,
- controlled announcement styling,
- controlled seasonal/event overlays,
- serious visual iteration without styling chaos.

Level A is **not** sufficient to claim product-wide global style propagation.

#### Level B — Active-product style propagation readiness
Level B is achieved when the full active product surface inventory is style-safe, except for documented exceptions.

Only Level B permits the claim that a site-wide style change can propagate across the active product without per-surface manual rework.

### 19.3 Mandatory active product surface inventory

The following inventory must be used as the minimum rollout and audit checklist.

| Surface | Minimum level | Tokenization required | Documented exception allowed? |
| --- | --- | --- | --- |
| App shell | Level A | Yes | Narrowly, temporarily |
| Primary navigation | Level A | Yes | Narrowly, temporarily |
| Competition context controls | Level A | Yes | Narrowly, temporarily |
| Dashboard containers | Level A | Yes | Narrowly, temporarily |
| Treemap wrapper / surrounding chrome | Level A | Yes | Narrowly, temporarily |
| Detail panel | Level A | Yes | Narrowly, temporarily |
| Match cards | Level A | Yes | Narrowly, temporarily |
| Prediction cards / blocks | Level A | Yes | Narrowly, temporarily |
| Track record surfaces | Level A | Yes | Narrowly, temporarily |
| Paywall surfaces | Level A | Yes | Narrowly, temporarily |
| Notices / announcement bar | Level A | Yes | Narrowly, temporarily |
| Auth / session surfaces | Level B | Yes | Narrowly, temporarily |
| Pro page surfaces | Level B | Yes | Narrowly, temporarily |
| Loading / empty / error / degraded states | Level B | Yes | Narrowly, temporarily |
| Secondary utility surfaces and ancillary panels | Level B | Yes | Narrowly, temporarily |

### 19.4 Guarantee boundary

The phrase “changing the site style applies everywhere without touching anything else” may be used only when:
- Level B has been reached,
- the active surface inventory has been checked,
- undocumented raw visual values have been removed from the active product footprint,
- theme propagation has been verified against the current active theme packs.

Before Level B, the strongest permissible claim is:
- critical product surfaces support controlled theme variation without component rewrites.

### 19.5 Exception policy

Documented exceptions must include:
- surface name,
- reason,
- why tokenization is temporarily deferred,
- expected cleanup milestone,
- risk if left unresolved.

Exceptions must not become silent permanent debt.

### 19.6 Completion gate

This spec’s stronger propagation promise is considered satisfied only when:
- an active product surface inventory exists,
- critical surfaces are Level A complete,
- Level B coverage status is explicitly tracked,
- no undocumented raw visual values remain in active product surfaces,
- a theme swap can be performed across the active product without per-surface patching,
- notices/warnings/paywall/free-vs-Pro surfaces retain semantic distinction under theme change.

## 20. Acceptance criteria for this spec

This foundation is considered established when:

- the product has one canonical token model,
- components can style via semantic tokens rather than raw values,
- dark/light are mapped through tokens,
- premium/notice/operational surfaces are visually distinguishable,
- future theme packs can override tokens without component rewrites,
- an active product surface inventory exists,
- Level A and Level B coverage can be assessed explicitly,
- the stronger “global style propagation” claim is reserved for Level B only,
- styling drift is materially reduced.

---

## 21. Non-goals

This spec does not define:
- final page layouts,
- business copy,
- Stripe UI,
- auth flows,
- route structure,
- campaign scheduling,
- ad serving rules,
- operational incident policy.

---

## 22. Deferred future considerations

### 21.1 Accessibility themes
Potential future work:
- high-contrast mode,
- reduced-motion styling,
- user-adjustable density,
- typography scaling preferences.

Not in current scope because the immediate priority is a stable shared token system.

### 21.2 White-label / multi-brand
Potential future work:
- partner theme packs,
- sponsor-aligned skins,
- competition-branded shells.

Not in current scope because no active multi-brand product requirement exists.

### 21.3 Advanced density system
Potential future work:
- user-selectable density,
- analyst mode vs casual mode density.

Not in current scope because core shell and freemium surfaces must be stabilized first.

### 21.4 Expanded motion language
Potential future work:
- richer motion for event modes,
- thematic motion packs,
- more expressive premium transitions.

Not in current scope because motion should remain secondary to clarity.

---

## 22. One-paragraph summary

The SportPulse web design system foundation defines the visual grammar of the product through reusable tokens, semantic styling rules, scalable typography and spacing, state-aware interaction patterns, and dark/light mappings that prevent visual drift and enable future theming without structural rewrites. It establishes a stable, analytical, premium-capable product identity while explicitly prohibiting ad hoc styling that would re-fragment the frontend.
