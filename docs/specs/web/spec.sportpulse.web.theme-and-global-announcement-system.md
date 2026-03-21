# SportPulse Theme and Global Announcement System

```yaml
artifact_id: spec.sportpulse.web.theme-and-global-announcement-system
title: Theme and Global Announcement System
version: 1.0.0
status: active
created_at: 2026-03-20
depends_on:
  - spec.sportpulse.web.design-system-foundation (token definitions)
  - spec.sportpulse.web.site-experience-config (config delivery)
governs: packages/web/src/hooks/use-theme.ts, packages/web/src/globals.css (theme blocks), announcement rendering
authority: Subordinate to spec.sportpulse.web.ui.md and spec.sportpulse.web.frontend-architecture.md
```

---

# Part A -- Theme System

## A.1. Purpose

The theme system controls the visual appearance of SportPulse by selecting which set of token values are active. It enables users to choose between light and dark presentation without affecting data truth, layout geometry, or semantic meaning.

**What the theme system enables:**
- User-selectable visual mode (dark/light)
- Consistent token-driven appearance across all components
- A foundation for future seasonal/event overlays

**What the theme system does NOT do:**
- It does not change data, scoring, or layout semantics
- It does not enable per-user customization beyond mode selection
- It does not provide A/B testing or experimentation infrastructure
- It does not change content, feature availability, or competition enablement

---

## A.2. Theme Registry v1

Exactly two themes are supported in v1:

### `night` (Dark Mode -- Default)

- CSS class: `:root` (no additional class; dark is the base)
- Character: Deep dark backgrounds, neon cyan accent, high-contrast text on dark surfaces
- Psychological intent: Immersive sports-data experience, reduces eye strain for evening viewing

### `day` (Light Mode)

- CSS class: `body.light`
- Character: Light gray/white backgrounds, sky blue accent, dark text
- Psychological intent: Readability in bright environments, standard daytime browsing

**What changes when a theme is active:**

When `body.light` is applied, every CSS custom property listed in the `body.light` block of `globals.css` overrides its `:root` counterpart. This affects:
- All background/surface colors
- Brand primary color and its opacity variants
- Text color and its opacity variants
- Border opacity levels
- Table row colors
- Glow/shadow brand color
- Status `*-soft` background tint opacities

What does NOT change:
- Status colors (success, error, warning, live remain identical in both themes)
- Zone colors (standings colors are theme-independent)
- Form colors (win/draw/loss are theme-independent)
- Typography scale (font sizes, weights, families)
- Spacing scale
- Radius scale
- Layout structure, component hierarchy, data

---

## A.3. Theme Activation Model

### Storage
- Key: `sportspulse_theme` in `localStorage`
- Values: `'dark'` | `'light'`
- Default (if key missing): `'light'` (current behavior per `use-theme.ts`)

**Note on default:** The current implementation defaults to `'light'`. This spec preserves that behavior. A future change to default to `'dark'` (matching the `:root` base) or to detect `prefers-color-scheme` is deferred.

### Application
1. On mount, `useTheme()` hook reads `localStorage`.
2. `document.body.classList.toggle('light', theme === 'light')` applies or removes the class.
3. All CSS custom properties cascade accordingly.
4. `localStorage` is updated on toggle.

### Hydration
- Theme is applied synchronously in the first React render cycle via `useState` initializer.
- No flash of wrong theme occurs because the initializer reads `localStorage` synchronously.

---

## A.4. What a Theme CAN Override

A theme definition (whether base `night`/`day` or a future seasonal overlay) is permitted to override ONLY these categories of tokens:

1. **Background and surface colors** (`--sp-bg`, `--sp-surface`, `--sp-surface-*`, `--sp-header`)
2. **Primary brand color** and its opacity variants (`--sp-primary`, `--sp-primary-*`, `--sp-primary-glow`, `--sp-brand-rgb`)
3. **Text colors** and their opacity variants (`--sp-text`, `--sp-text-*`, `--sp-secondary`)
4. **Border colors** and their opacity variants (`--sp-border`, `--sp-border-*`)
5. **Table row colors** (`--sp-row-even`, `--sp-row-hover`)
6. **Status soft backgrounds** (`--sp-status-*-soft`) -- the background tint, NOT the status color itself
7. **Shadow/glow values** (`--sp-primary-glow`, `box-shadow: neon`)

---

## A.5. What a Theme CANNOT Break

These invariants must hold regardless of which theme is active:

1. **Layout geometry.** No token override may change element dimensions, spacing, padding, margin, or flex/grid behavior. Layout is theme-independent.
2. **Typography scale.** Font sizes, weights, line heights, and font families must be identical across themes.
3. **Spacing scale.** All spacing tokens are theme-independent.
4. **Radius scale.** All radius tokens are theme-independent.
5. **Status color semantics.** `--sp-status-success` MUST mean success in every theme. A theme cannot redefine success as red or error as green.
6. **Zone color semantics.** Relegation is always `--sp-zone-relegation`. Themes cannot swap zone meanings.
7. **Data truth.** No theme may alter, hide, reorder, or reinterpret data from the snapshot pipeline.
8. **Accessibility minimums.** Text on background must maintain at minimum WCAG AA contrast ratio (4.5:1 for body text, 3:1 for large text) in every theme.
9. **Component structure.** Themes control appearance, never DOM structure or component hierarchy.

---

## A.6. Seasonal/Event Themes (Concept for v1 Design, Deferred Implementation)

### Concept

A seasonal theme is an **overlay** that applies on top of the active base theme (`night` or `day`). It does not replace the base theme; it augments it with event-specific accent colors or surface tints.

### Mechanism

An additional CSS class on `<body>`:
```
body.event-mundial { ... }
body.event-copa-america { ... }
body.event-champions-final { ... }
```

The overlay class contains ONLY token overrides for the properties it wants to change. All other tokens cascade from the base theme.

### Example

```css
body.event-mundial {
  --sp-primary: #8B1538;           /* FIFA maroon */
  --sp-primary-10: rgba(139,21,56,0.10);
  --sp-primary-22: rgba(139,21,56,0.22);
  --sp-primary-40: rgba(139,21,56,0.40);
  --sp-primary-glow: 0 0 12px rgba(139,21,56,0.4);
  --sp-brand-rgb: 139, 21, 56;
}
```

### Contract for Seasonal Overlays

A seasonal overlay:
- CAN override: primary brand color family, surface tints, glow color
- CANNOT override: status colors, zone colors, form colors, text opacity scale, spacing, radius, typography
- CANNOT add new tokens (only override existing ones)
- MUST be time-bounded (has a start and end date in config)
- MUST be removable without any code change (controlled via config)

### v1 Status

The CSS mechanism is defined here for architectural clarity. No seasonal overlays are implemented in v1. The `seasonalOverlay` field in `SiteExperienceConfig` is nullable and defaults to `null`.

---

## A.7. Theme Precedence

When multiple theme layers could apply simultaneously:

```
Priority (lowest to highest):
1. :root block (dark base -- always present)
2. body.light (light base -- present if user selected day mode)
3. body.event-* (seasonal overlay -- present if config activates one)
```

CSS specificity handles this naturally: `body.event-mundial` has equal specificity to `body.light`, but appears later in the stylesheet, so it wins for any shared properties.

**Conflict resolution:** If a seasonal overlay and the light theme both define `--sp-primary`, the seasonal overlay wins (later in cascade). This is intentional: the event accent should override the base theme's accent.

---

## A.8. Fallback

- If `localStorage` contains an invalid value (not `'dark'` or `'light'`): treat as `'light'` (current default behavior).
- If `body` has no theme class: `:root` tokens apply (dark mode).
- If a seasonal overlay class is present but the corresponding CSS block does not exist: no visual effect (missing CSS rule is a no-op).
- If CSS fails to load entirely: the app renders with browser defaults. This is a catastrophic failure outside theme system scope.

---

## A.9. Non-Goals

The theme system in v1 does NOT provide:
- Auto-detection of system dark/light preference (`prefers-color-scheme`)
- User-selectable accent colors
- Per-competition branded themes
- Theme preview/transition animations
- Theme scheduling (auto-switch at sunset)
- Theme persistence across devices (requires auth, which is out of MVP scope)
- AMOLED/true-black dark variant

---

# Part B -- Global Announcement System

## B.1. Purpose

The global announcement system provides a mechanism to display product-level messages to users: system notices, editorial content, commercial calls-to-action, and time-bounded event campaigns.

**Critical distinction:** Announcements are PRODUCT messages. They are NOT operational warnings from the data pipeline. The backend warning taxonomy (`WarningDTO` from snapshots) has its own rendering system (`WarningBanner.tsx`) and must never be confused with or rendered through the announcement system.

---

## B.2. Announcement Taxonomy

Exactly four announcement types are defined:

### `operational`

- **Origin:** System/infrastructure team
- **Purpose:** Communicate system state that affects user experience (planned maintenance, degraded service, known issues)
- **Severity:** `info`, `warning`, or `error`
- **Examples:** "Scheduled maintenance tonight 2am-4am UTC", "LaLiga data delayed due to provider issues", "Service restored -- thank you for your patience"
- **NOT the same as** backend `WarningDTO` -- those are pipeline data-quality signals. Operational announcements are human-authored system messages.

### `editorial`

- **Origin:** Product team
- **Purpose:** Inform users about product updates, tips, or content
- **Severity:** Always `info` (implicit)
- **Examples:** "New: head-to-head stats now available in match detail", "We added Copa Libertadores coverage"

### `commercial`

- **Origin:** Business/monetization team
- **Purpose:** Revenue-related calls to action
- **Severity:** Always `info` (implicit)
- **Examples:** "Upgrade to Pro for advanced predictions", "Special launch offer: 50% off first month"

### `seasonal`

- **Origin:** Product team, tied to sporting calendar
- **Purpose:** Time-bounded event awareness
- **Severity:** Always `info` (implicit)
- **Examples:** "Copa America 2026 starts June 11", "Champions League Final week -- check our special coverage"

---

## B.3. Announcement Data Model

```typescript
interface AnnouncementConfig {
  /** Unique identifier for this announcement. Used for dismiss persistence. */
  id: string;

  /** Announcement type. Determines rendering style and dismissibility rules. */
  type: 'operational' | 'editorial' | 'commercial' | 'seasonal';

  /** Display message. Plain text only in v1 (no HTML, no markdown). */
  message: string;

  /** Optional call-to-action button. */
  cta?: {
    /** Button label text. */
    label: string;
    /** Action: a URL path (internal route) or full URL (external). */
    action: string;
  };

  /** Whether the user can dismiss this announcement. Subject to type-level rules. */
  dismissible: boolean;

  /** Priority for ordering. 1 = highest priority. Lower numbers take precedence. */
  priority: number;

  /** Target audience. 'all' in v1 (auth is not implemented). */
  audience: 'all' | 'anonymous' | 'authenticated' | 'pro';

  /** Where this announcement appears. */
  scope: 'global' | 'route' | 'competition';

  /** Required if scope is 'route' or 'competition'. Route path or competitionId. */
  scopeTarget?: string;

  /** ISO 8601 timestamp. Announcement is not shown before this time. */
  startAt?: string;

  /** ISO 8601 timestamp. Announcement is not shown after this time. */
  endAt?: string;

  /**
   * Severity level. Only applicable for type 'operational'.
   * Ignored for other types (they are implicitly 'info').
   */
  severity?: 'info' | 'warning' | 'error';
}
```

**Invariants on the data model:**
- `id` must be unique across all announcements in the config.
- `audience` is always `'all'` in v1 (no auth system). Other values are defined for forward compatibility.
- `scope: 'route'` with `scopeTarget: '/standings'` means the announcement appears only on that route.
- `scope: 'competition'` with `scopeTarget: 'PD'` means it appears only when LaLiga is the active competition.
- `startAt`/`endAt` are evaluated client-side against `Date.now()`.

---

## B.4. Rendering Placement

### Global Announcements

- **Position:** Above the Navbar, at the very top of the viewport.
- **Layout behavior:** Push (not overlay). The announcement banner pushes the Navbar and all content down.
- **z-index:** Above Navbar (`z-index: 60`, Navbar is `z-index: 50`).
- **Width:** Full viewport width, no horizontal margin.
- **Height:** Auto, based on content. Single line for most messages.

### Route-Scoped Announcements

- **Position:** Below the Navbar, above the page content area.
- **Layout behavior:** Push. Content shifts down.

### Competition-Scoped Announcements

- **Position:** Same as route-scoped (below Navbar, above content).
- **Visibility:** Only when the specified competition is active.

### DOM Structure

```
<body>
  <AnnouncementSlot />     <!-- global scope announcements -->
  <Navbar />
  <AnnouncementSlot />     <!-- route/competition scope announcements -->
  <PageContent />
</body>
```

The `AnnouncementSlot` component is a thin wrapper that filters and renders announcements for its scope.

---

## B.5. Precedence Rules

When multiple announcements could be visible simultaneously:

1. **Type priority:** `operational` > `editorial` = `commercial` = `seasonal`
2. **Within same type:** Lower `priority` number wins (1 beats 2).
3. **Maximum visible simultaneously:**
   - Global scope: **1** announcement at a time (highest priority that passes all filters)
   - Route scope: **1** announcement at a time
   - Competition scope: **1** announcement at a time
   - Total maximum on screen: **2** (1 global + 1 route/competition)

4. **Replacement behavior:** When a higher-priority announcement becomes active (e.g., enters its `startAt` window), it replaces the current lower-priority one. No stacking.

5. **Operational always visible:** If an `operational` announcement with severity `error` is active, it is shown even if the global slot is occupied by another announcement. In this case, the operational announcement displaces whatever was there.

---

## B.6. Dismissibility Rules

| Type | Severity | Dismissible? | Persistence |
|---|---|---|---|
| `operational` | `error` | NO | N/A -- always visible while active |
| `operational` | `warning` | YES | `sessionStorage` by `id` (returns on new session) |
| `operational` | `info` | YES | `sessionStorage` by `id` |
| `editorial` | (implicit info) | YES | `localStorage` by `id` (permanent until config removes it) |
| `commercial` | (implicit info) | YES | `localStorage` by `id` |
| `seasonal` | (implicit info) | YES | `localStorage` by `id` |

**Storage key format:** `sp_dismissed_announcement_{id}`

**Rule:** The `dismissible` field in the data model is a declaration. However, the system enforces type-level overrides:
- If `type === 'operational' && severity === 'error'`, `dismissible` is forced to `false` regardless of the config value.
- For all other combinations, the config value is respected.

---

## B.7. Scheduling Behavior

- `startAt` and `endAt` are optional ISO 8601 timestamps.
- If `startAt` is set and `Date.now() < new Date(startAt).getTime()`: announcement is hidden.
- If `endAt` is set and `Date.now() > new Date(endAt).getTime()`: announcement is hidden.
- If neither is set: announcement is always active (until removed from config).
- Evaluation happens client-side on each render cycle of the `AnnouncementSlot` component. No timer/interval needed; React re-renders on route changes and user interactions provide sufficient frequency.
- **Edge case:** If a user keeps the tab open across a `startAt` boundary, the announcement appears on the next re-render (route change, theme toggle, data refresh, etc.). Exact-second precision is not required.

---

## B.8. Distinction from Backend Operational Warnings

**This section is CRITICAL. Confusion between these two systems is an architectural violation.**

### Backend Operational Warnings (`WarningDTO`)

- **Source:** Snapshot pipeline (`packages/snapshot`)
- **Content:** Data quality signals: `MISSING_SIGNAL`, `NO_UPCOMING_MATCH`, `INSUFFICIENT_HISTORY`, `STALE_DATA`, etc.
- **Shape:** `WarningDTO { code: string; severity: 'WARN' | 'ERROR'; message?: string; teamId?: string }`
- **Rendered by:** `WarningBanner.tsx` component
- **Location:** Inside the dashboard content area, below the header, above match cards
- **Semantics:** "The data pipeline encountered a quality issue for this snapshot"
- **Lifecycle:** Tied to snapshot builds. Appears/disappears as data quality changes.
- **Taxonomy:** Defined in `spec.sportpulse.shared.errors-and-warnings-taxonomy.md`

### Announcements

- **Source:** Product/system team via `SiteExperienceConfig`
- **Content:** Human-authored messages about the product, system, or events
- **Shape:** `AnnouncementConfig` (defined in B.3)
- **Rendered by:** `AnnouncementSlot` component (new)
- **Location:** Above or below the Navbar, outside the data content area
- **Semantics:** "The team wants to tell you something"
- **Lifecycle:** Tied to config. Manual add/remove.
- **Taxonomy:** Defined in this spec (B.2)

### Separation Rules

1. `WarningBanner` MUST NOT render `AnnouncementConfig` data.
2. `AnnouncementSlot` MUST NOT render `WarningDTO` data.
3. They MUST NOT share a rendering position (one is inside content, one is outside).
4. They MUST NOT share dismiss state or storage keys.
5. `WarningDTO` severity values (`WARN`, `ERROR`) are NOT the same as `AnnouncementConfig` severity values (`info`, `warning`, `error`). They use different enums deliberately.

---

## B.9. Fallback

- If `SiteExperienceConfig.announcements` is an empty array: no announcements rendered. This is the default state.
- If `SiteExperienceConfig` fails to load: no announcements rendered. Fail silent.
- If an announcement has an invalid `type` value: skip it, log a warning to console.
- If an announcement has a `scope` that doesn't match the current context: skip it silently (this is expected behavior, not an error).
- If `localStorage`/`sessionStorage` is unavailable (private browsing): dismiss state is lost per page load. Announcements reappear. This is acceptable.

---

## B.10. Anti-Patterns

1. **Using announcements to communicate data quality issues.** Data quality belongs in `WarningBanner`. If LaLiga scores are stale, that is a `WarningDTO`, not an announcement.

2. **Stacking multiple banners.** The system enforces max 1 per scope. Do not circumvent by creating multiple scopes for the same message.

3. **Using `operational` type for commercial content.** Operational is reserved for genuine system state. Abusing it to bypass dismissibility rules degrades user trust.

4. **Setting `endAt` far in the future as "permanent".** If an announcement is permanent, omit `endAt`. Setting it to year 2099 is a code smell.

5. **Using announcements as a changelog.** Announcements are ephemeral. Product changelogs belong in documentation or a dedicated page.

6. **Hardcoding announcements in component files.** All announcements MUST come from `SiteExperienceConfig`, never from JSX literals.

7. **Rendering announcement content as HTML.** v1 is plain text only. No `dangerouslySetInnerHTML`. Rich content is a deferred feature.

8. **Using announcements to override WarningBanner.** If both an operational announcement and a WarningBanner are active, both must render independently in their respective slots.

---

## B.11. v1 Limits

**In scope for v1:**
- `AnnouncementConfig` data model (TypeScript type)
- `AnnouncementSlot` rendering component (reads from config, renders banner)
- Dismiss state persistence (localStorage/sessionStorage)
- Time-based filtering (startAt/endAt)
- Type-based styling (4 visual variants)
- Scope filtering (global, route, competition)

**NOT in v1:**
- Admin UI for managing announcements (edit config file or API directly)
- Rich content (images, emoji reactions, multi-paragraph)
- Analytics (impression/click/dismiss tracking)
- Audience targeting beyond `'all'` (requires auth)
- A/B testing of announcement variants
- Real-time push updates (announcements are read at config load time)
- Animation for enter/exit transitions

---

## B.12. Deferred Future Considerations

- **Admin UI for announcements.** Extend the existing `/admin` back-office with an announcement editor. Requires form builder for `AnnouncementConfig`.
- **Push-based updates.** Server-sent events or polling to update announcements without page reload. Useful for live match-day operational messages.
- **Rich content.** Markdown or limited HTML support for editorial announcements. Requires sanitization.
- **Analytics.** Track impressions, CTA clicks, and dismissals. Feed into product metrics.
- **Audience segmentation.** Show different announcements to Pro vs free users once auth exists.
- **Localization.** Multilingual announcement content keyed by user locale.
