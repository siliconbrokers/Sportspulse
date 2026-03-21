---
artifact_id: SPEC-SPORTPULSE-WEB-SITE-EXPERIENCE-CONFIG
title: "Site Experience Config"
artifact_class: spec
status: proposed
version: 0.1.0
project: sportpulse
domain: web
slug: site-experience-config
owner: team
created_at: 2026-03-21
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-CORE-CONSTITUTION
  - SPEC-SPORTPULSE-CORE-MVP-EXECUTION-SCOPE
  - SPEC-SPORTPULSE-CORE-NON-FUNCTIONAL-REQUIREMENTS
  - SPEC-SPORTPULSE-WEB-DESIGN-SYSTEM-FOUNDATION
  - SPEC-SPORTPULSE-WEB-THEME-AND-GLOBAL-ANNOUNCEMENT-SYSTEM
  - SPEC-SPORTPULSE-WEB-AUTH-AND-FREEMIUM-SURFACE
  - SPEC-SPORTPULSE-WEB-NAVIGATION-AND-SHELL-ARCHITECTURE
canonical_path: docs/web/spec.sportpulse.web.site-experience-config.md
---

# SportPulse — Site Experience Config

Version: 0.1  
Status: Proposed  
Scope: Contract for web experience configuration, including active theme selection, announcement activation, presentation-level toggles, fallback behavior, precedence rules, and operational guardrails  
Audience: Product, Frontend, Backend, Ops, QA, AI-assisted development workflows

---

## 1. Purpose

This document defines the **experience-configuration contract** for the SportPulse web product.

Its purpose is to answer, clearly and without hand-waving:

- how the active site experience is determined,
- which parts of the experience may vary by configuration,
- which parts must remain hard-wired to product truth,
- what can be manual in v1,
- what may become runtime-configurable later,
- how experience failures degrade safely,
- how configuration interacts with themes, announcements, auth state, and monetization surfaces.

This spec exists to avoid two opposite failures:

1. hardcoding every seasonal, campaign, or service-state variation into the UI, and  
2. overengineering a generic remote-config platform before the MVP has earned it.

This is a **v1 governance and contract spec**, not an infrastructure mandate.

---

## 2. Authority and boundaries

This document is subordinate to:

1. Constitution
2. MVP Execution Scope
3. Non-Functional Requirements
4. Design System Foundation
5. Theme and Global Announcement System
6. Auth and Freemium Surface
7. Navigation and Shell Architecture

This document is authoritative for:

- what the site-experience config is allowed to control,
- the shape of the active experience state,
- precedence rules across sources of configuration,
- fail-safe behavior when config is missing or invalid,
- the separation between product truth and presentation/config truth.

This document is **not** authoritative for:

- prediction semantics,
- track-record computation,
- backend provider logic,
- subscription-ledger truth,
- runtime feature-flag vendor selection,
- deployment topology,
- CMS/editorial tooling,
- experimentation framework selection.

---

## 3. Problem statement

SportPulse needs the ability to evolve the **presentation-layer experience** without constantly rewriting UI code.

Examples already anticipated by product direction include:

- switching themes for seasonal periods,
- applying a tournament or World Cup skin,
- showing site-wide announcements,
- showing service-status messages,
- temporarily highlighting a competition or campaign,
- controlling selected presentation behaviors by environment or active product state.

At the same time, SportPulse must not allow site-experience config to mutate:

- dashboard truth,
- prediction truth,
- track-record truth,
- entitlement truth,
- warning semantics,
- backend-owned operating mode.

So the configuration layer must be powerful enough to support controlled variation, but weak enough to avoid semantic corruption.

---

## 4. Non-negotiable invariants

### 4.1 Frontend-owned, not business-truth-owned

Site experience config may influence:

- theme selection,
- announcement selection,
- shell-level presentation toggles,
- campaign-oriented display behavior,
- selected rendering defaults.

Site experience config must **not** determine:

- prediction availability,
- prediction values,
- track-record metrics,
- Pro entitlement truth,
- operational-warning truth,
- provider availability,
- data freshness truth.

### 4.2 Presentation config is downstream of product truth

If the product truth says a competition is unavailable, a prediction is NOT_ELIGIBLE, or the system is degraded, site experience config may only influence **how** that is presented — not whether it exists.

### 4.3 Safe failure is mandatory

If site experience config is unavailable, malformed, stale, or partially invalid, the site must continue to render using safe defaults.

Config failure must not:

- crash the shell,
- hide mandatory notices,
- expose Pro content,
- erase operational warnings,
- leave the product without a usable theme.

### 4.4 Manual v1 is acceptable

This spec explicitly allows a pragmatic v1 in which parts of the experience configuration remain:

- build-time,
- code-based,
- environment-based,
- or semi-manual.

The goal is to avoid future lock-in, not to force premature runtime complexity.

### 4.5 Site-experience config is not a substitute for code review

Experience config may select from **approved variants**.  
It must not become a backdoor for arbitrary styling or arbitrary rendering logic.

---

## 5. Scope of control

Site experience config controls only approved classes of presentation behavior.

### 5.1 In-scope classes

In v1, the config layer may control:

- active theme variant,
- active announcement set,
- announcement visibility windows,
- announcement targeting by coarse audience or route scope if approved,
- selected shell-level presentation toggles,
- selected campaign overlays,
- selected environment-aware presentation flags,
- ad-slot visibility policy by tier when already defined by product contract,
- selected default UI emphasis states (for example, whether a highlighted competition chip is shown).

### 5.2 Out-of-scope classes

The config layer must not directly control:

- prediction payload fields,
- track-record publication threshold,
- Pro entitlement truth,
- Stripe success truth,
- provider routing,
- fallback snapshot selection,
- warning generation,
- raw data availability,
- navigation semantics beyond approved variants,
- arbitrary copy generation.

### 5.3 Gray-zone rule

If a proposed config item influences **what the product is true about**, it is out of scope.  
If it influences **how the product is presented**, it may be in scope.

When uncertain, fail conservative.

---

## 6. Experience config model

### 6.1 Conceptual model

The site experience at runtime is determined by an **Active Experience State**, composed from approved config sources.

That state must answer at minimum:

- what theme is active,
- what announcements are active,
- what presentation toggles are active,
- what audience context is known,
- what fallback/default experience applies,
- whether the active state is defaulted or configured,
- whether the state is valid, partial, or degraded.

### 6.2 Canonical experience state (conceptual)

The following is a conceptual contract, not an implementation language requirement:

```ts
type ExperienceState = {
  sourceStatus: "default" | "configured" | "partial" | "invalid" | "unavailable";
  activeThemeId: string;
  activeThemeOverlayIds: string[];
  activeAnnouncementIds: string[];
  presentationFlags: Record<string, boolean | string | number>;
  audienceContext: {
    isAuthenticated: boolean;
    isPro: boolean;
    routeScope?: string;
    competitionScope?: string;
  };
  resolvedAtUtc: string;
  defaultedFields: string[];
  diagnostics?: {
    invalidKeys: string[];
    ignoredKeys: string[];
  };
};
```

The exact transport may differ, but the logical information above must be recoverable.

### 6.3 Approved categories of fields

Approved config categories in v1:

- theme selection,
- overlay selection,
- announcement activation,
- presentation toggles,
- ad/render suppression toggles that derive from already-defined product contract,
- coarse route or competition highlighting.

No other categories are implicitly allowed.

---

## 7. Sources of configuration

### 7.1 Allowed source classes

The active experience may be composed from one or more of the following source classes:

- code defaults,
- build-time config,
- environment config,
- optional runtime config endpoint,
- derived user/audience context already known to the shell.

### 7.2 v1 preferred posture

The preferred v1 posture is:

1. **code defaults are mandatory**,  
2. build-time or environment configuration is acceptable,  
3. runtime config is optional and should only be introduced if it reduces meaningful operational friction.

This avoids cargo-cult remote config.

### 7.3 Runtime config is optional, not mandatory

This spec does **not** require a remote config service in v1.

If runtime config is not implemented, the contract still applies conceptually using default + build-time + environment inputs.

### 7.4 Approved source precedence

The recommended precedence order in v1 is:

1. safe code defaults  
2. environment/build-time overrides  
3. runtime config overrides (if present and valid)  
4. audience-aware derivation applied on top where permitted

If a higher-precedence source is invalid, the system falls back without breaking rendering.

### 7.5 No arbitrary runtime execution

No experience config source may inject arbitrary code, raw CSS, or unbounded template logic.

Only approved keys and approved values are allowed.

---

## 8. Build-time vs runtime responsibilities

### 8.1 Build-time appropriate items

These are suitable to remain build-time or environment-based in v1:

- default theme,
- list of enabled theme variants,
- announcement support enablement,
- known campaign overlay registry,
- environment-specific shell flags,
- local dev/test overrides,
- ad-slot enablement by environment,
- safety fallback defaults.

### 8.2 Runtime-appropriate items

These may become runtime-configurable when operationally justified:

- currently active seasonal theme,
- currently active World Cup overlay,
- currently active global announcement,
- start/end scheduling of non-operational notices,
- selected route/competition promotions,
- selected emergency shell banner triggers if wired appropriately.

### 8.3 Must-not-be-runtime-owned items

The following must remain outside runtime experience config:

- Pro entitlement truth,
- prediction computation,
- track-record math,
- warning generation semantics,
- subscription ledger state,
- dashboard source-of-truth data,
- operator-only emergency truth if no trusted backend source exists.

---

## 9. Controlled classes of experience variation

### 9.1 Theme selection

The config layer may choose which **approved theme variant** is active.

Examples:
- `default-light`
- `default-dark`
- `world-cup-2026`
- `holiday-2026`

The config layer may not invent new tokens on the fly.

### 9.2 Theme overlays

The config layer may apply approved overlays when allowed by the theme system.

Examples:
- competition event accent
- seasonal header treatment
- campaign badge mode

Overlays must be bounded and composable.
They must not replace the base design system.

### 9.3 Announcement activation

The config layer may activate approved announcements according to the announcement system contract.

This may include:
- operational notices,
- editorial notices,
- commercial notices,
- seasonal notices.

But the **semantic classification** must already exist.

### 9.4 Shell emphasis flags

The config layer may toggle limited shell-level presentation options such as:
- showing a highlighted competition chip,
- enabling a campaign ribbon,
- enabling a compact or full announcement region,
- enabling a route-level promotional chip.

These flags must remain presentation-only.

### 9.5 Ad visibility rendering policy

The config layer may govern whether commercial ad slots are active in the current experience, subject to product contract.

It may not override:
- `Pro => no commercial display ads`
if that is defined elsewhere as product truth.

In other words:
- config may determine that an ad slot exists in the free experience,
- config may not force ads into the Pro experience if product contract forbids them.

---

## 10. Experience state resolution rules

### 10.1 Resolution pipeline

The experience state should be resolved conceptually in this order:

1. load code defaults
2. apply environment/build-time overrides
3. load runtime config if enabled and available
4. validate approved keys and values
5. derive audience-aware restrictions
6. produce resolved active state
7. expose diagnostics for ignored/defaulted fields

### 10.2 Validation before application

No config field should be applied before validation.

Unknown keys must be ignored, not trusted.
Invalid values must default safely.
Conflicting values must resolve via documented precedence.

### 10.3 Audience derivation

Audience-aware derivation may adjust only permitted presentation rules such as:

- whether an announcement targets all vs anonymous vs authenticated vs Pro,
- whether ad slots are hidden for Pro,
- whether a Pro CTA banner should be suppressed for current Pro users.

Audience derivation must not invent entitlement.

### 10.4 Deterministic result

Given the same defaults, environment, runtime config, and audience context, the resolved experience state must be deterministic.

---

## 11. Default experience contract

### 11.1 Mandatory default

SportPulse must always have a valid default experience even if all optional config is absent.

### 11.2 Default experience minimums

The default experience must guarantee:

- valid base theme,
- no invalid overlay composition,
- no broken announcement container,
- no empty shell due to missing config,
- all operational warnings still visible,
- no accidental exposure of Pro-only content,
- no dependency on a runtime config endpoint for basic rendering.

### 11.3 Default-first philosophy

If there is tension between:
- “fully dynamic” and
- “always safe”,

the default-first posture wins in v1.

---

## 12. Failure behavior

### 12.1 Config unavailable

If config is unavailable:

- use default experience
- record diagnostics if instrumentation exists
- do not block page rendering
- do not hide mandatory notices

### 12.2 Config partially invalid

If some fields are invalid:

- ignore invalid fields
- apply valid fields
- default the rest
- expose sourceStatus as `partial` if surfaced internally

### 12.3 Config totally invalid

If the entire config payload fails validation:

- reject it fully
- revert to safe default experience
- do not leave mixed undefined state

### 12.4 Overlay conflict

If two overlays conflict and no safe composition rule exists:

- apply precedence rule if defined
- otherwise keep base theme only
- never render an undefined visual composition

### 12.5 Announcement failure

If announcement config is malformed:

- ignore malformed announcement entries
- keep valid entries if safely possible
- default to no optional announcements if necessary
- do not suppress operational notices that originate from separate truth systems

---

## 13. Fallback behavior by class

### 13.1 Theme fallback

Fallback must always resolve to an approved base theme.

### 13.2 Overlay fallback

Invalid overlay => no overlay

### 13.3 Announcement fallback

Invalid optional announcement => no optional announcement

### 13.4 Presentation flag fallback

Unknown or invalid presentation flag => ignored / default false or documented default

### 13.5 Audience fallback

If audience context is temporarily loading:
- avoid contradictory experiences,
- prefer conservative rendering,
- do not reveal Pro-only surfaces,
- do not remove operational notices.

---

## 14. Safety rules

### 14.1 No raw style injection

The config layer must not accept arbitrary:
- CSS strings,
- HTML fragments,
- JS snippets,
- inline style payloads.

### 14.2 Approved enum registry

Values for themes, overlays, announcement types, and major flags should come from approved registries.

### 14.3 No semantic override of warnings

The config layer may change presentation framing around a warning only if allowed by the announcement system.  
It must not convert an operational warning into a marketing banner or suppress it for premium users.

### 14.4 No entitlement override

The config layer must not claim a user is Pro, free, anonymous, or authenticated.
It may only consume already-resolved audience state.

### 14.5 No config-dependent first-render fragility

The first meaningful render of the product should not depend on a slow config fetch.

---

## 15. Observability and diagnostics

### 15.1 Minimum observability goals

The system should make it possible to determine:

- which config source resolved the current experience,
- which theme is active,
- which overlays were applied,
- which announcements were activated,
- whether defaults were used,
- whether invalid fields were ignored.

### 15.2 Minimum diagnostic posture in v1

Even in a simple v1, engineers/operators should be able to inspect:

- effective theme id,
- active announcement ids,
- whether runtime config loaded or defaulted,
- whether experience state is `configured`, `partial`, or `default`.

### 15.3 Non-goal

This spec does not require a full observability dashboard in v1.
It only requires the architecture not to become opaque.

---

## 16. Relationship to other specs

### 16.1 Design System Foundation
This spec does not define tokens.  
It chooses among approved token-driven variants defined there.

### 16.2 Theme and Global Announcement System
This spec does not define what a theme or announcement means semantically.  
It defines how the active site experience selects and activates them.

### 16.3 Auth and Freemium Surface
This spec does not define user entitlement rules.  
It may consume them to apply experience rules such as:
- suppressing ads for Pro,
- suppressing upgrade banners for existing Pro users.

### 16.4 Navigation and Shell Architecture
This spec does not define the shell structure itself.  
It may choose which approved shell-level notices or campaign accents are active within that structure.

---

## 17. v1 minimal implementation posture

### 17.1 Acceptable v1 posture

An acceptable v1 implementation may be as simple as:

- a local default config object,
- environment-based active theme selection,
- optional hardcoded announcement registry,
- route/audience-aware filtering in the shell,
- no remote config endpoint yet.

This is acceptable **if** it respects the contract in this spec.

### 17.2 When runtime config becomes justified

Runtime config becomes justified when one or more of these become true:

- product/ops need to activate seasonal themes without deploy,
- announcements must change on short notice,
- campaigns need scheduling that is operationally awkward in deploy-only mode,
- the same shell must vary across environments or time windows frequently enough to justify it.

### 17.3 What v1 should avoid

V1 should avoid:

- building a generic config platform “just in case”,
- introducing arbitrary JSON-driven rendering logic,
- coupling config to backend truth systems,
- adding unbounded flag proliferation.

---

## 18. Canonical config domains (conceptual)

### 18.1 Theme domain

Example conceptual shape:

```json
{
  "theme": {
    "activeThemeId": "default-dark",
    "overlayIds": ["world-cup-2026"]
  }
}
```

### 18.2 Announcement domain

Example conceptual shape:

```json
{
  "announcements": {
    "activeIds": ["global-world-cup-banner", "service-partial-degradation"]
  }
}
```

### 18.3 Presentation flags domain

Example conceptual shape:

```json
{
  "presentationFlags": {
    "highlightCompetitionChip": true,
    "showCampaignRibbon": false,
    "showProPromoInTrackRecord": true
  }
}
```

### 18.4 Safety note

These shapes are illustrative.
The implementation may differ, but the conceptual domains must remain separable.

---

## 19. Precedence rules

### 19.1 General precedence

When multiple valid config inputs compete:

1. mandatory product truth wins
2. operational warning truth wins over optional campaign presentation
3. runtime config wins over environment config if valid and enabled
4. environment/build-time wins over code defaults
5. audience constraints prune what is allowed to render
6. defaults apply where fields remain unresolved

### 19.2 Operational notice precedence

Operational notices must outrank optional editorial/commercial notices when shell space is constrained, unless an explicit coexistence rule exists.

### 19.3 Pro suppression precedence

If product truth says Pro users must not see commercial display ads:
- no site-experience config source may override that.

### 19.4 Invalid override rule

An invalid higher-priority source must not poison lower-priority safe sources.

---

## 20. Allowed presentation flags (v1 guidance)

To prevent flag explosion, the v1 presentation flag set should remain small and explicit.

### 20.1 Examples of acceptable flags
- `highlightCompetitionChip`
- `showCampaignRibbon`
- `showGlobalPromoNotice`
- `showCompactAnnouncementBar`
- `enableSeasonalHeaderAccent`

### 20.2 Examples of unacceptable flags
- `overridePredictionColorByProbability`
- `hideDegradedWarningWhenCampaignActive`
- `pretendUserIsPro`
- `forceTrackRecordVisibleEvenIfThresholdNotMet`
- `injectCustomHtmlBanner`
- `swapPredictionOrderStrategy`

These are either semantic or dangerously open-ended.

---

## 21. Config lifecycle expectations

### 21.1 Resolution timing

The site experience should be resolvable early enough to avoid obvious shell flicker, but not at the cost of making the entire site dependent on remote config latency.

### 21.2 Refresh timing

If runtime config exists, refresh should be bounded and predictable.
It must not cause erratic theme/announcement churn mid-session without explicit reason.

### 21.3 Staleness posture

A slightly stale site theme is acceptable.
A slightly stale announcement may be acceptable depending on type.
A stale operational warning is **not** acceptable if sourced from actual operational truth rather than config.

---

## 22. Security and abuse posture

### 22.1 Trust boundary

Experience config is still a trust boundary.
Even presentation-only fields can be abused if arbitrary.

### 22.2 Allowed payload discipline

Config payloads should be:
- schema validated,
- size bounded,
- enum-constrained where possible,
- ignored safely when unknown.

### 22.3 No secrets

No site-experience config payload should contain secrets, entitlement keys, or anything that would matter if exposed client-side.

---

## 23. Testability expectations

### 23.1 Minimum test classes

The config layer should be testable against at least:

- default fallback resolution,
- invalid theme id fallback,
- overlay conflict fallback,
- announcement filtering by audience,
- Pro ad suppression interaction,
- operational notice precedence,
- no-config boot behavior.

### 23.2 Acceptance posture

This spec may justify future acceptance coverage, but it does not itself define the full acceptance matrix.

### 23.3 Snapshot discipline

When possible, test resolved experience state rather than raw source payloads only.

---

## 24. Explicit non-goals

This spec does not require, in v1:

- a remote config vendor,
- CMS/editorial management UI,
- live experimentation platform,
- per-user personalization engine,
- multi-brand tenant theming,
- segmentation by geography or language,
- arbitrary admin-driven layout composition,
- white-labeling support,
- ad-tech integrations.

If those become useful later, they belong in future roadmap artifacts.

---

## 25. Migration hints (non-binding)

The following are allowed future migration directions, but none are required now:

- code-default + env config → validated runtime config endpoint
- manual announcement registry → limited CMS-lite registry
- single active theme → theme schedule support
- simple audience gating → bounded targeting rules

These are hints, not commitments.

---

## 26. Deferred future considerations

### 26.1 Remote config hardening
A richer runtime config system may later become useful if seasonal themes, event overlays, or campaign notices must be managed without deploys.

Not in v1 because the immediate problem is contract clarity, not platform sophistication.

### 26.2 Advanced targeting
Future config may support bounded targeting by:
- competition,
- route,
- user tier,
- locale,
- device class.

Not in v1 because this increases combinatorial complexity quickly.

### 26.3 CMS-lite integration
A future editorial surface may allow non-engineers to manage approved announcements.

Not in v1 because that would prematurely turn config into content infrastructure.

### 26.4 Experimentation
A future controlled experimentation layer may sit above or adjacent to site-experience config.

Not in v1 because experimentation is not required to validate the current product proposition.

### 26.5 White-label / multi-brand evolution
A future multi-brand requirement could expand the theme registry and config hierarchy.

Not in v1 because no current product evidence justifies it.

---

## 27. One-paragraph summary

The SportPulse site experience config defines how the web product selects and composes approved presentation-layer variants — such as active theme, overlays, announcements, and limited shell-level flags — without ever taking ownership of product truth. It establishes a default-first, safe-failure, low-overengineering v1 posture: code defaults are mandatory, runtime config is optional, invalid config must degrade safely, and audience-aware presentation may refine the experience only within tightly bounded rules. This allows SportPulse to evolve presentation and campaigns without hardcoding every variation or contaminating backend-owned semantics.
