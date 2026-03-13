import type { NewsFeed, NewsBlock } from '../hooks/use-news.js';
import type { VideoFeed } from '../hooks/use-videos.js';
import { NewsCard } from './NewsCard.js';
import { FeaturedVideoCard } from './FeaturedVideoCard.js';
import { useWindowWidth } from '../hooks/use-window-width.js';
import { NEWS_LEAGUE_ORDER } from '../utils/competition-meta.js';

// Color de acento por liga
const LEAGUE_ACCENT: Record<string, string> = {
  URU: '#3b82f6',
  LL:  '#f59e0b',
  EPL: '#a855f7',
  BUN: '#ef4444',
};

function SkeletonCard() {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      <div style={{ width: '100%', paddingTop: '56.25%', background: 'rgba(255,255,255,0.07)' }} />
      <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ height: 13, borderRadius: 3, background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ height: 13, width: '80%', borderRadius: 3, background: 'rgba(255,255,255,0.06)' }} />
        <div style={{ height: 13, width: '55%', borderRadius: 3, background: 'rgba(255,255,255,0.05)' }} />
        <div style={{ height: 10, width: '40%', borderRadius: 3, background: 'rgba(255,255,255,0.04)', marginTop: 4 }} />
      </div>
    </div>
  );
}

function NewsSkeleton({ cols }: { cols: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
      {[3, 2].map((count, i) => (
        <div key={i}>
          <div style={{ height: 14, width: 120, borderRadius: 4, background: 'rgba(255,255,255,0.08)', marginBottom: 16 }} />
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: 16,
          }}>
            {[...Array(count)].map((_, j) => <SkeletonCard key={j} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function NewsLeagueBlock({
  block,
  cols,
  videoHighlights,
}: {
  block: NewsBlock;
  cols: number;
  videoHighlights: import('../hooks/use-videos.js').LeagueVideoHighlight[];
}) {
  const accent = LEAGUE_ACCENT[block.leagueKey] ?? '#64748b';
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';
  // Desktop: 4 en fila; tablet: 2x2; mobile: 2x2 compacto
  const videoCols = breakpoint === 'desktop' ? 4 : 2;

  return (
    <div style={{ marginBottom: 44 }}>
      {/* Header de sección */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 18,
      }}>
        <div style={{ width: 3, height: 20, borderRadius: 2, background: accent, flexShrink: 0 }} />
        <h3 style={{
          fontSize: 15,
          fontWeight: 700,
          letterSpacing: 0.3,
          color: 'rgba(255,255,255,0.9)',
          margin: 0,
        }}>
          {block.competitionLabel}
        </h3>
        {block.headlines.length > 0 && (
          <span style={{
            fontSize: 11,
            color: 'rgba(255,255,255,0.3)',
            marginLeft: 2,
          }}>
            {block.headlines.length} {block.headlines.length === 1 ? 'nota' : 'notas'}
          </span>
        )}
      </div>

      {/* Videos — grid de hasta 4 miniaturas (spec §17.1) */}
      {videoHighlights.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${videoCols}, minmax(0, 1fr))`,
          gap: isMobile ? 8 : 12,
          marginBottom: 20,
        }}>
          {videoHighlights.map((h) => (
            <FeaturedVideoCard key={h.id} highlight={h} accentColor={accent} showLabel={false} compact />
          ))}
        </div>
      )}

      {/* Contenido */}
      {block.headlines.length === 0 ? (
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', margin: 0, paddingLeft: 13 }}>
          {block.error
            ? 'No se pudieron cargar las noticias para esta liga.'
            : 'No hay noticias disponibles hoy para esta liga.'}
        </p>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: 16,
        }}>
          {block.headlines.map((h) => <NewsCard key={h.id} item={h} />)}
        </div>
      )}
    </div>
  );
}

interface NewsSectionProps {
  feed: NewsFeed | null;
  loading: boolean;
  error: string | null;
  videoFeed?: VideoFeed | null;
}

export function NewsSection({ feed, loading, error, videoFeed }: NewsSectionProps) {
  const { breakpoint } = useWindowWidth();
  const cols = breakpoint === 'mobile' ? 1 : breakpoint === 'tablet' ? 2 : 3;

  if (loading) return <NewsSkeleton cols={cols} />;

  if (error) {
    return (
      <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 24 }}>
        Error al cargar noticias. Intentá de nuevo más tarde.
      </p>
    );
  }

  if (!feed) return null;

  const orderedBlocks = NEWS_LEAGUE_ORDER.map((key) =>
    feed.blocks.find((b) => b.leagueKey === key),
  ).filter(Boolean) as NewsBlock[];

  // Build video highlights map por leagueKey
  const highlightsByLeague = new Map(
    (videoFeed?.blocks ?? []).map((vb) => [vb.leagueKey, vb.highlights ?? []]),
  );

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 32 }}>
      {orderedBlocks.map((block) => (
        <NewsLeagueBlock
          key={block.leagueKey}
          block={block}
          cols={cols}
          videoHighlights={highlightsByLeague.get(block.leagueKey) ?? []}
        />
      ))}
    </div>
  );
}
