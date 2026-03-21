---
artifact_id: SPEC-SPORTPULSE-WEB-THEME-AND-GLOBAL-ANNOUNCEMENT-SYSTEM
title: "Web Theme and Global Announcement System"
artifact_class: spec
status: proposed
version: 0.1.0
project: sportpulse
domain: web
slug: theme-and-global-announcement-system
owner: team
created_at: 2026-03-21
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-CORE-CONSTITUTION
  - SPEC-SPORTPULSE-CORE-MVP-EXECUTION-SCOPE
  - SPEC-SPORTPULSE-CORE-NON-FUNCTIONAL-REQUIREMENTS
  - SPEC-SPORTPULSE-SHARED-ERRORS-AND-WARNINGS-TAXONOMY
  - SPEC-SPORTPULSE-WEB-DESIGN-SYSTEM-FOUNDATION
  - SPEC-SPORTPULSE-WEB-SITE-EXPERIENCE-CONFIG
  - SPEC-SPORTPULSE-WEB-AUTH-AND-FREEMIUM-SURFACE
  - SPEC-SPORTPULSE-WEB-NAVIGATION-AND-SHELL-ARCHITECTURE
canonical_path: docs/web/spec.sportpulse.web.theme-and-global-announcement-system.md
---

# SportPulse — Web Theme and Global Announcement System

Version: 0.1  
Status: Proposed  
Scope: Theme variants, seasonal/event overlays, global announcements, operational-notice separation, rendering precedence  
Audience: Product, Frontend, Backend, QA, Ops, AI-assisted development workflows

---

## 1. Purpose

This document defines the web-product rules for:

- theme variants,
- event/season overlays,
- global announcements,
- route/competition-scoped announcements,
- audience-aware announcement visibility,
- precedence between announcements, warnings, and shell surfaces,
- the mandatory distinction between operational system notices and editorial/commercial messaging.

This spec exists because SportPulse needs to support controlled visual evolution and time-bound messaging without:

- hardcoding event styles into components,
- mixing service degradation with promotional banners,
- duplicating one-off UI hacks for holidays, tournaments, or incidents,
- making theme changes depend on invasive component rewrites.

This document is authoritative for the conceptual model and rendering rules of themes and announcements in the web product.

---

## 2. Authority and boundaries

This document is subordinate to:

1. Constitution
2. MVP Execution Scope
3. Non-Functional Requirements
4. Errors and Warnings Taxonomy
5. Design System Foundation
6. Site Experience Config
7. Auth and Freemium Surface
8. Navigation and Shell Architecture

This document is authoritative for:

- what a theme is,
- what an overlay is,
- what a global announcement is,
- how announcements are classified,
- rendering placement and precedence rules,
- audience/scope semantics,
- v1 limits and anti-patterns.

This document is not authoritative for:

- operational warning taxonomy content,
- backend outage detection,
- payment or auth business rules,
- detailed token definitions already governed by Design System Foundation,
- remote-config transport implementation,
- ad-network mechanics.

---

## 3. Design problem statement

SportPulse needs to support three distinct but related concerns:

1. **Base product identity**  
   The site must have a coherent visual system that can survive future changes.

2. **Controlled temporary visual variation**  
   The site may need temporary event/season styling such as:
   - World Cup mode,
   - Christmas mode,
   - special launch styling,
   - incident-sensitive visual treatment.

3. **Cross-product messaging**  
   The site may need to communicate:
   - service degradation,
   - editorial/product notices,
   - seasonal messages,
   - commercial upgrade prompts,
   - competition-specific notices.

These concerns must be separated.

A theme is not an announcement.  
An operational notice is not a promo banner.  
A seasonal overlay is not permission to restyle components ad hoc.

---

## 4. Governing principles

### 4.1 Theme changes must be token-driven

Themes may only affect rendering via documented design-system tokens and approved semantic overrides.

They must not depend on:
- page-local hardcoded colors,
- component-specific event CSS branches,
- per-screen style exceptions as a primary strategy.

### 4.2 Announcements are structured content, not random banner text

Every announcement must have:
- a type,
- a scope,
- an audience,
- lifecycle metadata,
- rendering precedence,
- dismissal behavior,
- optional CTA semantics.

### 4.3 Operational truth is not marketing

Operational warnings, degraded-state banners, service-status messages, and warning-taxonomy surfaces are not equivalent to editorial or commercial announcements.

They must remain semantically and visually distinct.

### 4.4 Themeing must not change product truth

Themes may affect presentation only.
They must not:
- hide warnings,
- alter eligibility semantics,
- alter paywall truth,
- alter prediction meaning,
- override system-state rendering rules.

### 4.5 Pro users still see operational truth

Even if Pro suppresses commercial display ads, Pro users still see:
- operational notices,
- service-status banners,
- degraded-state warnings,
- mandatory product notices.

### 4.6 v1 must remain bounded

This spec supports a disciplined v1.  
It must not silently expand into:
- a CMS,
- advanced experimentation,
- full targeting engine,
- white-label brand platform,
- multi-tenant theming stack.

---

## 5. Theme system

### 5.1 Theme model

A theme in SportPulse is a named, bounded override layer applied on top of the Design System Foundation.

A theme does not redefine product architecture.  
A theme remaps approved semantic presentation tokens.

### 5.2 Theme layers

The effective rendered experience is composed from these layers:

1. **Foundation tokens**  
   Raw design primitives from Design System Foundation.

2. **Semantic token layer**  
   Product-facing aliases such as:
   - `surface-primary`
   - `surface-muted`
   - `text-primary`
   - `text-secondary`
   - `border-default`
   - `accent-brand`
   - `accent-live`
   - `warning-surface`
   - `danger-surface`
   - `pro-accent`

3. **Base theme**  
   A stable product theme, e.g. `default-light` or `default-dark`.

4. **Optional theme overlay**  
   A bounded event/season override such as `world-cup-2026` or `christmas`.

### 5.3 Effective theme composition rule

The effective theme is:

`foundation -> semantic mapping -> base theme -> optional overlay`

If an overlay does not override a token, the base theme token applies.

### 5.4 Theme registry (v1)

The theme registry in v1 supports the following conceptual theme classes:

- `default-light`
- `default-dark`
- `seasonal-*`
- `event-*`
- `incident-*` (highly bounded and optional)

v1 does not require all of these to be implemented immediately.  
It only requires the registry model to allow them coherently.

### 5.5 Allowed theme overrides

A theme may override only approved semantic dimensions, such as:

- brand/accent emphasis,
- surface nuance,
- border emphasis,
- decorative hero/header treatment,
- badge/chip styling,
- non-semantic illustration treatment,
- season/event-specific decorative assets.

### 5.6 Forbidden theme behaviors

A theme must not:

- hide or visually bury operational warnings,
- make free vs Pro states ambiguous,
- change CTA semantics,
- restyle error/warning states into decorative content,
- alter readability below baseline accessibility,
- create layout breakage,
- insert route-specific hacks into product components,
- depend on one-off hex overrides scattered in component files.

### 5.7 Theme fallback behavior

If a requested theme or overlay is unavailable:

- the system falls back to the active base theme,
- if the base theme is unavailable, the system falls back to the canonical default theme,
- the shell must remain functional,
- no component may fail closed because a decorative theme asset is missing.

### 5.8 Theme activation sources

Theme activation may conceptually come from:

- default product configuration,
- runtime site-experience config,
- scheduled seasonal activation,
- explicitly activated event mode.

The transport/source of truth is governed by Site Experience Config, not by this spec.

---

## 6. Overlay system

### 6.1 Overlay definition

An overlay is a bounded visual adjustment applied on top of the base theme for a temporary context.

An overlay is smaller than a full theme rewrite.

Examples:
- World Cup visual mode,
- Christmas seasonal mode,
- launch-week emphasis,
- incident-aware caution treatment.

### 6.2 Overlay use cases

Overlays are appropriate when the product wants to:

- celebrate an event,
- emphasize a tournament,
- temporarily alter accent energy,
- add non-invasive seasonal identity,
- visually flag special product mode.

### 6.3 Overlay limits

Overlays must not:
- restyle every component independently,
- introduce unique layout branches,
- redefine spacing or typography systems globally,
- become a shadow design system.

### 6.4 Overlay precedence

If an overlay is active:
- overlay tokens override base-theme semantic tokens only where explicitly defined,
- announcements do not override theme tokens directly,
- operational warnings still render with warning semantics even under overlay mode.

---

## 7. Announcement system

### 7.1 Announcement definition

An announcement is structured user-facing messaging rendered by the product shell or a defined surface.

Announcements are not arbitrary strings.  
They are typed, scoped, audience-aware content entities.

### 7.2 Announcement classes

Each announcement must be classified as one of:

- `operational`
- `editorial`
- `commercial`
- `seasonal`

### 7.3 Meaning of announcement classes

#### `operational`
Use for:
- service degradation,
- stale/fallback mode awareness when surfaced as shell-wide notice,
- major site-wide reliability or availability messages,
- product-operational status messages.

#### `editorial`
Use for:
- product information,
- competition availability notices,
- feature education,
- non-commercial informative product messaging.

#### `commercial`
Use for:
- upgrade prompts,
- promotions,
- subscription campaigns,
- conversion-oriented messaging.

#### `seasonal`
Use for:
- temporary event/season messages,
- holiday greetings,
- tournament celebration banners,
- limited-duration brand atmosphere messages.

### 7.4 Announcement scope

Each announcement must define a scope:

- `global`
- `route`
- `competition`

#### `global`
Visible across the web product.

#### `route`
Visible only in a specific primary surface or route family.

#### `competition`
Visible only when the active competition context matches.

### 7.5 Audience model

Each announcement must define an audience:

- `all`
- `anonymous`
- `registered`
- `pro`

Audience targeting in v1 remains simple and bounded.

### 7.6 Announcement fields (conceptual contract)

Each announcement should be representable with at least:

- `id`
- `type`
- `scope`
- `audience`
- `title`
- `body`
- `severity` (if relevant)
- `priority`
- `dismissible`
- `ctaLabel` (optional)
- `ctaHref` or internal target (optional)
- `startAt`
- `endAt`
- `themeOverlay` (optional)
- `competitionId` (when scope is competition)
- `routeMatch` (when scope is route)

This is a conceptual contract, not a mandatory API schema.

---

## 8. Operational notices vs announcements

### 8.1 Hard separation rule

Operational system notices and warnings must not be modeled as generic commercial/editorial banners.

### 8.2 When to use warning taxonomy instead of announcement layer

If the message exists because of actual runtime/product-state truth, it belongs to the warning/operational system.

Examples:
- degraded snapshot state,
- stale fallback served,
- provider issue affecting site-wide experience,
- partial outage or service issue.

These should be generated from operational truth, not manually configured as promotional content.

### 8.3 When announcement layer is correct

Use the announcement layer for:
- “World Cup mode active”
- “New competition available”
- “Upgrade to Pro”
- “Holiday message”
- “Feature now available”

### 8.4 Coexistence rule

Operational notices and announcement-layer banners may coexist.
When they coexist, operational notices have higher precedence than non-operational announcements.

---

## 9. Rendering placement

### 9.1 Primary shell placement

The default shell location for top-level announcements is a controlled top-of-shell banner area.

### 9.2 Secondary contextual placement

Some announcements may render in scoped placements, such as:
- competition-specific header region,
- route-specific surface header,
- contextual CTA region.

### 9.3 Placement consistency

Announcement placement must be consistent enough that users can distinguish:
- system-state banners,
- informational/editorial banners,
- promotional banners.

### 9.4 No ad-slot hijacking

Announcements must not reuse commercial ad slots as their primary rendering mechanism.
The semantic difference must remain visible in UI structure.

---

## 10. Precedence rules

### 10.1 Overall precedence hierarchy

When multiple candidate banners/notices exist, precedence is:

1. mandatory operational/service notices
2. degraded-state / warning-taxonomy-derived shell notices
3. high-priority editorial notices
4. commercial announcements
5. seasonal announcements

### 10.2 Competition and route specificity

If two announcements share the same class and audience:
- a more specific scope may override a broader one,
- unless the broader one has higher explicit priority.

### 10.3 Simultaneous announcement cap

v1 should avoid stacking many banners.
A bounded rendering strategy is preferred:
- one primary announcement band at a time,
- optionally one contextual scoped message below surface header if necessary.

### 10.4 Dismissal interaction with precedence

If a lower-priority banner is dismissed, that does not dismiss a higher-priority banner.
If a higher-priority banner becomes active, it may replace the visible lower-priority banner even if the lower-priority one was previously not dismissed.

---

## 11. Dismissal rules

### 11.1 Dismissible behavior

Announcements may be:
- non-dismissible,
- session-dismissible,
- persistence-dismissible.

### 11.2 Operational notices

Operational notices are non-dismissible by default unless explicitly modeled otherwise.

### 11.3 Commercial/editorial/seasonal announcements

Commercial, editorial, and seasonal announcements may be dismissible if that aligns with product goals.

### 11.4 Dismissal persistence

Persistence strategy is governed by Site Experience Config and implementation choices, but the conceptual behavior must remain explicit.

### 11.5 Pro audience and commercial announcements

Commercial announcements targeted to free conversion should not be shown to Pro users unless they are specifically relevant to Pro users.

---

## 12. Scheduling rules

### 12.1 Time-bounded activation

Announcements may define `startAt` and `endAt`.
If current time is outside the active window, the announcement is inactive.

### 12.2 Theme-overlay coupling

An announcement may optionally activate or reference a compatible theme overlay, but announcement presence must not be the sole mechanism for theme safety.

### 12.3 Missing schedule fields

If schedule fields are absent, the announcement is treated as manually active according to config/state source.

---

## 13. Audience rules by subscription tier

### 13.1 Free / anonymous users

Free and anonymous users may see:
- editorial announcements,
- seasonal announcements,
- commercial upgrade announcements,
- operational notices.

### 13.2 Registered non-Pro users

Registered non-Pro users follow the same general rules as free users, with the option for more targeted upgrade messaging.

### 13.3 Pro users

Pro users may still see:
- operational notices,
- editorial notices,
- seasonal notices,
- product informational notices.

Pro users should not see generic commercial conversion messaging intended only to sell Pro.

### 13.4 Pro and commercial display ads

Commercial display ads are governed by Auth and Freemium Surface.
This document only enforces the semantic distinction between:
- ads,
- announcements,
- operational notices.

---

## 14. Relationship to ads

### 14.1 Ads are not announcements

Commercial display ads and sponsorship inventory are not the same as product announcements.

### 14.2 Shared guardrail

The same visual system may style ad containers and announcement containers coherently, but they must not become semantically indistinguishable.

### 14.3 Pro suppression does not suppress truth

Ad suppression for Pro must never suppress:
- operational notices,
- product-state banners,
- mandatory notices,
- warning-derived messaging.

---

## 15. Relationship to site-experience-config

### 15.1 Responsibility split

This spec defines:
- conceptual models,
- classes,
- rendering rules,
- precedence semantics.

Site Experience Config defines:
- how active theme and active announcements are selected,
- where configuration comes from,
- runtime/build-time behavior,
- fallback and safety rules.

### 15.2 No config leakage into semantic rules

The source of configuration must not change the meaning of the semantic model defined here.

---

## 16. v1 limits

v1 supports only a bounded subset of full potential capability.

### 16.1 Included in v1 conceptual scope

- canonical theme registry model,
- default theme + bounded overlay concept,
- announcement typing,
- scope and audience model,
- precedence rules,
- scheduling concept,
- dismissal concept,
- operational vs editorial/commercial separation.

### 16.2 Explicitly not required in v1

- WYSIWYG campaign editor,
- full remote CMS,
- multi-banner composition engine,
- advanced behavioral targeting,
- white-label tenant-specific theme inheritance,
- A/B framework,
- multilingual campaign engine,
- complex asset workflow.

---

## 17. Anti-patterns

The following are explicitly disallowed:

- putting holiday hex values directly in components,
- using operational warning surfaces for marketing copy,
- using marketing banners to communicate real incidents,
- showing multiple unrelated top banners simultaneously without precedence,
- letting overlays alter warning readability,
- treating ad slots as general-purpose notification slots,
- using theme overlays to hide product deficiencies,
- coupling seasonal styling to route-specific component branches,
- building a shadow design system inside banner code.

---

## 18. Acceptance-oriented behavioral examples

### 18.1 World Cup seasonal mode

If `world-cup-2026` overlay is active:
- base product theme remains intact,
- approved accent/surface treatments may change,
- navigation and content semantics remain unchanged,
- warnings keep warning styling semantics,
- no component should require bespoke route-local CSS for the tournament mode.

### 18.2 Service incident

If a site-wide service degradation exists:
- operational notice renders with top precedence,
- it remains visible to all tiers,
- any active commercial or seasonal banner yields to it in the main shell notice slot.

### 18.3 Free-user upgrade promo

If a free user is on prediction surfaces:
- a commercial announcement may promote Pro,
- but it must not impersonate an operational warning,
- and it should not displace a higher-priority operational notice.

### 18.4 Pro user during campaign

If a Pro user visits during a seasonal campaign:
- seasonal announcement may still render,
- free-to-Pro conversion promo should not render generically,
- operational notices remain visible if active.

---

## 19. Implementation notes (non-authoritative)

The following are implementation-direction notes only:

- shell-level banner rendering should be centralized,
- announcement state resolution should happen before route surface rendering when possible,
- theme selection should happen near app root,
- component APIs should consume semantic tokens and announcement variants rather than raw style values,
- dismissal persistence should be explicit and bounded.

These notes guide implementation but do not override package/module boundaries.

---

## 20. Explicit non-goals

This spec does not define:

- the full design token dictionary,
- a CMS for editing announcements,
- ad-network behavior,
- incident detection pipelines,
- backend warning production logic,
- full experimentation framework,
- multi-brand tenant inheritance,
- localization workflows,
- editorial approval workflow.

---

## 21. Deferred future considerations

### 21.1 Advanced audience targeting

Possible future support:
- audience segmentation by behavior,
- route history,
- league affinity,
- conversion state.

Not in v1 because targeting complexity is not currently justified.

### 21.2 Multiple simultaneous announcement regions

Possible future support:
- shell banner + subheader notice + contextual in-card notice orchestration.

Not in v1 because it increases cognitive load and system complexity.

### 21.3 Theme packs with richer asset bundles

Possible future support:
- theme-specific imagery,
- richer header art,
- tournament-specific iconography packages.

Not in v1 because token-driven stability matters more than decorative breadth.

### 21.4 User preference theme controls

Possible future support:
- user-selected theme variants,
- high-contrast mode,
- reduced-motion preference themes.

Not in v1 because the current priority is product-controlled theme coherence.

### 21.5 Announcement authoring workflow

Possible future support:
- internal editor,
- approval process,
- preview modes,
- scheduled publishing UI.

Not in v1 because manual/config-driven control is sufficient initially.

### 21.6 Competition-specific event overlays

Possible future support:
- league- or tournament-scoped decorative overlays.

Not in v1 because global product consistency is more important than per-competition visual branching.

---

## 22. One-paragraph summary

SportPulse uses a bounded, token-driven theme system layered over the Design System Foundation and a structured announcement system that is explicitly separate from operational warnings and from commercial ads. Themes and overlays control presentation, not product truth. Announcements are typed, scoped, audience-aware, scheduled messaging entities with explicit precedence rules. Operational notices outrank editorial, commercial, and seasonal messages and remain visible to all tiers. The v1 system is intentionally limited: coherent enough to support seasonal/event modes and global messaging, but bounded enough to avoid becoming an accidental CMS, ad engine, or white-label framework.
