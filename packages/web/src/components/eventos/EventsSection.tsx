/**
 * EventsSection — Streaming Center Premium 2026
 * Self-contained: fetcha useEvents internamente.
 * Tab state viene del padre (coordinado con Navbar en mobile).
 */
import { useEvents } from '../../hooks/use-events.js';
import type { ParsedEvent } from '../../hooks/use-events.js';
import { EventCard } from './EventCard.js';
import { DebugTable } from './DebugTable.js';
import { AdBlockerBanner } from './AdBlockerBanner.js';
import { useWindowWidth } from '../../hooks/use-window-width.js';
import { useTheme } from '../../hooks/use-theme.js';

// ── Configuración de señales por liga ─────────────────────────────────────────

const SIGNALS_BY_LEAGUE: Record<string, { label: string; altUrl?: string }[]> = {
  URUGUAY_PRIMERA: [
    { label: 'Señal 1' },
    { label: 'Señal 2', altUrl: 'https://www.livegoal.futbolandres.xyz/p/vtv.html' },
  ],
};

// ── Colores de acento por liga ─────────────────────────────────────────────────

const ACCENT: Record<string, string> = {
  URUGUAY_PRIMERA: '#3b82f6',
  LALIGA:          '#f59e0b',
  PREMIER_LEAGUE:  '#a855f7',
  BUNDESLIGA:      '#ef4444',
  OTRA:            '#64748b',
};

// ── Helpers de filtrado ───────────────────────────────────────────────────────

function isEventTomorrow(ev: ParsedEvent): boolean {
  if (!ev.startsAtPortalTz) return false;
  try {
    const evDay = new Intl.DateTimeFormat('es-UY', {
      timeZone: 'America/Montevideo', day: '2-digit', month: '2-digit', year: 'numeric',
    }).format(new Date(ev.startsAtPortalTz));
    const tmr = new Date();
    tmr.setDate(tmr.getDate() + 1);
    const tmrDay = new Intl.DateTimeFormat('es-UY', {
      timeZone: 'America/Montevideo', day: '2-digit', month: '2-digit', year: 'numeric',
    }).format(tmr);
    return evDay === tmrDay;
  } catch { return false; }
}

function filterVisible(events: ParsedEvent[]) {
  return events.filter(
    (e) => e.normalizedLeague !== 'EXCLUIDA' && e.normalizedLeague !== 'OTRA',
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonCard({ isMobile }: { isMobile: boolean }) {
  return (
    <div style={{
      background: 'var(--sp-surface-card)',
      border: '1px solid var(--sp-border-6)',
      borderRadius: isMobile ? 14 : 16,
      padding: isMobile ? 12 : 16,
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ height: 10, width: '35%', borderRadius: 4, background: 'var(--sp-border-8)' }} />
        <div style={{ height: 10, width: 48, borderRadius: 20, background: 'var(--sp-border-8)' }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--sp-border-8)' }} />
          <div style={{ height: 10, width: '70%', borderRadius: 4, background: 'var(--sp-border-6)' }} />
        </div>
        <div style={{ width: 44, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
          <div style={{ height: 8, width: 20, borderRadius: 4, background: 'var(--sp-border-8)' }} />
          <div style={{ height: 14, width: 36, borderRadius: 4, background: 'var(--sp-border-8)' }} />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
          <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--sp-border-8)' }} />
          <div style={{ height: 10, width: '70%', borderRadius: 4, background: 'var(--sp-border-6)' }} />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid var(--sp-border-6)' }}>
        <div style={{ height: 10, width: '30%', borderRadius: 4, background: 'var(--sp-border-8)' }} />
        <div style={{ height: 10, width: '20%', borderRadius: 4, background: 'var(--sp-border-8)' }} />
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

interface EventsSectionProps {
  activeTab: 'hoy' | 'manana';
  onTabChange: (tab: 'hoy' | 'manana') => void;
}

export function EventsSection({ activeTab, onTabChange }: EventsSectionProps) {
  const { data: feed, loading, error } = useEvents(true);
  const { breakpoint } = useWindowWidth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const isMobile = breakpoint === 'mobile';

  const cols = isMobile ? 1 : breakpoint === 'tablet' ? 2 : 4;

  // ── Filtrar eventos por tab ───────────────────────────────────────────────
  const visibleEvents = feed ? filterVisible(feed.events) : [];
  const todayEvents   = visibleEvents.filter((e) => e.isTodayInPortalTz);
  const tomorrowEvents = visibleEvents.filter((e) => !e.isTodayInPortalTz && isEventTomorrow(e));

  const tabEvents = activeTab === 'hoy' ? todayEvents : tomorrowEvents;

  // ── Tabs — solo visibles en desktop (en mobile los renderiza el Navbar) ──
  const Tabs = !isMobile ? (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      padding: 4,
      background: 'var(--sp-surface)',
      border: '1px solid var(--sp-border-8)',
      borderRadius: 9999,
      width: 'fit-content',
      marginBottom: 20,
    }}>
      {(['hoy', 'manana'] as const).map((tab) => {
        const isActive = activeTab === tab;
        const count    = tab === 'hoy' ? todayEvents.length : tomorrowEvents.length;
        const label    = tab === 'hoy' ? 'Hoy' : 'Mañana';
        return (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            style={{
              padding: '6px 16px', borderRadius: 9999, border: 'none',
              background: isActive ? 'var(--sp-primary-10)' : 'transparent',
              color: isActive ? 'var(--sp-text)' : 'var(--sp-text-40)',
              fontSize: 13, fontWeight: isActive ? 700 : 500,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              transition: 'all 0.15s ease', outline: 'none', minHeight: 36,
              boxShadow: isActive ? 'inset 0 0 0 1px var(--sp-primary-40)' : 'none',
            }}
          >
            {label}
            {!loading && count > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 9999,
                background: isActive ? 'var(--sp-primary-40)' : 'var(--sp-border-8)',
                color: isActive ? 'var(--sp-text)' : 'var(--sp-text-30)',
              }}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  ) : null;

  // ── Contenedor general ────────────────────────────────────────────────────
  return (
    <div style={{
      maxWidth: 1400, margin: '0 auto',
      padding: isMobile ? '12px' : '16px 20px',
    }}>
      <AdBlockerBanner isMobile={isMobile} />

      {Tabs}

      {/* Loading */}
      {loading && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gap: isMobile ? 10 : 14,
        }}>
          {[1, 2, 3, 4].map((i) => <SkeletonCard key={i} isMobile={isMobile} />)}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div style={{
          padding: '32px 0', textAlign: 'center',
          color: 'var(--sp-text-30)', fontSize: 13,
        }}>
          No se pudieron cargar los eventos. Intentá de nuevo más tarde.
        </div>
      )}

      {/* Grid de eventos */}
      {!loading && !error && tabEvents.length === 0 && (
        <div style={{
          padding: '48px 20px', textAlign: 'center',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 32 }}>📡</span>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--sp-text-50)', margin: 0 }}>
            Sin eventos {activeTab === 'hoy' ? 'programados para hoy' : 'para mañana'} por ahora
          </p>
          <p style={{ fontSize: 12, color: 'var(--sp-text-25)', margin: 0, maxWidth: 280, lineHeight: 1.5 }}>
            Los partidos y señales se cargan el mismo día. Volvé a consultar más tarde.
          </p>
          {feed && (
            <p style={{ fontSize: 10, color: 'var(--sp-text-20)', margin: '4px 0 0' }}>
              Último chequeo: {new Intl.DateTimeFormat('es-UY', {
                timeZone: 'America/Montevideo',
                hour: '2-digit', minute: '2-digit',
              }).format(new Date(feed.fetchedAtUtc))}
            </p>
          )}
        </div>
      )}

      {!loading && !error && tabEvents.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gap: isMobile ? 10 : 14,
        }}>
          {tabEvents.map((ev, i) => (
            <EventCard
              key={ev.id}
              event={ev}
              accentColor={ACCENT[ev.normalizedLeague] ?? '#64748b'}
              isMobile={isMobile}
              signals={SIGNALS_BY_LEAGUE[ev.normalizedLeague]}
              animationDelay={i * 40}
              hasSignal={ev.openUrl !== null}
            />
          ))}
        </div>
      )}

      {/* Debug table — solo si debugMode=true */}
      {feed?.debugMode && <DebugTable events={feed.events} />}
    </div>
  );
}
