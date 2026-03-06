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

function buildTooltip(team: TeamScoreDTO): string {
  const lines = [team.teamName, `Puntuación: ${Math.round(team.displayScore * 100)}%`];
  if (team.nextMatch?.opponentName) {
    const venue = team.nextMatch.venue ? ` (${venueLabel(team.nextMatch.venue)})` : '';
    const jornada = team.nextMatch.matchday ? `J${team.nextMatch.matchday} - ` : '';
    lines.push(`${jornada}vs ${team.nextMatch.opponentName}${venue}`);
  }
  return lines.join('\n');
}

/** Size tier determines what content to show */
type SizeTier = 'xl' | 'lg' | 'md' | 'sm' | 'xs';

function getSizeTier(w: number, h: number): SizeTier {
  const area = w * h;
  const minDim = Math.min(w, h);
  if (area >= 25000 && minDim >= 100) return 'xl';
  if (area >= 12000 && minDim >= 70) return 'lg';
  if (area >= 5000 && minDim >= 50) return 'md';
  if (area >= 2000 && minDim >= 30) return 'sm';
  return 'xs';
}

function Crest({ url, alt, size }: { url?: string; alt: string; size: number }) {
  if (!url || size < 12) return null;
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
  const w = rect.w;
  const h = rect.h;
  const tier = getSizeTier(w, h);
  const score = Math.round(team.displayScore * 100);
  const textColor = getTextColor(team.displayScore);

  const isHome = team.nextMatch?.venue === 'HOME';
  const homeCrest = isHome ? team.crestUrl : team.nextMatch?.opponentCrestUrl;
  const awayCrest = isHome ? team.nextMatch?.opponentCrestUrl : team.crestUrl;

  // Proportional sizing
  const padding = tier === 'xs' ? 3 : tier === 'sm' ? 4 : tier === 'md' ? 6 : 8;
  const innerW = w - padding * 2;
  const innerH = h - padding * 2;
  const nameFontSize = tier === 'xs' ? 9 : tier === 'sm' ? 10 : tier === 'md' ? 11 : 13;
  const nameLineH = nameFontSize * 1.3;

  // Label: abbreviate for small tiles
  const label = tier === 'xs' || tier === 'sm'
    ? team.teamName.slice(0, 3).toUpperCase()
    : team.teamName;

  // Crest sizing: use available space after name and bottom bar
  const bottomBarH = tier === 'xl' || tier === 'lg' ? 18 : 0;
  const availForCrests = innerH - nameLineH - bottomBarH - 4;
  const maxCrestByW = (innerW - 20) / 2.6; // two crests + vs + gaps
  const maxCrestByH = availForCrests * 0.65;
  const crestSize = Math.max(0, Math.floor(Math.min(maxCrestByW, maxCrestByH)));
  const showCrests = crestSize >= 14 && team.nextMatch && tier !== 'xs';

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
        width: w,
        height: h,
        backgroundColor: getHeatColor(team.displayScore),
        border: focused ? '2px solid #fbbf24' : '1px solid rgba(255,255,255,0.15)',
        borderRadius: 6,
        opacity: dimmed ? 0.4 : 1,
        cursor: 'pointer',
        overflow: 'hidden',
        padding,
        boxSizing: 'border-box',
        color: textColor,
        fontSize: nameFontSize,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      {/* Team name */}
      <div style={{
        fontWeight: 700,
        lineHeight: 1.2,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}>
        {label}
      </div>

      {/* Crests + score */}
      {showCrests && (() => {
        const nm = team.nextMatch!;
        const hasScore = nm.scoreHome != null && nm.scoreAway != null;
        const homeScore = isHome ? nm.scoreHome : nm.scoreAway;
        const awayScore = isHome ? nm.scoreAway : nm.scoreHome;
        const scoreFontSize = Math.max(Math.min(crestSize * 0.45, 18), 10);
        const vsSize = Math.max(Math.min(crestSize * 0.35, 14), 8);
        const gap = Math.max(crestSize * 0.2, 4);

        return (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 1,
              gap: 1,
              minHeight: 0,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap,
              }}
            >
              <Crest url={homeCrest} alt="Local" size={crestSize} />
              <span style={{ fontSize: vsSize, opacity: 0.6, fontWeight: 700, flexShrink: 0 }}>vs</span>
              <Crest url={awayCrest} alt="Visitante" size={crestSize} />
            </div>
            {crestSize >= 18 && (
              <div style={{
                fontSize: scoreFontSize,
                fontWeight: 700,
                opacity: hasScore ? 1 : 0.4,
                letterSpacing: 1,
                whiteSpace: 'nowrap',
              }}>
                {hasScore ? `${homeScore} - ${awayScore}` : '- - -'}
              </div>
            )}
          </div>
        );
      })()}

      {/* Xs/sm tiles without crests: show score centered */}
      {!showCrests && tier !== 'xs' && (
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: Math.max(nameFontSize - 1, 9),
          opacity: 0.7,
          fontWeight: 600,
        }}>
          {score}%
        </div>
      )}

      {/* Bottom bar: display hint chips + score% */}
      {(tier === 'xl' || tier === 'lg') && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          flexShrink: 0,
          overflow: 'hidden',
          gap: 4,
        }}>
          <div style={{ display: 'flex', gap: 4, minWidth: 0, overflow: 'hidden' }}>
            {team.displayHints?.formChip && (
              <span style={{
                fontSize: 9,
                opacity: 0.85,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {team.displayHints.formChip.icon}{tier === 'xl' ? ` ${team.displayHints.formChip.label}` : ''}
              </span>
            )}
            {tier === 'xl' && team.displayHints?.nextMatchChip && (
              <span style={{
                fontSize: 9,
                opacity: 0.75,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {team.displayHints.nextMatchChip.icon} {team.displayHints.nextMatchChip.label}
              </span>
            )}
          </div>
          <span style={{ fontSize: 11, opacity: 0.6, flexShrink: 0 }}>
            {score}%
          </span>
        </div>
      )}
    </div>
  );
}
