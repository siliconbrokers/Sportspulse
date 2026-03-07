// spec §13.3 — card de evento con badge, hora, equipos, botones DIRECT y EMBED_TEST
import { useState } from 'react';
import type { ParsedEvent } from '../../hooks/use-events.js';
import { openEventDirect } from '../../hooks/use-events.js';

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  EN_VIVO: { label: 'EN VIVO', bg: 'rgba(239,68,68,0.15)', color: '#ef4444' },
  PROXIMO: { label: 'PRÓXIMO', bg: 'rgba(59,130,246,0.15)', color: '#60a5fa' },
  DESCONOCIDO: { label: 'DESCONOCIDO', bg: 'rgba(100,116,139,0.15)', color: '#94a3b8' },
};

const LEAGUE_LABEL: Record<string, string> = {
  URUGUAY_PRIMERA: 'Primera División Uruguay',
  LALIGA: 'LaLiga',
  PREMIER_LEAGUE: 'Premier League',
  BUNDESLIGA: 'Bundesliga',
  OTRA: 'Otro',
  EXCLUIDA: 'Excluida',
};

// Logos de liga desde TheSportsDB CDN (verificados)
const LEAGUE_LOGO: Record<string, string> = {
  URUGUAY_PRIMERA: 'https://r2.thesportsdb.com/images/media/league/badge/3p98xv1740672448.png',
  LALIGA: 'https://r2.thesportsdb.com/images/media/league/badge/ja4it51687628717.png',
  PREMIER_LEAGUE: 'https://r2.thesportsdb.com/images/media/league/badge/gasy9d1737743125.png',
  BUNDESLIGA: 'https://r2.thesportsdb.com/images/media/league/badge/teqh1b1679952008.png',
};

function formatPortalTime(isoStr: string | null): string {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('es-UY', {
      timeZone: 'America/Montevideo',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoStr;
  }
}

interface CrestImgProps {
  src: string | null;
  alt: string;
  size: number;
}

function CrestImg({ src, alt, size }: CrestImgProps) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
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

interface EventCardProps {
  event: ParsedEvent;
  accentColor: string;
  isMobile: boolean;
}

export function EventCard({ event, accentColor, isMobile }: EventCardProps) {
  const status = STATUS_CONFIG[event.normalizedStatus] ?? STATUS_CONFIG.DESCONOCIDO;
  const leagueLabel = LEAGUE_LABEL[event.normalizedLeague] ?? event.normalizedLeague;
  const leagueLogo = LEAGUE_LOGO[event.normalizedLeague] ?? null;
  const timeStr = formatPortalTime(event.startsAtPortalTz);
  const crestSize = isMobile ? 20 : 24;

  const btnStyle: React.CSSProperties = {
    border: `1px solid ${accentColor}55`,
    borderRadius: 6,
    padding: isMobile ? '5px 10px' : '6px 14px',
    fontSize: isMobile ? 11 : 12,
    fontWeight: 600,
    cursor: 'pointer',
    flex: isMobile ? 1 : undefined,
    whiteSpace: 'nowrap',
  };

  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)',
      border: `1px solid ${accentColor}33`,
      borderRadius: 10,
      padding: isMobile ? '12px' : '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      {/* Fila superior: badge estado + hora + logo liga */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: 0.6,
          padding: '2px 7px', borderRadius: 4,
          background: status.bg, color: status.color,
        }}>
          {status.label}
        </span>
        {/* spec §19.6 — hora convertida a zona del portal */}
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', fontVariantNumeric: 'tabular-nums' }}>
          {timeStr} (UY)
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 'auto' }}>
          {leagueLogo && (
            <LeagueLogoImg src={leagueLogo} alt={leagueLabel} />
          )}
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>
            {leagueLabel}
          </span>
        </div>
      </div>

      {/* Equipos con escudos */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: isMobile ? 14 : 16,
        fontWeight: 700,
        color: 'rgba(255,255,255,0.92)',
        lineHeight: 1.3,
        flexWrap: 'wrap',
      }}>
        <CrestImg src={event.homeCrestUrl} alt={event.homeTeam ?? ''} size={crestSize} />
        <span style={{ minWidth: 0 }}>{event.homeTeam ?? '?'}</span>
        <span style={{ color: 'rgba(255,255,255,0.35)', fontWeight: 400, fontSize: isMobile ? 12 : 14 }}>vs</span>
        <span style={{ minWidth: 0 }}>{event.awayTeam ?? '?'}</span>
        <CrestImg src={event.awayCrestUrl} alt={event.awayTeam ?? ''} size={crestSize} />
      </div>

      {/* Botón principal — spec §13.3 modo DIRECT (sin sandbox: el proveedor lo bloquea) */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => openEventDirect(event)}
          style={{
            ...btnStyle,
            background: accentColor,
            color: '#fff',
            border: 'none',
          }}
        >
          Ver partido
        </button>
      </div>
    </div>
  );
}

// Logo de liga pequeño con fallback silencioso
function LeagueLogoImg({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={src}
      alt={alt}
      width={16}
      height={16}
      onError={() => setFailed(true)}
      style={{ objectFit: 'contain', opacity: 0.6, flexShrink: 0 }}
    />
  );
}
