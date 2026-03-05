import type { DashboardSnapshotDTO } from '../dto/dashboard-snapshot.js';
import type { TeamDetailDTO } from '../dto/team-detail.js';

export function projectTeamDetail(
  snapshot: DashboardSnapshotDTO,
  teamId: string,
  dateLocal: string,
  timezone: string,
): TeamDetailDTO | null {
  const tile = snapshot.teams.find((t) => t.teamId === teamId);
  if (!tile) return null;

  return {
    header: {
      competitionId: snapshot.header.competitionId,
      seasonId: snapshot.header.seasonId,
      dateLocal,
      timezone,
      policyKey: snapshot.header.policyKey,
      policyVersion: snapshot.header.policyVersion,
      buildNowUtc: snapshot.header.buildNowUtc,
      computedAtUtc: snapshot.header.computedAtUtc,
      freshnessUtc: snapshot.header.freshnessUtc,
      warnings: snapshot.warnings,
      snapshotKey: snapshot.header.snapshotKey,
    },
    team: {
      teamId: tile.teamId,
      teamName: tile.teamName,
    },
    score: {
      rawScore: tile.rawScore,
      attentionScore: tile.attentionScore,
      displayScore: tile.displayScore,
      layoutWeight: tile.layoutWeight,
    },
    nextMatch: tile.nextMatch,
    explainability: {
      topContributions: tile.topContributions,
      signals: tile.signals,
    },
  };
}
