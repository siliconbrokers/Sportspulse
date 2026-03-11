/**
 * match-status — función centralizada de estado de partido.
 *
 * Fuente única de verdad para la lógica de zombie guard y detección LIVE.
 * Usada en: LiveCarousel.tsx, match-detail-viewmodel.ts, MatchCardList.tsx
 *
 * Reglas:
 *   - API dice IN_PROGRESS/PAUSED/LIVE + elapsed > 240 min → FINISHED (auto-terminado)
 *   - API dice IN_PROGRESS/PAUSED/LIVE + elapsed > 180 min → ZOMBIE  (pendiente de confirmación)
 *   - API dice IN_PROGRESS/PAUSED/LIVE + elapsed <= 180 min → LIVE
 *   - API dice FINISHED                                     → FINISHED
 *   - API dice POSTPONED/CANCELED                           → SCHEDULED
 *   - API dice SCHEDULED/TIMED/TBD + kickoff ya pasó (0-180 min)   → LIVE
 *   - API dice SCHEDULED/TIMED/TBD + kickoff ya pasó (180-240 min) → ZOMBIE
 *   - API dice SCHEDULED/TIMED/TBD + kickoff ya pasó (> 240 min)   → FINISHED
 *     (heurístico para proveedores que no actualizan status en tiempo real,
 *      como football-data.org free tier o OpenLigaDB — aplica a TODOS los proveedores)
 *   - API dice SCHEDULED/TIMED/TBD + kickoff futuro                 → SCHEDULED
 *   - Cualquier otro valor                                  → UNKNOWN
 */

export type DisplayMatchStatus =
  | 'LIVE' // EN VIVO confirmado (< 180 min)
  | 'ZOMBIE' // Pendiente de confirmación (180–240 min)
  | 'FINISHED' // Terminado (API o auto-terminado > 240 min)
  | 'SCHEDULED' // Próximo o cancelado/pospuesto
  | 'UNKNOWN'; // Estado no reconocido

/** Minutos tras el kickoff en que se activa el estado zombie */
export const ZOMBIE_THRESHOLD_MIN = 180;

/** Minutos tras el kickoff en que se auto-termina internamente */
export const AUTOFINISH_THRESHOLD_MIN = 240;

/**
 * Retorna el estado de visualización unificado de un partido.
 *
 * @param apiStatus  - Estado canónico de la API (IN_PROGRESS, FINISHED, SCHEDULED, etc.)
 * @param kickoffUtc - Hora de inicio del partido en UTC (ISO 8601). Puede ser null/undefined.
 */
export function getMatchDisplayStatus(
  apiStatus: string | null | undefined,
  kickoffUtc: string | null | undefined,
): DisplayMatchStatus {
  if (apiStatus === 'FINISHED') return 'FINISHED';

  if (apiStatus === 'POSTPONED' || apiStatus === 'CANCELED') {
    return 'SCHEDULED';
  }

  if (apiStatus === 'SCHEDULED' || apiStatus === 'TIMED' || apiStatus === 'TBD') {
    // Heurística universal: proveedores que no actualizan status en tiempo real
    // (football-data free tier, OpenLigaDB, etc.) mantienen SCHEDULED/TIMED durante el partido.
    // Si el kickoff ya pasó y estamos dentro de la ventana de juego, tratar como LIVE.
    if (kickoffUtc) {
      const elapsed = (Date.now() - new Date(kickoffUtc).getTime()) / 60_000;
      if (elapsed > AUTOFINISH_THRESHOLD_MIN) return 'FINISHED';
      if (elapsed > 0) {
        if (elapsed > ZOMBIE_THRESHOLD_MIN) return 'ZOMBIE';
        return 'LIVE';
      }
    }
    return 'SCHEDULED';
  }

  if (apiStatus === 'IN_PROGRESS' || apiStatus === 'PAUSED' || apiStatus === 'LIVE') {
    if (kickoffUtc) {
      const elapsed = (Date.now() - new Date(kickoffUtc).getTime()) / 60_000;
      if (elapsed > AUTOFINISH_THRESHOLD_MIN) return 'FINISHED';
      if (elapsed > ZOMBIE_THRESHOLD_MIN) return 'ZOMBIE';
    }
    return 'LIVE';
  }

  return 'UNKNOWN';
}

/** Helper: ¿está el partido en algún estado "activo" (live o zombie)? */
export function isMatchActive(status: DisplayMatchStatus): boolean {
  return status === 'LIVE' || status === 'ZOMBIE';
}
