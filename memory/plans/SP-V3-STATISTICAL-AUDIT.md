# SP-V3-STATISTICAL-AUDIT: Statistical & Mathematical Audit of Predictive Engine V3

**Date:** 2026-03-15
**Agent:** Architect (Opus)
**Scope:** Statistical analysis of `packages/prediction/src/engine/v3/`

---

## 1. Diagnosis of the Current Model

### 1.1 What the model does well

**Sound architectural choices:**
- Pure function pipeline with explicit anti-lookahead filtering. No IO, no Date.now(), no Math.random(). This is textbook determinism and makes backtesting trivially correct.
- Bayesian shrinkage toward league baseline (K_SHRINK=5) is the right approach for small-sample team stats. The formula `(n*observed + K*prior) / (n+K)` is a proper conjugate posterior mean under a Gamma-Poisson model.
- Exponential time-decay (xi=0.006, half-life ~115 days) is appropriate for capturing form evolution within a season while retaining sufficient history.
- Venue split with automatic fallback when games < 5 is practical and avoids high-variance estimates from tiny venue-specific samples.
- Dixon-Coles low-score correction addresses the known deficiency of independent Poisson for 0-0, 0-1, 1-0, 1-1 scores. This is the standard fix in the literature.
- Prior season information with dynamic alpha mixing (`games / (games + PRIOR_EQUIV_GAMES)`) correctly phases out the prior as current data accumulates. This is effectively an empirical Bayes approach.
- Rival adjustment that normalizes goals by opponent strength is directionally correct -- it addresses strength-of-schedule bias.
- The metrics module already implements Log Loss, Brier Score, and calibration buckets with proper coverage reporting. This is a strong evaluation foundation.
- Lambda clipping [0.3, 4.0] prevents degenerate predictions from extreme team estimates.

**Overall:** The model is a competent implementation of a classic Poisson-based football prediction engine with sensible Bayesian regularization. It would likely outperform naive baselines (historical frequencies, home-always) by a meaningful margin.

### 1.2 Questionable statistical assumptions

**A. Independent Poisson with post-hoc DC correction is not truly bivariate.**
The model computes marginal Poisson distributions then applies Dixon-Coles tau factors only to cells (0,0), (0,1), (1,0), (1,1). This is the standard DC approach, but it only corrects for excess correlation at low scores. For scores >= 2, goals are still assumed independent. In reality, match dynamics create correlation at all score levels (e.g., trailing team increases attacking intensity). The DC correction captures the most important part of this, but the assumption weakens for high-scoring games.

**B. Exponential decay treats all matches as point events at kickoff time.**
A match played 30 days ago and one played 31 days ago have essentially the same weight, but a match 1 day ago vs 30 days ago differ substantially. This is fine mathematically, but the decay rate xi=0.006 is fixed across all leagues. Leagues with longer breaks (URU with mid-season pauses) or compressed schedules (BL1 with 18 teams = fewer matches) may benefit from different decay rates.

**C. HOME_ADVANTAGE_MULT = 1.12 is a global constant applied uniformly.**
Home advantage varies significantly across leagues (Bundesliga ~1.05, South American leagues ~1.25+), across teams (some have negligible home advantage), and has been declining across European football over the past decade. A fixed 1.12 is a rough compromise that will be wrong for every individual team and league.

**D. League baseline uses simple average of goals, not time-weighted.**
`computeLeagueBaselines` computes `totalHomeGoals / count` without any time-decay, while team stats use decay. This creates an inconsistency: a team's relative strength is measured against a baseline that weights October and March equally, while the team's own stats weight March more heavily.

**E. Prior season stats use NO time-decay at all.**
`computePrevSeasonStats` weights all matches equally. A match from August of the previous season counts the same as one from May. For a 38-match season, the team's form could have changed dramatically. More recent previous-season matches should carry more weight.

### 1.3 Double-counting, redundancy, and mathematical inconsistencies

**CRITICAL: Recency delta is applied TWICE to lambdas.**

This is the most significant mathematical issue in the engine. In `lambda.ts` lines 71-74:
```
eff_attack_home  = effective_attack_home  * delta_attack_home;    // (1) deltas applied to effective forces
```
Then in lines 100-105:
```
rawLambdaHome = league_home_goals_pg
  * (eff_attack_home / league_goals_pg) ^ BETA_ATTACK              // eff_attack_home already has delta baked in
  * (eff_defense_away / league_goals_pg) ^ BETA_DEFENSE
  * delta_attack_home ^ BETA_RECENT                                  // (2) delta applied AGAIN as separate factor
  * delta_defense_away ^ BETA_RECENT;
```

The code comment on line 93-96 acknowledges this: "los deltas modulan las effective forces (par.10) Y ademas se aplican directamente en la formula lambda con BETA_RECENT (par.11)."

Mathematically, this means the effective contribution of recency is:
```
delta_attack^(1 + BETA_RECENT) = delta_attack^1.45
```

If delta_attack = 1.3 (a hot team), the actual boost is 1.3^1.45 = 1.46, not 1.3. If delta_attack = 0.7 (a cold team), the penalty is 0.7^1.45 = 0.58 instead of 0.7. This amplifies recency effects beyond what either par.10 or par.11 individually intend. Whether this is a bug or intentional design depends on whether the spec explicitly mandates both applications, but from a statistical standpoint, it creates an exaggerated sensitivity to recent form that will hurt calibration.

**MODERATE: Rival adjustment feeds back into itself circularly.**

In `v3-engine.ts` lines 180-205, `getOpponentEffective` computes the opponent's effective rates by running them through the full shrinkage + prior pipeline. But these opponent effective rates are themselves based on matches against other opponents whose rates were not rival-adjusted. The result is a one-level adjustment -- the team's signals are adjusted for opponent quality, but opponent quality is not itself adjusted for the quality of the opponents *they* faced.

This is not a bug per se (it avoids infinite recursion), but it means the rival adjustment is inconsistent: it is applied to the team of interest but not to the opponents used for normalization. A proper iterative approach (like Bradley-Terry or Elo) would converge to consistent ratings. The current approach is a reasonable approximation but can produce biased adjustments, especially for teams that have faced an unusually homogeneous set of opponents.

**MINOR: Shrinkage + Prior mixing creates double-regularization.**

The pipeline applies shrinkage (par.6) and then mixes with prior season (par.7). Both pull the estimate toward the league average. For a team with 5 games:
1. Shrinkage: `(5*observed + 5*league) / 10 = 0.5*observed + 0.5*league`
2. Prior mix: alpha = 5/(5+8) = 0.385 => `0.385*(0.5*observed + 0.5*league) + 0.615*prior`
   = `0.19*observed + 0.19*league + 0.615*prior`

The team's observed data contributes only 19% of the final estimate. This is extremely conservative for 5 games. If the prior is also league baseline (no previous season), the final estimate is ~81% league average, which means the model almost ignores team-specific information for early-season predictions.

This double-regularization is not necessarily wrong (it prevents overconfident early-season predictions) but it should be recognized as very aggressive. The K_SHRINK and PRIOR_EQUIV_GAMES parameters interact multiplicatively in a way that may not be intended.

---

## 2. Prioritized Improvements

### P1-01: Fix recency delta double-counting in lambda formula

**What changes:** In `lambda.ts`, remove the redundant multiplication by `delta_*^BETA_RECENT` in the lambda formula (lines 104-105, 111-112). The deltas are already applied to `eff_attack/defense` on lines 71-74. The lambda formula should use the adjusted effective rates without re-applying deltas.

**Why:** The current code applies recency as `delta^(1+BETA_RECENT) = delta^1.45`, which systematically over-weights recent form. This will produce over-confident predictions for teams on hot/cold streaks, hurting calibration. A team scoring 30% more in recent games gets a 46% boost instead of 30%. This is the single largest source of miscalibration in the engine.

**Alternative interpretation:** If the spec truly mandates both applications, then BETA_RECENT should be reduced from 0.45 to compensate, and the total effective exponent should be documented as intentional. Either way, the current formulation needs explicit justification.

**Impact:** HIGH -- directly affects every lambda computation, thus every probability output.
**Complexity:** LOW -- single file change, remove two multiplication factors.
**Priority:** P1

---

### P1-02: Estimate DC_RHO from data instead of using fixed -0.13

**What changes:** Add a function to estimate rho from the available match data using maximum likelihood (profile likelihood over a grid of rho values, or simple moment-based estimator). Use the estimated rho instead of the hardcoded DC_RHO = -0.13.

**Why:** The optimal rho varies by league and season. Published estimates range from -0.05 to -0.25 depending on the dataset. Using -0.13 for all leagues (LaLiga, Premier, Bundesliga, URU, ARG) is a compromise that is suboptimal for each. The estimation is straightforward: for a given rho, compute the DC likelihood over all observed matches and pick the rho that maximizes it. A simple grid search over [-0.25, 0.00] in steps of 0.01 is sufficient.

**Impact:** MEDIUM -- affects only low-score cells (0-0 through 1-1), but these represent ~30% of football outcomes.
**Complexity:** MEDIUM -- requires implementing a likelihood function and optimizer, plus storing per-league rho estimates.
**Priority:** P1

---

### P1-03: Add per-league HOME_ADVANTAGE_MULT estimation

**What changes:** Replace the fixed HOME_ADVANTAGE_MULT = 1.12 with a per-league estimate derived from the current season's data. When insufficient data, fall back to a league-specific prior (e.g., BL1=1.05, URU=1.20, PD=1.10, PL=1.08) rather than a single 1.12.

**Why:** Home advantage varies dramatically:
- Bundesliga is famously low (~1.03-1.08) due to stadium atmosphere being less decisive.
- South American leagues (URU, ARG) are much higher (~1.15-1.30) due to altitude, travel, crowd hostility.
- Post-COVID data showed home advantage dropped significantly and has only partially recovered.

The estimate is simple: `league_home_goals_pg / league_away_goals_pg` from the baseline already provides this ratio. The engine computes these baselines but then ignores them for home advantage, using a fixed 1.12 instead.

**Impact:** HIGH -- home advantage affects every match prediction. Mis-specifying it by 10% for a given league shifts all probabilities.
**Complexity:** LOW -- the data is already computed in league-baseline.ts.
**Priority:** P1

---

### P2-01: Apply time-decay to league baselines

**What changes:** In `league-baseline.ts`, use the same exponential decay used for team stats (DECAY_XI=0.006) when computing league averages. Replace simple `totalHomeGoals / count` with weighted averages.

**Why:** Currently, team stats use time-decay but league baselines do not. This means a team's relative attack strength (attack_td / league_goals_pg) is a ratio where the numerator is recent-form-weighted but the denominator is season-average-weighted. Early-season high-scoring weeks inflate the baseline, making recent team performance look weaker relative to the league than it actually is. Consistency between the numerator and denominator of relative strength metrics is fundamental.

**Impact:** MEDIUM -- affects all teams uniformly but improves the internal consistency of relative strength estimates.
**Complexity:** LOW -- reuse the existing decay function.
**Priority:** P2

---

### P2-02: Reduce double-regularization by making K_SHRINK and PRIOR_EQUIV_GAMES jointly calibrated

**What changes:** Either (a) reduce K_SHRINK from 5 to 2-3 to reflect that the prior mix already provides regularization, or (b) apply shrinkage and prior mixing as a single combined step with a single regularization strength. The combined effective regularization should be parameterized so that at 5 games, the team's observed data contributes ~35-45% (not 19% as currently).

**Why:** The sequential application of shrinkage (K=5) then prior mix (equiv_games=8) is mathematically equivalent to a single regularization step with an effective strength of K + equiv_games = 13 when prior is league baseline. This is extremely conservative. At 10 games, observed data still only contributes 10/(10+5) * 10/(10+8) = 0.37 -- barely over a third. The model essentially cannot differentiate teams until ~15+ games, which means the first 40% of most seasons produces near-identical predictions for all teams.

**Impact:** MEDIUM-HIGH -- affects early-season prediction quality significantly. For 30-38 match seasons, predictions for the first 7-10 matchdays will be more informative.
**Complexity:** LOW -- parameter tuning or formula consolidation.
**Priority:** P2

---

### P2-03: Add time-decay to prior season stats

**What changes:** In `prior.ts`, apply exponential decay to previous-season match records based on their distance from the end of the previous season (or from buildNowUtc). Matches from May should count more than matches from August.

**Why:** A team that finished the previous season on a 5-match winning streak is different from one that started strong and faded. The current flat average over all previous-season matches discards this temporal structure. Using decay with a longer half-life (e.g., 180-200 days for prior season, since the data is older and less relevant) would capture end-of-season form while still shrinking toward league average for very old matches.

**Impact:** MEDIUM -- affects early-season predictions when prior season data is most influential.
**Complexity:** LOW -- reuse existing time-decay code.
**Priority:** P2

---

### P2-04: Make THRESHOLD_ELIGIBLE adaptive by league size

**What changes:** Instead of fixed THRESHOLD_ELIGIBLE=7, compute it as a fraction of games played in the season. For example, min(7, ceil(total_season_matches / total_teams * 0.3)). For URU/ARG with shorter half-seasons or apertura/clausura splits, the threshold may need to be 4-5 to produce any eligible predictions in the first third of the season.

**Why:** THRESHOLD_ELIGIBLE=7 means the model produces no predictions at all for teams until matchday 7 (at minimum). For a 16-team league playing 30 matches per team, that is 23% of the season with NOT_ELIGIBLE status. Combined with the aggressive regularization, the model is essentially silent for the first quarter of the season. This is especially problematic for URU and ARG leagues where the total season may be shorter, and users expect predictions from early on.

**Impact:** MEDIUM -- increases prediction coverage without sacrificing much accuracy (the LOW confidence label already signals limited reliability).
**Complexity:** LOW -- simple parameter change with league awareness.
**Priority:** P2

---

### P2-05: Implement Ranked Probability Score (RPS) in metrics

**What changes:** Add RPS computation alongside Brier Score and Log Loss in `calibration-metrics.ts`. RPS = (1/2) * sum_r=1_to_R-1 [ (sum_j=1_to_r (p_j - o_j))^2 ] for ordered outcomes (HOME < DRAW < AWAY or equivalently by number of home goals relative to away goals).

**Why:** Brier Score and Log Loss treat the three outcomes as unrelated categories. RPS respects the ordinal nature of football outcomes: predicting "home win" when the actual result is "draw" is a smaller error than predicting "home win" when the result is "away win." RPS is the standard proper scoring rule for ordinal forecasts in sports prediction literature. Without RPS, you cannot properly benchmark against published football prediction models.

**Impact:** MEDIUM -- does not change predictions but enables proper model comparison and improvement measurement.
**Complexity:** LOW -- straightforward computation, ~20 lines.
**Priority:** P2

---

### P3-01: League-specific decay rates

**What changes:** Allow DECAY_XI to vary per league. Estimate it from historical data or use priors based on league characteristics (schedule density, break structure).

**Why:** A half-life of 115 days assumes that information from 4 months ago is half as relevant as today. For a league with a mid-season break (URU), a match just before the break is chronologically distant but may be the most recent competitive data. For compressed schedules (end-of-season fixture congestion), the decay should be faster because form changes more rapidly.

**Impact:** LOW-MEDIUM -- marginal improvement for most leagues, potentially significant for URU with its structural breaks.
**Complexity:** MEDIUM -- requires per-league configuration and potentially data-driven estimation.
**Priority:** P3

---

### P3-02: Iterative rival adjustment (Bradley-Terry-like convergence)

**What changes:** Instead of one-pass rival adjustment, iterate: compute all teams' effective rates, use those to adjust signals, recompute effective rates, repeat until convergence (typically 5-10 iterations).

**Why:** The current one-pass approach creates the circular dependency noted in section 1.3. An iterative approach converges to a fixed point where all teams' strengths are mutually consistent. However, the improvement over one-pass is typically small (1-3% in published studies) because the one-pass already captures most of the variance.

**Impact:** LOW -- marginal improvement, most of the value is already captured.
**Complexity:** MEDIUM -- requires restructuring the pipeline to iterate, with convergence check.
**Priority:** P3

---

### P3-03: Consider Negative Binomial for overdispersed leagues

**What changes:** Add an optional overdispersion parameter (r for Negative Binomial, which reduces to Poisson as r approaches infinity). Estimate r from data by comparing the observed variance of goals to the Poisson-expected variance (equal to the mean).

**Why:** If var(goals) > mean(goals) for a league (overdispersion), Poisson understates the probability of extreme scores and the draw probability. This is commonly observed in lower-quality leagues where match results are more variable. For top-5 European leagues, Poisson is generally adequate (overdispersion is mild, ~1.05-1.10x). For URU/ARG, overdispersion may be more significant.

**Impact:** LOW for PD/PL/BL1, potentially MEDIUM for URU/ARG.
**Complexity:** MEDIUM -- requires estimating r, implementing NegBin PMF, and modifying the matrix computation.
**Priority:** P3

---

## 3. Improvements NOT Worth Pursuing

### 3.1 Zero-Inflated Poisson (ZIP)
Zero-inflated models add a mixing parameter for a degenerate distribution at zero. In football, 0-0 draws represent ~7-8% of matches, which is already well-captured by Poisson with lambda ~1.3 (P(0) = e^{-1.3} ~ 27% per team). The Dixon-Coles correction already handles the excess correlation at zero. Adding ZIP would introduce two additional parameters per team with negligible improvement and risk overfitting with the small sample sizes available (30-38 games per season).

### 3.2 Bivariate Poisson
A full bivariate Poisson with covariance parameter lambda_3 is theoretically superior to independent Poisson + DC correction. However: (a) estimation of lambda_3 requires large samples (~500+ matches) for stability; (b) the model has identifiability issues when lambda_3 is close to zero; (c) published comparisons show DC performs comparably with far fewer parameters. Given 150-380 matches per league-season, bivariate Poisson would be underpowered and overparameterized.

### 3.3 Machine Learning models (Random Forest, XGBoost, Neural Networks)
These require large training datasets (thousands of matches) to outperform well-calibrated Poisson models. With 5 leagues of 30-38 matchdays (~150-380 matches per league-season), ML models would overfit badly. The Poisson framework's inductive bias (goals are rare events, teams have stable attack/defense rates) is more appropriate for this data regime. Additionally, ML models sacrifice the explainability that is central to SportPulse's product identity.

### 3.4 Player-level data integration
Incorporating player ratings, injuries, suspensions would require an additional data source, complex feature engineering, and constant maintenance. The marginal improvement over team-level Poisson models is estimated at 1-3% in Log Loss from published studies, at the cost of significant complexity and data dependency. Not worth it for the current scope.

### 3.5 Isotonic regression for calibration
Post-hoc calibration via isotonic regression requires a held-out calibration set of meaningful size (100+ predictions per bin). With the available data, the calibration set would be too small to estimate the isotonic mapping reliably, and the model would effectively overfit to the calibration set. The better approach is to fix the model's internal biases (P1-01 through P2-02) rather than papering over them with post-hoc calibration.

### 3.6 Dynamic (time-varying) Elo or state-space models
Models like dynamic Elo or Kalman-filter-based approaches continuously update team strength. However, the V3 engine already achieves something similar through time-decay + recency deltas. The marginal improvement of a formal state-space model is small and the implementation complexity is high. The spec explicitly states "Sin Elo en ningun paso" -- this is a deliberate design constraint.

---

## 4. Recommended Evaluation Metrics

### 4.1 Primary metrics (already implemented)

| Metric | What it measures | Target range |
|--------|-----------------|-------------|
| Log Loss | Sharpness + calibration of probabilities | < 1.00 (decent), < 0.95 (good), < 0.90 (excellent) |
| Brier Score | Mean squared error of 1X2 probabilities | < 0.60 (decent), < 0.55 (good) |
| Calibration buckets | Per-bucket |predicted - actual| | < 0.07 per populated bucket |
| Inclusive accuracy | Correct / total | > 0.40 (decent), > 0.45 (good) |
| Conditional accuracy | Correct / definite | > 0.50 (decent), > 0.55 (good) |

### 4.2 Metrics to add

| Metric | Formula | Why needed |
|--------|---------|-----------|
| **RPS (Ranked Probability Score)** | See P2-05 | Ordinal-aware proper scoring rule; the gold standard for football prediction evaluation |
| **Calibration slope & intercept** | Linear regression of actual_fraction ~ mean_predicted per class | Detects systematic over/under-confidence more precisely than buckets |
| **Skill score vs. baseline** | (LogLoss_baseline - LogLoss_model) / LogLoss_baseline | Measures improvement over a naive "always predict league averages" model |
| **ROI simulation** | Simulated returns against closing odds at unit stakes | Practical measure of whether probabilities identify value; not a formal metric but useful for intuition |

### 4.3 Evaluation methodology

**Temporal cross-validation:** For each matchday M, train on matchdays 1..M-1 and predict matchday M. Aggregate metrics over all predicted matchdays. Never use future data for evaluation. The V3 engine's anti-lookahead filter already enforces this.

**Per-confidence stratification:** Report all metrics separately for HIGH, MEDIUM, LOW confidence. This validates that the confidence system is informative (HIGH-confidence predictions should have lower Log Loss than LOW).

**Per-league reporting:** Report metrics separately per league. A model that is well-calibrated overall can still be badly calibrated for a specific league.

**Minimum sample size for evaluation:** At least 50 predictions (approximately 5 matchdays for a 20-team league) before reporting metrics. Below this, variance dominates.

---

## 5. Summary Priority Table

| ID | Improvement | Impact | Complexity | Priority |
|----|------------|--------|------------|----------|
| P1-01 | Fix recency delta double-counting in lambda formula | HIGH | LOW | **P1** |
| P1-02 | Estimate DC_RHO from data per league | MEDIUM | MEDIUM | **P1** |
| P1-03 | Per-league HOME_ADVANTAGE_MULT from baselines | HIGH | LOW | **P1** |
| P2-01 | Apply time-decay to league baselines | MEDIUM | LOW | **P2** |
| P2-02 | Reduce double-regularization (K_SHRINK + PRIOR_EQUIV_GAMES) | MEDIUM-HIGH | LOW | **P2** |
| P2-03 | Add time-decay to prior season stats | MEDIUM | LOW | **P2** |
| P2-04 | Adaptive THRESHOLD_ELIGIBLE by league | MEDIUM | LOW | **P2** |
| P2-05 | Implement RPS metric | MEDIUM | LOW | **P2** |
| P3-01 | League-specific decay rates | LOW-MEDIUM | MEDIUM | **P3** |
| P3-02 | Iterative rival adjustment | LOW | MEDIUM | **P3** |
| P3-03 | Negative Binomial for overdispersed leagues | LOW-MEDIUM | MEDIUM | **P3** |

**Recommended implementation order:** P1-01 -> P1-03 -> P2-01 -> P2-02 -> P1-02 -> P2-03 -> P2-05 -> P2-04 -> P3-*

The first three changes (fix double-counting, derive home advantage from data, time-decay baselines) are low-complexity and address the most impactful issues. They can be implemented, evaluated, and shipped in a single iteration before moving to the more nuanced P2 items.
