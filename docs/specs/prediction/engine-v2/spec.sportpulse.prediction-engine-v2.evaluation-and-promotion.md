---
artifact_id: SPEC-SPORTPULSE-PREDICTION-ENGINE-V2-EVALUATION-AND-PROMOTION
title: "NEXUS Evaluation and Promotion Framework"
artifact_class: spec
status: draft
version: 0.1.0
project: sportpulse
domain: prediction
slug: engine-v2-evaluation-and-promotion
owner: team
created_at: 2026-03-18
updated_at: 2026-03-18
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-PREDICTION-ENGINE-V2-MASTER
  - SPEC-SPORTPULSE-PREDICTION-ENGINE-V2-NEXUS-0
  - SPEC-SPORTPULSE-PREDICTION-ENGINE-V2-MODEL-TAXONOMY-AND-ENSEMBLE
  - SPEC-SPORTPULSE-PREDICTION-ENGINE-V2-MARKET-SIGNAL-POLICY
canonical_path: docs/specs/prediction/engine-v2/spec.sportpulse.prediction-engine-v2.evaluation-and-promotion.md
---

# NEXUS Evaluation and Promotion Framework

**Version:** 0.1-DRAFT
**Status:** DRAFT -- pending review
**Scope:** Metrics, evaluation methodology, promotion gate, demotion procedure, and league expansion criteria for the NEXUS predictive engine
**Audience:** Architect, Backend, Data/ML, QA, Product
**Parent document:** `spec.sportpulse.prediction-engine-v2.master.md` (S6.4)

---

## Table of Contents

- S1. Purpose
- S2. Primary Metrics
- S3. Benchmark of Reference
- S4. Walk-Forward Validation
- S5. Scorecards
- S6. Promotion Gate
- S7. Promotion Process
- S8. Demotion Process
- S9. League Expansion
- S10. Internal Calibration Metrics
- S11. Reproducibility of Evaluations
- S12. Invariants
- S13. What This Document Is NOT

---

## S1. Purpose

### S1.1 What This Document Resolves

This document exists to prevent "champion vs. challenger" from becoming a liturgical exercise without quantitative teeth. Without a formal evaluation framework:

- An engine can be promoted based on anecdotal evidence ("it looked better this weekend").
- Regression in one dimension can be hidden by improvement in another ("accuracy went up but calibration collapsed").
- Promotion can happen before sufficient evidence has accumulated ("only 40 predictions, but they were good").
- Rollback criteria can be vague or absent ("we will monitor it").

This document defines the exact conditions under which NEXUS replaces V3, the exact evidence required, and the exact procedure for rollback if NEXUS underperforms after promotion.

### S1.2 Relationship to Market Signal Policy

The evaluation framework uses market-derived probabilities as a benchmark (S3). The market-signal-policy subdocument (master S6.5) governs how market data is used as a feature within the engine (Track 4). The unified anti-circular doctrine is:

1. **RPS is always computed against realized match outcomes** (1X2 results), not against market probabilities. The comparison "RPS of NEXUS vs RPS of Pinnacle" measures two independent forecasters against the same ground truth. This is NOT circular, even when Track 4 uses Pinnacle odds as a feature.
2. **The hard prohibition:** Odds must never serve as a **training target or calibration target** in the same period in which they are used as a feature. Walk-forward temporal validation (S4) prevents this structurally.
3. **Feature in Track 4:** Odds captured at or before `buildNowUtc` enter Track 4 as a model input. This does not create circularity because the evaluation target is the match outcome, not the odds themselves.

The market-signal-policy subdocument (S8) defines the detailed separation rules.

---

## S2. Primary Metrics

### S2.1 Metric Definitions

| Metric | Role | Definition | Direction |
|--------|------|-----------|-----------|
| **RPS** (Ranked Probability Score) | Primary | Measures the calibration and discrimination of the 1X2 distribution. `RPS = (1/2) * sum_r( (sum_{i<=r}(p_i) - sum_{i<=r}(o_i))^2 )` where r ranges over cumulative outcomes. | Lower is better |
| **Log-loss** | Complementary | `-sum(o_i * log(p_i))` where `o_i` is the indicator for the realized outcome and `p_i` is the predicted probability. Penalizes confident wrong predictions severely. | Lower is better |
| **Brier Score** | Complementary | `(1/N) * sum(p_i - o_i)^2` averaged over all predictions and outcomes. Similar to RPS but without the ranked component. | Lower is better |
| **Accuracy 1X2** | Classification | Fraction of matches where `predicted_result == actual_result`. | Higher is better |
| **DRAW recall** | Classification (draw-specific) | `TP_draw / (TP_draw + FN_draw)`. Fraction of actual draws correctly predicted as draws. | Higher is better |
| **DRAW precision** | Classification (draw-specific) | `TP_draw / (TP_draw + FP_draw)`. Fraction of predicted draws that were actual draws. | Higher is better |

### S2.2 Why RPS Is Primary

RPS is the primary metric because it uniquely captures both calibration and ordinal sensitivity:

1. A model that predicts `{0.40, 0.30, 0.30}` for a home win is better calibrated than one that predicts `{0.90, 0.05, 0.05}` if the true probability is close to `{0.40, 0.30, 0.30}`. RPS captures this.
2. A model that assigns `{0.50, 0.30, 0.20}` and the outcome is home win is penalized less than one that assigns `{0.20, 0.30, 0.50}`, because the first model at least gave the correct outcome the highest probability. The ranked component of RPS captures this.

Accuracy is explicitly NOT the primary metric because:

- Accuracy ignores probability quality. A model that predicts `{0.34, 0.33, 0.33}` for every match and always picks "home" will have non-trivial accuracy in many leagues but terrible RPS.
- Accuracy incentivizes overconfidence. To maximize accuracy, a model should be maximally confident in its top pick, regardless of the true probability distribution.
- Accuracy is unstable on small samples. A few coin-flip matches can swing accuracy by several percentage points.

### S2.3 Why DRAW Metrics Are Tracked Separately

Draw prediction is the most common failure mode of football prediction models. The empirical draw rate in major European leagues is approximately 25-27%. A model that assigns low probability to draws (collapsing p_draw toward 0) will have improved accuracy on home and away predictions at the cost of never predicting draws correctly. This trade-off is invisible in aggregate accuracy and in RPS (which may even improve slightly if the draw collapse is well-calibrated). DRAW recall and precision are tracked to detect this specific failure mode.

---

## S3. Benchmark of Reference

### S3.1 Primary Benchmark

The primary benchmark for NEXUS is the RPS of **Pinnacle closing-line implied probabilities**, de-vigged using proportional normalization.

- **Source:** Pinnacle sportsbook closing odds for the 1X2 market, captured as close to kickoff as possible.
- **De-vigging method:** Proportional normalization (as defined in market-signal-policy S7.2). The de-vig method is fixed for the entire evaluation period. Changing the de-vig method requires a new evaluation period.
- **Approximate benchmark RPS:** 0.185-0.188 on PD, PL, and BL1 over recent complete seasons.

### S3.2 Benchmark Eligibility and Evaluation Populations

Evaluation operates on two explicit populations:

1. **Full evaluation sample:** All matches where both NEXUS and V3 produced predictions. Used for NEXUS vs V3 comparisons and NEXUS vs naive baseline. Does NOT require Pinnacle odds.
2. **Pinnacle benchmark subset:** Matches from the full sample that also have Pinnacle closing-line odds available in the feature store. Used for NEXUS vs Pinnacle comparisons.

If Pinnacle odds are unavailable for a match:

1. The match remains in the **full evaluation sample** and is evaluated against realized outcomes (all metrics in S2.1 apply).
2. The match is excluded from the **Pinnacle benchmark subset**.
3. The match contributes to the "NEXUS vs. V3" comparison (which does not require market data).

Promotion gate metrics (S6.3) are computed over the **full evaluation sample** for comparisons against V3, and over the **Pinnacle benchmark subset** for comparisons against the market. Every scorecard (S5) reports both populations with their respective sample sizes.

**Benchmark ineligible is not evaluation ineligible.** A match without Pinnacle odds available:
- SI cuenta para NEXUS vs V3 (permanece en el evaluation sample completo).
- NO cuenta para NEXUS vs Pinnacle / market benchmark (sale del benchmark subset).

El benchmark subset es un subconjunto del evaluation sample. No son poblaciones equivalentes.
Reportar solo el benchmark subset como si fuera el evaluation sample completo es
un error de metodologia.

### S3.3 What the Benchmark Means

The objective of NEXUS is NOT merely "better than V3." The objective is to approach or surpass the forecasting quality of the Pinnacle closing line. "Better than V3" is a necessary condition for promotion, but the long-term aspiration is closing the gap to the market benchmark.

The promotion gate (S6) uses V3 as the primary comparator because:

1. V3 is the production system being replaced. The immediate question is: "Is NEXUS better than what we have?"
2. The Pinnacle benchmark is aspirational. Requiring NEXUS to beat Pinnacle before promotion would delay deployment indefinitely and prevent incremental improvement.

However, all evaluation scorecards (S5) report both the V3 comparison and the Pinnacle comparison, so progress toward the long-term objective is always visible.

---

## S4. Walk-Forward Validation

### S4.1 Mandatory Methodology

All evaluation of NEXUS -- whether for promotion, for development feedback, or for scorecard generation -- must use walk-forward temporal validation. There are no exceptions.

**Walk-forward principle:** For every prediction being evaluated, the model had access only to data that was available before the match being predicted. The model was trained on data that precedes the evaluation period. No information from the evaluation period leaks into the model through any channel (features, calibration, ensemble weights, rho parameters, or any other learned parameter).

### S4.2 Walk-Forward Structure

```
|<--- Training period --->|<--- Evaluation period --->|
                          ^
                     No data from evaluation period used in training
```

1. The training period is used to:
   a. Fit Elo ratings (Track 1).
   b. Fit Track 3 model parameters.
   c. Learn meta-ensemble weights.
   d. Fit calibration tables (S8 of model-taxonomy spec).

2. The evaluation period is used to:
   a. Generate predictions using the trained model.
   b. Compare predictions against realized outcomes.
   c. Compute all metrics in S2.1.
   d. Generate all scorecards in S5.

3. No data from the evaluation period appears in any training input. This is guaranteed by the as-of constraint (NEXUS-0 S3.2) and the anti-lookahead tests (NEXUS-0 S8).

### S4.3 Nested Validation for Ensemble Weights

The meta-ensemble weights are learned from historical prediction performance (model-taxonomy spec S7.4). To prevent overfitting, weight learning uses nested temporal validation:

1. **Inner fold (weight training):** Predictions from the weight-training period are used to optimize ensemble weights.
2. **Outer fold (weight evaluation):** Predictions from the evaluation period use the weights learned in the inner fold.
3. **Invariant:** The inner fold is strictly before the outer fold. No match in the outer fold appears in the inner fold.

This nested structure ensures that the evaluation of ensemble weights is not biased by in-sample optimization.

### S4.4 Minimum Evaluation Window

The evaluation period must contain:

- At least 200 matches per league per evaluation window.
- At least 2 distinct phases of the season (per the `seasonPhase` definition in the model-taxonomy spec S5.3.1).

These minimums prevent evaluation on unrepresentative slices of the season (e.g., only the first 3 matchdays, or only mid-table clashes).

---

## S5. Scorecards

### S5.1 Purpose

A scorecard is a structured report of all evaluation metrics (S2.1) for a specific segment of the evaluation data. Scorecards make it impossible to claim "NEXUS is better" based on aggregate numbers alone -- every relevant dimension is reported.

### S5.2 Mandatory Scorecard Dimensions

For every formal evaluation, scorecards must be produced in ALL of the following dimensions:

#### S5.2.1 By League

| Scorecard | Segment |
|-----------|---------|
| PD | LaLiga predictions only |
| PL | Premier League predictions only |
| BL1 | Bundesliga predictions only |
| GLOBAL | All leagues aggregated |

The GLOBAL scorecard is orientative. The per-league scorecards are binding for promotion decisions. A global improvement that masks a league-specific regression is not sufficient for promotion (S6.5).

#### S5.2.2 By Season Phase

| Scorecard | Segment |
|-----------|---------|
| EARLY | Matchdays 1-10 |
| MID | Matchdays 11-25 |
| LATE | Matchdays 26+ |

Season phase scorecards verify that NEXUS performs well throughout the season, not just during the predictable mid-season period.

#### S5.2.3 By Confidence Tier

| Scorecard | Segment |
|-----------|---------|
| HIGH | Predictions where `confidence = 'HIGH'` |
| MEDIUM | Predictions where `confidence = 'MEDIUM'` |
| LOW | Predictions where `confidence = 'LOW'` |

Confidence tier scorecards verify that NEXUS's self-assessed confidence is informative (HIGH-confidence predictions should have better metrics than LOW-confidence predictions).

#### S5.2.4 By Operating Mode

| Scorecard | Segment |
|-----------|---------|
| FULL_MODE | Predictions in FULL_MODE |
| LIMITED_MODE | Predictions in LIMITED_MODE |

LIMITED_MODE predictions are expected to have worse metrics. This scorecard verifies that the degradation is bounded and that the mode determination is correct.

#### S5.2.5 By Data Quality Tier

| Scorecard | Segment |
|-----------|---------|
| FULL | Data quality tier = FULL |
| PARTIAL | Data quality tier = PARTIAL |
| MINIMAL | Data quality tier = MINIMAL |

#### S5.2.6 By Market Availability

| Scorecard | Segment |
|-----------|---------|
| WITH_MARKET | Matches with Pinnacle closing-line odds available |
| WITHOUT_MARKET | Matches without Pinnacle closing-line odds |

The WITH_MARKET scorecard includes the Pinnacle benchmark comparison. The WITHOUT_MARKET scorecard includes only NEXUS vs. V3 and NEXUS vs. naive baseline.

#### S5.2.7 By Prediction Origin

Los resultados de evaluacion se reportan en tres scorecards obligatorios y mutuamente excluyentes:

| Scorecard | Segment |
|-----------|---------|
| `historical_walk_forward` | Predicciones de origen historico (walk-forward estricto) |
| `live_shadow` | Predicciones de origen live shadow pre-kickoff |
| `combined` | Union de los dos anteriores |

Reglas de reporting:
1. No se permite fusionar `historical_walk_forward` y `live_shadow` en una sola bolsa.
2. El scorecard `combined` no puede sustituir al `live_shadow` en ningun gate de evaluacion.
3. Cada prediccion pertenece a exactamente un slice de origen (`historical_walk_forward`
   o `live_shadow`). No puede aparecer en ambos.
4. El `combined` se construye como union disjunta. Su cardinalidad debe coincidir con
   la suma de los dos slices. Cualquier discrepancia es un error de conteo, no de modelo.

### S5.3 Scorecard Contents

Each scorecard contains:

| Field | Description |
|-------|-------------|
| Segment identifier | The dimension and segment value (e.g., "League: PD") |
| Sample size (N) | Number of predictions in this segment |
| NEXUS RPS | RPS of NEXUS predictions |
| V3 RPS | RPS of V3 predictions (same matches) |
| Pinnacle RPS | RPS of Pinnacle implied probabilities (if available) |
| Delta RPS (NEXUS - V3) | Difference. Negative is favorable to NEXUS. |
| NEXUS log-loss | Log-loss of NEXUS |
| V3 log-loss | Log-loss of V3 |
| NEXUS accuracy | Accuracy of NEXUS |
| V3 accuracy | Accuracy of V3 |
| NEXUS draw recall | Draw recall of NEXUS |
| V3 draw recall | Draw recall of V3 |
| NEXUS draw precision | Draw precision of NEXUS |
| V3 draw precision | Draw precision of V3 |
| Consistency | Fraction of matchdays where NEXUS RPS < V3 RPS |

### S5.4 Naive Baseline

All scorecards include a comparison against the naive baseline:

- **Naive baseline:** Assign the historical class frequency as the probability for every match. For example, if the historical home win rate in PD is 47%, the naive baseline predicts `{0.47, 0.27, 0.26}` for every PD match.
- **Naive RPS:** Approximately 0.222 for major European leagues.

This baseline ensures that both NEXUS and V3 are meaningfully better than random prediction. A model that fails to beat the naive baseline has no forecasting value.

---

## S6. Promotion Gate

### S6.1 Gate Structure

The promotion gate is a conjunction of conditions. ALL conditions must be satisfied simultaneously. There is no override, no "majority vote," and no "close enough." A single failed condition blocks promotion.

### S6.2 Volume Conditions

These conditions ensure that the evaluation has sufficient statistical power.

| Condition | Threshold |
|-----------|-----------|
| Total predictions evaluated | >= 600 |
| Predictions per league (PD) | >= 200 |
| Predictions per league (PL) | >= 200 |
| Predictions per league (BL1) | >= 200 |
| Season phases covered | >= 2 distinct phases (EARLY, MID, LATE) |
| Matchdays covered per league | >= 10 distinct matchdays per league |

**Origin composition of the 200 per league:**

NEXUS solo puede promoverse a champion si acumula al menos 200 predicciones evaluadas
por cada liga objetivo.

De esas 200 por liga:
- Al menos 100 deben provenir de live shadow real (predicciones emitidas pre-kickoff
  con pipeline congelado, buildNowUtc anterior al kickoff, sin datos post-kickoff).
- El resto puede provenir de walk-forward historico estricto (misma semantica as-of,
  pipeline congelado, sin leakage).

Ninguna prediccion de backtesting con datos futuros puede contar hacia estos 200,
independientemente de como este etiquetada.

### S6.3 Metric Conditions (All Must Hold)

| Condition | Formula | Rationale |
|-----------|---------|-----------|
| RPS improvement (aggregate) | `RPS_NEXUS < RPS_V3` | NEXUS must be strictly better in the primary metric. |
| RPS improvement (per-league majority) | NEXUS RPS < V3 RPS in at least 2 of 3 production leagues | Ensures improvement is not driven by a single league. |
| DRAW recall preservation | `DRAW_recall_NEXUS >= DRAW_recall_V3 - 0.03` | NEXUS must not collapse draw prediction. Tolerance of 3 percentage points. |
| Accuracy preservation | `Accuracy_NEXUS >= Accuracy_V3 - 0.02` | NEXUS must not sacrifice classification quality. Tolerance of 2 percentage points. |
| Log-loss preservation | `LogLoss_NEXUS <= LogLoss_V3 + 0.02` | NEXUS must not introduce severe miscalibration visible in log-loss. |

### S6.4 No-Regression Condition (Per-League)

| Condition | Formula | Rationale |
|-----------|---------|-----------|
| No league-level RPS regression | `RPS_NEXUS_league <= RPS_V3_league + 0.005` for every league | NEXUS cannot win in aggregate while losing badly in one league. The 0.005 tolerance accounts for random variation. |

If NEXUS improves in PD and PL but worsens by more than 0.005 RPS in BL1, promotion is blocked until BL1 performance is addressed.

### S6.5 Consistency Condition

| Condition | Formula | Rationale |
|-----------|---------|-----------|
| Matchday-level consistency | `NEXUS RPS < V3 RPS` in >= 70% of evaluated matchdays | Ensures NEXUS's advantage is consistent, not driven by a few outlier matchdays. |

A matchday is the unit of consistency measurement. For each matchday with at least 3 predictions evaluated, compute the average RPS for NEXUS and V3. The 70% threshold means NEXUS must win at least 7 out of every 10 matchdays on average.

### S6.6 Live Shadow Condition

Condicion de live_shadow: NEXUS debe superar o empatar materialmente a V3 en el
scorecard `live_shadow`. "Materialmente" significa que la diferencia en RPS no supera
0.005 en contra de NEXUS.

| Condition | Formula | Rationale |
|-----------|---------|-----------|
| Live shadow RPS | `RPS_NEXUS_live_shadow <= RPS_V3_live_shadow + 0.005` | NEXUS must not lose in the slice that represents real production conditions. |

Esta condicion no puede ser sustituida por:
- ganar solo en `combined`,
- ganar solo en `historical_walk_forward`,
- ni por ninguna agregacion que diluya el slice `live_shadow`.

Si NEXUS gana en `combined` pero pierde en `live_shadow` por mas de 0.005 RPS, el
promotion gate falla.

### S6.7 Conditions NOT Required for Promotion

The following conditions are tracked in scorecards but are NOT required for promotion:

- NEXUS RPS < Pinnacle RPS. (Aspirational, not a gate.)
- NEXUS accuracy > V3 accuracy. (Accuracy improvement is welcome but not required, given the 2pp tolerance in S6.3.)
- NEXUS DRAW precision > V3 DRAW precision. (DRAW recall is the binding constraint, not precision.)

---

## S7. Promotion Process

### S7.1 Steps

Promotion follows these steps in order. No step may be skipped.

**Step 1: Gate check.**
Verify all conditions in S6 (volume, metrics, no-regression, consistency). If any condition fails, promotion is blocked. Document which condition(s) failed and why.

**Step 2: Scorecard generation.**
Produce all mandatory scorecards (S5.2) for the evaluation period. The scorecards are the evidentiary basis for the promotion decision.

**Step 3: Audit.**
The `predictive-engine-auditor` agent generates a formal audit report following the project's existing audit pattern (documented in `CLAUDE.md`, audit artifacts in `docs/audits/`). The audit report includes:

- All scorecards from Step 2.
- Gate check results from Step 1 (pass/fail for each condition, with numerical evidence).
- Dictamen: PROMOTE or DO_NOT_PROMOTE.
- If PROMOTE: summary of evidence supporting promotion.
- If DO_NOT_PROMOTE: summary of which conditions failed and recommended actions.

**Step 4: Decision record (ADR).**
A formal Architecture Decision Record is created in `docs/audits/` with:

- Decision: promote or not promote.
- Evaluation period (date range).
- Quantitative evidence (summary of scorecards and gate results).
- Risks identified.
- Rollback plan reference (S8).

**Step 5: Production swap.**
If the decision is to promote:

1. Set `NEXUS_PROMOTED=true` in the production environment.
2. Verify that the production API returns `engine_id: 'nexus'` in prediction outputs.
3. Verify that V3 shadow mode is activated (V3 continues to produce predictions in shadow for the observation period).

**Step 6: Observation period start.**
A 30-day observation period begins. During this period:

- NEXUS serves production predictions.
- V3 runs in shadow mode.
- All metrics (S2.1) are monitored continuously.
- The demotion process (S8) is armed and ready.

### S7.2 Promotion Is Not Permanent

Promotion is provisional until the observation period completes successfully (no demotion trigger fired). After the observation period, V3 may be deprecated.

---

## S8. Demotion Process

### S8.1 Purpose

Demotion is the rollback procedure when NEXUS underperforms after promotion. The demotion process is designed to be fast and automatic, requiring no human judgment for the trigger and minimal intervention for the swap.

### S8.2 Demotion Trigger

NEXUS is demoted if the following condition is met during the observation period:

```
RPS_NEXUS > RPS_V3 + 0.005
sustained for >= 10 consecutive matches evaluated
```

**Interpretation:** If NEXUS's RPS exceeds V3's RPS by more than 0.005 for 10 or more consecutive evaluated matches, the regression is considered systematic (not random) and demotion is triggered.

### S8.3 Demotion Procedure

1. **Trigger detection.** Automated monitoring detects the demotion trigger condition.
2. **Immediate swap.** Set `NEXUS_PROMOTED=false` in the production environment. V3 resumes serving production predictions. No grace period.
3. **Incident report.** Document the trigger: which 10+ matches, what the RPS delta was, when the trigger fired.
4. **Root cause analysis.** Investigate why NEXUS regressed. Common causes:
   a. Calibration drift (calibration table outdated for current match distribution).
   b. Feature store data quality degradation (provider downtime, schema change).
   c. Ensemble weight overfitting (weights learned on a non-representative training period).
   d. A specific track producing degenerate output.
5. **Re-promotion.** After root cause is addressed, NEXUS may re-enter shadow mode and repeat the promotion process from Step 1 (S7.1). There is no shortcut for re-promotion -- the full gate must be satisfied again on a new evaluation period.

### S8.4 V3 Availability Guarantee

V3 must remain deployable and operational throughout the observation period. Specifically:

- V3's code, configuration, and calibration tables are not modified during the observation period.
- V3 continues to produce shadow predictions during the observation period.
- V3's test suite continues to pass throughout the observation period.
- No V3 dependency is removed, deprecated, or broken during the observation period.

V3 may be deprecated only after the observation period completes without a demotion trigger. "Deprecation" means V3's shadow runner is deactivated and its code is archived. V3's tests and golden fixtures are preserved indefinitely.

---

## S9. League Expansion

### S9.1 Purpose

This section defines how new leagues are added to NEXUS's production scope beyond the initial three (PD, PL, BL1).

### S9.2 Expansion Gate (Per-League)

For a candidate league to be included in NEXUS production, ALL of the following conditions must be met:

| Condition | Threshold | Rationale |
|-----------|-----------|-----------|
| Forward validation sample size | >= 300 matches with NEXUS shadow predictions | Sufficient data for reliable evaluation. |
| NEXUS accuracy vs. naive baseline | `Accuracy_NEXUS >= Accuracy_naive + 0.05` (5pp above baseline) | The engine has forecasting value for this league. |
| NEXUS RPS for the candidate league | `RPS_NEXUS_league < 0.210` | Absolute quality threshold. |
| No degradation of existing leagues | Adding the candidate league to the production scope does not degrade RPS on PD, PL, or BL1 by more than 0.002 | The new league does not pollute the existing model. |

### S9.3 Candidate League Status

| League | Code | Status | Notes |
|--------|------|--------|-------|
| Serie A | SA | Candidate | Post-300 forward validation samples. SA was excluded from V3 global calibration due to draw rate contamination (see MEMORY.md SP-V4-37). NEXUS per-liga calibration may resolve this. |
| Ligue 1 | FL1 | Deferred | Data quality concerns (fewer market odds sources, inconsistent xG coverage). Not eligible under this framework unless structural improvements in data coverage are demonstrated. |
| Liga Uruguaya | URU (4432) | Not a NEXUS target | Data sparsity (TheSportsDB free tier) makes player-level features infeasible. V3 continues for URU. |
| Argentine Liga Profesional | AR (4406) | Not a NEXUS target | Same data sparsity issues as URU. V3 continues. |

### S9.4 Expansion Does Not Require Re-Promotion

Adding a league to NEXUS's scope is a separate decision from NEXUS promotion. A league can be added to NEXUS's production scope at any time after promotion, provided the expansion gate (S9.2) is satisfied. The existing production leagues are not affected.

---

## S10. Internal Calibration Metrics

### S10.1 Purpose

In addition to the forecasting metrics (S2), NEXUS's internal calibration quality is monitored through calibration curves and overconfidence/underconfidence analysis. These metrics are not used in the promotion gate but are included in every scorecard for diagnostic purposes.

### S10.2 Calibration Curve

For each outcome class (home, draw, away):

1. Bin all predictions by predicted probability (bins of width 0.05: [0.00, 0.05), [0.05, 0.10), ..., [0.95, 1.00]).
2. For each bin, compute:
   a. Mean predicted probability (x-axis).
   b. Observed frequency of the outcome (y-axis).
3. A perfectly calibrated model lies on the identity line (y = x).

Calibration curves are reported per league and per operating mode.

### S10.3 Overconfidence/Underconfidence Analysis

For each confidence tier (HIGH, MEDIUM, LOW):

1. Compute the average absolute difference between predicted probability and observed frequency across all bins.
2. A positive value (predicted > observed) indicates overconfidence.
3. A negative value (predicted < observed) indicates underconfidence.

### S10.4 DRAW Calibration Detail

Given the importance of draw prediction (S2.3), the DRAW calibration is analyzed at finer granularity:

| p_draw range | Metric |
|-------------|--------|
| 0.20 - 0.25 | Observed draw rate, sample size |
| 0.25 - 0.30 | Observed draw rate, sample size |
| 0.30 - 0.35 | Observed draw rate, sample size |
| > 0.35 | Observed draw rate, sample size |

This breakdown reveals whether NEXUS is calibrated in the critical draw-probability range where most draws are predicted.

---

## S11. Reproducibility of Evaluations

### S11.1 Requirement

Every formal evaluation (one that produces scorecards and a gate check) must be fully reproducible. Given the same data and the same engine versions, the same evaluation results must be obtained.

### S11.2 Required Artifacts

For each formal evaluation, the following artifacts must be persisted:

| Artifact | Location | Description |
|----------|----------|-------------|
| Evaluation period | In the scorecard metadata | Start and end dates (UTC) of the evaluation period |
| Match set | Referenced by evaluation ID | The exact set of match IDs evaluated, with their outcomes |
| NEXUS fingerprint | In each prediction record | Full prediction fingerprint (per model-taxonomy spec S11.2) |
| V3 fingerprint | In each prediction record | V3 prediction fingerprint for the same matches |
| Pinnacle odds | In the feature store | Closing-line odds used for benchmark, with capture timestamps |
| Scorecards | `docs/audits/` | All mandatory scorecards (S5.2) |
| Gate check result | `docs/audits/` | Pass/fail for each condition (S6) with numerical evidence |
| Audit report | `docs/audits/` | Formal audit report (S7.1 Step 3) |

### S11.3 Immutability

Once an evaluation is completed and its artifacts are persisted:

1. The artifacts must not be modified retroactively.
2. If an error is discovered in the evaluation (e.g., a bug in the metric computation), a new evaluation is conducted and a correction note is appended to the original artifacts. The original artifacts are not overwritten.
3. All artifacts follow the project's audit persistence rules (documented in `CLAUDE.md`).

### S11.4 Evaluation Naming Convention

Formal evaluations are named: `NEXUS-eval-{YYYY-MM-DD}-{scope}` where:
- `YYYY-MM-DD` is the date the evaluation was executed.
- `scope` is the evaluation scope (e.g., `promotion-gate`, `monthly-review`, `league-expansion-SA`).

Example: `NEXUS-eval-2026-06-15-promotion-gate`

---

## S12. Invariants

The following invariants must hold for every evaluation. Violation of any invariant invalidates the evaluation results.

1. **Temporal separation.** No match in the evaluation period appears in any training set used by the engine being evaluated. This includes: Elo training data, Track 3 training data, ensemble weight training data, and calibration training data. Enforced by NEXUS-0 S8.

2. **Anti-circular market usage.** Odds must never serve as a training target or calibration target in the same period in which they are used as a feature. The evaluation comparison (RPS of NEXUS vs RPS of Pinnacle) is computed against realized match outcomes, not against market probabilities, and is therefore not circular even when Track 4 uses Pinnacle odds as a feature. See S1.2 for the full rationale.

3. **Necessary conjunction of gate conditions.** All conditions in S6 are necessary for promotion. No subset of conditions is sufficient. There is no override mechanism, no emergency exception, and no "executive decision" that bypasses the gate.

4. **V3 preservation during observation.** V3 must remain deployable and unmodified throughout the observation period (S8.4). V3 cannot be removed before the observation period completes without a demotion trigger.

5. **Quantitative decision basis.** Every promotion or demotion decision has an ADR (Architecture Decision Record) with numerical evidence. Subjective assessments ("it feels better") are not evidence.

6. **Evaluation immutability.** A completed evaluation's results are not retroactively modified. Corrections produce new evaluations, not modified old ones.

7. **No evaluation on training data.** The evaluation metrics computed for a model must come from data that the model did not train on. This is a restatement of invariant 1, emphasized because violations of this invariant are the single most common source of misleading evaluation results in predictive modeling.

8. **No-double-counting across origin slices.** Ningun partido puede aparecer en mas de un slice de origen.
   - Si un partido pertenece a `live_shadow`, no puede contar en `historical_walk_forward`.
   - El `combined` se construye como union disjunta de los dos slices.
   - Inflar `combined` mediante duplicacion de partidos es un error de evaluacion, no una diferencia de metodologia.
   - Todo informe de evaluacion debe incluir las cardinalidades de los tres slices. Si `combined != historical_walk_forward + live_shadow`, el informe es invalido.

---

## S13. What This Document Is NOT

1. **Not a model specification.** How tracks compute predictions, how the ensemble combines them, and how calibration works are defined in the model-taxonomy-and-ensemble subdocument. This document assumes those specifications exist and evaluates their output.

2. **Not a feature store specification.** How data is stored, queried, and governed is defined in NEXUS-0. This document assumes data is available per NEXUS-0's rules and evaluates predictions made from that data.

3. **Not a market policy.** How market data is used as a model feature is defined in the market-signal-policy subdocument. This document uses market data only as an evaluation benchmark, subject to the anti-circular constraint (S1.2).

4. **Not a product roadmap.** This document does not define when NEXUS will be ready for promotion or when specific leagues will be expanded. It defines the criteria that must be met, not the timeline for meeting them.

5. **Not a monitoring system specification.** This document defines what metrics to track and what thresholds trigger actions. The implementation of monitoring dashboards, alerting, and automation is an engineering concern decided at Stage 3.

6. **Not a betting evaluation.** NEXUS is evaluated on forecasting quality (RPS, accuracy, calibration). There is no evaluation of profitability, yield, ROI, or any other betting-related metric. SportPulse is a sports attention dashboard, not a betting platform.

---

*End of NEXUS Evaluation and Promotion Framework specification.*
