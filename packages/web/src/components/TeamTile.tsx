import type { TeamScoreDTO } from '../types/snapshot.js';
import { venueLabel } from '../utils/labels.js';

interface TeamTileProps {
  team: TeamScoreDTO;
  focused: boolean;
  dimmed: boolean;
  onClick: (teamId: string) => void;
}

function getHeatColor(score: number): string {
  if (score >= 0.8) return 'rgba(239, 68, 68, 0.9)';
  if (score >= 0.6) return 'rgba(249, 115, 22, 0.85)';
  if (score >= 0.4) return 'rgba(234, 179, 8, 0.8)';
  if (score >= 0.2) return 'rgba(34, 197, 94, 0.75)';
  return 'rgba(59, 130, 246, 0.7)';
}

function getTextColor(score: number): string {
  if (score >= 0.4 && score < 0.6) return '#1e293b';
  return '#fff';
}

function getTileLabel(team: TeamScoreDTO, w: number, h: number): string {
  if (w < 50 || h < 30) return team.teamName.slice(0, 3).toUpperCase();
  return team.teamName;
}

function buildTooltip(team: TeamScoreDTO): string {
  const lines = [team.teamName, `Puntuación: ${Math.round(team.displayScore * 100)}%`];
  if (team.nextMatch?.opponentName) {
    const venue = team.nextMatch.venue ? ` (${venueLabel(team.nextMatch.venue)})` : '';
    const jornada = team.nextMatch.matchday ? `J${team.nextMatch.matchday} - ` : '';
    lines.push(`${jornada}vs ${team.nextMatch.opponentName}${venue}`);
  }
  return lines.join('\n');
}

function crestSize(w: number, h: number): number {
  const maxByWidth = (w - 16) / 3.2;
  const maxByHeight = (h - 44) * 0.6;
  return Math.floor(Math.min(maxByWidth, maxByHeight));
}

function Crest({ url, alt, size }: { url?: string; alt: string; size: number }) {
  if (!url) return null;
  return (
    <img
      src={url}
      alt={alt}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        flexShrink: 0,
        filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))',
      }}
    />
  );
}

export function TeamTile({ team, focused, dimmed, onClick }: TeamTileProps) {
  const { rect } = team;
  const label = getTileLabel(team, rect.w, rect.h);
  const score = Math.round(team.displayScore * 100);
  const textColor = getTextColor(team.displayScore);
  const size = crestSize(rect.w, rect.h);
  const showCrests = size >= 16 && team.nextMatch;

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
      <div style={{ fontWeight: 700, lineHeight: 1.2 }}>{label}</div>

      {showCrests && (() => {
        const nm = team.nextMatch!;
        const hasScore = nm.scoreHome != null && nm.scoreAway != null;
        const homeScore = isHome ? nm.scoreHome : nm.scoreAway;
        const awayScore = isHome ? nm.scoreAway : nm.scoreHome;
        const scoreFontSize = Math.max(size * 0.45, 12);

        return (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 1,
              gap: 2,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: size * 0.3,
              }}
            >
              <Crest url={homeCrest} alt="Local" size={size} />
              <span style={{ fontSize: Math.max(size * 0.35, 10), opacity: 0.6, fontWeight: 700 }}>vs</span>
              <Crest url={awayCrest} alt="Visitante" size={size} />
            </div>
            {size >= 20 && (
              <div style={{ fontSize: scoreFontSize, fontWeight: 700, opacity: hasScore ? 1 : 0.4, letterSpacing: 2 }}>
                {hasScore ? `${homeScore} - ${awayScore}` : '- - -'}
              </div>
            )}
          </div>
        );
      })()}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        {team.nextMatch?.opponentName && rect.w >= 80 && rect.h >= 40 ? (
          <span style={{ fontSize: 10, opacity: 0.7 }}>
            vs {team.nextMatch.opponentName}
          </span>
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
