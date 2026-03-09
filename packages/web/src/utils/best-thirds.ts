import type { StandingEntry } from '../hooks/use-standings.js';

/**
 * Calcula los mejores terceros de una fase de grupos.
 * Criterios de desempate: puntos → diferencia de goles → goles a favor → nombre (alfabético).
 * Determinístico: mismo input siempre produce mismo output.
 */
export function computeBestThirds(standings: StandingEntry[], count: number): StandingEntry[] {
  if (count <= 0) return [];

  const thirds = standings.filter((e) => e.position === 3 && e.groupId != null);

  return thirds
    .slice()
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
      if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
      return a.teamName.localeCompare(b.teamName);
    })
    .slice(0, count);
}
