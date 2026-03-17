---
artifact_id: SPEC-SPORTPULSE-SCORING-POLICY
title: "Scoring Policy"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: scoring
slug: policy
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/specs/pipeline/spec.sportpulse.scoring.policy.md
---
# SportPulse — Scoring Policy Specification

Version: 1.1  
Status: Draft for review  
Scope: Versioned immutable policies that convert canonical signals into `attentionScore`, `displayScore`, and `layoutWeight` for SportPulse MVP and forward-compatible extensions  
Audience: Backend, Frontend, QA, Ops

---

## Appendix A — Mandatory structural changes from the previous draft

| Area | Previous draft | Revised rule |
|---|---|---|
| Policy identity | `scoreVersion` used as generic score identifier | Replaced by immutable `policyKey` + `policyVersion` |
| Determinism | No mandatory logical build time | `buildNowUtc` is a required scoring input |
| Pipeline | `DisplayScore` optional; UI could derive `sizeScore` | Mandatory backend-owned chain: `signals -> attentionScore -> displayScore -> layoutWeight` |
| MVP inputs | Mixed TEAM and MATCH scoring concepts, including composite signals | MVP team policy uses only canonical weighted signals: `FORM_POINTS_LAST_5` and `NEXT_MATCH_HOURS` |
| Double counting | `PROXIMITY_BONUS` weighted separately from next-event timing | Removed from scoring; proximity remains explainability helper only |
| UI responsibility | UI could compute size-related score | UI consumes backend outputs only |
| Scope closure | Football MVP left partially open | MVP fixed to football, mode B “Forma + agenda” |
| Policy/mapping mutability | Weights and mappings conceptually versioned but loosely defined | Any scoring-relevant change requires a new `policyVersion` |

---

## 1. Purpose

This document defines how SportPulse converts normalized canonical signals into:

- `attentionScore`
- `displayScore`
- `layoutWeight`
- optional threshold labels for UI treatment

This specification defines **policy behavior**, not signal semantics. Signal semantics, normalization contracts, and DTO shapes live in **Signals Specification**.

---

## 2. MVP scope and fixed decisions

MVP scope is **football**, mode **B “Forma + agenda”**.

For MVP v1:

- primary scored entity kind is `TEAM`
- weighted scoring inputs are:
  - `FORM_POINTS_LAST_5`
  - `NEXT_MATCH_HOURS`
- `MATCH` scoring policy is reserved for future versions and is **not active in MVP v1**
- `PROXIMITY_BUCKET` is explainability metadata only
- UI sizing must come from backend-provided `layoutWeight`
- policy evaluation is deterministic given canonical signals + `buildNowUtc` + policy version

---

## 3. Core principles

### 3.1 Policy immutability

Once a policy version is active, it must never be modified in place.

Any change to any of the following requires a **new `policyVersion`**:

- included signals
- weights
- transforms
- score normalization behavior
- display mapping behavior
- layout mapping behavior
- thresholds
- tie-break rules that affect persisted outputs

### 3.2 Determinism

Given the same:

- canonical data snapshot
- derived signal rules
- normalized signals
- `buildNowUtc`
- `policyKey`
- `policyVersion`

The resulting policy outputs must be identical under canonical snapshot serialization.

### 3.3 Explainability

Every scored entity must be explainable through signal contributions returned by backend.

### 3.4 Separation of concerns

The mandatory pipeline is:

`signals -> attentionScore -> displayScore -> layoutWeight`

Signal computation belongs to signal logic.  
Score combination belongs to policy logic.  
Presentation belongs to UI.  
UI must not recompute scores.

---

## 4. Terminology

- **Policy**: immutable versioned rule set mapping normalized signals to scoring outputs
- **Raw score**: direct weighted aggregation before any optional post-processing
- **AttentionScore**: backend-defined score used as the canonical semantic ranking signal
- **DisplayScore**: backend-defined presentation-safe score for UI display logic
- **LayoutWeight**: backend-defined weight used for tile sizing / treemap allocation
- **Threshold label**: optional categorical interpretation such as `HOT`, `WARM`, `COLD`

---

## 5. Policy identity and selection

### 5.1 Identity

A policy is uniquely identified by:

- `policyKey`
- `policyVersion`

For MVP v1, the active team policy is:

- `policyKey = "sportpulse.mvp.form-agenda"`
- `policyVersion = 1`

### 5.2 Selection

For MVP v1:

- sport: football
- mode: B “Forma + agenda”
- entityKind: `TEAM`
- selected policy: `sportpulse.mvp.form-agenda@1`

No other policy selection logic is in scope for MVP v1.

---

## 6. Inputs and preconditions

A policy evaluation requires:

```ts
type PolicyEvaluationInput = {
  entityKind: "TEAM" | "MATCH";
  entityId: string;
  policyKey: string;
  policyVersion: number;
  buildNowUtc: string;
  signals: SignalDTO[];
};
```

Preconditions:

- all input signals must already be normalized to `[0..1]`
- signal semantics must already conform to Signals Specification
- policy evaluation must ignore signals not included in the selected policy
- missing included signals must be handled deterministically

---

## 7. Policy DTO contract

```ts
type WeightedSignalRule = {
  signalKey: string;
  weight: number;
  required: boolean;
};

type ThresholdRule = {
  hotMin: number;
  warmMin: number;
  coldMin: number;
};

type PolicyDefinitionDTO = {
  policyKey: string;
  policyVersion: number;
  entityKind: "TEAM" | "MATCH";
  modeKey: string;

  includedSignals: WeightedSignalRule[];

  rawScoreFormula: "weighted_sum";
  attentionMapping: {
    method: "identity";
  };
  displayMapping: {
    method: "identity";
  };
  layoutMapping: {
    method: "identity";
  };

  thresholds: ThresholdRule;

  tieBreak: {
    contributionSort: "abs(contribution)_desc_then_signalKey_asc";
    entitySortWhenScoresEqual: "entityId_asc";
  };

  notes?: string;
};
```

---

## 8. Active MVP v1 policy

### 8.1 Policy definition

```json
{
  "policyKey": "sportpulse.mvp.form-agenda",
  "policyVersion": 1,
  "entityKind": "TEAM",
  "modeKey": "mvp.forma-agenda",
  "includedSignals": [
    {
      "signalKey": "FORM_POINTS_LAST_5",
      "weight": 0.7,
      "required": false
    },
    {
      "signalKey": "NEXT_MATCH_HOURS",
      "weight": 0.3,
      "required": false
    }
  ],
  "rawScoreFormula": "weighted_sum",
  "attentionMapping": {
    "method": "identity"
  },
  "displayMapping": {
    "method": "identity"
  },
  "layoutMapping": {
    "method": "identity"
  },
  "thresholds": {
    "hotMin": 0.7,
    "warmMin": 0.4,
    "coldMin": 0.0
  },
  "tieBreak": {
    "contributionSort": "abs(contribution)_desc_then_signalKey_asc",
    "entitySortWhenScoresEqual": "entityId_asc"
  },
  "notes": "MVP v1 team attention policy for football mode B Forma + agenda."
}
```

### 8.2 Rationale

This policy deliberately favors **form** over **agenda proximity**:

- `FORM_POINTS_LAST_5` captures recent sporting relevance
- `NEXT_MATCH_HOURS` injects near-term agenda salience
- the weighting ratio `0.7 / 0.3` keeps schedule proximity meaningful without allowing it to dominate poor form

This is intentionally simple for MVP v1. No nonlinear transforms are used yet.

---

## 9. Scoring formulas

### 9.1 Raw score

For MVP v1:

`rawScore = (0.7 * FORM_POINTS_LAST_5.normValue) + (0.3 * NEXT_MATCH_HOURS.normValue)`

Rules:

- if an included signal is missing, its contribution is `0`
- policy does not renormalize remaining weights when a signal is missing
- therefore missingness lowers score deterministically

### 9.2 Attention score

For MVP v1:

`attentionScore = rawScore`

Reason:

- included signal weights sum to `1.0`
- input signals are already normalized to `[0..1]`
- weighted sum therefore already lies in `[0..1]`

### 9.3 Display score

For MVP v1:

`displayScore = attentionScore`

Reason:

- no additional display transform is justified yet
- keeping identity mapping preserves explainability and reduces hidden behavior

### 9.4 Layout weight

For MVP v1:

`layoutWeight = displayScore`

Reason:

- no layout-specific transform is justified yet
- UI sizing behavior should remain directly interpretable from score outputs

---

## 10. Threshold classification

Threshold labels are optional metadata derived from `displayScore`.

For MVP v1:

- `HOT` if `displayScore >= 0.70`
- `WARM` if `displayScore >= 0.40` and `< 0.70`
- `COLD` if `displayScore < 0.40`

These labels must not affect score computation.

---

## 11. Contribution extraction rules

For every scored entity, backend must compute a contribution for each included policy signal.

```ts
type ContributionDTO = {
  signalKey: string;
  rawValue?: number;
  normValue: number;
  weight: number;
  contribution: number;
  notes?: string;
};
```

Rules:

- `contribution = normValue * weight` for MVP v1
- missing signals use `normValue = 0`
- `topContributions` must be sorted by:
  1. absolute contribution descending
  2. `signalKey` ascending as tie-breaker
- if full contribution list is persisted, it must follow the same order

---

## 12. Missing data behavior

Missing included signals must not break evaluation.

Rules:

- missing signal => effective `normValue = 0`
- policy evaluation still returns a complete `AttentionScoreDTO`
- thresholds still apply to the resulting `displayScore`
- contribution list may omit missing signals from `topContributions` if they contribute `0`, but omission rules must be consistent across snapshots

Recommended MVP v1 behavior:

- include only non-zero contributions in `topContributions`
- persist full internal contribution set for debugging if needed

---

## 13. Serialization and reproducibility rules

If persisted snapshots are compared for exact stability, the backend snapshot serializer must enforce:

- canonical key ordering
- stable decimal formatting
- stable ordering of `topContributions`
- stable ordering of entities when external consumers request ranked output

If two entities have identical `layoutWeight`, ranking order must use `entityId` ascending.

---

## 14. Output contract

Policy evaluation produces:

```ts
type AttentionScoreDTO = {
  entityKind: "TEAM" | "MATCH";
  entityId: string;

  policyKey: string;
  policyVersion: number;
  buildNowUtc: string;

  rawScore: number;
  attentionScore: number;
  displayScore: number;
  layoutWeight: number;

  topContributions: ContributionDTO[];
  computedAtUtc: string;
};
```

Rules:

- `policyKey`, `policyVersion`, and `buildNowUtc` are mandatory
- UI must consume `displayScore` and `layoutWeight` exactly as returned
- UI must not derive alternate size scores

---

## 15. Non-goals and out of scope for MVP v1

Out of scope in this policy version:

- MATCH scoring activation
- composite scoring signals such as `SIZE_SCORE`
- weighted `PROXIMITY_BUCKET`
- nonlinear display mappings (log, sqrt, sigmoid)
- minimum guaranteed tile floor logic
- bookmaker odds
- injuries, transfers, sentiment, xG, ranking delta
- manual overrides
- multi-policy blending

---

## 16. Backward compatibility rules

- historical snapshots remain interpretable through `policyKey + policyVersion`
- adding a new policy version is non-breaking
- mutating an existing policy version is forbidden
- removing fields from `AttentionScoreDTO` is breaking
- changing included signals, weights, formulas, thresholds, or mappings requires a new `policyVersion`

---

## 17. Acceptance criteria

### 17.1 Policy determinism

Given the same:

- normalized signal set
- entity id
- `buildNowUtc`
- `policyKey`
- `policyVersion`

The resulting policy outputs must be semantically identical and serialization-stable under canonical snapshot rules.

### 17.2 Explainability

For any scored TEAM entity, backend must return enough contribution data to explain why its tile is larger or smaller than another.

### 17.3 UI contract integrity

UI must be able to render:

- size from `layoutWeight`
- textual score cues from `displayScore`
- explanation from `topContributions`

without recomputing any policy logic.

### 17.4 MVP scope integrity

For MVP v1, only these weighted signals may affect TEAM scoring:

- `FORM_POINTS_LAST_5`
- `NEXT_MATCH_HOURS`

No other signal may influence score outputs in policy version 1.

---

## 18. Example evaluation

### 18.1 Inputs

- `FORM_POINTS_LAST_5.normValue = 0.7333`
- `NEXT_MATCH_HOURS.normValue = 0.8214`

### 18.2 Calculation

- `rawScore = (0.7 * 0.7333) + (0.3 * 0.8214)`
- `rawScore = 0.51331 + 0.24642`
- `rawScore = 0.75973`
- `attentionScore = 0.75973`
- `displayScore = 0.75973`
- `layoutWeight = 0.75973`
- threshold label = `HOT`

### 18.3 Example DTO

```json
{
  "entityKind": "TEAM",
  "entityId": "team:barcelona",
  "policyKey": "sportpulse.mvp.form-agenda",
  "policyVersion": 1,
  "buildNowUtc": "2026-03-04T12:00:00Z",
  "rawScore": 0.75973,
  "attentionScore": 0.75973,
  "displayScore": 0.75973,
  "layoutWeight": 0.75973,
  "topContributions": [
    {
      "signalKey": "FORM_POINTS_LAST_5",
      "rawValue": 11,
      "normValue": 0.7333,
      "weight": 0.7,
      "contribution": 0.51331
    },
    {
      "signalKey": "NEXT_MATCH_HOURS",
      "rawValue": 30,
      "normValue": 0.8214,
      "weight": 0.3,
      "contribution": 0.24642
    }
  ],
  "computedAtUtc": "2026-03-04T12:00:02Z"
}
```

---

## 19. Future versioning path

Likely future policy versions may introduce:

- MATCH-scored policy activation
- nonlinear display mapping once real treemap density is observed
- minimum layout floor if product decides every entity must remain visible
- additional signals once canonical data quality proves stable

Those changes belong to future policy versions, not to MVP policy v1.
