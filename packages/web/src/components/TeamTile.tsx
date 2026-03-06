import type { TeamScoreDTO } from '../types/snapshot.js';
import { venueLabel } from '../utils/labels.js';

interface TeamTileProps {
  team: TeamScoreDTO;
  focused: boolean;
  dimmed: boolean;
  onClick: (teamId: string) => void;
}

/**
 * Heat-map color based on displayScore (0–1 range).
 * High score → warm red/orange, mid → yellow, low → cool blue/teal.
 */
function getHeatColor(score: number): string {
  if (score >= 0.8) return 'rgba(239, 68, 68, 0.9)';   // red
  if (score >= 0.6) return 'rgba(249, 115, 22, 0.85)';  // orange
  if (score >= 0.4) return 'rgba(234, 179, 8, 0.8)';    // yellow
  if (score >= 0.2) return 'rgba(34, 197, 94, 0.75)';   // green
  return 'rgba(59, 130, 246, 0.7)';                      // blue (cold)
}

function getTextColor(score: number): string {
  if (score >= 0.4 && score < 0.6) return '#1e293b'; // dark text on yellow
  return '#fff';
}

function getTileLabel(team: TeamScoreDTO, w: number, h: number): string {
  if (w < 50 || h < 30) {
    return team.teamName.slice(0, 3).toUpperCase();
  }
  return team.teamName;
}

function buildTooltip(team: TeamScoreDTO): string {
  const lines = [team.teamName, `Puntuación: ${Math.round(team.displayScore * 100)}%`];
  if (team.nextMatch?.opponentName) {
    const venue = team.nextMatch.venue ? ` (${venueLabel(team.nextMatch.venue)})` : '';
    lines.push(`Próximo: vs ${team.nextMatch.opponentName}${venue}`);
  }
  return lines.join('\n');
}

const CREST_SIZE = 22;

function Crest({ url, alt }: { url?: string; alt: string }) {
  if (!url) return null;
  return (
    <img
      src={url}
      alt={alt}
      style={{
        width: CREST_SIZE,
        height: CREST_SIZE,
        objectFit: 'contain',
        flexShrink: 0,
      }}
    />
  );
}

export function TeamTile({ team, focused, dimmed, onClick }: TeamTileProps) {
  const { rect } = team;
  const label = getTileLabel(team, rect.w, rect.h);
  const score = Math.round(team.displayScore * 100);
  const textColor = getTextColor(team.displayScore);
  const showCrests = rect.w >= 100 && rect.h >= 50 && team.nextMatch;

  // Determine which crest goes left (home) and right (away)
  const isHome = team.nextMatch?.venue === 'HOME';
  const homeCrest = isHome ? team.crestUrl : team.nextMatch?.opponentCrestUrl;
  const awayCrest = isHome ? team.nextMatch?.opponentCrestUrl : team.crestUrl;

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`tile-${team.teamId}`}
      className="team-tile"
      title={buildTooltip(team)}
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
        backgroundColor: getHeatColor(team.displayScore),
        border: focused ? '2px solid #fbbf24' : '1px solid rgba(255,255,255,0.15)',
        borderRadius: 6,
        opacity: dimmed ? 0.4 : 1,
        cursor: 'pointer',
        overflow: 'hidden',
        padding: 8,
        boxSizing: 'border-box',
        color: textColor,
        fontSize: rect.w < 80 ? 11 : 13,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      <div>
        <div style={{ fontWeight: 700, lineHeight: 1.2, marginBottom: 2 }}>{label}</div>
        {team.nextMatch?.opponentName && rect.w >= 80 && rect.h >= 40 && (
          <div style={{ fontSize: 10, opacity: 0.7 }}>
            vs {team.nextMatch.opponentName}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        {showCrests ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Crest url={homeCrest} alt="Local" />
            <span style={{ fontSize: 9, opacity: 0.5 }}>vs</span>
            <Crest url={awayCrest} alt="Visitante" />
          </div>
        ) : (
          <span />
        )}
        {rect.w >= 60 && rect.h >= 50 && (
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            {score}%
          </span>
        )}
      </div>
    </div>
  );
}
