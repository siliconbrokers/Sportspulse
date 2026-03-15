/**
 * MatchCardList v6 — Skeleton loader + diseño Premium Mobile-First
 * Design System: bento cards, date pills, live neon / zombie amber, animate-pulse skeleton
 * v5: eliminado LeagueHeader redundante
 * v6: getMatchDisplayStatus centralizado — zombie guard alineado con DetailPanel y LiveCarousel
 */
import { useState, useMemo, useEffect, useRef } from 'react';
import type { MatchCardDTO } from '../types/snapshot.js';
import { computeLiveTimeChip } from '../utils/time-chip.js';
import { getMatchDisplayStatus, type DisplayMatchStatus } from '../utils/match-status.js';
import { useWindowWidth } from '../hooks/use-window-width.js';
import { resolveTeamName } from '../utils/resolve-team-name.js';
import './match-map.css';

// ─── Utilidades de fecha ──────────────────────────────────────────────────────

const PORTAL_TZ = 'America/Montevideo';

function toDateKey(utcStr: string): string {
  return new Date(utcStr).toLocaleDateString('en-CA', { timeZone: PORTAL_TZ });
}

/**
 * Derives "today" from the server's perspective (via computedAtUtc from the snapshot header).
 * Falls back to client's local time if not available.
 * This prevents midnight timezone drift when the user's browser TZ differs from the portal TZ.
 */
function deriveServerToday(serverComputedAtUtc?: string): string {
  const ref = serverComputedAtUtc ? new Date(serverComputedAtUtc) : new Date();
  return ref.toLocaleDateString('en-CA', { timeZone: PORTAL_TZ });
}

function formatDatePill(dateKey: string, serverComputedAtUtc?: string): string {
  const today = deriveServerToday(serverComputedAtUtc);
  const refMs = serverComputedAtUtc ? new Date(serverComputedAtUtc).getTime() : Date.now();
  const yesterday = new Date(refMs - 86400000).toLocaleDateString('en-CA', { timeZone: PORTAL_TZ });
  const tomorrow  = new Date(refMs + 86400000).toLocaleDateString('en-CA', { timeZone: PORTAL_TZ });
  if (dateKey === today) return 'Hoy';
  if (dateKey === tomorrow) return 'Mañana';
  if (dateKey === yesterday) return 'Ayer';
  const d = new Date(dateKey + 'T12:00:00');
  return d.toLocaleDateString('es-UY', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Retorna el estado de visualización de una tarjeta.
 * Delega en getMatchDisplayStatus() (fuente única de verdad, match-status.ts).
 * La heurística temporal (kickoff pasado → LIVE) está centralizada allí.
 */
function getCardState(card: MatchCardDTO): DisplayMatchStatus {
  return getMatchDisplayStatus(card.status ?? 'UNKNOWN', card.kickoffUtc);
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div
      className="animate-pulse rounded-xl flex flex-col gap-2 p-3"
      style={{
        background: 'var(--sp-surface)',
        border: '1px solid var(--sp-border-5)',
      }}
    >
      {/* Badge skeleton */}
      <div className="h-5 w-16 rounded-full" style={{ background: 'var(--sp-border-8)' }} />

      {/* Divider */}
      <div className="h-px" style={{ background: 'var(--sp-border-8)' }} />

      {/* Fila equipo local */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full flex-shrink-0" style={{ background: 'var(--sp-border-8)' }} />
        <div className="flex-1 h-4 rounded" style={{ maxWidth: '55%', background: 'var(--sp-border-8)' }} />
        <div className="w-5 h-5 rounded flex-shrink-0" style={{ background: 'var(--sp-border-8)' }} />
      </div>

      {/* Divider */}
      <div className="h-px" style={{ background: 'var(--sp-border-8)' }} />

      {/* Fila equipo visitante */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full flex-shrink-0" style={{ background: 'var(--sp-border-8)' }} />
        <div className="flex-1 h-4 rounded" style={{ maxWidth: '45%', background: 'var(--sp-border-8)' }} />
        <div className="w-5 h-5 rounded flex-shrink-0" style={{ background: 'var(--sp-border-8)' }} />
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

// ─── Form chip ────────────────────────────────────────────────────────────────

function chipColors(level: string): [string, string] {
  const map: Record<string, [string, string]> = {
    HOT:     ['rgba(239,68,68,0.2)',   '#f87171'],
    OK:      ['rgba(34,197,94,0.18)',  '#4ade80'],
    WARN:    ['rgba(249,115,22,0.18)', '#fb923c'],
    INFO:    ['var(--sp-border-8)','var(--sp-text-55)'],
    UNKNOWN: ['rgba(255,255,255,0.05)','var(--sp-text-35)'],
    ERROR:   ['rgba(239,68,68,0.12)',  '#f87171'],
  };
  return map[level] ?? map.INFO;
}

function FormChip({ icon, label, level }: { icon: string; label: string; level: string }) {
  const [bg, color] = chipColors(level);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontSize: 10,
        fontWeight: 600,
        padding: '2px 6px',
        borderRadius: 5,
        background: bg,
        color,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {icon} {label}
    </span>
  );
}

// ─── Escudo con fallback ──────────────────────────────────────────────────────

function Crest({ src, alt, size = 28 }: { src?: string; alt: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div
        className="rounded-full flex-shrink-0"
        style={{ width: size, height: size, background: 'var(--sp-border-8)' }}
      />
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{ objectFit: 'contain', flexShrink: 0 }}
    />
  );
}

// ─── Fila de equipo ───────────────────────────────────────────────────────────

function TeamRow({
  card,
  side,
  showScore,
  showDash,
  showScorePlaceholder,
  cardState,
  showForm,
  isFocus,
  isDimmed,
}: {
  card: MatchCardDTO;
  side: 'home' | 'away';
  showScore: boolean;
  showDash: boolean;
  showScorePlaceholder: boolean;
  cardState: DisplayMatchStatus;
  showForm: boolean;
  isFocus: boolean;
  isDimmed: boolean;
}) {
  const team = side === 'home' ? card.home : card.away;
  const score = side === 'home' ? card.scoreHome : card.scoreAway;
  const penScore = side === 'home' ? card.scoreHomePenalties : card.scoreAwayPenalties;
  const hasPenalties = card.scoreHomePenalties != null && card.scoreAwayPenalties != null;
  const { breakpoint } = useWindowWidth();
  const displayName = resolveTeamName(team.name, {
    tla: team.tla,
    compact: breakpoint === 'mobile',
  });

  const isLive   = cardState === 'LIVE';
  const isZombie = cardState === 'ZOMBIE';

  // Color del score según estado
  const scoreColor  = isLive ? '#f97316' : isZombie ? '#f59e0b' : 'var(--sp-text-88)';
  const scoreShadow = isLive ? '0 0 10px rgba(249,115,22,0.5)' : 'none';

  return (
    <div
      className="flex items-center gap-2 w-full min-w-0"
      style={{
        opacity: isDimmed ? 0.4 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      <Crest src={team.crestUrl} alt={team.name} size={28} />
      <span
        className="flex-1 text-sm font-semibold truncate min-w-0"
        style={{ color: isFocus ? 'var(--sp-primary)' : 'var(--sp-text-88)' }}
      >
        {displayName}
      </span>
      {showForm && card.status !== 'FINISHED' && team.formChip && (
        <FormChip icon={team.formChip.icon} label={team.formChip.label} level={team.formChip.level} />
      )}
      <div className="flex-shrink-0 flex flex-col items-end" style={{ minWidth: 32 }}>
        {showScore ? (
          <>
            <span
              style={{
                fontSize: 18, fontWeight: 800,
                color: scoreColor,
                textShadow: scoreShadow,
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1,
              }}
            >
              {score ?? '-'}
            </span>
            {hasPenalties && (
              <span style={{
                fontSize: 10, fontWeight: 700,
                color: 'var(--sp-text-55)',
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1,
                marginTop: 2,
              }}>
                ({penScore})
              </span>
            )}
          </>
        ) : showDash ? (
          <span style={{ fontSize: 16, fontWeight: 800, color: 'rgba(251,146,60,0.75)' }}>-</span>
        ) : showScorePlaceholder ? (
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--sp-text-35)', fontVariantNumeric: 'tabular-nums' }}>—</span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--sp-text-20)' }}>—</span>
        )}
      </div>
    </div>
  );
}

// ─── Tarjeta de partido ───────────────────────────────────────────────────────

interface CardProps {
  card: MatchCardDTO;
  onSelectTeam?: (teamId: string) => void;
  focusedTeamId?: string | null;
  showForm: boolean;
}

function MatchCard({ card, onSelectTeam, focusedTeamId, showForm }: CardProps) {
  const [hovered, setHovered] = useState(false);
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';

  // Estado unificado — misma función que LiveCarousel y DetailPanel
  const cardState = getCardState(card);
  const isLive    = cardState === 'LIVE';
  const isZombie  = cardState === 'ZOMBIE';
  const isActive  = isLive || isZombie;

  // time-chip usa la misma lógica (umbrales de match-status.ts)
  const tc = computeLiveTimeChip(card.status, card.kickoffUtc);
  const isLiveIcon = tc.icon === '🔴';

  const homeIsFocus = focusedTeamId === card.home.teamId;
  const awayIsFocus = focusedTeamId === card.away.teamId;
  const hasFocus    = homeIsFocus || awayIsFocus;

  const hasScore = card.scoreHome != null && card.scoreAway != null;
  const showScore = (cardState === 'FINISHED' || isActive) && hasScore;
  const showDash = isActive && !hasScore;
  // Match is definitively over but score is unavailable (provider lag / zombie guard)
  const showScorePlaceholder = cardState === 'FINISHED' && !hasScore;
  const hasPenalties = card.scoreHomePenalties != null && card.scoreAwayPenalties != null;

  // Estilos de borde/fondo según estado
  const cardBorder = isLive
    ? '1.5px solid var(--sp-primary-40)'
    : isZombie
    ? '1.5px solid rgba(245,158,11,0.40)'
    : hovered
    ? '1px solid var(--sp-border-8)'
    : '1px solid var(--sp-border-5)';

  const cardBg = isLive
    ? 'var(--sp-primary-04)'
    : isZombie
    ? 'rgba(245,158,11,0.04)'
    : hovered
    ? 'var(--sp-surface)'
    : 'var(--sp-surface-alpha)';

  const cardShadow = isLive
    ? '0 0 20px var(--sp-primary-10)'
    : isZombie
    ? '0 0 14px rgba(245,158,11,0.08)'
    : 'none';

  // Badge de estado — live usa rojo sólido como LiveCarousel
  const badgeBg = isLive
    ? '#ef4444'
    : isZombie
    ? 'rgba(245,158,11,0.10)'
    : 'rgba(255,255,255,0.05)';

  const badgeColor = isLive
    ? '#fff'
    : isZombie
    ? '#f59e0b'
    : 'var(--sp-text-35)';

  const badgeBorder = isLive
    ? 'none'
    : isZombie
    ? '1px solid rgba(245,158,11,0.30)'
    : '1px solid transparent';

  function handleCardClick() {
    if (!onSelectTeam) return;
    // Si alguno de los dos equipos ya está en foco → deseleccionar; si no → seleccionar local
    if (hasFocus) {
      onSelectTeam(focusedTeamId!);
    } else {
      onSelectTeam(card.home.teamId);
    }
  }

  // ── Variante compacta mobile (2 filas, ~74px) ─────────────────────────────
  if (isMobile) {
    const scoreColor = isLive ? '#f97316' : isZombie ? '#f59e0b' : 'var(--sp-text-88)';
    const kickoffTime = card.kickoffUtc
      ? new Intl.DateTimeFormat('es-UY', {
          timeZone: PORTAL_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
        }).format(new Date(card.kickoffUtc))
      : '—';

    return (
      <div
        role={onSelectTeam ? 'button' : undefined}
        tabIndex={onSelectTeam ? 0 : undefined}
        onClick={onSelectTeam ? handleCardClick : undefined}
        onKeyDown={onSelectTeam ? (e) => e.key === 'Enter' && handleCardClick() : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          padding: '10px 12px',
          border: cardBorder,
          background: cardBg,
          boxShadow: cardShadow,
          borderRadius: 12,
          cursor: onSelectTeam ? 'pointer' : 'default',
          display: 'flex', flexDirection: 'column', gap: 5,
          transition: 'border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease',
          outline: 'none',
        }}
      >
        {/* Fila 1: [nombre+crest flex:1] [score 52px] [crest+nombre flex:1] */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {/* Columna izquierda: nombre derecha + crest */}
          <div style={{ flex: '1 1 0', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, minWidth: 0, overflow: 'hidden' }}>
            <span style={{
              fontSize: 12, fontWeight: 700,
              color: homeIsFocus ? 'var(--sp-primary)' : 'var(--sp-text-88)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
              opacity: hasFocus && !homeIsFocus ? 0.4 : 1,
              transition: 'opacity 0.15s',
            }}>
              {resolveTeamName(card.home.name, { tla: card.home.tla, compact: true })}
            </span>
            <Crest src={card.home.crestUrl} alt={card.home.name} size={22} />
          </div>
          {/* Columna central: score/vs — siempre en el mismo lugar */}
          <div style={{ width: 52, flexShrink: 0, textAlign: 'center' }}>
            {showScore ? (
              <span style={{ fontSize: 13, fontWeight: 900, color: scoreColor, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>
                {card.scoreHome ?? '-'}–{card.scoreAway ?? '-'}
              </span>
            ) : showDash ? (
              <span style={{ fontSize: 12, fontWeight: 800, color: 'rgba(251,146,60,0.75)' }}>-–-</span>
            ) : (
              <span style={{ fontSize: 11, color: 'var(--sp-text-25)', fontWeight: 300 }}>vs</span>
            )}
          </div>
          {/* Columna derecha: crest + nombre */}
          <div style={{ flex: '1 1 0', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 6, minWidth: 0, overflow: 'hidden' }}>
            <Crest src={card.away.crestUrl} alt={card.away.name} size={22} />
            <span style={{
              fontSize: 12, fontWeight: 700,
              color: awayIsFocus ? 'var(--sp-primary)' : 'var(--sp-text-88)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1,
              opacity: hasFocus && !awayIsFocus ? 0.4 : 1,
              transition: 'opacity 0.15s',
            }}>
              {resolveTeamName(card.away.name, { tla: card.away.tla, compact: true })}
            </span>
          </div>
        </div>

        {/* Fila 2: badge estado | flex-1 | hora [+ penaltis] */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 8, fontWeight: 700, letterSpacing: '0.06em',
            padding: '1px 6px', borderRadius: 20,
            background: badgeBg, color: badgeColor, border: badgeBorder,
            flexShrink: 0,
          }}>
            {isLiveIcon && !isZombie ? (
              <span className="live-icon-pulse" style={{ fontSize: 7 }}>●</span>
            ) : tc.icon}
            {' '}{tc.label}
          </span>
          <span style={{ flex: 1 }} />
          {hasPenalties && (
            <span style={{ fontSize: 9, color: 'var(--sp-text-40)', flexShrink: 0 }}>
              pen {card.scoreHomePenalties}–{card.scoreAwayPenalties}
            </span>
          )}
          {cardState !== 'FINISHED' && (
            <span style={{ fontSize: 10, color: 'var(--sp-text-35)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
              {kickoffTime}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      role={onSelectTeam ? 'button' : undefined}
      tabIndex={onSelectTeam ? 0 : undefined}
      onClick={onSelectTeam ? handleCardClick : undefined}
      onKeyDown={onSelectTeam ? (e) => e.key === 'Enter' && handleCardClick() : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex flex-col gap-2 rounded-xl"
      style={{
        padding: '12px 14px',
        border: cardBorder,
        background: cardBg,
        boxShadow: cardShadow,
        cursor: onSelectTeam ? 'pointer' : 'default',
        transition: 'border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease',
        outline: 'none',
      }}
    >
      {/* Badge de estado */}
      <div>
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
            padding: '2px 8px', borderRadius: 20,
            background: badgeBg, color: badgeColor, border: badgeBorder,
          }}
        >
          {isLiveIcon && !isZombie ? (
            <span className="live-icon-pulse" style={{ fontSize: 8 }}>●</span>
          ) : (
            tc.icon
          )}{' '}
          {tc.label}
        </span>
      </div>

      <div className="h-px" style={{ background: isZombie ? 'rgba(245,158,11,0.15)' : 'var(--sp-border-4)' }} />

      <TeamRow
        card={card} side="home"
        showScore={showScore} showDash={showDash} showScorePlaceholder={showScorePlaceholder}
        cardState={cardState} showForm={showForm}
        isFocus={homeIsFocus} isDimmed={hasFocus && !homeIsFocus}
      />

      <div className="h-px" style={{ background: isZombie ? 'rgba(245,158,11,0.15)' : 'var(--sp-border-4)' }} />

      <TeamRow
        card={card} side="away"
        showScore={showScore} showDash={showDash} showScorePlaceholder={showScorePlaceholder}
        cardState={cardState} showForm={showForm}
        isFocus={awayIsFocus} isDimmed={hasFocus && !awayIsFocus}
      />
    </div>
  );
}

// ─── Date pills ───────────────────────────────────────────────────────────────

function DatePills({
  dates,
  selected,
  isFallback,
  onChange,
  serverComputedAtUtc,
}: {
  dates: string[];
  selected: string | 'all';
  isFallback: boolean;
  onChange: (d: string | 'all') => void;
  serverComputedAtUtc?: string;
}) {
  if (dates.length < 2) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
        {dates.map((d) => {
          const active = selected === d;
          return (
            <button
              key={d}
              onClick={() => onChange(d)}
              className="flex-shrink-0 text-xs font-semibold px-4 rounded-xl transition-all"
              style={{
                minHeight: 36,
                border: active ? '1px solid var(--sp-primary-40)' : '1px solid var(--sp-border-8)',
                background: active ? 'var(--sp-primary-12)' : 'var(--sp-surface-alpha)',
                color: active ? 'var(--sp-primary)' : 'var(--sp-text-55)',
                textShadow: active ? '0 0 10px var(--sp-primary-40)' : 'none',
              }}
            >
              {formatDatePill(d, serverComputedAtUtc)}
            </button>
          );
        })}
      </div>
      {/* Badge de fallback — solo cuando no hay partidos hoy */}
      {isFallback && (
        <div className="flex items-center gap-1.5">
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            style={{
              background: 'rgba(251,191,36,0.08)',
              border: '1px solid rgba(251,191,36,0.2)',
              color: 'rgba(251,191,36,0.7)',
              letterSpacing: '0.02em',
            }}
          >
            Mostrando últimos resultados de la jornada
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

interface MatchCardListProps {
  matchCards: MatchCardDTO[];
  onSelectTeam?: (teamId: string) => void;
  focusedTeamId?: string | null;
  showForm?: boolean;
  loading?: boolean;
  competitionId?: string;
  matchday?: number | null;
  /** ISO UTC string from snapshot header — used to derive "today" from the server's perspective. */
  serverComputedAtUtc?: string;
}

export function MatchCardList({
  matchCards,
  onSelectTeam,
  focusedTeamId,
  showForm = false,
  loading = false,
  serverComputedAtUtc,
}: MatchCardListProps) {
  const dates = useMemo(() => {
    const keys = new Set<string>();
    for (const c of matchCards) {
      if (c.kickoffUtc) keys.add(toDateKey(c.kickoffUtc));
    }
    return Array.from(keys).sort();
  }, [matchCards]);

  // ── Algoritmo de selección inteligente de fecha ──────────────────────────
  const { bestDate, isFallback } = useMemo(() => {
    if (dates.length === 0) return { bestDate: 'all' as const, isFallback: false };
    if (dates.length === 1) return { bestDate: dates[0], isFallback: false };

    // Use the server's perspective of "today" to avoid timezone drift at midnight
    const today = deriveServerToday(serverComputedAtUtc);

    // 1. Hoy tiene partidos → mostrar hoy, SALVO que todos sean SCHEDULED sin resultados
    if (dates.includes(today)) {
      const todayCards = matchCards.filter(
        (c) => c.kickoffUtc && toDateKey(c.kickoffUtc) === today,
      );
      const allTodayScheduled = todayCards.every((c) => c.status === 'SCHEDULED');
      if (!allTodayScheduled) return { bestDate: today, isFallback: false };
      // Todos son SCHEDULED: buscar fecha pasada con resultados (FINISHED/LIVE)
      const pastDatesWithResults = dates
        .filter((d) => d < today)
        .filter((d) =>
          matchCards.some(
            (c) => c.kickoffUtc && toDateKey(c.kickoffUtc) === d && c.status !== 'SCHEDULED',
          ),
        )
        .sort();
      if (pastDatesWithResults.length > 0) {
        return { bestDate: pastDatesWithResults[pastDatesWithResults.length - 1], isFallback: true };
      }
      // No hay fechas pasadas con resultados: mostrar hoy de todas formas
      return { bestDate: today, isFallback: false };
    }

    // 2. Buscar hacia atrás: el día más reciente con partidos antes de hoy
    const pastDates = dates.filter((d) => d < today).sort();
    if (pastDates.length > 0) {
      return { bestDate: pastDates[pastDates.length - 1], isFallback: true };
    }

    // 3. No hay días pasados: primer día futuro con partidos
    const futureDates = dates.filter((d) => d > today).sort();
    if (futureDates.length > 0) return { bestDate: futureDates[0], isFallback: false };

    return { bestDate: dates[0], isFallback: false };
  }, [dates]);

  const [selectedDate, setSelectedDate] = useState<string | 'all'>(bestDate);

  // Sincronizar selectedDate cuando cambia la jornada o la liga (nuevos datos)
  // Usamos ref para no resetear cuando el usuario selecciona manualmente una fecha
  const prevMatchCardsRef = useRef(matchCards);
  useEffect(() => {
    if (prevMatchCardsRef.current !== matchCards) {
      prevMatchCardsRef.current = matchCards;
      setSelectedDate(bestDate);
    }
  }, [matchCards, bestDate]);

  const visible = useMemo(() => {
    const filtered = selectedDate === 'all' || dates.length < 2
      ? matchCards
      : matchCards.filter((c) => (c.kickoffUtc ? toDateKey(c.kickoffUtc) === selectedDate : false));
    return [...filtered].sort((a, b) => (a.kickoffUtc ?? '').localeCompare(b.kickoffUtc ?? ''));
  }, [matchCards, selectedDate, dates]);

  return (
    <div className="w-full overflow-x-hidden" style={{ boxSizing: 'border-box' }}>
      <div
        className="w-full flex flex-col gap-4 px-4 pb-4 mx-auto overflow-x-hidden"
        style={{ maxWidth: 880, boxSizing: 'border-box', paddingTop: 12 }}
      >
      {/* Skeleton mientras carga */}
      {loading && <SkeletonGrid />}

      {/* Contenido real */}
      {!loading && matchCards.length === 0 && (
        <div
          className="text-center py-12 text-sm rounded-2xl"
          style={{
            color: 'var(--sp-text-35)',
            background: 'var(--sp-surface-alpha)',
            border: '1px solid var(--sp-border-5)',
          }}
        >
          No hay partidos para esta jornada
        </div>
      )}

      {!loading && matchCards.length > 0 && (
        <>
          <DatePills dates={dates} selected={selectedDate} isFallback={isFallback} onChange={setSelectedDate} serverComputedAtUtc={serverComputedAtUtc} />

          {visible.length === 0 ? (
            <div
              className="text-center py-8 text-sm rounded-2xl"
              style={{
                color: 'var(--sp-text-35)',
                background: 'var(--sp-surface-alpha)',
                border: '1px solid var(--sp-border-5)',
              }}
            >
              Sin partidos este día
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {visible.map((card) => (
                <MatchCard
                  key={card.matchId}
                  card={card}
                  onSelectTeam={onSelectTeam}
                  focusedTeamId={focusedTeamId}
                  showForm={showForm}
                />
              ))}
            </div>
          )}
        </>
      )}
      </div>
    </div>
  );
}
