/**
 * Forbidden dependency edges per Repo_Structure_and_Module_Boundaries spec §5-§6.
 * Used by lint rules and tests to enforce architectural boundaries.
 *
 * Note: spec §5 explicitly allows:
 * - signals depends on canonical models and shared
 * - scoring depends on shared and consumes signals outputs
 *
 * Spec §6 prohibits:
 * - scoring -> canonical ingestion adapters (policy must not depend on provider)
 * - signals -> provider ingestion adapters (signals consume canonical model only)
 *
 * The adapter-level prohibition is enforced via FORBIDDEN_PATH_PATTERNS below.
 */
export const FORBIDDEN_IMPORTS: Record<string, string[]> = {
  web: ['@sportpulse/scoring', '@sportpulse/layout', '@sportpulse/signals', '@sportpulse/canonical'],
  api: ['@sportpulse/canonical', '@sportpulse/signals', '@sportpulse/scoring', '@sportpulse/layout'],
  layout: ['@sportpulse/scoring', '@sportpulse/signals'],
};

/**
 * Path-level forbidden imports within allowed package dependencies.
 * Enforces that signals/scoring don't import provider adapters from canonical.
 */
export const FORBIDDEN_PATH_PATTERNS: Record<string, string[]> = {
  signals: ['ingest/football-data'],
  scoring: ['@sportpulse/canonical'],
};
