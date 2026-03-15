# SportPulse — Dashboard Snapshot DTO

Version: 1.2  
Status: Draft for review  
Scope: API payload contract for dashboard snapshots consumed by the frontend (treemap + details)  
Audience: Backend, Frontend, QA, Ops

---

## 1. Purpose

This document defines the **JSON contract** returned by the Snapshot API for the SportPulse dashboard.

It is aligned with:

- `signals-spec.md` (canonical signals and DTOs)
- `scoring-policy-spec.md` (policy identity, weights, score mapping)
- `snapshot-engine-spec.md` (snapshot build rules)
- `treemap-algorithm-spec.md` (server-side geometry generation)
- MVP mode B: **“Forma + agenda”** (football)

**Non-negotiables**

- Snapshot is computed relative to an explicit `buildNowUtc` (logical now).
- Snapshot embeds `policyKey` + `policyVersion` used to produce the scores.
- Snapshot embeds treemap layout metadata and per-tile geometry.
- UI **does not compute scores** and **does not compute layout**.
- No legacy fields (`sizeScore`, `proximityBonus`) exist in this DTO.

---

## 2. Key concepts

### 2.1 Snapshot identity

A snapshot is uniquely identified by the tuple:

- `competitionId`
- `seasonId`
- `buildNowUtc`
- `policyKey`
- `policyVersion`

The API may additionally expose a `snapshotKey` string for convenience, but it must be derivable from the above fields and must not introduce ambiguity.

### 2.2 Deterministic ordering

To keep UI rendering stable and testable, arrays must be deterministically ordered:

- `teams[]`: sort by `layoutWeight` descending, then by `teamId` ascending.
- `topContributions[]`: sort by `abs(contribution)` descending, tie-break by `signalKey` ascending.
- If additional entity lists are added later (e.g., `matches[]`), they must define the same kind of deterministic sorting rule.

### 2.3 Backend-owned geometry

Treemap geometry is computed server-side and carried in the snapshot.

Frontend responsibilities:

- render `rect`
- animate between `rect` values if desired
- use `displayScore` for UI labeling/styling if applicable

Frontend must not:

- run its own treemap solver
- re-order entities before layout
- alter tile weights in client code

---

## 3. DTOs

### 3.1 Common types

```ts
type EntityKind = "TEAM" | "MATCH";

type ISO8601Utc = string; // e.g. "2026-03-04T12:00:00Z"
```

### 3.2 Layout metadata

```ts
type RectDTO = {
  x: number;   // px relative to treemap container origin
  y: number;   // px relative to treemap container origin
  w: number;   // px
  h: number;   // px
};

type TreemapContainerDTO = {
  width: number;
  height: number;
  outerPadding: number;
  innerGutter: number;
};

type LayoutMetadataDTO = {
  algorithmKey: string;       // e.g. "treemap.squarified"
  algorithmVersion: number;   // layout algorithm version
  container: TreemapContainerDTO;
};
```

### 3.3 SnapshotHeaderDTO

```ts
type SnapshotHeaderDTO = {
  snapshotSchemaVersion: number; // DTO schema version (NOT the scoring policy version)
  competitionId: string;
  seasonId: string;

  buildNowUtc: ISO8601Utc;        // logical now used to compute the snapshot
  timezone: string;               // IANA tz name used for any local-date semantics

  policyKey: string;              // e.g. "sportpulse.mvp.form-agenda"
  policyVersion: number;          // immutable scoring policy version

  computedAtUtc: ISO8601Utc;      // execution timestamp (metadata)
  freshnessUtc?: ISO8601Utc;      // optional: last ingestion time for canonical provider data

  snapshotKey?: string;           // optional convenience key derived from identity tuple
};
```

Rules:

- `snapshotSchemaVersion` changes only when the DTO shape changes.
- `policyVersion` changes when scoring weights/mappings/normalization change (policy immutability).
- `buildNowUtc` is mandatory and must match the scoring context used to compute signals/scores.

### 3.4 WarningDTO

```ts
type WarningDTO = {
  code: string;
  severity: "INFO" | "WARN" | "ERROR";
  message?: string | null;
  entityId?: string;
};
```

### 3.5 SignalDTO (embedded for explainability)

This is the same contract as in `signals-spec.md`.

```ts
type SignalQuality = {
  source: "canonical_ingested" | "canonical_derived";
  freshnessUtc?: ISO8601Utc;
  confidence?: number;    // 0..1
  missing?: boolean;      // if true => value must be 0
  notes?: string;
};

type SignalDTO = {
  key: string;            // SignalKey, e.g. "FORM_POINTS_LAST_5"
  entityKind: EntityKind; // for dashboard MVP: "TEAM"
  entityId: string;       // canonical id (e.g. "team:barcelona")
  value: number;          // normalized [0..1]
  unit: "ratio" | "points" | "hours" | "count" | "unknown";
  params?: Record<string, any>;
  quality: SignalQuality;
  explain?: string;
};
```

### 3.6 ContributionDTO

```ts
type ContributionDTO = {
  signalKey: string;
  rawValue?: number;      // optional, if meaningful (e.g. rawPoints, hours)
  normValue: number;      // [0..1]
  weight: number;         // policy weight
  contribution: number;   // policy-defined contribution for explainability
  notes?: string;
};
```

### 3.7 TeamScoreDTO

This is the tile payload the treemap uses.

```ts
type TeamScoreDTO = {
  teamId: string;               // canonical team id
  teamName: string;             // display name

  // Policy identity and determinism anchor (redundant but useful for debugging):
  policyKey: string;
  policyVersion: number;
  buildNowUtc: ISO8601Utc;

  // Score outputs (backend responsibility):
  rawScore: number;             // unbounded weighted sum
  attentionScore: number;       // backend-normalized score
  displayScore: number;         // UI-ready mapped/clamped score
  layoutWeight: number;         // final treemap sizing weight

  // Geometry (backend-owned):
  rect: RectDTO;

  // Explainability:
  topContributions: ContributionDTO[];

  // Optional: embed only the signals needed for tooltips/debug:
  signals?: SignalDTO[];

  // Optional: next match for agenda display (NOT used to compute score in UI):
  nextMatch?: {
    matchId: string;
    kickoffUtc: ISO8601Utc;
    opponentTeamId?: string;
    opponentName?: string;
    venue?: "HOME" | "AWAY" | "NEUTRAL" | "UNKNOWN";
  };
};
```

Rules:

- UI must size and position tiles using `rect` only.
- UI may color/label using `displayScore`.
- UI must not re-derive `sizeScore`, re-run layout, or add ad-hoc proximity bonuses.
- If `signals[]` is included, it must not exceed a reasonable bound (e.g., only MVP signals) to control payload size.

### 3.8 DashboardSnapshotDTO (root)

```ts
type DashboardSnapshotDTO = {
  header: SnapshotHeaderDTO;
  layout: LayoutMetadataDTO;
  warnings: WarningDTO[];

  // Treemap entities (MVP v1: teams only)
  teams: TeamScoreDTO[];

  // Reserved for future (explicitly not used in MVP sizing):
  matches?: any[];
};
```

---

## 4. MVP v1 signal set (dashboard expectations)

For MVP v1, backend must produce at least these TEAM signals (for explainability and scoring):

- `FORM_POINTS_LAST_5`
- `NEXT_MATCH_HOURS`

Optional helper (not weighted in policy):

- `PROXIMITY_BUCKET` (derived)

No legacy fields allowed:

- `SIZE_SCORE` (removed from canonical DTO)
- `PROXIMITY_BONUS` (removed; replaced by bucket/helper)
- `HOT_MATCH_SCORE` (out of MVP)

---

## 5. Acceptance criteria

### 5.1 Reproducibility

If backend recomputes the same snapshot identity tuple:

- same canonical data snapshot
- same `buildNowUtc`
- same `policyKey` + `policyVersion`
- same layout algorithm metadata and container config

Then the resulting:

- signal values
- score fields (`rawScore`, `attentionScore`, `displayScore`, `layoutWeight`)
- geometry (`rect`)
- ordering of arrays

must be **semantically identical** and stable under the project's canonical JSON serialization rules.

### 5.2 Deterministic sorting

- `teams[]` sorted by `layoutWeight desc, teamId asc`.
- `topContributions[]` sorted by `abs(contribution) desc, signalKey asc`.

### 5.3 Geometry contract

- `rect` coordinates must fit inside the declared treemap container.
- Rectangles must not overlap except at shared boundaries.
- Frontend rendering must not require any additional layout computation.

---

## 6. Example payload

```json
{
  "header": {
    "snapshotSchemaVersion": 2,
    "competitionId": "COMP:PD",
    "seasonId": "SEASON:2025-2026",
    "buildNowUtc": "2026-03-04T12:00:00Z",
    "timezone": "Europe/Madrid",
    "policyKey": "sportpulse.mvp.form-agenda",
    "policyVersion": 1,
    "computedAtUtc": "2026-03-04T12:00:02Z",
    "freshnessUtc": "2026-03-04T11:55:00Z",
    "snapshotKey": "COMP:PD|SEASON:2025-2026|2026-03-04T12:00:00Z|sportpulse.mvp.form-agenda@1"
  },
  "layout": {
    "algorithmKey": "treemap.squarified",
    "algorithmVersion": 1,
    "container": {
      "width": 1200,
      "height": 700,
      "outerPadding": 8,
      "innerGutter": 6
    }
  },
  "warnings": [],
  "teams": [
    {
      "teamId": "team:barcelona",
      "teamName": "FC Barcelona",
      "policyKey": "sportpulse.mvp.form-agenda",
      "policyVersion": 1,
      "buildNowUtc": "2026-03-04T12:00:00Z",
      "rawScore": 0.7597,
      "attentionScore": 0.7597,
      "displayScore": 0.7597,
      "layoutWeight": 0.7597,
      "rect": {
        "x": 8,
        "y": 8,
        "w": 320,
        "h": 250
      },
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
      "signals": [
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
            "maxPoints": 15
          },
          "quality": {
            "source": "canonical_derived",
            "freshnessUtc": "2026-03-04T11:55:00Z",
            "confidence": 0.95,
            "missing": false
          },
          "explain": "Points in last 5 finished matches normalized by maximum possible in that window."
        },
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
            "freshnessUtc": "2026-03-04T11:55:00Z",
            "confidence": 0.9,
            "missing": false
          },
          "explain": "Sooner next match => higher attention; normalized inverse hours within horizon."
        }
      ],
      "nextMatch": {
        "matchId": "match:6",
        "kickoffUtc": "2026-03-05T18:00:00Z",
        "opponentTeamId": "team:valencia",
        "opponentName": "Valencia CF",
        "venue": "HOME"
      }
    }
  ]
}
```

---

## 7. Notes for implementation

- `layoutWeight` can be identical to `displayScore` in MVP v1 (identity mapping) to keep policy simple and auditable.
- `rect` is mandatory for treemap rendering in MVP v1.
- If you later introduce nonlinear display mapping, min-tile floors, or a new layout algorithm, it must be done via versioned spec changes:
  - new `policyVersion` for scoring/display changes
  - new `layoutAlgorithmVersion` for geometry changes
- Keep `signals[]` optional or trimmed in production; retain full signal lists only for debug endpoints if payload size becomes an issue.
