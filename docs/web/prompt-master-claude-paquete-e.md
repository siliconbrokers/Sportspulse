# Prompt maestro — Claude — Paquete E — Style system squad

You are operating as the SportPulse Style System Executor under strict SDD.

Your job is to implement ONLY Package E of the approved frontend roadmap.

You are NOT allowed to widen scope.
You are NOT allowed to redesign business flows.
You are NOT allowed to touch auth, paywall, Stripe, prediction semantics, or backend truth.
You must execute only the style-system slice exactly as defined by the active specs, backlog, and acceptance matrix.

---

## 0. EXECUTION GOAL

Implement Package E / Style system squad for SportPulse web.

Primary scope:
- `SPF-EXP-001`
- `SPF-EXP-002`
- `SPF-EXP-003`
- `SPF-EXP-004`
- `SPF-QA-006`
- `SPF-SPEC-001` only if implementation notes or stale references must be corrected to align code and active docs

This package exists to:
- convert the approved design-system/token architecture into actual frontend implementation,
- make critical surfaces theme-safe,
- introduce the controlled global announcement slot,
- connect the app to `site-experience-config` at the minimal approved level,
- and only then complete Level B full active-surface tokenization so that global style propagation becomes a real, testable capability.

This package does **not** exist to invent a new look from scratch.
This package does **not** exist to do random cosmetic cleanup.
This package does **not** exist to alter user entitlements or operational truth.

---

## 1. AUTHORITATIVE CORPUS (READ FIRST)

Treat these as governing and active, in this order unless a more specific active spec overrides a more general one:

1. `spec.sportpulse.core.ai-sdd-operating-protocol.md`
2. `spec.sportpulse.core.constitution.md`
3. `spec.sportpulse.web.design-system-foundation.md`
4. `spec.sportpulse.web.theme-and-global-announcement-system.md`
5. `spec.sportpulse.web.site-experience-config.md`
6. `spec.sportpulse.web.frontend-modernization.md`
7. `spec.sportpulse.web.frontend-execution-backlog.md`
8. `spec.sportpulse.web.navigation-and-shell-architecture.md`
9. `spec.sportpulse.web.auth-and-freemium-surface.md`
10. `spec.sportpulse.qa.acceptance-test-matrix.md`
11. `spec.sportpulse.core.repo-structure-and-module-boundaries.md`

You must obey these invariants:
- frontend-honest
- snapshot-first
- backend-owned truth
- no provider logic in frontend
- no semantic recomputation in UI
- operational notices are not ads
- style changes must be token/config driven, not component hacks
- global style propagation can only be claimed after Level B + K-08

If any docs conflict:
- surface the conflict explicitly,
- classify it,
- do not silently reconcile it.

---

## 2. THIS PACKAGE EXISTS TO ACHIEVE THESE PHASE TARGETS

You are implementing the visual/system hardening and style-propagation slice.

Per the approved roadmap, this package comes **after** foundations, track record, auth, and monetization.
It must not re-open those areas.

This package must establish two levels clearly:

### Level A
Critical surfaces tokenized and theme-safe.
This includes the surfaces required by the active backlog/specs for controlled evolution without component rewrites.

### Level B
Full active product surface tokenization, sufficient to claim that a global style/theme change propagates across the active product without manual patching, except for documented exceptions.

You must preserve the distinction.
Do not claim Level B if only Level A is complete.

---

## 3. EXACT TICKETS IN SCOPE

Implement ONLY the following tickets.

### SPF-EXP-001 — Critical-surface tokenization (Level A)
Requirements:
- introduce/complete semantic-token consumption across critical surfaces,
- remove raw visual values from critical surfaces unless documented as approved exceptions,
- ensure critical surfaces are theme-safe by construction.

Critical surfaces include at minimum:
- app shell
- top-level app bar/header
- primary navigation
- competition context controls
- dashboard containers/wrappers
- treemap chrome/wrapper surroundings
- detail panel container/chrome
- match cards
- prediction cards/blocks
- track-record surface
- paywall surface
- notices / announcement bar area
- loading / empty / error / degraded-state surfaces directly exposed in active product routes

### SPF-EXP-002 — Global announcement slot in shell
Requirements:
- implement the controlled announcement slot as defined by theme/announcement spec,
- place it in the approved shell layer,
- support announcement rendering contract without mixing operational warnings and commercial/editorial banners,
- do not implement a full CMS.

### SPF-EXP-003 — Minimal site-experience-config consumption
Requirements:
- implement minimal consumption of approved configuration inputs,
- at minimum support:
  - active theme selection,
  - active announcement payload consumption,
  - safe fallback when config is absent,
- do not build a heavy remote-config platform.

### SPF-EXP-004 — Level B full active-surface tokenization
Requirements:
- extend tokenization beyond critical surfaces to full active product surface,
- document any remaining approved exceptions,
- eliminate remaining raw style leakage from active product surfaces,
- reach the readiness threshold required for K-08.

### SPF-QA-006 — Theme propagation and Level B verification
Requirements:
- add automated verification aligned with K-08,
- prove that theme changes propagate across active product surfaces without manual per-surface patching,
- verify operational notices remain semantically distinct,
- verify Pro/free state does not accidentally alter visual semantics beyond allowed rules.

### SPF-SPEC-001 — Spec alignment notes (only if necessary)
Requirements:
- update implementation notes or stale references only where code reveals a mismatch with active v2 specs,
- do not rewrite product strategy docs,
- do not broaden roadmap scope.

---

## 4. EXPLICIT NON-GOALS

Do NOT do any of the following in this slice:

- no auth/session work
- no Stripe work
- no paywall logic changes
- no Pro/free contract changes
- no ads/business-logic implementation changes beyond visual slot classification already approved
- no track record business-truth changes
- no competition IA changes
- no new product surfaces
- no CMS/editorial workflow platform
- no A/B testing system
- no white-label / multi-brand expansion
- no experimental future roadmap implementation beyond what v1 specs explicitly require
- no arbitrary rebranding without token discipline
- no full refactor of business components just for beauty

---

## 5. IMPLEMENTATION RULES

### 5.1 Token rules
- Components must consume semantic tokens, not raw visual values.
- Raw hex, ad-hoc spacing, local shadows, or one-off event colors are forbidden in active surfaces unless documented as temporary exceptions.
- Foundation tokens feed semantic tokens; components consume semantic tokens.
- Themes override tokens, not component implementations.

### 5.2 Theme rules
- Base theme must remain stable.
- Seasonal/event overlays must be additive and controlled, not a second UI system.
- Themes must not alter layout semantics or product logic.
- Theme switching must not require component-level branching in critical/active surfaces except documented, temporary exceptions.

### 5.3 Announcement rules
- Operational notices are not ads.
- Commercial/editorial/seasonal announcements must render through the approved announcement slot.
- Announcement precedence must follow active spec.
- Do not unify operational warnings and campaign banners into one ambiguous component.

### 5.4 Config rules
- Minimal config consumption only.
- Support defaults and safe fallback.
- If config is absent or invalid, product must render with safe default theme and no broken chrome.
- Do not introduce config dependency for business truth.

### 5.5 Level A vs Level B rules
- You must explicitly state which surfaces are complete for Level A.
- You must explicitly state which remaining surfaces prevented Level B, if any.
- Do not declare Level B until K-08 conditions are materially satisfied.

### 5.6 Testing rules
- Tests must be stable and focused.
- Validate token/theme propagation, not pixel-perfection vanity.
- Validate semantic separation of notice types.
- Validate fallback behavior when experience config is absent/unavailable.

---

## 6. EXPECTED OUTPUT

You must return exactly this structure:

# 1. Pre-check
- docs read
- conflicts found or none
- current implementation baseline
- whether codebase is already at partial tokenization or not

# 2. Implementation plan
For each in-scope ticket:
- files/modules touched
- what will be introduced
- what will be migrated
- what will remain out of scope

# 3. Code changes
Provide the actual implementation changes.

# 4. Tokenization map
Provide a concrete map with these columns:
- surface
- Level A required? yes/no
- migrated in this slice? yes/no
- Level B required? yes/no
- documented exception? yes/no
- notes

# 5. Announcement/config integration
Show how the global announcement slot and minimal config consumption were implemented.

# 6. Test additions
Provide tests for SPF-QA-006 and any supporting test utilities.

# 7. Compliance check
Explicitly verify:
- no auth/paywall/business-truth leakage
- token-driven styling used
- operational vs commercial/editorial notices remain distinct
- Level A reached or not
- Level B reached or not
- whether K-08 is satisfied or still blocked

# 8. Residual risks
Only real residual risks after this slice.

---

## 7. REQUIRED SUCCESS CONDITIONS

Your output is good only if all of the following are true:

- critical surfaces no longer rely on raw styling values except documented exceptions,
- shell has a controlled announcement slot,
- app can consume active theme + announcement config with safe fallback,
- full active-surface tokenization is either complete or its remaining gap is explicitly identified,
- tests exist to support K-08,
- no scope creep into auth/paywall/product logic occurred.

Your output is bad if any of the following happens:

- you blur operational notices with ads/promos,
- you implement random styling cleanup instead of token migration,
- you claim global style propagation without Level B evidence,
- you introduce a heavy config platform,
- you leave critical surfaces partially raw without documenting them,
- you alter product flow or route semantics,
- you smuggle in future roadmap work beyond approved v1 scope.

---

## 8. FINAL INSTRUCTION

Be strict.
Be exhaustive only within this package.
Do not help by doing future unrelated work.
Implement Package E as the style-system execution slice, and nothing else.
