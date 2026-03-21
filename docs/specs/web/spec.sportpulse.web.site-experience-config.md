# SportPulse Site Experience Config

```yaml
artifact_id: spec.sportpulse.web.site-experience-config
title: Site Experience Config
version: 1.0.0
status: active
created_at: 2026-03-20
depends_on:
  - spec.sportpulse.web.design-system-foundation (token definitions consumed)
  - spec.sportpulse.web.theme-and-global-announcement-system (theme + announcement types consumed)
governs: packages/web/src/config/site-experience.ts (new), related hooks
authority: Subordinate to spec.sportpulse.web.frontend-architecture.md
```

---

## 1. Purpose

`SiteExperienceConfig` is the operational configuration layer that controls how SportPulse looks and what product messages it displays. It is the runtime bridge between the design system tokens (Spec 1), the theme/announcement contracts (Spec 2), and the running application.

**What SiteExperienceConfig IS:**
- The single config object that determines: active theme, active seasonal overlay, active announcements, and presentation preferences
- A frontend-owned concern -- it controls visual experience, not product features or data

**What SiteExperienceConfig is NOT:**
- It is NOT `portal-config`. Portal-config (`/api/ui/portal-config`) controls which competitions are enabled and which features (TV, Predictions) are active. SiteExperienceConfig controls how the enabled features LOOK and what messages appear.
- It is NOT a feature flag system. Feature flags (enable/disable predictions, enable/disable TV) belong to portal-config.
- It is NOT a backend data configuration. It does not control data sources, API keys, polling intervals, or cache TTLs.

---

## 2. Scope

SiteExperienceConfig controls exactly these classes of configuration:

| Category | What It Controls | What It Does NOT Control |
|---|---|---|
| **Theme** | Active theme (`night`/`day`), seasonal overlay | Competition enablement, feature flags |
| **Announcements** | Active announcements list, dismiss state | Backend warnings (`WarningDTO`), data quality |
| **Presentation** | Reduced motion override, density mode | Layout geometry, treemap algorithm, scoring |

The boundary is strict: if it affects what data is available or what features are enabled, it belongs in portal-config. If it affects how things look or what messages the user sees, it belongs here.

---

## 3. Config Shape v1

```typescript
interface SiteExperienceConfig {
  /**
   * Active base theme.
   * Controls which CSS token set is applied.
   * Stored in and read from localStorage by useTheme().
   */
  theme: 'night' | 'day';

  /**
   * Optional seasonal theme overlay.
   * When set, adds `body.event-{value}` CSS class on top of the base theme.
   * null means no seasonal overlay is active.
   * v1: always null. Defined for architectural readiness.
   */
  seasonalOverlay: string | null;

  /**
   * Active announcements.
   * Ordered by priority (ascending -- lowest number first).
   * Empty array means no announcements.
   */
  announcements: AnnouncementConfig[];

  /**
   * Presentation preferences.
   */
  presentation: {
    /**
     * Whether to reduce motion.
     * true: disable CSS animations (respects prefers-reduced-motion OR user manual override).
     * false: all animations enabled.
     * Default: follows prefers-reduced-motion media query.
     */
    reducedMotion: boolean;

    /**
     * UI density mode.
     * 'default': standard spacing and sizing.
     * v1 only supports 'default'. 'compact' is deferred.
     */
    density: 'default';
  };
}
```

**AnnouncementConfig type** is defined in Spec 2 (spec.sportpulse.web.theme-and-global-announcement-system.md, section B.3). It is imported by reference, not redefined here.

---

## 4. Build-Time vs Runtime Classification

Every field in `SiteExperienceConfig` has an explicit classification:

| Field | Build-Time Default | Runtime Source (v1) | Can Change Without Deploy? |
|---|---|---|---|
| `theme` | `'light'` | `localStorage` (`sportspulse_theme`) | YES (user toggle) |
| `seasonalOverlay` | `null` | Hardcoded constant | NO (requires code change in v1) |
| `announcements` | `[]` (empty) | Hardcoded constant OR API extension | Depends on source (see 4.1) |
| `presentation.reducedMotion` | `false` | `prefers-reduced-motion` media query | YES (OS setting) |
| `presentation.density` | `'default'` | Hardcoded constant | NO (only one value in v1) |

### 4.1 Announcement Source Options for v1

Two acceptable implementation strategies exist for v1. The implementer may choose either:

**Option A: Static config file**
- Announcements are defined in `packages/web/src/config/announcements.ts` as a typed array.
- Changes require a code change and deploy.
- Simplest implementation. Zero runtime dependency.
- Appropriate if announcements change rarely (monthly or less).

**Option B: API extension**
- Announcements are served via a new endpoint (e.g., `GET /api/ui/site-experience`) or as an extension to the existing `GET /api/ui/portal-config` response.
- Backend reads from a config file on disk (similar to `portal-config.json`).
- Changes require editing the file on the server (via admin API or direct file edit).
- More complex but allows changes without frontend deploy.

**Decision criteria:** If the team expects to change announcements more than once per sprint, use Option B. Otherwise, Option A is sufficient and simpler.

Both options produce the same `SiteExperienceConfig` shape to the consuming components. The hook (`useSiteExperience`) abstracts the source.

---

## 5. Config Source Hierarchy

When multiple sources could provide a value, the following precedence applies (highest priority first):

### Theme
1. **User explicit preference** (localStorage) -- highest
2. **Remote config** (if served via API in future) -- not used in v1
3. **Hardcoded default** (`'light'`) -- lowest

### Seasonal Overlay
1. **Remote config** (if served via API) -- not used in v1
2. **Hardcoded default** (`null`) -- used in v1

### Announcements
1. **Remote config** (API response, if Option B) -- used in v1 if chosen
2. **Static config file** (if Option A) -- used in v1 if chosen
3. **Hardcoded default** (`[]`) -- fallback if source fails

### Presentation
1. **User explicit preference** (localStorage, for reducedMotion manual override) -- future
2. **OS-level preference** (`prefers-reduced-motion` media query)
3. **Hardcoded default** (`reducedMotion: false`, `density: 'default'`)

**Rule:** A higher-priority source always wins. If a higher-priority source is unavailable (network failure, missing key), fall through to the next level. Never block rendering waiting for a source.

---

## 6. v1 Implementation

### 6.1 Theme (Already Implemented)

The existing `useTheme()` hook in `packages/web/src/hooks/use-theme.ts` already implements the theme portion of `SiteExperienceConfig`:
- Reads from `localStorage` key `sportspulse_theme`
- Applies `body.light` class
- Provides `toggleTheme()` method

**No changes required to `useTheme()` for v1.** It continues to work independently. The `SiteExperienceConfig` type includes `theme` for completeness and to establish the contract for when a unified config hook is introduced.

### 6.2 Announcements (New in v1)

**Minimum viable implementation (Option A):**

1. Create `packages/web/src/config/announcements.ts`:
   ```typescript
   import type { AnnouncementConfig } from '../types/announcement.js';
   export const ACTIVE_ANNOUNCEMENTS: AnnouncementConfig[] = [];
   ```

2. Create `packages/web/src/hooks/use-announcements.ts`:
   - Reads `ACTIVE_ANNOUNCEMENTS` (or fetches from API if Option B)
   - Filters by `startAt`/`endAt` against current time
   - Filters by `scope` against current route/competition
   - Filters out dismissed IDs from localStorage/sessionStorage
   - Returns the highest-priority announcement per scope slot

3. Create `packages/web/src/components/AnnouncementSlot.tsx`:
   - Renders the announcement banner with type-appropriate styling
   - Handles dismiss action and persists to storage

### 6.3 Presentation (New in v1)

- `reducedMotion`: Read `window.matchMedia('(prefers-reduced-motion: reduce)')` on mount. The existing `match-map.css` already has `@media (prefers-reduced-motion)` rules. No additional implementation needed for v1 beyond documenting the behavior.
- `density`: Fixed at `'default'`. No implementation needed.

### 6.4 Unified Hook (Optional for v1)

A `useSiteExperience()` hook that assembles the full `SiteExperienceConfig` from its sources:

```typescript
function useSiteExperience(): SiteExperienceConfig {
  const { theme } = useTheme();
  const announcements = useAnnouncements();
  const reducedMotion = useReducedMotion();
  return {
    theme: theme === 'light' ? 'day' : 'night',
    seasonalOverlay: null,
    announcements,
    presentation: { reducedMotion, density: 'default' },
  };
}
```

This hook is optional for v1. Components can continue to use `useTheme()` and `useAnnouncements()` independently. The unified hook becomes useful when downstream consumers need the full picture (e.g., analytics, debugging).

---

## 7. Failure Behavior

| Failure | Behavior |
|---|---|
| `localStorage` unavailable | Theme defaults to hardcoded. Dismiss state lost per page load. |
| API for announcements unreachable (Option B) | Empty announcements. No banner shown. |
| API returns malformed JSON | Parse error caught. Empty announcements. Console warning logged. |
| `prefers-reduced-motion` not supported | `reducedMotion` defaults to `false`. |
| Config file missing (Option A) | Build error. Caught at compile time. |

**Cardinal rule:** SiteExperienceConfig failures MUST NEVER block page rendering. The page renders with defaults. The user sees the dashboard. No spinner, no error screen, no retry loop.

---

## 8. Safety Rules

1. **SiteExperienceConfig MUST NEVER control competition or feature enablement.** Enabling/disabling LaLiga, predictions, TV, or any product feature is the exclusive domain of `portal-config`. Violation of this boundary is an architectural error.

2. **SiteExperienceConfig MUST NEVER inject backend-owned semantics.** It cannot define warning codes, scoring thresholds, data quality signals, or any concept owned by the backend pipeline.

3. **Announcements MUST NEVER override operational warning priority.** If both `WarningBanner` and an announcement are active, both render in their respective slots. The announcement system cannot suppress or replace `WarningBanner`.

4. **Config values MUST be validated at read time.** Invalid enum values are replaced with defaults, not passed through. A `theme: 'neon'` value resolves to the default (`'light'`), not to an undefined state.

5. **No side effects on read.** Reading `SiteExperienceConfig` must not trigger API calls, analytics events, or state mutations. It is a pure data read.

---

## 9. Relationship with Portal-Config

These two config systems serve different masters and must not be conflated.

| Aspect | portal-config | site-experience-config |
|---|---|---|
| **What it controls** | What is available (competitions, features) | How it looks (theme, announcements, density) |
| **Owner** | Product/business decisions | Design/experience decisions |
| **Backend endpoint** | `GET /api/ui/portal-config` | None in v1 (or new endpoint if Option B) |
| **Persistence** | `cache/portal-config.json` on server | `localStorage` on client (theme, dismissals) |
| **Admin UI** | `/admin` back-office (existing) | None in v1 |
| **Blocking?** | YES -- `ServerBootScreen` shown until loaded | NO -- defaults used if unavailable |
| **Affects data flow?** | YES -- controls which competitions are fetched | NO -- purely presentational |

**Interaction points:**
- `portal-config.enabledCompetitionIds` determines which competitions exist. `site-experience-config.announcements[].scopeTarget` can reference those competition IDs for scoping, but cannot add or remove competitions.
- If portal-config disables a competition, any announcement scoped to that competition is effectively invisible (no route to render on).

---

## 10. Observability

The following must be logged or exposed for debugging:

| Event | Log Level | Output |
|---|---|---|
| Theme applied on mount | `debug` | `[SiteExperience] Theme applied: night` |
| Theme toggled | `info` | `[SiteExperience] Theme changed: night -> day` |
| Seasonal overlay applied | `info` | `[SiteExperience] Seasonal overlay activated: event-mundial` |
| Announcement shown | `debug` | `[SiteExperience] Announcement shown: {id}, type: {type}` |
| Announcement dismissed | `info` | `[SiteExperience] Announcement dismissed: {id}` |
| Announcement filtered by time | `debug` | `[SiteExperience] Announcement {id} outside time window` |
| Config source failed | `warn` | `[SiteExperience] Failed to load remote config: {error}. Using defaults.` |
| Invalid config value | `warn` | `[SiteExperience] Invalid theme value: 'neon'. Defaulting to 'light'.` |

All logs use `console.*` in v1. No external logging service.

---

## 11. Migration Path Hints

These are conceptual directions, not commitments. They add zero obligations to v1.

### v1 (Current)
- Theme: localStorage + `useTheme()` hook. Already done.
- Announcements: static config file or simple API extension.
- Presentation: OS-level `prefers-reduced-motion` only.
- No admin UI for experience config.

### v2 (Potential)
- Announcements managed via the existing `/admin` back-office.
- Admin form to create/edit/schedule announcements.
- Announcements stored in `cache/site-experience.json` on server.
- Served via `GET /api/ui/site-experience`.
- Seasonal overlay configurable via admin.

### v3 (Potential)
- Config served from CDN edge cache for zero-latency delivery.
- Scheduled config (pre-program theme changes for events).
- Analytics pipeline for announcement engagement.
- Integration with future auth system for audience targeting.

---

## 12. v1 Limits -- Explicit

**Implemented in v1:**
- `SiteExperienceConfig` TypeScript type definition
- `AnnouncementConfig` TypeScript type definition
- `useAnnouncements()` hook (reads static config or API)
- `AnnouncementSlot` component (renders, filters, dismisses)
- Time-based announcement filtering
- Scope-based announcement filtering
- Dismiss persistence (localStorage/sessionStorage)
- Console-level observability logging

**NOT implemented in v1:**
- Admin UI for experience config
- Remote config API endpoint (unless Option B is chosen)
- Seasonal overlay activation (mechanism defined, implementation deferred)
- Density mode beyond `'default'`
- Manual reduced-motion override toggle in UI
- Config versioning or migration tooling
- Analytics for announcement engagement
- Server-side rendering of config (SSR -- not applicable, app is SPA)

---

## 13. Deferred Future Considerations

- **Unified config endpoint.** Merge portal-config and site-experience-config into a single API response with clear namespacing. Pro: one fetch. Con: couples two conceptually separate concerns.
- **Config schema validation.** Zod schema for `SiteExperienceConfig` validated at read time. Protects against malformed API responses.
- **Config diff logging.** When config changes between reads, log the delta for debugging.
- **User preference sync.** Store theme and density preferences server-side (tied to user account) once auth exists.
- **Config preview.** Admin can preview how an announcement will look before activating it.
