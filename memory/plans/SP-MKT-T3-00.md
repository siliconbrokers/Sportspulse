# SP-MKT-T3-00 -- V3EngineInput Tier 3 Extension Design

**Stage:** 0-2 (Intake + Spec Alignment + Design Proposal)
**Author:** Architect (Opus)
**Date:** 2026-03-15
**Status:** READY FOR IMPLEMENTATION

---

## 1. Scope Statement

Extend `V3EngineInput` with 4 new **optional** inputs (xG, injuries, confirmed lineups, market odds) and define their integration points in the V3 pipeline. All inputs follow the **total optionality** principle: when undefined, the engine produces identical output to today. No existing tests are modified. No existing module signatures change in a breaking way.

---

## 2. Authoritative Spec References

| Document | Relevance |
|----------|-----------|
| Constitution v2.0 SS2 (Determinism) | Same inputs must produce same outputs. New optional fields must not break this. |
| Constitution v2.0 SS7 (Explainability) | Every signal must be traceable in V3Explanation. |
| Domain Glossary SS "buildNowUtc" | Temporal anchor. xG/injuries/lineups are point-in-time data keyed to buildNowUtc. |
| MVP Execution Scope v1.0 | PD/PL/BL1 have xG via API-Football. URU does not. |
| Repo Structure SS Module Boundaries | New modules must live within `packages/prediction/src/engine/v3/`. No cross-boundary imports. |
| SP-PRED-V3-Unified-Engine-Spec.md SS3 (Inputs), SS17 (Output) | Governs V3EngineInput shape and V3PredictionOutput/V3Explanation. |

---

## 3. Assumptions

1. **API-Football `/fixtures/statistics`** returns xG per team per fixture. The caller (composition root in `server/`) is responsible for fetching and transforming this into `XgRecord[]` before calling `runV3Engine`. The engine itself performs no IO.
2. **Injuries and lineups** are point-in-time snapshots. The caller fetches them close to kickoff and passes them in. The engine treats them as static facts.
3. **Market odds** come pre-normalized (vig removed). The caller handles vig removal. The engine receives clean implied probabilities that sum to 1.0.
4. **xG data is only available for FINISHED matches** in the historical record. It does not apply to the match being predicted.
5. **URU (TheSportsDB:4432) has no xG data.** The engine must degrade gracefully.
6. **engine_version remains `'3.0'`** for this change -- these are additive optional fields, not a semantic version bump. If calibration constants change, that triggers a `policyVersion` bump in the snapshot layer, not here.

---

## 4. New Types

### 4.1 XgRecord

```typescript
/**
 * xG data for a single historical match.
 * Keyed by the same (homeTeamId, awayTeamId, utcDate) triple as V3MatchRecord.
 * The engine joins XgRecord to V3MatchRecord by exact utcDate match.
 */
export interface XgRecord {
  /** Must match a V3MatchRecord.utcDate exactly */
  utcDate: string;
  homeTeamId: string;
  awayTeamId: string;
  /** Expected goals for the home team (>= 0) */
  xgHome: number;
  /** Expected goals for the away team (>= 0) */
  xgAway: number;
}
```

**Design rationale:** Keying by `utcDate + homeTeamId + awayTeamId` avoids introducing a new ID system. The engine joins xG to match records by this triple. If a match has no corresponding XgRecord, that match falls back to actual goals.

### 4.2 InjuryRecord

```typescript
export type AbsenceType = 'INJURY' | 'SUSPENSION' | 'DOUBTFUL';

export type PlayerPosition = 'GK' | 'DEF' | 'MID' | 'FWD';

/**
 * A single player absence for an upcoming match.
 */
export interface InjuryRecord {
  teamId: string;
  /** Player name (for traceability only -- not used in computation) */
  playerName: string;
  /** Positional group */
  position: PlayerPosition;
  /** Type of absence */
  absenceType: AbsenceType;
  /**
   * Estimated importance weight of the player (0..1).
   * 1.0 = star/key player, 0.0 = squad depth.
   * Derived externally (e.g., from minutes played ratio or market value).
   * The engine does not compute this -- it is an input.
   */
  importance: number;
}
```

**Design rationale:** The engine does not try to estimate player importance internally -- that would require squad data and minutes-played stats that belong to the caller. The `importance` field is a pre-computed scalar that the caller provides. `DOUBTFUL` players are weighted at 50% of their importance in the computation.

### 4.3 ConfirmedLineupRecord

```typescript
export interface LineupPlayer {
  playerName: string;
  position: PlayerPosition;
  /** true if this player is a regular starter (determined externally) */
  isRegularStarter: boolean;
}

/**
 * Confirmed XI for one team, available ~1h before kickoff.
 */
export interface ConfirmedLineupRecord {
  teamId: string;
  /** Exactly 11 players */
  players: LineupPlayer[];
}
```

**Design rationale:** The lineup supplements injuries. If a confirmed lineup is available and a known regular starter is absent (not in the XI), the engine treats this as an additional absence even if the injuries list did not capture it. The `isRegularStarter` flag is computed externally from historical lineup/minutes data.

### 4.4 MarketOddsRecord

```typescript
/**
 * Market-implied probabilities for 1X2, already de-vigged.
 * Must satisfy: probHome + probDraw + probAway = 1.0 (within 1e-6).
 */
export interface MarketOddsRecord {
  /** Implied probability of home win */
  probHome: number;
  /** Implied probability of draw */
  probDraw: number;
  /** Implied probability of away win */
  probAway: number;
  /** ISO-8601 UTC timestamp when these odds were captured */
  capturedAtUtc: string;
}
```

**Design rationale:** The engine receives a single snapshot of consensus odds. The caller is responsible for selecting the bookmaker, removing vig (e.g., multiplicative normalization), and timestamping the capture. The engine validates the sum constraint.

---

## 5. Extended V3EngineInput

```typescript
export interface V3EngineInput {
  // ── Existing fields (unchanged) ──────────────────────────────
  homeTeamId: string;
  awayTeamId: string;
  kickoffUtc: string;
  buildNowUtc: string;
  currentSeasonMatches: V3MatchRecord[];
  prevSeasonMatches: V3MatchRecord[];
  expectedSeasonGames?: number;

  // ── T3: New optional fields ──────────────────────────────────

  /**
   * T3-01: Historical xG data for matches in currentSeasonMatches.
   * If provided, the engine uses xG instead of actual goals in
   * computeTeamStatsTD and computeLeagueBaselines.
   * Partial coverage is OK: matches without a corresponding XgRecord
   * fall back to actual goals.
   */
  historicalXg?: XgRecord[];

  /**
   * T3-02: Known player absences (injuries + suspensions) for the
   * match being predicted. Applies a multiplicative adjustment to
   * lambda_home / lambda_away post-lambda computation.
   */
  injuries?: InjuryRecord[];

  /**
   * T3-03: Confirmed XI for home and/or away team.
   * Available ~1h before kickoff. Complements injuries by detecting
   * last-minute absences of regular starters.
   * Array of 0, 1, or 2 entries (one per team).
   */
  confirmedLineups?: ConfirmedLineupRecord[];

  /**
   * T3-04: Market-implied 1X2 probabilities (de-vigged).
   * Enters the prior system as an optional third component,
   * blended with the model's own 1X2 via a configurable weight.
   */
  marketOdds?: MarketOddsRecord;
}
```

---

## 6. Pipeline Integration Points

### Overview: Current Pipeline with T3 Insertion Points

```
 1. anti-lookahead filter
 2. computeLeagueBaselines      <-- [T3-01] xG variant
 3. resolveTeamStats (TD)       <-- [T3-01] xG variant
 4. applyShrinkage
 5. buildPrior / mixWithPrior
 6. computeMatchSignalsRA
 7. computeRecencyDeltas
 8. computeV3Lambdas
 9. restMultiplier               (T2-01)
10. computeH2HAdjustment         (T2-02)
11. computeGoalForm              (T2-03)
12. [NEW] computeInjuryMultiplier  <-- [T3-02 + T3-03]
13. lambda clamp (final)
14. computePoissonMatrix
15. [NEW] blendWithMarketOdds      <-- [T3-04]
16. computeMarkets
17. output assembly
```

### 6.1 T3-01: historicalXg -- xG-augmented stats

**Where:** Steps 2 and 3 (computeLeagueBaselines, computeTeamStatsTD / resolveTeamStats)

**Effect type:** REPLACES data source (goals -> xG) at the per-match level.

**New module:** `xg-augment.ts`

**Mechanism:**
- A new pure function `augmentMatchesWithXg(matches: V3MatchRecord[], xgRecords: XgRecord[]): V3MatchRecord[]` creates a new array where, for each match that has a corresponding XgRecord (joined by `utcDate + homeTeamId + awayTeamId`), `homeGoals` and `awayGoals` are replaced by `xgHome` and `xgAway`.
- This augmented array is passed to `computeLeagueBaselines` and `resolveTeamStats` instead of the raw `currentFiltered`.
- Matches without xG data retain their actual goals (graceful partial coverage).
- The **original** `currentFiltered` (with real goals) is still used for: `computeH2HAdjustment` (H2H uses actual results), `daysToLastMatch` (rest uses dates only), `computeGoalForm` (form uses actual goals for complementary info).

**When undefined:** `augmentMatchesWithXg` returns the original array unchanged. Zero cost, zero behavioral change.

**Constants:**
- None new. The existing DECAY_XI, MIN_GAMES_VENUE, etc. apply identically to xG-augmented data.

**Explanation fields:**
```typescript
/** true if xG data was available and used in stats computation. */
xg_used: boolean;
/** Number of matches in currentSeason that had xG data. */
xg_coverage_matches: number;
/** Total matches in currentSeason (for coverage ratio). */
xg_total_matches: number;
```

### 6.2 T3-02 + T3-03: injuries + confirmedLineups -- Absence Multiplier

**Where:** Step 12 (new step, after T2-02 H2H, before final lambda clamp)

**Effect type:** MULTIPLICATIVE on lambda_home / lambda_away.

**New module:** `absence-adjustment.ts`

**Mechanism:**

1. Collect all absences for each team:
   - From `injuries[]`: each record contributes `importance * typeWeight` where `typeWeight` is 1.0 for INJURY/SUSPENSION, 0.5 for DOUBTFUL.
   - From `confirmedLineups[]`: for each team's lineup, identify regular starters (`isRegularStarter = true`) who are NOT in the XI. Cross-reference with `injuries[]` to avoid double-counting players already listed as injured. Each unlisted regular starter contributes a default importance of 0.4 (configurable constant `LINEUP_MISSING_STARTER_IMPORTANCE`).

2. Compute weighted absence score per team:
   ```
   absence_score = SUM(importance_i * typeWeight_i) for all absences
   ```

3. Convert to multiplier:
   ```
   raw_mult = 1 - (absence_score * ABSENCE_IMPACT_FACTOR)
   mult = clamp(raw_mult, ABSENCE_MULT_MIN, 1.0)
   ```

4. Constants:
   - `ABSENCE_IMPACT_FACTOR = 0.04` -- each unit of weighted absence reduces lambda by 4%
   - `ABSENCE_MULT_MIN = 0.85` -- max penalty is -15% (catastrophic injury crisis)
   - `LINEUP_MISSING_STARTER_IMPORTANCE = 0.4` -- default importance for starters detected missing only via lineup

5. The multiplier is applied AFTER rest and H2H multipliers, BEFORE the final clamp:
   ```
   lambdaHomeFinal = clamp(
     lambdaBase * restMult * h2hMult * absenceMult,
     LAMBDA_MIN, LAMBDA_MAX
   )
   ```

**When undefined:** If both `injuries` and `confirmedLineups` are undefined, `computeAbsenceMultiplier` returns `{ mult: 1.0, applied: false, ... }`. No effect.

**Explanation fields:**
```typescript
/** Weighted absence score for home team (0 = no absences). */
absence_score_home: number;
/** Weighted absence score for away team. */
absence_score_away: number;
/** Multiplier applied to lambda_home (1.0 = no adjustment). */
absence_mult_home: number;
/** Multiplier applied to lambda_away (1.0 = no adjustment). */
absence_mult_away: number;
/** true if any absence data was provided and produced a non-1.0 multiplier. */
absence_adjustment_applied: boolean;
/** Number of absent players counted for home team. */
absence_count_home: number;
/** Number of absent players counted for away team. */
absence_count_away: number;
/** true if confirmed lineup was used to detect additional absences. */
lineup_used_home: boolean;
/** true if confirmed lineup was used to detect additional absences. */
lineup_used_away: boolean;
```

### 6.3 T3-04: marketOdds -- Market Prior Blend

**Where:** Step 15 (new step, after Poisson matrix, before computeMarkets)

**Effect type:** BLENDS model 1X2 probabilities with market-implied 1X2.

**New module:** `market-blend.ts`

**Mechanism:**

This is a **post-Poisson probability blend**, not a lambda-level adjustment. Rationale: market odds encode information (team news, motivation, form) that the model cannot capture. Blending at the probability level is cleaner than trying to reverse-engineer lambda adjustments from odds.

1. Validate `marketOdds`: `|probHome + probDraw + probAway - 1.0| < 1e-4`. If invalid, skip and log warning.

2. Blend:
   ```
   blended_prob_H = (1 - MARKET_WEIGHT) * model_prob_H + MARKET_WEIGHT * market_prob_H
   blended_prob_D = (1 - MARKET_WEIGHT) * model_prob_D + MARKET_WEIGHT * market_prob_D
   blended_prob_A = (1 - MARKET_WEIGHT) * model_prob_A + MARKET_WEIGHT * market_prob_A
   ```
   Then renormalize (defensive, should already sum to 1.0).

3. Recompute `predicted_result` and `favorite_margin` from blended probabilities.

4. **Markets output** (`computeMarkets`) still uses the ORIGINAL Poisson matrix (not blended). Rationale: O/U, BTTS, scoreline markets are derived from the lambda-based Poisson matrix which is structurally richer than 1X2 odds. The blend only affects the top-level 1X2 and predicted_result.

5. Constants:
   - `MARKET_WEIGHT = 0.15` -- model dominates (85%), market acts as regularizer
   - `MARKET_WEIGHT_MAX = 0.30` -- hard ceiling (no configuration can exceed this)

**When undefined:** If `marketOdds` is undefined, the Poisson 1X2 is used directly. Zero change.

**Explanation fields:**
```typescript
/** true if market odds were provided and blended into 1X2 probabilities. */
market_blend_applied: boolean;
/** Weight given to market odds in the blend (0 = pure model). */
market_blend_weight: number;
/** Model's raw 1X2 before blending (for traceability). */
model_prob_home_pre_blend: number | null;
model_prob_draw_pre_blend: number | null;
model_prob_away_pre_blend: number | null;
/** Market odds as received (for traceability). */
market_prob_home: number | null;
market_prob_draw: number | null;
market_prob_away: number | null;
```

---

## 7. Updated V3Explanation (Full)

The following fields are ADDED to the existing `V3Explanation` interface. All existing fields remain unchanged.

```typescript
// ── T3-01: xG augmentation ──────────────────────────────────────
xg_used: boolean;
xg_coverage_matches: number;
xg_total_matches: number;

// ── T3-02 + T3-03: Absence adjustment ──────────────────────────
absence_score_home: number;
absence_score_away: number;
absence_mult_home: number;
absence_mult_away: number;
absence_adjustment_applied: boolean;
absence_count_home: number;
absence_count_away: number;
lineup_used_home: boolean;
lineup_used_away: boolean;

// ── T3-04: Market blend ─────────────────────────────────────────
market_blend_applied: boolean;
market_blend_weight: number;
model_prob_home_pre_blend: number | null;
model_prob_draw_pre_blend: number | null;
model_prob_away_pre_blend: number | null;
market_prob_home: number | null;
market_prob_draw: number | null;
market_prob_away: number | null;
```

**Default values (when T3 inputs are undefined):**
- `xg_used: false`, `xg_coverage_matches: 0`, `xg_total_matches: <count of currentFiltered>`
- `absence_score_home: 0`, `absence_score_away: 0`, `absence_mult_home: 1.0`, `absence_mult_away: 1.0`, `absence_adjustment_applied: false`, `absence_count_home: 0`, `absence_count_away: 0`, `lineup_used_home: false`, `lineup_used_away: false`
- `market_blend_applied: false`, `market_blend_weight: 0`, all `*_pre_blend` and `market_prob_*`: `null`

---

## 8. Degradation Strategy by League

### Problem
URU (TheSportsDB:4432) has no xG data via API-Football. PD/PL/BL1 have xG but coverage may be partial (early season, API failures).

### Strategy

The degradation is handled entirely at the **caller level** (composition root in `server/`), not inside the engine. The engine simply receives what it gets.

| League | historicalXg | injuries | confirmedLineups | marketOdds |
|--------|:----------:|:--------:|:---------------:|:----------:|
| PD     | YES        | YES      | YES             | YES        |
| PL     | YES        | YES      | YES             | YES        |
| BL1    | YES        | YES      | YES             | YES        |
| URU    | NO (undefined) | NO (API-Football not available) | NO | YES (The Odds API covers URU) |

**Engine-internal degradation:**
- `augmentMatchesWithXg` with empty/undefined xG: returns original matches. `xg_used = false`.
- `computeAbsenceMultiplier` with undefined injuries+lineups: returns `mult = 1.0`. `absence_adjustment_applied = false`.
- `blendWithMarketOdds` with undefined odds: returns model probabilities unchanged. `market_blend_applied = false`.

**Explanation traceability:** The `xg_used` field in V3Explanation tells the consumer (and any future calibration pipeline) whether this prediction was xG-backed or goals-backed. This is critical for:
1. Fair comparison: predictions with xG and without xG should be evaluated separately.
2. Confidence adjustment: a future T4 could boost confidence when `xg_used = true`.

---

## 9. New Warning Codes

```typescript
export type V3Warning =
  | 'TAIL_MASS_EXCEEDED'
  | 'NO_VENUE_SPLIT'
  | 'NO_PRIOR'
  | 'FALLBACK_BASELINE'
  // T3 warnings:
  | 'XG_PARTIAL_COVERAGE'    // xG provided but covers < 50% of matches
  | 'MARKET_ODDS_INVALID'    // marketOdds provided but sum != 1.0
  | 'ABSENCE_DATA_STALE'     // reserved for future: injuries fetched > 24h ago
  ;
```

---

## 10. Files to Create/Modify

### New files (within `packages/prediction/src/engine/v3/`):
| File | Purpose |
|------|---------|
| `xg-augment.ts` | `augmentMatchesWithXg()` -- joins XgRecord to V3MatchRecord |
| `absence-adjustment.ts` | `computeAbsenceMultiplier()` -- injuries + lineup -> multiplier |
| `market-blend.ts` | `blendWithMarketOdds()` -- post-Poisson 1X2 blend |

### Modified files:
| File | Change |
|------|--------|
| `types.ts` | Add XgRecord, InjuryRecord, ConfirmedLineupRecord, MarketOddsRecord, AbsenceType, PlayerPosition, LineupPlayer interfaces. Extend V3EngineInput with 4 optional fields. Extend V3Explanation with 18 new fields. Extend V3Warning union. |
| `v3-engine.ts` | Import new modules. Call `augmentMatchesWithXg` after anti-lookahead. Call `computeAbsenceMultiplier` after H2H. Call `blendWithMarketOdds` after Poisson. Wire new explanation fields. |
| `constants.ts` | Add ABSENCE_IMPACT_FACTOR, ABSENCE_MULT_MIN, LINEUP_MISSING_STARTER_IMPORTANCE, MARKET_WEIGHT, MARKET_WEIGHT_MAX, XG_PARTIAL_COVERAGE_THRESHOLD. |
| `index.ts` | Re-export new types and modules. |

### Files NOT modified:
- `league-baseline.ts` -- receives augmented matches array, no internal change.
- `team-stats.ts` -- receives augmented matches array, no internal change.
- `rest-adjustment.ts` -- uses original matches (dates only), no change.
- `h2h-adjustment.ts` -- uses original matches (actual goals for H2H), no change.
- `goal-form.ts` -- uses original matches (actual goals for form), no change.
- `prior.ts`, `shrinkage.ts`, `lambda.ts`, `poisson-matrix.ts`, `markets.ts` -- no change.

---

## 11. New Constants

```typescript
// ── T3-01: xG ──────────────────────────────────────────────────
/** Coverage threshold below which XG_PARTIAL_COVERAGE warning fires. */
export const XG_PARTIAL_COVERAGE_THRESHOLD = 0.5;

// ── T3-02/03: Absences ─────────────────────────────────────────
/** Lambda reduction per unit of weighted absence score. */
export const ABSENCE_IMPACT_FACTOR = 0.04;
/** Maximum lambda penalty from absences (mult floor). */
export const ABSENCE_MULT_MIN = 0.85;
/** Default importance for a regular starter detected missing only via lineup diff. */
export const LINEUP_MISSING_STARTER_IMPORTANCE = 0.4;
/** Weight factor for DOUBTFUL players (vs 1.0 for confirmed absent). */
export const DOUBTFUL_WEIGHT = 0.5;

// ── T3-04: Market blend ─────────────────────────────────────────
/** Weight of market odds in the 1X2 blend (0 = pure model, 1 = pure market). */
export const MARKET_WEIGHT = 0.15;
/** Hard ceiling for market weight (safety). */
export const MARKET_WEIGHT_MAX = 0.30;
/** Tolerance for market odds sum validation. */
export const MARKET_ODDS_SUM_TOLERANCE = 1e-4;
```

---

## 12. Acceptance Test Mapping

| Test ID | Description | Module |
|---------|-------------|--------|
| T3-01a | `augmentMatchesWithXg` with full xG coverage: all goals replaced by xG | xg-augment.ts |
| T3-01b | `augmentMatchesWithXg` with partial coverage: only matched records use xG | xg-augment.ts |
| T3-01c | `augmentMatchesWithXg` with undefined/empty xG: output === input | xg-augment.ts |
| T3-01d | `runV3Engine` with xG: explanation.xg_used = true, xg_coverage reported | v3-engine.ts |
| T3-01e | `runV3Engine` without xG: identical output to current engine (regression) | v3-engine.ts |
| T3-02a | `computeAbsenceMultiplier` with 3 injuries: correct weighted score + mult | absence-adjustment.ts |
| T3-02b | `computeAbsenceMultiplier` with DOUBTFUL: 50% weight applied | absence-adjustment.ts |
| T3-02c | `computeAbsenceMultiplier` clamp at ABSENCE_MULT_MIN | absence-adjustment.ts |
| T3-02d | `computeAbsenceMultiplier` with no injuries: mult = 1.0 | absence-adjustment.ts |
| T3-03a | Lineup detects missing regular starter not in injuries | absence-adjustment.ts |
| T3-03b | Lineup + injuries: no double counting of same player | absence-adjustment.ts |
| T3-03c | No lineup, no injuries: absence_adjustment_applied = false | absence-adjustment.ts |
| T3-04a | `blendWithMarketOdds` with valid odds: blended probs correct | market-blend.ts |
| T3-04b | `blendWithMarketOdds` with invalid sum: returns model probs + warning | market-blend.ts |
| T3-04c | `blendWithMarketOdds` with undefined odds: no change | market-blend.ts |
| T3-04d | `runV3Engine` with marketOdds: explanation traces pre-blend and market values | v3-engine.ts |
| T3-REG | Full regression: `runV3Engine` with NO T3 fields === current output for all existing test cases | v3-engine.ts |

---

## 13. Version Impact Analysis

| Artifact | Current | After T3-00 | Reason |
|----------|---------|-------------|--------|
| `engine_version` | `'3.0'` | `'3.0'` (unchanged) | Additive optional fields, no semantic change for existing callers. |
| `V3Explanation` shape | 26 fields | 44 fields | New fields have defaults. No breaking change for consumers that spread/destructure. |
| `V3Warning` union | 4 members | 7 members | Additive. |
| `policyVersion` (snapshot layer) | No change | No change (yet) | Policy version bumps when calibration constants are tuned based on T3 data. Not at the design stage. |
| `snapshotSchemaVersion` | 2 | No change | The snapshot DTO exposes `V3PredictionOutput` which grows additively. |

---

## 14. Top 3 Risks

### Risk 1: xG-goals inconsistency in baselines vs team stats

**Description:** If `augmentMatchesWithXg` is applied to both `computeLeagueBaselines` and `resolveTeamStats`, the ratio `team_attack / league_avg` remains meaningful (both numerator and denominator use xG). However, if xG coverage is partial (e.g., 60%), the league baseline mixes xG and actual goals, which could create a systematic bias -- xG tends to be lower variance than actual goals.

**Mitigation:** In `augmentMatchesWithXg`, only augment matches that have xG data. The league baseline naturally adapts because it is a weighted average of the same augmented array. Monitor `xg_coverage_matches / xg_total_matches` in explanation and fire `XG_PARTIAL_COVERAGE` warning below 50%. The future calibration pipeline should evaluate model accuracy segmented by xG coverage ratio.

### Risk 2: Absence multiplier overfit to star-player absences

**Description:** The `importance` field is externally provided and could be noisy or biased. If the caller over-estimates a player's importance, the lambda penalty is too large. The 4% impact factor and 85% floor are guardrails, but a team with 4 "key players" out at importance=0.8 each would hit the floor immediately (score = 3.2, mult = 1 - 3.2*0.04 = 0.872 -> clamped to 0.85).

**Mitigation:** The floor at 0.85 (-15%) is a hard safety net. Additionally, the test suite should verify that even extreme injury scenarios do not swing 1X2 probabilities by more than ~10 percentage points. The `ABSENCE_IMPACT_FACTOR` is a tunable constant that can be adjusted via calibration without touching engine logic.

### Risk 3: Market blend undermines model independence

**Description:** If market odds are always available and always blended at 15%, the engine's output becomes partially dependent on bookmaker consensus. This reduces the value of the model as an independent signal and makes calibration feedback loops harder (model adjusts toward market, market reflects model, ...).

**Mitigation:** (a) `MARKET_WEIGHT = 0.15` is deliberately small -- the model drives 85% of the output. (b) The explanation stores both pre-blend model probabilities and market probabilities, allowing post-hoc analysis of model-vs-market divergence. (c) The weight is a constant in `constants.ts`, easily zeroed out for shadow/evaluation runs. (d) The hard ceiling `MARKET_WEIGHT_MAX = 0.30` prevents configuration drift.

---

## 15. Implementation Plan (Ordered)

Each step is a separate PR-able unit. Dependencies are sequential within the list.

### Step 1: Types + Constants (T3-00-types)
- Modify `types.ts`: add all new interfaces, extend V3EngineInput, extend V3Explanation, extend V3Warning.
- Modify `constants.ts`: add all new constants.
- Modify `index.ts`: re-export new types.
- Update `buildNotEligibleOutput` in `v3-engine.ts` to include default values for all new explanation fields.
- **Tests:** T3-REG (regression -- all existing tests must pass with new default fields).

### Step 2: xG Augmentation (T3-01)
- Create `xg-augment.ts`.
- Modify `v3-engine.ts`: call `augmentMatchesWithXg` after anti-lookahead, pass augmented array to baselines and team-stats.
- **Tests:** T3-01a through T3-01e.

### Step 3: Absence Adjustment (T3-02 + T3-03)
- Create `absence-adjustment.ts`.
- Modify `v3-engine.ts`: call `computeAbsenceMultiplier` after H2H, include in lambda chain.
- **Tests:** T3-02a through T3-02d, T3-03a through T3-03c.

### Step 4: Market Blend (T3-04)
- Create `market-blend.ts`.
- Modify `v3-engine.ts`: call `blendWithMarketOdds` after Poisson, recompute predicted_result from blended probs.
- **Tests:** T3-04a through T3-04d.

### Step 5: Integration Tests + Regression Lock
- Full-pipeline tests with all 4 T3 inputs provided.
- Full-pipeline tests with NO T3 inputs (bit-exact match with current golden outputs).
- Combination tests (xG + injuries, injuries + market, etc.).

---

## 16. Definition of Done for MKT-T3-00

1. This design document is reviewed and approved.
2. All new interfaces are defined in `types.ts` and compile cleanly.
3. All new constants are defined in `constants.ts`.
4. Three new modules (`xg-augment.ts`, `absence-adjustment.ts`, `market-blend.ts`) exist with pure functions and full JSDoc.
5. `v3-engine.ts` orchestrates the new steps in the correct pipeline order.
6. `buildNotEligibleOutput` includes default values for all new V3Explanation fields.
7. All tests in the T3 test matrix (section 12) pass.
8. **Regression lock:** `runV3Engine` with no T3 fields produces bit-exact output for all existing test fixtures.
9. `pnpm build` succeeds. `pnpm -r test` shows 0 failures.
10. No existing test is modified (only new tests added).

---

## 17. Handoff

Implementation should be executed by **match-prediction-engine** agent (Sonnet tier) for Steps 2-4, and **predictive-engine-qa** agent (Sonnet tier) for Step 5. Step 1 (types + constants) can be handled by either agent.

The caller-side integration (fetching xG/injuries/lineups/odds from APIs and constructing V3EngineInput in `server/`) is a separate task (MKT-T3-CALLER) to be designed after T3-00 implementation is complete.
