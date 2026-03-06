import type { TeamScoreDTO } from '../types/snapshot.js';

interface TeamTileProps {
  team: TeamScoreDTO;
  focused: boolean;
  dimmed: boolean;
  onClick: (teamId: string) => void;
}

function getOpacity(displayScore: number): number {
  if (displayScore >= 70) return 1.0;
  if (displayScore >= 30) return 0.8;
  return 0.6;
}

function getTileLabel(team: TeamScoreDTO, w: number, h: number): string {
  if (w < 50 || h < 30) {
    return team.teamName.slice(0, 3).toUpperCase();
  }
  return team.teamName;
}

function shouldShowNextMatch(w: number, h: number): boolean {
  return w >= 80 && h >= 40;
}

export function TeamTile({ team, focused, dimmed, onClick }: TeamTileProps) {
  const { rect } = team;
  const label = getTileLabel(team, rect.w, rect.h);
  const showNext = shouldShowNextMatch(rect.w, rect.h);
  const score = Math.round(team.displayScore * 100);

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`tile-${team.teamId}`}
      className="team-tile"
      onClick={() => onClick(team.teamId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClick(team.teamId);
      }}
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        backgroundColor: `rgba(59, 130, 246, ${getOpacity(team.displayScore)})`,
        border: focused ? '2px solid #fbbf24' : '1px solid rgba(255,255,255,0.15)',
        borderRadius: 6,
        opacity: dimmed ? 0.4 : 1,
        cursor: 'pointer',
        overflow: 'hidden',
        padding: 8,
        boxSizing: 'border-box',
        color: '#fff',
        fontSize: rect.w < 80 ? 11 : 13,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      <div>
        <div style={{ fontWeight: 700, lineHeight: 1.2, marginBottom: 2 }}>{label}</div>
        {showNext && team.nextMatch?.opponentName && (
          <div style={{ fontSize: 10, opacity: 0.7 }}>
            vs {team.nextMatch.opponentName}
          </div>
        )}
      </div>
      {rect.w >= 60 && rect.h >= 50 && (
        <div style={{ fontSize: 11, opacity: 0.6, textAlign: 'right' }}>
          {score}%
        </div>
      )}
    </div>
  );
}
