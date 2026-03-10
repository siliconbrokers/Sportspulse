/**
 * RadarCard — Live Bento Card. Premium 2026 Design System.
 * Day/Night compliant: usa CSS vars del sistema + paletas theme-aware para labels.
 */

import { useEffect } from 'react';
import type { RadarCardEntry, RadarLiveMatchData } from '../../hooks/use-radar.js';
import { useWindowWidth } from '../../hooks/use-window-width.js';
import { useTheme } from '../../hooks/use-theme.js';
import { getMatchDisplayStatus } from '../../utils/match-status.js';
import { ProbabilityBars } from '../shared/ProbabilityBars.js';

// ── Animations (injected once) ────────────────────────────────────────────────

let _animationsInjected = false;
function injectAnimations() {
  if (_animationsInjected || typeof document === 'undefined') return;
  _animationsInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes sp-radar-neon {
      0%,100% { box-shadow: 0 0 0 0 rgba(var(--sp-brand-rgb),0.6), 0 0 10px 1px rgba(var(--sp-brand-rgb),0.25); }
      50%      { box-shadow: 0 0 0 4px rgba(var(--sp-brand-rgb),0), 0 0 16px 4px rgba(var(--sp-brand-rgb),0.4); }
    }
    @keyframes sp-radar-zombie {
      0%,100% { box-shadow: 0 0 0 0 rgba(245,158,11,0.5); }
      50%      { box-shadow: 0 0 0 4px rgba(245,158,11,0); }
    }
    @keyframes sp-radar-enter {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes sp-dot-pulse {
      0%,100% { opacity: 1; transform: scale(1); }
      50%      { opacity: 0.4; transform: scale(0.7); }
    }
  `;
  document.head.appendChild(style);
}

// ── League label map ──────────────────────────────────────────────────────────

const LEAGUE_LABEL: Record<string, { name: string; color: string }> = {
  PD:     { name: 'LaLiga',         color: '#ef4444' },
  PL:     { name: 'Premier League', color: '#6366f1' },
  BL1:    { name: 'Bundesliga',     color: '#f59e0b' },
  '4432': { name: 'Liga Uruguaya',  color: '#22c55e' },
};

// ── Label palettes — dark y light por separado ────────────────────────────────

const LABEL_DARK: Record<string, { bg: string; text: string; border: string }> = {
  EN_LA_MIRA:       { bg: 'rgba(59,130,246,0.15)',  text: '#93c5fd', border: 'rgba(59,130,246,0.35)' },
  BAJO_EL_RADAR:    { bg: 'rgba(139,92,246,0.15)',  text: '#c4b5fd', border: 'rgba(139,92,246,0.35)' },
  SENAL_DE_ALERTA:  { bg: 'rgba(239,68,68,0.15)',   text: '#fca5a5', border: 'rgba(239,68,68,0.35)' },
  PARTIDO_ENGANOSO: { bg: 'rgba(245,158,11,0.15)',  text: '#fcd34d', border: 'rgba(245,158,11,0.35)' },
  PARTIDO_ABIERTO:  { bg: 'rgba(34,197,94,0.15)',   text: '#86efac', border: 'rgba(34,197,94,0.35)' },
  DUELO_CERRADO:    { bg: 'rgba(148,163,184,0.12)', text: '#cbd5e1', border: 'rgba(148,163,184,0.3)' },
};

const LABEL_LIGHT: Record<string, { bg: string; text: string; border: string }> = {
  EN_LA_MIRA:       { bg: 'rgba(59,130,246,0.10)',  text: '#1d4ed8', border: 'rgba(59,130,246,0.4)' },
  BAJO_EL_RADAR:    { bg: 'rgba(139,92,246,0.10)',  text: '#6d28d9', border: 'rgba(139,92,246,0.4)' },
  SENAL_DE_ALERTA:  { bg: 'rgba(239,68,68,0.10)',   text: '#dc2626', border: 'rgba(239,68,68,0.4)' },
  PARTIDO_ENGANOSO: { bg: 'rgba(245,158,11,0.10)',  text: '#b45309', border: 'rgba(245,158,11,0.4)' },
  PARTIDO_ABIERTO:  { bg: 'rgba(34,197,94,0.10)',   text: '#15803d', border: 'rgba(34,197,94,0.4)' },
  DUELO_CERRADO:    { bg: 'rgba(100,116,139,0.10)', text: '#475569', border: 'rgba(100,116,139,0.35)' },
};

// ── Verdict palettes ──────────────────────────────────────────────────────────

const VERDICT_DARK: Record<string, { bg: string; text: string; border: string; resultLabel: string }> = {
  CONFIRMED: { bg: 'rgba(34,197,94,0.12)',  text: '#86efac', border: '1.5px solid rgba(34,197,94,0.65)',  resultLabel: 'Acertado' },
  PARTIAL:   { bg: 'rgba(245,158,11,0.12)', text: '#fcd34d', border: '1.5px solid rgba(245,158,11,0.6)', resultLabel: 'Parcial'  },
  REJECTED:  { bg: 'rgba(239,68,68,0.12)',  text: '#fca5a5', border: '1.5px solid rgba(239,68,68,0.6)',  resultLabel: 'Fallado'  },
};

const VERDICT_LIGHT: Record<string, { bg: string; text: string; border: string; resultLabel: string }> = {
  CONFIRMED: { bg: 'rgba(34,197,94,0.10)',  text: '#15803d', border: '1.5px solid rgba(34,197,94,0.6)',  resultLabel: 'Acertado' },
  PARTIAL:   { bg: 'rgba(245,158,11,0.10)', text: '#b45309', border: '1.5px solid rgba(245,158,11,0.55)', resultLabel: 'Parcial'  },
  REJECTED:  { bg: 'rgba(239,68,68,0.10)',  text: '#dc2626', border: '1.5px solid rgba(239,68,68,0.55)', resultLabel: 'Fallado'  },
};

// ── Time formatter ────────────────────────────────────────────────────────────

function formatKickoff(utc: string | null): string {
  if (!utc) return '';
  try {
    return new Intl.DateTimeFormat('es-UY', {
      timeZone: 'America/Montevideo',
      weekday: 'short', day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(utc));
  } catch {
    return utc;
  }
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface RadarCardProps {
  card: RadarCardEntry;
  live: RadarLiveMatchData | null;
  competitionKey?: string;
  matchday?: number;
  onViewMatch?: (matchId: string) => void;
  animationDelay?: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RadarCard({ card, live, competitionKey, matchday, onViewMatch, animationDelay = 0 }: RadarCardProps) {
  useEffect(() => { injectAnimations(); }, []);

  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const scoreHome = live?.scoreHome ?? null;
  const scoreAway = live?.scoreAway ?? null;
  const apiStatus = live?.status ?? 'SCHEDULED';
  const kickoffUtc = live?.startTimeUtc ?? null;

  const displayStatus = getMatchDisplayStatus(apiStatus, kickoffUtc);
  const isLive     = displayStatus === 'LIVE';
  const isZombie   = displayStatus === 'ZOMBIE';
  const isFinished = displayStatus === 'FINISHED';
  const isActive   = isLive || isZombie;

  const homeTeamName = live?.homeTeamName ?? card.matchId;
  const awayTeamName = live?.awayTeamName ?? '';
  const homeCrest    = live?.homeTeamCrest;
  const awayCrest    = live?.awayTeamCrest;

  const LABEL_COLORS = isDark ? LABEL_DARK : LABEL_LIGHT;
  const VERDICT_COLORS = isDark ? VERDICT_DARK : VERDICT_LIGHT;
  const labelColor = LABEL_COLORS[card.labelKey] ?? LABEL_COLORS.EN_LA_MIRA;
  const league = LEAGUE_LABEL[competitionKey ?? ''] ?? null;

  // Veredicto post-partido (solo en POST_MATCH con verdict disponible)
  const isPost = card.editorialState === 'POST_MATCH' || isFinished;
  const verdictCfg = isPost && card.verdict ? (VERDICT_COLORS[card.verdict] ?? null) : null;

  // Border: resultado > live > zombie > neutro
  const borderStyle: React.CSSProperties = verdictCfg
    ? { border: verdictCfg.border }
    : isLive
      ? { border: '1.5px solid rgba(var(--sp-brand-rgb),0.7)', animation: 'sp-radar-neon 2.4s ease-in-out infinite' }
      : isZombie
        ? { border: '1.5px solid rgba(245,158,11,0.6)', animation: 'sp-radar-zombie 2.4s ease-in-out infinite' }
        : { border: '1px solid var(--sp-border-8)' };

  // Score color: live=naranja, zombie=ámbar, default=texto
  const scoreColor = isZombie ? '#f59e0b' : isLive ? '#f97316' : 'var(--sp-text-88)';

  return (
    <div
      style={{
        background: 'var(--sp-surface-card)',
        borderRadius: 16,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        animation: `sp-radar-enter 0.35s ease both`,
        animationDelay: `${animationDelay}ms`,
        ...borderStyle,
      }}
    >
      {/* 1. Header: liga (top-left) + estado badge (top-right) */}
      <div style={{
        padding: '10px 14px 8px',
        borderBottom: '1px solid var(--sp-border-6)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
      }}>
        {/* Liga label — siempre estático */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {league && (
            <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, backgroundColor: league.color }} />
          )}
          <span style={{
            fontSize: 11, fontWeight: 600,
            color: league ? league.color : 'var(--sp-text-40)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {league?.name ?? (matchday != null ? `Jornada ${matchday}` : 'Jornada')}
          </span>
          {matchday != null && (
            <span style={{ fontSize: 10, color: 'var(--sp-text-30)', flexShrink: 0 }}>J{matchday}</span>
          )}
        </div>

        {/* Estado badge */}
        {isLive && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0,
            fontSize: 8, fontWeight: 900, letterSpacing: '0.1em',
            padding: '2px 7px', borderRadius: 20,
            background: '#ef4444', color: '#fff',
            animation: 'sp-dot-pulse 1.4s ease-in-out infinite',
            lineHeight: 1.6, boxShadow: '0 1px 6px rgba(239,68,68,0.45)',
          }}>
            <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#fff', flexShrink: 0 }} />
            LIVE
          </span>
        )}
        {isZombie && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <span style={{ fontSize: 11 }}>🕐</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#f59e0b' }}>Confirmando</span>
          </span>
        )}
        {isFinished && (
          <span style={{ fontSize: 11, color: 'var(--sp-text-35)' }}>Finalizado</span>
        )}
        {!isActive && !isFinished && kickoffUtc && (
          <span style={{ fontSize: 11, color: 'var(--sp-text-35)', flexShrink: 0 }}>
            {formatKickoff(kickoffUtc)}
          </span>
        )}
      </div>

      {/* 2. Equipos + Score */}
      <div style={{ padding: isMobile ? '12px 14px 4px' : '14px 14px 4px' }}>
        {isMobile ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, flex: 1 }}>
                {homeCrest && <img src={homeCrest} alt="" style={{ width: 20, height: 20, objectFit: 'contain', flexShrink: 0 }} />}
                <span style={{
                  fontSize: 14, fontWeight: 700, color: 'var(--sp-text-88)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{homeTeamName}</span>
              </div>
              {scoreHome !== null && scoreAway !== null && (
                <span style={{
                  fontSize: 18, fontWeight: 800, color: scoreColor,
                  letterSpacing: '-0.02em', flexShrink: 0, fontVariantNumeric: 'tabular-nums',
                }}>
                  {scoreHome}–{scoreAway}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, marginTop: 6 }}>
              {awayCrest && <img src={awayCrest} alt="" style={{ width: 20, height: 20, objectFit: 'contain', flexShrink: 0 }} />}
              <span style={{
                fontSize: 14, fontWeight: 700, color: 'var(--sp-text-88)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{awayTeamName}</span>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {homeCrest && <img src={homeCrest} alt="" style={{ width: 22, height: 22, objectFit: 'contain', flexShrink: 0 }} />}
            <span style={{
              fontSize: 14, fontWeight: 700, color: 'var(--sp-text-88)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
            }}>{homeTeamName}</span>
            {scoreHome !== null && scoreAway !== null ? (
              <span style={{
                fontSize: 17, fontWeight: 800, color: scoreColor, flexShrink: 0,
                letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', padding: '0 4px',
              }}>
                {scoreHome}–{scoreAway}
              </span>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--sp-text-30)', padding: '0 4px', flexShrink: 0 }}>vs</span>
            )}
            <span style={{
              fontSize: 14, fontWeight: 700, color: 'var(--sp-text-88)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'right',
            }}>{awayTeamName}</span>
            {awayCrest && <img src={awayCrest} alt="" style={{ width: 22, height: 22, objectFit: 'contain', flexShrink: 0 }} />}
          </div>
        )}
      </div>

      {/* 3. Label pill editorial */}
      <div style={{ padding: '10px 14px 0' }}>
        <span style={{
          display: 'inline-block', padding: '4px 10px', borderRadius: 20,
          fontSize: 11, fontWeight: 600,
          background: labelColor.bg, color: labelColor.text,
          border: `1px solid ${labelColor.border}`,
          letterSpacing: '0.02em',
        }}>
          {card.labelText}
        </span>
      </div>

      {/* 4. Texto pre-partido */}
      <div style={{ padding: '10px 14px 0', flex: 1 }}>
        <p style={{
          fontSize: 13, lineHeight: 1.55, color: 'var(--sp-text-75)',
          margin: 0, fontStyle: 'italic',
          ...(isMobile ? {
            display: '-webkit-box', WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical', overflow: 'hidden',
          } : {}),
        }}>
          {card.preMatchText}
        </p>
      </div>

      {/* 5. Probabilidades */}
      {live?.probHomeWin !== undefined && live.probDraw !== undefined && live.probAwayWin !== undefined && (
        <div style={{ padding: '10px 14px 0' }}>
          <ProbabilityBars
            probHomeWin={live.probHomeWin}
            probDraw={live.probDraw}
            probAwayWin={live.probAwayWin}
            homeTeamName={!isMobile ? homeTeamName : undefined}
            awayTeamName={!isMobile ? awayTeamName : undefined}
            showTeamNames={!isMobile}
          />
        </div>
      )}

      {/* 6. Post-match verdict */}
      {isPost && verdictCfg && (
        <div style={{
          margin: '12px 14px 0', padding: '10px 12px',
          background: verdictCfg.bg,
          border: `1px solid ${verdictCfg.border.replace('1.5px solid ', '')}`,
          borderRadius: 10,
        }}>
          {/* Resultado principal — "Acertado" / "Fallado" / "Parcial" */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: card.verdictTitle || card.verdictText ? 8 : 0 }}>
            <span style={{
              display: 'inline-block', padding: '4px 12px', borderRadius: 20,
              fontSize: 12, fontWeight: 800,
              background: verdictCfg.bg,
              color: verdictCfg.text,
              border: `1px solid ${verdictCfg.text}40`,
              letterSpacing: '0.02em',
            }}>
              {verdictCfg.resultLabel}
            </span>
            {card.verdictTitle && (
              <span style={{ fontSize: 11, color: 'var(--sp-text-55)', fontWeight: 500 }}>
                {card.verdictTitle}
              </span>
            )}
          </div>
          {card.verdictText && (
            <p style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--sp-text-55)', margin: 0, fontStyle: 'italic' }}>
              {card.verdictText}
            </p>
          )}
        </div>
      )}

      {/* 7. CTA */}
      <div style={{ padding: '14px', marginTop: 'auto' }}>
        <button
          onClick={() => onViewMatch?.(live?.homeTeamId ?? card.matchId)}
          style={{
            width: '100%', padding: '9px 0',
            background: 'var(--sp-surface-raised)',
            border: '1px solid var(--sp-border-10)',
            borderRadius: 10,
            color: 'var(--sp-text-70)',
            fontSize: 12, fontWeight: 600,
            cursor: 'pointer', transition: 'background 0.15s ease, border-color 0.15s ease',
            minHeight: 44,
          }}
          onMouseEnter={(e) => {
            const btn = e.currentTarget as HTMLButtonElement;
            btn.style.background = 'var(--sp-primary-10)';
            btn.style.borderColor = 'var(--sp-primary-40)';
          }}
          onMouseLeave={(e) => {
            const btn = e.currentTarget as HTMLButtonElement;
            btn.style.background = 'var(--sp-surface-raised)';
            btn.style.borderColor = 'var(--sp-border-10)';
          }}
        >
          Ver partido
        </button>
      </div>
    </div>
  );
}
