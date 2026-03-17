---
artifact_id: SPEC-SPORTPULSE-RADAR-V2-PREDICTION-INTEGRATION
title: "Radar SportPulse — Prediction Integration Specification v2"
artifact_class: spec
status: draft
version: 2.0.0
project: sportpulse
domain: radar/prediction
slug: radar-v2-prediction-integration
owner: team
created_at: 2026-03-16
updated_at: 2026-03-16
canonical_path: docs/specs/prediction/radar/Version 2/spec.sportpulse.radar-v2-prediction-integration.md
supersedes:
  - radar-07-prediction-integration.md
related_artifacts:
  - docs/specs/spec.sportpulse.radar-v2-core.md
  - docs/specs/spec.sportpulse.radar-v2-json-contracts-and-lifecycle.md
  - docs/specs/spec.sportpulse.radar-v2-editorial-rendering-policy.md
  - docs/specs/spec.sportpulse.radar-v2-ui-ux-spec.md
  - docs/specs/spec.sportpulse.radar-v2-qa-acceptance-and-edge-cases.md
  - docs/specs/spec.sportpulse.prediction.engine.md
---

# Radar SportPulse — Prediction Integration Specification v2

## 1. Purpose

This document defines how Radar v2 integrates with the SportPulse Match Prediction Engine.

Its purpose is to make Radar and the predictor operate as one coherent product without collapsing them into the same module.

The integration must preserve all three truths at the same time:

- **Radar truth**: editorial prioritization and pre/post-match reading
- **Prediction truth**: quantitative probability output and operating discipline
- **Historical truth**: frozen pre-match snapshot plus append-only post-match contrast

This specification replaces the old integration draft that treated probabilities as an attached layer and allowed a Radar-local fallback probability model.

## 2. Why this integration exists

SportPulse is explicitly designed as a product that combines:

- a relevance/attention layer,
- a public predictive engine with track record,
- and an honest post-match verification loop.

Radar therefore must not remain disconnected from the predictor.
At the same time, the predictor must not dissolve Radar into a generic probability widget.

## 3. Scope

This document covers:

- the architectural relationship between Radar v2 and the predictor,
- the data contract Radar consumes from `PredictionResponse v1`,
- the family-level gating rules inside Radar,
- the extension of Radar snapshot contracts,
- rendering and UI exposure rules,
- lifecycle and historical immutability rules,
- QA and migration rules,
- deprecation of the legacy Radar probability bridge.

## 4. Explicitly out of scope

This document does **not** define:

- the internal math of the predictor,
- Elo, Poisson, calibration, or score matrix implementation,
- competition engine rules,
- public track record page design,
- subscription packaging,
- external betting or odds integrations.

## 5. Source-of-truth precedence

If documents conflict, precedence is mandatory:

1. `spec.sportpulse.prediction.engine.md`
2. `spec.sportpulse.radar-v2-core.md`
3. `spec.sportpulse.radar-v2-json-contracts-and-lifecycle.md`
4. `spec.sportpulse.radar-v2-editorial-rendering-policy.md`
5. `spec.sportpulse.radar-v2-ui-ux-spec.md`
6. `spec.sportpulse.radar-v2-qa-acceptance-and-edge-cases.md`
7. this document
8. `radar-07-prediction-integration.md` as archived historical reference only

The old `radar-07-prediction-integration.md` must not be treated as the governing integration contract anymore.

## 6. Architectural principle

### 6.1 Separation of responsibilities

The predictor is the **canonical quantitative engine**.
Radar is the **canonical editorial and diagnostic layer**.
The Competition Engine remains the **canonical structural-context layer**.

Therefore:

- Radar does **not** calculate or own probabilities as a primary responsibility.
- Radar does **not** duplicate predictive math when the predictor is available.
- Radar does **consume** predictor outputs and converts them into editorially constrained reading, prioritization, and diagnosis.

### 6.2 Prohibited architecture

The following are prohibited as target architecture:

- a Radar-local probability engine that competes with the real predictor,
- a Radar-local Poisson + Dixon-Coles fallback as the normal path,
- a frontend that reconstructs Radar logic from predictor fields,
- a single flat “probability comment” layer that replaces Radar editorial reading.

### 6.3 Permitted transitional architecture

A legacy fallback may exist only as a temporary migration bridge when the predictor snapshot is unavailable for a match that Radar still needs to render.

If such a bridge exists temporarily, it must:

- be explicitly marked as fallback,
- never outrank the real predictor,
- never be presented as equivalent to canonical predictor output,
- remain removable.

## 7. Product-level outcome of the integration

After integration:

- Radar still answers **why this match matters**;
- the predictor answers **what is quantitatively more likely**;
- the user can see both without confusion;
- post-match verification can contrast both the editorial reading and the quantitative reading without rewriting history.

## 8. Canonical integration model

Radar v2 must consume prediction output through a formal prediction context block.

Conceptually:

- Competition Engine provides structural context;
- Prediction Engine provides quantitative context;
- Radar resolves cards using both, under explicit gating.

## 9. Mandatory consumed contract: `PredictionResponse v1`

Radar integration must consume the predictor through `PredictionResponse v1` or a thin adapter that is lossless with respect to the required fields.

### 9.1 Minimum required fields

Radar must be able to read, per match:

- `match_id`
- `eligibility_status`
- `operating_mode`
- `applicability_level`
- `reasons`
- `predictions.core`
  - `p_home_win`
  - `p_draw`
  - `p_away_win`
  - `expected_goals_home`
  - `expected_goals_away`
  - `predicted_result`
  - `predicted_result_conflict`
  - `favorite_margin`
  - `draw_risk`
- `predictions.secondary` when available
  - `over_2_5`
  - `under_2_5`
  - `btts_yes`
  - `btts_no`
  - `low_scoring_risk`
  - team totals / clean sheets / win-to-nil where needed
- `predictions.explainability` when available
  - `most_likely_scoreline`
  - `top_scorelines`

### 9.2 Canonical origin discipline

Radar must respect the predictor’s source discipline:

- **1X2-consistent visible outputs** come from the calibrated/core family
- **goal/scoreline/rhythm outputs** come from raw-derived families (`secondary` / `explainability`)

Radar must not mix these two families casually in validation or rendering.

## 10. Prediction context inside Radar

Radar must extend its internal model with a prediction context block per candidate match.

Recommended contract:

```ts
PredictionContextForRadar {
  matchId: string;

  eligibilityStatus: "ELIGIBLE" | "NOT_ELIGIBLE";
  operatingMode: "FULL_MODE" | "LIMITED_MODE" | "NOT_ELIGIBLE";
  applicabilityLevel: "STRONG" | "CAUTION" | "WEAK";
  predictorReasons: string[];

  core?: {
    pHomeWin: number;
    pDraw: number;
    pAwayWin: number;
    expectedGoalsHome: number;
    expectedGoalsAway: number;
    predictedResult: "HOME" | "DRAW" | "AWAY" | "TOO_CLOSE";
    predictedResultConflict: boolean;
    favoriteMargin: number;
    drawRisk: number;
  } | null;

  secondary?: {
    over25?: number | null;
    under25?: number | null;
    bttsYes?: number | null;
    bttsNo?: number | null;
    lowScoringRisk?: number | null;
    teamHomeOver05?: number | null;
    teamAwayOver05?: number | null;
    teamHomeOver15?: number | null;
    teamAwayOver15?: number | null;
    cleanSheetHome?: number | null;
    cleanSheetAway?: number | null;
    winToNilHome?: number | null;
    winToNilAway?: number | null;
  } | null;

  explainability?: {
    mostLikelyScoreline?: string | null;
    topScorelines?: { score: string; p: number }[] | null;
  } | null;
}
```

This block may be persisted in detail snapshots, but the Radar snapshot must not become a full predictor dump.

## 11. Family anchoring rules after integration

Integration changes how Radar families are grounded.

### 11.1 CONTEXT family

`CONTEXT` remains primarily driven by:

- competitive importance,
- matchday relevance,
- standings or knockout implications,
- underexposed-but-worthwhile selection logic.

It may be informed by predictor confidence, but predictor output must not dominate `CONTEXT`.

### 11.2 DYNAMICS family

`DYNAMICS` must now be strongly anchored to predictor outputs related to match shape.

#### `PARTIDO_ABIERTO`

May use:

- expected goals total,
- `over_2_5`,
- `btts_yes`,
- team scoring probabilities,
- low-control/open-shape internal Radar signals.

#### `DUELO_CERRADO`

May use:

- expected goals total,
- `under_2_5`,
- `low_scoring_risk`,
- `draw_risk`,
- constrained or low-margin internal Radar signals.

### 11.3 MISALIGNMENT family

`MISALIGNMENT` must now be grounded in explicit tension between surface/context reading and predictor reading.

#### `SENAL_DE_ALERTA`

May use:

- fragility of the superficially favored side,
- low favorite margin despite surface comfort,
- high opponent competitiveness signals,
- unstable 1X2 balance relative to public surface narrative.

#### `PARTIDO_ENGANOSO`

Must require stronger evidence than `SENAL_DE_ALERTA`.

Use only when there is a real contradiction between:

- surface expectation,
- Radar context/heuristics,
- and predictor reading.

It must not be used for simple parity.

## 12. Gating rules

This is the most important operational change.

### 12.1 `NOT_ELIGIBLE`

If predictor returns:

- `eligibility_status = NOT_ELIGIBLE`
- `operating_mode = NOT_ELIGIBLE`

Then Radar must obey all of the following:

- no quantitative outputs are exposed from predictor,
- no `DYNAMICS` strong reading may be generated from missing predictions,
- no `MISALIGNMENT` strong reading may be generated,
- Radar should prefer `CONTEXT` labels or conservative degradation,
- any residual card must avoid implying quantitative certainty.

### 12.2 `LIMITED_MODE`

If predictor returns `LIMITED_MODE`:

- `predictions.core` remains available and usable,
- `secondary` and `explainability` may be partial or null,
- Radar may use analytical families, but conservatively,
- copy must be softer,
- missing prediction fields must not be silently invented,
- reasons should surface that the reading is operating under reduced confidence.

### 12.3 `FULL_MODE`

If predictor returns `FULL_MODE`:

- Radar may fully consume `core`, `secondary`, and `explainability`,
- analytical families are fully available,
- UI may expose stronger integrated reading,
- post-match diagnosis may compare Radar and predictor more directly.

### 12.4 Applicability overlay

`applicability_level` must further modulate behavior:

- `STRONG` → normal integrated operation
- `CAUTION` → softer copy and more restrained analytical certainty
- `WEAK` → avoid confident analytical phrasing even if some fields exist

## 13. Legacy Radar thresholds

Standalone Radar thresholds may continue to exist as internal editorial heuristics, but after integration they are no longer sufficient on their own for analytical authority.

Therefore:

- thresholds may still help activate candidates,
- but final analytical exposure must be gated by predictor mode and applicability,
- old v1 precedence and thresholds are demoted to secondary inputs, not governing laws.

## 14. Snapshot contract extension

Radar snapshot contracts must be extended, not replaced.

### 14.1 Index-level principle

`radar-index.json` must remain lightweight and render-oriented.
It may expose summary integrated fields, but not full predictor internals.

### 14.2 Match-detail principle

`radar-match-<id>.json` may carry richer integrated fields.
Still, it must stay editorially focused.

### 14.3 Required integrated fields at card-detail level

Recommended additions:

```json
{
  "predictionContext": {
    "eligibilityStatus": "ELIGIBLE",
    "operatingMode": "FULL_MODE",
    "applicabilityLevel": "STRONG",
    "predictorReasons": ["..."],
    "core": {
      "pHomeWin": 0.51,
      "pDraw": 0.27,
      "pAwayWin": 0.22,
      "expectedGoalsHome": 1.54,
      "expectedGoalsAway": 0.94,
      "predictedResult": "HOME",
      "predictedResultConflict": false,
      "favoriteMargin": 0.24,
      "drawRisk": 0.27
    },
    "secondary": {
      "over25": 0.54,
      "under25": 0.46,
      "bttsYes": 0.49,
      "bttsNo": 0.51,
      "lowScoringRisk": 0.34
    },
    "explainability": {
      "mostLikelyScoreline": "1-0"
    }
  }
}
```

### 14.4 `NOT_ELIGIBLE` persistence rule

If the predictor is `NOT_ELIGIBLE`, Radar may only persist:

- `eligibilityStatus`
- `operatingMode`
- `applicabilityLevel`
- `predictorReasons`

It must not persist visible probabilities, lambdas, score matrices, or predictor-derived quantitative fields.

## 15. Rendering rules after integration

### 15.1 Editorial chain remains closed

The editorial chain remains:

`label -> subtype -> template -> render -> sanitize`

Predictor integration must enrich the evidence behind the chosen label, not replace this chain with free-form probability commentary.

### 15.2 No bookmaker tone

Even after integration, Radar copy must not sound like:

- betting advice,
- odds-shopping,
- a confidence scam,
- a probability ticker pretending to be a tipster.

### 15.3 Acceptable integrated editorial framing

Allowed:

- “el favoritismo parece menos limpio de lo que sugiere la superficie”
- “hay señales de partido más abierto de lo que la previa vende”
- “la distancia de tabla no alcanza para volverlo un trámite”

Forbidden:

- “apuesta al over”
- “valor claro para apostar”
- “65% asegurado”
- “local fijo”

### 15.4 Quantitative rendering separation

If the product chooses to render visible probability outputs in Radar cards or related match widgets, those must be visually separated from editorial copy.

The user must be able to distinguish:

- **Radar editorial reading**
- **predictor numerical output**

These are complementary layers, not one merged sentence.

## 16. Lifecycle and historical immutability

### 16.1 Pre-match freeze remains absolute

The original Radar `preMatchText` remains frozen after publication.
Integration with predictor does not weaken this law.

### 16.2 No retroactive predictor overwrite

If predictor outputs change later due to recalibration, regeneration, or backfill, historical Radar snapshots must not be silently rewritten as if they had always said that.

### 16.3 Append-only post-match diagnosis

Post-match fields may append:

- Radar verdict
- integrated diagnostic note
- predictor outcome alignment state

But they must not rewrite the original pre-match editorial reading.

## 17. UI rules after integration

### 17.1 Radar remains an editorial section

Radar does not become a generic probabilities grid.
It remains a focused section above the fixture list.

### 17.2 Primary label survives

Radar cards still show:

- one primary visible label,
- optional secondary badges,
- editorial text,
- optional quantitative companion block.

### 17.3 Quantitative companion block

If exposed, a compact quantitative block may include:

- 1X2 visible probabilities,
- predicted result,
- expected goals,
- most likely scoreline,
- applicability badge.

This block must:

- come directly from the predictor contract,
- remain compact,
- not dominate the editorial block,
- not appear when the predictor is `NOT_ELIGIBLE`.

### 17.4 Applicability visibility

The product may expose a restrained visual cue for `STRONG/CAUTION/WEAK`, but it must not become a pseudo-certification badge.

## 18. QA rules for the integration

Integration QA must add all of the following on top of existing Radar QA:

### 18.1 Contract QA

Verify that Radar consumes valid `PredictionResponse v1` shapes and rejects impossible or contradictory integrated states.

### 18.2 Gating QA

Verify at minimum:

- `NOT_ELIGIBLE` produces no visible quantitative outputs,
- `LIMITED_MODE` keeps `core` but tolerates partial secondary fields,
- `FULL_MODE` exposes integrated fields completely,
- `WEAK` softens analytical copy,
- `STRONG` allows full analytical integration.

### 18.3 Source-discipline QA

Verify that:

- 1X2 presentation uses calibrated/core values,
- goals/BTTS/scoreline presentation uses raw-derived families,
- no algebraic 1X2 invariant is misused to validate goal-family fields.

### 18.4 Historical QA

Verify that:

- pre-match text does not mutate across state transitions,
- predictor integration does not silently rewrite historical Radar snapshots,
- rebuilds remain explicitly marked.

### 18.5 UI QA

Verify that:

- frontend still does not derive labels, reasons, verdicts, or analytical states,
- editorial and quantitative blocks are visually distinguishable,
- failure in the integrated prediction block does not kill the Radar section if safe editorial rendering is still possible.

## 19. Migration rules

### 19.1 `radar-07` status after approval of this spec

`radar-07-prediction-integration.md` must be reclassified as:

- archived integration draft,
- historical design reference,
- non-governing document.

### 19.2 Compatibility strategy

Permitted:

- adapters from legacy probability field names (`probHomeWin`, etc.) to `predictionContext.core`,
- coexistence during migration,
- transitional readers.

Forbidden:

- presenting fallback Radar-local probability output as if it were canonical predictor output,
- keeping duplicate long-term truth sources.

### 19.3 Legacy fields

Legacy flat fields such as:

- `probHomeWin`
- `probDraw`
- `probAwayWin`

may be supported temporarily, but the target contract is `predictionContext`.

## 20. Acceptance criteria

This integration is correct only if all of the following are true:

1. Radar remains snapshot-driven and editorially coherent.
2. The predictor is the only canonical quantitative engine.
3. The old Radar-local probability bridge is no longer the target architecture.
4. `NOT_ELIGIBLE`, `LIMITED_MODE`, and `FULL_MODE` materially change Radar behavior.
5. Radar analytical families are gated by predictor validity.
6. Raw/calibrated discipline is preserved end-to-end.
7. Historical pre-match truth remains frozen.
8. Frontend remains a renderer, not a reasoning layer.
9. Users can distinguish editorial reading from quantitative reading.
10. The architecture is ready for public track record and honest pre/post verification.

## 21. Failure modes

The integration must be considered wrong if any of these are true:

- Radar still computes probabilities as its normal path while the predictor exists,
- analytical labels fire identically under `NOT_ELIGIBLE` and `FULL_MODE`,
- `WEAK` predictor contexts still generate strong editorial certainty,
- goal-family outputs are derived from calibrated 1X2 logic,
- 1X2 display comes from raw-only values instead of calibrated/core,
- frontend derives or rewrites analytical meaning,
- integrated rendering becomes betting-like,
- historical snapshots are silently rewritten after predictor changes.

## 22. Closing principle

The point of this integration is not to make Radar “more numerical.”
The point is to make the whole product more honest, more diagnosable, and more useful.

Radar keeps the narrative.
The predictor keeps the math.
History keeps the evidence.
