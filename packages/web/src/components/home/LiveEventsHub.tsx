// Live Events Hub v2 — ventana de 48h: vivo → hoy → mañana (21:00+)
import type { EventosFeed, ParsedEvent } from '../../hooks/use-events.js';
import { BentoMatchCard } from './BentoMatchCard.js';

const LEAGUE_ORDER = ['URUGUAY_PRIMERA', 'LALIGA', 'PREMIER_LEAGUE', 'BUNDESLIGA'] as const;

const LEAGUE_LABELS: Record<string, string> = {
  URUGUAY_PRIMERA: 'Fútbol Uruguayo',
  LALIGA:          'LaLiga',
  PREMIER_LEAGUE:  'Premier League',
  BUNDESLIGA:      'Bundesliga',
};

const LEAGUE_ACCENT: Record<string, string> = {
  URUGUAY_PRIMERA: '#3b82f6',
  LALIGA:          '#f59e0b',
  PREMIER_LEAGUE:  '#a855f7',
  BUNDESLIGA:      '#ef4444',
};

const URUGUAY_SIGNALS = [
  { label: 'Señal 1' },
  { label: 'Señal 2', altUrl: 'https://www.livegoal.futbolandres.xyz/p/vtv.html' },
];

/** Hora actual en timezone del portal */
function currentHourInUY(): number {
  const str = new Date().toLocaleString('es-UY', {
    timeZone: 'America/Montevideo',
    hour: 'numeric',
    hour12: false,
  });
  return parseInt(str, 10) || 0;
}

interface LiveEventsHubProps {
  feed: EventosFeed | null;
  loading: boolean;
  isMobile: boolean;
}

function LiveDot() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: 'var(--sp-primary)',
        boxShadow: '0 0 8px var(--sp-primary-40)',
        animation: 'pulse-live 2s cubic-bezier(0.4,0,0.6,1) infinite',
        flexShrink: 0,
      }}
    />
  );
}

function SkeletonBento({ isMobile }: { isMobile: boolean }) {
  return (
    <div
      style={{
        borderRadius: '1.5rem',
        background: 'var(--sp-border-4)',
        border: '1px solid var(--sp-border)',
        minHeight: isMobile ? 155 : 170,
        animation: 'none',
      }}
    />
  );
}

function SectionLabel({ accent, label }: { accent: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <div
        style={{
          width: 3,
          height: 16,
          borderRadius: 2,
          background: accent,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: accent,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
    </div>
  );
}

export function LiveEventsHub({ feed, loading, isMobile }: LiveEventsHubProps) {
  const liveEvents = feed?.events.filter((e) => e.normalizedStatus === 'EN_VIVO') ?? [];
  const upcomingEvents = feed?.events.filter((e) => e.normalizedStatus === 'PROXIMO') ?? [];

  const hasLive = liveEvents.length > 0;
  const hour = currentHourInUY();
  const isLateNight = hour >= 21;

  // Ventana de 48h: si es tarde y no hay vivos → promocionamos PROXIMO como "Mañana"
  const labelOverride = !hasLive && isLateNight && upcomingEvents.length > 0
    ? 'MAÑANA'
    : undefined;

  const eventsToShow = hasLive ? liveEvents : upcomingEvents;

  if (!loading && eventsToShow.length === 0) return null;

  const grouped = new Map<string, ParsedEvent[]>();
  for (const league of LEAGUE_ORDER) {
    const events = eventsToShow.filter((e) => e.normalizedLeague === league);
    if (events.length > 0) grouped.set(league, events);
  }

  const cols = isMobile ? 1 : 2;

  const sectionTitle = hasLive
    ? 'En Vivo Ahora'
    : labelOverride
      ? 'Partidos de Mañana'
      : 'Próximos Partidos';

  return (
    <div
      style={{
        background: 'var(--sp-surface)',
        borderRadius: '1.5rem',
        padding: isMobile ? 20 : 28,
        border: hasLive
          ? '1px solid var(--sp-primary-22)'
          : '1px solid var(--sp-border)',
        boxShadow: hasLive ? '0 0 28px var(--sp-primary-10)' : 'none',
        marginBottom: isMobile ? 20 : 32,
        transition: 'background 0.2s ease',
      }}
    >
      {/* Header de sección */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        {hasLive && <LiveDot />}
        <h2
          style={{
            fontSize: isMobile ? 16 : 18,
            fontWeight: 800,
            color: 'var(--sp-text)',
            margin: 0,
            letterSpacing: '-0.01em',
          }}
        >
          {sectionTitle}
        </h2>
        {hasLive && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--sp-primary)',
              background: 'var(--sp-primary-10)',
              border: '1px solid var(--sp-primary-22)',
              borderRadius: 20,
              padding: '2px 8px',
              letterSpacing: '0.06em',
            }}
          >
            {liveEvents.length} {liveEvents.length === 1 ? 'partido' : 'partidos'}
          </span>
        )}
        {labelOverride && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: '#fbbf24',
              background: 'rgba(251,191,36,0.1)',
              border: '1px solid rgba(251,191,36,0.25)',
              borderRadius: 20,
              padding: '2px 8px',
              letterSpacing: '0.06em',
            }}
          >
            Ventana +24h
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 12 }}>
          {[1, 2, 3, 4].map((i) => <SkeletonBento key={i} isMobile={isMobile} />)}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {[...grouped.entries()].map(([league, events]) => (
            <div key={league}>
              <SectionLabel accent={LEAGUE_ACCENT[league] ?? '#64748b'} label={LEAGUE_LABELS[league] ?? league} />
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                  gap: 12,
                }}
              >
                {events.map((ev) => (
                  <BentoMatchCard
                    key={ev.id}
                    event={ev}
                    isMobile={isMobile}
                    labelOverride={labelOverride}
                    signals={league === 'URUGUAY_PRIMERA' ? URUGUAY_SIGNALS : undefined}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
