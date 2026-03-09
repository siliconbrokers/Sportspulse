/**
 * MatchCardList v2 — vista Partidos de la Jornada, Mobile-First
 * Design System Premium: bento cards compactas, date pills, live neon
 */
import { useState, useMemo } from 'react';
import type { MatchCardDTO } from '../types/snapshot.js';
import { computeLiveTimeChip } from '../utils/time-chip.js';
import './match-map.css';

// ─── Utilidades de fecha ──────────────────────────────────────────────────────

function toDateKey(utcStr: string): string {
  return new Date(utcStr).toLocaleDateString('en-CA', { timeZone: 'America/Montevideo' });
}

function formatDatePill(dateKey: string): string {
  const now = new Date();
  const today = now.toLocaleDateString('en-CA', { timeZone: 'America/Montevideo' });
  const yesterday = new Date(now.getTime() - 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Montevideo' });
  const tomorrow = new Date(now.getTime() + 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Montevideo' });
  if (dateKey === today) return 'Hoy';
  if (dateKey === tomorrow) return 'Mañana';
  if (dateKey === yesterday) return 'Ayer';
  // e.g. "sáb. 14 mar."
  const d = new Date(dateKey + 'T12:00:00');
  return d.toLocaleDateString('es-UY', { weekday: 'short', day: 'numeric', month: 'short' });
}

function isEffLive(card: MatchCardDTO): boolean {
  if (card.status === 'LIVE') return true;
  if (card.status !== 'SCHEDULED' || !card.kickoffUtc) return false;
  const mins = (Date.now() - new Date(card.kickoffUtc).getTime()) / 60000;
  return mins >= 0 && mins <= 110;
}

// ─── Chip de forma ────────────────────────────────────────────────────────────

function chipColors(level: string): [string, string] {
  const map: Record<string, [string, string]> = {
    HOT:     ['rgba(239,68,68,0.2)',   '#f87171'],
    OK:      ['rgba(34,197,94,0.18)',  '#4ade80'],
    WARN:    ['rgba(249,115,22,0.18)', '#fb923c'],
    INFO:    ['rgba(255,255,255,0.07)','var(--sp-text-55)'],
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

function Crest({ src, alt, size = 32 }: { src?: string; alt: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.07)',
          flexShrink: 0,
        }}
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

// ─── Tarjeta compacta de partido ──────────────────────────────────────────────
// Layout: cada equipo en su propia fila → nombre tiene espacio completo en mobile

interface CardProps {
  card: MatchCardDTO;
  onSelectTeam?: (teamId: string) => void;
  focusedTeamId?: string | null;
  showForm: boolean;
}

function TeamRow({
  card,
  side,
  showScore,
  showDash,
  live,
  showForm,
  isFocus,
  isDimmed,
  onSelect,
}: {
  card: MatchCardDTO;
  side: 'home' | 'away';
  showScore: boolean;
  showDash: boolean;
  live: boolean;
  showForm: boolean;
  isFocus: boolean;
  isDimmed: boolean;
  onSelect?: () => void;
}) {
  const team = side === 'home' ? card.home : card.away;
  const score = side === 'home' ? card.scoreHome : card.scoreAway;
  const displayName = team.shortName && team.shortName.length < team.name.length - 5
    ? team.shortName : team.name;

  return (
    <div
      onClick={onSelect}
      className="flex items-center gap-2 w-full"
      style={{
        opacity: isDimmed ? 0.4 : 1,
        transition: 'opacity 0.15s',
        cursor: onSelect ? 'pointer' : 'default',
        minWidth: 0,
      }}
    >
      <Crest src={team.crestUrl} alt={team.name} size={28} />
      <span
        className="flex-1 text-sm font-semibold truncate"
        style={{ color: isFocus ? 'var(--sp-primary)' : 'var(--sp-text-88)', minWidth: 0 }}
      >
        {displayName}
      </span>
      {showForm && card.status !== 'FINISHED' && team.formChip && (
        <FormChip icon={team.formChip.icon} label={team.formChip.label} level={team.formChip.level} />
      )}
      {/* Score por equipo */}
      <div className="flex-shrink-0 text-right" style={{ minWidth: 24 }}>
        {showScore ? (
          <span
            style={{
              fontSize: 18,
              fontWeight: 800,
              color: live ? 'var(--sp-primary)' : 'var(--sp-text-88)',
              textShadow: live ? '0 0 10px var(--sp-primary-40)' : 'none',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {score ?? '-'}
          </span>
        ) : showDash ? (
          <span style={{ fontSize: 16, fontWeight: 800, color: 'rgba(251,146,60,0.75)' }}>-</span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--sp-text-20)' }}>—</span>
        )}
      </div>
    </div>
  );
}

function MatchCard({ card, onSelectTeam, focusedTeamId, showForm }: CardProps) {
  const [hovered, setHovered] = useState(false);
  const live = isEffLive(card);
  const tc = computeLiveTimeChip(card.status, card.kickoffUtc);
  const isLiveIcon = tc.icon === '🔴';

  const homeIsFocus = focusedTeamId === card.home.teamId;
  const awayIsFocus = focusedTeamId === card.away.teamId;
  const hasFocus = homeIsFocus || awayIsFocus;

  const showScore = (card.status === 'FINISHED' || live) && card.scoreHome != null && card.scoreAway != null;
  const showDash  = live && (card.scoreHome == null || card.scoreAway == null);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderRadius: '1rem',
        border: live
          ? '1.5px solid var(--sp-primary-40)'
          : hovered
            ? '1px solid var(--sp-border-8)'
            : '1px solid var(--sp-border-5)',
        background: live
          ? 'var(--sp-primary-04)'
          : hovered
            ? 'var(--sp-surface)'
            : 'var(--sp-surface-alpha)',
        boxShadow: live ? '0 0 20px var(--sp-primary-10)' : 'none',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        transition: 'border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      {/* Badge de estado */}
      <div className="flex items-center gap-2">
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.06em',
            padding: '2px 8px',
            borderRadius: 20,
            background: live
              ? 'var(--sp-primary-10)'
              : 'rgba(255,255,255,0.05)',
            color: live ? 'var(--sp-primary)' : 'var(--sp-text-35)',
            border: live ? '1px solid var(--sp-primary-22)' : '1px solid transparent',
          }}
        >
          {isLiveIcon
            ? <span className="live-icon-pulse" style={{ fontSize: 8 }}>●</span>
            : tc.icon}{' '}
          {tc.label}
        </span>
      </div>

      {/* Divisor */}
      <div style={{ height: 1, background: 'var(--sp-border-4)' }} />

      {/* Fila Local */}
      <TeamRow
        card={card} side="home"
        showScore={showScore} showDash={showDash} live={live} showForm={showForm}
        isFocus={homeIsFocus} isDimmed={hasFocus && !homeIsFocus}
        onSelect={onSelectTeam ? () => onSelectTeam(card.home.teamId) : undefined}
      />

      {/* Separador visual entre equipos */}
      <div style={{ height: 1, background: 'var(--sp-border-4)' }} />

      {/* Fila Visitante */}
      <TeamRow
        card={card} side="away"
        showScore={showScore} showDash={showDash} live={live} showForm={showForm}
        isFocus={awayIsFocus} isDimmed={hasFocus && !awayIsFocus}
        onSelect={onSelectTeam ? () => onSelectTeam(card.away.teamId) : undefined}
      />
    </div>
  );
}

// ─── Date pill selector ───────────────────────────────────────────────────────

function DatePills({
  dates,
  selected,
  onChange,
}: {
  dates: string[];
  selected: string | 'all';
  onChange: (d: string | 'all') => void;
}) {
  if (dates.length < 2) return null;

  return (
    <div
      className="flex gap-2 overflow-x-auto pb-1"
      style={{ scrollbarWidth: 'none' }}
    >
      {dates.map((d) => {
        const active = selected === d;
        return (
          <button
            key={d}
            onClick={() => onChange(d)}
            className="flex-shrink-0 text-xs font-semibold px-4 rounded-xl transition-all"
            style={{
              minHeight: 36,
              border: active
                ? '1px solid var(--sp-primary-40)'
                : '1px solid var(--sp-border-8)',
              background: active
                ? 'var(--sp-primary-12)'
                : 'var(--sp-surface-alpha)',
              color: active ? 'var(--sp-primary)' : 'var(--sp-text-55)',
              letterSpacing: active ? '0.01em' : undefined,
              textShadow: active ? '0 0 10px var(--sp-primary-40)' : 'none',
            }}
          >
            {formatDatePill(d)}
          </button>
        );
      })}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

interface MatchCardListProps {
  matchCards: MatchCardDTO[];
  onSelectTeam?: (teamId: string) => void;
  focusedTeamId?: string | null;
  showForm?: boolean;
}

export function MatchCardList({ matchCards, onSelectTeam, focusedTeamId, showForm = false }: MatchCardListProps) {
  // Extraer fechas únicas de las tarjetas con kickoffUtc
  const dates = useMemo(() => {
    const keys = new Set<string>();
    for (const c of matchCards) {
      if (c.kickoffUtc) keys.add(toDateKey(c.kickoffUtc));
    }
    return Array.from(keys).sort();
  }, [matchCards]);

  // Seleccionar fecha inicial: hoy si existe, si no la primera
  const defaultDate = useMemo(() => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Montevideo' });
    return dates.includes(today) ? today : (dates[0] ?? 'all');
  }, [dates]);

  const [selectedDate, setSelectedDate] = useState<string | 'all'>(defaultDate);

  // Filtrar tarjetas por fecha seleccionada
  const visible = useMemo(() => {
    if (selectedDate === 'all' || dates.length < 2) return matchCards;
    return matchCards.filter(
      (c) => c.kickoffUtc ? toDateKey(c.kickoffUtc) === selectedDate : false
    );
  }, [matchCards, selectedDate, dates]);

  if (matchCards.length === 0) {
    return (
      <div
        className="text-center py-12 text-sm"
        style={{ color: 'var(--sp-text-35)' }}
      >
        No hay partidos para esta jornada
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-4 px-4 py-4 max-w-3xl mx-auto overflow-x-hidden" style={{ boxSizing: 'border-box' }}>
      {/* Date pills — solo si hay múltiples fechas */}
      {dates.length > 1 && (
        <DatePills
          dates={dates}
          selected={selectedDate}
          onChange={setSelectedDate}
        />
      )}

      {visible.length === 0 ? (
        <div
          className="text-center py-8 text-sm rounded-2xl"
          style={{ color: 'var(--sp-text-35)', background: 'var(--sp-surface-alpha)', border: '1px solid var(--sp-border-5)' }}
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
    </div>
  );
}
