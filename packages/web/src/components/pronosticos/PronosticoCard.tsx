/**
 * PronosticoCard — Tablero Analítico 2026
 * Layout: Cabezal (crests + marcador integrado + equipos) → Cuerpo (narrativa IA) → Pie (probs o veredicto)
 * Marcador directamente junto a los escudos, sin bloque de "Resultado" separado.
 */

import { useEffect, useState } from 'react';
import type { RadarCardEntry, RadarLiveMatchData } from '../../hooks/use-radar.js';
import type { MatchCardDTO } from '../../types/snapshot.js';
import { useWindowWidth } from '../../hooks/use-window-width.js';
import { useTheme } from '../../hooks/use-theme.js';
import { getMatchDisplayStatus } from '../../utils/match-status.js';
import { ProbabilityBars } from '../shared/ProbabilityBars.js';

// ── CSS injected once ─────────────────────────────────────────────────────────

let _injected = false;
function injectStyles() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const s = document.createElement('style');
  s.textContent = `
    @keyframes sp-card-in {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes sp-live-ping {
      0%,100% { opacity: 1; transform: scale(1); }
      50%      { opacity: 0.3; transform: scale(0.6); }
    }
    @keyframes sp-glitch {
      0%,88%,100% { border-color: rgba(239,68,68,0.55); box-shadow: none; }
      89%          { border-color: rgba(239,68,68,0.08); }
      91%          { border-color: rgba(239,68,68,0.90); box-shadow: 0 0 10px rgba(239,68,68,0.35); }
      93%          { border-color: rgba(239,68,68,0.12); }
      95%          { border-color: rgba(239,68,68,0.80); }
      97%          { border-color: rgba(239,68,68,0.18); }
    }
    @keyframes sp-neon-hit {
      0%,100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.50); }
      50%      { box-shadow: 0 0 0 5px rgba(34,197,94,0); }
    }
    .sp-pc:hover {
      transform: translateY(-2px) scale(1.015);
      box-shadow: 0 0 0 2px rgba(var(--sp-brand-rgb),0.4), 0 6px 20px rgba(0,0,0,0.16);
    }
    .sp-pc { transition: transform 0.17s ease, box-shadow 0.17s ease; cursor: pointer; outline: none; }
  `;
  document.head.appendChild(s);
}

// ── Verdict config ────────────────────────────────────────────────────────────

type VKey = 'CONFIRMED' | 'PARTIAL' | 'REJECTED';

const VERDICT: Record<VKey, {
  label: string; icon: string;
  dark: string; light: string;
  bg: string; border: string; anim: string;
}> = {
  CONFIRMED: {
    label: 'Acertado', icon: '✓',
    dark: '#86efac', light: '#15803d',
    bg: 'rgba(34,197,94,0.10)', border: '1.5px solid rgba(34,197,94,0.65)',
    anim: 'sp-neon-hit 2.6s ease-in-out infinite',
  },
  PARTIAL: {
    label: 'Parcial', icon: '~',
    dark: '#fcd34d', light: '#b45309',
    bg: 'rgba(245,158,11,0.10)', border: '1.5px solid rgba(245,158,11,0.55)',
    anim: 'none',
  },
  REJECTED: {
    label: 'Fallado', icon: '✗',
    dark: '#fca5a5', light: '#dc2626',
    bg: 'rgba(239,68,68,0.08)', border: '1.5px solid rgba(239,68,68,0.55)',
    anim: 'sp-glitch 6s ease-in-out infinite',
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(utc: string) {
  try {
    return new Intl.DateTimeFormat('es-UY', {
      timeZone: 'America/Montevideo', hour: '2-digit', minute: '2-digit',
    }).format(new Date(utc));
  } catch { return '—'; }
}

function fmtDate(utc: string) {
  try {
    return new Intl.DateTimeFormat('es-UY', {
      timeZone: 'America/Montevideo', weekday: 'short', day: '2-digit', month: '2-digit',
    }).format(new Date(utc));
  } catch { return '—'; }
}

/**
 * Deriva veredicto desde probabilidades + resultado final.
 * Predicción = outcome con mayor probabilidad.
 * CONFIRMED (Acertado): predicción correcta — alineado con "Acertado" del DetailPanel.
 * REJECTED (Fallado): predicción incorrecta — alineado con "Fallado" del DetailPanel.
 * No genera PARTIAL para mantener coherencia binaria con el sistema editorial.
 */
function deriveProbVerdict(
  pHome: number, pDraw: number, pAway: number,
  scoreHome: number, scoreAway: number,
): VKey {
  const predicted = pHome >= pDraw && pHome >= pAway ? 'HOME'
    : pAway >= pDraw && pAway >= pHome ? 'AWAY'
    : 'DRAW';

  const actual = scoreHome > scoreAway ? 'HOME' : scoreAway > scoreHome ? 'AWAY' : 'DRAW';

  return predicted === actual ? 'CONFIRMED' : 'REJECTED';
}

function Crest({ url, size = 22 }: { url?: string; size?: number }) {
  return url
    ? <img src={url} alt="" style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }} />
    : <div style={{ width: size, height: size, borderRadius: '50%', background: 'var(--sp-border-8)', flexShrink: 0 }} />;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface PronosticoCardProps {
  matchCard: MatchCardDTO;
  radarCard?: RadarCardEntry | null;
  live?: RadarLiveMatchData | null;
  onViewMatch?: (teamId: string) => void;
  animationDelay?: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PronosticoCard({ matchCard, radarCard, live, onViewMatch, animationDelay = 0 }: PronosticoCardProps) {
  useEffect(() => { injectStyles(); }, []);

  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  // ── Status ────────────────────────────────────────────────────────────────
  const ds       = getMatchDisplayStatus(matchCard.status ?? 'SCHEDULED', matchCard.kickoffUtc ?? null);
  const isLive   = ds === 'LIVE';
  const isZombie = ds === 'ZOMBIE';
  const isPost   = ds === 'FINISHED' || radarCard?.editorialState === 'POST_MATCH';

  // ── Teams ─────────────────────────────────────────────────────────────────
  const homeName  = matchCard.home.shortName && matchCard.home.shortName.length < matchCard.home.name.length - 5
    ? matchCard.home.shortName : matchCard.home.name;
  const awayName  = matchCard.away.shortName && matchCard.away.shortName.length < matchCard.away.name.length - 5
    ? matchCard.away.shortName : matchCard.away.name;
  const homeCrest = matchCard.home.crestUrl;
  const awayCrest = matchCard.away.crestUrl;

  // ── Score ─────────────────────────────────────────────────────────────────
  const scoreHome = matchCard.scoreHome ?? null;
  const scoreAway = matchCard.scoreAway ?? null;
  const hasScore  = scoreHome !== null && scoreAway !== null;

  // ── Probabilities ─────────────────────────────────────────────────────────
  const hasProbs = live?.probHomeWin != null && live.probDraw != null && live.probAwayWin != null;
  const pHome = hasProbs ? Math.round((live!.probHomeWin ?? 0) * 100) : 0;
  const pDraw = hasProbs ? Math.round((live!.probDraw    ?? 0) * 100) : 0;
  const pAway = hasProbs ? Math.round((live!.probAwayWin ?? 0) * 100) : 0;

  // ── Verdict ───────────────────────────────────────────────────────────────
  // Prioridad: veredicto editorial del radar → veredicto derivado desde probabilidades + resultado
  const editorialVerdict = isPost && radarCard?.verdict ? radarCard.verdict as VKey : null;
  // Usar floats crudos (no redondeados) para el argmax — evita falsos empates por redondeo.
  // Los enteros pHome/pDraw/pAway se usan solo para display.
  const probVerdict = isPost && hasScore && hasProbs
    ? deriveProbVerdict(live!.probHomeWin! * 100, live!.probDraw! * 100, live!.probAwayWin! * 100, scoreHome!, scoreAway!)
    : null;
  const vKey = editorialVerdict ?? probVerdict;
  const vCfg  = vKey ? VERDICT[vKey] : null;
  const vCol  = vCfg ? (isDark ? vCfg.dark : vCfg.light) : null;

  // ── Card decoration ───────────────────────────────────────────────────────
  const cardBorder = vCfg ? vCfg.border
    : isLive   ? '1.5px solid rgba(239,68,68,0.50)'
    : isZombie ? '1.5px solid rgba(245,158,11,0.45)'
    :            '1px solid var(--sp-border-8)';

  const cardAnim = vCfg ? vCfg.anim : 'none';

  const scoreColor = vKey === 'CONFIRMED' ? (isDark ? '#86efac' : '#15803d')
    : vKey === 'REJECTED'                 ? (isDark ? '#fca5a5' : '#dc2626')
    : isLive   ? '#f97316'
    : isZombie ? '#f59e0b'
    : 'var(--sp-text)';

  // ── Narrative text ────────────────────────────────────────────────────────
  // Prioridad: texto editorial del radar → preMatchText del live (generado desde probs)
  const preMatchText = radarCard?.preMatchText ?? live?.preMatchText ?? null;
  const narrative = isPost
    ? (radarCard?.verdictText ?? radarCard?.verdictTitle ?? preMatchText)
    : preMatchText;

  const handleClick = () => onViewMatch?.(matchCard.home.teamId);
  const handleKey   = (e: React.KeyboardEvent) => e.key === 'Enter' && handleClick();

  const baseStyle: React.CSSProperties = {
    background: 'var(--sp-surface-card)',
    border: cardBorder,
    animation: `sp-card-in 0.3s ease both, ${cardAnim}`,
    animationDelay: `${animationDelay}ms, 0s`,
    borderRadius: isMobile ? 14 : 16,
    overflow: 'hidden',
  };

  // ── SHARED sub-components ─────────────────────────────────────────────────

  /** Barras de probabilidad — usa el mismo componente compartido que RadarCard */
  const ProbBarsBlock = hasProbs ? (
    <ProbabilityBars
      probHomeWin={live!.probHomeWin!}
      probDraw={live!.probDraw!}
      probAwayWin={live!.probAwayWin!}
      label="Pronóstico"
    />
  ) : null;

  // Texto narrativo del veredicto (editorial si existe, genérico si es derivado)
  const verdictNarrative = radarCard?.verdictText ?? radarCard?.verdictTitle ?? null;

  /** Badge de veredicto — post-match (editorial o derivado desde probs) */
  const VerdictBlock = isPost && vCfg ? (
    <div style={{
      padding: '7px 10px', borderRadius: 10,
      background: vCfg.bg, border: `1px solid ${vCol}30`,
      textAlign: 'center',
    }}>
      <span style={{ fontSize: 12, fontWeight: 800, color: vCol! }}>
        {vCfg.icon} {vCfg.label}
      </span>
      {verdictNarrative && (
        <p style={{
          fontSize: 10, lineHeight: 1.4, color: vCol!, opacity: 0.75,
          margin: '4px 0 0', fontStyle: 'italic',
          display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {verdictNarrative}
        </p>
      )}
    </div>
  ) : null;

  /** Indicador de hora o estado cuando no hay score */
  const StatusChip = isLive ? (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#ef4444', animation: 'sp-live-ping 1.4s infinite', flexShrink: 0 }} />
      <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', letterSpacing: '0.04em' }}>EN VIVO</span>
    </div>
  ) : isZombie ? (
    <span style={{ fontSize: 11, fontWeight: 600, color: '#f59e0b' }}>🕐 Confirmando</span>
  ) : matchCard.kickoffUtc ? (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--sp-text-80)', lineHeight: 1 }}>
        {fmtDate(matchCard.kickoffUtc)}
      </div>
      <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--sp-text-40)', marginTop: 3 }}>
        {fmtTime(matchCard.kickoffUtc)}
      </div>
    </div>
  ) : null;

  // ── MOBILE — horizontal ───────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div
        className="sp-pc"
        onClick={handleClick}
        onKeyDown={handleKey}
        role="button"
        tabIndex={0}
        style={{ ...baseStyle, display: 'flex', alignItems: 'stretch', minHeight: 82 }}
      >
        {/* Col izquierda: escudos + marcador entre ellos */}
        <div style={{
          width: 80, flexShrink: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 4,
          padding: '10px 8px',
          borderRight: `1px solid ${vCfg ? `${vCol}20` : 'var(--sp-border-6)'}`,
          background: vCfg ? vCfg.bg : isLive ? 'rgba(239,68,68,0.05)' : 'transparent',
        }}>
          <Crest url={homeCrest} size={22} />
          {/* Marcador centrado entre crests */}
          {hasScore ? (
            <span style={{
              fontSize: 14, fontWeight: 900, color: scoreColor,
              letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
            }}>
              {scoreHome}<span style={{ opacity: 0.35, margin: '0 2px' }}>–</span>{scoreAway}
            </span>
          ) : isLive ? (
            <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#ef4444', animation: 'sp-live-ping 1.4s infinite' }} />
          ) : matchCard.kickoffUtc ? (
            <div style={{ textAlign: 'center', lineHeight: 1.3 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--sp-text-80)' }}>{fmtDate(matchCard.kickoffUtc)}</div>
              <div style={{ fontSize: 9, fontWeight: 500, color: 'var(--sp-text-40)' }}>{fmtTime(matchCard.kickoffUtc)}</div>
            </div>
          ) : null}
          <Crest url={awayCrest} size={22} />
        </div>

        {/* Col derecha: equipos + estado + narrativa */}
        <div style={{
          flex: 1, minWidth: 0, padding: '10px 12px',
          display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4,
        }}>
          {/* Nombres de equipos */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--sp-text-88)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {homeName}
            </span>
            <span style={{ fontSize: 9, color: 'var(--sp-text-30)', flexShrink: 0 }}>vs</span>
            <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--sp-text-88)', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {awayName}
            </span>
          </div>

          {/* Estado / veredicto */}
          {isPost && vCfg ? (
            <span style={{ fontSize: 11, fontWeight: 700, color: vCol! }}>
              {vCfg.icon} {vCfg.label}
            </span>
          ) : isLive ? (
            <span style={{ fontSize: 10, fontWeight: 700, color: '#ef4444', letterSpacing: '0.04em' }}>● EN VIVO</span>
          ) : isZombie ? (
            <span style={{ fontSize: 10, fontWeight: 600, color: '#f59e0b' }}>🕐 Confirmando</span>
          ) : matchCard.kickoffUtc ? (
            <span style={{ fontSize: 10, color: 'var(--sp-text-35)' }}>{fmtDate(matchCard.kickoffUtc)} · {fmtTime(matchCard.kickoffUtc)}</span>
          ) : null}

          {/* Narrativa IA */}
          {narrative && (
            <p style={{
              fontSize: 11, lineHeight: 1.4, color: 'var(--sp-text-50)',
              margin: 0, fontStyle: 'italic',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {narrative}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── DESKTOP — vertical ────────────────────────────────────────────────────
  return (
    <div
      className="sp-pc"
      onClick={handleClick}
      onKeyDown={handleKey}
      role="button"
      tabIndex={0}
      style={{ ...baseStyle, display: 'flex', flexDirection: 'column' }}
    >
      {/* ── CABEZAL: marcador integrado + equipos ── */}
      <div style={{
        padding: '12px 12px 10px',
        borderBottom: '1px solid var(--sp-border-6)',
      }}>
        {/* Fila del marcador: [CrestHome] Score — Score [CrestAway] */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 8, marginBottom: 8,
        }}>
          <Crest url={homeCrest} size={24} />

          {hasScore ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 22, fontWeight: 900, color: scoreColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                {scoreHome}
              </span>
              <span style={{ fontSize: 13, color: 'var(--sp-text-25, rgba(128,128,128,0.5))', fontWeight: 300 }}>—</span>
              <span style={{ fontSize: 22, fontWeight: 900, color: scoreColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                {scoreAway}
              </span>
            </div>
          ) : (
            StatusChip
          )}

          <Crest url={awayCrest} size={24} />
        </div>

        {/* Nombres de equipos */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{
            flex: 1, fontSize: 11, fontWeight: 700, color: 'var(--sp-text-88)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{homeName}</span>
          <span style={{ fontSize: 9, color: 'var(--sp-text-30)', flexShrink: 0 }}>vs</span>
          <span style={{
            flex: 1, fontSize: 11, fontWeight: 700, color: 'var(--sp-text-88)',
            textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{awayName}</span>
        </div>
      </div>

      {/* ── CUERPO: narrativa IA ── */}
      {narrative && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--sp-border-6)' }}>
          <p style={{
            fontSize: 11, lineHeight: 1.45, color: 'var(--sp-text-50)',
            margin: 0, fontStyle: 'italic',
            display: '-webkit-box', WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {narrative}
          </p>
        </div>
      )}

      {/* ── PIE: probabilidades siempre + veredicto post-match ── */}
      <div style={{ padding: '10px 12px', marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {ProbBarsBlock}
        {isPost && VerdictBlock}
        {!ProbBarsBlock && !VerdictBlock && radarCard && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '4px 8px', borderRadius: 6,
            background: 'var(--sp-surface-raised, rgba(255,255,255,0.05))',
            border: '1px solid var(--sp-border-8)',
          }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--sp-text-50)' }}>
              {radarCard.labelText}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
