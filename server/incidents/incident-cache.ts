/**
 * incident-cache — fachada pública sobre IncidentStore.
 *
 * Mantiene la misma firma que la versión anterior para compatibilidad
 * con incident-service.ts. Delega toda la lógica al IncidentStore.
 *
 * Cambio clave: las funciones ahora reciben el matchCore completo para
 * que el store pueda calcular la ruta jerárquica season/league.
 */
import { incidentStore } from './incident-store.js';
import type { IncidentSnapshot, MatchCoreInput } from './types.js';

export async function loadIncidentSnapshot(
  matchId: string,
  matchCore?: Pick<MatchCoreInput, 'competitionId' | 'kickoffUtc'>,
): Promise<IncidentSnapshot | null> {
  return incidentStore.load(matchId, matchCore?.competitionId, matchCore?.kickoffUtc);
}

export async function saveIncidentSnapshot(
  snapshot: IncidentSnapshot,
  matchCore: Pick<MatchCoreInput, 'competitionId' | 'kickoffUtc'>,
): Promise<void> {
  return incidentStore.save(snapshot, matchCore.competitionId, matchCore.kickoffUtc);
}
