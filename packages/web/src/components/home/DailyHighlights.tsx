// Daily Highlights — grid bento de videos y noticias intercalados por liga
import { useState, useCallback } from 'react';
import type { NewsFeed, NewsBlock, NewsHeadline } from '../../hooks/use-news.js';
import type { VideoFeed, LeagueVideoHighlight } from '../../hooks/use-videos.js';
import { NewsCard } from '../NewsCard.js';

const BLOCK_ORDER = ['URU', 'LL', 'EPL', 'BUN'];

const LEAGUE_ACCENT: Record<string, string> = {
  URU: '#3b82f6',
  LL:  '#f59e0b',
  EPL: '#a855f7',
  BUN: '#ef4444',
};

// ─── Video card con botón Play neon ────────────────────────────────────────────
const PLACEHOLDER = '/placeholder-news.png';

function NeonVideoCard({
  highlight,
  accentColor,
  compact = false,
}: {
  highlight: LeagueVideoHighlight;
  accentColor: string;
  compact?: boolean;
}) {
  const [playing, setPlaying] = useState(false);

  return (
    <div
      style={{
        borderRadius: '0.75rem',
        overflow: 'hidden',
        border: `1px solid ${accentColor}33`,
        background: 'var(--sp-surface)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
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
            {/* Overlay con gradiente y botón play neon */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.5) 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: 'var(--sp-primary-10)',
                  border: `2px solid var(--sp-primary-40)`,
                  boxShadow: '0 0 16px var(--sp-primary-10)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLDivElement;
                  el.style.background = 'var(--sp-primary-22)';
                  el.style.boxShadow = '0 0 24px var(--sp-primary-22)';
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLDivElement;
                  el.style.background = 'var(--sp-primary-10)';
                  el.style.boxShadow = '0 0 16px var(--sp-primary-10)';
                }}
              >
                {/* Play triangle */}
                <div
                  style={{
                    width: 0,
                    height: 0,
                    borderStyle: 'solid',
                    borderWidth: '7px 0 7px 13px',
                    borderColor: 'transparent transparent transparent var(--sp-primary)',
                    marginLeft: 3,
                  }}
                />
              </div>
            </div>
          </button>
        )}
      </div>

      {/* Metadata */}
      <div style={{ padding: compact ? '6px 8px 8px' : '8px 10px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div
          style={{
            fontSize: compact ? 11 : 12,
            fontWeight: 600,
            lineHeight: 1.35,
            color: 'var(--sp-text-88)',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {highlight.title}
        </div>
        <div
          style={{
            fontSize: 10,
            color: 'var(--sp-text-35)',
            display: 'flex',
            gap: 4,
            alignItems: 'center',
            flexWrap: 'wrap',
            marginTop: 2,
          }}
        >
          <span style={{ color: accentColor, fontWeight: 600, opacity: 0.8 }}>
            {highlight.channelTitle}
          </span>
          {!playing && (
            <>
              <span style={{ opacity: 0.4 }}>·</span>
              <a
                href={highlight.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--sp-text-35)', textDecoration: 'none' }}
                onClick={(e) => e.stopPropagation()}
              >
                YouTube ↗
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div
      style={{
        background: 'var(--sp-border-4)',
        border: '1px solid var(--sp-border)',
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      <div style={{ width: '100%', paddingTop: '56.25%', background: 'var(--sp-border-8)' }} />
      <div style={{ padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ height: 12, borderRadius: 3, background: 'var(--sp-border-8)' }} />
        <div style={{ height: 12, width: '70%', borderRadius: 3, background: 'var(--sp-border-5)' }} />
        <div style={{ height: 10, width: '40%', borderRadius: 3, background: 'var(--sp-border-4)', marginTop: 2 }} />
      </div>
    </div>
  );
}

// ─── Feed item types ──────────────────────────────────────────────────────────
interface FeedItem {
  type: 'news' | 'video';
  news?: NewsHeadline;
  video?: LeagueVideoHighlight;
  leagueKey: string;
}

function buildFeed(
  blocks: NewsBlock[],
  videosByLeague: Map<string, LeagueVideoHighlight[]>,
  excludeId: string | null,
): FeedItem[] {
  const items: FeedItem[] = [];
  for (const key of BLOCK_ORDER) {
    const block = blocks.find((b) => b.leagueKey === key);
    const videos = videosByLeague.get(key) ?? [];
    const headlines = (block?.headlines ?? []).filter((h) => h.id !== excludeId);

    let ni = 0;
    let vi = 0;
    while (ni < headlines.length || vi < videos.length) {
      // 2 noticias, luego 1 video
      for (let i = 0; i < 2 && ni < headlines.length; i++) {
        items.push({ type: 'news', news: headlines[ni++], leagueKey: key });
      }
      if (vi < videos.length) {
        items.push({ type: 'video', video: videos[vi++], leagueKey: key });
      } else {
        while (ni < headlines.length) {
          items.push({ type: 'news', news: headlines[ni++], leagueKey: key });
        }
      }
    }
  }
  return items;
}

// ─── Componente principal ─────────────────────────────────────────────────────
const PAGE_SIZE = 12; // items por "página"

interface DailyHighlightsProps {
  newsFeed: NewsFeed | null;
  videoFeed: VideoFeed | null;
  newsLoading: boolean;
  videoLoading: boolean;
  firstHeadlineId: string | null;
  cols: number;
  compact?: boolean;
}

export function DailyHighlights({
  newsFeed,
  videoFeed,
  newsLoading,
  videoLoading,
  firstHeadlineId,
  cols,
  compact = false,
}: DailyHighlightsProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const loadMore = useCallback(() => setVisibleCount((n) => n + PAGE_SIZE), []);

  const loading = (newsLoading || videoLoading) && !newsFeed && !videoFeed;

  if (loading) {
    return (
      <div>
        <SectionTitle />
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 16 }}>
          {Array.from({ length: cols * 3 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  const videosByLeague = new Map(
    (videoFeed?.blocks ?? []).map((vb) => [vb.leagueKey, vb.highlights ?? []]),
  );
  const blocks = newsFeed?.blocks ?? [];
  const allItems = buildFeed(blocks, videosByLeague, firstHeadlineId);

  if (allItems.length === 0) return null;

  const visibleItems = allItems.slice(0, visibleCount);
  const hasMore = visibleCount < allItems.length;
  const gap = compact ? 10 : 14;

  return (
    <div>
      <SectionTitle />
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap }}>
        {visibleItems.map((item, idx) => {
          const accent = LEAGUE_ACCENT[item.leagueKey] ?? '#64748b';
          if (item.type === 'video' && item.video) {
            return (
              <NeonVideoCard
                key={`v-${item.video.id}`}
                highlight={item.video}
                accentColor={accent}
                compact={compact}
              />
            );
          }
          if (item.type === 'news' && item.news) {
            return <NewsCard key={item.news.id} item={item.news} compact={compact} />;
          }
          return <div key={idx} />;
        })}
      </div>

      {/* Botón "Cargar más" */}
      {hasMore && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 32 }}>
          <button
            onClick={loadMore}
            style={{
              padding: '10px 32px',
              borderRadius: '9999px',
              border: '1px solid var(--sp-border-8)',
              background: 'var(--sp-surface)',
              color: 'var(--sp-text-55)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              letterSpacing: '0.02em',
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget;
              el.style.borderColor = 'var(--sp-primary-40)';
              el.style.color = 'var(--sp-primary)';
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget;
              el.style.borderColor = 'var(--sp-border-8)';
              el.style.color = 'var(--sp-text-55)';
            }}
          >
            Cargar más
          </button>
        </div>
      )}
    </div>
  );
}

function SectionTitle() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
      <span style={{ fontSize: 18 }}>⚡</span>
      <h2
        style={{
          fontSize: 18,
          fontWeight: 800,
          color: 'var(--sp-text)',
          margin: 0,
          letterSpacing: '-0.02em',
        }}
      >
        Daily Highlights
      </h2>
      <div style={{ flex: 1, height: 1, background: 'var(--sp-border)', marginLeft: 8 }} />
    </div>
  );
}
