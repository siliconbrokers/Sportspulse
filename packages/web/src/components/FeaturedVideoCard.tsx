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

// ── YouTube IFrame Player API loader (singleton) ───────────────────────────────

let ytApiPromise: Promise<void> | null = null;

function loadYouTubeAPI(): Promise<void> {
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise<void>((resolve) => {
    if ((window as any).YT?.Player) {
      resolve();
      return;
    }

    const prev = (window as any).onYouTubeIframeAPIReady;
    (window as any).onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };

    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    }
  });

  return ytApiPromise;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface FeaturedVideoCardProps {
  highlight: LeagueVideoHighlight;
  accentColor: string;
}

const BLOCKED_LABEL_STYLE = {
  padding: '6px 12px',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.5,
  textTransform: 'uppercase' as const,
};

// spec §17.3 + §18: facade — no carga player hasta click
export function FeaturedVideoCard({ highlight, accentColor }: FeaturedVideoCardProps) {
  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);

  // Mount YouTube IFrame Player API player when play is clicked
  useEffect(() => {
    if (!playing || !containerRef.current) return;

    let active = true;

    // Safety net: if video never reaches state PLAYING within 10s, treat as blocked
    const timeout = setTimeout(() => {
      if (active) {
        setBlocked(true);
        setPlaying(false);
      }
    }, 10000);

    loadYouTubeAPI().then(() => {
      if (!active || !containerRef.current) return;

      playerRef.current = new (window as any).YT.Player(containerRef.current, {
        videoId: highlight.videoId,
        playerVars: { autoplay: 1, rel: 0, modestbranding: 1 },
        events: {
          onStateChange: (e: any) => {
            // State 1 = PLAYING — video started fine, clear the safety timeout
            if (e.data === 1) clearTimeout(timeout);
          },
          onError: (_e: any) => {
            // Any YouTube player error: geo-block, content-ID, private, removed, etc.
            clearTimeout(timeout);
            if (active) {
              setBlocked(true);
              setPlaying(false);
            }
          },
        },
      });
    });

    return () => {
      active = false;
      clearTimeout(timeout);
      try { playerRef.current?.destroy(); } catch {}
      playerRef.current = null;
    };
  }, [playing, highlight.videoId]);

  // ── Blocked state ──────────────────────────────────────────────────────────
  if (blocked) {
    return (
      <div style={{
        marginBottom: 20,
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${accentColor}33`,
        borderRadius: 10,
        overflow: 'hidden',
      }}>
        <div style={{ ...BLOCKED_LABEL_STYLE, background: `${accentColor}18`, borderBottom: `1px solid ${accentColor}22`, color: accentColor }}>
          Video destacado
        </div>
        <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
          <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>
            Este video no está disponible en tu región.
          </p>
          <a
            href={highlight.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 12, fontWeight: 600, color: accentColor, textDecoration: 'none', padding: '6px 12px', border: `1px solid ${accentColor}55`, borderRadius: 6 }}
          >
            Ver en YouTube →
          </a>
          <p style={{ margin: 0, fontSize: 11, color: 'rgba(255,255,255,0.22)', lineHeight: 1.4 }}>
            {highlight.title}
          </p>
        </div>
      </div>
    );
  }

  // ── Normal state ───────────────────────────────────────────────────────────
  return (
    <div style={{
      marginBottom: 20,
      background: 'rgba(255,255,255,0.04)',
      border: `1px solid ${accentColor}33`,
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      {/* Label */}
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
          // YT IFrame API mounts the iframe into this div
          <div
            ref={containerRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          />
        ) : (
          // Thumbnail facade — no player until click
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
                width: 52, height: 52, borderRadius: '50%',
                background: 'rgba(255,255,255,0.92)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
              }}>
                <div style={{
                  width: 0, height: 0, borderStyle: 'solid',
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
          fontSize: 13, fontWeight: 600, lineHeight: 1.4, color: 'rgba(255,255,255,0.9)',
          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>
          {highlight.title}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)', display: 'flex', gap: 5, alignItems: 'center' }}>
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
