// spec §13 — vista principal de Eventos V1
import type { EventosFeed, ParsedEvent } from '../../hooks/use-events.js';
import { EventCard } from './EventCard.js';
import { DebugTable } from './DebugTable.js';
import { AdBlockerBanner } from './AdBlockerBanner.js';
import { useWindowWidth } from '../../hooks/use-window-width.js';

const ACCENT: Record<string, string> = {
  URUGUAY_PRIMERA: '#3b82f6',
  LALIGA: '#f59e0b',
  PREMIER_LEAGUE: '#a855f7',
  BUNDESLIGA: '#ef4444',
};

// spec §13.2 — chips de filtro (visibles en V1, informacionales)
const FILTER_CHIPS: { key: string; label: string }[] = [
  { key: 'URUGUAY_PRIMERA', label: 'Uruguay' },
  { key: 'LALIGA', label: 'LaLiga' },
  { key: 'PREMIER_LEAGUE', label: 'Premier' },
  { key: 'BUNDESLIGA', label: 'Bundesliga' },
];

function SkeletonCard() {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 10,
      padding: 14,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      <div style={{ height: 16, width: '30%', borderRadius: 4, background: 'rgba(255,255,255,0.07)' }} />
      <div style={{ height: 20, width: '70%', borderRadius: 4, background: 'rgba(255,255,255,0.05)' }} />
      <div style={{ height: 30, width: '50%', borderRadius: 6, background: 'rgba(255,255,255,0.06)' }} />
    </div>
  );
}

interface EventsSectionProps {
  feed: EventosFeed | null;
  loading: boolean;
  error: string | null;
}

export function EventsSection({ feed, loading, error }: EventsSectionProps) {
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';
  const cols = isMobile ? 1 : breakpoint === 'tablet' ? 2 : 3;

  // spec §13.2 — encabezado
  const header = (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: isMobile ? 20 : 24, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>
        Eventos
      </h2>
      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', margin: 0 }}>
        Partidos de hoy
      </p>

      {/* spec §13.2 — chips de filtro visibles (informativos en V1) */}
      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        {FILTER_CHIPS.map((chip) => {
          const accent = ACCENT[chip.key] ?? '#64748b';
          const count = feed?.events.filter((e) => e.normalizedLeague === chip.key).length ?? 0;
          return (
            <div
              key={chip.key}
              style={{
                padding: '4px 12px',
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 600,
                background: `${accent}18`,
                color: accent,
                border: `1px solid ${accent}44`,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {chip.label}
              {!loading && feed && (
                <span style={{ fontSize: 10, opacity: 0.7, fontWeight: 400 }}>
                  {count}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  if (loading) {
    return (
      <div>
        {header}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 12 }}>
          {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        {header}
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
          Error al cargar eventos. Intentá de nuevo más tarde.
        </p>
      </div>
    );
  }

  if (!feed) return <div>{header}</div>;

  // spec §13.3 — fila principal: Fútbol uruguayo hoy
  const uruguayEvents: ParsedEvent[] = feed.events.filter(
    (e) => e.normalizedLeague === 'URUGUAY_PRIMERA',
  );

  // spec §13.4 — lista compacta de otras ligas objetivo (sin bloque visual completo)
  const otherTargetLeagues = ['LALIGA', 'PREMIER_LEAGUE', 'BUNDESLIGA'] as const;
  const otherLeagueEvents: ParsedEvent[] = feed.events.filter(
    (e) => (otherTargetLeagues as readonly string[]).includes(e.normalizedLeague),
  );

  return (
    <div>
      {header}
      <AdBlockerBanner isMobile={isMobile} />

      {/* spec §13.3 — bloque principal: Uruguay (Señal 1 + Señal 2 por partido) */}
      <div style={{ marginBottom: 32 }}>
        <SectionHeader accent={ACCENT.URUGUAY_PRIMERA} title="Fútbol uruguayo hoy" count={uruguayEvents.length} />
        <div style={{ marginTop: 14 }}>
          {uruguayEvents.length === 0 ? (
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', margin: 0, paddingLeft: 13 }}>
              No hay partidos uruguayos disponibles hoy.
            </p>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gap: isMobile ? 10 : 12,
            }}>
              {uruguayEvents.flatMap((ev) => [
                <EventCard
                  key={`${ev.id}-s1`}
                  event={ev}
                  accentColor={ACCENT.URUGUAY_PRIMERA}
                  isMobile={isMobile}
                  signalLabel="Señal 1"
                />,
                <EventCard
                  key={`${ev.id}-s2`}
                  event={ev}
                  accentColor={ACCENT.URUGUAY_PRIMERA}
                  isMobile={isMobile}
                  signalLabel="Señal 2"
                  altUrl="https://www.livegoal.futbolandres.xyz/p/vtv.html"
                />,
              ])}
            </div>
          )}
        </div>
      </div>

      {/* spec §13.4 — lista compacta de otras ligas */}
      {otherLeagueEvents.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <SectionHeader
            accent="#64748b"
            title="Otras ligas objetivo"
            count={otherLeagueEvents.length}
          />
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: 10,
            marginTop: 14,
          }}>
            {otherLeagueEvents.map((ev) => (
              <EventCard
                key={ev.id}
                event={ev}
                accentColor={ACCENT[ev.normalizedLeague] ?? '#64748b'}
                isMobile={isMobile}
              />
            ))}
          </div>
        </div>
      )}

      {/* spec §14 — debug de parseo: visible solo si debugMode=true */}
      {feed.debugMode && (
        <DebugTable events={feed.events} />
      )}
    </div>
  );
}

function SectionHeader({ accent, title, count }: { accent: string; title: string; count?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 3, height: 20, borderRadius: 2, background: accent, flexShrink: 0 }} />
      <h3 style={{ fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,0.9)', margin: 0 }}>
        {title}
      </h3>
      {count !== undefined && count > 0 && (
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
          {count} {count === 1 ? 'partido' : 'partidos'}
        </span>
      )}
    </div>
  );
}

function LeagueBlock({
  title, events, accent, isMobile, cols, emptyMessage,
}: {
  title: string;
  events: ParsedEvent[];
  accent: string;
  isMobile: boolean;
  cols: number;
  emptyMessage: string;
}) {
  return (
    <div style={{ marginBottom: 32 }}>
      <SectionHeader accent={accent} title={title} count={events.length} />
      <div style={{ marginTop: 14 }}>
        {events.length === 0 ? (
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', margin: 0, paddingLeft: 13 }}>
            {emptyMessage}
          </p>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gap: isMobile ? 10 : 12,
          }}>
            {events.map((ev) => (
              <EventCard key={ev.id} event={ev} accentColor={accent} isMobile={isMobile} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
