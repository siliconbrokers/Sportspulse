/**
 * EventsSection — Streaming Center Premium 2026
 * Para las 4 ligas canónicas (URU/LL/EPL/BUN) usa datos canónicos de /api/ui/upcoming
 * y los anota con la URL de streaming de streamtp10 si hay match.
 * Para ligas no canónicas usa streamtp10 directamente.
 */
import { useState, useEffect, useCallback } from 'react';
import { useEvents } from '../../hooks/use-events.js';
import type { ParsedEvent } from '../../hooks/use-events.js';
import { EventCard } from './EventCard.js';
import { DebugTable } from './DebugTable.js';
import { AdBlockerBanner } from './AdBlockerBanner.js';
import { useWindowWidth } from '../../hooks/use-window-width.js';
import { useTheme } from '../../hooks/use-theme.js';
import { useTeamDetail } from '../../hooks/use-team-detail.js';
import { DetailPanel } from '../DetailPanel.js';
import { getMatchDisplayStatus, AUTOFINISH_THRESHOLD_MIN } from '../../utils/match-status.js';
import { COMP_ID_TO_NORMALIZED_LEAGUE, MANAGED_NORMALIZED_LEAGUES } from '../../utils/competition-meta.js';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface UpcomingMatchDTO {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeCrestUrl: string | null;
  awayCrestUrl: string | null;
  homeTeamId: string;
  awayTeamId: string;
  competitionId: string;
  currentMatchday: number | null;
  normalizedLeague: string;
  normalizedStatus: 'EN_VIVO' | 'PROXIMO';
  kickoffUtc: string;
  startsAtPortalTz: string;
  isTodayInPortalTz: boolean;
  scoreHome: number | null;
  scoreAway: number | null;
}

// ── Configuración de señales por liga ─────────────────────────────────────────

const SIGNALS_BY_LEAGUE: Record<string, { label: string; altUrl?: string }[]> = {
  URUGUAY_PRIMERA: [
    { label: 'Señal 1' },
    { label: 'Señal 2', altUrl: 'https://www.livegoal.futbolandres.xyz/p/vtv.html' },
  ],
};

// ── Colores de acento por liga ─────────────────────────────────────────────────

const ACCENT: Record<string, string> = {
  URUGUAY_PRIMERA:   '#3b82f6',
  ARGENTINA_PRIMERA: '#74b9ff',
  LALIGA:            '#f59e0b',
  PREMIER_LEAGUE:    '#a855f7',
  BUNDESLIGA:        '#ef4444',
  COPA_LIBERTADORES: '#eab308',
  OTRA:              '#64748b',
};

// ── Ligas con cobertura canónica (no se usa streamtp10 para estas) ─────────────
// COPA_LIBERTADORES incluida: cuando CLI está cargado, los partidos usan datos
// canónicos con soporte completo de DetailPanel (crests, estado, pronóstico).

const CANONICAL_LEAGUES = new Set(['URUGUAY_PRIMERA', 'ARGENTINA_PRIMERA', 'LALIGA', 'PREMIER_LEAGUE', 'BUNDESLIGA', 'COPA_LIBERTADORES']);


// ── Helpers ───────────────────────────────────────────────────────────────────

function normName(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')  // decode HTML entities
    .replace(/'/g, '')                                                      // strip apostrophes: "Newell's" → "Newells"
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b\d+\b/g, '')                   // strip números standalone: "04", "1860"
    .replace(/\b(de|del|la|el|los|las)\b/g, '') // strip preposiciones: "Club Atletico de Madrid"
    .replace(/\s+/g, ' ')
    .trim();
}

function teamsMatch(a: string, b: string): boolean {
  const an = normName(a);
  const bn = normName(b);
  return an === bn || an.includes(bn) || bn.includes(an);
}

/**
 * Busca en el feed de streamtp10 el evento correspondiente a un partido canónico.
 * Retorna el ParsedEvent de streamtp10 para poder reusar su ID (el server lo conoce)
 * y su openUrl.
 */
function findStreamEvent(m: UpcomingMatchDTO, streamEvents: ParsedEvent[]): ParsedEvent | null {
  return streamEvents.find(
    (e) =>
      e.normalizedLeague === m.normalizedLeague &&
      e.openUrl != null &&
      teamsMatch(m.homeTeam, e.homeTeam ?? '') &&
      teamsMatch(m.awayTeam, e.awayTeam ?? ''),
  ) ?? null;
}

/**
 * Convierte un partido canónico en ParsedEvent.
 * Si hay match en streamtp10, usa su ID (el server lo conoce para el player)
 * y su openUrl. Los datos de equipos y crests vienen del canónico.
 */
function canonicalToEvent(m: UpcomingMatchDTO, streamEvent: ParsedEvent | null): ParsedEvent {
  return {
    // Usar ID del streamtp10 si existe → el server puede resolver la URL del player
    id:                          streamEvent?.id ?? `canonical:${m.id}`,
    rawText:                     `${m.homeTeam} vs ${m.awayTeam}`,
    sourceUrl:                   streamEvent?.sourceUrl ?? '',
    sourceLanguage:              'es',
    sourceTimeText:              null,
    sourceCompetitionText:       null,
    sourceStatusText:            null,
    // Nombres y crests del canónico (fuente de verdad)
    homeTeam:                    m.homeTeam,
    awayTeam:                    m.awayTeam,
    normalizedLeague:            m.normalizedLeague as ParsedEvent['normalizedLeague'],
    normalizedStatus:            m.normalizedStatus,
    sourceTimezoneOffsetMinutes: null,
    startsAtSource:              m.kickoffUtc,
    startsAtPortalTz:            m.startsAtPortalTz,
    isTodayInPortalTz:           m.isTodayInPortalTz,
    isDebugVisible:              false,
    openUrl:                     streamEvent?.openUrl ?? null,
    homeCrestUrl:                m.homeCrestUrl,
    awayCrestUrl:                m.awayCrestUrl,
    scoreHome:                   m.scoreHome,
    scoreAway:                   m.scoreAway,
  };
}

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
  enabledCompetitionIds?: string[];
}

export function EventsSection({ activeTab, onTabChange, enabledCompetitionIds }: EventsSectionProps) {
  // Si hay 0 ligas habilitadas explícitamente, no hacer fetches
  const enabledCount = enabledCompetitionIds?.length ?? null;
  const fetchEnabled = enabledCount !== 0;

  const { data: feed, loading: loadingStream, error } = useEvents(fetchEnabled);
  const { breakpoint } = useWindowWidth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const isMobile = breakpoint === 'mobile';

  const cols = isMobile ? 1 : breakpoint === 'tablet' ? 2 : 4;

  // ── Foco en partido para DetailPanel ──────────────────────────────────────
  const [focusState, setFocusState] = useState<{
    teamId: string; matchId: string; competitionId: string; matchday: number | null;
  } | null>(null);
  const { data: teamDetail } = useTeamDetail(
    focusState?.competitionId ?? '',
    focusState?.teamId ?? null,
    focusState?.matchday ?? null,
    'America/Montevideo',
  );

  // ── Datos canónicos (misma fuente que LiveCarousel) ───────────────────────
  const [upcoming, setUpcoming] = useState<UpcomingMatchDTO[]>([]);
  const [loadingCanon, setLoadingCanon] = useState(true);

  const fetchCanon = useCallback(() => {
    fetch('/api/ui/upcoming')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { matches: UpcomingMatchDTO[] }) => setUpcoming(data.matches ?? []))
      .catch(() => {})
      .finally(() => setLoadingCanon(false));
  }, []);

  useEffect(() => {
    // Si hay 0 ligas habilitadas explícitamente, no iniciar ningún fetch
    if (!fetchEnabled) {
      setLoadingCanon(false);
      return;
    }
    fetchCanon();
    const id = setInterval(fetchCanon, 60_000);
    return () => clearInterval(id);
  }, [fetchCanon, fetchEnabled]);

  const loading = loadingStream || loadingCanon;

  // ── Fusión: canónicas para las 4 ligas, streamtp10 para el resto ──────────
  const streamAll = feed?.events ?? [];

  // Canónicas → convertir a ParsedEvent, buscando evento streamtp10 para ID y URL
  // También construimos mapa eventId→DTO para poder abrir DetailPanel al hacer click
  const canonicalDTOMap = new Map<string, UpcomingMatchDTO>();
  const canonicalEvents: ParsedEvent[] = upcoming
    .filter((m) => CANONICAL_LEAGUES.has(m.normalizedLeague))
    .map((m) => {
      const ev = canonicalToEvent(m, findStreamEvent(m, streamAll));
      canonicalDTOMap.set(ev.id, m);
      return ev;
    });

  // Ligas canónicas que sí tienen datos en este ciclo
  const canonicalLeaguesWithData = new Set(canonicalEvents.map((e) => e.normalizedLeague));

  // Streamtp10: ligas NO canónicas + fallback para canónicas sin datos (ej. CLI con 429 al startup)
  const streamOnlyEvents: ParsedEvent[] = streamAll.filter(
    (e) =>
      (!CANONICAL_LEAGUES.has(e.normalizedLeague) || !canonicalLeaguesWithData.has(e.normalizedLeague)) &&
      e.normalizedLeague !== 'EXCLUIDA' &&
      e.normalizedLeague !== 'OTRA',
  );

  // Filtrar eventos con kickoff > 180 min (partido efectivamente terminado).
  // Aplica a TODOS los eventos independientemente de normalizedStatus:
  // - streamtp10 puede dejar eventos con openUrl=null después del partido
  // - football-data free tier mantiene PROXIMO (nunca actualiza a EN_VIVO durante el partido)
  // En ambos casos el partido terminó y no debe mostrarse en la lista.
  function isEffectivelyFinished(e: ParsedEvent): boolean {
    if (!e.startsAtPortalTz) return false;
    const elapsed = (Date.now() - new Date(e.startsAtPortalTz).getTime()) / 60_000;
    return elapsed > AUTOFINISH_THRESHOLD_MIN;
  }

  const enabledLeagues = enabledCompetitionIds
    ? new Set(enabledCompetitionIds.map((id) => COMP_ID_TO_NORMALIZED_LEAGUE[id]).filter(Boolean))
    : null;

  const allEvents = [...canonicalEvents, ...streamOnlyEvents].filter((e) => {
    if (isEffectivelyFinished(e)) return false;
    if (enabledLeagues && MANAGED_NORMALIZED_LEAGUES.has(e.normalizedLeague) && !enabledLeagues.has(e.normalizedLeague)) return false;
    return true;
  });

  // ── Filtrar por tab (hoy / mañana) ────────────────────────────────────────
  const todayEvents    = allEvents.filter((e) => e.isTodayInPortalTz || e.normalizedStatus === 'EN_VIVO');
  const tomorrowEvents = allEvents.filter((e) => !e.isTodayInPortalTz && isEventTomorrow(e));

  const tabEvents = [...(activeTab === 'hoy' ? todayEvents : tomorrowEvents)]
    .sort((a, b) => (a.startsAtPortalTz ?? '').localeCompare(b.startsAtPortalTz ?? ''));

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
          {tabEvents.map((ev, i) => {
            const dto = canonicalDTOMap.get(ev.id);
            return (
              <EventCard
                key={ev.id}
                event={ev}
                accentColor={ACCENT[ev.normalizedLeague] ?? '#64748b'}
                isMobile={isMobile}
                signals={SIGNALS_BY_LEAGUE[ev.normalizedLeague]}
                animationDelay={i * 40}
                hasSignal={ev.openUrl !== null}
                onCardClick={dto ? () => {
                  const isToggleOff = focusState?.matchId === dto.id;
                  setFocusState(isToggleOff ? null : {
                    teamId: dto.homeTeamId,
                    matchId: dto.id,
                    competitionId: dto.competitionId,
                    matchday: dto.currentMatchday,
                  });
                } : undefined}
              />
            );
          })}
        </div>
      )}

      {/* Debug table — solo si debugMode=true */}
      {feed?.debugMode && <DebugTable events={feed.events} />}

      {/* DetailPanel — se abre al hacer click en tarjeta canónica */}
      {focusState && teamDetail && (
        <DetailPanel
          detail={teamDetail}
          onClose={() => setFocusState(null)}
        />
      )}
    </div>
  );
}
