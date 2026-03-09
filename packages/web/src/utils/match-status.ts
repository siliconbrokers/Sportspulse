/**
 * match-status — función centralizada de estado de partido.
 *
 * Fuente única de verdad para la lógica de zombie guard.
 * Usada en: LiveCarousel.tsx, match-detail-viewmodel.ts
 *
 * Reglas:
 *   - API dice IN_PROGRESS + elapsed > 240 min → FINISHED (auto-terminado)
 *   - API dice IN_PROGRESS + elapsed > 180 min → ZOMBIE  (pendiente de confirmación)
 *   - API dice IN_PROGRESS + elapsed <= 180 min → LIVE
 *   - API dice FINISHED                         → FINISHED
 *   - API dice SCHEDULED/POSTPONED/CANCELED     → SCHEDULED
 *   - Cualquier otro valor                       → UNKNOWN
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

  if (
    apiStatus === 'SCHEDULED' ||
    apiStatus === 'POSTPONED' ||
    apiStatus === 'CANCELED' ||
    apiStatus === 'TIMED' ||
    apiStatus === 'TBD'
  ) {
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
