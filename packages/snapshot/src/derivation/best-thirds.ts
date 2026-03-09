/**
 * computeBestThirds — proyección derivada de mejores terceros.
 *
 * Aplica a: GROUP_STAGE_PLUS_KNOCKOUT_WITH_BEST_THIRDS (Mundial 2026, AFCON).
 * Opera SOLO dentro de la misma competición — no cruza torneos.
 *
 * Criterios de ordenamiento (por precedencia):
 *   1. Puntos (desc)
 *   2. Diferencia de goles (desc)
 *   3. Goles a favor (desc)
 *   4. teamName alfabético (asc) — tiebreak determinista
 */
import type { StandingEntry } from '../data/data-source.js';

/**
 * Devuelve los mejores terceros de entre todos los grupos.
 *
 * @param standings - Lista COMPLETA de StandingEntry de la competición (todos los grupos).
 *                   Solo se consideran entradas con position === 3 y groupId definido.
 * @param count     - Cuántos mejores terceros clasifican (8 para WC 2026, 4 para AFCON).
 * @returns         Slice ordenado de los `count` mejores terceros.
 */
export function computeBestThirds(standings: StandingEntry[], count: number): StandingEntry[] {
  if (count <= 0) return [];

  const thirds = standings.filter((e) => e.position === 3 && e.groupId != null);

  return thirds
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
      if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
      return a.teamName.localeCompare(b.teamName); // determinista
    })
    .slice(0, count);
}
