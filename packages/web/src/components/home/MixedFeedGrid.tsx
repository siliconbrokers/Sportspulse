// Mixed Feed Grid — noticias y videos intercalados por liga
import type { NewsFeed, NewsBlock, NewsHeadline } from '../../hooks/use-news.js';
import type { VideoFeed, LeagueVideoHighlight } from '../../hooks/use-videos.js';
import { NewsCard } from '../NewsCard.js';
import { FeaturedVideoCard } from '../FeaturedVideoCard.js';
import { NEWS_LEAGUE_ORDER } from '../../utils/competition-meta.js';

const LEAGUE_ACCENT: Record<string, string> = {
  URU: '#3b82f6',
  LL:  '#f59e0b',
  EPL: '#a855f7',
  BUN: '#ef4444',
};

function SkeletonCard() {
  return (
    <div style={{
      background: 'var(--sp-border-4)',
      border: '1px solid var(--sp-border)',
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      <div style={{ width: '100%', paddingTop: '56.25%', background: 'var(--sp-border-8)' }} />
      <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ height: 13, borderRadius: 3, background: 'var(--sp-border-8)' }} />
        <div style={{ height: 13, width: '80%', borderRadius: 3, background: 'var(--sp-border)' }} />
        <div style={{ height: 10, width: '40%', borderRadius: 3, background: 'var(--sp-border-4)', marginTop: 4 }} />
      </div>
    </div>
  );
}

interface FeedItem {
  type: 'news' | 'video';
  news?: NewsHeadline;
  video?: LeagueVideoHighlight;
  leagueKey: string;
}

function buildMixedFeed(
  blocks: NewsBlock[],
  videosByLeague: Map<string, LeagueVideoHighlight[]>,
  firstHeadlineId: string | null,
): FeedItem[] {
  const items: FeedItem[] = [];

  for (const key of NEWS_LEAGUE_ORDER) {
    const block = blocks.find((b) => b.leagueKey === key);
    const videos = videosByLeague.get(key) ?? [];

    // Headlines, excluding the one used in HeroBento
    const headlines = (block?.headlines ?? []).filter((h) => h.id !== firstHeadlineId);

    // Interleave: insert first video after first 2 news cards, rest at end
    let videoIdx = 0;
    let newsIdx = 0;
    const combined: FeedItem[] = [];

    while (newsIdx < headlines.length || videoIdx < videos.length) {
      // Take 2-3 news, then 1 video
      const newsChunk = Math.min(2, headlines.length - newsIdx);
      for (let i = 0; i < newsChunk; i++) {
        combined.push({ type: 'news', news: headlines[newsIdx++], leagueKey: key });
      }
      if (videoIdx < videos.length) {
        combined.push({ type: 'video', video: videos[videoIdx++], leagueKey: key });
      } else if (newsIdx < headlines.length) {
        // exhaust remaining news
        while (newsIdx < headlines.length) {
          combined.push({ type: 'news', news: headlines[newsIdx++], leagueKey: key });
        }
      }
    }

    items.push(...combined);
  }

  return items;
}

interface MixedFeedGridProps {
  newsFeed: NewsFeed | null;
  videoFeed: VideoFeed | null;
  newsLoading: boolean;
  videoLoading: boolean;
  firstHeadlineId: string | null;
  cols: number;
}

export function MixedFeedGrid({
  newsFeed,
  videoFeed,
  newsLoading,
  videoLoading,
  firstHeadlineId,
  cols,
}: MixedFeedGridProps) {
  const loading = newsLoading || videoLoading;

  if (loading && !newsFeed && !videoFeed) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 16 }}>
        {Array.from({ length: 9 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    );
  }

  const videosByLeague = new Map(
    (videoFeed?.blocks ?? []).map((vb) => [vb.leagueKey, vb.highlights ?? []]),
  );

  const blocks = newsFeed?.blocks ?? [];
  const items = buildMixedFeed(blocks, videosByLeague, firstHeadlineId);

  if (items.length === 0) return null;

  // Group items by league for section headers
  const sections: { key: string; items: FeedItem[] }[] = [];
  let currentKey = '';
  let currentItems: FeedItem[] = [];

  for (const item of items) {
    if (item.leagueKey !== currentKey) {
      if (currentItems.length > 0) sections.push({ key: currentKey, items: currentItems });
      currentKey = item.leagueKey;
      currentItems = [item];
    } else {
      currentItems.push(item);
    }
  }
  if (currentItems.length > 0) sections.push({ key: currentKey, items: currentItems });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
      {sections.map((section) => {
        const accent = LEAGUE_ACCENT[section.key] ?? '#64748b';
        const block = blocks.find((b) => b.leagueKey === section.key);
        const label = block?.competitionLabel ?? section.key;

        return (
          <div key={section.key}>
            {/* Section header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ width: 3, height: 20, borderRadius: 2, background: accent, flexShrink: 0 }} />
              <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--sp-text-88)', margin: 0, letterSpacing: 0.3 }}>
                {label}
              </h3>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 16 }}>
              {section.items.map((item, idx) => {
                if (item.type === 'video' && item.video) {
                  return (
                    <FeaturedVideoCard
                      key={`v-${item.video.id}`}
                      highlight={item.video}
                      accentColor={accent}
                      showLabel={false}
                      compact
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
  );
}
