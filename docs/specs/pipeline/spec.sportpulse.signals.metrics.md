---
artifact_id: SPEC-SPORTPULSE-SIGNALS-METRICS
title: "Metrics Specification"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: signals
slug: metrics
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/specs/pipeline/spec.sportpulse.signals.metrics.md
---
# SportPulse — Metrics Specification

Version: 1.1  
Status: Draft for review  
Scope: Canonical raw analytical measurements used by the SportPulse snapshot pipeline for MVP and forward-compatible extensions  
Audience: Backend, Data Pipeline, QA, Product

---

## Appendix A — Mandatory structural changes from the previous draft

| Area | Previous draft | Revised rule |
|---|---|---|
| Scope | Metrics acted as both raw measurements and UI-driving scores | Metrics are raw/internal analytical measurements only; UI-facing scoring is defined in `signals-spec.md` and `scoring-policy-spec.md` |
| MVP metric set | `FORM_POINTS_N`, `WINRATE_N`, `NEXT_EVENT_HOURS`, `PROXIMITY_BONUS`, `SIZE_SCORE`, `HOT_MATCH_SCORE` | MVP v1 metric set is reduced to `FORM_POINTS_LAST_5_RAW`, `NEXT_MATCH_HOURS_RAW`, and non-scoring helper `PROXIMITY_BUCKET` |
| Time basis | Used implicit `now` | All time-relative metrics must use explicit `buildNowUtc` |
| Layout coupling | `SIZE_SCORE` determined treemap tile size | Metrics must not define tile size, display score, or layout weight |
| Match highlighting | `HOT_MATCH_SCORE` part of metric pipeline | Removed from MVP metric contract; any future match highlighting must be introduced via a new scoring policy version |
| Naming | `NEXT_EVENT_HOURS` | Renamed to `NEXT_MATCH_HOURS_RAW` for MVP football clarity and consistency |
| Pipeline | `metrics -> SIZE_SCORE -> HOT_MATCH_SCORE -> snapshot` | Pipeline is `canonical data -> metrics -> signals -> scoring policy -> displayScore/layoutWeight -> snapshot` |

---

## 1. Purpose

This document defines the **canonical raw metrics** used internally by SportPulse to derive normalized signals and build deterministic snapshots.

Metrics are the analytical layer between:

- canonical football data (matches, teams, statuses, kickoff times, results), and
- normalized signals defined in `signals-spec.md`

Metrics must be:

- deterministic
- provider-independent after canonicalization
- reproducible for a given `buildNowUtc`
- small in scope
- non-UI-authoritative

This document **does not** define:

- attention weights
- displayScore mapping
- layoutWeight mapping
- treemap size formulas
- frontend rendering rules

Those belong to:

- `signals-spec.md`
- `scoring-policy-spec.md`
- UI / snapshot DTO specs

---

## 2. Boundaries and design rule

### 2.1 Metrics are raw measurements, not product-facing scores

A metric is a deterministic analytical measurement derived from canonical data.

Examples:

- raw points from the last 5 finished matches
- raw hours until next scheduled match
- categorical proximity bucket for explanation

Metrics are **not**:

- attention scores
- composite display scores
- treemap weights
- UI formulas

### 2.2 Signals consume metrics or equivalent canonical derivations

For MVP v1, metrics may be materialized explicitly or computed inline during snapshot build, but they remain conceptually upstream from signals.

Relationship:

- raw metrics -> signal normalization / signal DTO params -> scoring policy -> snapshot DTO

### 2.3 No duplicate authority

If this document and `signals-spec.md` ever overlap, **`signals-spec.md` is authoritative for UI-facing signal semantics**.

This document exists to define raw metric semantics and snapshot-pipeline inputs, not to redefine scoring.

---

## 3. MVP scope and fixed decisions

MVP scope is fixed to:

- sport: **football**
- mode: **B “Forma + agenda”**
- form window: **last 5 finished matches**
- agenda timing basis: **hours until next match**
- provider ingestion source: **football-data.org**, normalized into canonical SportPulse entities
- logical build time: **`buildNowUtc` is mandatory**

MVP v1 canonical metrics are limited to:

1. `FORM_POINTS_LAST_5_RAW`
2. `NEXT_MATCH_HOURS_RAW`
3. `PROXIMITY_BUCKET` (helper only; non-scoring)

Out of MVP metric scope:

- `WINRATE_N`
- `SIZE_SCORE`
- `HOT_MATCH_SCORE`
- ranking deltas
- xG-derived metrics
- bookmaker-based metrics
- sentiment/fan-interest metrics
- manual override metrics exposed as canonical measurement outputs

---

## 4. Deterministic metric context

```ts
// Internal computation context for metric evaluation

type MetricComputationContext = {
  competitionId: string;
  seasonId: string;
  buildNowUtc: string;    // ISO-8601 UTC, mandatory
  timezone: string;       // IANA timezone for local-date projections
};
```

Rules:

- All time-relative metrics must be computed against `buildNowUtc`.
- `computedAtUtc` is runtime metadata only and must not change metric meaning.
- Canonical match filtering must use canonical UTC timestamps and canonical statuses.

---

## 5. Canonical metric model

```ts
// Internal metric DTO / persisted snapshot fragment if materialized

type MetricQuality = {
  source: "canonical_ingested" | "canonical_derived";
  freshnessUtc?: string;
  missing?: boolean;
  notes?: string;
};

type MetricDTO = {
  metricKey: string;
  entityKind: "TEAM" | "MATCH";
  entityId: string;
  rawValue: number | string | null;
  unit: "points" | "hours" | "bucket" | "count" | "unknown";
  params?: Record<string, any>;
  quality: MetricQuality;
  computedAtUtc: string;
};
```

Rules:

- `MetricDTO.rawValue` stores the **raw metric value**, not the normalized signal value.
- If a metric cannot be computed deterministically, `rawValue=null` and `quality.missing=true`.
- Metrics may be materialized or ephemeral, but if persisted they must remain reproducible from canonical inputs and `buildNowUtc`.

---

## 6. Canonical metrics (MVP)

### 6.1 `FORM_POINTS_LAST_5_RAW`

**Entity kind:** `TEAM`  
**Unit:** `points`  
**Purpose:** raw recent-form measurement used to derive `FORM_POINTS_LAST_5` signal.

#### Computation

Consider the last **5 finished matches** for a team with kickoff time `< buildNowUtc`.

Football scoring rule:

- win = 3
- draw = 1
- loss = 0

Formula:

- `rawPoints = sum(points of last N finished matches)` where `0 <= N <= 5`
- `maxPoints = 3 * N`

#### Edge cases

- If `N = 0`, metric is missing:
  - `rawValue = null`
  - `quality.missing = true`
  - `params.reason = "no_finished_matches"`
- If `1 <= N < 5`, metric is valid using available matches:
  - `quality.missing = false`
  - `params.matchesUsed = N`

#### Required params

```json
{
  "windowSize": 5,
  "matchesUsed": 5,
  "maxPoints": 15,
  "matchIds": ["match:1", "match:2", "match:3"]
}
```

#### Notes

- Postponed, canceled, and non-finished matches must not enter the form window.
- Score corrections on finished matches must trigger deterministic recomputation.

---

### 6.2 `NEXT_MATCH_HOURS_RAW`

**Entity kind:** `TEAM`  
**Unit:** `hours`  
**Purpose:** raw upcoming-schedule measurement used to derive `NEXT_MATCH_HOURS` signal.

#### Computation

Find the next canonical match for the team where:

- `match.startTimeUtc >= buildNowUtc`
- `match.status in { SCHEDULED, TBD }`

Formula:

- `hours = (nextMatch.startTimeUtc - buildNowUtc) / 3600`

#### Edge cases

- If `hours < 0` due to boundary inconsistencies, clamp raw metric to `0` and record a note.
- If no future match exists:
  - `rawValue = null`
  - `quality.missing = true`
  - `params.reason = "no_next_match"`

#### Required params

```json
{
  "nextMatchId": "match:6",
  "minHours": 0,
  "maxHours": 168
}
```

#### Notes

- `minHours` and `maxHours` are included because MVP signal normalization uses a fixed 0..168 horizon.
- Raw metric semantics do not change if a later policy version changes signal weighting.

---

### 6.3 `PROXIMITY_BUCKET`

**Entity kind:** `TEAM` or `MATCH`  
**Unit:** `bucket`  
**Purpose:** explainability/helper categorization derived from raw hours.

`PROXIMITY_BUCKET` is a **non-scoring helper metric**.

It must **not** be used as a weighted metric, weighted signal, display score, or treemap weight in MVP v1.

#### Input source

- team view: `NEXT_MATCH_HOURS_RAW`
- match view: match start hours equivalent raw value

#### Buckets

- `0..24h` => `D1`
- `24..72h` => `D3`
- `72..168h` => `W1`
- `>168h` => `LATER`
- missing => `NONE`

#### Example

```json
{
  "metricKey": "PROXIMITY_BUCKET",
  "entityKind": "TEAM",
  "entityId": "team:barcelona",
  "rawValue": "D3",
  "unit": "bucket",
  "params": {
    "derivedFrom": "NEXT_MATCH_HOURS_RAW",
    "hours": 30
  },
  "quality": {
    "source": "canonical_derived",
    "missing": false
  },
  "computedAtUtc": "2026-03-04T12:00:02Z"
}
```

---

## 7. Metrics explicitly removed from the MVP contract

The following items from the previous draft are **not canonical MVP metrics anymore**:

### 7.1 `WINRATE_N`

Reason:

- redundant for MVP football mode
- not used by current signal or policy contract
- introduces unnecessary parallel semantics alongside form points

### 7.2 `SIZE_SCORE`

Reason:

- improperly mixed raw analytics with product-facing tile sizing
- created illegal coupling between metrics and UI layout
- superseded by backend scoring pipeline output: `attentionScore -> displayScore -> layoutWeight`

### 7.3 `HOT_MATCH_SCORE`

Reason:

- depended on legacy `SIZE_SCORE`
- was not closed cleanly for match semantics in MVP
- future match highlighting must be defined as a separate scoring-policy evolution, not as an inherited metric shortcut

---

## 8. Relation to signals

For MVP v1, the relation is:

| Metric | Consumed by signal | Signal role |
|---|---|---|
| `FORM_POINTS_LAST_5_RAW` | `FORM_POINTS_LAST_5` | normalized team form |
| `NEXT_MATCH_HOURS_RAW` | `NEXT_MATCH_HOURS` | normalized inverse schedule proximity |
| `PROXIMITY_BUCKET` | none (helper only) | explainability / badges / grouping |

Important:

- signal normalization semantics live in `signals-spec.md`
- scoring weights live in `scoring-policy-spec.md`
- layout sizing lives downstream from scoring, not here

---

## 9. Missing data behavior

Metrics may be missing because of:

- no finished matches in window
- no upcoming scheduled match
- incomplete canonical ingestion

Rules:

- missing metric => `quality.missing=true`
- raw numeric metric => `rawValue=null`
- helper bucket metric => `rawValue="NONE"` if derived from missing raw hours
- downstream signals must degrade gracefully without crashing snapshot generation

---

## 10. Storage strategy

Metrics may be handled in two valid ways:

### Option A — Materialized during snapshot build

Metrics are stored as part of an internal snapshot computation record.

Pros:

- easier QA and audit
- easier debugging of signal derivation
- easier historical reconstruction

Cons:

- more storage
- extra schema surface

### Option B — Computed inline during snapshot build

Metrics are computed in-memory and only signal DTOs / score outputs are persisted in snapshot payloads.

Pros:

- simpler persisted model
- fewer duplicated artifacts

Cons:

- less direct auditability unless separately logged

### MVP recommendation

**Compute during snapshot build and persist only where needed for audit/debug.**

The user-facing snapshot contract does not require raw metric persistence as long as resulting signals and scores are reproducible.

---

## 11. Determinism rules

Given identical:

- canonical entities
- canonical match statuses/results
- canonical kickoff timestamps
- `MetricComputationContext` including `buildNowUtc`
- identical metric computation rules

The resulting metrics must be semantically identical.

If persisted and compared byte-for-byte, serialization must use:

- stable object key order
- stable enum/string values
- stable numeric formatting rules

Forbidden inputs:

- randomness
- machine learning outputs not snapshotted as canonical inputs
- provider-specific transient fields after canonicalization
- wall-clock time other than explicit `buildNowUtc`

---

## 12. Time handling

Rules:

- canonical storage is in UTC
- raw metric computation uses UTC
- local timezone conversion is only for agenda grouping, labeling, and UI presentation
- if timezone is missing or invalid, fallback rules must be deterministic and recorded in warnings/context

---

## 13. Acceptance criteria

A metric implementation is valid if:

1. it produces identical semantic outputs from identical canonical inputs and `buildNowUtc`
2. it does not depend on provider-native schemas after canonicalization
3. it does not define UI layout or display score behavior
4. it handles edge cases without breaking snapshot generation
5. it remains consistent with `signals-spec.md`

---

## 14. Example metric outputs

### 14.1 `FORM_POINTS_LAST_5_RAW`

```json
{
  "metricKey": "FORM_POINTS_LAST_5_RAW",
  "entityKind": "TEAM",
  "entityId": "team:real-madrid",
  "rawValue": 11,
  "unit": "points",
  "params": {
    "windowSize": 5,
    "matchesUsed": 5,
    "maxPoints": 15,
    "matchIds": ["match:101", "match:102", "match:103", "match:104", "match:105"]
  },
  "quality": {
    "source": "canonical_derived",
    "freshnessUtc": "2026-03-04T11:55:00Z",
    "missing": false
  },
  "computedAtUtc": "2026-03-04T12:00:02Z"
}
```

### 14.2 `NEXT_MATCH_HOURS_RAW`

```json
{
  "metricKey": "NEXT_MATCH_HOURS_RAW",
  "entityKind": "TEAM",
  "entityId": "team:real-madrid",
  "rawValue": 30,
  "unit": "hours",
  "params": {
    "nextMatchId": "match:106",
    "minHours": 0,
    "maxHours": 168
  },
  "quality": {
    "source": "canonical_derived",
    "freshnessUtc": "2026-03-04T11:50:00Z",
    "missing": false
  },
  "computedAtUtc": "2026-03-04T12:00:02Z"
}
```

### 14.3 `PROXIMITY_BUCKET`

```json
{
  "metricKey": "PROXIMITY_BUCKET",
  "entityKind": "TEAM",
  "entityId": "team:real-madrid",
  "rawValue": "D3",
  "unit": "bucket",
  "params": {
    "derivedFrom": "NEXT_MATCH_HOURS_RAW",
    "hours": 30
  },
  "quality": {
    "source": "canonical_derived",
    "missing": false
  },
  "computedAtUtc": "2026-03-04T12:00:02Z"
}
```
