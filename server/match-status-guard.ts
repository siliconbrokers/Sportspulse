/**
 * match-status-guard — zombie guard para normalización canónica en backend.
 *
 * Espeja la lógica de `getMatchDisplayStatus` del frontend (match-status.ts).
 * Propósito: corregir el status canónico de un partido cuando el proveedor
 * sigue reportando un status de "en juego" aunque el partido ya haya terminado
 * (e.g. TheSportsDB devuelve '2H' por horas; OpenLigaDB mantiene matchIsFinished=false).
 *
 * Umbrales:
 *   > 240 min desde kickoff → FINISHED  (auto-terminado)
 */

import { EventStatus } from '@sportpulse/canonical';

const AUTOFINISH_MS = 240 * 60 * 1000; // 240 min en ms

/**
 * Aplica el zombie guard a un status canónico.
 *
 * Si el status es IN_PROGRESS o SCHEDULED (usado por proveedores lentos durante el partido)
 * y ya transcurrieron más de 240 min desde el kickoff, devuelve FINISHED.
 * En cualquier otro caso devuelve el status original intacto.
 *
 * @param status       - Status canónico derivado del proveedor
 * @param startTimeUtc - Hora de inicio del partido en UTC (ISO 8601), puede ser null
 */
export function applyMatchStatusGuard(
  status: EventStatus,
  startTimeUtc: string | null,
): EventStatus {
  if (status === EventStatus.FINISHED || status === EventStatus.POSTPONED || status === EventStatus.CANCELED) {
    return status; // ya terminal, nada que corregir
  }
  if (!startTimeUtc) return status;

  const elapsed = Date.now() - new Date(startTimeUtc).getTime();
  if (elapsed > AUTOFINISH_MS) return EventStatus.FINISHED;

  return status;
}
