---
artifact_id: SPEC-SPORTPULSE-SIGNALS-CORE
title: "Signals Specification"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: signals
slug: core
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/specs/spec.sportpulse.signals.core.md
---
# SportPulse — Signals Specification

Version: 1.1  
Status: Draft for review  
Scope: Canonical signals and scoring inputs for SportPulse MVP and forward-compatible extensions  
Audience: Backend, Frontend, QA, Ops

---

## Appendix A — Mandatory structural changes from the previous draft

| Area | Previous draft | Revised rule |
|---|---|---|
| Versioning | `scoreVersion` used in score DTOs and policies | Replaced by `policyKey` + `policyVersion` |
| Determinism | No logical build time in scoring context | `buildNowUtc` is mandatory for signal and score reproducibility |
| Pipeline | `DisplayScore` optional; UI allowed to compute `sizeScore` | Mandatory chain: `signals -> attentionScore -> displayScore -> layoutWeight`; UI must consume, not compute |
| MVP scope | Football signal set left partially open | MVP fixed to football, mode B “Forma + agenda”, provider ingestion from football-data.org into canonical model |
| Form window | `FORM_POINTS_N` left open | Fixed to `FORM_POINTS_LAST_5` |
| Agenda proximity | Proximity and next-event hours both weighted as separate scoring signals | `NEXT_MATCH_HOURS` remains the scoring signal; `PROXIMITY_BUCKET` becomes a derived explainability helper, not a separate weighted signal |
| Size score | `SIZE_SCORE` treated as optional signal and could be computed in UI | Removed as canonical signal in MVP; tile sizing comes from `displayScore` and `layoutWeight` |
| Quality sources | `manual` / `external` allowed in canonical signal DTO | MVP restricts source to canonical ingested data and canonical derived data |

---

## 1. Purpose

This document defines the **canonical signal contract** used by SportPulse to compute attention and display sizing for entities (`TEAM` and `MATCH`), with an MVP focus on football. The spec is designed to be:

- Deterministic and reproducible (same inputs => same outputs)
- Explainable (top signal contributions can be extracted)
- Versioned and immutable once activated through a scoring policy
- Forward-compatible (new signals and policies can be added without breaking historical snapshots)

This spec **does not** define final scoring weights or UI thresholds; those live in **Scoring Policy Specification**. This spec defines **signal semantics, normalization rules, DTO contracts, and signal computation boundaries**.

---

## 2. MVP scope and fixed decisions

MVP scope is **football**, mode **B “Forma + agenda”**:

- Form window fixed to **last 5 finished matches** (`FORM_POINTS_LAST_5`)
- Agenda signal based on **hours until next match** (`NEXT_MATCH_HOURS`)
- Data provider ingestion from **football-data.org** into the canonical match/team model
- `buildNowUtc` mandatory for reproducibility and snapshot correctness
- UI must not compute scores; it consumes **displayScore** and **layoutWeight** only

Key consequences:

- Historical snapshots store **policyKey + policyVersion + buildNowUtc** and remain interpretable forever.
- Any change in normalization, signal semantics, thresholds, transforms, or weights requires a **new policy version**.
- The MVP contract is intentionally narrow; future signals may be added only through explicit versioned expansion.

---

## 3. Terminology

- **EntityKind**: `TEAM` or `MATCH`
- **Signal**: a normalized numeric measure in `[0..1]` with a defined meaning and deterministic computation
- **Canonical model**: normalized SportPulse domain model derived from provider data (`football-data.org`) and internal derivations
- **Policy**: versioned immutable mapping from signals to `attentionScore`, `displayScore`, and `layoutWeight`
- **AttentionScore**: numeric score produced by backend using policy weights and normalized signals
- **DisplayScore**: post-processed score mapping suitable for UI presentation
- **LayoutWeight**: final UI sizing weight used for treemap tile allocation

---

## 4. Architecture contract (non-negotiable)

### 4.1 Mandatory pipeline

Backend produces, in order:

1. `signals`  
2. `attentionScore`  
3. `displayScore`  
4. `layoutWeight`

**UI consumes** `displayScore` and `layoutWeight`.

UI must not compute, re-derive, re-normalize, or override scores.

### 4.2 Determinism: build time is an input, not a byproduct

All time-relative signals (next match hours, proximity buckets, recent form eligibility, etc.) must be computed relative to an explicit logical time:

- `buildNowUtc`: the logical “now” used for computing the snapshot.

`computedAtUtc` is metadata only. It does **not** define the time basis of computation.

---

## 5. Data model (DTO contracts)

### 5.1 Signal

```ts
type EntityKind = "TEAM" | "MATCH";

type SignalQuality = {
  source: "canonical_ingested" | "canonical_derived";
  freshnessUtc?: string;     // ISO-8601 UTC; source data freshness
  confidence?: number;       // 0..1, optional
  missing?: boolean;         // true if signal could not be computed deterministically
  notes?: string;            // optional troubleshooting note
};

type SignalDTO = {
  key: string;               // SignalKey
  entityKind: EntityKind;
  entityId: string;          // canonical id (teamId/matchId)
  value: number;             // normalized [0..1], unless missing=true then must be 0
  unit: "ratio" | "points" | "hours" | "count" | "unknown";
  params?: Record<string, any>; // deterministic inputs and normalization parameters
  quality: SignalQuality;
  explain?: string;          // brief stable human explanation
};
```

Rules:

- `value` must be clamped to `[0..1]` for all signals.
- If missing, `quality.missing=true`, `value=0`, and `params.reason` must record why.
- `unit` reflects the raw domain measurement before normalization; normalized value always remains in `[0..1]`.
- `params` must contain only deterministic values derived from canonical data and fixed rules.

### 5.2 Scoring context (deterministic input)

```ts
type ScoringContextDTO = {
  competitionId: string;
  seasonId: string;
  buildNowUtc: string;       // ISO-8601 UTC, mandatory
  timezone: string;          // IANA timezone name (e.g. "Europe/Madrid")
  locale?: string;           // optional for display/explain texts
};
```

### 5.3 Attention score (policy output)

```ts
type ContributionDTO = {
  signalKey: string;
  rawValue?: number;         // optional, if meaningful (e.g. points, hours)
  normValue: number;         // [0..1]
  weight: number;            // policy weight
  contribution: number;      // normValue * weight or policy-defined transform result
  notes?: string;
};

type AttentionScoreDTO = {
  entityKind: EntityKind;
  entityId: string;

  policyKey: string;         // e.g. "sportpulse.mvp.form-agenda"
  policyVersion: number;     // immutable once active
  buildNowUtc: string;       // must match context used for computation

  rawScore: number;          // unbounded weighted sum
  attentionScore: number;    // backend-defined normalized score
  displayScore: number;      // UI-ready score
  layoutWeight: number;      // final sizing weight for treemap/grid allocation

  topContributions: ContributionDTO[];
  computedAtUtc: string;     // metadata only
};
```

Rules:

- `policyKey + policyVersion + buildNowUtc` uniquely identify the scoring behavior for a snapshot.
- `displayScore` and `layoutWeight` are backend responsibilities.
- `topContributions` must be sorted by absolute `contribution` descending.
- If two contributions have equal absolute contribution, they must be sorted by `signalKey` ascending.

---

## 6. Normalization rules (shared contract)

All signals are normalized to `[0..1]` using one of these canonical patterns.

### 6.1 Min-max clamp

```text
norm = clamp((x - min) / (max - min), 0, 1)
```

Used when domain bounds are stable and meaningful.

### 6.2 Inverse min-max clamp (for “lower is better”)

```text
norm = 1 - clamp((x - min) / (max - min), 0, 1)
```

Used for hours-until-next-match where sooner means higher attention.

### 6.3 Piecewise buckets

Used for discrete interpretations such as proximity categories. Buckets must be deterministic and documented.

---

## 7. Canonical signals (MVP)

### 7.1 TEAM signals (used for MVP treemap sizing)

#### 7.1.1 `FORM_POINTS_LAST_5`

**Meaning:** normalized points earned by a team in its last **5 finished matches** before `buildNowUtc`.

Rules:

- Points: win = 3, draw = 1, loss = 0
- Window: last 5 finished matches with kickoff time `< buildNowUtc`
- If fewer than 5 finished matches exist:
  - Signal is computed using available matches
  - `quality.missing=true` only if zero finished matches exist
  - `params.matchesUsed` must record the count used

Raw value:

```text
rawPoints = sum(points_i) where i is in last N matches, N <= 5
maxPoints = 3 * N
```

Normalization:

```text
norm = rawPoints / maxPoints
```

DTO params must include:

- `windowSize = 5`
- `matchesUsed = N`
- `rawPoints`
- `maxPoints`
- `matchIds` used (optional but recommended for QA)

Unit: `points`

Quality:

- `source = "canonical_derived"`
- `freshnessUtc` is the minimum freshness across underlying ingested match results

Explain:

> Points in last 5 finished matches normalized by maximum possible in that window.

#### 7.1.2 `NEXT_MATCH_HOURS`

**Meaning:** normalized inverse time until a team’s next scheduled match after `buildNowUtc`.

Raw value:

```text
hours = (nextMatchKickoffUtc - buildNowUtc) in hours
```

For MVP v1, normalization horizon is fixed to:

- `minHours = 0`
- `maxHours = 168` (7 days)

Normalization:

```text
norm = 1 - clamp((hours - minHours) / (maxHours - minHours), 0, 1)
```

Interpretation:

- `hours <= 0` => treat as `0`
- If no next match exists in canonical schedule, then:
  - `quality.missing=true`
  - `value=0`
  - `params.reason="no_next_match"`

DTO params must include:

- `hours`
- `minHours`
- `maxHours`
- `nextMatchId` (if present)

Unit: `hours`

Quality:

- schedule source is ingested, but computed hours are derived
- final signal quality must be marked as `source="canonical_derived"`

Explain:

> Sooner next match => higher attention; normalized inverse hours within horizon.

### 7.2 MATCH signals (reserved for future versions)

The MVP treemap sizing is driven by TEAM-level scores. MATCH-level signals are reserved for future match cards and match-centric surfaces.

#### 7.2.1 `MATCH_START_HOURS`

Equivalent to `NEXT_MATCH_HOURS` but for a `MATCH` entity.

#### 7.2.2 `MATCH_IMPORTANCE_PROXY`

Optional derived metric based on competition phase, round, ranking deltas, or future match metadata. Out of MVP scope.

---

## 8. Derived explainability helpers (not weighted signals)

These values may be computed for explainability but must not be treated as separate weighted scoring signals in MVP, in order to avoid double counting.

### 8.1 `PROXIMITY_BUCKET`

Derived from `NEXT_MATCH_HOURS` (team) or `MATCH_START_HOURS` (match) using deterministic buckets:

- `0..24h` => `D1`
- `24..72h` => `D3`
- `72..168h` => `W1`
- `>168h` => `LATER`
- missing => `NONE`

This value may appear in `SignalDTO.params` or in separate derived metadata, but must not be weighted as an independent scoring signal in MVP policy v1.

---

## 9. Missing data behavior

Signals may be missing due to:

- insufficient match history (`FORM_POINTS_LAST_5`)
- missing schedule (`NEXT_MATCH_HOURS`)
- incomplete provider ingestion

Rules:

- missing => `quality.missing=true`, `value=0`
- downstream scoring must remain stable even if some signals are missing
- `topContributions` must exclude missing signals unless a policy explicitly defines otherwise; MVP excludes them

---

## 10. Policy interaction rules (boundaries)

This spec defines signal semantics. Policy defines:

- weights and transforms
- `attentionScore` normalization
- `displayScore` mapping
- `layoutWeight` mapping

Non-negotiables:

- policies are immutable once active
- any change requires a new `policyVersion`
- policies must be deterministic given canonical data, derived signals, and `buildNowUtc`

---

## 11. Acceptance criteria

### 11.1 Determinism

Given the same:

- canonical ingested data snapshot
- derived data rules
- `ScoringContextDTO` including `buildNowUtc`
- `policyKey + policyVersion`

The resulting:

- `SignalDTO` values
- `AttentionScoreDTO` outputs

must be semantically identical. If persisted snapshots are compared byte-for-byte, backend serialization must use canonical numeric formatting and stable object key ordering.

### 11.2 Explainability

For any entity, backend must return:

- top contributions (`signalKey`, `normValue`, `weight`, `contribution`)
- stable human explanation strings for signals

### 11.3 UI contract

UI uses:

- `displayScore`
- `layoutWeight`
- optional human explain fields

UI must not compute new scores or re-normalize signals.

---

## 12. MVP explicit constraints recap (for QA)

- Primary entity kinds in scope: `TEAM` and `MATCH`
- Primary scoring inputs for treemap sizing: TEAM-level signals only
- Form window: last **5** finished matches before `buildNowUtc`
- Provider basis: `football-data.org` ingested into canonical SportPulse entities

Out of scope for this version:

- ranking deltas, xG, injuries, transfers, fan sentiment, bookmaker odds
- manual overrides
- multi-provider reconciliation

---

## 13. Appendix B — Example payloads

### 13.1 Example TEAM signal payloads

```json
{
  "key": "FORM_POINTS_LAST_5",
  "entityKind": "TEAM",
  "entityId": "team:barcelona",
  "value": 0.7333,
  "unit": "points",
  "params": {
    "windowSize": 5,
    "matchesUsed": 5,
    "rawPoints": 11,
    "maxPoints": 15,
    "matchIds": ["match:1", "match:2", "match:3", "match:4", "match:5"]
  },
  "quality": {
    "source": "canonical_derived",
    "freshnessUtc": "2026-03-04T10:00:00Z",
    "confidence": 0.95,
    "missing": false
  },
  "explain": "Points in last 5 finished matches normalized by maximum possible in that window."
}
```

```json
{
  "key": "NEXT_MATCH_HOURS",
  "entityKind": "TEAM",
  "entityId": "team:barcelona",
  "value": 0.8214,
  "unit": "hours",
  "params": {
    "hours": 30,
    "minHours": 0,
    "maxHours": 168,
    "nextMatchId": "match:6"
  },
  "quality": {
    "source": "canonical_derived",
    "freshnessUtc": "2026-03-04T09:30:00Z",
    "confidence": 0.9,
    "missing": false
  },
  "explain": "Sooner next match => higher attention; normalized inverse hours within horizon."
}
```

### 13.2 Example AttentionScoreDTO

```json
{
  "entityKind": "TEAM",
  "entityId": "team:barcelona",
  "policyKey": "sportpulse.mvp.form-agenda",
  "policyVersion": 1,
  "buildNowUtc": "2026-03-04T12:00:00Z",
  "rawScore": 1.23,
  "attentionScore": 0.82,
  "displayScore": 0.78,
  "layoutWeight": 0.65,
  "topContributions": [
    {
      "signalKey": "FORM_POINTS_LAST_5",
      "rawValue": 11,
      "normValue": 0.7333,
      "weight": 0.7,
      "contribution": 0.5133
    },
    {
      "signalKey": "NEXT_MATCH_HOURS",
      "rawValue": 30,
      "normValue": 0.8214,
      "weight": 0.3,
      "contribution": 0.2464
    }
  ],
  "computedAtUtc": "2026-03-04T12:00:02Z"
}
```
