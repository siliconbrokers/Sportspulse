// BentoMatchCard — tarjeta inmersiva de partido con fondo gradiente y efecto Live
import { useState } from 'react';
import type { ParsedEvent } from '../../hooks/use-events.js';
import { openEventDirect } from '../../hooks/use-events.js';
import type { EventSignal } from '../eventos/EventCard.js';

// Gradientes por liga: [from, to]
const LEAGUE_GRADIENT: Record<string, [string, string]> = {
  URUGUAY_PRIMERA:   ['#1e3a8a', '#1d4ed8'],
  ARGENTINA_PRIMERA: ['#1a3a5c', '#1565c0'],
  LALIGA:            ['#78350f', '#b45309'],
  PREMIER_LEAGUE:    ['#4c1d95', '#7c3aed'],
  BUNDESLIGA:        ['#7f1d1d', '#b91c1c'],
};

function openAltUrl(url: string) {
  const w = Math.min(Math.round(window.screen.width * 0.9), 1440);
  const h = Math.min(Math.round(window.screen.height * 0.9), 900);
  const left = Math.round((window.screen.width - w) / 2);
  const top = Math.round((window.screen.height - h) / 2);
  window.open(
    url,
    'sportpulse_player_alt',
    `popup,width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes,noopener`,
  );
}

function CrestBg({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      style={{
        position: 'absolute',
        width: 130,
        height: 130,
        objectFit: 'contain',
        opacity: 0.07,
        filter: 'blur(3px) brightness(1.8)',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    />
  );
}

function CrestFg({ src, alt, size }: { src: string | null; alt: string; size: number }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{ objectFit: 'contain', flexShrink: 0, filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.6))' }}
    />
  );
}

function formatPortalTime(isoStr: string | null): string {
  if (!isoStr) return '—';
  try {
    return new Date(isoStr).toLocaleTimeString('es-UY', {
      timeZone: 'America/Montevideo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return isoStr;
  }
}

interface BentoMatchCardProps {
  event: ParsedEvent;
  signals?: EventSignal[];
  isMobile: boolean;
  /** Override del badge de estado (ej. "MAÑANA") */
  labelOverride?: string;
}

export function BentoMatchCard({ event, signals, isMobile, labelOverride }: BentoMatchCardProps) {
  const isLive = event.normalizedStatus === 'EN_VIVO';
  const [from, to] = LEAGUE_GRADIENT[event.normalizedLeague] ?? ['#1e293b', '#0f172a'];
  const timeStr = formatPortalTime(event.startsAtPortalTz);
  const crestSize = isMobile ? 28 : 36;

  return (
    <div
      style={{
        position: 'relative',
        borderRadius: '1.5rem',
        border: isLive
          ? '1px solid rgba(0,224,255,0.45)'
          : '1px solid rgba(255,255,255,0.07)',
        boxShadow: isLive
          ? '0 0 24px rgba(0,224,255,0.15), inset 0 0 60px rgba(0,0,0,0.4)'
          : 'inset 0 0 60px rgba(0,0,0,0.4)',
        background: `linear-gradient(140deg, ${from} 0%, ${to} 55%, #0B0E14 100%)`,
        minHeight: isMobile ? 155 : 170,
        display: 'flex',
        flexDirection: 'column',
        padding: isMobile ? '14px 16px' : '18px 20px',
        gap: 10,
        overflow: 'hidden',
      }}
    >
      {/* Ghost crests de fondo */}
      <div style={{ position: 'absolute', left: -20, top: '50%', transform: 'translateY(-50%)' }}>
        <CrestBg src={event.homeCrestUrl} />
      </div>
      <div style={{ position: 'absolute', right: -20, top: '50%', transform: 'translateY(-50%)' }}>
        <CrestBg src={event.awayCrestUrl} />
      </div>

      {/* Badge de estado + hora */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative', zIndex: 1 }}>
        {isLive ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '0.08em',
              padding: '3px 9px',
              borderRadius: 20,
              background: 'rgba(0,224,255,0.12)',
              color: '#00E0FF',
              border: '1px solid rgba(0,224,255,0.4)',
            }}
          >
            {/* Punto pulsante */}
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#00E0FF',
                boxShadow: '0 0 6px #00E0FF',
                flexShrink: 0,
                // inline keyframes via animation-name
                animation: 'pulse-live 2s cubic-bezier(0.4,0,0.6,1) infinite',
              }}
            />
            EN VIVO
          </span>
        ) : (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.06em',
              padding: '3px 9px',
              borderRadius: 20,
              background: labelOverride
                ? 'rgba(251,191,36,0.12)'
                : 'rgba(148,163,184,0.12)',
              color: labelOverride ? '#fbbf24' : '#94a3b8',
              border: labelOverride
                ? '1px solid rgba(251,191,36,0.3)'
                : '1px solid rgba(148,163,184,0.2)',
            }}
          >
            {labelOverride ?? 'PRÓXIMO'}
          </span>
        )}
        <span
          style={{
            fontSize: 12,
            color: 'rgba(255,255,255,0.55)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {timeStr} UY
        </span>
      </div>

      {/* Equipos con escudos */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: isMobile ? 8 : 12,
          flex: 1,
          position: 'relative',
          zIndex: 1,
        }}
      >
        <CrestFg src={event.homeCrestUrl} alt={event.homeTeam ?? ''} size={crestSize} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span
            style={{
              fontSize: isMobile ? 14 : 16,
              fontWeight: 800,
              color: '#fff',
              letterSpacing: '-0.02em',
              lineHeight: 1.2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {event.homeTeam ?? '?'}
          </span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontWeight: 500 }}>vs</span>
          <span
            style={{
              fontSize: isMobile ? 14 : 16,
              fontWeight: 800,
              color: '#fff',
              letterSpacing: '-0.02em',
              lineHeight: 1.2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {event.awayTeam ?? '?'}
          </span>
        </div>
        <CrestFg src={event.awayCrestUrl} alt={event.awayTeam ?? ''} size={crestSize} />
      </div>

      {/* Botones de señal */}
      <div style={{ display: 'flex', gap: 8, position: 'relative', zIndex: 1 }}>
        {signals && signals.length > 0 ? (
          signals.map((sig) => (
            <button
              key={sig.label}
              onClick={() => (sig.altUrl ? openAltUrl(sig.altUrl) : openEventDirect(event))}
              style={{
                flex: 1,
                padding: isMobile ? '0 10px' : '8px 14px',
                minHeight: isMobile ? 44 : 36,
                borderRadius: '0.75rem',
                border: isLive
                  ? '1px solid rgba(0,224,255,0.4)'
                  : '1px solid rgba(255,255,255,0.15)',
                background: isLive ? 'rgba(0,224,255,0.1)' : 'rgba(255,255,255,0.07)',
                color: isLive ? '#00E0FF' : 'rgba(255,255,255,0.85)',
                fontSize: isMobile ? 11 : 12,
                fontWeight: 700,
                cursor: 'pointer',
                letterSpacing: '0.02em',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
              }}
            >
              ▶ {sig.label}
            </button>
          ))
        ) : (
          <button
            onClick={() => openEventDirect(event)}
            style={{
              flex: 1,
              padding: isMobile ? '0 10px' : '8px 14px',
              minHeight: isMobile ? 44 : 36,
              borderRadius: '0.75rem',
              border: isLive
                ? '1px solid rgba(0,224,255,0.4)'
                : '1px solid rgba(255,255,255,0.15)',
              background: isLive ? 'rgba(0,224,255,0.1)' : 'rgba(255,255,255,0.07)',
              color: isLive ? '#00E0FF' : 'rgba(255,255,255,0.85)',
              fontSize: isMobile ? 11 : 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ▶ Ver partido
          </button>
        )}
      </div>
    </div>
  );
}
