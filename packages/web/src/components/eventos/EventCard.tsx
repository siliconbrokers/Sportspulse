/**
 * EventCard — Streaming Card Premium 2026
 * Tarjeta completa clickeable, icono Tv pulsante cian, zombie guard, signal badges.
 */
import { useState, useEffect } from 'react';
import { Tv } from 'lucide-react';
import type { ParsedEvent } from '../../hooks/use-events.js';
import { openEventDirect } from '../../hooks/use-events.js';
import { getMatchDisplayStatus } from '../../utils/match-status.js';
import { useTheme } from '../../hooks/use-theme.js';
import { resolveTeamName } from '../../utils/resolve-team-name.js';

// ── CSS inyectado una vez ──────────────────────────────────────────────────────

let _injected = false;
function injectStyles() {
  if (_injected || typeof document === 'undefined') return;
  _injected = true;
  const s = document.createElement('style');
  s.textContent = `
    @keyframes sp-tv-pulse {
      0%,100% { opacity: 1; transform: scale(1); }
      50%      { opacity: 0.45; transform: scale(0.82); }
    }
    @keyframes sp-live-dot {
      0%,100% { opacity: 1; }
      50%      { opacity: 0.25; }
    }
    @keyframes sp-card-reveal {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .sp-ev-card {
      cursor: pointer;
      transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
      animation: sp-card-reveal 0.28s ease both;
    }
    .sp-ev-card:hover {
      transform: translateY(-2px) scale(1.012);
      box-shadow: 0 8px 24px rgba(0,0,0,0.18);
    }
    .sp-ev-card:focus-visible {
      outline: 2px solid #00E0FF;
      outline-offset: 2px;
    }
  `;
  document.head.appendChild(s);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(isoStr: string | null): string {
  if (!isoStr) return '—';
  try {
    return new Intl.DateTimeFormat('es-UY', {
      timeZone: 'America/Montevideo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(isoStr));
  } catch { return '—'; }
}

/** Mapea normalizedStatus del feed de eventos al string que espera getMatchDisplayStatus */
function toApiStatus(normalizedStatus: string): string {
  if (normalizedStatus === 'EN_VIVO')  return 'IN_PROGRESS';
  if (normalizedStatus === 'PROXIMO')  return 'SCHEDULED';
  return 'UNKNOWN';
}

// ── Logos y labels de liga ────────────────────────────────────────────────────

const LEAGUE_LOGO: Record<string, string> = {
  URUGUAY_PRIMERA:   'https://r2.thesportsdb.com/images/media/league/badge/3p98xv1740672448.png',
  ARGENTINA_PRIMERA: 'https://r2.thesportsdb.com/images/media/league/badge/itsy6p1723478606.png',
  LALIGA:            'https://r2.thesportsdb.com/images/media/league/badge/ja4it51687628717.png',
  PREMIER_LEAGUE:    'https://r2.thesportsdb.com/images/media/league/badge/gasy9d1737743125.png',
  BUNDESLIGA:        'https://r2.thesportsdb.com/images/media/league/badge/teqh1b1679952008.png',
};

const LEAGUE_LABEL: Record<string, string> = {
  URUGUAY_PRIMERA:   'Primera División',
  ARGENTINA_PRIMERA: 'Liga Profesional',
  LALIGA:            'LaLiga',
  PREMIER_LEAGUE:    'Premier League',
  BUNDESLIGA:        'Bundesliga',
  OTRA:              'Otro',
};

// ── Sub-componentes ───────────────────────────────────────────────────────────

function CrestImg({ src, alt, size }: { src: string | null; alt: string; size: number }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <div style={{ width: size, height: size, borderRadius: '50%', background: 'var(--sp-border-8)', flexShrink: 0 }} />;
  }
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{ objectFit: 'contain', flexShrink: 0 }}
    />
  );
}

function LeagueLogo({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img src={src} alt={alt} width={14} height={14}
      onError={() => setFailed(true)}
      style={{ objectFit: 'contain', opacity: 0.55, flexShrink: 0 }}
    />
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface EventSignal {
  label: string;
  altUrl?: string;
}

interface EventCardProps {
  event: ParsedEvent;
  accentColor: string;
  isMobile: boolean;
  signals?: EventSignal[];
  animationDelay?: number;
  hasSignal?: boolean;  // false = señal aún no confirmada por el proveedor
  onCardClick?: () => void; // si se provee: click en tarjeta (fuera de señales) muestra detalle
}

// ── Componente ────────────────────────────────────────────────────────────────

export function EventCard({ event, accentColor, isMobile, signals, animationDelay = 0, hasSignal = true, onCardClick }: EventCardProps) {
  useEffect(() => { injectStyles(); }, []);
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  // Estado de visualización — zombie guard incluido
  const ds = getMatchDisplayStatus(toApiStatus(event.normalizedStatus), event.startsAtPortalTz);
  const isLive     = ds === 'LIVE';
  const isZombie   = ds === 'ZOMBIE';
  const isFinished = ds === 'FINISHED';
  const isActive   = isLive || isZombie;

  const crestSize = isMobile ? 22 : 26;

  // ── Decoración de la tarjeta según estado ─────────────────────────────────
  const borderColor = isLive   ? 'rgba(239,68,68,0.45)'
    : isZombie                  ? 'rgba(245,158,11,0.45)'
    : `${accentColor}28`;

  const cardBg = isDark
    ? 'var(--sp-surface-card)'
    : 'var(--sp-surface-card)';

  // ── Handler de click ──────────────────────────────────────────────────────
  function handleCardClick(e: React.MouseEvent) {
    if (!hasSignal && !onCardClick) return;
    if ((e.target as HTMLElement).closest('[data-signal-badge]')) return;
    // Partido activo con señal → stream tiene prioridad sobre DetailPanel
    if (isActive && hasSignal) { openEventDirect(event); return; }
    // Partido próximo con evento canónico → DetailPanel
    if (onCardClick) { onCardClick(); return; }
    if (hasSignal) openEventDirect(event);
  }

  function handleAltSignal(e: React.MouseEvent, altUrl: string) {
    e.stopPropagation();
    const w = Math.min(Math.round(window.screen.width * 0.9), 1440);
    const h = Math.min(Math.round(window.screen.height * 0.9), 900);
    const left = Math.round((window.screen.width - w) / 2);
    const top  = Math.round((window.screen.height - h) / 2);
    window.open(altUrl, 'sportpulse_alt', `popup,width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=no,scrollbars=yes,resizable=yes,noopener`);
  }

  const leagueLogo  = LEAGUE_LOGO[event.normalizedLeague] ?? null;
  const leagueLabel = LEAGUE_LABEL[event.normalizedLeague] ?? event.normalizedLeague;
  const timeStr     = fmtTime(event.startsAtPortalTz);

  // ── Variante compacta mobile (2 filas, ~74px) ─────────────────────────────
  if (isMobile) {
    return (
      <div
        className="sp-ev-card"
        role="button"
        tabIndex={0}
        aria-label={`Ver ${event.homeTeam ?? '?'} vs ${event.awayTeam ?? '?'}`}
        onClick={handleCardClick}
        onKeyDown={(e) => e.key === 'Enter' && openEventDirect(event)}
        style={{
          background: cardBg,
          border: `1px solid ${borderColor}`,
          borderRadius: 12,
          padding: '10px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          position: 'relative',
          overflow: 'hidden',
          animationDelay: `${animationDelay}ms`,
          cursor: hasSignal ? 'pointer' : 'default',
          opacity: hasSignal ? 1 : 0.85,
        }}
      >
        {/* Fila 1: [nombre+crest flex:1] [score 52px] [crest+nombre+TV flex:1] */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {/* Columna izquierda: nombre alineado a la derecha + crest */}
          <div style={{ flex: '1 1 0', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, minWidth: 0, overflow: 'hidden' }}>
            <span style={{
              fontSize: 12, fontWeight: 700, color: 'var(--sp-text-88)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
            }}>
              {resolveTeamName(event.homeTeam ?? '?', { tla: event.homeTla ?? undefined, compact: true })}
            </span>
            <CrestImg src={event.homeCrestUrl} alt={event.homeTeam ?? ''} size={22} />
          </div>
          {/* Columna central: score/vs — siempre en el mismo lugar */}
          <div style={{ width: 52, flexShrink: 0, textAlign: 'center' }}>
            {isActive && event.scoreHome != null && event.scoreAway != null ? (
              <span style={{ fontSize: 13, fontWeight: 900, color: '#f97316', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>
                {event.scoreHome}–{event.scoreAway}
              </span>
            ) : (
              <span style={{ fontSize: 11, color: 'var(--sp-text-25)', fontWeight: 300 }}>vs</span>
            )}
          </div>
          {/* Columna derecha: crest + nombre + TV */}
          <div style={{ flex: '1 1 0', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 6, minWidth: 0, overflow: 'hidden' }}>
            <CrestImg src={event.awayCrestUrl} alt={event.awayTeam ?? ''} size={22} />
            <span style={{
              fontSize: 12, fontWeight: 700, color: 'var(--sp-text-88)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1,
            }}>
              {resolveTeamName(event.awayTeam ?? '?', { tla: event.awayTla ?? undefined, compact: true })}
            </span>
            {hasSignal && (
              <Tv
                size={14}
                color="#00E0FF"
                strokeWidth={2.2}
                style={{ flexShrink: 0, animation: isActive ? 'sp-tv-pulse 1.6s ease-in-out infinite' : 'none' }}
              />
            )}
          </div>
        </div>

        {/* Fila 2: [estado] [liga centrada] [hora] — 3 columnas iguales */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {/* Izquierda: badge estado */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
            {isLive ? (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                fontSize: 8, fontWeight: 900, letterSpacing: '0.08em',
                padding: '1px 6px', borderRadius: 20,
                background: '#ef4444', color: '#fff',
                animation: 'sp-live-dot 1.2s ease-in-out infinite',
              }}>
                <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#fff', flexShrink: 0 }} />
                LIVE
              </span>
            ) : isZombie ? (
              <span style={{ fontSize: 9, color: '#f59e0b' }}>⚠</span>
            ) : isFinished ? (
              <span style={{ fontSize: 9, color: 'var(--sp-text-30)' }}>Finalizado</span>
            ) : (
              <span style={{ fontSize: 9, color: 'var(--sp-text-40)' }}>Próximo</span>
            )}
          </div>
          {/* Centro: liga */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, minWidth: 0 }}>
            {leagueLogo && <LeagueLogo src={leagueLogo} alt={leagueLabel} />}
            <span style={{
              fontSize: 10, color: 'var(--sp-text-30)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {leagueLabel}
            </span>
          </div>
          {/* Derecha: hora */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
            {!isFinished && (
              <span style={{ fontSize: 10, color: 'var(--sp-text-40)', fontVariantNumeric: 'tabular-nums' }}>
                {timeStr}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="sp-ev-card"
      role="button"
      tabIndex={0}
      aria-label={`Ver ${event.homeTeam ?? '?'} vs ${event.awayTeam ?? '?'}`}
      onClick={handleCardClick}
      onKeyDown={(e) => e.key === 'Enter' && openEventDirect(event)}
      style={{
        background: cardBg,
        border: `1px solid ${borderColor}`,
        borderRadius: isMobile ? 14 : 16,
        padding: isMobile ? '12px' : '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: isMobile ? 10 : 12,
        position: 'relative',
        overflow: 'hidden',
        animationDelay: `${animationDelay}ms`,
        cursor: hasSignal ? 'pointer' : 'default',
        opacity: hasSignal ? 1 : 0.85,
      }}
    >
      {/* ── FILA 1: liga + icono streaming ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {leagueLogo && <LeagueLogo src={leagueLogo} alt={leagueLabel} />}
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--sp-text-30)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            {leagueLabel}
          </span>
        </div>

        {/* Streaming indicator — no mostrar si el partido ya terminó o está en zombie */}
        {hasSignal ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '3px 7px', borderRadius: 20,
            background: 'rgba(0,224,255,0.10)',
            border: '1px solid rgba(0,224,255,0.25)',
          }}>
            <Tv
              size={11}
              color="#00E0FF"
              strokeWidth={2.2}
              style={{ animation: isActive ? 'sp-tv-pulse 1.6s ease-in-out infinite' : 'none' }}
            />
            <span style={{ fontSize: 9, fontWeight: 700, color: '#00E0FF', letterSpacing: '0.06em' }}>
              STREAM
            </span>
          </div>
        ) : !isActive && !isFinished && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '3px 7px', borderRadius: 20,
            background: 'rgba(245,158,11,0.10)',
            border: '1px solid rgba(245,158,11,0.30)',
          }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: '#f59e0b', letterSpacing: '0.06em' }}>
              🕐 SIN SEÑAL AÚN
            </span>
          </div>
        )}
      </div>

      {/* ── FILA 2: equipos + marcador/hora ── */}
      <div style={{
        display: 'flex', alignItems: 'center',
        gap: isMobile ? 6 : 8,
        padding: isMobile ? '6px 0' : '8px 0',
      }}>
        {/* Local */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, minWidth: 0 }}>
          <CrestImg src={event.homeCrestUrl} alt={event.homeTeam ?? ''} size={crestSize} />
          <span style={{
            fontSize: isMobile ? 11 : 12, fontWeight: 700,
            color: 'var(--sp-text-88)', textAlign: 'right',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            maxWidth: '100%',
          }}>
            {resolveTeamName(event.homeTeam ?? '?', { tla: event.homeTla ?? undefined, compact: isMobile })}
          </span>
        </div>

        {/* Centro: score si hay datos, "vs" si no */}
        <div style={{
          flexShrink: 0, textAlign: 'center',
          minWidth: isMobile ? 44 : 52,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        }}>
          {isActive && event.scoreHome != null && event.scoreAway != null ? (
            <span style={{
              fontSize: isMobile ? 14 : 16, fontWeight: 900,
              color: '#f97316', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em',
            }}>
              {event.scoreHome}<span style={{ opacity: 0.5, margin: '0 2px' }}>–</span>{event.scoreAway}
            </span>
          ) : (
            <span style={{ fontSize: isMobile ? 11 : 12, color: 'var(--sp-text-25)', fontWeight: 300 }}>vs</span>
          )}
        </div>

        {/* Visitante */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, minWidth: 0 }}>
          <CrestImg src={event.awayCrestUrl} alt={event.awayTeam ?? ''} size={crestSize} />
          <span style={{
            fontSize: isMobile ? 11 : 12, fontWeight: 700,
            color: 'var(--sp-text-88)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            maxWidth: '100%',
          }}>
            {resolveTeamName(event.awayTeam ?? '?', { tla: event.awayTla ?? undefined, compact: isMobile })}
          </span>
        </div>
      </div>

      {/* ── FILA 3: estado + señales ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: isMobile ? 6 : 8,
        borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
        gap: 8,
      }}>
        {/* Badge de estado */}
        {isLive ? (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            fontSize: 8, fontWeight: 900, letterSpacing: '0.1em',
            padding: '2px 7px', borderRadius: 20,
            background: '#ef4444', color: '#fff',
            animation: 'sp-live-dot 1.2s ease-in-out infinite',
            lineHeight: 1.6, boxShadow: '0 1px 6px rgba(239,68,68,0.45)',
          }}>
            <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#fff', flexShrink: 0 }} />
            LIVE
          </span>
        ) : isZombie ? (
          <span style={{ fontSize: 11, fontWeight: 600, color: '#f59e0b' }}>
            ⚠️ Pendiente de confirmación
          </span>
        ) : isFinished ? (
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--sp-text-30)' }}>
            Finalizado
          </span>
        ) : (
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--sp-text-40)' }}>
            Próximo · {timeStr}
          </span>
        )}

        {/* Signal badges */}
        {hasSignal && signals && signals.length > 0 ? (
          <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
            {signals.map((sig, idx) => (
              idx === 0 ? (
                <span
                  key={sig.label}
                  data-signal-badge="true"
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); openEventDirect(event); }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), openEventDirect(event))}
                  style={{
                    fontSize: 10, fontWeight: 700,
                    padding: '3px 8px', borderRadius: 20,
                    background: `${accentColor}20`,
                    color: accentColor,
                    border: `1px solid ${accentColor}44`,
                    cursor: 'pointer',
                  }}
                >
                  {sig.label}
                </span>
              ) : (
                <span
                  key={sig.label}
                  data-signal-badge="true"
                  role="button"
                  tabIndex={0}
                  onClick={(e) => sig.altUrl ? handleAltSignal(e, sig.altUrl) : undefined}
                  onKeyDown={(e) => e.key === 'Enter' && sig.altUrl && handleAltSignal(e as unknown as React.MouseEvent, sig.altUrl)}
                  style={{
                    fontSize: 10, fontWeight: 700,
                    padding: '3px 8px', borderRadius: 20,
                    background: 'var(--sp-border-8)',
                    color: 'var(--sp-text-50)',
                    border: '1px solid var(--sp-border-8)',
                    cursor: 'pointer',
                  }}
                >
                  {sig.label}
                </span>
              )
            ))}
          </div>
        ) : (!hasSignal && !isActive && !isFinished) ? (
          <span style={{
            fontSize: 10, fontWeight: 600,
            color: 'var(--sp-text-30)',
            fontStyle: 'italic',
          }}>
            Señal disponible más cerca del partido
          </span>
        ) : null}
      </div>
    </div>
  );
}
