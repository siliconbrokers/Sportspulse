---
artifact_id: SPEC-SPORTPULSE-PREDICTION-ENGINE-V2-NEXUS-0
title: "NEXUS-0: Temporal Feature Store Specification"
artifact_class: spec
status: draft
version: 0.1.0
project: sportpulse
domain: prediction
slug: engine-v2-nexus-0-temporal-feature-store
owner: team
created_at: 2026-03-18
updated_at: 2026-03-18
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-PREDICTION-ENGINE-V2-MASTER
canonical_path: docs/specs/prediction/engine-v2/spec.sportpulse.prediction-engine-v2.nexus-0-temporal-feature-store.md
---

# NEXUS-0: Temporal Feature Store Specification

**Version:** 0.1-DRAFT
**Status:** DRAFT -- pending review
**Scope:** Temporal semantics, provenance, missingness policy, and anti-lookahead guarantees for the NEXUS feature store
**Audience:** Architect, Backend, Data/ML, QA
**Parent document:** `spec.sportpulse.prediction-engine-v2.master.md` (S6.1)

---

## Table of Contents

- S1. The Central Problem
- S2. Boundary with Entity Identity and Resolution
- S3. Strict As-Of Semantics
- S4. Source-of-Truth Hierarchy
- S5. Feature Provenance
- S6. Missingness Policy
- S7. Confidence and Eligibility Policy
- S8. Anti-Lookahead Tests
- S9. Training-Serving Parity
- S10. Relationship to V3 Operating Modes
- S11. Module Invariants
- S12. What NEXUS-0 Is NOT

---

## S1. The Central Problem

### S1.1 Statement

The fundamental question NEXUS-0 answers is:

> **What did the system know about a given entity at the exact instant `buildNowUtc`?**

Without a formal answer to this question, adding features to a predictive model (player statistics, injury reports, confirmed lineups, venue conditions) introduces information leakage disguised as sophistication. A model that uses tomorrow's injury report to predict today's match is not a better model -- it is a cheating model.

### S1.2 Why This Is Blocking

NEXUS-0 is the blocking prerequisite for every other NEXUS component. Specifically:

- **Track 1 (Structural/Ratings)** needs player availability snapshots. Without as-of semantics, it cannot know which players were expected to play at prediction time vs. at match time.
- **Track 3 (Tabular/Discriminative)** needs contextual features (rest days, venue stats, competitive context). Without provenance, there is no way to verify that these features were available before kickoff.
- **Meta-ensemble weight learning** needs historical predictions reconstructed with exactly the data that was available at each historical prediction point. Without training-serving parity, the learned weights are biased.
- **Evaluation framework** needs to verify that no evaluated prediction used post-kickoff information. Without anti-lookahead tests, evaluation results are unreliable.

No NEXUS track may be implemented or evaluated until NEXUS-0 is implemented and its invariants are enforced by tests.

### S1.3 Relationship to V3

V3 has a limited form of temporal discipline:

- The `buildNowUtc` anchor exists and is passed through the pipeline.
- Anti-lookahead filtering in `v3-engine.ts` excludes matches with `utcDate >= kickoffUtc`.
- Calibration tables include a `fittedAt` timestamp.
- The isotonic calibrator (`isotonic-calibrator.ts`) throws `TemporalLeakageError` if future data is detected.

NEXUS-0 extends V3's temporal discipline from match-level anti-lookahead to feature-level as-of semantics. Every feature -- not just match results -- must have a timestamp and must satisfy the as-of constraint. This is a strict superset of V3's behavior.

---

## S2. Boundary with Entity Identity and Resolution

NEXUS-0 and the entity-identity-and-resolution subdocument (master S6.2) have complementary but non-overlapping scopes.

| Question | Answering subdocument |
|----------|----------------------|
| "Is player X on our roster the same person as player Y in provider B's data?" | Entity Identity and Resolution |
| "What was player X's injury status at 14:00 UTC on March 15?" | NEXUS-0 |
| "Team A in football-data.org and Team A in API-Football -- are they the same team?" | Entity Identity and Resolution |
| "What were Team A's statistics as of matchday 20?" | NEXUS-0 |
| "This competition changed format in 2025. Is it the same competition?" | Entity Identity and Resolution |
| "What was this team's average attendance as of buildNowUtc?" | NEXUS-0 |

**Rule:** NEXUS-0 operates on resolved entities. It assumes that every entity referenced in the store has a canonical ID assigned by the entity resolution layer. NEXUS-0 never performs entity matching or deduplication.

---

## S3. Strict As-Of Semantics

### S3.1 Core Definitions

Every feature in the store carries two timestamps:

| Timestamp | Definition | Example |
|-----------|-----------|---------|
| `ingestedAt` | The UTC instant when the feature was received by SportPulse's ingestion pipeline. | `2026-03-15T10:22:00Z` -- when the API response arrived. |
| `effectiveAt` | The UTC instant when the real-world event that this feature describes occurred or became true. | `2026-03-14T18:00:00Z` -- when the injury was officially announced by the club. |

These two timestamps are distinct and must not be conflated. A feature can be ingested hours or days after it became effective (delayed reporting). A feature can also be ingested before it becomes effective (advance notice of a future event -- but such features are excluded from the as-of view; see S3.2).

### S3.2 The As-Of Constraint

**Definition:** A feature `f` is eligible for a prediction made at `buildNowUtc = T` if and only if:

```
f.effectiveAt < T
```

This is a strict less-than. A feature whose `effectiveAt` equals `buildNowUtc` exactly is excluded. The rationale: if a feature becomes effective at the exact same instant as the prediction anchor, it is ambiguous whether the system would have had time to process it. The strict inequality resolves this ambiguity conservatively.

### S3.3 Relationship to `kickoffUtc`

For pre-match predictions, `buildNowUtc <= kickoffUtc` by invariant (the prediction is made before or at kickoff). The as-of constraint uses `buildNowUtc`, not `kickoffUtc`. This means:

- A prediction made 24 hours before kickoff (`buildNowUtc = kickoffUtc - 24h`) sees only features effective before that 24-hour-prior instant.
- A prediction made 1 minute before kickoff (`buildNowUtc = kickoffUtc - 1min`) sees nearly all pre-match features.
- This is correct: the prediction should reflect what the system actually knew at the time it was produced, not what it could theoretically know at kickoff.

### S3.4 Immutability of the As-Of View

For a given `buildNowUtc = T` and a given set of ingested features, the as-of view is deterministic and immutable. Running the same query at a later wall-clock time produces the same result, because the view is defined by `effectiveAt < T` over the feature set that existed at `T`, not by wall-clock time.

**Corollary:** If new features are ingested after `T` with `effectiveAt < T` (late-arriving data), they are included in future reconstructions of the as-of view for `T`. This means the reconstructed view can change over time as late data arrives. To handle this:

- **Live predictions** use the features available at the moment of computation. The prediction is stamped with a `featureSnapshotId` (see S9).
- **Historical reconstructions** (for evaluation or training) use all features with `effectiveAt < T` that are in the store at reconstruction time. The reconstruction is stamped with a `reconstructedAt` timestamp to track which version of the data was used.

This distinction is documented in each prediction's fingerprint (S9.2).

---

## S4. Source-of-Truth Hierarchy

When multiple providers supply conflicting information about the same entity and feature at the same `effectiveAt`, the store resolves the conflict using a fixed precedence hierarchy. The higher-precedence source wins.

### S4.1 Match Results

| Precedence | Source | Notes |
|------------|--------|-------|
| 1 (highest) | API-Football (v3) | Primary source for all match data. Scores, status, kickoff time. |
| 2 | football-data.org | Secondary fallback for PD, PL, BL1. Used only if AF unavailable. |
| 3 | No data | Match data absent. Feature absent. |

**Note:** SofaScore is NOT a general match result fallback. Its role is strictly limited to xG (S4.2) and live statistics. FlashScore is used exclusively as the source for match incidents (goals, cards, substitutions) via `server/incidents/` — it is not a fallback for scores or results. football-data.co.uk (the CSV download site) is the source of historical odds data only — it is not a match result source.

### S4.2 Expected Goals (xG)

| Precedence | Source | Notes |
|------------|--------|-------|
| 1 (highest) | API-Football (backfill) | Primary xG source. 100% coverage for PD/PL/BL1 2023-24 and 2024-25 via `tools/xg-backfill-af.ts`. |
| 2 | SofaScore (MCP) | Secondary xG source. Coverage varies by league and season. |
| 3 | Poisson estimate | Not a real xG measurement. Used only when no provider xG is available. Marked `confidence: LOW`. |

### S4.3 Injuries and Absences

| Precedence | Source | Notes |
|------------|--------|-------|
| 1 (highest) | Official club communication | If the club's official channel confirms an injury, this overrides all other sources. Rare in automated pipeline -- usually requires manual entry. |
| 2 | API-Football (v3) | Primary automated source for injury data. Includes injury type, expected return date, and player importance. |
| 3 | SofaScore | Secondary source. Used when API-Football data is unavailable or incomplete. |
| 4 | No data | Feature is absent. Handled by missingness policy (S6). |

**Rule:** Injury rumors from non-official sources (journalist tweets, fan forums, aggregator sites) do not enter the feature store. Only structured data from the listed providers is eligible. An unconfirmed rumor is treated as "no data."

### S4.4 Confirmed Lineups

| Precedence | Source | Notes |
|------------|--------|-------|
| 1 (highest) | Official team sheet | Published by the competition organizer or club. Available approximately 60 minutes before kickoff. |
| 2 | API-Football (v3) | Automated feed. Usually available 15-30 minutes before kickoff. Fetched starting at T-15min. |
| 3 | No data | Lineup not confirmed. Feature absent. |

**Rule:** Lineups are never inferred or predicted. If the confirmed lineup is not available at `buildNowUtc`, the feature is absent. The model must handle this absence through the missingness policy (S6), not by guessing the lineup.

### S4.5 Coach / Manager

| Precedence | Source | Notes |
|------------|--------|-------|
| 1 (highest) | API-Football (v3) | Structured coach data with appointment date. |
| 2 | SofaScore | Secondary source for coach information. |
| 3 | Historical cache | Last known coach assignment. Marked `confidence: LOW` if older than 30 days. |

### S4.6 Conflict Logging

When two providers supply conflicting values for the same feature (same entity, same `effectiveAt`, same feature type), the store:

1. Selects the higher-precedence value as the resolved feature.
2. Logs the conflict as a `FEATURE_CONFLICT` event with: entity ID, feature type, `effectiveAt`, both values, both sources, which source won, and the resolution timestamp.
3. The conflict log is append-only and available for offline analysis.

Conflicts are never silently resolved. The log exists precisely to detect systematic disagreements between providers.

---

## S5. Feature Provenance

### S5.1 Provenance Record

Every feature instance in the store carries a provenance record with the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `source` | `string` | Provider identifier. One of: `'api-football'`, `'football-data-org'`, `'football-data-co-uk'` (odds CSVs only), `'sofascore'` (xG only), `'flashscore'` (incidents only), `'official-club'`, `'manual'`, `'derived'`. |
| `ingestedAt` | `string` (ISO-8601 UTC) | When the feature was received by the ingestion pipeline. |
| `effectiveAt` | `string` (ISO-8601 UTC) | When the real-world event occurred. |
| `confidence` | `'HIGH' \| 'MEDIUM' \| 'LOW' \| 'UNKNOWN'` | Assessed reliability of this feature value. |
| `freshness` | `number` (seconds) | Computed field: `buildNowUtc - ingestedAt`. How old the data is relative to prediction time. |

### S5.2 Confidence Assignment Rules

Confidence is assigned at ingestion time based on the source and the nature of the feature:

| Scenario | Confidence |
|----------|-----------|
| Match result from API-Football, match status FINISHED | `HIGH` |
| Match result from football-data.org, match status FINISHED (fallback) | `HIGH` |
| Match incident from FlashScore (goal, card, substitution), cross-validated with score | `HIGH` |
| xG from API-Football backfill (historical, verified) | `HIGH` |
| xG from SofaScore (xG-specific role, cross-validated) | `MEDIUM` |
| xG from Poisson estimate (no real measurement) | `LOW` |
| Injury from API-Football, status CONFIRMED | `HIGH` |
| Injury from API-Football, status DOUBTFUL | `MEDIUM` |
| Confirmed lineup from official source, within 30 minutes of kickoff | `HIGH` |
| Confirmed lineup from API-Football, between 15-30 minutes before kickoff | `HIGH` |
| Coach from API-Football, appointment within last 30 days | `HIGH` |
| Coach from historical cache, older than 30 days | `LOW` |
| Any feature with `source: 'manual'` (manual override) | `MEDIUM` (unless explicitly tagged) |
| Any feature with no source or no timestamps | `UNKNOWN` |

### S5.3 Derived Features

Some features are computed from other features rather than ingested directly from a provider. Examples: team form (computed from recent match results), strength-of-schedule (computed from opponent ratings), draw propensity (computed from historical draw rates).

Derived features carry `source: 'derived'` and their provenance includes:
- The list of input feature IDs used to compute the derived feature.
- The computation version (a hash or version string of the derivation logic).
- `effectiveAt` = the maximum `effectiveAt` among all input features.
- `confidence` = the minimum `confidence` among all input features.

This ensures that a derived feature is never more confident or more recent than its least reliable input.

---

## S6. Missingness Policy

### S6.1 Guiding Principle

Missing data is information, not an error. The correct response to a missing feature depends on what is missing and why. The missingness policy defines explicit rules per feature family. There is no global imputation strategy.

### S6.2 Rules by Feature Family

#### S6.2.1 Match Results

| Scenario | Action |
|----------|--------|
| Match result not yet available (match not played) | Not a missing feature -- the match is in the future. Normal case. |
| Match result expected but not received (provider delay) | Wait up to TTL defined by matchday cache. If still unavailable, exclude the match from the team's history for this prediction. Log `FEATURE_DELAYED`. |
| Match result permanently unavailable (abandoned, void) | Exclude from history permanently. Log `FEATURE_EXCLUDED`. |

#### S6.2.2 Expected Goals (xG)

| Scenario | Action |
|----------|--------|
| xG available from primary source | Use it. `confidence: HIGH`. |
| xG available only from secondary source | Use it. `confidence: MEDIUM`. |
| xG not available for this match | Fall back to actual goals for this match in the team stats computation. Do not impute with league-average xG. Log `XG_FALLBACK_ACTUAL_GOALS`. |
| xG coverage below `XG_PARTIAL_COVERAGE_THRESHOLD` (50%) for a team's history | Emit warning `XG_PARTIAL_COVERAGE`. The model may down-weight xG-derived features for this team. |

#### S6.2.3 Injuries and Absences

| Scenario | Action |
|----------|--------|
| Injury data available from primary source, status CONFIRMED | Include in absence model. `confidence: HIGH`. |
| Injury data available, status DOUBTFUL | Include with `DOUBTFUL_WEIGHT` (0.5). `confidence: MEDIUM`. |
| Injury rumor without official confirmation | Exclude from model. Do not include in absence score. Feature does not enter the store. |
| No injury data available for this team | Treat as "no known absences." Absence score = 0. Do not assume all players are fit (that would be a positive assertion); assume the absence model has no signal. |
| Injury data older than freshness threshold (24h) | Degrade `confidence` to `LOW`. If only LOW-confidence absence data is available, the model may choose to exclude it (see S7). |

#### S6.2.4 Confirmed Lineups

| Scenario | Action |
|----------|--------|
| Confirmed lineup available, within 90 minutes of kickoff | Use it. `confidence: HIGH`. |
| Lineup available but more than 90 minutes before kickoff | Use with `confidence: MEDIUM`. Teams sometimes change lineups between announcement and kickoff. |
| Lineup not available (prediction made more than 90 minutes before kickoff, or provider did not publish) | Feature absent. Do not infer the lineup from historical patterns. The absence model operates with injury data only. |

**Critical rule:** A lineup is never predicted or inferred. "Player X started 80% of matches" is informational context (usable as a prior for the absence model), but it must not be treated as a confirmed lineup.

#### S6.2.5 Market Odds

| Scenario | Action |
|----------|--------|
| Odds snapshot captured < 24h before kickoff | Use in Track 4 (Market Signal). `confidence: HIGH`. |
| Odds snapshot captured 24h-72h before kickoff | Use with `confidence: MEDIUM`. |
| Odds snapshot captured > 72h before kickoff | Use with `confidence: LOW`. Track 4 weight is degraded in the meta-ensemble (FAR horizon weight vector). |
| No snapshot available | Track 4 is deactivated for this match. Meta-ensemble redistributes Track 4's weight to other tracks. No imputation. |

#### S6.2.6 Venue / Travel / Weather

| Scenario | Action |
|----------|--------|
| Venue / travel distance | Out of scope. Stadiums/venues are not modeled as entities (per entity-identity-and-resolution S2.5). The effect of playing at home is captured by Track 1's dynamic home advantage per team, not by venue-specific features. |
| Weather forecast available | Reserved for future. Not in initial NEXUS scope. |

### S6.3 Prohibition on Global Mean Imputation

No missing feature may be imputed with the global mean (across all teams, all leagues, all seasons) of that feature. Global mean imputation:

- Introduces a systematic bias toward the population average, which is not informative for prediction.
- Masks the absence of the feature, making it impossible to track data quality.
- Violates the principle that missing data is information.

When a feature is missing, the model must either:
1. Use the team's own prior for that feature (if available), or
2. Exclude the feature from the input vector for this prediction, or
3. Use a sentinel value that the model is trained to interpret as "absent."

Option 3 requires that the training data includes examples of missingness, so the model learns the correct behavior for absent features.

---

## S7. Confidence and Eligibility Policy

### S7.1 Feature-Level Confidence

Each feature has a `confidence` level assigned by the rules in S5.2. The confidence level determines how the feature is treated by downstream consumers:

| Confidence | Treatment |
|-----------|-----------|
| `HIGH` | Feature is used at full weight. No degradation. |
| `MEDIUM` | Feature is used at full weight but its presence is logged as `QUALITY_MEDIUM` for monitoring. |
| `LOW` | Feature may be used with reduced weight. The consuming model decides whether to include it. If included, the prediction's explanation must document that LOW-confidence features were used. |
| `UNKNOWN` | Feature is excluded from the prediction input vector. It is never passed to a model. Its presence in the store is for auditing only. |

### S7.2 Freshness Thresholds

Features degrade in confidence as they age. The freshness threshold varies by feature type:

| Feature type | Freshness threshold | Action when exceeded |
|-------------|--------------------|--------------------|
| Injury / absence | 24 hours | Degrade to `LOW` if currently `HIGH` or `MEDIUM`. |
| Confirmed lineup | 2 hours before kickoff | Degrade to `LOW` if lineup was captured very early. (In practice, lineups are available ~60min before kickoff, so this threshold rarely triggers.) |
| xG (historical) | 7 days after match | No degradation. xG is a historical fact that does not change. The 7-day window is for cross-validation: xG captured within 7 days of the match is `HIGH`; xG backfilled months later from a different source is `MEDIUM` (may use a different xG model). |
| Match result | No degradation | Match results are facts. Once FINISHED, they do not degrade. |
| Market odds | Capture-to-kickoff distance | `<24h → HIGH`; `24-72h → MEDIUM`; `>72h → LOW`. See S6.2.5. |
| Coach / manager | 30 days | Coach data older than 30 days degrades to `LOW`. |

### S7.3 Prediction-Level Data Quality Tier

Each prediction is assigned a data quality tier based on the aggregate quality of its input features:

| Tier | Criteria |
|------|----------|
| `FULL` | All of: (a) match history with >= 80% xG coverage for both teams, (b) injury data available for both teams at `confidence >= MEDIUM`, (c) market odds available at `confidence >= MEDIUM`. |
| `PARTIAL` | At least one of the FULL criteria is not met, but match history is available for both teams (>= `THRESHOLD_ELIGIBLE` games). |
| `MINIMAL` | Only basic match history is available. No xG, no injury data, no market odds. |

The data quality tier is passed to the meta-ensemble, which uses it to select the appropriate weight vector (see master S5.5).

---

## S8. Anti-Lookahead Tests

### S8.1 Mandatory Test Classes

The following test classes must exist and pass before any NEXUS prediction is considered valid:

#### S8.1.1 Feature-Level Anti-Lookahead

**Test:** For every feature `f` in the input vector of a prediction with `buildNowUtc = T`:

```
assert f.effectiveAt < T
```

This test runs on every prediction in both live mode and backtest mode. It is not a sampling test -- it is an exhaustive check.

#### S8.1.2 Match Result Anti-Lookahead

**Test:** For every match result used to compute team strength or form for a prediction of match `M` with `kickoffUtc = K`:

```
assert matchResult.utcDate < K
```

This is the existing V3 anti-lookahead rule, preserved in NEXUS.

#### S8.1.3 Calibration Anti-Lookahead

**Test:** For every calibration table used in a prediction with `buildNowUtc = T`:

```
assert calibrationTable.fittedAt < T
assert all training data for the calibration has effectiveAt < T
```

The second assertion is stronger: it is not sufficient that the calibration was fitted before `T` if the calibration's training data includes matches after `T`.

#### S8.1.4 Ensemble Weight Anti-Lookahead

**Test:** For every meta-ensemble weight vector used in a prediction with `buildNowUtc = T`:

```
assert ensembleWeights.fittedAt < T
assert all evaluation data used to learn the weights has effectiveAt < T
```

#### S8.1.5 Backtest Integrity

**Test:** In backtest mode, for a match on date `D`:

1. Reconstruct the as-of view at `buildNowUtc = D` (or the specific prediction time).
2. Verify that no feature in the reconstructed view has `effectiveAt >= D`.
3. Verify that the calibration table used was fitted on data strictly before `D`.
4. Verify that the ensemble weights used were learned on data strictly before `D`.

### S8.2 Leakage Tests by Signal Family

Each signal family has a dedicated leakage test suite:

| Signal family | Test description |
|--------------|-----------------|
| Match results | No match with `utcDate >= kickoffUtc` appears in team history. |
| xG | No xG record with `utcDate >= kickoffUtc` is used in stats computation. |
| Injuries | No injury record with `effectiveAt >= buildNowUtc` is used in absence model. |
| Confirmed lineups | No lineup with `effectiveAt >= buildNowUtc` is used. |
| Market odds | No odds captured after `buildNowUtc` are used. |
| Calibration | No calibration tuple derived from a match with `utcDate >= kickoffUtc` appears in the calibration training set. |
| Ensemble weights | No weight learned from predictions of matches with `kickoffUtc >= buildNowUtc` is used. |
| Standings / table position | Table position is computed from match results with `utcDate < kickoffUtc` only. |
| Rating updates | No rating update from a match with `utcDate >= kickoffUtc` is applied. |

### S8.3 Continuous Enforcement

Anti-lookahead tests are not optional. They run:

1. In the unit test suite (every `pnpm -r test` invocation).
2. As runtime assertions in the prediction pipeline (both shadow and production).
3. In the evaluation framework before any metric is computed.

A prediction that fails any anti-lookahead test is marked `CONTAMINATED` and excluded from evaluation. If a contaminated prediction reaches production, it is a severity-CRITICAL bug.

---

## S9. Training-Serving Parity

### S9.1 The Parity Principle

The prediction pipeline in production (serving) and the prediction pipeline used to generate training data must use the same feature store semantics, the same as-of constraints, and the same missingness handling. There must be no "training-only" features that are unavailable at serving time, and no "serving-only" features that were absent during training.

**Corollary:** If a feature is sometimes unavailable at serving time (e.g., confirmed lineups are not available 24h before kickoff), the training dataset must include examples where that feature is absent, with the same missingness handling applied.

### S9.2 Prediction Fingerprint

Every prediction produced by NEXUS (live or reconstructed) carries a fingerprint:

| Field | Type | Description |
|-------|------|-------------|
| `featureSchemaVersion` | `string` | Version of the feature vector schema (which features exist and their types). Bumped when a feature is added or removed. |
| `datasetWindow` | `{ from: string, to: string }` | The temporal range of training data used to fit models and calibration. ISO-8601 UTC timestamps. |
| `modelVersion` | `string` | Version of the active tracks and their internal parameters. |
| `calibrationVersion` | `string` | Version of the calibration tables used. |
| `ensembleVersion` | `string` | Version of the meta-ensemble weight vector used. |
| `featureSnapshotId` | `string` | A hash of the feature set used for this specific prediction (or a reference to a stored snapshot). |
| `buildNowUtc` | `string` | The temporal anchor of the prediction. |

### S9.3 Reproducibility Requirement

Given a fingerprint, it must be possible to reproduce the exact same prediction output (bit-for-bit on IEEE 754 compliant hardware). This requires:

1. The feature store state at `buildNowUtc` can be reconstructed from the stored features (or from the `featureSnapshotId`).
2. The model parameters identified by `modelVersion` are immutable once published.
3. The calibration table identified by `calibrationVersion` is immutable once published.
4. The ensemble weights identified by `ensembleVersion` are immutable once published.
5. The computation is deterministic (no `Math.random()`, no `Date.now()`, no non-deterministic floating-point operations).

If any of these conditions cannot be met (e.g., a model was re-trained and the old version was not archived), the prediction is not reproducible and must be flagged as such.

### S9.4 Dataset Reconstruction

For training and evaluation, historical predictions are reconstructed using the following procedure:

1. Select the match to predict. Determine `kickoffUtc` and `buildNowUtc` (typically `kickoffUtc - predictHorizon`).
2. Query the feature store for all features with `effectiveAt < buildNowUtc`.
3. Apply the `featureSchemaVersion` to select and transform features into the model's input vector.
4. Run each active track with the input vector.
5. Combine track outputs using the `ensembleVersion` weights.
6. Record the prediction with its fingerprint.

This procedure is identical to the live prediction procedure. The only difference is that in live mode, `buildNowUtc` is approximately the current wall-clock time, while in reconstruction mode, it is a historical timestamp.

---

## S10. Relationship to V3 Operating Modes

V3 defines three operating modes: `FULL_MODE`, `LIMITED_MODE`, and `NOT_ELIGIBLE`. NEXUS inherits this concept but extends it with richer degradation logic driven by the feature store.

### S10.1 Degradation Triggers

| Condition | V3 behavior | NEXUS behavior |
|-----------|-------------|---------------|
| Team has fewer than `THRESHOLD_NOT_ELIGIBLE` matches | `NOT_ELIGIBLE` | `NOT_ELIGIBLE` (unchanged) |
| Team has fewer than `THRESHOLD_ELIGIBLE` matches | `LIMITED` | `LIMITED` (unchanged) |
| No xG data available | Fallback to actual goals (transparent) | Feature absent. Data quality tier = `PARTIAL` or `MINIMAL`. Meta-ensemble adjusts weights. |
| No injury data available | No absence adjustment (transparent) | Feature absent. Data quality tier = `PARTIAL` or `MINIMAL`. Track 1 uses baseline squad strength. |
| No market odds available | No market blend (transparent) | Track 4 disabled. Meta-ensemble redistributes weight. Data quality tier = `PARTIAL` or `MINIMAL`. |
| Feature store has no data for this league | N/A (V3 does not have a feature store) | `NOT_ELIGIBLE` for NEXUS. V3 remains the active engine for this league. |

### S10.2 Mode Determination

NEXUS mode is determined by the combined state of match history availability (V3's criterion) and feature store coverage (NEXUS's new criterion). The most restrictive condition wins:

```
if (matchHistory < THRESHOLD_NOT_ELIGIBLE) → NOT_ELIGIBLE
else if (matchHistory < THRESHOLD_ELIGIBLE) → LIMITED
else if (featureStoreCoverage == none for this league) → NOT_ELIGIBLE
else if (featureStoreCoverage is below league-specific minimum) → LIMITED
else → FULL
```

The `featureStoreCoverage` thresholds per league are configurable and defined in the model-taxonomy-and-ensemble subdocument (master S6.3), not in NEXUS-0. NEXUS-0 only provides the data; the decision of what constitutes "enough data" belongs to the model specification.

---

## S11. Module Invariants

The following invariants must hold at all times. Violation of any invariant is a severity-CRITICAL bug.

1. **Provenance completeness.** Every feature in the store has all five provenance fields populated: `source`, `ingestedAt`, `effectiveAt`, `confidence`, and `freshness` (computed). No field is null or undefined.

2. **As-of exclusion.** No feature with `effectiveAt >= buildNowUtc` is ever included in a prediction's input vector. This is enforced both by the store's query API and by runtime assertions in the prediction pipeline.

3. **Deterministic view.** For a given `buildNowUtc` and a given set of stored features, the as-of view is deterministic. The same query always returns the same features in the same order.

4. **Conflict transparency.** When two sources provide conflicting values for the same feature (same entity, same feature type, same `effectiveAt`), the conflict is logged. The resolution follows the hierarchy in S4. Conflicts are never silently resolved.

5. **No silent imputation.** No missing feature is replaced with a population mean, league average, or any other imputed value without explicit documentation in the prediction's explanation output. If imputation occurs (e.g., using a team's own prior), it is logged as `FEATURE_IMPUTED_FROM_PRIOR` with the prior source identified.

6. **Training-serving symmetry.** The same feature selection logic, missingness handling, and as-of constraint applies in training reconstruction and in live serving. There is no training-only code path that relaxes constraints.

7. **Immutability per prediction.** Once a prediction is produced, the feature snapshot it used is immutable. If the store later receives a late-arriving feature that would have changed the prediction, the original prediction is not retroactively modified. The late feature is available for future predictions and for evaluation annotation ("prediction X would have been Y if feature Z had been available").

8. **Confidence monotonicity in derivation.** A derived feature's confidence is at most equal to the minimum confidence of its input features. A derivation can never increase confidence.

---

## S12. What NEXUS-0 Is NOT

1. **Not an entity resolution system.** NEXUS-0 does not resolve which entities exist or how provider IDs map to canonical IDs. That scope belongs to the entity-identity-and-resolution subdocument (master S6.2).

2. **Not a model specification.** NEXUS-0 does not define how features are weighted, combined, or used in models. That scope belongs to the model-taxonomy-and-ensemble subdocument (master S6.3).

3. **Not an evaluation framework.** NEXUS-0 does not define how predictions are measured or how engines are compared. That scope belongs to the evaluation-and-promotion subdocument (master S6.4).

4. **Not a market data specification.** While NEXUS-0 defines the provenance and as-of rules for market odds (as it does for all features), the specific rules governing market data usage in the engine belong to the market-signal-policy subdocument (master S6.5).

5. **Not a data pipeline specification.** NEXUS-0 defines the semantics of the feature store (what it contains, how it is queried, what invariants hold). The implementation of data ingestion, transformation, and storage infrastructure is an engineering concern decided at Stage 3.

6. **Not a caching specification.** The matchday file cache (`server/matchday-cache.ts`) is a V3 concern that handles match result freshness. NEXUS-0 defines its own freshness and staleness semantics at the feature level. The two systems are independent.

---

*End of NEXUS-0: Temporal Feature Store specification.*
