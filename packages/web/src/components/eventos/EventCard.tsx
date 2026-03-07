// spec §13.3 — card de evento con badge, hora, equipos, botones DIRECT y EMBED_TEST
import type { ParsedEvent } from '../../hooks/use-events.js';
import { openEventDirect, openEventEmbedTest } from '../../hooks/use-events.js';

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

interface EventCardProps {
  event: ParsedEvent;
  accentColor: string;
  isMobile: boolean;
}

export function EventCard({ event, accentColor, isMobile }: EventCardProps) {
  const status = STATUS_CONFIG[event.normalizedStatus] ?? STATUS_CONFIG.DESCONOCIDO;
  const leagueLabel = LEAGUE_LABEL[event.normalizedLeague] ?? event.normalizedLeague;
  const timeStr = formatPortalTime(event.startsAtPortalTz);

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
      {/* Fila superior: badge estado + hora */}
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
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginLeft: 'auto' }}>
          {leagueLabel}
        </span>
      </div>

      {/* Equipos */}
      <div style={{
        fontSize: isMobile ? 14 : 16,
        fontWeight: 700,
        color: 'rgba(255,255,255,0.92)',
        lineHeight: 1.3,
      }}>
        {event.homeTeam ?? '?'} <span style={{ color: 'rgba(255,255,255,0.35)', fontWeight: 400 }}>vs</span> {event.awayTeam ?? '?'}
      </div>

      {/* Botones — spec §13.3 + §15.4 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
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
        {/* spec §15.3 EMBED_TEST */}
        <button
          onClick={() => openEventEmbedTest(event)}
          style={{
            ...btnStyle,
            background: 'transparent',
            color: accentColor,
          }}
        >
          Abrir prueba
        </button>
      </div>
    </div>
  );
}
