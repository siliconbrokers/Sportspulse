// HomePortal v2 — portal integrado: hero + eventos en vivo + daily highlights
import { useNews } from '../hooks/use-news.js';
import { useVideos } from '../hooks/use-videos.js';
import { useEvents } from '../hooks/use-events.js';
import { useWindowWidth } from '../hooks/use-window-width.js';
import { AdBlockerBanner } from './eventos/AdBlockerBanner.js';
import { HeroBento } from './home/HeroBento.js';
import { LiveEventsHub } from './home/LiveEventsHub.js';
import { DailyHighlights } from './home/DailyHighlights.js';

const BLOCK_ORDER = ['URU', 'LL', 'EPL', 'BUN'];

const LEAGUE_ACCENT: Record<string, string> = {
  URU: '#3b82f6',
  LL:  '#f59e0b',
  EPL: '#a855f7',
  BUN: '#ef4444',
};

export function HomePortal() {
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';
  const cols = breakpoint === 'mobile' ? 1 : breakpoint === 'tablet' ? 2 : 3;

  const { data: newsFeed, loading: newsLoading } = useNews(true);
  const { data: videoFeed, loading: videoLoading } = useVideos(true);
  const { data: eventosFeed, loading: eventosLoading } = useEvents(true);

  // Titular principal: primera noticia disponible en orden de ligas
  let heroHeadline = null;
  if (newsFeed) {
    for (const key of BLOCK_ORDER) {
      const block = newsFeed.blocks.find((b) => b.leagueKey === key);
      if (block && block.headlines.length > 0) {
        heroHeadline = block.headlines[0];
        break;
      }
    }
  }

  // Video destacado para Hero: primer video disponible en orden de ligas
  let heroVideo = null;
  let heroVideoAccent = '#00E0FF';
  if (videoFeed) {
    for (const key of BLOCK_ORDER) {
      const block = videoFeed.blocks.find((b) => b.leagueKey === key);
      if (block && block.highlights && block.highlights.length > 0) {
        heroVideo = block.highlights[0];
        heroVideoAccent = LEAGUE_ACCENT[key] ?? '#00E0FF';
        break;
      }
    }
  }

  return (
    <div
      style={{
        maxWidth: 1100,
        margin: '0 auto',
        padding: isMobile ? '16px 12px 40px' : '28px 20px 56px',
        overflowX: 'hidden',
      }}
    >
      {/* Banner de adblocker (necesario para ver eventos) */}
      <AdBlockerBanner isMobile={isMobile} />

      {/* Hero Bento: titular + video destacado */}
      {(heroHeadline || heroVideo) && (
        <HeroBento
          headline={heroHeadline}
          video={heroVideo}
          videoAccentColor={heroVideoAccent}
          isMobile={isMobile}
        />
      )}

      {/* Live Events Hub: partidos en vivo / próximos / mañana (lógica 48h) */}
      <LiveEventsHub
        feed={eventosFeed}
        loading={eventosLoading}
        isMobile={isMobile}
      />

      {/* Daily Highlights: noticias + videos intercalados por liga */}
      <DailyHighlights
        newsFeed={newsFeed}
        videoFeed={videoFeed}
        newsLoading={newsLoading}
        videoLoading={videoLoading}
        firstHeadlineId={heroHeadline?.id ?? null}
        cols={cols}
      />
    </div>
  );
}
