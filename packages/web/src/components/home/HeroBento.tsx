// Hero Bento — gran titular + video destacado
import type { NewsHeadline } from '../../hooks/use-news.js';
import type { LeagueVideoHighlight } from '../../hooks/use-videos.js';
import { FeaturedVideoCard } from '../FeaturedVideoCard.js';

const LEAGUE_ACCENT: Record<string, string> = {
  URU: '#3b82f6',
  LL:  '#f59e0b',
  EPL: '#a855f7',
  BUN: '#ef4444',
};

function TimeAgo({ publishedAtUtc }: { publishedAtUtc: string }) {
  const diff = Date.now() - new Date(publishedAtUtc).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return <>{mins}m</>;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return <>{hrs}h</>;
  return <>{Math.floor(hrs / 24)}d</>;
}

interface HeroBentoProps {
  headline: NewsHeadline | null;
  video: LeagueVideoHighlight | null;
  videoAccentColor?: string;
  isMobile: boolean;
}

export function HeroBento({ headline, video, videoAccentColor = '#00E0FF', isMobile }: HeroBentoProps) {
  if (!headline && !video) return null;

  const accent = headline ? (LEAGUE_ACCENT[headline.leagueKey] ?? '#00E0FF') : '#00E0FF';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
        gap: isMobile ? 12 : 20,
        background: 'var(--sp-surface)',
        borderRadius: '1.5rem',
        padding: isMobile ? 20 : 32,
        border: '1px solid var(--sp-border)',
        marginBottom: isMobile ? 20 : 32,
        transition: 'background 0.2s ease',
      }}
    >
      {/* Titular principal */}
      {headline ? (
        <a
          href={headline.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 16 }}
        >
          {/* Thumbnail si existe */}
          {headline.imageUrl && (
            <div style={{
              width: '100%',
              paddingTop: '52%',
              position: 'relative',
              borderRadius: '0.75rem',
              overflow: 'hidden',
              flexShrink: 0,
            }}>
              <img
                src={headline.imageUrl}
                alt=""
                style={{
                  position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                  objectFit: 'cover',
                }}
                loading="eager"
              />
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* League badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 3, height: 16, borderRadius: 2, background: accent, flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: accent, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {headline.competitionLabel}
              </span>
              <span style={{ fontSize: 11, color: 'var(--sp-text-30)', marginLeft: 'auto' }}>
                <TimeAgo publishedAtUtc={headline.publishedAtUtc} /> · {headline.sourceName}
              </span>
            </div>
            {/* Headline */}
            <h2 style={{
              fontSize: isMobile ? 20 : 26,
              fontWeight: 800,
              color: 'var(--sp-text)',
              lineHeight: 1.25,
              letterSpacing: '-0.02em',
              margin: 0,
            }}>
              {headline.title}
            </h2>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--sp-primary)',
              marginTop: 4,
            }}>
              Leer más →
            </span>
          </div>
        </a>
      ) : (
        <div />
      )}

      {/* Video destacado */}
      {video && (
        <div>
          <FeaturedVideoCard
            highlight={video}
            accentColor={videoAccentColor}
            showLabel
            compact={false}
          />
        </div>
      )}
    </div>
  );
}
