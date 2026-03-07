import { useState, useEffect, useRef } from 'react';
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
}

// YouTube IFrame API error codes that indicate the video can't be played
const YT_UNPLAYABLE_ERRORS = new Set([100, 101, 150]);

// spec §17.3 + §18: facade — no iframe en carga, solo al hacer click
export function FeaturedVideoCard({ highlight, accentColor }: FeaturedVideoCardProps) {
  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Listen for YouTube IFrame API postMessage errors
  useEffect(() => {
    if (!playing) return;

    function handleMessage(e: MessageEvent) {
      // YouTube sends JSON strings from its iframe origin
      if (typeof e.data !== 'string') return;
      try {
        const msg = JSON.parse(e.data);
        // error event: {"event":"error","info":150}
        if (msg.event === 'error' && YT_UNPLAYABLE_ERRORS.has(msg.info)) {
          setBlocked(true);
          setPlaying(false);
        }
      } catch {
        // ignore non-JSON messages
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [playing]);

  if (blocked) {
    return (
      <div style={{
        marginBottom: 20,
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${accentColor}33`,
        borderRadius: 10,
        overflow: 'hidden',
      }}>
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
        <div style={{
          padding: '20px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          alignItems: 'flex-start',
        }}>
          <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
            Este video no está disponible en tu región.
          </p>
          <a
            href={highlight.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: accentColor,
              textDecoration: 'none',
              padding: '6px 12px',
              border: `1px solid ${accentColor}55`,
              borderRadius: 6,
            }}
          >
            Ver en YouTube →
          </a>
          <p style={{ margin: 0, fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>
            {highlight.title}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        marginBottom: 20,
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${accentColor}33`,
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      {/* Etiqueta "Video destacado" */}
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

      {/* Player area */}
      <div style={{ position: 'relative', width: '100%', paddingTop: '56.25%', background: '#000' }}>
        {playing ? (
          // spec §18: lazy load — solo monta iframe después del click
          // enablejsapi=1 permite recibir postMessage de errores del player
          <iframe
            ref={iframeRef}
            src={`${highlight.embedUrl}&autoplay=1&enablejsapi=1`}
            title={highlight.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              border: 'none',
            }}
          />
        ) : (
          // Thumbnail con overlay de play — no carga iframe hasta click
          <button
            onClick={() => setPlaying(true)}
            aria-label={`Reproducir: ${highlight.title}`}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              padding: 0,
              border: 'none',
              cursor: 'pointer',
              background: 'transparent',
            }}
          >
            <img
              src={highlight.thumbnailUrl ?? PLACEHOLDER}
              alt=""
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = PLACEHOLDER;
              }}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
            {/* Play button overlay */}
            <div style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0,0,0,0.35)',
              transition: 'background 0.15s ease',
            }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = 'rgba(0,0,0,0.5)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = 'rgba(0,0,0,0.35)';
              }}
            >
              <div style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.92)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
              }}>
                {/* Play triangle */}
                <div style={{
                  width: 0,
                  height: 0,
                  borderStyle: 'solid',
                  borderWidth: '9px 0 9px 18px',
                  borderColor: 'transparent transparent transparent #1a1a2e',
                  marginLeft: 4,
                }} />
              </div>
            </div>
          </button>
        )}
      </div>

      {/* Metadata */}
      <div style={{ padding: '10px 14px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{
          fontSize: 13,
          fontWeight: 600,
          lineHeight: 1.4,
          color: 'rgba(255,255,255,0.9)',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}>
          {highlight.title}
        </div>
        <div style={{
          fontSize: 11,
          color: 'rgba(255,255,255,0.38)',
          display: 'flex',
          gap: 5,
          alignItems: 'center',
        }}>
          <span style={{ fontWeight: 500, color: 'rgba(255,255,255,0.5)' }}>{highlight.channelTitle}</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>{formatDateTime(highlight.publishedAtUtc)}</span>
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
                Ver en YouTube
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
