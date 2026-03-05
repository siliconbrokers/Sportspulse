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

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`tile-${team.teamId}`}
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
        border: focused ? '2px solid #fbbf24' : '1px solid rgba(255,255,255,0.2)',
        borderRadius: 4,
        opacity: dimmed ? 0.5 : 1,
        transition: 'transform 120ms ease, opacity 120ms ease',
        cursor: 'pointer',
        overflow: 'hidden',
        padding: 6,
        boxSizing: 'border-box',
        color: '#fff',
        fontSize: rect.w < 80 ? 11 : 13,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.transform = 'scale(1.03)';
        (e.currentTarget as HTMLElement).style.zIndex = '10';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
        (e.currentTarget as HTMLElement).style.zIndex = '1';
      }}
    >
      <span style={{ fontWeight: 600, textAlign: 'center', lineHeight: 1.2 }}>{label}</span>
      {showNext && team.nextMatch?.opponentName && (
        <span style={{ fontSize: 10, opacity: 0.8, marginTop: 2, textAlign: 'center' }}>
          vs {team.nextMatch.opponentName}
        </span>
      )}
    </div>
  );
}
