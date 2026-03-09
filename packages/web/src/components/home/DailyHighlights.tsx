// Daily Highlights — grid bento de videos y noticias intercalados por liga
import { useState } from 'react';
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
}: {
  highlight: LeagueVideoHighlight;
  accentColor: string;
}) {
  const [playing, setPlaying] = useState(false);

  return (
    <div
      style={{
        borderRadius: '0.75rem',
        overflow: 'hidden',
        border: `1px solid ${accentColor}33`,
        background: '#0B0E14',
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
                  background: 'rgba(0,224,255,0.15)',
                  border: `2px solid rgba(0,224,255,0.7)`,
                  boxShadow: '0 0 16px rgba(0,224,255,0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLDivElement;
                  el.style.background = 'rgba(0,224,255,0.3)';
                  el.style.boxShadow = '0 0 24px rgba(0,224,255,0.6)';
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLDivElement;
                  el.style.background = 'rgba(0,224,255,0.15)';
                  el.style.boxShadow = '0 0 16px rgba(0,224,255,0.4)';
                }}
              >
                {/* Play triangle */}
                <div
                  style={{
                    width: 0,
                    height: 0,
                    borderStyle: 'solid',
                    borderWidth: '7px 0 7px 13px',
                    borderColor: 'transparent transparent transparent #00E0FF',
                    marginLeft: 3,
                  }}
                />
              </div>
            </div>
          </button>
        )}
      </div>

      {/* Metadata */}
      <div style={{ padding: '8px 10px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            lineHeight: 1.35,
            color: 'rgba(255,255,255,0.9)',
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
            color: 'rgba(255,255,255,0.35)',
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
                style={{ color: 'rgba(255,255,255,0.35)', textDecoration: 'none' }}
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
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      <div style={{ width: '100%', paddingTop: '56.25%', background: 'rgba(255,255,255,0.07)' }} />
      <div style={{ padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ height: 12, borderRadius: 3, background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ height: 12, width: '70%', borderRadius: 3, background: 'rgba(255,255,255,0.05)' }} />
        <div style={{ height: 10, width: '40%', borderRadius: 3, background: 'rgba(255,255,255,0.04)', marginTop: 2 }} />
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
interface DailyHighlightsProps {
  newsFeed: NewsFeed | null;
  videoFeed: VideoFeed | null;
  newsLoading: boolean;
  videoLoading: boolean;
  firstHeadlineId: string | null;
  cols: number;
}

export function DailyHighlights({
  newsFeed,
  videoFeed,
  newsLoading,
  videoLoading,
  firstHeadlineId,
  cols,
}: DailyHighlightsProps) {
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
  const items = buildFeed(blocks, videosByLeague, firstHeadlineId);

  if (items.length === 0) return null;

  // Agrupar por liga para headers de sección
  const sections: { key: string; items: FeedItem[] }[] = [];
  let curKey = '';
  let curItems: FeedItem[] = [];
  for (const item of items) {
    if (item.leagueKey !== curKey) {
      if (curItems.length > 0) sections.push({ key: curKey, items: curItems });
      curKey = item.leagueKey;
      curItems = [item];
    } else {
      curItems.push(item);
    }
  }
  if (curItems.length > 0) sections.push({ key: curKey, items: curItems });

  return (
    <div>
      <SectionTitle />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
        {sections.map((section) => {
          const accent = LEAGUE_ACCENT[section.key] ?? '#64748b';
          const block = blocks.find((b) => b.leagueKey === section.key);
          const label = block?.competitionLabel ?? section.key;

          return (
            <div key={section.key}>
              {/* League header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <div style={{ width: 3, height: 18, borderRadius: 2, background: accent, flexShrink: 0 }} />
                <h3
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: 'rgba(255,255,255,0.85)',
                    margin: 0,
                    letterSpacing: '0.02em',
                  }}
                >
                  {label}
                </h3>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 14 }}>
                {section.items.map((item, idx) => {
                  if (item.type === 'video' && item.video) {
                    return (
                      <NeonVideoCard
                        key={`v-${item.video.id}`}
                        highlight={item.video}
                        accentColor={accent}
                      />
                    );
                  }
                  if (item.type === 'news' && item.news) {
                    return <NewsCard key={item.news.id} item={item.news} />;
                  }
                  return <div key={idx} />;
                })}
              </div>
            </div>
          );
        })}
      </div>
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
          color: '#fff',
          margin: 0,
          letterSpacing: '-0.02em',
        }}
      >
        Daily Highlights
      </h2>
      <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)', marginLeft: 8 }} />
    </div>
  );
}
