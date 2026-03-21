# SportPulse Future Experience Roadmap

```yaml
artifact_id: spec.sportpulse.web.future-experience-roadmap
title: Future Experience Roadmap
version: 1.0.0
status: non-binding
type: roadmap
created_at: 2026-03-20
authority: This document creates ZERO implementation obligations. It is a design horizon reference.
```

---

## Preamble

This document catalogues experience capabilities that may become valuable as SportPulse grows beyond MVP. It exists to:

1. **Prevent premature implementation.** By explicitly naming future ideas and explaining why they are NOT in scope now, it reduces the temptation to "just add it while we're here."
2. **Inform architectural decisions.** Current v1 implementations should not actively block these futures, but must not build toward them either.
3. **Provide a decision framework.** Each item includes an activation condition -- the real-world trigger that would justify investment.

**This document is NOT:**
- A backlog. Items here are not ordered, sized, or committed.
- A spec. No implementation may cite this document as authority for building something.
- A promise. Items may never be implemented if their activation conditions are never met.

**Relationship to v1 specs:**
- Spec 1 (Design System Foundation) -- v1 implementation. This roadmap may reference token extensions.
- Spec 2 (Theme and Global Announcement System) -- v1 implementation. This roadmap extends its concepts.
- Spec 3 (Site Experience Config) -- v1 implementation. This roadmap extends its config surface.
- This roadmap adds ZERO obligations to any of the above.

---

## Section 1 -- Theming Evolution

### Accessibility-First Dark Theme (AMOLED Black)

**Why it may matter:** Users on OLED/AMOLED displays benefit from true black (`#000000`) backgrounds for battery savings and reduced eye strain in dark environments. The current dark theme uses `#0B0E14` (near-black but not pure black).

**Why it is NOT in current scope:** The current dark theme is visually cohesive and the surface hierarchy relies on subtle gray differences (`#0B0E14` -> `#1A1D24` -> `rgba(255,255,255,0.04)`). True black would collapse these differences, requiring a redesign of the surface hierarchy to use border-only or shadow-based differentiation.

**Activation condition:** User research or analytics showing significant OLED device usage among the user base, combined with explicit user requests for true dark mode.

**Architectural impact if activated:** Requires a third theme entry in the theme registry (`'amoled'`), new token values for all surface tokens, and potentially new elevation tokens (shadows) to replace the current opacity-based surface differentiation.

**Risk of anticipating it too early:** Building a surface hierarchy that works for both near-black and true-black adds unnecessary complexity to every surface decision in v1. The two approaches have fundamentally different elevation models.

---

### Event-Mode Overlays (Copa del Mundo, Champions League, etc.)

**Why it may matter:** During major sporting events, a thematic overlay creates excitement and contextual immersion. A World Cup overlay with the tournament's palette reinforces the event's importance.

**Why it is NOT in current scope:** No major event is imminent that would justify the implementation cost. The CSS mechanism is designed (Spec 2, A.6) but not implemented because there are no overlay CSS blocks to ship.

**Activation condition:** A major tournament (World Cup, Copa America, Champions League Final) is 4+ weeks away, giving time to design and test the overlay palette.

**Architectural impact if activated:** Minimal. Requires adding a CSS block in `globals.css` for the event (e.g., `body.event-mundial { ... }`) and setting `seasonalOverlay` in `SiteExperienceConfig`. The mechanism is already designed.

**Risk of anticipating it too early:** Creating placeholder overlay CSS blocks for events that may not happen or may not matter to the user base. Each overlay needs careful color pairing testing against both dark and light base themes.

---

### Competition-Branded Themes

**Why it may matter:** Each competition (LaLiga, Premier League, Bundesliga) has its own brand palette. A LaLiga-branded accent color when viewing LaLiga content could increase immersion.

**Why it is NOT in current scope:** The user frequently switches between competitions in a single session. Changing the entire accent color on each switch would be visually jarring and create a "theme flickering" effect. The brand identity of SportPulse itself (cyan/sky) would be lost.

**Activation condition:** User research confirming that competition-specific theming improves engagement without causing confusion, AND a design solution for smooth transitions between competition contexts.

**Architectural impact if activated:** Requires per-competition token overrides (similar to seasonal overlays but triggered by active competition context). The `SiteExperienceConfig` would need a `competitionAccent` map. Components reading `--sp-primary` would automatically adapt.

**Risk of anticipating it too early:** Over-engineering the token system to support per-context overrides when the user experience impact is unproven. Could lead to accessibility issues if competition colors are not vetted for contrast.

---

### User-Selectable Accent Colors

**Why it may matter:** Personalization increases user attachment. Allowing users to choose their accent color (from a curated palette) makes the app feel "theirs."

**Why it is NOT in current scope:** No user accounts exist (MVP has no auth). Accent color preference cannot be persisted beyond localStorage. The design cost of validating N accent colors against 2 themes is non-trivial.

**Activation condition:** User authentication is implemented AND user preference persistence is available AND there is evidence that personalization drives retention for the target audience.

**Architectural impact if activated:** The `--sp-primary` family of tokens must accept a dynamic value set at runtime via JavaScript (CSS custom property override on `<body>`). The curated palette must be validated for WCAG AA contrast against both dark and light surface tokens.

**Risk of anticipating it too early:** Building a dynamic accent system before auth exists means the preference resets on device change, creating a broken-feeling experience.

---

## Section 2 -- Announcement and Campaign Targeting

### Audience-Targeted Announcements

**Why it may matter:** Different user segments need different messages. Free users should see upgrade prompts; Pro users should not. Authenticated users can see personalized content; anonymous users see generic messaging.

**Why it is NOT in current scope:** No authentication system exists in MVP. The `audience` field exists in the `AnnouncementConfig` data model for forward compatibility, but only `'all'` is functional.

**Activation condition:** Authentication is implemented AND at least two distinct user tiers exist (free/Pro).

**Architectural impact if activated:** The `AnnouncementSlot` filtering logic adds an audience check against the current user's auth state. Requires integration with an auth context provider.

**Risk of anticipating it too early:** Building audience filtering without auth creates dead code paths that must be maintained and tested despite never executing.

---

### Countdown Banners

**Why it may matter:** A countdown to kickoff for a major match or tournament opener creates anticipation and drives return visits.

**Why it is NOT in current scope:** Countdown banners require a timer component, time zone handling for display, and a mechanism to associate announcements with specific match/event timestamps. The announcement system is text-only in v1.

**Activation condition:** Evidence that countdown banners drive measurable engagement (return visits, session starts around match time) for sports content apps in the target market.

**Architectural impact if activated:** Extends `AnnouncementConfig` with a `countdownTargetUtc` field. The `AnnouncementSlot` renders a live-updating countdown instead of (or alongside) the text message. Time zone conversion uses existing `America/Montevideo` logic.

**Risk of anticipating it too early:** Countdown timers are visually prominent and can feel gimmicky if overused. Building the infrastructure before validating the engagement hypothesis wastes effort.

---

### Rich Announcement Content

**Why it may matter:** An announcement with an image, formatted text, or emoji support is more engaging than plain text.

**Why it is NOT in current scope:** Rich content requires sanitization (XSS prevention), responsive image handling, and a more complex rendering component. Plain text is safe and sufficient for system messages.

**Activation condition:** Editorial team exists AND has expressed a need for formatted announcements AND a sanitization library is vetted.

**Architectural impact if activated:** The `message` field changes from `string` to a structured content type (markdown or limited HTML). The rendering component uses a sanitized renderer. The config file or API must validate content safety.

**Risk of anticipating it too early:** Introducing HTML rendering in announcements opens an XSS surface. Building sanitization infrastructure for a feature used once a month is poor ROI.

---

### Announcement Analytics

**Why it may matter:** Knowing how many users saw an announcement, clicked its CTA, or dismissed it informs whether announcements are effective.

**Why it is NOT in current scope:** No analytics infrastructure exists in MVP. No event pipeline, no data warehouse, no dashboards.

**Activation condition:** An analytics pipeline exists (even basic: event -> server endpoint -> log file) AND the team regularly creates announcements (weekly+).

**Architectural impact if activated:** The `AnnouncementSlot` component emits events (`announcement_shown`, `announcement_clicked`, `announcement_dismissed`) to an analytics hook. Requires an analytics context provider.

**Risk of anticipating it too early:** Adding event emission without a consumer creates noise. Analytics code in components increases bundle size and complexity for zero benefit until the pipeline exists.

---

## Section 3 -- Density and Display Preferences

### Compact Mode for Power Users

**Why it may matter:** Users who check multiple leagues frequently may prefer denser information display -- smaller cards, tighter spacing, more data per viewport.

**Why it is NOT in current scope:** The design system has one spacing scale. A compact mode requires a parallel scale (e.g., 75% of default spacing), testing every component at both densities, and a UI toggle.

**Activation condition:** User feedback indicating information density is insufficient for power users AND the design system is stable enough that a second density mode can be tested comprehensively.

**Architectural impact if activated:** The `density` field in `SiteExperienceConfig.presentation` gains a `'compact'` option. Spacing tokens (`--sp-space-*`) reference a density multiplier. Font size tokens may also scale. Every component must be tested at both densities.

**Risk of anticipating it too early:** Designing for two densities from day one doubles the testing surface for every component. It's more efficient to nail one density first, then derive compact from it.

---

### Large / Accessible Mode

**Why it may matter:** Users with visual impairments or those using the app on large displays may benefit from larger text, more generous touch targets, and higher contrast.

**Why it is NOT in current scope:** Accessibility improvements should be incremental (token-by-token contrast improvements, touch target sizing) rather than a separate "mode."

**Activation condition:** Accessibility audit reveals systemic issues that cannot be fixed by adjusting individual tokens, AND a distinct mode provides materially better accessibility than token-level fixes.

**Architectural impact if activated:** A `'large'` density option. Font size tokens scale up (e.g., 125%). Spacing tokens increase. Touch targets exceed 48px minimum. May require layout breakpoint adjustments.

**Risk of anticipating it too early:** "Accessible mode" as a separate toggle implies the default mode is not accessible, which is the wrong framing. Better to make the default mode accessible.

---

### User Preference Persistence Beyond Session

**Why it may matter:** Reduced motion, density, and theme preferences should follow the user across devices once they have an account.

**Why it is NOT in current scope:** No auth system. Preferences persist in localStorage (device-local only).

**Activation condition:** Authentication is implemented AND users report losing preferences when switching devices.

**Architectural impact if activated:** A user preferences API endpoint. `SiteExperienceConfig` sources user preferences from the API (with localStorage as fallback). Merge logic for when server and local preferences conflict.

**Risk of anticipating it too early:** Building server-side preference storage without auth means it is unused. Building auth just for preferences is scope creep.

---

## Section 4 -- Remote Config and Editorial Workflows

### Admin UI for Scheduling Announcements

**Why it may matter:** Non-technical team members need to create, schedule, and manage announcements without editing config files.

**Why it is NOT in current scope:** The existing `/admin` back-office is minimal (competition enablement + feature toggles). Adding a full announcement editor is a significant UI effort for a feature used infrequently.

**Activation condition:** Announcements are created/changed weekly+ AND the team includes non-technical members who need to manage them.

**Architectural impact if activated:** Extends `/admin` with an announcement management page. CRUD operations on `AnnouncementConfig` objects. Stored in `cache/site-experience.json`. Served via API.

**Risk of anticipating it too early:** Building an admin UI for a feature used monthly is over-investment. A config file edit by a developer is faster for low-frequency use.

---

### CDN-Backed Config with Edge Caching

**Why it may matter:** Serving `SiteExperienceConfig` from a CDN edge reduces latency for the first config fetch, especially for users far from the origin server.

**Why it is NOT in current scope:** The app is a SPA with a single origin server (Render). Config is either bundled (Option A) or fetched from the same origin (Option B). CDN adds infrastructure complexity.

**Activation condition:** Global user base with measurable latency issues for initial config load AND config changes frequently enough that bundling is impractical.

**Architectural impact if activated:** Config published to a CDN (e.g., Cloudflare KV, S3 + CloudFront). TTL-based invalidation. Frontend fetches from CDN URL instead of origin API.

**Risk of anticipating it too early:** CDN infrastructure for a config that changes monthly is pure overhead. The latency of a single JSON fetch from origin is negligible for the current user base.

---

### CMS-Lite for Editorial Announcements

**Why it may matter:** Editorial announcements benefit from rich editing (preview, scheduling, template selection) that goes beyond a simple form.

**Why it is NOT in current scope:** CMS features are massive scope. The announcement system is a single text field with optional CTA.

**Activation condition:** An editorial team exists AND produces announcements daily AND needs workflow features (drafts, approval, scheduling).

**Architectural impact if activated:** Either integrate a headless CMS or build a custom editing experience in the admin panel. Content model must align with `AnnouncementConfig`.

**Risk of anticipating it too early:** CMS-lite is a product in itself. Building it before the editorial workflow exists means building in a vacuum with no user to validate.

---

### Config Audit Log

**Why it may matter:** Knowing who changed the experience config and when aids debugging ("who turned on the maintenance banner?").

**Why it is NOT in current scope:** The existing portal-config already has an audit log (`cache/portal-config-audit.jsonl`). Extending it to site-experience-config is trivial but unnecessary when config changes are rare.

**Activation condition:** Multiple people manage config AND there is a need to trace config changes to specific individuals/timestamps.

**Architectural impact if activated:** Append-only JSONL log (same pattern as portal-config audit). Each write to `site-experience.json` appends an event.

**Risk of anticipating it too early:** Audit logging infrastructure for a config that rarely changes adds code that is never exercised.

---

## Section 5 -- Experimentation

### A/B Testing for Paywall Placement

**Why it may matter:** Optimal placement and copy for Pro upgrade prompts could significantly impact conversion.

**Why it is NOT in current scope:** No experimentation infrastructure. No analytics. No statistical significance tooling. No Pro tier.

**Activation condition:** Pro tier exists AND monetization is a priority AND an experimentation platform (even basic: random assignment + event logging) is available.

**Architectural impact if activated:** Experimentation context provider. Variant assignment at session start. Announcement or component variants rendered based on assignment. Requires analytics pipeline for measuring outcomes.

**Risk of anticipating it too early:** A/B testing infrastructure without analytics is useless. Analytics without a Pro tier has nothing to optimize. Building the chain bottom-up (analytics first, then experiments) is more efficient.

---

### Theme Preference Experiments

**Why it may matter:** Does defaulting to dark vs light affect retention? Do certain accent colors correlate with engagement?

**Why it is NOT in current scope:** Same as above -- no experimentation infrastructure.

**Activation condition:** Same as above, plus evidence that theme choice materially affects user behavior.

**Architectural impact if activated:** Theme assignment could be experiment-driven instead of user-driven (with user override). Requires careful UX to avoid user frustration.

**Risk of anticipating it too early:** Experimenting with theme defaults risks annoying users who have strong preferences. The ROI of theme experiments is likely low compared to content/feature experiments.

---

### Announcement CTA Experiments

**Why it may matter:** Testing different CTA copy, colors, or placements could improve click-through rates.

**Why it is NOT in current scope:** Same infrastructure gap. Also, the announcement volume is too low to achieve statistical significance.

**Activation condition:** High announcement volume (daily) AND analytics pipeline AND enough traffic for statistical significance within a reasonable time window.

**Architectural impact if activated:** `AnnouncementConfig` gains a `variants` array. The rendering component randomly selects a variant and logs the selection. Analysis happens offline.

**Risk of anticipating it too early:** Over-engineering the announcement data model for experimentation when announcements are monthly at best.

---

## Section 6 -- Localization-Sensitive Experiences

### Region-Specific Campaigns

**Why it may matter:** An announcement about Copa Libertadores is irrelevant to users only following European leagues. Region-targeted campaigns increase relevance.

**Why it is NOT in current scope:** No user location detection. No locale preference. The app serves all competitions to all users.

**Activation condition:** User location is available (browser geolocation or IP-based) AND the user base spans regions with meaningfully different interests.

**Architectural impact if activated:** `AnnouncementConfig.audience` extends with a `region` filter. Location context provider. Privacy considerations (GDPR, consent for geolocation).

**Risk of anticipating it too early:** Building location-based targeting before understanding the user base's geographic distribution means guessing at segments. Privacy compliance adds legal overhead.

---

### Locale-Sensitive Announcement Copy

**Why it may matter:** A Spanish-language app may want to show announcements in Spanish. If the app expands to English or Portuguese, multilingual announcements become necessary.

**Why it is NOT in current scope:** The app is currently Spanish-only. There is no i18n infrastructure.

**Activation condition:** Decision to support multiple languages AND i18n framework adopted AND announcement volume justifies translation effort.

**Architectural impact if activated:** `AnnouncementConfig.message` becomes `Record<Locale, string>` or a localization key. The rendering component resolves the correct locale string.

**Risk of anticipating it too early:** i18n is a cross-cutting concern. Doing it only for announcements creates inconsistency with the rest of the app.

---

## Section 7 -- Multi-Competition / White-Label

### Per-Competition Micro-Theming

**Why it may matter:** Each competition section could have subtle visual differences (accent color, hero gradient) to create a sense of place.

**Why it is NOT in current scope:** The app uses a single brand identity. Per-competition theming is a design exercise that has not been validated.

**Activation condition:** User testing shows that visual differentiation between competition sections improves navigation AND the design team has produced competition-specific palettes.

**Architectural impact if activated:** A `competitionTheme` map in `SiteExperienceConfig`. The active competition context triggers a token override set. Similar mechanism to seasonal overlays but triggered by navigation.

**Risk of anticipating it too early:** Over-designing the token override system for a use case that may not improve UX. Risk of visual inconsistency if palettes are not carefully curated.

---

### White-Label Scenarios

**Why it may matter:** If SportPulse is offered as a platform to third parties (e.g., a sports media company wants their own branded version), a white-label mode would be needed.

**Why it is NOT in current scope:** SportPulse is a single product for a single brand. There is no business model for white-labeling.

**Activation condition:** A business partnership opportunity where white-labeling is a requirement AND the revenue justifies the engineering investment.

**Architectural impact if activated:** The entire token system becomes parameterized. Brand tokens are loaded from a tenant configuration. Components must use ONLY tokens (no hardcoded SportPulse branding). Significant refactoring of any remaining hardcoded brand references.

**Risk of anticipating it too early:** White-label readiness is a massive tax on every design decision. Building for one brand and later extracting a white-label system is more efficient than building for N brands from day one when N=1.

---

## Guardrails Against Premature Implementation

Before implementing ANY item from this roadmap, the following checklist must be satisfied:

1. **Activation condition is met.** The specific real-world trigger documented for the item has occurred. Anticipated triggers do not count.

2. **v1 specs are stable.** Spec 1 (Design System Foundation), Spec 2 (Theme and Announcement System), and Spec 3 (Site Experience Config) are fully implemented and stable. Adding futures on an unstable foundation is waste.

3. **A spec change request is filed.** The item requires a formal spec update to the relevant v1 spec (or a new spec). The roadmap item itself is not a spec. Implementation follows the updated spec, not this roadmap.

4. **MVP scope gate is passed.** The item has been verified against `spec.sportpulse.core.mvp-execution-scope.md`. If it is outside MVP scope, explicit scope expansion approval is required.

5. **Architecture review is completed.** The "architectural impact if activated" section is reviewed by the architect role. The impact may have changed since this roadmap was written.

6. **No v1 regressions.** The implementation must not break, degrade, or complicate any existing v1 functionality. If it does, the design must be revised.

7. **Token discipline is maintained.** Any new visual values introduced by the implementation must follow the token architecture (foundation layer + semantic layer, both themes, documented meaning). No new hardcoded values.

8. **The item has a single owner.** Before starting, one person (or agent) is assigned as the owner. Roadmap items that are "everyone's job" are no one's job.
