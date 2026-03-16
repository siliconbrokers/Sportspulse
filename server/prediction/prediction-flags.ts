/**
 * PE-74: Feature flags for the Predictive Engine.
 * Configured via env vars — parsed once at module load.
 *
 * PREDICTION_SHADOW_ENABLED        — competition IDs in shadow execution mode
 * PREDICTION_INTERNAL_VIEW_ENABLED — competition IDs with internal inspection view
 * PREDICTION_EXPERIMENTAL_ENABLED  — competition IDs with experimental UI
 */

function parseCompetitionList(envVar: string | undefined): ReadonlySet<string> {
  if (!envVar) return new Set();
  return new Set(
    envVar
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  );
}

const shadowEnabled = parseCompetitionList(process.env.PREDICTION_SHADOW_ENABLED);
const internalViewEnabled = parseCompetitionList(process.env.PREDICTION_INTERNAL_VIEW_ENABLED);
const experimentalEnabled = parseCompetitionList(process.env.PREDICTION_EXPERIMENTAL_ENABLED);
const v2ShadowEnabled = parseCompetitionList(process.env.PREDICTION_V2_SHADOW_ENABLED);
const v3ShadowEnabled = parseCompetitionList(process.env.PREDICTION_V3_SHADOW_ENABLED);

/** Returns true if V1 shadow execution is enabled for this competition. */
export function isShadowEnabled(competitionId: string): boolean {
  return shadowEnabled.has(competitionId);
}

/** Returns true if internal inspection view is enabled for this competition. */
export function isInternalViewEnabled(competitionId: string): boolean {
  return internalViewEnabled.has(competitionId);
}

/** Returns true if experimental UI is enabled for this competition. */
export function isExperimentalEnabled(competitionId: string): boolean {
  return experimentalEnabled.has(competitionId);
}

/**
 * Returns true if V2 parallel-shadow execution is enabled for this competition.
 *
 * Controlled by env var PREDICTION_V2_SHADOW_ENABLED (comma-separated competition IDs).
 * V2 runs alongside V1; outputs stored in the unified PredictionStore with engine_id='v2_structural_attack_defense'.
 * SP-PRED-V2 §5.1
 */
export function isV2ShadowEnabled(competitionId: string): boolean {
  return v2ShadowEnabled.has(competitionId);
}

/**
 * Returns true if V3 parallel-shadow execution is enabled for this competition.
 *
 * Controlled by env var PREDICTION_V3_SHADOW_ENABLED (comma-separated competition IDs).
 * V3 runs alongside Radar without replacing it; outputs stored in PredictionStore with engine_id='v3_unified'.
 * SP-PRED-V3 §18
 */
export function isV3ShadowEnabled(competitionId: string): boolean {
  return v3ShadowEnabled.has(competitionId);
}

/**
 * THE_ODDS_API_KEY — enables OddsService for market edge tracking.
 * If not set, OddsService returns null silently for all matches.
 * Market odds are NEVER used to modify predictions — evaluation only.
 * MKT-T3-02 Fase A
 */
export const ODDS_API_ENABLED = !!process.env.THE_ODDS_API_KEY;
