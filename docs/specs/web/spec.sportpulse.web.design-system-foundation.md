# SportPulse Design System Foundation

```yaml
artifact_id: spec.sportpulse.web.design-system-foundation
title: Design System Foundation
version: 1.0.0
status: active
created_at: 2026-03-20
governs: packages/web/src/globals.css, packages/web/tailwind.config.js, all component visual tokens
authority: This spec is subordinate to spec.sportpulse.web.ui.md and spec.sportpulse.web.frontend-architecture.md
```

---

## 1. Purpose

This spec defines the complete design token architecture for SportPulse's frontend. It exists to solve three concrete problems:

1. **Hardcoded color proliferation.** 165+ occurrences of raw hex/rgba values across 37 component files, creating maintenance burden and theme inconsistency.
2. **Missing semantic categories.** Status colors (success, error, warning, live), zone colors (standings), typography, spacing, and radius have no token representation despite being used pervasively.
3. **Inconsistent surface hierarchy.** Components use ad hoc combinations of background, border, and elevation without a defined system.

**What this spec IS:**
- The single source of truth for all visual tokens used in `packages/web/`
- The contract that component authors must follow when referencing colors, typography, spacing, radius, and elevation
- The foundation layer that theme specs (Spec 2) build upon

**What this spec is NOT:**
- A component library spec (component behavior is governed by `spec.sportpulse.web.ui.md`)
- A branding guideline or marketing asset
- A specification for backend-owned visual properties (zone colors in standings data come from backend configuration; this spec only defines how they render)

---

## 2. Authority and Limits

**This spec controls:**
- All CSS custom properties prefixed with `--sp-`
- All Tailwind config extensions in `packages/web/tailwind.config.js`
- The `.bento-card`, `.neon-glow`, `.btn-primary`, `.hide-scrollbar` component classes in `globals.css`
- The naming convention for new tokens
- The mapping of tokens to dark/light theme values

**This spec cannot control:**
- Backend data shapes or scoring semantics
- Match-map animation tokens (`match-map.css`) -- those are owned by the treemap/layout layer and only referenced here for documentation
- Third-party library styles
- Dynamic runtime values computed from data (e.g., gradient colors derived from team attention scores)

---

## 3. Visual Identity Principles

1. **Data-first clarity.** Every visual choice must make data easier to read, never harder. Decoration that competes with data is prohibited.
2. **Semantic over aesthetic.** A color is chosen because it means something (success, danger, primary action), not because it looks good in isolation. Every token has a semantic name.
3. **Theme-resilient.** Every surface, text, and state must be legible in both dark and light themes. No token value may be defined for only one theme.
4. **Consistent density.** Spacing and typography follow a defined scale. Ad hoc pixel values are technical debt.
5. **Explainability.** If asked "why is this green?", the answer must be traceable to a token name (e.g., `--sp-status-success`) and its documented semantic meaning.

---

## 4. Token Architecture

The design system uses a **two-layer model**:

### Layer 1: Foundation Tokens (`--sp-f-*`)

Raw color values with no semantic meaning. These are the palette. They exist only in `globals.css` `:root` and `body.light` blocks. Components MUST NOT reference foundation tokens directly.

Example: `--sp-f-cyan-500: #00E0FF`

Foundation tokens are implementation details. They may change without notice as long as the semantic tokens they feed remain visually correct.

### Layer 2: Semantic Tokens (`--sp-*`)

Purpose-named aliases that reference foundation tokens. These are the contract. Components reference ONLY semantic tokens.

Example: `--sp-primary: var(--sp-f-cyan-500)` (dark) / `--sp-primary: var(--sp-f-sky-600)` (light)

**Migration note for v1:** The existing `--sp-*` tokens in `globals.css` are already semantic tokens but lack the foundation layer beneath them. The v1 implementation adds foundation tokens and rewires existing semantic tokens to reference them. Existing component code that references `--sp-*` tokens requires NO changes.

---

## 5. Foundation Tokens (Complete Definition)

### 5.1 Color Palette

All raw color values used across the system. Organized by hue family.

| Token | Dark Value | Light Value | Notes |
|---|---|---|---|
| `--sp-f-gray-950` | `#0B0E14` | `#0B0E14` | Deepest dark bg |
| `--sp-f-gray-900` | `#0F172A` | `#0F172A` | Dark text base (light theme) |
| `--sp-f-gray-850` | `#1A1D24` | `#1A1D24` | Dark surface |
| `--sp-f-gray-600` | `#64748B` | `#64748B` | Light secondary text |
| `--sp-f-gray-500` | `#6b7280` | `#6b7280` | Neutral/draw |
| `--sp-f-gray-400` | `#8A94A8` | `#8A94A8` | Dark secondary text |
| `--sp-f-slate-50` | `#F8FAFC` | `#F8FAFC` | Light bg |
| `--sp-f-white` | `#FFFFFF` | `#FFFFFF` | Pure white |
| `--sp-f-cyan-500` | `#00E0FF` | `#00E0FF` | Neon cyan (dark primary) |
| `--sp-f-sky-600` | `#0284C7` | `#0284C7` | Sky blue (light primary) |
| `--sp-f-green-500` | `#22c55e` | `#22c55e` | Success / win |
| `--sp-f-green-400` | `#4ade80` | `#4ade80` | Success light variant |
| `--sp-f-red-500` | `#ef4444` | `#ef4444` | Error / loss / relegation |
| `--sp-f-red-400` | `#f87171` | `#f87171` | Error light variant |
| `--sp-f-red-300` | `#fca5a5` | `#fca5a5` | Error banner text (dark) |
| `--sp-f-orange-500` | `#f97316` | `#f97316` | Warning / live / Europa |
| `--sp-f-orange-400` | `#fb923c` | `#fb923c` | Warning light variant |
| `--sp-f-amber-500` | `#f59e0b` | `#f59e0b` | Liguilla / playoff |
| `--sp-f-amber-400` | `#FBBF24` | `#FBBF24` | Playoff Libertadores |
| `--sp-f-amber-200` | `#fde68a` | `#fde68a` | Warning banner text (dark) |
| `--sp-f-yellow-500` | `#eab308` | `#eab308` | Playoff descenso |
| `--sp-f-teal-500` | `#14b8a6` | `#14b8a6` | Conference League |
| `--sp-f-cyan-300` | `#22d3ee` | `#22d3ee` | Sudamericana (AR) |
| `--sp-f-blue-500` | `#3b82f6` | `#3b82f6` | Info accent |

### 5.2 Typography Palette

| Token | Value | Notes |
|---|---|---|
| `--sp-f-font-system` | `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` | System font stack |
| `--sp-f-font-mono` | `'SF Mono', 'Fira Code', 'Cascadia Code', monospace` | Monospace for data/code |

### 5.3 Size Scale

| Token | Value |
|---|---|
| `--sp-f-size-2xs` | `0.5625rem` (9px) |
| `--sp-f-size-xs` | `0.625rem` (10px) |
| `--sp-f-size-sm` | `0.75rem` (12px) |
| `--sp-f-size-base` | `0.8125rem` (13px) |
| `--sp-f-size-md` | `0.875rem` (14px) |
| `--sp-f-size-lg` | `1rem` (16px) |
| `--sp-f-size-xl` | `1.125rem` (18px) |
| `--sp-f-size-2xl` | `1.25rem` (20px) |
| `--sp-f-size-3xl` | `1.5rem` (24px) |

### 5.4 Spacing Scale

| Token | Value |
|---|---|
| `--sp-f-space-1` | `2px` |
| `--sp-f-space-2` | `4px` |
| `--sp-f-space-3` | `8px` |
| `--sp-f-space-4` | `12px` |
| `--sp-f-space-5` | `16px` |
| `--sp-f-space-6` | `20px` |
| `--sp-f-space-7` | `24px` |
| `--sp-f-space-8` | `32px` |
| `--sp-f-space-9` | `48px` |

### 5.5 Radius Scale

| Token | Value |
|---|---|
| `--sp-f-radius-sm` | `4px` |
| `--sp-f-radius-md` | `12px` |
| `--sp-f-radius-lg` | `24px` |
| `--sp-f-radius-full` | `9999px` |

---

## 6. Semantic Token Mapping

Semantic tokens reference foundation tokens. The mapping changes per theme.

### 6.1 Background and Surface Tokens

| Semantic Token | Dark Value | Light Value | Semantic Meaning |
|---|---|---|---|
| `--sp-bg` | `var(--sp-f-gray-950)` | `var(--sp-f-slate-50)` | Page-level background |
| `--sp-surface` | `var(--sp-f-gray-850)` | `var(--sp-f-white)` | Primary card/panel surface |
| `--sp-header` | `rgba(11,14,20,0.95)` | `rgba(248,250,252,0.95)` | Sticky header backdrop |
| `--sp-surface-alpha` | `rgba(26,29,36,0.8)` | `rgba(255,255,255,0.9)` | Semi-transparent overlay surface |
| `--sp-surface-card` | `rgba(255,255,255,0.04)` | `rgba(0,0,0,0.03)` | Card-within-card subtle bg |
| `--sp-surface-raised` | `rgba(255,255,255,0.07)` | `rgba(0,0,0,0.05)` | Elevated element bg (dropdown, tooltip) |
| `--sp-surface-overlay` | `rgba(0,0,0,0.6)` | `rgba(0,0,0,0.4)` | Modal/drawer backdrop dim **[NEW]** |

### 6.2 Brand / Primary Tokens

| Semantic Token | Dark Value | Light Value | Semantic Meaning |
|---|---|---|---|
| `--sp-primary` | `var(--sp-f-cyan-500)` | `var(--sp-f-sky-600)` | Primary brand accent |
| `--sp-primary-04` | `rgba(0,224,255,0.04)` | `rgba(2,132,199,0.04)` | Lightest primary tint |
| `--sp-primary-10` | `rgba(0,224,255,0.10)` | `rgba(2,132,199,0.10)` | Subtle primary bg |
| `--sp-primary-12` | `rgba(0,224,255,0.12)` | `rgba(2,132,199,0.12)` | Primary selection bg |
| `--sp-primary-22` | `rgba(0,224,255,0.22)` | `rgba(2,132,199,0.22)` | Primary hover bg |
| `--sp-primary-40` | `rgba(0,224,255,0.40)` | `rgba(2,132,199,0.40)` | Strong primary accent |
| `--sp-primary-glow` | `0 0 12px rgba(0,224,255,0.4)` | `0 0 12px rgba(2,132,199,0.3)` | Neon glow box-shadow |
| `--sp-brand-rgb` | `0, 224, 255` | `2, 132, 199` | Raw RGB for dynamic rgba() |

### 6.3 Text Tokens

| Semantic Token | Dark Value | Light Value | Semantic Meaning |
|---|---|---|---|
| `--sp-text` | `var(--sp-f-white)` | `var(--sp-f-gray-900)` | Primary text |
| `--sp-text-88` | `rgba(255,255,255,0.88)` | `rgba(15,23,42,0.88)` | Near-primary text |
| `--sp-text-85` | `rgba(255,255,255,0.85)` | `rgba(15,23,42,0.85)` | Prominent secondary text |
| `--sp-text-75` | `rgba(255,255,255,0.75)` | `rgba(15,23,42,0.75)` | Standard secondary text |
| `--sp-text-70` | `rgba(255,255,255,0.70)` | `rgba(15,23,42,0.70)` | Moderate secondary text |
| `--sp-text-55` | `rgba(255,255,255,0.55)` | `rgba(15,23,42,0.55)` | Tertiary text |
| `--sp-text-50` | `rgba(255,255,255,0.50)` | `rgba(15,23,42,0.50)` | Dim text |
| `--sp-text-40` | `rgba(255,255,255,0.40)` | `rgba(15,23,42,0.40)` | Subdued text |
| `--sp-text-35` | `rgba(255,255,255,0.35)` | `rgba(15,23,42,0.35)` | Subtle text |
| `--sp-text-30` | `rgba(255,255,255,0.30)` | `rgba(15,23,42,0.30)` | Near-invisible text |
| `--sp-text-20` | `rgba(255,255,255,0.20)` | `rgba(15,23,42,0.20)` | Decorative/placeholder |
| `--sp-secondary` | `var(--sp-f-gray-400)` | `var(--sp-f-gray-600)` | Fixed secondary text color |

### 6.4 Status Tokens **[NEW]**

| Semantic Token | Dark Value | Light Value | Semantic Meaning |
|---|---|---|---|
| `--sp-status-success` | `var(--sp-f-green-500)` | `var(--sp-f-green-500)` | Win, positive diff, completed |
| `--sp-status-success-soft` | `rgba(34,197,94,0.15)` | `rgba(34,197,94,0.12)` | Success background tint |
| `--sp-status-error` | `var(--sp-f-red-500)` | `var(--sp-f-red-500)` | Loss, relegation, error state |
| `--sp-status-error-soft` | `rgba(239,68,68,0.15)` | `rgba(239,68,68,0.12)` | Error background tint |
| `--sp-status-warning` | `var(--sp-f-orange-500)` | `var(--sp-f-orange-500)` | Warning, caution |
| `--sp-status-warning-soft` | `rgba(249,115,22,0.15)` | `rgba(249,115,22,0.12)` | Warning background tint |
| `--sp-status-live` | `var(--sp-f-orange-500)` | `var(--sp-f-orange-500)` | Live match indicator |
| `--sp-status-live-soft` | `rgba(249,115,22,0.12)` | `rgba(249,115,22,0.10)` | Live match background |
| `--sp-status-zombie` | `var(--sp-f-amber-500)` | `var(--sp-f-amber-500)` | Zombie/stale match |
| `--sp-status-neutral` | `var(--sp-f-gray-500)` | `var(--sp-f-gray-500)` | Draw, neutral state |
| `--sp-status-info` | `var(--sp-f-blue-500)` | `var(--sp-f-blue-500)` | Informational accent |
| `--sp-status-info-soft` | `rgba(59,130,246,0.15)` | `rgba(59,130,246,0.12)` | Info background tint |

### 6.5 Zone Tokens **[NEW]**

These tokens reify the currently hardcoded standings zone colors.

| Semantic Token | Value (both themes) | Semantic Meaning |
|---|---|---|
| `--sp-zone-champions` | `var(--sp-primary)` | Champions League / Copa Libertadores |
| `--sp-zone-europa` | `var(--sp-f-orange-500)` | Europa League / Copa Sudamericana |
| `--sp-zone-conference` | `var(--sp-f-teal-500)` | Conference League |
| `--sp-zone-playoff` | `var(--sp-f-yellow-500)` | Playoff (descenso or qualification) |
| `--sp-zone-playoff-alt` | `var(--sp-f-amber-400)` | Alternative playoff (e.g., Playoff Libertadores) |
| `--sp-zone-liguilla` | `var(--sp-f-amber-500)` | Liguilla (Liga MX) |
| `--sp-zone-relegation` | `var(--sp-f-red-500)` | Relegation zone |
| `--sp-zone-sudamericana-alt` | `var(--sp-f-cyan-300)` | Sudamericana (AR alternate color) |

**Note:** Zone tokens are the same in both themes. Zone colors must be legible against both `--sp-surface` (dark) and `--sp-surface` (light). The values listed pass WCAG AA for both.

### 6.6 Form Result Tokens **[NEW]**

| Semantic Token | Value (both themes) | Semantic Meaning |
|---|---|---|
| `--sp-form-win` | `var(--sp-f-green-500)` | Win result in form strip |
| `--sp-form-draw` | `var(--sp-f-gray-500)` | Draw result in form strip |
| `--sp-form-loss` | `var(--sp-f-red-500)` | Loss result in form strip |

### 6.7 Border Tokens

| Semantic Token | Dark Value | Light Value | Semantic Meaning |
|---|---|---|---|
| `--sp-border` | `rgba(255,255,255,0.06)` | `rgba(0,0,0,0.08)` | Default border |
| `--sp-border-10` | `rgba(255,255,255,0.10)` | `rgba(0,0,0,0.12)` | Strong border |
| `--sp-border-8` | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.10)` | Medium border |
| `--sp-border-6` | `rgba(255,255,255,0.06)` | `rgba(0,0,0,0.07)` | Subtle border |
| `--sp-border-5` | `rgba(255,255,255,0.05)` | `rgba(0,0,0,0.06)` | Light border |
| `--sp-border-4` | `rgba(255,255,255,0.04)` | `rgba(0,0,0,0.04)` | Faintest border |

### 6.8 Table Tokens

| Semantic Token | Dark Value | Light Value | Semantic Meaning |
|---|---|---|---|
| `--sp-row-even` | `rgba(255,255,255,0.015)` | `rgba(0,0,0,0.02)` | Alternating row stripe |
| `--sp-row-hover` | `rgba(0,224,255,0.04)` | `rgba(2,132,199,0.04)` | Row hover highlight |

### 6.9 Typography Tokens **[NEW]**

| Semantic Token | Value | Semantic Meaning |
|---|---|---|
| `--sp-font-family-base` | `var(--sp-f-font-system)` | All UI text |
| `--sp-font-family-mono` | `var(--sp-f-font-mono)` | Data labels, code, timestamps |
| `--sp-text-size-2xs` | `var(--sp-f-size-2xs)` | Tiny labels (9px) |
| `--sp-text-size-xs` | `var(--sp-f-size-xs)` | Small captions (10px) |
| `--sp-text-size-sm` | `var(--sp-f-size-sm)` | Secondary text (12px) |
| `--sp-text-size-base` | `var(--sp-f-size-base)` | Default body text (13px) |
| `--sp-text-size-md` | `var(--sp-f-size-md)` | Emphasized body text (14px) |
| `--sp-text-size-lg` | `var(--sp-f-size-lg)` | Section headers (16px) |
| `--sp-text-size-xl` | `var(--sp-f-size-xl)` | Page headers (18px) |
| `--sp-text-size-2xl` | `var(--sp-f-size-2xl)` | Feature headers (20px) |
| `--sp-text-size-3xl` | `var(--sp-f-size-3xl)` | Hero text (24px) |
| `--sp-font-weight-regular` | `400` | Body text |
| `--sp-font-weight-medium` | `500` | Subtle emphasis |
| `--sp-font-weight-semibold` | `600` | Strong emphasis, labels |
| `--sp-font-weight-bold` | `700` | Headings, CTAs |

### 6.10 Spacing Tokens **[NEW]**

| Semantic Token | Value | Typical Use |
|---|---|---|
| `--sp-space-1` | `var(--sp-f-space-1)` (2px) | Inline icon gap |
| `--sp-space-2` | `var(--sp-f-space-2)` (4px) | Tight vertical gap |
| `--sp-space-3` | `var(--sp-f-space-3)` (8px) | Default inline padding |
| `--sp-space-4` | `var(--sp-f-space-4)` (12px) | Card inner padding (compact) |
| `--sp-space-5` | `var(--sp-f-space-5)` (16px) | Standard card padding |
| `--sp-space-6` | `var(--sp-f-space-6)` (20px) | Section margin |
| `--sp-space-7` | `var(--sp-f-space-7)` (24px) | Bento card padding |
| `--sp-space-8` | `var(--sp-f-space-8)` (32px) | Section gap |
| `--sp-space-9` | `var(--sp-f-space-9)` (48px) | Major section separation |

### 6.11 Radius Tokens **[NEW]**

| Semantic Token | Value | Typical Use |
|---|---|---|
| `--sp-radius-sm` | `var(--sp-f-radius-sm)` (4px) | Small badges, form results, inline tags |
| `--sp-radius-md` | `var(--sp-f-radius-md)` (12px) | Buttons, inner cards, mini-cards (= `bento-inner`) |
| `--sp-radius-lg` | `var(--sp-f-radius-lg)` (24px) | Bento cards, main panels (= `bento`) |
| `--sp-radius-full` | `var(--sp-f-radius-full)` (9999px) | Pills, avatars, round indicators |

---

## 7. Dark/Light Theme Mapping (Complete Reference)

This table consolidates all tokens that differ between themes. Tokens not listed here are identical in both themes.

| Token | Dark | Light |
|---|---|---|
| `--sp-bg` | `#0B0E14` | `#F8FAFC` |
| `--sp-surface` | `#1A1D24` | `#FFFFFF` |
| `--sp-header` | `rgba(11,14,20,0.95)` | `rgba(248,250,252,0.95)` |
| `--sp-surface-alpha` | `rgba(26,29,36,0.8)` | `rgba(255,255,255,0.9)` |
| `--sp-surface-card` | `rgba(255,255,255,0.04)` | `rgba(0,0,0,0.03)` |
| `--sp-surface-raised` | `rgba(255,255,255,0.07)` | `rgba(0,0,0,0.05)` |
| `--sp-surface-overlay` | `rgba(0,0,0,0.6)` | `rgba(0,0,0,0.4)` |
| `--sp-primary` | `#00E0FF` | `#0284C7` |
| `--sp-primary-04` through `--sp-primary-40` | cyan-based opacity | sky-based opacity |
| `--sp-primary-glow` | `0 0 12px rgba(0,224,255,0.4)` | `0 0 12px rgba(2,132,199,0.3)` |
| `--sp-brand-rgb` | `0, 224, 255` | `2, 132, 199` |
| `--sp-text` | `#FFFFFF` | `#0F172A` |
| `--sp-text-88` through `--sp-text-20` | white-based opacity | dark-based opacity |
| `--sp-secondary` | `#8A94A8` | `#64748B` |
| `--sp-border` through `--sp-border-4` | white-based opacity | black-based opacity |
| `--sp-row-even` | `rgba(255,255,255,0.015)` | `rgba(0,0,0,0.02)` |
| `--sp-row-hover` | `rgba(0,224,255,0.04)` | `rgba(2,132,199,0.04)` |
| `--sp-status-*-soft` variants | higher opacity for dark bg | lower opacity for light bg |

All status tokens (`--sp-status-success`, `--sp-status-error`, etc.), zone tokens (`--sp-zone-*`), form tokens (`--sp-form-*`), typography tokens, spacing tokens, and radius tokens are **identical in both themes**.

---

## 8. Surface Hierarchy

Surfaces are layered from deepest to foreground. Each level has a defined role.

| Level | Token | Role | Example Usage |
|---|---|---|---|
| 0 - Page | `--sp-bg` | Full-page background, visible between sections | `body`, root container |
| 1 - Surface | `--sp-surface` | Primary content area, cards, panels | Bento cards, DetailPanel, StandingsTable |
| 2 - Card | `--sp-surface-card` | Nested element within a surface | Form strip bg, stats row within a panel |
| 3 - Raised | `--sp-surface-raised` | Interactive/elevated element above a surface | Dropdowns, tooltips, hover states |
| 4 - Alpha | `--sp-surface-alpha` | Semi-transparent overlay on any layer | Sticky header backdrop, floating panels |
| 5 - Overlay | `--sp-surface-overlay` | Modal/drawer dimming layer over everything | DetailPanel mobile backdrop |

**Rule:** A component's surface level is determined by its z-position in the layout, not its visual importance. A card inside a card uses `--sp-surface-card`. A dropdown over a card uses `--sp-surface-raised`.

---

## 9. Typography Scale

### Font Families

| Token | Stack | Use |
|---|---|---|
| `--sp-font-family-base` | System sans-serif | All UI text. Applied to `body` in globals.css. |
| `--sp-font-family-mono` | System monospace | Timestamps, scores, data labels |

**Rule:** The font family MUST be declared via `--sp-font-family-base` on `body` in globals.css. The 7 inline `fontFamily` declarations across components must be removed. No component may declare its own font stack.

### Font Size Scale

| Token | Size | Line Height | Use |
|---|---|---|---|
| `--sp-text-size-2xs` | 9px (0.5625rem) | 1.33 (12px) | Micro labels, annotations |
| `--sp-text-size-xs` | 10px (0.625rem) | 1.4 (14px) | Small captions, timestamps |
| `--sp-text-size-sm` | 12px (0.75rem) | 1.33 (16px) | Secondary body, table cells |
| `--sp-text-size-base` | 13px (0.8125rem) | 1.38 (18px) | Default body text |
| `--sp-text-size-md` | 14px (0.875rem) | 1.43 (20px) | Emphasized body, active labels |
| `--sp-text-size-lg` | 16px (1rem) | 1.5 (24px) | Section headers, nav items |
| `--sp-text-size-xl` | 18px (1.125rem) | 1.33 (24px) | Page-level headers |
| `--sp-text-size-2xl` | 20px (1.25rem) | 1.4 (28px) | Feature-level headers |
| `--sp-text-size-3xl` | 24px (1.5rem) | 1.33 (32px) | Hero text, large titles |

### Font Weight Scale

| Token | Weight | Use |
|---|---|---|
| `--sp-font-weight-regular` | 400 | Body text, descriptions |
| `--sp-font-weight-medium` | 500 | Subtle emphasis, labels |
| `--sp-font-weight-semibold` | 600 | Strong labels, active tabs, scores |
| `--sp-font-weight-bold` | 700 | Headings, CTA buttons, team names |

**Usage rules:**
- Body text: `base` size, `regular` weight
- Team names in cards: `md` or `sm` size, `semibold` weight
- Section headers: `lg` size, `bold` weight
- Scores: `lg` or `xl` size, `bold` weight, `--sp-font-family-mono`
- Table headers: `sm` size, `semibold` weight, `--sp-text-55` color

---

## 10. Spacing Scale

| Token | Pixel | Rem | Typical Use |
|---|---|---|---|
| `--sp-space-1` | 2px | 0.125rem | Inline icon gap, form result gap |
| `--sp-space-2` | 4px | 0.25rem | Tight padding, badge padding |
| `--sp-space-3` | 8px | 0.5rem | Standard inline padding, icon-text gap |
| `--sp-space-4` | 12px | 0.75rem | Card inner padding (compact), list item gap |
| `--sp-space-5` | 16px | 1rem | Standard card padding, section header margin |
| `--sp-space-6` | 20px | 1.25rem | Section margin-bottom |
| `--sp-space-7` | 24px | 1.5rem | Bento card padding (matches `p-6`) |
| `--sp-space-8` | 32px | 2rem | Major section gap |
| `--sp-space-9` | 48px | 3rem | Page section separation |

**Usage rules:**
- Prefer Tailwind spacing classes (`gap-3`, `p-4`, `mb-6`) for layout. They map to the same 4px base grid.
- Use `--sp-space-*` tokens in inline styles only when Tailwind classes are not applicable (dynamic computation).
- Never use arbitrary pixel values in inline styles. Map to the nearest spacing token.

---

## 11. Radius and Elevation

### Radius

| Token | Value | Tailwind Class | Use |
|---|---|---|---|
| `--sp-radius-sm` | 4px | `rounded` | Form badges, small tags, inline status chips, warning banners |
| `--sp-radius-md` | 12px | `rounded-bento-inner` | Buttons, inner cards, prediction cards, mini-tiles |
| `--sp-radius-lg` | 24px | `rounded-bento` | Bento cards, main panels, modal containers |
| `--sp-radius-full` | 9999px | `rounded-full` | Avatar circles, pill badges, live indicator dots |

**Rule:** Components using inline `borderRadius` with values like `4`, `6`, `8`, `10`, `12`, `16` must map to the nearest token: 4px -> `sm`, 6-12px -> `md`, 16-24px -> `lg`.

### Elevation (Shadows)

| Token / Class | Value | Use |
|---|---|---|
| `--sp-primary-glow` / `.neon-glow` | `0 0 12px rgba(brand,0.4)` | Primary accent glow on hover/selected bento cards |
| (none) | No additional shadow tokens in v1 | Flat design; elevation conveyed via surface bg difference |

**v1 constraint:** No box-shadow tokens beyond `--sp-primary-glow`. Elevation is expressed through background transparency differences (`surface` -> `card` -> `raised`), not drop shadows. This keeps the dark theme clean.

---

## 12. State Tokens

Interactive states are expressed as overlays or token swaps on existing surfaces.

| State | Visual Treatment | Token/Approach |
|---|---|---|
| **Hover** | Border color shifts to primary accent | `border-color: var(--sp-primary-40)` (bento-card already does this) |
| **Hover (row)** | Background tint | `background: var(--sp-row-hover)` |
| **Active / Pressed** | Slightly stronger primary bg | `background: var(--sp-primary-22)` |
| **Focus** | Primary border + glow | `outline: 2px solid var(--sp-primary); box-shadow: var(--sp-primary-glow)` |
| **Selected** | Primary bg tint + primary border | `background: var(--sp-primary-12); border-color: var(--sp-primary)` |
| **Disabled** | Reduced opacity | `opacity: 0.4; pointer-events: none` |

**Rule:** States must never change the semantic meaning of a color. A success state with hover must still look like success, not shift to primary.

---

## 13. Usage Rules

### 13.1 Prohibition of Raw Values

**RULE:** No component file (`.tsx`, `.ts`) in `packages/web/src/` may contain raw hex color values (`#RRGGBB`), raw `rgba()` calls, or raw `rgb()` calls for colors that have a semantic token equivalent.

**Enforcement:** This rule applies to `style={{}}` objects, CSS-in-JS, and any inline styles.

### 13.2 Required Token Reference

All components MUST reference visual values through one of:
1. CSS custom property: `var(--sp-*)` in inline styles
2. Tailwind utility class backed by a token (e.g., `bg-brand-primary`, `text-brand-text-secondary`)
3. Component class from globals.css (`.bento-card`, `.btn-primary`, `.neon-glow`)

### 13.3 Exceptions

The following cases are exempt from the raw-value prohibition:

1. **Dynamic runtime gradients** where color values are computed from data (e.g., treemap tile backgrounds with data-driven heat colors set as CSS custom properties from match-map.css).
2. **SVG attributes** that require direct color strings and cannot reference CSS custom properties (rare; prefer `currentColor` or CSS variables where supported).
3. **match-map.css animation tokens** (`--mm-*`, `--heat-*`) which are set as inline styles on treemap tiles from JavaScript and consumed by CSS animations. These are owned by the layout/treemap layer, not the design system.

### 13.4 Migration Path

Existing 165+ hardcoded violations will be migrated incrementally:
- Priority 1: Status colors (37 files) -- replace with `--sp-status-*` tokens
- Priority 2: Zone colors in StandingsTable -- replace with `--sp-zone-*` tokens
- Priority 3: Form colors (3 files) -- replace with `--sp-form-*` tokens
- Priority 4: Typography inline styles (9 files) -- replace with `--sp-font-family-base` on body
- Priority 5: Radius and spacing inline values -- replace with tokens

Each migration is a standalone PR. No big-bang rewrite.

---

## 14. Naming Conventions

### Token Naming Rules

1. **Prefix:** All tokens start with `--sp-` (semantic) or `--sp-f-` (foundation).
2. **Category:** After prefix, a category noun: `bg`, `surface`, `text`, `border`, `status`, `zone`, `form`, `font`, `space`, `radius`, `primary`, `row`.
3. **Modifier:** After category, a modifier describing the variant: `success`, `error`, `sm`, `lg`, `04`, `raised`.
4. **Compound modifiers** use hyphen: `--sp-status-success-soft`, `--sp-text-size-2xl`.
5. **Opacity variants** use the percentage as suffix: `--sp-text-55`, `--sp-primary-22`.
6. **No abbreviations** beyond established ones (`bg`, `sm`, `md`, `lg`, `xl`, `2xl`, `3xl`).

### Adding New Tokens

When a new visual value is needed:
1. Check if an existing token covers the use case.
2. If not, define a foundation token for the raw value.
3. Define a semantic token that aliases the foundation token.
4. Add both themes' values.
5. Document the semantic meaning.
6. Update this spec (version bump).

---

## 15. Application Examples

### Shell / App Layout
- Background: `--sp-bg`
- No border, no radius

### Navbar / Header Chrome
- Background: `--sp-header` (semi-transparent with backdrop-blur)
- Border bottom: `--sp-border`
- Text: `--sp-text`, `--sp-text-70`
- Active tab: `--sp-primary`, border-bottom with primary

### Match Cards (LiveCarousel, MatchCardList)
- Surface: `--sp-surface`
- Border: `--sp-border-8`, hover `--sp-primary-40`
- Radius: `--sp-radius-lg` (bento)
- Team name: `--sp-text`, `--sp-text-size-sm`, `--sp-font-weight-semibold`
- Score: `--sp-text`, `--sp-text-size-lg`, `--sp-font-weight-bold`, `--sp-font-family-mono`
- LIVE badge: `--sp-status-live`, `--sp-radius-full`
- Form strip: `--sp-form-win`, `--sp-form-draw`, `--sp-form-loss`, `--sp-radius-sm`

### Prediction Cards (PronosticoCard)
- Surface: `--sp-surface-card`
- Border: `--sp-border-6`
- Radius: `--sp-radius-md`
- Probability text: `--sp-text-size-md`, `--sp-font-weight-semibold`
- Win/Draw/Loss labels: `--sp-status-success`, `--sp-status-neutral`, `--sp-status-error`

### Track Record Surface
- Surface: `--sp-surface-card`
- Text: `--sp-text-75`
- Stats: `--sp-status-success` (wins), `--sp-status-error` (losses), `--sp-status-neutral` (draws)

### Paywall / Pro Gate Surface
- Surface: `--sp-surface-raised`
- Border: `--sp-primary-22`
- CTA button: `.btn-primary` class
- Radius: `--sp-radius-lg`

### Notice / Announcement Slot
- Surface: `--sp-primary-10` (editorial), `--sp-status-warning-soft` (commercial), `--sp-status-info-soft` (seasonal)
- Text: `--sp-text-88`
- Dismiss icon: `--sp-text-55`
- Full-width, no radius (flush above navbar)

### Warning Banners (Operational)
- Surface: `--sp-status-error-soft` (ERROR severity), `--sp-status-warning-soft` (WARN severity)
- Text: `--sp-status-error` or `--sp-status-warning`
- Radius: `--sp-radius-sm`
- These are data-quality indicators from the backend pipeline, NOT announcements.

---

## 16. What Is in v1

1. All foundation tokens defined in `:root` and `body.light` in globals.css.
2. All semantic tokens defined as aliases of foundation tokens.
3. Typography tokens applied to `body` (font-family, base size).
4. Tailwind config updated with new color entries mapping to CSS variables.
5. Component class updates in globals.css (`.bento-card`, `.btn-primary`).
6. Documentation of all tokens (this spec).

---

## 17. What Is NOT in v1

- Automated lint rule enforcement (e.g., stylelint plugin for raw hex detection). Manual review only.
- Design token documentation site (Storybook, Figma export). This spec is the documentation.
- Dynamic token override via JavaScript (all tokens are CSS-only).
- Token versioning API (tokens are versioned via this spec's `version` field).
- Component-level Tailwind plugin (tokens are consumed via `var()` and config `colors`).

---

## 18. Deferred Future Considerations

- **Token import from Figma.** If a design tool is adopted, tokens could be exported from Figma to CSS variables via a build step. Not needed until design team exists.
- **CSS `@property` registration.** Registering tokens via `@property` enables animation and type checking. Not needed until animation of token values is required.
- **Dark mode auto-detection.** `prefers-color-scheme` media query integration. Currently theme is manual toggle only (localStorage). Could be added as "system" option.
- **High contrast mode.** WCAG AAA compliance mode with increased contrast ratios. Requires audit of all token pairs.
- **Per-competition accent package.** Each competition with its own primary color override. Belongs to the theme system spec, not the foundation spec.

---

## Appendix A: Tailwind Config Token Integration

The following additions to `packages/web/tailwind.config.js` are required to expose semantic tokens as Tailwind utilities:

```js
// Additions to theme.extend.colors
status: {
  success: 'var(--sp-status-success)',
  error: 'var(--sp-status-error)',
  warning: 'var(--sp-status-warning)',
  live: 'var(--sp-status-live)',
  zombie: 'var(--sp-status-zombie)',
  neutral: 'var(--sp-status-neutral)',
  info: 'var(--sp-status-info)',
},
zone: {
  champions: 'var(--sp-zone-champions)',
  europa: 'var(--sp-zone-europa)',
  conference: 'var(--sp-zone-conference)',
  playoff: 'var(--sp-zone-playoff)',
  relegation: 'var(--sp-zone-relegation)',
  liguilla: 'var(--sp-zone-liguilla)',
},
form: {
  win: 'var(--sp-form-win)',
  draw: 'var(--sp-form-draw)',
  loss: 'var(--sp-form-loss)',
},
```

This enables classes like `text-status-success`, `bg-zone-relegation`, `border-form-win`.
