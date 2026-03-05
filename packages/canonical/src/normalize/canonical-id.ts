/**
 * Deterministic canonical ID generation.
 *
 * IDs are derived from provider key + provider entity ID to ensure:
 * - Idempotency: same provider data always produces same canonical ID
 * - Stability: IDs don't change across re-ingestion
 * - Traceability: ID encodes its origin
 *
 * Format: `{entityPrefix}:{providerKey}:{providerEntityId}`
 *
 * Spec refs:
 * - Data Normalization Spec §5 (Provider Mapping Model)
 * - Data Normalization Spec §14 (Idempotency Rules)
 * - Backend Architecture §10.1 (Idempotent upserts)
 */

export function canonicalId(
  entityPrefix: string,
  providerKey: string,
  providerEntityId: string | number,
): string {
  return `${entityPrefix}:${providerKey}:${providerEntityId}`;
}

export function competitionId(providerKey: string, providerCode: string): string {
  return canonicalId('comp', providerKey, providerCode);
}

export function seasonId(providerKey: string, providerSeasonId: string | number): string {
  return canonicalId('season', providerKey, providerSeasonId);
}

export function teamId(providerKey: string, providerTeamId: string | number): string {
  return canonicalId('team', providerKey, providerTeamId);
}

export function matchId(providerKey: string, providerMatchId: string | number): string {
  return canonicalId('match', providerKey, providerMatchId);
}
