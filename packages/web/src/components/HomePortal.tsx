// HomePortal v3 — LiveCarousel (top) → Daily Highlights grid
import { useNews } from '../hooks/use-news.js';
import { useVideos } from '../hooks/use-videos.js';
import { useWindowWidth } from '../hooks/use-window-width.js';
import { AdBlockerBanner } from './eventos/AdBlockerBanner.js';
import { LiveCarousel } from './home/LiveCarousel.js';
import { DailyHighlights } from './home/DailyHighlights.js';

export function HomePortal() {
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';
  const cols = breakpoint === 'mobile' ? 1 : breakpoint === 'tablet' ? 2 : 4;

  const { data: newsFeed, loading: newsLoading } = useNews(true);
  const { data: videoFeed, loading: videoLoading } = useVideos(true);

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
      <LiveCarousel isMobile={isMobile} />

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
      />
    </div>
  );
}
