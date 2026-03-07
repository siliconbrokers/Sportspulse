import { useState } from 'react';
import type { LeagueVideoHighlight } from '../hooks/use-videos.js';

const PLACEHOLDER = '/placeholder-news.png';

function formatDateTime(utc: string): string {
  try {
    return new Intl.DateTimeFormat('es-UY', {
      timeZone: 'America/Montevideo',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(utc));
  } catch {
    return utc;
  }
}

interface FeaturedVideoCardProps {
  highlight: LeagueVideoHighlight;
  accentColor: string;
  showLabel?: boolean;
  /** Modo compacto: botón de play pequeño, padding reducido, título en 1 línea */
  compact?: boolean;
}

// spec §17.3 + §18: facade — no iframe en carga, solo al hacer click
export function FeaturedVideoCard({ highlight, accentColor, showLabel = true, compact = false }: FeaturedVideoCardProps) {
  const [playing, setPlaying] = useState(false);

  return (
    <div style={{
      marginBottom: 20,
      background: 'rgba(255,255,255,0.04)',
      border: `1px solid ${accentColor}33`,
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      {/* Label */}
      {showLabel && (
        <div style={{
          padding: '6px 12px',
          background: `${accentColor}18`,
          borderBottom: `1px solid ${accentColor}22`,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.5,
          color: accentColor,
          textTransform: 'uppercase',
        }}>
          Video destacado
        </div>
      )}

      {/* Player area */}
      <div style={{ position: 'relative', width: '100%', paddingTop: '56.25%', background: '#000' }}>
        {playing ? (
          <iframe
            src={`${highlight.embedUrl}&autoplay=1`}
            title={highlight.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
          />
        ) : (
          <button
            onClick={() => setPlaying(true)}
            aria-label={`Reproducir: ${highlight.title}`}
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              padding: 0, border: 'none', cursor: 'pointer', background: 'transparent',
            }}
          >
            <img
              src={highlight.thumbnailUrl ?? PLACEHOLDER}
              alt=""
              onError={(e) => { (e.currentTarget as HTMLImageElement).src = PLACEHOLDER; }}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            />
            <div
              style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,0.35)', transition: 'background 0.15s ease',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(0,0,0,0.5)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(0,0,0,0.35)'; }}
            >
              <div style={{
                width: compact ? 36 : 52, height: compact ? 36 : 52, borderRadius: '50%',
                background: 'rgba(255,255,255,0.92)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
              }}>
                <div style={{
                  width: 0, height: 0, borderStyle: 'solid',
                  borderWidth: compact ? '6px 0 6px 12px' : '9px 0 9px 18px',
                  borderColor: 'transparent transparent transparent #1a1a2e',
                  marginLeft: compact ? 2 : 4,
                }} />
              </div>
            </div>
          </button>
        )}
      </div>

      {/* Metadata */}
      <div style={{ padding: compact ? '7px 10px 9px' : '10px 14px 12px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{
          fontSize: compact ? 12 : 13, fontWeight: 600, lineHeight: 1.35, color: 'rgba(255,255,255,0.9)',
          overflow: 'hidden', display: '-webkit-box',
          WebkitLineClamp: compact ? 1 : 2,
          WebkitBoxOrient: 'vertical',
        }}>
          {highlight.title}
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 500, color: 'rgba(255,255,255,0.45)' }}>{highlight.channelTitle}</span>
          {!compact && (
            <>
              <span style={{ opacity: 0.5 }}>·</span>
              <span>{formatDateTime(highlight.publishedAtUtc)}</span>
            </>
          )}
          {!playing && (
            <>
              <span style={{ opacity: 0.5 }}>·</span>
              <a
                href={highlight.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: accentColor, textDecoration: 'none', fontWeight: 500 }}
                onClick={(e) => e.stopPropagation()}
              >
                YouTube
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
