/**
 * Forbidden dependency edges per Repo_Structure_and_Module_Boundaries spec §6.
 * Used by lint rules and tests to enforce architectural boundaries.
 */
export const FORBIDDEN_IMPORTS: Record<string, string[]> = {
  web: ['@sportpulse/scoring', '@sportpulse/layout', '@sportpulse/signals', '@sportpulse/canonical'],
  api: ['@sportpulse/canonical', '@sportpulse/signals', '@sportpulse/scoring', '@sportpulse/layout'],
  layout: ['@sportpulse/scoring', '@sportpulse/signals'],
  scoring: ['@sportpulse/canonical'],
  signals: ['@sportpulse/canonical'],
};
