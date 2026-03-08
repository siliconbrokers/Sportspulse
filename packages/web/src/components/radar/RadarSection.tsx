/**
 * Radar SportPulse — Section Component
 * Spec: radar-04-ui-ux-spec.md §4–§6
 *
 * Layout:
 * - Desktop: up to 3 columns
 * - Tablet (≤900px): 2 columns
 * - Mobile (≤600px): 1 column, vertical stack
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

export function RadarSection({ data, loading, onViewMatch }: RadarSectionProps) {
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';
  const isTablet = breakpoint === 'tablet';

  // Section header
  const header = (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <h2 style={{
          margin: 0,
          fontSize: isMobile ? 16 : 18,
          fontWeight: 700,
          color: 'rgba(255,255,255,0.9)',
          letterSpacing: '-0.01em',
        }}>
          Radar SportPulse
        </h2>
        <span style={{
          fontSize: 12,
          color: 'rgba(255,255,255,0.35)',
          fontWeight: 400,
        }}>
          Partidos destacados
        </span>
      </div>
    </div>
  );

  // Loading skeleton
  if (loading) {
    return (
      <div style={{ marginBottom: 24 }}>
        {header}
        <div style={{
          height: 180,
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)' }}>Cargando Radar…</span>
        </div>
      </div>
    );
  }

  if (!data || data.state === 'unavailable') {
    return (
      <div style={{ marginBottom: 24 }}>
        {header}
        <RadarUnavailableState />
      </div>
    );
  }

  if (data.state === 'empty' || !data.index || data.index.cards.length === 0) {
    return (
      <div style={{ marginBottom: 24 }}>
        {header}
        <RadarEmptyState />
      </div>
    );
  }

  const cards = data.index.cards;
  const liveMap = new Map<string, RadarLiveMatchData>(
    data.liveData.map((ld) => [ld.matchId, ld]),
  );

  // Responsive column count: spec §6 — desktop 3, tablet/mobile 1
  // Tablet (640-1023px) también muestra 1 columna para cubrir phones en landscape y tablets en portrait.
  const colCount = isMobile || isTablet ? 1 : Math.min(cards.length, 3);

  return (
    <div style={{ marginBottom: 24 }}>
      {header}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${colCount}, 1fr)`,
        gap: isMobile ? 12 : 16,
        width: '100%',
        boxSizing: 'border-box',
      }}>
        {cards.map((card) => (
          <div key={card.matchId} style={{ minWidth: 0 }}>
            <RadarCard
              card={card}
              live={liveMap.get(card.matchId) ?? null}
              matchday={data.index?.matchday}
              onViewMatch={onViewMatch}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
