// HomePortal v3 — LiveCarousel (top) → Daily Highlights grid
import { useNews } from '../hooks/use-news.js';
import { useVideos } from '../hooks/use-videos.js';
import { useWindowWidth } from '../hooks/use-window-width.js';
import { AdBlockerBanner } from './eventos/AdBlockerBanner.js';
import { LiveCarousel } from './home/LiveCarousel.js';
import { DailyHighlights } from './home/DailyHighlights.js';
import { COMP_ID_TO_NEWS_KEY } from '../utils/competition-meta.js';

export function HomePortal({ enabledCompetitionIds }: { enabledCompetitionIds?: string[] }) {
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';
  const cols = breakpoint === 'mobile' ? 1 : breakpoint === 'tablet' ? 2 : 4;

  const enabledLeagueKeys = enabledCompetitionIds
    ? enabledCompetitionIds.map((id) => COMP_ID_TO_NEWS_KEY[id]).filter(Boolean)
    : undefined;

  // Si hay 0 ligas habilitadas explícitamente, no hacer fetches de news/videos
  const feedFetchEnabled = enabledCompetitionIds == null || enabledCompetitionIds.length > 0;

  const { data: newsFeed, loading: newsLoading } = useNews(feedFetchEnabled);
  const { data: videoFeed, loading: videoLoading } = useVideos(feedFetchEnabled);

  return (
    <div
      style={{
        maxWidth: 1400,
        margin: '0 auto',
        padding: isMobile ? '16px 12px 40px' : '24px 20px 56px',
        overflowX: 'hidden',
      }}
    >
      {/* Banner adblocker — necesario para ver eventos en vivo */}
      <AdBlockerBanner isMobile={isMobile} />

      {/* ① LiveCarousel — inmediatez: en vivo → hoy → mañana */}
      <LiveCarousel isMobile={isMobile} enabledCompetitionIds={enabledCompetitionIds} />

      {/* Divisor visual entre secciones */}
      <div style={{
        height: 1,
        background: 'var(--sp-border)',
        marginBottom: isMobile ? 20 : 28,
      }} />

      {/* ② Daily Highlights — noticias + videos 4 cols desktop */}
      <DailyHighlights
        newsFeed={newsFeed}
        videoFeed={videoFeed}
        newsLoading={newsLoading}
        videoLoading={videoLoading}
        firstHeadlineId={null}
        cols={cols}
        compact={cols === 4}
        enabledLeagueKeys={enabledLeagueKeys}
      />
    </div>
  );
}
