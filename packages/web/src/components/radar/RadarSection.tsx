/**
 * RadarSection — Bento Grid de tarjetas del Radar.
 * Premium 2026 Design System. Mobile-First.
 *
 * Layout:
 *   Mobile  (≤640px):  1 columna, stack vertical
 *   Tablet  (≤900px):  2 columnas
 *   Desktop (>900px):  3 columnas (máximo)
 *
 * Sin título redundante — el usuario llega desde el Navbar.
 */

import { useWindowWidth } from '../../hooks/use-window-width.js';
import type { RadarData, RadarLiveMatchData } from '../../hooks/use-radar.js';
import { RadarCard } from './RadarCard.js';
import { RadarEmptyState } from './RadarEmptyState.js';
import { RadarUnavailableState } from './RadarUnavailableState.js';

interface RadarSectionProps {
  data: RadarData | null;
  loading: boolean;
  onViewMatch?: (matchId: string) => void;
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function RadarSkeleton({ cols }: { cols: number }) {
  const items = Array.from({ length: cols });
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: 16,
    }}>
      {items.map((_, i) => (
        <div key={i} style={{
          height: 220,
          background: 'var(--sp-surface-card)',
          border: '1px solid var(--sp-border-8)',
          borderRadius: 16,
          animation: 'pulse 1.8s ease-in-out infinite',
        }} />
      ))}
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

export function RadarSection({ data, loading, onViewMatch }: RadarSectionProps) {
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';
  const isTablet = breakpoint === 'tablet';
  const cols     = isMobile ? 1 : isTablet ? 2 : 3;

  if (loading) {
    return <RadarSkeleton cols={isMobile ? 1 : cols} />;
  }

  if (!data || data.state === 'unavailable') {
    return <RadarUnavailableState />;
  }

  if (data.state === 'empty' || !data.index || data.index.cards.length === 0) {
    return <RadarEmptyState />;
  }

  const competitionKey = data.index.competitionKey;
  const matchday       = data.index.matchday;

  const liveMap = new Map<string, RadarLiveMatchData>(
    data.liveData.map((ld) => [ld.matchId, ld]),
  );

  // Orden: primero los EN VIVO, luego por hora de inicio
  const cards = [...data.index.cards].sort((a, b) => {
    const la = liveMap.get(a.matchId);
    const lb = liveMap.get(b.matchId);
    const aLive = la?.status === 'IN_PROGRESS' ? 0 : 1;
    const bLive = lb?.status === 'IN_PROGRESS' ? 0 : 1;
    if (aLive !== bLive) return aLive - bLive;
    const ta = la?.startTimeUtc ?? '';
    const tb = lb?.startTimeUtc ?? '';
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });

  const gridCols = Math.min(cards.length, cols);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
      gap: isMobile ? 12 : 16,
    }}>
      {cards.map((card, i) => (
        <RadarCard
          key={card.matchId}
          card={card}
          live={liveMap.get(card.matchId) ?? null}
          competitionKey={competitionKey}
          matchday={matchday}
          onViewMatch={onViewMatch}
          animationDelay={i * 60}
        />
      ))}
    </div>
  );
}
