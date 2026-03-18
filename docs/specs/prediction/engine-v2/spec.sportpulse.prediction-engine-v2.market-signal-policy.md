---
artifact_id: SPEC-SPORTPULSE-PREDICTION-ENGINE-V2-MARKET-SIGNAL-POLICY
title: "NEXUS Market Signal Policy Specification"
artifact_class: spec
status: DRAFT
version: 0.1.0
project: sportpulse
domain: prediction
slug: engine-v2-market-signal-policy
owner: team
created_at: 2026-03-18
updated_at: 2026-03-18
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-PREDICTION-ENGINE-V2-MASTER
  - SPEC-SPORTPULSE-PREDICTION-ENGINE-V2-NEXUS-0
  - SPEC-SPORTPULSE-PREDICTION-ENGINE-V2-ENTITY-IDENTITY
canonical_path: docs/specs/prediction/engine-v2/spec.sportpulse.prediction-engine-v2.market-signal-policy.md
---

# NEXUS Market Signal Policy Specification

**Version:** 0.1-DRAFT
**Status:** DRAFT -- pending review
**Scope:** Role, constraints, and governance of bookmaker-derived market signal within the NEXUS predictive engine
**Audience:** Architect, Backend, Data/ML, QA
**Parent document:** `spec.sportpulse.prediction-engine-v2.master.md` (S6.5)

---

## Table of Contents

- S1. Purpose
- S2. Permitted Roles of the Market in NEXUS
- S3. Source Hierarchy for Odds
- S4. Eligibility Conditions by Role
- S5. Leagues with Insufficient Odds Coverage
- S6. Temporal Horizon of Market Data
- S7. De-Vigging Policy
- S8. Anti-Circular Separation of Roles
- S9. MARKET_WEIGHT in V3 vs Learned Weights in NEXUS
- S10. Invariants
- S11. What This Document Is NOT

---

## S1. Purpose

### S1.1 Why a Formal Market Policy

Bookmaker odds are the most informationally dense public signal about match outcomes. Pinnacle's closing line on major European leagues represents the aggregated opinion of the sharpest bettors and the bookmaker's own models. For the three NEXUS target leagues (PD, PL, BL1), Pinnacle closing odds typically achieve an RPS of approximately 0.185-0.188 -- the de facto efficiency frontier for public forecasting.

This informational density creates a design tension: using market signal correctly can substantially improve forecasting accuracy, but using it incorrectly introduces circular evaluation, data leakage, or architectural fragility where the engine becomes a thin wrapper around the market rather than an independent forecaster.

This document resolves that tension by defining exactly what the market can and cannot do within NEXUS. Every use of market-derived data must conform to a permitted role and satisfy the eligibility conditions defined here.

### S1.2 The Central Question

> **Is the market a benchmark, a feature, an anchor, or some combination -- and under what constraints?**

The answer is: a controlled combination of benchmark and feature, with explicit prohibitions on its use as a calibration anchor. Each role is defined in S2 with its conditions and boundaries.

### S1.3 Relationship to Edge Separation

The master specification (S7) defines three types of edge: forecasting, market (CLV), and execution. This document operates entirely within the forecasting edge domain. The market signal enters NEXUS as informational input that may improve probability estimation. Whether this improvement translates into CLV or execution edge is outside the scope of NEXUS and of this document.

---

## S2. Permitted Roles of the Market in NEXUS

The market may serve exactly four roles within NEXUS. Each role has distinct semantics, data requirements, and constraints. No other use of market data is permitted.

### S2.1 Role 1: Benchmark for Evaluation (Always Permitted)

**Description:** Pinnacle closing-line implied probabilities serve as the reference against which NEXUS's forecasting accuracy is measured. The primary evaluation metric is:

```
RPS(NEXUS) vs RPS(Pinnacle closing)
```

Where RPS is Ranked Probability Score computed against realized match outcomes (1X2).

**Why this role is always permitted:** Benchmarking does not feed information into the model. It is a post-hoc comparison that measures how close NEXUS's probability estimates are to the market's, relative to the true outcome. RPS is always computed against realized match outcomes -- both NEXUS and Pinnacle are measured against the same ground truth. This comparison is not circular even when Track 4 uses Pinnacle odds as a feature, because the evaluation target is the match result, not the odds themselves. The market is not an input to evaluation; it is a yardstick.

**The only hard prohibition:** Odds must never be used as a **training target or calibration target** in the same period in which they are used as a feature. See S8 for the full anti-circular policy.

### S2.2 Role 2: Feature in the Meta-Ensemble (Permitted with Conditions)

**Description:** Pinnacle closing-line implied probabilities (de-vigged) may enter the NEXUS meta-ensemble as the output of Track 4 (Market Signal), as defined in the master specification S5.4. In this role, the market is one of several tracks whose outputs are combined by the meta-ensemble. The weight assigned to Track 4 is learned, not fixed.

**Conditions for this role to be active:**

1. **Source restriction:** Only Pinnacle (PSH/PSD/PSA) or Bet365 (B365H/B365D/B365A) closing odds are eligible. No aggregated "average odds" from low-quality bookmakers. Rationale: Pinnacle's low margin and sharp-money exposure make it the most informationally efficient market. Bet365 is an acceptable fallback due to wide coverage, though its overround is higher.

2. **Temporal policy:** Track 4 uses the latest available odds snapshot with `effectiveAt < buildNowUtc`. The confidence assigned to the odds depends on the time between capture and kickoff:
   - Captured within 24h of kickoff: `confidence: HIGH` (closing line or near-closing line).
   - Captured between 24h and 72h before kickoff: `confidence: MEDIUM`.
   - Captured more than 72h before kickoff: `confidence: LOW` -- Track 4 weight is degraded in the meta-ensemble.
   - No snapshot available: Track 4 is deactivated for this match.
   See S6 for the full temporal policy.

3. **Coverage threshold:** For a given league and season, Track 4 is active only if closing-line odds from Pinnacle or Bet365 are available for at least 80% of matches. Below this threshold, the market feature is too sparse to learn reliable weights, and Track 4 is deactivated for that league-season. See S5.

4. **De-vigging requirement:** Raw odds are never used directly. All market probabilities are de-vigged before entering the meta-ensemble. See S7.

### S2.3 Role 3: Line Movement as Signal (Future, Conditioned)

**Description:** The difference between opening odds and closing odds (line movement) indicates where informed money entered the market. A significant move toward one outcome suggests that sharp bettors have information not yet reflected in public models.

**Current status:** Reserved for future implementation. This role requires a validated historical source of opening-line odds, which is not currently available in SportPulse's data pipeline. The football-data.co.uk dataset provides closing odds only.

**Activation condition:** This role is activated only when:

1. A validated source of opening-line odds for Pinnacle or Bet365 is integrated into the data pipeline.
2. The source provides opening odds captured at least 48 hours before kickoff for >= 70% of matches in the target leagues.
3. A dedicated feature (`lineMovementHome`, `lineMovementDraw`, `lineMovementAway`) is defined, versioned in the feature schema, and tested against historical data before being added to Track 3 or Track 4.

**Architectural provision:** The feature store schema (NEXUS-0) and the Track 3 feature vector must be designed to accept line movement features without structural changes. The feature is defined as absent until the activation condition is met.

### S2.4 Role 4: Calibration Anchor (Prohibited)

**Description:** Using market implied probabilities as the target distribution against which NEXUS's raw outputs are calibrated (e.g., training an isotonic calibrator to map NEXUS probabilities to market probabilities).

**Why this is prohibited:** Calibrating against the market creates a circular dependency. If NEXUS's outputs are adjusted to match the market, then:

- Evaluating NEXUS against the market becomes meaningless (the calibration forces agreement).
- NEXUS loses its independent forecasting identity -- it becomes a noisy version of the market rather than an alternative view.
- Any market inefficiency that NEXUS's models might capture is erased by the calibration step.

**The correct calibration target is realized outcomes** (1X2 results), not market probabilities. The model-taxonomy-and-ensemble subdocument (S8) defines the calibration methodology.

**Exception:** It is permissible to use market implied probabilities as a diagnostic tool -- e.g., plotting NEXUS probabilities vs. market probabilities to identify systematic biases. But this diagnostic use must not feed back into the pipeline as a calibration step.

---

## S3. Source Hierarchy for Odds

### S3.1 Precedence Order

When multiple bookmaker odds are available for the same match, the following hierarchy determines which source is used:

| Precedence | Source | Identifier in football-data.co.uk | Notes |
|------------|--------|----------------------------------|-------|
| 1 (highest) | Pinnacle | `PSH`, `PSD`, `PSA` | Most efficient market. Lowest overround (~2%). Preferred for both feature and benchmark roles. |
| 2 | Bet365 | `B365H`, `B365D`, `B365A` | Wide coverage. Higher overround (~5-8%). Used when Pinnacle is unavailable. |
| 3 | Market maximum | `MaxH`, `MaxD`, `MaxA` | Maximum odds across all bookmakers. Higher variance. Used only as tertiary fallback. |
| 4 | Market average | `AvgH`, `AvgD`, `AvgA` | Average across all bookmakers. Smooths individual bookmaker quirks but introduces overround bias. Last resort. |

### S3.2 Source Assignment

Each match's market data carries an `oddsSource` field indicating which source was used:

| Value | Meaning |
|-------|---------|
| `'pinnacle'` | Pinnacle closing odds used. |
| `'bet365'` | Bet365 closing odds used (Pinnacle unavailable). |
| `'market_max'` | Market maximum used (Pinnacle and Bet365 unavailable). |
| `'market_avg'` | Market average used (all preferred sources unavailable). |
| `'unknown'` | No odds data available for this match. |

### S3.3 No Imputation

When no odds are available for a match (`oddsSource: 'unknown'`), the market signal is absent. Track 4 is deactivated for that match. The meta-ensemble redistributes Track 4's weight to the remaining tracks. The market probability is never imputed with:

- The league-average market probability.
- The historical average of odds for the home team.
- Any synthetic estimate.

The absence of market data is a legitimate state that the meta-ensemble is trained to handle.

---

## S4. Eligibility Conditions by Role

### S4.1 Eligibility for Role 2 (Feature in Meta-Ensemble)

A match's market data is eligible as a meta-ensemble feature (Track 4 input) when all of the following conditions are met:

| Condition | Requirement |
|-----------|-------------|
| Source | `oddsSource` is `'pinnacle'` or `'bet365'`. |
| League coverage | The league-season has >= 80% match coverage from the specified source. |
| De-vigging | Implied probabilities have been de-vigged per S7. |
| Temporal | An odds snapshot with `effectiveAt < buildNowUtc` exists. Confidence assigned per S2.2 temporal policy (HIGH/MEDIUM/LOW based on capture-to-kickoff distance). |
| Well-formedness | Raw implied probability sum (before de-vigging) is within `[1.00, 1.15]`. |
| Operating mode | The match is not excluded by the operating mode (`NOT_ELIGIBLE`). |

If any condition fails, Track 4 is deactivated for that match.

### S4.2 Eligibility for Role 1 (Benchmark)

A match's market data is eligible as an evaluation benchmark when all of the following conditions are met:

| Condition | Requirement |
|-----------|-------------|
| Source | `oddsSource` is `'pinnacle'` only. Bet365 is excluded from benchmarking because its asymmetric overround introduces systematic bias in RPS comparison. |
| De-vigging | Implied probabilities have been de-vigged per S7. |
| Well-formedness | Raw implied probability sum is within `[1.00, 1.15]`. Sum outside this range indicates data quality issues (stale odds, data error). |
| Anti-circular | The same odds snapshot was not used as both a training feature and a training/calibration target in the same training period. See S8. |

Matches that fail benchmark eligibility are excluded from the **Pinnacle benchmark subset** (NEXUS vs Pinnacle comparison) but remain in the **full evaluation sample** (NEXUS vs V3, NEXUS vs naive baseline). The evaluation scorecards report two populations: the full sample (all evaluable predictions) and the Pinnacle benchmark subset (only predictions with eligible Pinnacle odds). The evaluation report must state the size of each population and the number of matches excluded from the Pinnacle subset and the reasons.

---

## S5. Leagues with Insufficient Odds Coverage

### S5.1 Coverage Assessment

Odds coverage is assessed per league per season. The metric is:

```
coverage(league, season, source) = count(matches with oddsSource = source) / count(total matches in season)
```

Coverage is computed at the start of each evaluation window and rechecked monthly.

### S5.2 Thresholds and Consequences

| Coverage level | Consequence for Track 4 (feature) | Consequence for benchmark |
|---------------|----------------------------------|--------------------------|
| >= 80% Pinnacle | Track 4 active with Pinnacle odds. | Benchmark active with Pinnacle odds. |
| >= 80% Bet365 (Pinnacle < 80%) | Track 4 active with Bet365 odds. | Benchmark not active (Bet365 excluded from benchmark). |
| < 80% any single source | Track 4 deactivated for this league-season. Meta-ensemble operates with Tracks 1-3 only. | Benchmark not active. League not eligible for market-relative evaluation. |

### S5.3 Per-Season, Not Global

Coverage is evaluated per season, not across all historical data. A league that had 90% Pinnacle coverage in 2023-24 but only 60% in 2024-25 has Track 4 deactivated for the 2024-25 season specifically.

### S5.4 Current Coverage Assessment (as of 2026-03)

Based on football-data.co.uk historical data:

| League | Pinnacle coverage (2024-25) | Bet365 coverage (2024-25) | Track 4 status |
|--------|---------------------------|--------------------------|---------------|
| PD (LaLiga) | ~95% | ~98% | Active (Pinnacle) |
| PL (Premier League) | ~96% | ~99% | Active (Pinnacle) |
| BL1 (Bundesliga) | ~93% | ~97% | Active (Pinnacle) |

These figures are approximate and must be verified during implementation.

---

## S6. Temporal Horizon of Market Data

### S6.1 Latest Available Odds Snapshot (for Feature Role)

For Role 2 (feature in meta-ensemble), Track 4 uses the **latest available odds snapshot** with `effectiveAt < buildNowUtc`. "Closing line" is the specific case where this snapshot was captured within 24h of kickoff.

**Confidence by capture horizon:**

| Capture distance from kickoff | Confidence | Ensemble behavior |
|------------------------------|-----------|-------------------|
| < 24h | `HIGH` | Track 4 operates at full learned weight. |
| 24h - 72h | `MEDIUM` | Track 4 operates at full learned weight (the meta-ensemble's per-horizon segmentation accounts for information quality). |
| > 72h | `LOW` | Track 4 weight is degraded -- the meta-ensemble applies the `FAR` horizon weight vector, which empirically assigns lower weight to stale market data. |
| No snapshot available | N/A | Track 4 deactivated for this match. Weight redistributed. |

**Rationale:** The closing line incorporates the maximum amount of information from the market. Earlier snapshots reflect an earlier information state and are systematically less accurate. However, even stale odds carry signal (the market's prior estimate of match probabilities) and are preferable to no market data at all. The meta-ensemble's per-horizon weight segmentation handles the degradation naturally.

### S6.2 Relationship to buildNowUtc

Market odds are features in NEXUS-0 and therefore subject to the as-of constraint:

```
odds.effectiveAt < buildNowUtc
```

This means:

- For a prediction made 24 hours before kickoff, the latest available odds at that moment are used. These may be mid-week odds, not the closing line.
- For a prediction made 1 hour before kickoff, the most recent odds available (likely close to the closing line) are used.
- The "closing line" label applies to the most recent odds satisfying the as-of constraint, which may not literally be the final closing line if the prediction is made before the market closes.

### S6.3 No Interpolation

Odds are never interpolated between snapshots. If the system has an odds snapshot from 48 hours before kickoff and another from 2 hours before kickoff, a prediction at `buildNowUtc = kickoffUtc - 12h` uses the 48-hour snapshot (the most recent one satisfying `effectiveAt < buildNowUtc`). No linear interpolation, no averaging.

### S6.4 Opening Line (Reserved for Role 3)

Opening-line odds (the earliest odds published for a match, typically 3-7 days before kickoff) are not currently ingested. When they become available (see S2.3), they will carry their own `effectiveAt` and will be subject to the same as-of constraint. The difference between opening and closing lines will constitute the line movement feature.

---

## S7. De-Vigging Policy

### S7.1 Why De-Vigging Is Mandatory

Raw bookmaker odds include a margin (overround or "vig"). For Pinnacle, this is approximately 2% on major-league 1X2 markets. For Bet365, it is approximately 5-8%. Raw implied probabilities (1/odds) sum to more than 1.0, which means they are not true probabilities.

Using raw implied probabilities as features or benchmarks introduces a systematic bias proportional to the overround. De-vigging removes this bias, producing well-formed probability distributions that sum to 1.0.

### S7.2 Method: Proportional Normalization

The de-vigging method is proportional normalization (also known as the basic method):

```
rawImplied_i = 1 / odds_i          (for i in {home, draw, away})
overround = sum(rawImplied_i) - 1
devigged_i = rawImplied_i / sum(rawImplied_i)
```

This method is chosen for:

1. **Simplicity and determinism.** No iterative solver, no convergence criteria.
2. **Adequate accuracy for NEXUS's needs.** More sophisticated methods (Shin's method, power method, margin-proportional-to-odds) produce marginally different results but add computational complexity without meaningful improvement in forecasting when the overround is small (Pinnacle ~2%).
3. **Consistency with V3.** V3's `market-blend.ts` uses the same normalization.

### S7.3 Validation After De-Vigging

After de-vigging, the following must hold:

```
abs(devigged_home + devigged_draw + devigged_away - 1.0) < 1e-9
devigged_i >= 0 for all i
devigged_i <= 1 for all i
```

If the raw odds produce an implied probability sum outside `[1.00, 1.15]`, the de-vigging result is suspect (data quality issue). Such matches are flagged with `oddsQuality: 'SUSPECT'` and excluded from both feature and benchmark roles.

### S7.4 De-Vigging Is Always Applied

There is no code path where raw odds (or raw implied probabilities without de-vigging) enter the meta-ensemble, Track 4, or the evaluation framework. De-vigging is a mandatory transformation step, not an optional enhancement.

---

## S8. Anti-Circular Separation of Roles

### S8.1 The Circularity Risk

The market serves two roles in NEXUS: feature (Role 2) and benchmark (Role 1). The actual circularity risk is narrow but critical:

- **Not circular:** Comparing RPS of NEXUS vs RPS of Pinnacle against realized outcomes. Both are independent forecasters measured against the same ground truth.
- **Circular (prohibited):** Using odds as a training label/target for calibration or weight-learning. This would reward the model for copying the market during training, penalize genuine divergence, and make the calibration step meaningless.
- **Circular (prohibited):** Using the same odds snapshot as both a feature in the training set and a target for the same training run.

### S8.2 Separation Rules

The following rules prevent circularity:

#### Rule 1: RPS Is Always Computed Against Realized Outcomes

The evaluation metric (RPS) is always computed against actual match results (1X2 outcomes), never against market implied probabilities. The comparison "RPS of NEXUS vs RPS of Pinnacle" compares two independent forecasters against the same realized outcomes. This is not circular even when Track 4 uses Pinnacle odds as a feature, because the evaluation target is the match result, not the odds.

#### Rule 2: No Same Odds Snapshot as Training Feature AND Training/Calibration Target

The hard invariant: the same odds snapshot must not simultaneously serve as a feature in the training dataset AND as a label/target for calibration or weight-learning in the same training period. Walk-forward temporal validation structurally prevents this: the training window precedes the evaluation window, and market data for future matches is not available during training.

#### Rule 3: Ablation for Measuring Independent Edge

When computing "how much does Track 4 contribute to NEXUS accuracy," the comparison must be NEXUS(without Track 4) vs. Pinnacle. This ablation is the true measure of NEXUS's independent forecasting edge, separate from the market signal contribution.

#### Rule 4: No Market as Calibration Target

Market probabilities are never used as the target variable for any calibration step. The calibration target is always the realized outcome (1X2 result). This rule is absolute and admits no exceptions. See S2.4.

### S8.3 Logging and Auditability

Every prediction's fingerprint (NEXUS-0 S9.2) includes:

- `marketDataUsed: boolean` -- whether Track 4 was active for this prediction.
- `oddsSource: string` -- which bookmaker's odds were used.
- `oddsEffectiveAt: string` -- the timestamp of the odds snapshot used.

This metadata enables post-hoc verification that no circularity occurred.

---

## S9. MARKET_WEIGHT in V3 vs Learned Weights in NEXUS

### S9.1 V3 Approach (Current Production)

V3 uses a fixed constant `MARKET_WEIGHT = 0.65` (in `packages/prediction/src/engine/constants.ts`) to blend market implied probabilities with the Poisson model's probabilities. This blend occurs at a fixed point in the pipeline (`market-blend.ts`), before the ensemble combinator. The ensemble combinator then applies its own fixed weights (`w_poisson=0.80, w_market=0.15, w_logistic=0.05`).

The effective market influence in V3 is a function of both `MARKET_WEIGHT` (pre-ensemble blend) and `w_market` (ensemble weight). The total contribution of market signal to V3's output is not a single number but a compound of two stages.

**Limitations of V3's approach:**

1. `MARKET_WEIGHT` is a global constant. It does not vary by league, horizon, or data quality.
2. The optimal value was found by grid search over a single dataset (PD/PL/BL1 2024-25). It may not generalize.
3. The two-stage blending (pre-ensemble + in-ensemble) makes the effective market weight opaque and hard to reason about.

### S9.2 NEXUS Approach

NEXUS eliminates the two-stage blend. Market signal enters the meta-ensemble as Track 4 -- a first-class track alongside Tracks 1-3. The meta-ensemble assigns a single learned weight to Track 4 that is:

- **Per-league.** LaLiga, Premier League, and Bundesliga may have different optimal market weights due to differences in market efficiency, data availability, and model accuracy for each league.
- **Per-horizon.** Predictions made far from kickoff (`FAR`, >48h), where confirmed lineups and fresh odds are unavailable, may rely differently on market signal than near-kickoff predictions (`NEAR`, <24h) where the market has incorporated the latest information.
- **Per-data-quality-tier.** When other data sources (xG, absences) are incomplete, the market may carry more weight. When all sources are available, the model's own tracks may be more informative than the market.

### S9.3 Ontological Continuity

The NEXUS learned weights and V3's `MARKET_WEIGHT` are not ontologically different. Both answer the question: "how much should the final probability estimate be influenced by the market?" The difference is granularity:

| Dimension | V3 | NEXUS |
|-----------|-----|-------|
| Per-league | No (single global constant) | Yes (per-league weight vector) |
| Per-horizon | No | Yes (3 horizon buckets) |
| Per-data-quality | No | Yes (3 quality tiers) |
| Learning method | Grid search (single pass) | Walk-forward optimization (continuous) |
| Transparency | Opaque (two-stage blend) | Direct (single weight per segment) |

### S9.4 Constraint on Market Weight

The meta-ensemble imposes no minimum or maximum weight on Track 4 beyond the general constraints (all weights non-negative, sum to 1.0). However, the master specification (S5.5) imposes a minimum weight of 0.20 on Track 1+2 combined (Structural/Ratings + Goals Model) to prevent degenerate solutions where the meta-ensemble collapses to a pure market pass-through.

If the learned weight for Track 4 approaches 1.0 (which would mean the meta-ensemble is simply copying the market), this is a diagnostic signal that the other tracks are not contributing value. The response is to improve the other tracks, not to artificially cap Track 4's weight.

---

## S10. Invariants

The following invariants must hold at all times. Violation of any invariant is a severity-CRITICAL bug.

1. **Anti-circular evaluation.** RPS is always computed against realized match outcomes, not against market probabilities. The same odds snapshot must not serve as both a training feature AND a calibration/training target in the same training period. Forward validation compares NEXUS and Pinnacle as two forecasters against the same real outcomes. Ablation evaluation removes Track 4 to measure independent forecasting edge. See S8.2.

2. **Exclusion of unknown odds.** Matches with `oddsSource: 'unknown'` are excluded from both the meta-ensemble Track 4 input and the market-relative benchmark. No imputation, no synthesis.

3. **Weight traceability.** The meta-ensemble weights assigned to Track 4 are versioned, stored, and reproducible. Given an `ensembleVersion`, the exact weight vector (including Track 4's weight per league-horizon-quality segment) can be retrieved and applied deterministically.

4. **Mandatory de-vigging.** Raw bookmaker odds or raw implied probabilities (summing to more than 1.0) never enter any model, track, or evaluation as probability inputs. De-vigging (S7) is always applied first.

5. **Line movement reservation.** Opening-to-closing line movement (Role 3, S2.3) is architecturally anticipated but cannot be implemented or activated until a validated source of historical opening lines is integrated. No feature named `lineMovement*` may carry non-null values until the activation conditions in S2.3 are satisfied.

6. **No market calibration.** Market implied probabilities are never used as the target distribution for calibration, whether isotonic, Platt scaling, or any other calibration methodology. The calibration target is always the realized match outcome. See S2.4.

7. **Source precedence stability.** The source hierarchy (S3.1) is a fixed configuration. Runtime conditions (e.g., one bookmaker's feed being temporarily down) may cause fallback to a lower-precedence source, but the precedence order itself does not change without a versioned spec update.

8. **Coverage re-evaluation.** The coverage assessment (S5) is re-evaluated at minimum once per season for each target league. A league's Track 4 activation status may change between seasons but not mid-season (to avoid introducing weight instability from changing the track set during evaluation).

---

## S11. What This Document Is NOT

1. **Not a calibration specification.** How NEXUS calibrates its probability outputs is governed by the model-taxonomy-and-ensemble subdocument (S8). This document prohibits calibrating against the market (S2.4) but does not define the correct calibration methodology.

2. **Not an entity identity specification.** How players, teams, and coaches are identified is governed by the entity-identity-and-resolution subdocument (master S6.2).

3. **Not a temporal feature specification.** How market odds are stored, timestamped, and queried with as-of semantics is governed by NEXUS-0 (`spec.sportpulse.prediction-engine-v2.nexus-0-temporal-feature-store.md`). This document defines what market data means and how it may be used; NEXUS-0 defines how it is stored and retrieved.

4. **Not a Closing Line Value (CLV) specification.** CLV is a downstream observation of forecasting edge (master S7.2), not a design target. This document does not define how to compute CLV, track CLV over time, or optimize for CLV. NEXUS optimizes probability accuracy; CLV follows (or does not) as a consequence.

5. **Not a betting or execution specification.** SportPulse is a sports attention dashboard, not a betting platform. Market data is used within NEXUS for probability estimation and evaluation. No part of this document defines, encourages, or facilitates the execution of bets.

6. **Not a data pipeline specification.** This document defines the semantics and policy of market data usage. The implementation of odds ingestion, storage, and transformation is determined at Stage 3.

---

*End of NEXUS Market Signal Policy specification.*
