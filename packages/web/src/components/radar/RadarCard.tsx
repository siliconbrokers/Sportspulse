/**
 * Radar SportPulse — Card Component
 * Spec: radar-04-ui-ux-spec.md §7–§16
 *
 * Anatomy (in order):
 * 1. Contextual header (competition + kickoff/state)
 * 2. Match title
 * 3. Live state / score block
 * 4. Main label pill
 * 5. Pre-match content block (text + reasons)
 * 6. CTA "Ver partido"
 * 7. Post-match outcome block (Desenlace) when applicable
 */

import type { RadarCardEntry, RadarLiveMatchData } from '../../hooks/use-radar.js';
import { useWindowWidth } from '../../hooks/use-window-width.js';

// ── Label colors ──────────────────────────────────────────────────────────────

const LABEL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  EN_LA_MIRA:       { bg: 'rgba(59,130,246,0.15)',  text: '#93c5fd', border: 'rgba(59,130,246,0.3)' },
  BAJO_EL_RADAR:    { bg: 'rgba(139,92,246,0.15)',  text: '#c4b5fd', border: 'rgba(139,92,246,0.3)' },
  SENAL_DE_ALERTA:  { bg: 'rgba(239,68,68,0.15)',   text: '#fca5a5', border: 'rgba(239,68,68,0.3)' },
  PARTIDO_ENGANOSO: { bg: 'rgba(245,158,11,0.15)',  text: '#fcd34d', border: 'rgba(245,158,11,0.3)' },
  PARTIDO_ABIERTO:  { bg: 'rgba(34,197,94,0.15)',   text: '#86efac', border: 'rgba(34,197,94,0.3)' },
  DUELO_CERRADO:    { bg: 'rgba(148,163,184,0.12)', text: '#cbd5e1', border: 'rgba(148,163,184,0.25)' },
};

// ── Verdict badge ─────────────────────────────────────────────────────────────

const VERDICT_COLORS: Record<string, { bg: string; text: string }> = {
  CONFIRMED: { bg: 'rgba(34,197,94,0.12)',  text: '#86efac' },
  PARTIAL:   { bg: 'rgba(245,158,11,0.12)', text: '#fcd34d' },
  REJECTED:  { bg: 'rgba(239,68,68,0.12)',  text: '#fca5a5' },
};

// ── Status formatting ─────────────────────────────────────────────────────────

function formatKickoff(utc: string | null): string {
  if (!utc) return '';
  try {
    return new Intl.DateTimeFormat('es-UY', {
      timeZone: 'America/Montevideo',
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(utc));
  } catch {
    return utc;
  }
}

function resolveStatusLabel(status: string, scoreHome: number | null, scoreAway: number | null): string {
  if (status === 'FINISHED' && scoreHome !== null && scoreAway !== null) {
    return `Finalizado · ${scoreHome}–${scoreAway}`;
  }
  if (status === 'IN_PROGRESS' && scoreHome !== null && scoreAway !== null) {
    return `En juego · ${scoreHome}–${scoreAway}`;
  }
  if (status === 'IN_PROGRESS') return 'En juego';
  if (status === 'FINISHED') return 'Finalizado';
  return '';
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface RadarCardProps {
  card: RadarCardEntry;
  live: RadarLiveMatchData | null;
  matchday?: number;
  onViewMatch?: (matchId: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RadarCard({ card, live, matchday, onViewMatch }: RadarCardProps) {
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';
  const labelColor = LABEL_COLORS[card.labelKey] ?? LABEL_COLORS.EN_LA_MIRA;

  const scoreHome = live?.scoreHome ?? null;
  const scoreAway = live?.scoreAway ?? null;
  const status = live?.status ?? 'SCHEDULED';

  const isPostMatch = card.editorialState === 'POST_MATCH';
  const isInPlay = card.editorialState === 'IN_PLAY' || status === 'IN_PROGRESS';
  const statusLabel = resolveStatusLabel(status, scoreHome, scoreAway);
  const kickoffLabel = formatKickoff(live?.startTimeUtc ?? null);

  const homeTeamName = live?.homeTeamName ?? card.matchId;
  const awayTeamName = live?.awayTeamName ?? '';
  const homeCrest = live?.homeTeamCrest;
  const awayCrest = live?.awayTeamCrest;

  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.09)',
      borderRadius: 12,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* 1. Contextual header */}
      <div style={{
        padding: '10px 14px 8px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{ fontSize: 11, color: isInPlay ? '#ef4444' : 'rgba(255,255,255,0.4)', fontWeight: 500 }}>
          {matchday != null ? `Jornada ${matchday}` : 'Jornada'}
        </span>
        {isInPlay ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              backgroundColor: '#ef4444',
              animation: 'pulse 1.4s infinite',
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>
              {statusLabel || 'En juego'}
            </span>
          </span>
        ) : (
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
            {statusLabel || kickoffLabel}
          </span>
        )}
      </div>

      {/* 2. Match title */}
      {isMobile ? (
        <div style={{ padding: '12px 14px 4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            {homeCrest && (
              <img src={homeCrest} alt="" style={{ width: 18, height: 18, objectFit: 'contain', flexShrink: 0 }} />
            )}
            <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.88)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {homeTeamName}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', padding: '3px 0 3px 24px' }}>vs</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            {awayCrest && (
              <img src={awayCrest} alt="" style={{ width: 18, height: 18, objectFit: 'contain', flexShrink: 0 }} />
            )}
            <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.88)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {awayTeamName}
            </span>
          </div>
        </div>
      ) : (
        <div style={{ padding: '14px 14px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
          {homeCrest && (
            <img src={homeCrest} alt="" style={{ width: 20, height: 20, objectFit: 'contain' }} />
          )}
          <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.88)' }}>
            {homeTeamName}
          </span>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', margin: '0 2px' }}>vs</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.88)' }}>
            {awayTeamName}
          </span>
          {awayCrest && (
            <img src={awayCrest} alt="" style={{ width: 20, height: 20, objectFit: 'contain' }} />
          )}
        </div>
      )}

      {/* 4. Main label pill */}
      <div style={{ padding: '10px 14px 0' }}>
        <span style={{
          display: 'inline-block',
          padding: '4px 10px',
          borderRadius: 20,
          fontSize: 11,
          fontWeight: 600,
          background: labelColor.bg,
          color: labelColor.text,
          border: `1px solid ${labelColor.border}`,
          letterSpacing: '0.02em',
        }}>
          {card.labelText}
        </span>
      </div>

      {/* 5. Pre-match content block */}
      <div style={{ padding: '12px 14px 0' }}>
        {isInPlay && (
          <div style={{
            fontSize: 10,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.35)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: 6,
          }}>
            Lectura previa
          </div>
        )}
        <p style={{
          fontSize: 13,
          lineHeight: 1.55,
          color: 'rgba(255,255,255,0.75)',
          margin: 0,
          fontStyle: 'italic',
          ...(isMobile ? {
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          } : {}),
        }}>
          {card.preMatchText}
        </p>
      </div>

      {/* Reasons list */}
      {/* Note: reasons only available from detail file; in index.json we only have preMatchText.
           For MVP the index provides enough for rendering. Detail file fetch can be added later. */}

      {/* 7. Post-match outcome block */}
      {isPostMatch && card.hasVerdict && card.verdictTitle && (
        <div style={{
          margin: '12px 14px 0',
          padding: '10px 12px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 8,
        }}>
          <div style={{
            fontSize: 10,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.35)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: 6,
          }}>
            Desenlace
          </div>
          {card.verdict && VERDICT_COLORS[card.verdict] && (
            <div style={{
              display: 'inline-block',
              padding: '3px 8px',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
              background: VERDICT_COLORS[card.verdict].bg,
              color: VERDICT_COLORS[card.verdict].text,
              marginBottom: 6,
            }}>
              {card.verdictTitle}
            </div>
          )}
          {card.verdictText && (
            <p style={{
              fontSize: 12,
              lineHeight: 1.5,
              color: 'rgba(255,255,255,0.55)',
              margin: 0,
            }}>
              {card.verdictText}
            </p>
          )}
        </div>
      )}

      {/* 6. Pronóstico Poisson+DC */}
      {live?.probHomeWin !== undefined && live.probDraw !== undefined && live.probAwayWin !== undefined && (
        <div style={{ padding: '10px 14px 0' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Pronóstico
          </div>
          {/* Text row: anchos proporcionales para alinear con la barra,
               sin overflow:hidden en el contenedor. */}
          <div style={{ display: 'flex', marginBottom: 5 }}>
            <div style={{ width: `${Math.round(live.probHomeWin * 100)}%`, textAlign: 'left' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>{Math.round(live.probHomeWin * 100)}%</div>
              {!isMobile && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{homeTeamName}</div>}
            </div>
            <div style={{ width: `${Math.round(live.probDraw * 100)}%`, textAlign: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.5)' }}>{Math.round(live.probDraw * 100)}%</div>
              {!isMobile && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>Empate</div>}
            </div>
            <div style={{ width: `${Math.round(live.probAwayWin * 100)}%`, textAlign: 'right' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>{Math.round(live.probAwayWin * 100)}%</div>
              {!isMobile && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{awayTeamName}</div>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 2, borderRadius: 3, overflow: 'hidden', height: 4 }}>
            <div style={{ width: `${Math.round(live.probHomeWin * 100)}%`, backgroundColor: '#22c55e' }} />
            <div style={{ width: `${Math.round(live.probDraw * 100)}%`, backgroundColor: '#4b5563' }} />
            <div style={{ width: `${Math.round(live.probAwayWin * 100)}%`, backgroundColor: '#ef4444' }} />
          </div>
        </div>
      )}

      {/* 7. CTA */}
      <div style={{ padding: '14px 14px 14px', marginTop: 'auto' }}>
        <button
          onClick={() => onViewMatch?.(live?.homeTeamId ?? card.matchId)}
          style={{
            width: '100%',
            padding: '9px 0',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            color: 'rgba(255,255,255,0.7)',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background 0.15s ease',
            minHeight: 44, // touch target
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.1)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)';
          }}
        >
          Ver partido
        </button>
      </div>
    </div>
  );
}
