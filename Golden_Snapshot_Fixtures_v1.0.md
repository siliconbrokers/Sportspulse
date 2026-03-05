# SportPulse — Golden Snapshot Fixtures

Version: 1.0  
Status: Authoritative fixture baseline for MVP  
Scope: Canonical golden fixture strategy, fixture set definitions, expected artifacts, comparison rules, and update discipline for SportPulse MVP  
Audience: Backend, Frontend, QA, Ops, AI-assisted development workflows

---

## 1. Purpose

This document defines the **golden fixture system** for SportPulse MVP.

Its purpose is to establish a small, explicit set of authoritative test fixtures that freeze expected product truth for:

- canonical normalization outputs
- signal values
- score outputs
- warning behavior
- snapshot ordering
- layout geometry
- API-level artifact expectations

Golden fixtures exist to prevent:

- silent semantic drift
- accidental score changes
- geometry changes without version bumps
- undocumented DTO shape changes
- AI-generated regressions disguised as “reasonable improvements”

This document is not a test matrix.  
It defines the canonical fixture pack that the test matrix depends on.

---

## 2. Authority

This document is authoritative for:

- which fixtures are considered official MVP golden fixtures
- what each fixture validates
- how expected outputs are stored
- how comparisons must be performed
- when fixture changes are allowed
- when fixture changes require version bumps

If an implementation changes behavior but the fixture update discipline is not respected, the implementation is non-compliant.

---

## 3. Golden fixture philosophy

Golden fixtures must be:

- **small**
- **deterministic**
- **purpose-built**
- **readable**
- **stable**
- **canonical-first**
- **version-sensitive**

Golden fixtures must **not** be:
- giant unreviewable dumps
- raw provider payloads masquerading as truth
- UI screenshots used as primary semantic truth
- casually editable “expected output snapshots”
- coupled to incidental runtime noise

---

## 4. Fixture source of truth level

Golden fixtures must freeze truth at the **canonical domain level and above**.

This means the primary reference inputs should be:

- canonical competition/season/team/match data
- build context (`buildNowUtc`, timezone)
- scoring policy identity
- layout metadata/config

### Constraint
Raw provider payloads may be retained for ingestion tests, but golden snapshot fixtures for MVP semantic validation must not depend on provider raw shape as the primary truth layer.

---

## 5. Fixture comparison layers

Each golden fixture supports three comparison layers.

## 5.1 Semantic comparison

Compares:
- canonical identities
- signal values
- signal missingness
- score outputs
- ordering
- warnings
- version fields

This is the most important comparison layer.

---

## 5.2 Contract comparison

Compares:
- DTO shape
- required fields
- field presence
- legal value types
- root metadata

This protects contract stability.

---

## 5.3 Geometry comparison

Compares:
- `rect` values
- container metadata
- no-overlap/bounds conditions
- layout diagnostics where applicable

This protects layout determinism.

---

## 6. Official MVP golden fixture set

The MVP golden fixture set contains **six** official fixtures.

No additional golden fixtures should be added casually.  
If a new fixture is needed, it must represent a genuinely new validation class.

---

## 6.1 F1 — Baseline Normal Snapshot

### Fixture ID
`F1_baseline_normal`

### Purpose
Validates the normal happy-path snapshot under complete, healthy conditions.

### Validates
- canonical entity mapping
- standard signal computation
- scoring policy execution
- ordering
- geometry generation
- DTO completeness
- absence of unnecessary warnings

### Characteristics
- one competition
- one season
- enough finished matches for full form window
- next match available for relevant teams
- no provider gaps
- no fallback behavior

### Expected warnings
- none, or empty warning list

### Why this fixture matters
This is the baseline truth anchor.  
If this fixture changes unexpectedly, the product semantics likely changed.

---

## 6.2 F2 — Insufficient History

### Fixture ID
`F2_insufficient_history`

### Purpose
Validates behavior when one or more teams do not have the full target history window of finished matches.

### Validates
- reduced-form calculation
- `matchesUsed < targetWindow`
- `INSUFFICIENT_HISTORY`
- no fake padding of missing match history
- stable explainability under reduced data

### Characteristics
- at least one team has 1–4 finished matches
- at least one comparison team has full 5-match history
- upcoming match still available

### Expected warnings
- `INSUFFICIENT_HISTORY`
- possibly entity-scoped warnings

### Why this fixture matters
This proves the product handles early-season / sparse-history conditions honestly.

---

## 6.3 F3 — No Upcoming Match

### Fixture ID
`F3_no_upcoming_match`

### Purpose
Validates behavior when a team has no valid upcoming match available.

### Validates
- missing next-match signal behavior
- `NO_UPCOMING_MATCH`
- `MISSING_SIGNAL` where applicable
- scoring behavior under missing proximity signal
- detail panel next-match absence handling

### Characteristics
- at least one team has no valid upcoming scheduled match
- other teams still behave normally

### Expected warnings
- `NO_UPCOMING_MATCH`
- `MISSING_SIGNAL` if active policy/explainability requires surfacing it

### Why this fixture matters
This proves the product does not fabricate agenda truth.

---

## 6.4 F4 — Partial Snapshot

### Fixture ID
`F4_partial_snapshot`

### Purpose
Validates snapshot generation when source data is incomplete but still sufficient to build a usable artifact.

### Validates
- partial-data warning behavior
- signal missingness propagation
- contract integrity under incomplete data
- graceful degradation without semantic corruption

### Characteristics
- some canonical fields or source-derived fields missing
- snapshot still buildable
- at least one team contains explicit missing signal or quality state

### Expected warnings
- `PARTIAL_DATA`
- possible `MISSING_SIGNAL`
- no fatal build failure

### Why this fixture matters
This proves the MVP can survive realistic data imperfections without lying.

---

## 6.5 F5 — Stale Fallback Snapshot

### Fixture ID
`F5_stale_fallback`

### Purpose
Validates behavior when a fresh build cannot succeed and the system serves the last valid snapshot instead.

### Validates
- stale snapshot serving
- provider/build failure surfacing
- warning stacking (`PROVIDER_ERROR` + `STALE_DATA`)
- payload validity under fallback mode

### Characteristics
- cached valid prior snapshot exists
- fresh rebuild intentionally fails in test setup
- stale artifact returned

### Expected warnings
- `PROVIDER_ERROR`
- `STALE_DATA`

### Why this fixture matters
This proves the product degrades operationally without pretending everything is fine.

---

## 6.6 F6 — Layout Degenerate Case

### Fixture ID
`F6_layout_degenerate`

### Purpose
Validates layout fallback and geometry determinism under pathological weight conditions.

### Validates
- all-zero or equivalent degenerate `layoutWeight` input
- equal synthetic layout fallback
- `LAYOUT_DEGRADED`
- valid rect generation under fallback
- deterministic rounding/residual behavior

### Characteristics
- all teams have zero layoutWeight, or equivalent degenerate condition
- snapshot remains valid
- geometry still produced

### Expected warnings
- `LAYOUT_DEGRADED`

### Why this fixture matters
This proves layout failure modes are handled honestly and deterministically.

---

## 7. Fixture directory structure

Each fixture must live in its own directory:

```text
tools/fixtures/golden/
  F1_baseline_normal/
  F2_insufficient_history/
  F3_no_upcoming_match/
  F4_partial_snapshot/
  F5_stale_fallback/
  F6_layout_degenerate/
```

Each fixture directory must contain the following files.

---

## 8. Required files per fixture

## 8.1 `README.md`

Human-readable explanation of:
- fixture purpose
- what it validates
- what not to infer from it
- expected warning/error story
- any version sensitivity

---

## 8.2 `input.canonical.json`

Canonical source input for the fixture.

Must contain enough data to drive:
- competition
- season
- teams
- matches
- lifecycle states
- timing

### Invariant
This file is the semantic input truth for golden fixture processing.

---

## 8.3 `context.json`

Contains:
- `buildNowUtc`
- `timezone`
- `policyKey`
- `policyVersion`
- `layout.algorithmKey`
- `layout.algorithmVersion`
- container config if relevant

### Invariant
No golden fixture is valid without explicit context.

---

## 8.4 `expected.signals.json`

Contains expected signal-level outputs for relevant entities.

Should include:
- key
- entityId
- normalized value
- missingness
- selected params as needed

### Invariant
Signals must be explicit enough to diagnose scoring drift.

---

## 8.5 `expected.snapshot.json`

Contains the expected dashboard snapshot artifact or a canonical reduced equivalent.

Must include:
- header identity
- layout metadata
- warnings
- teams ordering
- score fields
- rects
- explainability payloads required for the fixture

### Invariant
This file is the primary end-to-end golden assertion artifact.

---

## 8.6 Optional `expected.api.*.json`

Optional endpoint-specific expected outputs, for example:
- `expected.api.dashboard.json`
- `expected.api.team.json`

Use when endpoint-level projections differ from root snapshot expectations enough to deserve separate validation.

---

## 9. Comparison rules

## 9.1 Signal comparison

Required comparisons:
- signal key
- entityId
- normalized value
- missingness
- params required by active spec
- quality source where relevant

Allowed:
- omitting irrelevant cosmetic fields from strict comparison

Not allowed:
- skipping signal comparison just because snapshot “looks fine”

---

## 9.2 Score comparison

Required comparisons:
- `rawScore`
- `attentionScore`
- `displayScore`
- `layoutWeight`
- contributions ordering and values
- policy identity fields

---

## 9.3 Warning comparison

Required comparisons:
- warning code
- severity
- entityId when relevant

Message text may be compared less strictly if the project chooses, but code/severity semantics are mandatory.

---

## 9.4 Ordering comparison

Required comparisons:
- teams order in final snapshot
- tie behavior consistency

This must not be inferred from visual screenshots.

---

## 9.5 Geometry comparison

Required comparisons:
- all expected `rect` values
- container metadata
- no-overlap/bounds checks

For MVP golden fixtures, `rect` values are part of expected truth and must be compared explicitly.

---

## 10. Update discipline

Golden fixtures are not normal snapshots.  
They must not be updated casually.

Any fixture update must answer this question first:

> **Did the product truth change, or did only an incidental representation change?**

### Allowed fixture update reasons
- explicit approved policy version change
- explicit approved layout algorithm version change
- explicit approved snapshot schema version change
- fixture bug correction
- canonical input correction

### Forbidden fixture update reason
- “tests were failing and updating the snapshot was faster”

---

## 11. Version bump rules tied to fixture changes

## 11.1 Scoring semantics changed

If any expected signal/scoring result changes materially because scoring behavior changed:
- update fixture expectations
- bump `policyVersion`

---

## 11.2 Layout semantics changed

If any expected geometry changes materially because layout behavior changed:
- update fixture expectations
- bump `layoutAlgorithmVersion`

---

## 11.3 Snapshot shape changed

If expected DTO structure changes materially:
- update fixture expectations
- bump `snapshotSchemaVersion`

---

## 11.4 Input correction only

If fixture input was wrong but behavior semantics did not change:
- update fixture
- document the correction in fixture README
- no semantic version bump unless active contracts changed

---

## 12. Anti-patterns

The following are forbidden fixture practices:

- giant opaque snapshots with no README
- raw provider payload as only fixture input
- relying only on screenshots for acceptance
- storing fixture output without build context
- silently updating expected outputs after implementation changes
- mixing active and legacy semantics in one fixture
- golden fixtures that depend on current wall clock time

---

## 13. AI-assisted development rules

Any AI-assisted workflow must treat these fixtures as hard truth anchors.

AI must not:
- generate code that bypasses fixture semantics
- update fixture expected outputs without explicit version reasoning
- treat golden fixtures as disposable snapshots
- invent additional fixture semantics not present in fixture README/context

If AI-assisted development changes behavior that breaks a golden fixture, it must first classify the break as:
- bug
- intentional policy change
- intentional layout change
- intentional schema change
- fixture defect

and respond accordingly.

---

## 14. Acceptance criteria for the fixture system

The fixture system is acceptable when:

- all six official fixtures exist
- each has canonical input + explicit context + expected outputs
- fixtures are small enough to read and review
- golden tests can be executed reproducibly
- fixture updates require deliberate review
- semantic changes cannot slip through unnoticed

---

## 15. One-paragraph summary

The SportPulse MVP golden fixture system freezes six official, purpose-built canonical scenarios—baseline normal, insufficient history, no upcoming match, partial snapshot, stale fallback, and layout degenerate case—to protect the product’s semantic truth across normalization, signals, scoring, warnings, ordering, and geometry. Each fixture must include canonical input, explicit build context, expected signals, and expected snapshot outputs, and any change to those expectations must be justified through explicit versioning or documented correction rather than casual snapshot regeneration.
