import type { VideoFeed, VideoBlock } from '../hooks/use-videos.js';
import { FeaturedVideoCard } from './FeaturedVideoCard.js';
import { useWindowWidth } from '../hooks/use-window-width.js';

const BLOCK_ORDER = ['URU', 'LL', 'EPL', 'BUN'];

const LEAGUE_ACCENT: Record<string, string> = {
  URU: '#3b82f6',
  LL:  '#f59e0b',
  EPL: '#a855f7',
  BUN: '#ef4444',
};

const LEAGUE_LABEL: Record<string, string> = {
  URU: '🇺🇾 Fútbol uruguayo',
  LL:  '🇪🇸 LaLiga',
  EPL: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 Premier League',
  BUN: '🇩🇪 Bundesliga',
};

function SkeletonVideo() {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      <div style={{ width: '100%', paddingTop: '56.25%', background: 'rgba(255,255,255,0.07)' }} />
      <div style={{ padding: '10px 14px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ height: 13, borderRadius: 3, background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ height: 13, width: '60%', borderRadius: 3, background: 'rgba(255,255,255,0.05)' }} />
      </div>
    </div>
  );
}

function VideoLeagueBlock({ block, isMobile, isTablet }: { block: VideoBlock; isMobile: boolean; isTablet: boolean }) {
  const accent = LEAGUE_ACCENT[block.leagueKey] ?? '#64748b';
  const label = LEAGUE_LABEL[block.leagueKey] ?? block.leagueKey;
  // Guard: compatibilidad con respuesta antigua del servidor
  const highlights = Array.isArray(block.highlights) ? block.highlights : [];

  return (
    <div style={{ marginBottom: 40 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ width: 3, height: 20, borderRadius: 2, background: accent, flexShrink: 0 }} />
        <h3 style={{
          fontSize: isMobile ? 14 : 15,
          fontWeight: 700,
          color: 'rgba(255,255,255,0.9)',
          margin: 0,
        }}>
          {label}
        </h3>
        {highlights.length > 0 && (
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
            {highlights.length} {highlights.length === 1 ? 'video' : 'videos'}
          </span>
        )}
      </div>

      {highlights.length > 0 ? (
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : isTablet ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))',
          gap: isMobile ? 8 : 12,
        }}>
          {highlights.map((h) => (
            <FeaturedVideoCard key={h.id} highlight={h} accentColor={accent} showLabel={false} compact />
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', margin: 0, paddingLeft: 13 }}>
          {block.error
            ? 'No se pudo cargar el video para esta liga.'
            : 'No hay videos disponibles ahora.'}
        </p>
      )}
    </div>
  );
}

interface VideoSectionProps {
  feed: VideoFeed | null;
  loading: boolean;
  error: string | null;
}

export function VideoSection({ feed, loading, error }: VideoSectionProps) {
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';
  const isTablet = breakpoint === 'tablet';
  const cols = isMobile ? 1 : 2;

  if (loading) {
    return (
      <div style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 32 }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: 24,
        }}>
          {[1, 2, 3, 4].map((i) => <SkeletonVideo key={i} />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 24 }}>
        Error al cargar videos. Intentá de nuevo más tarde.
      </p>
    );
  }

  if (!feed) return null;

  const orderedBlocks = BLOCK_ORDER
    .map((key) => feed.blocks.find((b) => b.leagueKey === key))
    .filter(Boolean) as VideoBlock[];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 32 }}>
      {orderedBlocks.map((block) => (
        <VideoLeagueBlock
          key={block.leagueKey}
          block={block}
          isMobile={isMobile}
          isTablet={isTablet}
        />
      ))}
    </div>
  );
}
