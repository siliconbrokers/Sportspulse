import type { TeamScoreDTO, LayoutMetadata } from '../types/snapshot.js';
import { TeamTile } from './TeamTile.js';

interface TreemapCanvasProps {
  teams: TeamScoreDTO[];
  layout: LayoutMetadata;
  focusedTeamId: string | null;
  onSelectTeam: (teamId: string) => void;
}

export function TreemapCanvas({ teams, layout, focusedTeamId, onSelectTeam }: TreemapCanvasProps) {
  const { width, height } = layout.container;

  return (
    <div
      data-testid="treemap-canvas"
      style={{
        position: 'relative',
        width,
        height,
        margin: '0 auto',
      }}
    >
      {teams.map((team) => (
        <TeamTile
          key={team.teamId}
          team={team}
          focused={team.teamId === focusedTeamId}
          dimmed={focusedTeamId !== null && team.teamId !== focusedTeamId}
          onClick={onSelectTeam}
        />
      ))}
    </div>
  );
}
