---
artifact_id: SPEC-SPORTPULSE-PREDICTION-ENGINE-V2-MASTER
title: "Predictive Engine NEXUS (PE v2) -- Master Specification"
artifact_class: spec
status: draft
version: 0.1.0
project: sportpulse
domain: prediction
slug: engine-v2-master
owner: team
created_at: 2026-03-18
updated_at: 2026-03-18
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-PREDICTION-ENGINE (PE v1.3 -- current production spec)
  - SPEC-SPORTPULSE-PREDICTION-ENGINE-V2-NEXUS-0
canonical_path: docs/specs/prediction/engine-v2/spec.sportpulse.prediction-engine-v2.master.md
---

# SportPulse -- Predictive Engine NEXUS (PE v2): Master Specification

**Version:** 0.1-DRAFT
**Status:** DRAFT -- pending review
**Scope:** Architecture, governance, and subdocument boundaries for the NEXUS predictive engine
**Audience:** Architect, Backend, Data/ML, QA, Product

---

## Table of Contents

- S1. Purpose and Authority
- S2. Name and Vision
- S3. Core Architectural Decision
- S4. Fundamental Limitations of V3
- S5. High-Level Architecture
- S6. Subdocument Map and Boundaries
- S7. Separation of Edges
- S8. Coexistence Policy: V3 and NEXUS
- S9. Production Target Leagues
- S10. SDD Governance
- S11. What This Document Is NOT

---

## S1. Purpose and Authority

### S1.1 Purpose

This document is the master specification for the NEXUS predictive engine (PE v2). It defines:

- the architectural rationale for building a new engine alongside V3;
- the high-level structure of NEXUS as a family of models with a learned meta-ensemble;
- the subdocument map that governs every component of NEXUS;
- the coexistence rules that prevent NEXUS from degrading V3 during development and shadow evaluation;
- the governance rules for proposing changes to this specification and its subdocuments.

### S1.2 Relationship to PE v1.3

The current production engine is governed by `spec.sportpulse.prediction.engine.md` (artifact: `SPEC-SPORTPULSE-PREDICTION-ENGINE`, version 1.3). That specification remains the authoritative document for the V3 engine. It is not superseded by this document.

NEXUS does not replace V3. NEXUS runs as a challenger in shadow mode. V3 remains the champion engine until NEXUS is promoted through the quantitative gate defined in `S6.4` (evaluation-and-promotion subdocument). At the moment of promotion, this master spec and its subdocuments become the authoritative specs for the production engine, and the V3 spec is marked `superseded_by: SPEC-SPORTPULSE-PREDICTION-ENGINE-V2-MASTER`.

### S1.3 Precedence

Within the NEXUS subdocument family, this master document has the highest precedence. When a subdocument conflicts with this master, this master wins. The document hierarchy within the broader SportPulse project (Constitution > Domain Glossary > MVP Scope > ...) applies unchanged above this master.

---

## S2. Name and Vision

### S2.1 Name

**NEXUS** -- the next-generation unified engine for SportPulse match prediction.

The name reflects the core design principle: NEXUS is a nexus of multiple model families whose outputs are combined through a learned meta-ensemble, rather than a single monolithic pipeline with fixed hyperparameters.

### S2.2 Vision

V3 achieves 55.7% accuracy and RPS approximately 0.199 on three leagues (PD, PL, BL1). The Pinnacle closing line benchmark sits at approximately RPS 0.185-0.188. Closing this gap within V3's architecture is not feasible because V3 has three structural ceilings that cannot be removed without breaking its invariants and calibration chain. Those ceilings are described in S4.

NEXUS is designed to remove those ceilings by:

1. Replacing team-aggregate strength estimates with player-aware strength adjustment.
2. Replacing static home advantage with context-dependent home advantage.
3. Replacing the fixed-weight ensemble with a learned meta-ensemble whose weights adapt to league, prediction horizon, and data availability.

NEXUS does not promise a specific RPS target. It provides the architectural capacity to pursue forecasting improvements that V3 cannot pursue.

---

## S3. Core Architectural Decision

**Parallel evolution, not rewrite.**

NEXUS is developed alongside V3. Both engines share the same canonical base inputs and `buildNowUtc` time anchor, and the same output contract shape. NEXUS additionally ingests supplementary sources (API-Football injuries, confirmed lineups, market odds) via its own feature store — those sources and their storage are isolated from V3 (S8.4). They differ in the internal computation that transforms canonical inputs into 1X2 probability distributions and derived markets.

The rationale for parallel evolution over rewrite:

1. **Zero regression risk.** V3 is not touched. Its calibration, its constants, its test suite, its shadow runner -- all remain intact. A production user sees V3 outputs until the promotion gate fires.
2. **Apples-to-apples evaluation.** Both engines predict the same matches from the same data at the same `buildNowUtc`. The evaluation framework (`S6.4`) can compare them head-to-head without confounds.
3. **Incremental value delivery.** Each NEXUS track (S5) can be developed, tested, and evaluated independently. A partial NEXUS with only Tracks 1 and 2 active is still a valid challenger.
4. **Rollback is trivial.** If NEXUS underperforms after promotion, swap back to V3 by flipping a feature flag.

---

## S4. Fundamental Limitations of V3

V3 has three structural limitations that justify NEXUS. Each limitation is described below with its concrete impact on forecasting accuracy.

### S4.1 Team-Level Strength Only

V3 models each team as a single entity with aggregate attack and defense efficiency statistics. These statistics are derived from historical match results weighted by exponential time decay (`DECAY_XI = 0.006`), optionally augmented with xG, and shrunk toward a league prior.

The consequence: V3 cannot distinguish between "Team A with its full-strength XI" and "Team A missing its top scorer and first-choice goalkeeper." The absence adjustment module (`absence-adjustment.ts`) applies a crude multiplicative penalty to lambdas based on player importance weights, but these weights are externally provided scalars with no integration into the team strength model itself. A key player's absence reduces lambda by at most 15% (`ABSENCE_MULT_MIN = 0.85`), regardless of who replaces them.

**What NEXUS changes:** Track 1 (Structural/Ratings) introduces player-adjusted team strength. The baseline squad, minus confirmed absences (injuries, suspensions), plus the confirmed lineup when available (~60min pre-kickoff), modulates the team's effective strength. This is not a post-hoc penalty on lambdas; it is an input to the strength model itself.

### S4.2 Static Home Advantage

V3 models home advantage as a multiplicative factor on the home team's lambda. The factor is either derived dynamically from the ratio of league-average home goals to league-average away goals (`lambda.ts`), or overridden per-league via `HOME_ADV_MULT_PER_LEAGUE` (currently empty -- the dynamic ratio is used for all leagues).

The consequence: home advantage is the same for every match within a league, regardless of:

- recent form at home vs. away for the specific team;
- neutral-venue matches in the same competition;
- schedule congestion and competitive context differences between home and away teams.

The SP-V4-34 sweep confirmed that per-league fixed multipliers do not improve over the dynamic ratio with full-season data. But the dynamic ratio is still a single scalar per league per season snapshot -- it captures no match-specific context.

**What NEXUS changes:** Track 1 captures the effect of playing at home through a dynamic home advantage per team (trending home performance ratio over a rolling window, with league-wide shrinkage). Track 3 (Tabular/Discriminative) includes match-specific contextual features that capture form splits (home form vs. away form), schedule congestion, and competitive context. The meta-ensemble learns how much weight to give these contextual signals per league and prediction horizon. Venue identity and travel distance are not used as explicit signals (stadiums/venues are out of scope per entity-identity-and-resolution S2.5).

### S4.3 Fixed-Weight Ensemble

V3 has an ensemble combinator (`ensemble.ts`) that blends Poisson, market, and logistic model outputs. The weights are constants defined in `ENSEMBLE_WEIGHTS_DEFAULT` (currently `w_poisson=0.80, w_market=0.15, w_logistic=0.05`). These weights were determined by a single grid search over the 2025-26 season data.

The consequence: the optimal blend varies by league, by prediction horizon (time-to-kickoff: FAR, MEDIUM, NEAR), and by data availability (market odds present or absent, xG coverage high or low). A fixed weight set cannot adapt to these dimensions.

Furthermore, the current ensemble is not truly a meta-learner. It is a fixed linear combination. There is no mechanism for the ensemble to learn from its own prediction errors over time, nor to down-weight a track that has been systematically miscalibrated for a particular league.

**What NEXUS changes:** The meta-ensemble (`S5.5`) uses weights that are learned from historical prediction performance, segmented by league, prediction horizon (FAR/MEDIUM/NEAR by time-to-kickoff), and data quality tier. The weight-learning procedure is walk-forward temporal, uses the same anti-lookahead discipline as the underlying models, and is re-fitted on a configurable schedule.

---

## S5. High-Level Architecture

NEXUS is structured as a family of four tracks plus a meta-ensemble. Track 1 produces team strength estimates; Track 2 translates those estimates into a goals distribution and 1X2 probabilities; Track 3 produces an independent 1X2 distribution from contextual features; Track 4 passes through market-implied 1X2 probabilities. The meta-ensemble combines three members -- the coupled Track 1+2 block, Track 3, and Track 4 -- into a single output distribution.

### S5.1 Track 1: Structural / Ratings

**Purpose:** Estimate long-run team strength from historical match results, adjusted for player availability.

**Core method:** Modified Elo or equivalent rating system with:
- Player-adjusted team strength (baseline squad minus confirmed absences, plus confirmed lineup when available).
- Strength-of-schedule weighting in rating updates.
- Cross-season prior with configurable carry-over decay.

**Output:** A pair of team strength estimates (home, away) that feed into the goals model (Track 2) and serve as features for Track 3.

**What it does NOT do:** Track 1 does not produce match probabilities directly. It produces strength estimates consumed by other tracks.

### S5.2 Track 2: Goals Model (Dixon-Coles / Poisson)

**Purpose:** Translate team strength estimates into a joint distribution of goals scored by each team.

**Core method:** Bivariate Poisson with Dixon-Coles low-score correction, parameterized by `lambda_home` and `lambda_away` derived from Track 1 strength estimates (expectedGoalsHome, expectedGoalsAway) and dynamic home advantage. Contextual adjustments (rest, form, H2H) are features of Track 3, not inputs to Track 2.

**Output:** Full scoreline probability matrix, from which 1X2 probabilities and all goal-based markets (O/U, BTTS, exact score, expected goals) are derived.

**Relationship to V3:** This track is the natural successor to V3's Poisson pipeline. The key difference is that the lambdas receive player-adjusted strength from Track 1 rather than team-aggregate statistics.

### S5.3 Track 3: Tabular Discriminative Model

**Purpose:** Capture contextual signals that the parametric goals model cannot represent (form asymmetries, schedule congestion, competitive context).

**Core method:** Gradient-boosted trees or regularized logistic regression over a feature vector that includes:
- Track 1 strength estimates (as base features).
- Contextual features: rest days, competitive stage, form splits (home form vs. away form), schedule congestion.
- Data quality indicators: xG coverage, absence data completeness, market odds availability.

**Output:** 1X2 probability distribution.

**Anti-leakage discipline:** Every feature in the input vector must satisfy the as-of constraint defined in `NEXUS-0` (S6.1). The feature schema is versioned and frozen per training run.

### S5.4 Track 4: Market Signal

**Purpose:** Incorporate closing-line market probabilities as an independent track in the ensemble.

**Core method:** De-vig market odds using proportional normalization (1/odd divided by sum of 1/odds), producing implied 1X2 probabilities. No proprietary model -- this track is pure signal pass-through.

**Output:** 1X2 probability distribution derived from market odds.

**Activation condition:** This track is active only when market odds are available for the match being predicted. When absent, the meta-ensemble redistributes its weight to the remaining tracks.

**Relationship to V3:** V3 already blends market odds via `market-blend.ts` (pre-ensemble) and optionally via the ensemble combinator. NEXUS elevates market signal to a first-class track with its own weight in the meta-ensemble, rather than blending it at a fixed point in the Poisson pipeline.

**Governance:** The exact role and constraints of market signal within NEXUS are defined in the `market-signal-policy` subdocument (S6.5).

### S5.5 Meta-Ensemble

**Purpose:** Combine the outputs of the three ensemble members -- Track 1+2 (coupled block), Track 3, and Track 4 -- into a single 1X2 probability distribution and derived markets.

**Core method:** Weighted average with weights learned from historical prediction performance via walk-forward cross-validation. Weights are segmented by:
- **League:** each target league has its own weight vector.
- **Prediction horizon:** `FAR` (>48h to kickoff), `MEDIUM` (24-48h to kickoff), `NEAR` (<24h to kickoff). Feature availability changes with horizon -- near-kickoff predictions have confirmed lineups and fresher odds.
- **Data quality tier:** determined by the completeness of inputs (xG coverage, absence data, market odds presence). Three tiers: FULL, PARTIAL, MINIMAL.

**Weight learning procedure:**
1. For each segment (league x horizon x quality), collect all predictions made by each track in the training window.
2. Fit weights by minimizing RPS (or equivalently, maximizing log-score) over the realized outcomes.
3. Constraints: all weights non-negative, sum to 1.0. Minimum weight for Track 1+2 combined (structural + goals model) of 0.20 to prevent degenerate solutions.
4. If a segment has fewer than 50 predictions, fall back to the league-level weights (ignoring horizon and quality segmentation). If the league has fewer than 100 predictions, fall back to global weights.
5. The training window is the previous N completed matchdays (configurable, default: all available data with exponential decay).

**Output:** Final 1X2 probability distribution, from which all downstream outputs (markets, predicted result, confidence, editorial text) are derived. The output contract is identical to V3's `V3PredictionOutput` shape.

**Invariants:**
1. `prob_home + prob_draw + prob_away = 1.0` (within `1e-9`).
2. All probabilities in `[0, 1]`.
3. The meta-ensemble is deterministic: same inputs and same weight vector produce the same output.
4. Track availability changes (e.g., market odds present vs. absent) produce a different weight vector but the combination is still deterministic.

---

## S6. Subdocument Map and Boundaries

NEXUS is governed by this master document and five subdocuments. Each subdocument has a well-defined scope boundary. No subdocument may make decisions that belong to another subdocument's scope.

### S6.1 NEXUS-0: Temporal Feature Store

**Artifact:** `spec.sportpulse.prediction-engine-v2.nexus-0-temporal-feature-store.md`

**Scope:** Defines the semantics of the feature store that answers: "What did the system know about a known entity at the instant `buildNowUtc`?" Covers as-of semantics, provenance tracking, missingness policy, anti-lookahead invariants, and training-serving parity.

**Boundary:** NEXUS-0 does NOT define which entities exist or how they are resolved (that belongs to S6.2). It does NOT define how features are weighted in models (that belongs to S6.3). It does NOT define how predictions are evaluated (that belongs to S6.4).

### S6.2 Entity Identity and Resolution

**Artifact:** `spec.sportpulse.prediction-engine-v2.entity-identity-and-resolution.md` (v0.1-DRAFT)

**Scope:** Defines how entities (teams, players, competitions) are identified, deduplicated, and resolved across data providers. Covers canonical ID mapping, confidence levels for entity matches, and handling of entity lifecycle events (team promotion/relegation, player transfers). Stadiums/venues are out of scope (see entity-identity-and-resolution S2.5).

**Boundary:** Entity resolution answers "who is this entity and under what confidence?" NEXUS-0 answers "what do we know about this resolved entity at time T?" These two concerns must not be merged. Stadiums/venues are out of scope for entity resolution (out of scope -- future version). The effect of playing at home is captured by Track 1's dynamic home advantage per team, not by venue-specific features.

### S6.3 Model Taxonomy and Ensemble

**Artifact:** `spec.sportpulse.prediction-engine-v2.model-taxonomy-and-ensemble.md` (v0.1-DRAFT)

**Scope:** Defines the detailed specification of each track (S5.1-S5.4), the meta-ensemble weight learning procedure, the feature schema for Track 3, the output contract, and the versioning rules for model changes.

**Boundary:** This subdocument defines how models compute and combine predictions. It does NOT define what data is available (that belongs to NEXUS-0). It does NOT define how predictions are evaluated for promotion (that belongs to S6.4).

### S6.4 Evaluation and Promotion

**Artifact:** `spec.sportpulse.prediction-engine-v2.evaluation-and-promotion.md` (v0.1-DRAFT)

**Scope:** Defines the quantitative gate that determines when NEXUS replaces V3 as the production champion. Covers:
- Evaluation metrics (RPS, accuracy, log-loss, draw recall, calibration).
- Minimum sample size for evaluation (per league and aggregate).
- Shadow mode protocol (how predictions are recorded without affecting production output).
- Promotion ceremony (the exact sequence of steps to swap champion).
- Rollback procedure.

La evidencia de promocion consiste en dos slices obligatorios:
- live shadow (>=100 por liga): predicciones emitidas pre-kickoff con pipeline congelado
- walk-forward historico (complemento hasta 200 por liga): misma semantica as-of, sin leakage

Los criterios detallados y los scorecards obligatorios estan definidos en
evaluation-and-promotion.md S4, S5, S6.

**Boundary:** This subdocument defines how to measure and compare engines. It does NOT define the engines themselves (that belongs to S6.3) nor the data they consume (that belongs to NEXUS-0).

### S6.5 Market Signal Policy

**Artifact:** `spec.sportpulse.prediction-engine-v2.market-signal-policy.md` (v0.1-DRAFT)

**Scope:** Defines the exact role of market-derived information within NEXUS. Covers:
- Which market data is consumed (closing lines, opening lines, line movement).
- How market odds are de-vigged.
- Whether market signal is used as a model input (feature), a blending component (Track 4), or both.
- Constraints on market dependency (NEXUS must produce valid predictions without market data).
- Ethical and regulatory considerations if SportPulse operates in a jurisdiction that restricts use of betting data.

**Boundary:** This subdocument governs market data specifically. General data governance (other providers, non-market features) is covered by NEXUS-0.

---

## S7. Separation of Edges

NEXUS targets forecasting edge only. Three types of edge must be kept conceptually and architecturally separate. Conflating them leads to design decisions that optimize for the wrong objective.

### S7.1 Forecasting Edge

**Definition:** The ability to estimate match outcome probabilities that are closer to the true generating distribution than a reference benchmark.

**Measurement:** RPS (Ranked Probability Score), Brier score, log-loss, calibration curves. Lower RPS = better forecasting.

**Benchmark:** Pinnacle closing line implied probabilities (de-vigged). Approximate RPS: 0.185-0.188 on major European leagues.

**This is the objective of NEXUS.** Every architectural decision in this spec serves this objective. A change that does not plausibly improve forecasting edge (or protect against its degradation) does not belong in NEXUS.

### S7.2 Market Edge (Closing Line Value)

**Definition:** The ability to capture odds at a price that is better than the eventual closing line. Measured as CLV (Closing Line Value): the expected profit if one could bet at the captured price and close at the closing price.

**Relationship to NEXUS:** Market edge is a *possible consequence* of forecasting edge. If NEXUS's probability estimates diverge from the market's implied probabilities, and NEXUS is correct more often than the market, then a hypothetical bettor who acts on NEXUS's outputs would realize positive CLV.

**Architectural implication:** NEXUS must not be designed to *maximize CLV directly*. Doing so would create a dependency on execution timing, odds availability, and bookmaker-specific pricing -- none of which are under NEXUS's control. NEXUS optimizes probability accuracy; CLV follows (or does not) as a downstream observation.

### S7.3 Execution Edge

**Definition:** The ability to monetize a forecasting or market edge through actual transactions (bets placed at favorable prices, managed bankroll, hedging, etc.).

**Scope:** Execution edge is entirely outside the scope of NEXUS and of SportPulse's predictive engine. SportPulse is a sports attention dashboard, not a betting platform. NEXUS produces probability estimates for informational and editorial purposes. No part of this spec or its subdocuments defines, encourages, or facilitates execution of bets.

---

## S8. Coexistence Policy: V3 and NEXUS

### S8.0 Relationship to the MVP Constitution

The SportPulse Constitution (`spec.sportpulse.core.constitution.md`) fixes football-data.org as the primary data source for the MVP and marks bookmaker odds and multi-provider reconciliation as out of scope for the MVP product line. NEXUS intentionally uses capabilities that exceed the MVP scope (API-Football as primary source, market signal as a first-class track, multi-provider entity resolution).

This is not a contradiction. The following rules govern the relationship:

1. **NEXUS operates outside the MVP product line until formal promotion.** While NEXUS is a challenger in shadow mode, it is not bound by the MVP scope restrictions. The MVP line continues to be served by V3, which conforms to the Constitution.
2. **During the challenger phase, NEXUS may use data sources and capabilities that are outside the MVP scope.** This includes API-Football as primary source (NEXUS-0 S4), bookmaker odds as a model track (Track 4), and multi-provider entity resolution.
3. **The Constitution does not restrict NEXUS while it is a challenger.** The MVP scope governs what is exposed to end users in production. Shadow predictions are internal and do not affect production output.
4. **At the moment of formal promotion (S7), the Constitution must be amended** to reflect the expanded data sources and capabilities that NEXUS brings to production. Alternatively, a separate product line definition may be created. Promotion cannot proceed without this constitutional amendment.
5. **No change in NEXUS as challenger affects the production MVP line.** V3 continues to use football-data.org as primary source and operates within MVP scope constraints. NEXUS's additional data ingestion does not alter V3's behavior (S8.4).

### S8.1 Shadow Mode

NEXUS runs in shadow mode alongside V3. "Shadow mode" means:

1. NEXUS receives the same inputs as V3 for every match V3 predicts.
2. NEXUS produces its own prediction output.
3. NEXUS predictions are persisted for offline evaluation but are **never exposed to end users** through the production API.
4. NEXUS predictions do not affect V3's output in any way.

### S8.2 Feature Flags

NEXUS activation is controlled by feature flags at the server level:

| Flag | Type | Default | Purpose |
|------|------|---------|---------|
| `NEXUS_SHADOW_ENABLED` | `string` (comma-separated competition IDs) | `""` (empty) | Which competitions run NEXUS shadow predictions |
| `NEXUS_INTERNAL_VIEW_ENABLED` | `string` | `""` | Which competitions expose NEXUS predictions in the internal debug API |
| `NEXUS_PROMOTED` | `boolean` | `false` | When `true`, NEXUS replaces V3 as the production engine. Requires promotion gate. |

These flags follow the same pattern as the existing V3 shadow flags (`PREDICTION_SHADOW_ENABLED`, `PREDICTION_INTERNAL_VIEW_ENABLED`).

### S8.3 Output Contract

NEXUS must produce output that conforms to the `V3PredictionOutput` interface (or a strict superset with only additive optional fields). This ensures that the promotion swap does not require frontend changes. The output contract version is tracked in the `engine_version` field.

NEXUS outputs use `engine_id: 'nexus'` and a version string that encodes the active tracks and meta-ensemble version. Example: `engine_version: 'nexus-1.0-T1T2T3-ME2'` (Tracks 1, 2, 3 active; meta-ensemble version 2).

### S8.4 Data Isolation

NEXUS may consume additional data sources beyond what V3 uses (e.g., player-level statistics, venue metadata). However:

1. NEXUS's additional data ingestion must not increase latency or API costs for V3's prediction path.
2. NEXUS's data store (the temporal feature store, NEXUS-0) is logically separate from V3's data flow. They share canonical match data but NEXUS-0 adds its own provenance layer.
3. If a shared data source fails, V3 must be unaffected. NEXUS may degrade to LIMITED or NOT_ELIGIBLE as defined in its own eligibility rules.

### S8.5 No Shared Mutable State

V3 and NEXUS must not share mutable runtime state. They may share:
- Immutable canonical data (match results, competition structures).
- Immutable configuration (league definitions, team ID mappings).
- The `buildNowUtc` anchor.

They must NOT share:
- Rating pools or Elo state.
- Calibration tables.
- Ensemble weights.
- Cache entries that one engine writes and the other reads.

---

## S9. Production Target Leagues

### S9.1 Primary Targets (Day 1)

| League | Code | Primary Provider | Fallback Provider | Status |
|--------|------|-----------------|-------------------|--------|
| LaLiga | PD | API-Football (v3) | football-data.org | Primary target |
| Premier League | PL | API-Football (v3) | football-data.org | Primary target |
| Bundesliga | BL1 | API-Football (v3) | football-data.org | Primary target |

These three leagues have the most complete data coverage (match results, xG backfill, market odds, injury data) and the largest existing calibration dataset.

**Note:** This table reflects the NEXUS challenger phase. API-Football is the primary data source for NEXUS (see NEXUS-0 S4.1) because it provides player-level data, injury reports, and lineup confirmations that football-data.org does not. football-data.org serves as a fallback for match results and competition structure. In production, the final data path depends on the promotion gate -- until promotion, the MVP product line continues to use football-data.org via V3.

### S9.2 Expansion Candidates

| League | Code | Condition for inclusion |
|--------|------|------------------------|
| Serie A | SA | 300+ forward validation samples with NEXUS shadow predictions |
| Ligue 1 | FL1 | Deferred. Data quality concerns (fewer market odds sources, inconsistent xG coverage). Re-evaluate after SA inclusion. |
| Liga Uruguaya | URU (4432) | Not a NEXUS target. Data sparsity (TheSportsDB free tier) makes player-level features infeasible. V3 continues for URU. |

### S9.3 Inclusion Gate

The authoritative expansion gate criteria are defined in `evaluation-and-promotion.md` S9.2. That document governs the specific thresholds, sample sizes, and conditions for league inclusion.

---

## S10. SDD Governance

### S10.1 Change Proposals

Changes to this master document or any NEXUS subdocument require a formal change proposal with:

1. **Change description:** What is being changed and where.
2. **Rationale:** Why the change is necessary, with quantitative evidence if applicable.
3. **Affected documents:** Which subdocuments are impacted.
4. **Version impacts:** Whether `modelVersion`, `ensembleVersion`, `featureSchemaVersion`, or `calibrationVersion` must be bumped.
5. **Acceptance matrix impacts:** Which test IDs are affected.
6. **Golden fixture impacts:** Which fixtures must be regenerated.
7. **Migration notes:** What changes are needed in code, configuration, or data.

### S10.2 Version Bumps

| Change type | Required version bump |
|-------------|----------------------|
| New track added to ensemble | `modelVersion` major bump |
| Track internal algorithm change | `modelVersion` minor bump |
| Meta-ensemble weight learning procedure change | `ensembleVersion` bump |
| Feature added/removed from Track 3 | `featureSchemaVersion` bump |
| Calibration methodology change | `calibrationVersion` bump |
| Feature store as-of semantics change | `featureStoreVersion` bump |
| Output contract field added (optional) | No bump required |
| Output contract field removed or type changed | `modelVersion` major bump |

### S10.3 Fixture Discipline

NEXUS has its own golden fixture set, separate from V3's. When a NEXUS golden fixture fails:

1. Identify which layer changed (feature store, track, ensemble, calibration).
2. Classify: bug, intentional change requiring version bump, or fixture defect.
3. Apply the same correction protocol as V3 (see `CLAUDE.md` Golden Fixture Discipline).

NEXUS fixtures are never used to validate V3, and V3 fixtures are never used to validate NEXUS.

### S10.4 Anti-Regression Rule

At no point during NEXUS development may V3's test suite, shadow runner, or production behavior be modified to accommodate NEXUS. If a shared module (e.g., canonical data normalization) must change for NEXUS, the change must be backward-compatible with V3. If backward compatibility is impossible, the change must be gated behind a feature flag.

---

## S11. What This Document Is NOT

1. **Not a replacement for the V3 spec.** The V3 spec remains authoritative for V3.
2. **Not a detailed model specification.** Track internals, feature lists, and hyperparameters belong in the subdocuments (S6.3 especially).
3. **Not an implementation guide.** This document defines *what* NEXUS is and *why*. Implementation details (file structure, class hierarchy, function signatures) are determined during Stage 3 by the implementing agent.
4. **Not a product roadmap.** This document does not define when NEXUS will be ready or what user-facing features it enables beyond improved prediction accuracy.
5. **Not a betting specification.** NEXUS targets forecasting edge for informational purposes. Execution edge is explicitly out of scope (S7.3).

---

*End of master specification.*
