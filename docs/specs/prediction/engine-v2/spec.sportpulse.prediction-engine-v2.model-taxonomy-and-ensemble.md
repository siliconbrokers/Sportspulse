---
artifact_id: SPEC-SPORTPULSE-PREDICTION-ENGINE-V2-MODEL-TAXONOMY-AND-ENSEMBLE
title: "NEXUS Model Taxonomy and Ensemble Specification"
artifact_class: spec
status: DRAFT
version: 0.1.0
project: sportpulse
domain: prediction
slug: engine-v2-model-taxonomy-and-ensemble
owner: team
created_at: 2026-03-18
updated_at: 2026-03-18
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-PREDICTION-ENGINE-V2-MASTER
  - SPEC-SPORTPULSE-PREDICTION-ENGINE-V2-NEXUS-0
  - SPEC-SPORTPULSE-PREDICTION-ENGINE-V2-EVALUATION-AND-PROMOTION
  - SPEC-SPORTPULSE-PREDICTION-ENGINE-V2-MARKET-SIGNAL-POLICY
canonical_path: docs/specs/prediction/engine-v2/spec.sportpulse.prediction-engine-v2.model-taxonomy-and-ensemble.md
---

# NEXUS Model Taxonomy and Ensemble Specification

**Version:** 0.1-DRAFT
**Status:** DRAFT -- pending review
**Scope:** Track definitions, meta-ensemble architecture, feature schema, output contract, and versioning for the NEXUS predictive engine
**Audience:** Architect, Backend, Data/ML, QA
**Parent document:** `spec.sportpulse.prediction-engine-v2.master.md` (S6.3)

---

## Table of Contents

- S1. Purpose and Boundary
- S2. Principle of Model Family
- S3. Track 1 -- Structural/Ratings Model
- S4. Track 2 -- Goals Model
- S5. Track 3 -- Tabular Discriminative Model
- S6. Track 4 -- Market Signal
- S7. Meta-Ensemble
- S8. Calibration
- S9. Operating Modes
- S10. Output Contract
- S11. Versioning
- S12. Invariants
- S13. What This Document Is NOT

---

## S1. Purpose and Boundary

### S1.1 What This Document Defines

This document is the detailed specification for the NEXUS model family. It defines:

1. The formal specification of each track (Tracks 1 through 4) -- purpose, method, inputs, outputs, degradation behavior, and versioning.
2. The meta-ensemble architecture -- how track outputs are combined into a single prediction.
3. The feature schema for Track 3 -- which features are eligible, which are excluded, and how the schema is versioned.
4. The calibration pipeline -- how raw ensemble output is adjusted to produce calibrated probabilities.
5. The operating modes -- under what conditions each track is active or degraded.
6. The output contract -- the shape of the final prediction and its relationship to V3's output contract.

### S1.2 Boundary with Other Subdocuments

| Concern | Governing document |
|---------|-------------------|
| What data is available and when | NEXUS-0: Temporal Feature Store |
| How entities are identified and resolved | Entity Identity and Resolution |
| How the market signal is governed | Market Signal Policy |
| How predictions are evaluated and how NEXUS is promoted | Evaluation and Promotion |
| High-level architecture and coexistence with V3 | Master Specification |

This document defines how models compute and combine predictions. It does NOT define what data is available (NEXUS-0), how predictions are evaluated for promotion (Evaluation and Promotion), or the specific governance rules for market data (Market Signal Policy). When this document references data availability or market behavior, it defers to the governing subdocument.

### S1.3 Relationship to V3

NEXUS inherits several components from V3 (Elo ratings, bivariate Poisson, isotonic calibration). Where NEXUS extends or modifies V3 behavior, this document states the extension explicitly. Where NEXUS preserves V3 behavior unchanged, the V3 spec (`spec.sportpulse.prediction.engine.md` v1.3) remains the authoritative reference for the inherited behavior.

---

## S2. Principle of Model Family

### S2.1 NEXUS Is Not a Single Model

NEXUS is a family of models with complementary outputs. Each member of the family (called a "track") addresses a distinct aspect of match prediction. No single track is the prediction -- the meta-ensemble is the prediction.

This design reflects three empirical observations from V3 development:

1. The Poisson model captures expected goal rates well but cannot represent contextual signals (form asymmetries, schedule congestion, competitive stakes).
2. The market signal captures aggregate wisdom but is not always available and its quality varies by league and time-to-kickoff.
3. A discriminative model over contextual features can capture nonlinear interactions that parametric models miss, but only when the feature set is rich enough.

No single approach dominates across all matches, leagues, and prediction horizons. The family approach allows each track to contribute where it is strongest.

### S2.2 Independence of Tracks

Each track produces a 1X2 probability distribution independently. The tracks do not communicate during inference. Track 3 receives Track 1's strength estimates as input features (not as probability distributions), but this is a feed-forward dependency, not bidirectional communication.

The meta-ensemble is the only component that sees all track outputs simultaneously. This separation ensures that each track can be developed, tested, and versioned independently.

### S2.3 No Track Has Absolute Authority

The ensemble is the prediction. No individual track's output is ever surfaced to end users or used for evaluation without passing through the ensemble. If a track produces degenerate output (e.g., p_draw = 0.0), the ensemble dilutes it with the other tracks' outputs. If a track is unavailable, the ensemble redistributes its weight.

---

## S3. Track 1 -- Structural/Ratings Model

### S3.1 Purpose

Track 1 estimates the current relative strength of each team participating in a match. It produces strength estimates that are consumed by Track 2 (to parameterize goal rates) and by Track 3 (as base features in the discriminative model).

Track 1 does NOT produce 1X2 probabilities directly. Its output is a structured strength assessment, not a match outcome prediction.

### S3.2 Method

Track 1 uses a modified Elo system with Dixon-Coles correction, inherited from V3 and extended with three capabilities.

**Inherited from V3 (unchanged):**

- Bidirectional Elo with separate attack and defense ratings per team.
- Exponential time decay (`DECAY_XI`) weighting recent results more heavily.
- League prior shrinkage for teams with limited history.
- Cross-season carry-over with configurable decay.
- xG integration: when available, xG supplements or replaces actual goals in rating updates, weighted by `XG_WEIGHT`.

**Extension 1: Dynamic Home Advantage**

V3 uses a single multiplicative factor for home advantage, either computed dynamically as the ratio of league-average home goals to league-average away goals, or overridden per-league via `HOME_ADV_MULT_PER_LEAGUE`.

NEXUS Track 1 replaces this with a trending home advantage per team per season:

1. Compute each team's home performance ratio (goals scored at home / expected goals at home from the base model) over a rolling window of the last N home matches (configurable, default N = 8).
2. Blend the team-specific ratio with the league-wide ratio using a shrinkage parameter. Teams with fewer home matches rely more on the league prior.
3. For neutral-venue matches (identified by the `neutral` flag in the canonical match data), set home advantage to 1.0 (no advantage).

The dynamic home advantage is recomputed at each `buildNowUtc` using only data satisfying the as-of constraint (NEXUS-0 S3.2).

**Extension 2: Injury-Adjusted Team Strength**

V3 applies a post-hoc multiplicative penalty to lambdas via `absence-adjustment.ts`. NEXUS integrates player availability into the strength model itself:

1. For each team, maintain a baseline squad strength derived from the team's Elo when playing with its typical lineup.
2. When the feature store provides a confirmed lineup (from NEXUS-0 S6.2.4, `confidence` HIGH or MEDIUM): use the confirmed starting XI as the base for the absence adjustment. The penalization compares the confirmed lineup against the team's habitual starters to identify missing regulars and compute the strength reduction.
3. When confirmed lineup is NOT available: use the baseline squad minus confirmed absences (injuries/suspensions with `confidence >= MEDIUM` from NEXUS-0 S6.2.3). The confirmed lineup is never predicted or inferred -- if it does not exist, the adjustment operates solely from absence data.
4. For each confirmed absence with `confidence >= MEDIUM`:
   a. Retrieve the absent player's importance weight by positional group (GK, DEF, MID, FWD).
   b. Compute the strength adjustment as the weighted sum of absent player impacts, capped by a configurable maximum adjustment (`MAX_ABSENCE_ADJUSTMENT`, default 0.20 -- a 20% maximum reduction in effective team strength).
5. When absence data has `confidence = LOW` or is absent entirely, no adjustment is applied. The model uses the team's baseline Elo without modification.
6. When entity resolution for a player is `UNRESOLVED` or `CONFLICTED` (per entity-identity-and-resolution spec), that player's absence is excluded from the adjustment.

The importance weights per positional group are configurable per league. They are determined offline through historical analysis and are not learned in real time.

**Extension 3: Adaptive K-Factor**

V3 uses a fixed K-factor for Elo updates (modulated only by time decay). NEXUS introduces a K-factor that adapts to the competitive importance of the match:

| Match context | K-factor multiplier |
|--------------|-------------------|
| Season opener (matchday 1) | 1.2x (higher uncertainty early in season) |
| Mid-season (matchday 5-30) | 1.0x (baseline) |
| Final 8 matchdays | 0.9x (ratings should be stable by now -- large swings are likely noise) |
| Relegation / title-deciding match | 1.1x (high motivation can produce non-typical results, worth capturing) |

The multipliers are configurable per league. The `matchday` and competitive context are derived from canonical competition data.

### S3.3 Inputs

| Input | Source | Required? |
|-------|--------|-----------|
| Historical match results (scores) | Canonical data via football-data.org | Yes -- without match history, the team is NOT_ELIGIBLE |
| xG per match (home and away) | Feature store (NEXUS-0), sourced from API-Football backfill or SofaScore | No -- when unavailable, actual goals are used as proxy |
| Player absence data | Feature store (NEXUS-0), sourced from API-Football or SofaScore | No -- when unavailable, baseline squad strength is used |
| Competition structure (matchday, stage) | Canonical competition data | Yes -- for K-factor adaptation |

### S3.4 Output

```typescript
interface Track1Output {
  eloHome: number;              // Effective Elo rating for home team (adjusted for absences)
  eloAway: number;              // Effective Elo rating for away team (adjusted for absences)
  expectedGoalsHome: number;    // Lambda (expected goals) for home team
  expectedGoalsAway: number;    // Lambda (expected goals) for away team
  homeAdvantage: number;        // Dynamic home advantage multiplier applied
  absenceAdjustmentHome: number; // Strength reduction applied to home team (0.0 if none)
  absenceAdjustmentAway: number; // Strength reduction applied to away team (0.0 if none)
  kFactorMultiplier: number;    // K-factor multiplier used for this match context
}
```

### S3.5 Degradation

| Missing data | Behavior |
|-------------|----------|
| No xG for team's history | Use actual goals as proxy. Log `XG_FALLBACK_ACTUAL_GOALS`. No change to operating mode. |
| No absence data | Use baseline squad strength. `absenceAdjustmentHome = 0.0`, `absenceAdjustmentAway = 0.0`. No change to operating mode. |
| Fewer than `THRESHOLD_NOT_ELIGIBLE` matches for a team | Track 1 cannot produce output. Match is NOT_ELIGIBLE. |
| Fewer than `THRESHOLD_ELIGIBLE` matches for a team | Track 1 produces output with wider confidence interval. Match is LIMITED_MODE. |

### S3.6 Version

`structuralModelVersion` -- bumped when any of the following change:

- Elo update formula or decay parameters.
- Home advantage computation method.
- Absence adjustment method or caps.
- K-factor adaptation rules.
- xG integration weights.

---

## S4. Track 2 -- Goals Model

### S4.1 Purpose

Track 2 translates the strength estimates from Track 1 into a joint distribution of goals scored by each team. From this distribution, 1X2 probabilities and all goal-based derived markets are computed.

### S4.2 Method

Bivariate Poisson with Dixon-Coles low-score correction, parameterized by:

- `lambda_home` = `Track1Output.expectedGoalsHome`
- `lambda_away` = `Track1Output.expectedGoalsAway`
- `rho` = per-liga correlation parameter

This is the same model as V3's Poisson pipeline. The key difference is the source of lambdas: V3 computes lambdas from team-aggregate statistics; NEXUS receives player-adjusted lambdas from Track 1.

### S4.3 Rho Parameter

The correlation parameter `rho` adjusts for the empirical observation that low-scoring outcomes (0-0, 1-0, 0-1, 1-1) occur at different frequencies than a pure independent Poisson model predicts.

- `rho` is computed per-liga through offline sweep over historical data.
- `rho` is NOT learned in real time or updated online.
- `rho` is updated periodically (e.g., at the start of each season) through a documented sweep procedure.
- Each `rho` value is versioned and traceable to the dataset window used for the sweep.

### S4.4 Scoreline Matrix

Track 2 produces a probability matrix P[i][j] where i = home goals (0..MAX_GOALS) and j = away goals (0..MAX_GOALS). The default `MAX_GOALS = 7`.

**Invariant:** The sum of all entries in P must be within [0.999, 1.001] before renormalization. After renormalization, the sum is exactly 1.0 (within floating-point precision, 1e-9).

If the pre-normalization sum falls outside [0.999, 1.001], this indicates a numerical issue in the Poisson computation and must be logged as `SCORELINE_SUM_VIOLATION`.

### S4.5 Derived Quantities

From the scoreline matrix, Track 2 derives:

| Output | Derivation |
|--------|-----------|
| `p_home` | Sum of P[i][j] where i > j |
| `p_draw` | Sum of P[i][j] where i == j |
| `p_away` | Sum of P[i][j] where i < j |
| `expectedGoalsHome` | Sum of i * P[i][j] for all i, j |
| `expectedGoalsAway` | Sum of j * P[i][j] for all i, j |
| `p_over_X` | Sum of P[i][j] where i + j > X, for each threshold X in {0.5, 1.5, 2.5, 3.5, 4.5} |
| `p_btts` | Sum of P[i][j] where i >= 1 and j >= 1 |
| `p_scoreline[i][j]` | The full matrix itself, for top-N scoreline predictions |

### S4.6 Output

```typescript
interface Track2Output {
  scorelineMatrix: number[][];   // P[i][j], dimensions (MAX_GOALS+1) x (MAX_GOALS+1)
  p_home: number;                // 1X2: home win probability
  p_draw: number;                // 1X2: draw probability
  p_away: number;                // 1X2: away win probability
  expectedGoalsHome: number;     // Expected goals from the scoreline distribution
  expectedGoalsAway: number;     // Expected goals from the scoreline distribution
  p_over: Record<string, number>; // Over/under thresholds
  p_btts: number;                // Both teams to score probability
  rhoUsed: number;               // The rho parameter applied
}
```

### S4.7 Degradation

Track 2 degrades only when Track 1 cannot produce output. If Track 1 outputs lambdas, Track 2 always produces a valid scoreline matrix. There are no independent degradation conditions for Track 2.

### S4.8 Version

`goalsModelVersion` -- bumped when any of the following change:

- Dixon-Coles correction formula.
- Renormalization method.
- `MAX_GOALS` parameter.
- Rho sweep methodology (not the rho values themselves -- value updates are a data change, not a model change).

---

## S5. Track 3 -- Tabular Discriminative Model

### S5.1 Purpose

Track 3 captures contextual signals that the parametric goals model (Track 2) cannot represent. These include form asymmetries, schedule congestion, competitive context, positional importance, and team-specific tendencies that emerge from the interaction of multiple features.

Track 3 is the primary mechanism by which NEXUS addresses the "static home advantage" and "no contextual awareness" limitations of V3 (master S4.2, S4.3).

### S5.2 Method

Logistic regression or gradient-boosted trees over a versioned feature vector. The choice of algorithm is an implementation decision (Stage 3); this specification constrains the feature schema, the anti-leakage discipline, and the output contract.

Both candidate algorithms must satisfy:

1. **Determinism:** Given the same input vector and model parameters, the output is identical.
2. **Explainability:** Feature importances (coefficients or SHAP values) must be extractable for debugging and auditing.
3. **Calibration compatibility:** The raw output probabilities must be suitable as input to the isotonic calibrator (S8).

### S5.3 Feature Schema

The feature schema defines which features are eligible inputs for Track 3. Each feature is identified by a name, a type, and the conditions under which it is included.

**Version:** The feature schema has its own version identifier (`featureSchemaVersion`). Adding, removing, or changing the semantics of any feature requires a schema version bump.

#### S5.3.1 Eligible Features

| Feature name | Type | Description | Source |
|-------------|------|-------------|--------|
| `eloHome` | `number` | Track 1 effective Elo for home team | Track 1 output |
| `eloAway` | `number` | Track 1 effective Elo for away team | Track 1 output |
| `eloDiff` | `number` | `eloHome - eloAway` | Derived from Track 1 |
| `restDaysHome` | `number` | Days since home team's last match | Feature store (NEXUS-0) |
| `restDaysAway` | `number` | Days since away team's last match | Feature store (NEXUS-0) |
| `matchesLast4WeeksHome` | `number` | Matches played by home team in last 28 days | Feature store (NEXUS-0) |
| `matchesLast4WeeksAway` | `number` | Matches played by away team in last 28 days | Feature store (NEXUS-0) |
| `tablePositionHome` | `number` | Home team's league table position at `buildNowUtc` | Feature store (NEXUS-0), derived |
| `tablePositionAway` | `number` | Away team's league table position at `buildNowUtc` | Feature store (NEXUS-0), derived |
| `competitiveImportance` | `enum` | Categorical: `TITLE_RACE`, `RELEGATION_BATTLE`, `MID_TABLE`, `NEUTRAL` | Feature store (NEXUS-0), derived |
| `injuryImpactHome_GK` | `number` | Aggregate absence impact for home team goalkeepers | Feature store (NEXUS-0), `confidence >= MEDIUM` |
| `injuryImpactHome_DEF` | `number` | Aggregate absence impact for home team defenders | Feature store (NEXUS-0), `confidence >= MEDIUM` |
| `injuryImpactHome_MID` | `number` | Aggregate absence impact for home team midfielders | Feature store (NEXUS-0), `confidence >= MEDIUM` |
| `injuryImpactHome_FWD` | `number` | Aggregate absence impact for home team forwards | Feature store (NEXUS-0), `confidence >= MEDIUM` |
| `injuryImpactAway_GK` | `number` | Same as above, for away team | Feature store (NEXUS-0), `confidence >= MEDIUM` |
| `injuryImpactAway_DEF` | `number` | Same as above, for away team | Feature store (NEXUS-0), `confidence >= MEDIUM` |
| `injuryImpactAway_MID` | `number` | Same as above, for away team | Feature store (NEXUS-0), `confidence >= MEDIUM` |
| `injuryImpactAway_FWD` | `number` | Same as above, for away team | Feature store (NEXUS-0), `confidence >= MEDIUM` |
| `formHome_last5` | `number` | Points per match in home team's last 5 league matches | Feature store (NEXUS-0), derived |
| `formAway_last5` | `number` | Points per match in away team's last 5 league matches | Feature store (NEXUS-0), derived |
| `homeFormHome_last5` | `number` | Points per match in home team's last 5 HOME league matches | Feature store (NEXUS-0), derived |
| `awayFormAway_last5` | `number` | Points per match in away team's last 5 AWAY league matches | Feature store (NEXUS-0), derived |
| `matchday` | `number` | Current matchday number in the league season | Canonical competition data |
| `seasonPhase` | `enum` | Categorical: `EARLY` (1-10), `MID` (11-25), `LATE` (26+) | Derived from `matchday` |

#### S5.3.2 Conditionally Eligible Features

The following features are eligible only when a specific lift condition is demonstrated through walk-forward validation. They are NOT included by default.

| Feature name | Type | Description | Lift condition |
|-------------|------|-------------|----------------|
| `h2hWinRateHome_last5seasons` | `number` | Home team's win rate in H2H matches over the last 5 seasons (same fixture type) | Must demonstrate statistically significant lift (p < 0.10) in at least 2 of 3 production leagues on a held-out validation set. |
| `h2hGoalDiffHome_last5seasons` | `number` | Home team's average goal difference in H2H matches over the last 5 seasons | Same lift condition as above. |
| `h2hDrawRate_last5seasons` | `number` | Draw rate in H2H matches over the last 5 seasons | Same lift condition as above. |

If the lift condition is not met, these features are excluded from the schema entirely (not set to zero or imputed). The lift evaluation is documented in the evaluation-and-promotion subdocument's scorecard process.

#### S5.3.3 Excluded Features

The following features are explicitly prohibited from Track 3:

| Exclusion | Rationale |
|-----------|-----------|
| Any feature with `effectiveAt >= buildNowUtc` | Anti-lookahead violation. Guaranteed by NEXUS-0 S3.2. |
| Features derived from players with `confidence = UNKNOWN` | Unreliable data. NEXUS-0 S7.1 excludes UNKNOWN features from all models. |
| Features derived from entities with resolution state `UNRESOLVED` or `CONFLICTED` | Entity identity uncertain. Per entity-identity-and-resolution spec. |
| Unconfirmed lineups as direct features | A lineup that is not officially confirmed is not a fact; it is a prediction. Predictions must not be used as features for other predictions. See NEXUS-0 S6.2.4. |
| Post-match statistics of any match with `utcDate >= kickoffUtc` of the match being predicted | Anti-lookahead. Enforced by NEXUS-0 S8. |
| Market odds or any market-derived signal | Market signal enters exclusively through Track 4. Including it in Track 3 would create a circular dependency and violate market-signal-policy boundaries. |
| Weather data | Reserved for future. Not in initial NEXUS scope. See NEXUS-0 S6.2.6. |

### S5.4 Missingness in the Feature Vector

When an eligible feature is unavailable for a specific prediction:

1. If the feature has `confidence = LOW` and the consuming model has been configured to exclude LOW-confidence features (per NEXUS-0 S7.1), the feature is absent.
2. Absent features are handled per the missingness policy in NEXUS-0 S6.3:
   a. If the model supports native missing value handling (e.g., gradient-boosted trees with built-in missingness routing), the feature is set to `NaN` or a sentinel value that the model was trained to interpret.
   b. If the model does not support native missingness (e.g., logistic regression), the feature is excluded from the input vector entirely, and the model uses a variant trained on the reduced feature set.
3. The data quality tier (NEXUS-0 S7.3) is computed from the aggregate missingness pattern and passed to the meta-ensemble.

Global mean imputation is prohibited (NEXUS-0 S6.3).

### S5.5 Output

```typescript
interface Track3Output {
  p_home: number;   // Contextual 1X2: home win probability
  p_draw: number;   // Contextual 1X2: draw probability
  p_away: number;   // Contextual 1X2: away win probability
}
```

Track 3 does NOT produce goal expectations, scoreline matrices, or derived markets. Its output is purely a 1X2 distribution reflecting contextual factors.

### S5.6 Degradation

| Missing data | Behavior |
|-------------|----------|
| No injury data for either team | Injury impact features marked as MISSING using the missing indicator pattern: a companion feature `injury_data_available` (0 = absent, 1 = present) is included alongside each injury impact feature. The model learns "no data" as a distinct state from "no absences." Injury impact values are set to `NaN` or sentinel (not 0.0). Track 3 operates with the reduced feature set. |
| Entity resolution UNRESOLVED for both teams | Track 3 excluded from the ensemble. Match operates in LIMITED_MODE. |
| Fewer than 5 matches in team's recent form window | Form features use the **team's own prior** (average from whatever matches exist in the team's history). If the team has zero historical matches, form features are marked as MISSING (excluded from input vector or set to sentinel). Logged as `FORM_INSUFFICIENT_HISTORY`. League average is never used as imputation. |
| Table position unavailable (early season, matchday < 3) | `tablePositionHome` and `tablePositionAway` are marked as MISSING (excluded from input vector or set to sentinel for models with native missingness handling). `competitiveImportance` set to `NEUTRAL`. League midpoint is never used as imputation. |

### S5.7 Version

Track 3 has two version identifiers:

- `contextModelVersion` -- bumped when the model algorithm or hyperparameters change.
- `featureSchemaVersion` -- bumped when the feature set changes (feature added, removed, or semantics altered).

Both versions are independent. A schema change does not necessarily require a model version change (the new schema may be compatible with the existing model), and a model change does not necessarily require a schema change (e.g., tuning hyperparameters).

---

## S6. Track 4 -- Market Signal

### S6.1 Purpose

Track 4 incorporates closing-line market probabilities as an independent track in the meta-ensemble. It provides the aggregate wisdom of the betting market as a complementary signal to the model-based tracks.

### S6.2 Method

Track 4 is a pure signal pass-through. It does not contain a proprietary model. Its only computation is:

1. Receive raw market odds (decimal format) from the feature store.
2. De-vig the odds to produce implied probabilities using proportional normalization (as defined in market-signal-policy S7.2).
3. Output the de-vigged 1X2 distribution.

### S6.3 Governance

The detailed governance of market signal within NEXUS -- which odds sources are consumed, how de-vigging is performed, anti-circular constraints with the evaluation benchmark, and the conditions under which market signal can serve as an evaluation reference -- is defined in the market-signal-policy subdocument (master S6.5).

This document only establishes that:

1. Track 4 is a first-class track with its own weight in the meta-ensemble.
2. Track 4's weight is learned (not fixed) along with the weights of all other tracks.
3. Track 4 is active whenever a market odds snapshot is available for the match being predicted (any confidence level: HIGH, MEDIUM, or LOW). When confidence is LOW, Track 4 remains active but the meta-ensemble applies the FAR horizon weight vector, which empirically assigns lower weight to stale market data. Track 4 is deactivated only when no snapshot is available at all.
4. When Track 4 is deactivated (no snapshot available), the meta-ensemble redistributes its weight to the remaining active tracks.

### S6.4 Output

```typescript
interface Track4Output {
  p_home: number;   // Market-implied home win probability (de-vigged)
  p_draw: number;   // Market-implied draw probability (de-vigged)
  p_away: number;   // Market-implied away win probability (de-vigged)
  oddsSource: string; // Provider identifier (e.g., 'pinnacle', 'bet365')
  deVigMethod: string; // Method used for de-vigging
}
```

### S6.5 Degradation

Track 4 has a binary activation state: active (any odds snapshot available, regardless of confidence level) or inactive (no snapshot available). When confidence is LOW, Track 4 is still active but the meta-ensemble's per-horizon weight segmentation naturally reduces its influence. There is no hard deactivation threshold based on confidence.

### S6.6 Version

Track 4 does not have an independent model version because it does not contain a model. Changes to the de-vigging method are tracked via the `marketSignalPolicyVersion` defined in the market-signal-policy subdocument.

---

## S7. Meta-Ensemble

### S7.1 Purpose

The meta-ensemble combines the outputs of all active tracks into a single 1X2 probability distribution. It is the only component that produces the official NEXUS prediction.

### S7.2 Method

Weighted average with non-negative weights summing to 1.0. The weights are learned from historical prediction performance, not fixed.

**Formal definition:**

For a match M with active tracks T_active (a subset of {T1+T2, T3, T4}):

```
p_outcome = sum( w_t * p_outcome_t )  for t in T_active, outcome in {home, draw, away}
```

Where:
- `p_outcome_t` is the probability of `outcome` from track `t`.
- `w_t >= 0` for all `t` in T_active.
- `sum(w_t) = 1.0` for all `t` in T_active.

**Note on Track 1 and Track 2:** Tracks 1 and 2 are not independent ensemble members. Track 1 produces strength estimates; Track 2 transforms them into probabilities. For ensemble purposes, the combined (Track 1 + Track 2) output is a single ensemble member. Track 1's strength estimates also feed into Track 3 as features, but this is a feed-forward dependency, not an ensemble contribution.

Therefore, the meta-ensemble has at most three members:
1. Track 1+2 (structural + goals).
2. Track 3 (contextual discriminative).
3. Track 4 (market signal).

### S7.3 Weight Segmentation

Ensemble weights are not global. They vary by segment:

| Dimension | Segments | Rationale |
|-----------|----------|-----------|
| League | One weight vector per league (PD, PL, BL1) + one global fallback | Optimal track blending varies by league (e.g., Track 3 may be more valuable in PL than PD). |
| Prediction horizon | Three buckets: `FAR` (>48h to kickoff), `MEDIUM` (24-48h), `NEAR` (<24h) | Feature availability changes with horizon. Near-kickoff predictions have confirmed lineups and fresher odds. |
| Data quality tier | Three tiers: `FULL`, `PARTIAL`, `MINIMAL` (per NEXUS-0 S7.3) | When data is sparse, model-based tracks may be less reliable and market signal more valuable. |

The total number of segments is `3 leagues x 3 horizons x 3 quality tiers = 27` plus 1 global fallback = 28 weight vectors.

### S7.4 Weight Learning Procedure

Weights are learned through the following procedure:

1. **Training window:** All completed matches in the training period, grouped by segment.
2. **Track outputs:** For each match, reconstruct each track's prediction using the as-of view at the match's `buildNowUtc` (per NEXUS-0 S9.4).
3. **Optimization objective:** Minimize RPS (Ranked Probability Score) over the realized outcomes.
4. **Constraints:**
   a. All weights non-negative.
   b. Weights sum to 1.0.
   c. Minimum weight for Track 1+2 of 0.20 (prevents degenerate solutions where the goals model is entirely ignored).
   d. No maximum weight for any track (the ensemble may legitimately learn to rely heavily on market signal for certain segments).
5. **Fallback hierarchy:** If a segment has fewer than 50 predictions in the training window, use the parent segment's weights:
   a. `(league, horizon, quality)` has < 50 samples -> fall back to `(league, horizon)` (aggregate across quality).
   b. `(league, horizon)` has < 50 samples -> fall back to `(league)` (aggregate across horizon).
   c. `(league)` has < 100 samples -> fall back to `(global)`.
   d. `(global)` must have at least 200 samples or the weight learning procedure fails.
6. **Regularization:** L2 penalty on the weight vector to prevent extreme weights on small segments. The regularization strength is a hyperparameter tuned via nested cross-validation.

### S7.5 Nested Validation for Weights

The weight-learning procedure uses nested temporal validation to prevent overfitting:

1. **Outer fold:** The evaluation period over which NEXUS's final performance is measured.
2. **Inner fold:** The training period used to learn ensemble weights. This period is strictly before the outer fold.
3. **Invariant:** No match in the outer fold appears in the inner fold. The weights used to evaluate a match were learned exclusively from matches that occurred before it.

This is the same walk-forward discipline applied to the underlying tracks, extended to the ensemble layer.

### S7.6 Fallback When Tracks Are Inactive

When a track is inactive for a specific match (e.g., Track 4 has no market odds):

1. The weight assigned to the inactive track is redistributed proportionally to the remaining active tracks.
2. The minimum weight constraint for Track 1+2 (0.20) is enforced after redistribution.
3. If only Track 1+2 is active (Track 3 and Track 4 both inactive), the ensemble output equals the Track 1+2 output. The match is marked LIMITED_MODE.

### S7.7 Output

```typescript
interface EnsembleOutput {
  p_home: number;              // Final 1X2: home win probability
  p_draw: number;              // Final 1X2: draw probability
  p_away: number;              // Final 1X2: away win probability
  predicted_result: '1' | 'X' | '2'; // The outcome with highest probability
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'; // Based on margin between top-2 outcomes
  operating_mode: 'FULL_MODE' | 'LIMITED_MODE' | 'NOT_ELIGIBLE';
  // Debugging and audit fields
  weightsUsed: Record<string, number>;  // e.g., { 'track12': 0.55, 'track3': 0.25, 'track4': 0.20 }
  segmentUsed: string;                 // e.g., 'PD/NEAR/FULL'
  fallbackApplied: boolean;            // True if weight fallback was triggered
}
```

### S7.8 Version

`ensembleVersion` -- bumped when any of the following change:

- Weight learning procedure (optimization objective, constraints, regularization).
- Segmentation dimensions or bucket boundaries.
- Fallback hierarchy rules.
- Minimum weight constraints.
- Output shape beyond additive optional fields.

---

## S8. Calibration

### S8.1 Purpose

The meta-ensemble produces raw probability estimates. Calibration adjusts these estimates so that predicted probabilities correspond to observed frequencies. If NEXUS predicts 30% for an outcome across 100 matches, approximately 30 of those outcomes should occur.

### S8.2 Method

Isotonic regression, one-vs-rest, inherited from V3. The same implementation used by V3's calibrator is used by NEXUS.

For each outcome class (home, draw, away):
1. Collect all raw ensemble probabilities for that class over the calibration training set.
2. Fit a monotonic (isotonic) function from raw probability to calibrated probability.
3. Apply the fitted function to new predictions.

### S8.3 Per-Liga Calibration

Calibration is performed per-liga when sufficient samples exist:

| Condition | Calibration scope |
|-----------|------------------|
| League has >= 300 completed predictions in the calibration training window | Per-liga calibration |
| League has < 300 predictions | Global calibration (aggregated across all leagues) |

The threshold of 300 is inherited from V3. It may be revised through a formal spec change proposal if evidence suggests a different threshold is more appropriate.

### S8.4 Recalibration Schedule

Calibration is recalibrated:

- Periodically, on a configurable schedule (e.g., after each completed matchday round across all production leagues).
- Offline only. Calibration is never updated mid-prediction or in response to a single match result.
- Each recalibration produces a new `calibrationVersion`. The old calibration is archived, not deleted.
- Promotion of a new calibration to production requires verification that the new calibration does not degrade the validation metrics compared to the old calibration.

### S8.5 Anti-Lookahead in Calibration

The calibration training set must satisfy:

```
for every (raw_prob, outcome) in calibration_training_set:
  assert outcome.matchUtcDate < calibrationTable.fittedAt
```

This is enforced by NEXUS-0 S8.1.3. A calibration table trained on data that includes matches in the evaluation period is invalid and must be rejected.

### S8.6 Output

Calibration takes the `EnsembleOutput.{p_home, p_draw, p_away}` and produces calibrated `{p_home_cal, p_draw_cal, p_away_cal}` that sum to 1.0 (renormalized after per-class isotonic adjustment).

### S8.7 Version

`calibrationVersion` -- bumped on every recalibration. The version encodes the training window and the league scope (per-liga or global).

---

## S9. Operating Modes

### S9.1 Mode Definitions

NEXUS inherits V3's three operating modes with the same semantics:

| Mode | Meaning |
|------|---------|
| `FULL_MODE` | All active tracks have sufficient data. Meta-ensemble operates with the full weight vector. |
| `LIMITED_MODE` | One or more tracks are degraded or excluded. The prediction is valid but less reliable. |
| `NOT_ELIGIBLE` | Insufficient data for any meaningful prediction. No output is produced. |

### S9.2 Degradation Triggers

| Condition | Mode |
|-----------|------|
| Team has fewer than `THRESHOLD_NOT_ELIGIBLE` matches in history | `NOT_ELIGIBLE` |
| Team has fewer than `THRESHOLD_ELIGIBLE` matches in history | `LIMITED_MODE` |
| Track 3 excluded due to entity resolution failure for both teams | `LIMITED_MODE` |
| Track 4 inactive (no market odds available) | `LIMITED_MODE` if Track 3 is also unavailable; otherwise `FULL_MODE` (market odds absence alone does not trigger LIMITED) |
| Feature store has no data for this league | `NOT_ELIGIBLE` |
| Track 1 cannot compute ratings (insufficient history) | `NOT_ELIGIBLE` |

### S9.3 Mode Determination Logic

The most restrictive condition wins:

```
if (matchHistory < THRESHOLD_NOT_ELIGIBLE) -> NOT_ELIGIBLE
else if (featureStoreHasNoLeagueData) -> NOT_ELIGIBLE
else if (matchHistory < THRESHOLD_ELIGIBLE) -> LIMITED_MODE
else if (track3Excluded AND track4Inactive) -> LIMITED_MODE
else if (track3Excluded) -> LIMITED_MODE
else -> FULL_MODE
```

### S9.4 Ensemble Behavior per Mode

| Mode | Ensemble behavior |
|------|------------------|
| `FULL_MODE` | All active tracks participate with learned weights. |
| `LIMITED_MODE` | Excluded tracks' weights redistributed to remaining tracks. Output is marked `operating_mode: 'LIMITED_MODE'`. The `confidence` field reflects the reduced reliability. |
| `NOT_ELIGIBLE` | No prediction produced. The match is skipped. |

---

## S10. Output Contract

### S10.1 Compatibility with V3

NEXUS must produce output that conforms to the `V3PredictionOutput` interface or a strict superset with only additive optional fields (master S8.3). This ensures that the promotion swap does not require frontend changes.

### S10.2 Base Fields (Identical to V3)

The base output fields are those defined in V3's prediction contract. NEXUS populates them with the same semantics. The `engine_id` field is set to `'nexus'` instead of `'v3'`.

### S10.3 Extension Fields (NEXUS-Only)

NEXUS adds the following optional fields to the output contract. These fields are present only when `engine_id === 'nexus'` and are ignored by consumers that do not recognize them.

| Field | Type | Description |
|-------|------|-------------|
| `nexus_track_outputs` | `object` | Individual outputs from each active track. For debugging and auditing. Contains `track12`, `track3`, `track4` sub-objects (each with `p_home`, `p_draw`, `p_away`). |
| `ensemble_weights_used` | `Record<string, number>` | The weights applied in the meta-ensemble for this prediction. |
| `data_quality_tier` | `'FULL' \| 'PARTIAL' \| 'MINIMAL'` | The data quality tier that determined the weight vector. |
| `segment_used` | `string` | The segment key used for weight selection (e.g., `'PD/NEAR/FULL'`). |
| `fallback_applied` | `boolean` | Whether the weight fallback hierarchy was triggered. |

### S10.4 Engine Identification

| Field | V3 value | NEXUS value |
|-------|----------|-------------|
| `engine_id` | `'v3'` | `'nexus'` |
| `engine_version` | `'v3-1.3'` (or current V3 version) | `'nexus-{modelVersion}-T{activeTracks}-ME{ensembleVersion}'` (e.g., `'nexus-1.0-T12T3T4-ME1'`) |

---

## S11. Versioning

### S11.1 Independent Version Identifiers

Each NEXUS component has its own version identifier:

| Identifier | Governs | Bumped when |
|-----------|---------|-------------|
| `structuralModelVersion` | Track 1 | Elo formula, home advantage, absence adjustment, K-factor rules change |
| `goalsModelVersion` | Track 2 | Dixon-Coles formula, renormalization method, `MAX_GOALS` change |
| `contextModelVersion` | Track 3 | Model algorithm or hyperparameters change |
| `featureSchemaVersion` | Track 3 feature set | Feature added, removed, or semantics altered |
| `ensembleVersion` | Meta-ensemble | Weight learning procedure, segmentation, constraints change |
| `calibrationVersion` | Calibration | Every recalibration (new training window) |

### S11.2 Prediction Fingerprint

Every NEXUS prediction includes a fingerprint composed of all active version identifiers (as defined in NEXUS-0 S9.2). This fingerprint enables:

1. Reproducibility: given the fingerprint and the feature snapshot, the prediction can be exactly reconstructed.
2. Evaluation grouping: predictions with the same fingerprint are evaluated together.
3. Regression detection: if a version bump causes metric degradation, the fingerprint identifies which component changed.

### S11.3 Version Independence

A change in one component's version does not invalidate predictions made with a different version. Historical predictions retain their original fingerprint. Evaluation can compare predictions across different versions by filtering on the fingerprint.

---

## S12. Invariants

The following invariants must hold at all times. Violation of any invariant is a severity-CRITICAL bug.

1. **Probability sum.** The final output satisfies `p_home + p_draw + p_away = 1.0` within `1e-6`.

2. **No absolute track authority.** No individual track's raw output is ever exposed to end users or used for evaluation without passing through the meta-ensemble. The ensemble is the prediction.

3. **Non-negative weights.** All meta-ensemble weights satisfy `w_t >= 0.0` for every track `t` in the active set.

4. **Weight sum.** The meta-ensemble weights satisfy `sum(w_t) = 1.0` within `1e-9` for the active tracks.

5. **Minimum goals model weight.** The combined Track 1+2 weight is at least 0.20 in every ensemble configuration.

6. **Anti-lookahead in features.** No feature with `effectiveAt >= buildNowUtc` enters the Track 3 input vector. Enforced by NEXUS-0 S8.1.1.

7. **Anti-lookahead in calibration.** No calibration table includes training data from matches that are being predicted or that occur after `buildNowUtc`. Enforced by NEXUS-0 S8.1.3.

8. **Anti-lookahead in ensemble weights.** No ensemble weight vector is learned from predictions of matches that are being predicted or that occur after `buildNowUtc`. Enforced by NEXUS-0 S8.1.4.

9. **Scoreline sum.** Track 2's scoreline matrix satisfies `sum(P[i][j]) = 1.0` within `1e-9` after renormalization.

10. **Operating mode marking.** Every prediction in LIMITED_MODE is explicitly marked as such in the output. A LIMITED_MODE prediction is never silently passed as FULL_MODE.

11. **H2H conditionality.** H2H features enter Track 3 only if their lift has been demonstrated through walk-forward validation. They are never included by default.

12. **Market signal isolation.** Market-derived features never enter Track 3. Market signal enters exclusively through Track 4.

13. **Determinism.** Given the same inputs (feature snapshot, model parameters, ensemble weights, calibration table), the same output is produced.

---

## S13. What This Document Is NOT

1. **Not a data specification.** What data is available, when, and with what confidence is defined in NEXUS-0. This document assumes data is available per NEXUS-0's rules.

2. **Not an evaluation framework.** How predictions are measured, how engines are compared, and when NEXUS is promoted are defined in the evaluation-and-promotion subdocument.

3. **Not a market policy.** The governance of market data usage is defined in the market-signal-policy subdocument. This document only establishes Track 4's position in the ensemble.

4. **Not an entity resolution specification.** How entities are identified and resolved is defined in the entity-identity-and-resolution subdocument. This document assumes entities are resolved.

5. **Not an implementation guide.** This document defines *what* each track computes and *what* the ensemble produces. Class hierarchies, file structures, function signatures, and algorithmic implementation details are determined during Stage 3.

6. **Not a hyperparameter tuning guide.** Default values are provided for configurables (e.g., `MAX_ABSENCE_ADJUSTMENT = 0.20`, minimum Track 1+2 weight = 0.20, fallback thresholds = 50/100/200). These defaults may be tuned through documented experimentation with proper versioning.

---

*End of NEXUS Model Taxonomy and Ensemble specification.*
