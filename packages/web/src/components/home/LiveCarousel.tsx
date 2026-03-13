// LiveCarousel v3 — carrusel de partidos en vivo / próximos
// Fuente única de tarjetas: /api/ui/upcoming (canónicas: LL/PL/BL1/URU/WC/CLI)
// streamtp10 solo se consulta para enriquecer tarjetas canónicas con openUrl cuando cubre el partido.
// Features: liga permanente · borde neon live · zombie guard centralizado · título dinámico · Night/Day
import { useState, useEffect, useRef, useCallback } from 'react';
import type { ParsedEvent, EventosFeed } from '../../hooks/use-events.js';
import { openEventDirect } from '../../hooks/use-events.js';
import { getMatchDisplayStatus, ZOMBIE_THRESHOLD_MIN, AUTOFINISH_THRESHOLD_MIN } from '../../utils/match-status.js';
import { useTeamDetail } from '../../hooks/use-team-detail.js';
import { DetailPanel } from '../DetailPanel.js';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface UpcomingMatchDTO {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeTla?: string;
  awayTla?: string;
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

/** Estado visual de un partido en vivo tras aplicar el zombie guard (alias local) */
type LiveState = 'live' | 'zombie' | 'finished';

// ── Constantes ────────────────────────────────────────────────────────────────

const CARD_W_DESKTOP = 260;
const CARD_GAP       = 12;

// ZOMBIE_THRESHOLD_MIN y AUTOFINISH_THRESHOLD_MIN vienen de match-status.ts (importados arriba)

const LEAGUE_ACCENT: Record<string, string> = {
  URUGUAY_PRIMERA:    '#3b82f6',
  ARGENTINA_PRIMERA:  '#74b9ff',
  LALIGA:             '#f59e0b',
  PREMIER_LEAGUE:     '#a855f7',
  BUNDESLIGA:         '#ef4444',
  MUNDIAL:            '#22c55e',
  COPA_AMERICA:       '#3b82f6',
  COPA_LIBERTADORES:  '#eab308',
};

const LEAGUE_LABEL: Record<string, string> = {
  URUGUAY_PRIMERA:    'Uruguay · 1ª',
  ARGENTINA_PRIMERA:  'Argentina · 1ª',
  LALIGA:             'LaLiga EA',
  PREMIER_LEAGUE:     'Premier League',
  BUNDESLIGA:         'Bundesliga',
  MUNDIAL:            'Mundial 2026',
  COPA_AMERICA:       'Copa América',
  COPA_LIBERTADORES:  'Libertadores',
};

// ── CSS animations (inyectado una vez) ───────────────────────────────────────

const ANIMATIONS_ID = 'sp-live-carousel-anim';

function injectAnimations() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(ANIMATIONS_ID)) return;
  const style = document.createElement('style');
  style.id = ANIMATIONS_ID;
  style.textContent = `
    @keyframes sp-ring-pulse {
      0%, 100% { box-shadow: 0 0 0 0 var(--sp-primary-22), 0 0 14px var(--sp-primary-10); }
      50%       { box-shadow: 0 0 0 2px var(--sp-primary-10), 0 0 22px rgba(0,224,255,0.18); }
    }
    @keyframes sp-ring-pulse-day {
      0%, 100% { box-shadow: 0 0 0 0 rgba(0,160,200,0.20); }
      50%       { box-shadow: 0 0 0 3px rgba(0,160,200,0.12); }
    }
    @keyframes sp-badge-blink {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.55; }
    }
    @keyframes sp-zombie-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(251,191,36,0.20); }
      50%       { box-shadow: 0 0 0 2px rgba(251,191,36,0.10); }
    }
  `;
  document.head.appendChild(style);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normStr(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function formatTime(isoStr: string | null): string {
  if (!isoStr) return '—';
  try {
    // sv-SE con timeZone produce "YYYY-MM-DD HH:MM:SS" — formato determinista, 0-padded garantizado
    const local = new Date(isoStr).toLocaleString('sv-SE', { timeZone: 'America/Montevideo' });
    const [datePart, timePart] = local.split(' ');
    const [, mm, dd] = datePart.split('-');
    const [hh, min] = timePart.split(':');
    return `${dd}/${mm} - ${hh}:${min}`;
  } catch {
    return '—';
  }
}

/**
 * Zombie guard: determina el estado visual de un evento en base a
 * getMatchDisplayStatus() — función centralizada en utils/match-status.ts.
 * - 'live'     → EN VIVO confirmado (< 180 min)
 * - 'zombie'   → Pendiente de confirmación (180–240 min)
 * - 'finished' → Auto-terminado (> 240 min), debe filtrarse
 */
function getLiveState(event: ParsedEvent): LiveState {
  if (event.normalizedStatus !== 'EN_VIVO') return 'live'; // no aplica para PROXIMO
  // Mapeamos apiStatus a algo que getMatchDisplayStatus entienda
  const display = getMatchDisplayStatus('IN_PROGRESS', event.startsAtSource);
  if (display === 'FINISHED') return 'finished';
  if (display === 'ZOMBIE')   return 'zombie';
  return 'live';
}

/**
 * Convierte UpcomingMatchDTO → ParsedEvent.
 *
 * Si streamUrlMap contiene una URL para este par de equipos, se adjunta como openUrl.
 * El click en tarjeta usa openUrl != null como señal de "abrir stream" (vs. DetailPanel).
 */
function upcomingToEvent(m: UpcomingMatchDTO, streamUrlMap: Map<string, string>): ParsedEvent {
  const key = `${normStr(m.homeTeam)}|${normStr(m.awayTeam)}`;
  return {
    id:                          `canonical:${m.id}`,
    rawText:                     `${m.homeTeam} vs ${m.awayTeam}`,
    sourceUrl:                   '',
    sourceLanguage:              'es',
    sourceTimeText:              null,
    sourceCompetitionText:       null,
    sourceStatusText:            null,
    homeTeam:                    m.homeTeam,
    awayTeam:                    m.awayTeam,
    homeTla:                     m.homeTla,
    awayTla:                     m.awayTla,
    normalizedLeague:            m.normalizedLeague,
    normalizedStatus:            m.normalizedStatus,
    sourceTimezoneOffsetMinutes: null,
    startsAtSource:              m.kickoffUtc,
    startsAtPortalTz:            m.startsAtPortalTz,
    isTodayInPortalTz:           m.isTodayInPortalTz,
    isDebugVisible:              false,
    openUrl:                     streamUrlMap.get(key) ?? null,
    homeCrestUrl:                m.homeCrestUrl,
    awayCrestUrl:                m.awayCrestUrl,
    scoreHome:                   m.scoreHome,
    scoreAway:                   m.scoreAway,
  };
}

/** Extrae el ID del evento canónico (solo para eventos con id= "canonical:...") */
function getCanonicalId(eventId: string): string | null {
  return eventId.startsWith('canonical:') ? eventId.slice('canonical:'.length) : null;
}

/** Ordena: EN_VIVO → PROXIMO hoy → PROXIMO mañana */
function sortEvents(events: ParsedEvent[]): ParsedEvent[] {
  const byTime = (a: ParsedEvent, b: ParsedEvent) =>
    (a.startsAtPortalTz ?? '').localeCompare(b.startsAtPortalTz ?? '');

  const live     = events.filter((e) => e.normalizedStatus === 'EN_VIVO').sort(byTime);
  const upcoming = events.filter((e) => e.normalizedStatus === 'PROXIMO').sort(byTime);
  const today    = upcoming.filter((e) => e.isTodayInPortalTz);
  const tomorrow = upcoming.filter((e) => !e.isTodayInPortalTz);

  return [...live, ...today, ...tomorrow];
}

// ── CrestImg ──────────────────────────────────────────────────────────────────

function CrestImg({ src, alt, size }: { src: string | null; alt: string; size: number }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div style={{
        width: size, height: size, borderRadius: '50%',
        background: 'var(--sp-border-8)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: Math.round(size * 0.38), fontWeight: 700,
        color: 'var(--sp-text-40)', flexShrink: 0,
      }}>
        {(alt[0] ?? '?').toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={src} alt={alt} width={size} height={size}
      onError={() => setFailed(true)}
      style={{ objectFit: 'contain', flexShrink: 0 }}
    />
  );
}

// ── LiveMatchCard ─────────────────────────────────────────────────────────────

function LiveMatchCard({
  event,
  isMobile,
  isSelected,
  onDetailClick,
}: {
  event: ParsedEvent;
  isMobile: boolean;
  isSelected: boolean;
  onDetailClick: (eventId: string) => void;
}) {
  const isLive      = event.normalizedStatus === 'EN_VIVO';
  const liveState   = isLive ? getLiveState(event) : 'live';
  const isZombie    = liveState === 'zombie';
  const isStream    = !!event.openUrl;
  const isCanonical = event.id.startsWith('canonical:');
  const accent      = LEAGUE_ACCENT[event.normalizedLeague] ?? '#6b7280';
  const leagueLabel = LEAGUE_LABEL[event.normalizedLeague] ?? event.normalizedLeague;
  const timeStr     = formatTime(event.startsAtPortalTz);
  const crestSz     = isMobile ? 26 : 30;
  const cardW       = isMobile ? 'calc(80vw)' : `${CARD_W_DESKTOP}px`;

  // Borde: seleccionado > live > zombie > normal
  const cardBorder = isSelected
    ? '1.5px solid var(--sp-primary)'
    : isLive && !isZombie
    ? '1.5px solid var(--sp-primary)'
    : isZombie
    ? '1.5px solid rgba(251,191,36,0.55)'
    : `1px solid var(--sp-border-8)`;

  const cardAnimation = isLive && !isZombie && !isSelected
    ? 'sp-ring-pulse 2.4s ease-in-out infinite'
    : isZombie
    ? 'sp-zombie-pulse 2.4s ease-in-out infinite'
    : 'none';

  function handleClick() {
    if (isLive && !isZombie) {
      // LIVE: solo ir a stream si hay transmisión disponible
      if (isStream) openEventDirect(event);
    } else if (isStream) {
      openEventDirect(event);
    } else if (isCanonical) {
      onDetailClick(event.id);
    }
  }

  const isClickable = (isLive && !isZombie) ? isStream : (isStream || isCanonical);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => e.key === 'Enter' && handleClick()}
      style={{
        position: 'relative',
        width: cardW,
        maxWidth: isMobile ? 290 : CARD_W_DESKTOP,
        flexShrink: 0,
        scrollSnapAlign: 'start',
        borderRadius: '1rem',
        border: cardBorder,
        background: isSelected ? 'var(--sp-primary-04, rgba(0,224,255,0.04))' : 'var(--sp-surface)',
        animation: cardAnimation,
        padding: '12px 13px 11px',
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
        cursor: isClickable ? 'pointer' : 'default',
        outline: 'none',
        transition: 'transform 0.15s ease, border-color 0.15s ease',
      }}
      onMouseEnter={(e) => {
        if (isClickable) (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
      }}
    >
      {/* ── Badge zombie (top-right) ── */}
      {isZombie && (
        <span style={{
          position: 'absolute', top: 10, right: 10,
          display: 'inline-flex', alignItems: 'center', gap: 3,
          fontSize: 8, fontWeight: 800, letterSpacing: '0.06em',
          padding: '2px 7px', borderRadius: 20,
          background: 'rgba(251,191,36,0.15)',
          color: 'rgb(251,191,36)',
          border: '1px solid rgba(251,191,36,0.35)',
          lineHeight: 1.6,
        }}>
          ⏳ CONFIRMANDO
        </span>
      )}

      {/* ── Fila 1: Liga (siempre visible) + hora ── */}
      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
        // dejar espacio para el badge absoluto del zombie
        paddingRight: isZombie ? 108 : 0,
      }}>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
          color: 'var(--sp-text-40)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          flex: 1,
        }}>
          {leagueLabel}
        </span>
        <span style={{
          fontSize: 11, fontWeight: 700,
          color: isLive && !isZombie
            ? 'var(--sp-primary)'
            : isZombie
            ? 'rgb(251,191,36)'
            : 'var(--sp-text-55)',
          fontVariantNumeric: 'tabular-nums',
          flexShrink: 0,
          marginLeft: 6,
        }}>
          {timeStr}
        </span>
      </div>

      {/* ── Separador de liga ── */}
      <div style={{
        height: 1,
        background: isLive && !isZombie
          ? 'var(--sp-primary-22)'
          : isZombie
          ? 'rgba(251,191,36,0.20)'
          : 'var(--sp-border)',
        marginTop: -2,
      }} />

      {/* ── Equipos ── */}
      {(() => {
        const hasScore = isLive && !isZombie && event.scoreHome != null && event.scoreAway != null;
        const scoreColor = '#f97316';
        return (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Nombres + crests */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CrestImg src={event.homeCrestUrl} alt={event.homeTeam ?? 'L'} size={crestSz} />
                <span style={{
                  fontSize: 13, fontWeight: 700, color: 'var(--sp-text)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                }}>
                  {event.homeTeam ?? 'Local'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CrestImg src={event.awayCrestUrl} alt={event.awayTeam ?? 'V'} size={crestSz} />
                <span style={{
                  fontSize: 13, fontWeight: 700, color: 'var(--sp-text)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                }}>
                  {event.awayTeam ?? 'Visitante'}
                </span>
              </div>
            </div>

            {/* Columna derecha: scores */}
            {isLive && !isZombie && hasScore && (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 4, flexShrink: 0,
              }}>
                <span style={{ fontSize: 16, fontWeight: 900, color: scoreColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                  {event.scoreHome}
                </span>
                <span style={{ fontSize: 16, fontWeight: 900, color: scoreColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                  {event.scoreAway}
                </span>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── LIVE pulse — bottom-right absoluto ── */}
      {isLive && !isZombie && (
        <span style={{
          position: 'absolute', bottom: 10, right: 12,
          display: 'inline-flex', alignItems: 'center', gap: 3,
          fontSize: 8, fontWeight: 900, letterSpacing: '0.1em',
          padding: '2px 7px', borderRadius: 20,
          background: '#ef4444', color: '#fff',
          animation: 'sp-badge-blink 2s ease-in-out infinite',
          lineHeight: 1.6,
          boxShadow: '0 1px 6px rgba(239,68,68,0.45)',
        }}>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#fff', flexShrink: 0 }} />
          LIVE
        </span>
      )}

      {/* ── Footer — oculto cuando LIVE ── */}
      {!isLive && (
        <div style={{
          fontSize: 9.5, color: 'var(--sp-text-35)',
          borderTop: '1px solid var(--sp-border)',
          paddingTop: 7, textAlign: 'center',
          letterSpacing: '0.02em',
        }}>
          {isZombie
            ? 'Pendiente de confirmación'
            : isSelected
            ? 'Ver detalle ↑'
            : `${event.isTodayInPortalTz ? 'Hoy' : 'Mañana'} · Tocá para ver detalle`}
        </div>
      )}
    </div>
  );
}

// ── SkeletonCard ──────────────────────────────────────────────────────────────

function SkeletonCard({ isMobile }: { isMobile: boolean }) {
  const cardW = isMobile ? 'calc(80vw)' : `${CARD_W_DESKTOP}px`;
  return (
    <div style={{
      width: cardW, maxWidth: isMobile ? 290 : CARD_W_DESKTOP,
      flexShrink: 0, scrollSnapAlign: 'start',
      borderRadius: '1rem', border: '1px solid var(--sp-border)',
      background: 'var(--sp-surface)', padding: '12px 13px',
      display: 'flex', flexDirection: 'column', gap: 9,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ width: 72, height: 10, borderRadius: 4, background: 'var(--sp-border-8)' }} />
        <div style={{ width: 28, height: 10, borderRadius: 4, background: 'var(--sp-border-8)' }} />
      </div>
      <div style={{ height: 1, background: 'var(--sp-border)' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[0, 1].map((i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--sp-border-8)', flexShrink: 0 }} />
            <div style={{ height: 12, flex: 1, borderRadius: 4, background: 'var(--sp-border-8)' }} />
          </div>
        ))}
      </div>
      <div style={{ height: 9, borderRadius: 4, background: 'var(--sp-border-4)', marginTop: 2 }} />
    </div>
  );
}

// ── ArrowButton ───────────────────────────────────────────────────────────────

function ArrowButton({ direction, onClick }: { direction: 'left' | 'right'; onClick: () => void }) {
  const pos = direction === 'left' ? { left: -18 } : { right: -18 };
  return (
    <button
      onClick={onClick}
      aria-label={direction === 'left' ? 'Anterior' : 'Siguiente'}
      style={{
        position: 'absolute', top: '50%', transform: 'translateY(-50%)',
        ...pos, zIndex: 2,
        width: 36, height: 36, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--sp-surface-alpha)',
        border: '1px solid var(--sp-border-8)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        color: 'var(--sp-text-55)',
        fontSize: 18, cursor: 'pointer',
        boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
        transition: 'all 0.15s ease', lineHeight: 1,
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = 'var(--sp-primary-40)';
        el.style.color = 'var(--sp-primary)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = 'var(--sp-border-8)';
        el.style.color = 'var(--sp-text-55)';
      }}
    >
      {direction === 'left' ? '‹' : '›'}
    </button>
  );
}

// ── LiveCarousel (main) ───────────────────────────────────────────────────────

interface LiveCarouselProps {
  isMobile: boolean;
}

export function LiveCarousel({ isMobile }: LiveCarouselProps) {
  const [feed, setFeed]         = useState<EventosFeed | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingMatchDTO[]>([]);
  const [loading, setLoading]   = useState(true);
  const [hovered, setHovered]   = useState(false);
  const [focusEventId, setFocusEventId] = useState<string | null>(null);
  const scrollRef               = useRef<HTMLDivElement>(null);

  // Mapa id → UpcomingMatchDTO para recuperar competitionId/teamId al hacer click
  const upcomingMap = new Map(upcoming.map((m) => [`canonical:${m.id}`, m]));

  // Inyectar animaciones CSS una sola vez
  useEffect(() => { injectAnimations(); }, []);

  // Fetch con auto-refresh 60s — ambas fuentes en paralelo
  const fetchFeed = useCallback(() => {
    const p1 = fetch('/api/ui/eventos')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: EventosFeed) => setFeed(data))
      .catch(() => {});

    const p2 = fetch('/api/ui/upcoming')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { matches: UpcomingMatchDTO[] }) => setUpcoming(data.matches ?? []))
      .catch(() => {});

    Promise.allSettled([p1, p2]).then(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchFeed();
    const id = setInterval(fetchFeed, 60_000);
    return () => clearInterval(id);
  }, [fetchFeed]);

  // Scroll de flechas
  const scroll = useCallback((dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const delta = (CARD_W_DESKTOP + CARD_GAP) * 2;
    el.scrollBy({ left: dir === 'left' ? -delta : delta, behavior: 'smooth' });
  }, []);

  // Datos del partido seleccionado para el DetailPanel
  const focusedMatch = focusEventId ? upcomingMap.get(focusEventId) ?? null : null;
  // dateLocal: fallback para partidos de torneo que no tienen matchday (CLI, WC, CA)
  const focusedDateLocal = focusedMatch?.currentMatchday == null
    ? (focusedMatch?.startsAtPortalTz?.slice(0, 10) ?? null)
    : null;
  const { data: teamDetail } = useTeamDetail(
    focusedMatch?.competitionId ?? '',
    focusedMatch?.homeTeamId ?? null,
    focusedMatch?.currentMatchday ?? null,
    'America/Montevideo',
    focusedDateLocal,
  );

  function handleDetailClick(eventId: string) {
    setFocusEventId((prev) => (prev === eventId ? null : eventId));
  }

  // ── Enriquecimiento con openUrl de streamtp ──────────────────────────────
  // streamtp es consultado exclusivamente para adjuntar links de stream a tarjetas canónicas.
  // No genera tarjetas propias. El par de equipos normalizado es la clave de matching.
  const streamUrlMap = new Map<string, string>();
  for (const ev of feed?.events ?? []) {
    if (!ev.openUrl) continue;
    if (!ev.isTodayInPortalTz) continue;
    if (ev.normalizedLeague === 'EXCLUIDA') continue;
    if (ev.normalizedStatus === 'DESCONOCIDO') continue;
    const key = `${normStr(ev.homeTeam ?? '')}|${normStr(ev.awayTeam ?? '')}`;
    if (!streamUrlMap.has(key)) streamUrlMap.set(key, ev.openUrl); // primer match gana (preferencia español ya viene del parser)
  }

  // Canónico es la única fuente de tarjetas. Enriquecemos con openUrl cuando streamtp cubre el partido.
  const canonicalAll = upcoming.map((m) => upcomingToEvent(m, streamUrlMap));

  // Zombie guard: eliminar auto-finalizados (>240 min) y zombies (>180 min).
  const allEvents = canonicalAll.filter((e) => {
    const state = getLiveState(e);
    return state !== 'finished' && state !== 'zombie';
  });

  const sorted    = sortEvents(allEvents);
  const liveCount = sorted.filter((e) => e.normalizedStatus === 'EN_VIVO').length;
  const hasLive   = liveCount > 0;

  // Título dinámico
  const sectionTitle = hasLive ? `(${liveCount}) EN VIVO AHORA` : 'PRÓXIMOS PARTIDOS';

  if (!loading && sorted.length === 0) return null;

  return (
    <div style={{ marginBottom: isMobile ? 24 : 32 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        {hasLive && (
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: 'var(--sp-primary)',
            animation: 'sp-badge-blink 2s ease-in-out infinite',
            display: 'inline-block', flexShrink: 0,
          }} />
        )}
        <h2 style={{
          fontSize: isMobile ? 14 : 16,
          fontWeight: 800, margin: 0,
          color: hasLive ? 'var(--sp-text)' : 'var(--sp-text-55)',
          letterSpacing: hasLive ? '0.02em' : '-0.01em',
        }}>
          {sectionTitle}
        </h2>
        {hasLive && (
          <span style={{
            fontSize: 9, fontWeight: 700,
            color: 'var(--sp-primary)',
            background: 'var(--sp-primary-10)',
            border: '1px solid var(--sp-primary-22)',
            borderRadius: 20, padding: '2px 8px',
            letterSpacing: '0.06em',
          }}>
            LIVE
          </span>
        )}
      </div>

      {/* ── Contenedor de flechas + scroll ── */}
      <div
        style={{ position: 'relative' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {!isMobile && hovered && (
          <ArrowButton direction="left" onClick={() => scroll('left')} />
        )}

        <div
          ref={scrollRef}
          className="hide-scrollbar"
          style={{
            display: 'flex', gap: CARD_GAP,
            overflowX: 'auto',
            scrollSnapType: 'x mandatory',
            scrollBehavior: 'smooth',
            paddingTop: 4,
            paddingBottom: 6,
          }}
        >
          {/* Spacer: garantiza que el borde izquierdo de la primera tarjeta
              no sea recortado por el overflow del contenedor. paddingLeft no
              es confiable en flex+overflow-x:auto en todos los browsers. */}
          <div style={{ width: 4, flexShrink: 0 }} />
          {loading
            ? [1, 2, 3, 4, 5].map((i) => <SkeletonCard key={i} isMobile={isMobile} />)
            : sorted.map((ev) => (
                <LiveMatchCard
                  key={ev.id}
                  event={ev}
                  isMobile={isMobile}
                  isSelected={focusEventId === ev.id}
                  onDetailClick={handleDetailClick}
                />
              ))}
          {/* Spacer derecho — mantiene el fade de la última tarjeta */}
          <div style={{ width: isMobile ? 40 : 4, flexShrink: 0 }} />
        </div>

        {!isMobile && hovered && (
          <ArrowButton direction="right" onClick={() => scroll('right')} />
        )}
      </div>

      {/* ── DetailPanel inline ── */}
      {focusEventId && teamDetail && (
        <div style={{ marginTop: 16 }}>
          <DetailPanel
            detail={teamDetail}
            onClose={() => setFocusEventId(null)}
          />
        </div>
      )}
    </div>
  );
}
