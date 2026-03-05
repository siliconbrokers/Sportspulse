import type { TeamScoreDTO } from '../dto/team-score.js';

/**
 * Deterministic sort: layoutWeight desc, teamId asc.
 * Per dashboard-snapshot-dto §2.2 and snapshot-engine §7.6.
 */
export function sortTeamsByWeight(teams: TeamScoreDTO[]): TeamScoreDTO[] {
  return [...teams].sort((a, b) => {
    if (b.layoutWeight !== a.layoutWeight) return b.layoutWeight - a.layoutWeight;
    return a.teamId.localeCompare(b.teamId);
  });
}
