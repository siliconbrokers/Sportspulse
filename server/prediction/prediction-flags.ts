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

/** Returns true if shadow execution is enabled for this competition. */
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
