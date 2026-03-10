# PE — Observation & Evaluation: Implementation Plan
Version: 1.1
Date: 2026-03-10
Status: Approved for execution
Depends on: PE-78 closed · Phase 4 complete · Observation & Evaluation Plan v1.0
Scope: `comp:football-data:PD` pre-match only · experimental detail surface only

---

## 1. Objective

Implement the infrastructure to:

1. Freeze one official pre-kickoff evaluation snapshot per match
2. Capture actual match results automatically
3. Record runtime observations (Track A)
4. Compute predictive performance metrics (Track B)
5. Present a decision gate report

This plan does not authorize any expansion of PE-78 scope.
All output is internal. All surfaces are gated.

---

## 2. Separation of Concerns

| Track | Question | Data source |
|-------|----------|-------------|
| A — Runtime | Does the feature behave correctly? | Observation log, runtime evidence |
| B — Model | Does the model produce useful signal? | Evaluation records + ground truth + metrics |

Track A and Track B must not be conflated. A correct render does not imply a useful prediction.

---

## 3. Phased Implementation

---

### Phase OE-1 — Evaluation Snapshot Infrastructure

**Goal:** Create one official frozen pre-kickoff evaluation record per match.

#### 3.1 Freeze rule (enforced in code)

- A record is created the first time a valid snapshot exists for a SCHEDULED future match.
- The freeze condition: `snapshot.generated_at < match.scheduled_kickoff_utc` (strict ISO string comparison — both are UTC).
- Once a record exists for a `match_id`, it is **never overwritten**. Freeze is permanent.
- If the first available snapshot has `generated_at >= scheduled_kickoff_utc` (post-kickoff):
  - Create a record with `prediction_available = false`, `excluded_reason = 'NO_PREGAME_SNAPSHOT'`, `evaluation_eligible = false`.
- Post-kickoff snapshot generation does not update any evaluation record.

#### 3.2 Record uniqueness

- `match_id` is the primary key of `EvaluationRecord`. One record per match, enforced at store level.
- `freezeIfAbsent(matchId, ...)` is a no-op if any record with that `match_id` already exists.

#### 3.3 EvaluationRecord schema

```typescript
interface EvaluationRecord {
  // Identity
  match_id: string;
  competition_id: string;
  home_team_id: string;
  away_team_id: string;
  scheduled_kickoff_utc: string;

  // Snapshot metadata
  snapshot_id: string;                  // e.g. `eval:${match_id}:${snapshot_generated_at}`
  snapshot_frozen_at: string;           // when the evaluation record was created
  snapshot_generated_at: string;        // original snapshot generated_at (must be < kickoff)
  engine_version: string;
  spec_version: string;
  prediction_available: boolean;        // false if no valid pre-kickoff snapshot exists

  // Eligibility
  evaluation_eligible: boolean;         // true = usable in metric denominators
  excluded_reason:
    | 'NOT_ELIGIBLE'
    | 'NO_PREGAME_SNAPSHOT'
    | 'MISSING_PROBS'
    | null;

  // Prediction content (null when prediction_available = false or mode = NOT_ELIGIBLE)
  mode: string;                         // FULL_MODE | LIMITED_MODE | NOT_ELIGIBLE
  calibration_mode: string | null;
  predicted_result: string | null;
  p_home_win: number | null;
  p_draw: number | null;
  p_away_win: number | null;
  expected_goals_home: number | null;
  expected_goals_away: number | null;
  reasons: string[];

  // Ground truth
  ground_truth_status: 'PENDING' | 'CAPTURED' | 'UNAVAILABLE';
  ground_truth_captured_at: string | null;
  final_home_goals: number | null;
  final_away_goals: number | null;
  actual_result: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null;

  // Track A observation (filled in via observation log or inspection)
  ui_render_result:
    | 'NO_RENDER'
    | 'NOT_ELIGIBLE_RENDER'
    | 'LIMITED_MODE_RENDER'
    | 'FULL_MODE_RENDER'
    | null;
  ui_clear_or_confusing: 'CLEAR' | 'CONFUSING' | null;
  runtime_issue:
    | 'NONE'
    | 'FETCH_ERROR'
    | 'SNAPSHOT_MISS'
    | 'SCOPE_MISMATCH'
    | 'OTHER'
    | null;
  runtime_notes: string | null;
}
```

#### 3.4 evaluation_eligible assignment rules

`evaluation_eligible = true` requires ALL of:
- `prediction_available = true`
- `snapshot_generated_at < scheduled_kickoff_utc`
- `mode !== 'NOT_ELIGIBLE'`
- `predicted_result !== null`

Otherwise `evaluation_eligible = false`. The `excluded_reason` field clarifies why:

| Condition | excluded_reason |
|-----------|----------------|
| `mode === 'NOT_ELIGIBLE'` | `'NOT_ELIGIBLE'` |
| No valid pre-kickoff snapshot | `'NO_PREGAME_SNAPSHOT'` |
| `predicted_result === null` (with valid snapshot) | `'MISSING_PROBS'` |
| None (eligible) | `null` |

#### 3.5 Storage

`cache/predictions/evaluations.json` — atomic write (.tmp → rename), same pattern as PredictionStore.

---

### Phase OE-2 — Shadow Runner Extension (Snapshot Freeze)

**Goal:** Automatically freeze evaluation records during the shadow execution cycle.

**Change:** In `server/prediction/shadow-runner.ts`, after saving a snapshot, call
`evaluationStore.freezeIfAbsent(matchId, competitionId, match, snapshot)`.

`freezeIfAbsent` creates a new `EvaluationRecord` only if:
- No record exists yet for this `match_id`
- The snapshot `generation_status === 'ok'`

If a record already exists → no-op (freeze is permanent).

The freeze cutoff check (`snapshot.generated_at < match.scheduled_kickoff_utc`) is enforced inside `freezeIfAbsent`, not in the caller.

---

### Phase OE-3 — Result Capture

**Goal:** Automatically fill ground truth once a match reaches FINISHED.

**New file:** `server/prediction/result-capture.ts`

```typescript
export function captureResults(
  dataSource: DataSource,
  evaluationStore: EvaluationStore,
  competitionIds: string[],
): void
```

**Logic:**
- Called at the end of each `runRefresh()` cycle
- For each competition in scope:
  - Get all FINISHED matches from dataSource
  - For each FINISHED match that has an evaluation record with `ground_truth_status !== 'CAPTURED'`:
    - Fill in `final_home_goals`, `final_away_goals`, `actual_result`, `ground_truth_captured_at`
    - Set `ground_truth_status = 'CAPTURED'`
    - Recompute `evaluation_eligible` (may flip to true now that ground truth exists — eligibility rules remain unchanged)
    - Persist
- Errors are logged and never propagated

**Result derivation:**
```
home_goals > away_goals → HOME_WIN
home_goals < away_goals → AWAY_WIN
home_goals === away_goals → DRAW
```

**ground_truth_status transitions:**
- Initial: `PENDING` (match not yet finished)
- After capture: `CAPTURED`
- `UNAVAILABLE`: reserved for matches that reach a terminal state other than FINISHED (cancelled, postponed) — set manually or via future automation

---

### Phase OE-4 — Metrics Engine

**Goal:** Compute all required metrics from completed evaluation records.

**New file:** `server/prediction/metrics-engine.ts`

**Recomputation strategy: on-demand at query time.**
Metrics are recomputed fresh on each `GET /api/internal/evaluation` request. No cached metric state.

Rationale: The evaluation dataset is bounded (30–100 records during the observation window). Computation is O(n) over a small n. Ground truth state changes over time as matches finish, so cached metric state would need invalidation logic that adds complexity for no meaningful gain. On-demand computation guarantees metrics always reflect current state.

#### 4.1 Five-Stage Coverage Funnel (mandatory)

Coverage is reported as a funnel, not a flat count. This prevents hiding coverage problems behind accuracy numbers.

| Stage | Filter | Reported as |
|-------|--------|-------------|
| Stage 1 — In scope | All `EvaluationRecord` entries | `total_in_scope` |
| Stage 2 — Frozen snapshot | `prediction_available = true` AND `snapshot_generated_at < scheduled_kickoff_utc` | `with_pregame_snapshot` |
| Stage 3 — Ground truth | `ground_truth_status = 'CAPTURED'` | `with_ground_truth` |
| Stage 4 — Fully evaluable | `evaluation_eligible = true` | `fully_evaluable` |
| Stage 5 — UI render recorded | `ui_render_result !== null` | `with_ui_observation` |

Also report at each stage:
- `NOT_ELIGIBLE_count` — records with `mode = 'NOT_ELIGIBLE'` (present in Stage 1, filtered from Stage 4+)
- `NO_PREGAME_SNAPSHOT_count` — records with `excluded_reason = 'NO_PREGAME_SNAPSHOT'`
- `mode_distribution` — count per FULL_MODE / LIMITED_MODE / NOT_ELIGIBLE

#### 4.2 Categorical performance (mandatory)

| Metric | Description |
|--------|-------------|
| `accuracy_total` | `predicted_result === actual_result` / Stage 4 count |
| `confusion_matrix` | 3×3: HOME_WIN, DRAW, AWAY_WIN predicted vs actual |

**Denominator:** Stage 4 only (`evaluation_eligible = true`). `NOT_ELIGIBLE` records are excluded from both numerator and denominator.

#### 4.3 Probability quality (mandatory — at least one)

| Metric | Formula |
|--------|---------|-|
| `brier_score_total` | `mean((p_home - I_home)² + (p_draw - I_draw)² + (p_away - I_away)²)` |
| `log_loss_total` | multiclass cross-entropy |

**Denominator:** Stage 4 records with non-null `p_home_win`, `p_draw`, `p_away_win`.

`NOT_ELIGIBLE` records are excluded (have no valid probabilities). Records with `excluded_reason = 'MISSING_PROBS'` are also excluded.

#### 4.4 Segmented metrics (mandatory)

Compute accuracy, Brier, log_loss separately for:
- `mode === 'FULL_MODE'`
- `mode === 'LIMITED_MODE'`

Required to verify whether FULL_MODE outperforms LIMITED_MODE.

#### 4.5 Calibration bucket metrics (mandatory)

Compute accuracy and Brier separately for:
- `calibration_mode === 'calibrated'`
- `calibration_mode === 'bootstrap'`
- `calibration_mode === null` (fallback / not set)

Allows comparing calibrated vs bootstrap prediction quality independently of mode.

#### 4.6 Baseline (mandatory — one baseline only)

**Baseline B — Naïve class frequency**

Method: Compute the frequency of each outcome (`HOME_WIN`, `DRAW`, `AWAY_WIN`) in the Stage 4 evaluated set. Always predict the most common class. This is the minimum bar the model must beat.

**Note:** A "max-prob class" baseline (argmax of model's own probabilities) is identical to the model's `predicted_result` field — it is tautologically the same prediction and produces no additional information. It is not computed.

Report `baseline_b_accuracy`: accuracy of always predicting the most frequent class.

#### 4.7 Operational quality (mandatory)

| Metric | Description |
|--------|-------------|
| `runtime_error_count` | Records with `runtime_issue !== 'NONE'` and `runtime_issue !== null` |
| `endpoint_miss_count` | Records with `ui_render_result === 'NO_RENDER'` and `prediction_available = true` |
| `snapshot_miss_count` | Records with `prediction_available = false` |

#### 4.8 xG coherence (exploratory)

MAE for expected_goals_home and expected_goals_away vs final_home_goals / final_away_goals.

Only on Stage 4 records with non-null xG values. Reported but not used in decision gate.

---

### Phase OE-5 — Evaluation Endpoint

**Goal:** Expose evaluation data internally for inspection.

**New file:** `server/prediction/evaluation-route.ts`

```
GET /api/internal/evaluation?competitionId=&limit=
```

- Gated by `process.env.PREDICTION_INTERNAL_VIEW_ENABLED` — 404 if off
- Returns: per-match evaluation table + aggregated metrics (recomputed on demand)
- `Cache-Control: no-store`

Response shape:

```typescript
{
  coverage_funnel: {
    total_in_scope: number;
    with_pregame_snapshot: number;
    with_ground_truth: number;
    fully_evaluable: number;
    with_ui_observation: number;
    NOT_ELIGIBLE_count: number;
    NO_PREGAME_SNAPSHOT_count: number;
    mode_distribution: Record<string, number>;
  };
  performance: {
    accuracy_total: number | null;
    confusion_matrix: Record<string, Record<string, number>> | null;
    brier_score_total: number | null;
    log_loss_total: number | null;
    by_mode: Record<string, { accuracy: number | null; brier: number | null; log_loss: number | null }>;
    by_calibration_mode: Record<string, { accuracy: number | null; brier: number | null }>;
    baseline_b_accuracy: number | null;
  };
  operational: {
    runtime_error_count: number;
    endpoint_miss_count: number;
    snapshot_miss_count: number;
  };
  records: EvaluationRecord[];
}
```

---

### Phase OE-6 — Evaluation Inspection Page

**Goal:** Internal UI to inspect evaluation progress and metrics.

**New file:** `packages/web/src/labs/EvaluationLabPage.tsx`

Route: `/labs/evaluacion`

Sections:
1. **Coverage funnel panel** — 5-stage funnel counts, mode distribution, snapshot rate
2. **Performance panel** — accuracy total, by mode, by calibration_mode, vs Baseline B, Brier score, log loss
3. **Per-match table** — all evaluation records with ground truth, eligibility, and metrics columns
4. **Runtime panel** — render result counts, error counts, runtime issues

Gated: 404 from endpoint → "No disponible" message (same pattern as PredictionsLabPage).

---

## 4. Required Data Fields

Full `EvaluationRecord` schema defined in Phase OE-1 §3.3.

Summary of fields by category:

| Category | Fields |
|----------|--------|
| Match identity | match_id, competition_id, home/away_team_id, scheduled_kickoff_utc |
| Snapshot metadata | snapshot_id, snapshot_frozen_at, snapshot_generated_at, engine_version, spec_version, prediction_available |
| Eligibility | evaluation_eligible, excluded_reason |
| Prediction content | mode, calibration_mode, predicted_result, p_home/draw/away, xG home/away, reasons |
| Ground truth | ground_truth_status, ground_truth_captured_at, final_home/away_goals, actual_result |
| Runtime observation | ui_render_result, ui_clear_or_confusing, runtime_issue, runtime_notes |

---

## 5. Minimum Metrics

| Category | Metrics | Mandatory |
|----------|---------|-----------|
| Coverage | 5-stage funnel, mode distribution, NOT_ELIGIBLE count | ✅ |
| Categorical | accuracy (Stage 4 denominator), confusion matrix | ✅ |
| Probability | Brier score OR log loss (both recommended) | ✅ |
| Segmented by mode | accuracy + Brier for FULL_MODE / LIMITED_MODE | ✅ |
| Segmented by calibration_mode | accuracy + Brier for 'calibrated' / 'bootstrap' / null | ✅ |
| Baseline | Baseline B (naïve class frequency) only | ✅ |
| Operational | runtime_error_count, endpoint_miss, snapshot_miss | ✅ |
| xG coherence | MAE for home/away | Exploratory |

---

## 6. Decision Gate (after 30–50 evaluated matches)

### Outcome A — Expansion candidate

Conditions:
- Track A: runtime stable, honest rendering confirmed, no blockers
- Track B: Stage 2 coverage acceptable, FULL_MODE materially useful, accuracy > Baseline B

Allowed next step: propose narrowly scoped expansion (Phase 5 evaluation).

---

### Outcome B — Keep experimental, do not expand

Conditions:
- Track A: runtime stable
- Track B: signal unclear, too many NOT_ELIGIBLE/snapshot misses, metrics mediocre

Allowed next step: continue observation, improve pipeline/coverage.

---

### Outcome C — Stop expansion, reassess model

Conditions:
- Track A: runtime stable
- Track B: poor predictive value, no advantage over Baseline B, outputs confuse more than help

Allowed next step: retain internal only or pause feature growth, review calibration/eligibility.

---

## 7. Immediate Next Tasks

| # | Task | Phase | Tier |
|---|------|-------|------|
| OE-1 | Implement `EvaluationStore` + `EvaluationRecord` type | OE-1 | Sonnet |
| OE-2 | Extend `shadow-runner.ts` with `freezeIfAbsent` | OE-2 | Sonnet |
| OE-3 | Implement `result-capture.ts` + wire into `runRefresh()` | OE-3 | Sonnet |
| OE-4 | Implement `metrics-engine.ts` (all mandatory metrics + baseline) | OE-4 | Sonnet |
| OE-5 | Implement `evaluation-route.ts` | OE-5 | Sonnet |
| OE-6 | Implement `EvaluationLabPage.tsx` | OE-6 | Sonnet |

**Execution order:** OE-1 → OE-2 → OE-3 (can be sequential same session) → OE-4 → OE-5 → OE-6

**Dependency graph:**
```
OE-1 (EvaluationStore)
  └─▶ OE-2 (freeze in shadow runner)
  └─▶ OE-3 (result capture)
        └─▶ OE-4 (metrics engine)
              └─▶ OE-5 (endpoint)
                    └─▶ OE-6 (inspection page)
```

---

## 8. Out of Scope

This plan explicitly excludes:

- Any expansion of PE-78 to other surfaces (map, cards, list, radar)
- Any expansion to other competitions
- Semantic changes to the prediction engine
- Live-mode evaluation
- Post-match productization
- External bookmaker baseline (optional for later)

---

## 9. File Summary

| File | Type | Phase |
|------|------|-------|
| `server/prediction/evaluation-store.ts` | New | OE-1 |
| `server/prediction/result-capture.ts` | New | OE-3 |
| `server/prediction/metrics-engine.ts` | New | OE-4 |
| `server/prediction/evaluation-route.ts` | New | OE-5 |
| `server/prediction/shadow-runner.ts` | Modified | OE-2 |
| `server/index.ts` | Modified | OE-3, OE-5 |
| `packages/web/src/labs/EvaluationLabPage.tsx` | New | OE-6 |
| `packages/web/src/App.tsx` | Modified | OE-6 |
| `cache/predictions/evaluations.json` | Runtime artifact | OE-1 |

---

## 10. v1.1 Changelog

Changes from v1.0:

1. **Snapshot uniqueness**: `match_id` enforced as primary key at store level. `freezeIfAbsent` is a strict no-op if any record already exists.
2. **Freeze cutoff precision**: Explicit rule — `snapshot_generated_at < scheduled_kickoff_utc`. First post-kickoff snapshot creates a record with `prediction_available = false`, `excluded_reason = 'NO_PREGAME_SNAPSHOT'`.
3. **Five-stage coverage funnel**: Replaced flat coverage counts with 5-stage funnel (in-scope → frozen → ground truth → fully evaluable → UI rendered). Prevents hiding snapshot/eligibility failures behind accuracy numbers.
4. **Baseline A removed**: "Max-prob baseline" (argmax of model probabilities) is identical to `predicted_result` — tautological. Only Baseline B (naïve class frequency) is computed.
5. **NOT_ELIGIBLE explicit treatment**: Counted in Stages 1–3. Excluded from categorical and probabilistic metric denominators. `excluded_reason = 'NOT_ELIGIBLE'`, `evaluation_eligible = false`.
6. **Metric recomputation**: On-demand at query time. No incremental state. Rationale documented.
7. **New schema fields**: `snapshot_id`, `evaluation_eligible`, `excluded_reason`, `ground_truth_status`.
8. **Calibration bucket reporting**: Metrics segmented by `calibration_mode` ('calibrated' / 'bootstrap' / null) in addition to `mode`.
