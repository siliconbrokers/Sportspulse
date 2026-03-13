/**
 * TournamentPartidosView — Vista de partidos para torneos con filtros.
 * Modo "Por ronda": selector de ronda → partidos de esa ronda.
 * Modo "Por grupo": selector de grupo → partidos de ese grupo.
 * Mobile-first, responsive.
 */

import { useState } from 'react';
import { useWindowWidth } from '../hooks/use-window-width.js';
import { useTournamentMatches, type TournamentMatchItem } from '../hooks/use-tournament-matches.js';
import { useTeamDetail } from '../hooks/use-team-detail.js';
import { DetailPanel } from './DetailPanel.js';
import type { MatchCardDTO } from '../types/snapshot.js';

// ── TournamentMatchItem → MatchCardDTO adapter ────────────────────────────────

function matchItemToCard(m: TournamentMatchItem): MatchCardDTO {
  let status: MatchCardDTO['status'] = 'UNKNOWN';
  if (m.scoreHome !== null && m.scoreAway !== null) {
    status = 'FINISHED';
  } else if (m.kickoffUtc && new Date(m.kickoffUtc).getTime() > Date.now()) {
    status = 'SCHEDULED';
  }

  return {
    matchId: m.matchId,
    kickoffUtc: m.kickoffUtc ?? undefined,
    status,
    scoreHome: m.scoreHome,
    scoreAway: m.scoreAway,
    scoreHomePenalties: m.scoreHomePenalties ?? null,
    scoreAwayPenalties: m.scoreAwayPenalties ?? null,
    home: { teamId: m.homeTeam.teamId, name: m.homeTeam.name, crestUrl: m.homeTeam.crestUrl },
    away: { teamId: m.awayTeam.teamId, name: m.awayTeam.name, crestUrl: m.awayTeam.crestUrl },
    timeChip: { icon: '', label: '', level: 'UNKNOWN', kind: 'TOURNAMENT' },
  };
}

// ── Helpers de presentación ───────────────────────────────────────────────────

function fmtDate(utc: string) {
  try {
    return new Intl.DateTimeFormat('es-UY', {
      timeZone: 'America/Montevideo',
      weekday: 'short', day: '2-digit', month: '2-digit',
    }).format(new Date(utc));
  } catch { return '—'; }
}

function fmtTime(utc: string) {
  try {
    return new Intl.DateTimeFormat('es-UY', {
      timeZone: 'America/Montevideo',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(utc));
  } catch { return '—'; }
}

function Crest({ url, size = 20 }: { url?: string; size?: number }) {
  return url
    ? <img src={url} alt="" style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }} />
    : <div style={{ width: size, height: size, borderRadius: '50%', background: 'var(--sp-border-8)', flexShrink: 0 }} />;
}

// ── MatchRow — fila compacta de partido ───────────────────────────────────────

function MatchRow({
  match,
  isMobile,
  onClick,
}: {
  match: TournamentMatchItem;
  isMobile: boolean;
  onClick: (teamId: string) => void;
}) {
  const hasScore = match.scoreHome !== null && match.scoreAway !== null;
  const hasPens = match.scoreHomePenalties !== null && match.scoreAwayPenalties !== null;
  const isLive = !hasScore && match.kickoffUtc
    ? (() => {
        const diff = (Date.now() - new Date(match.kickoffUtc).getTime()) / 60000;
        return diff >= 0 && diff <= 180;
      })()
    : false;

  const scoreColor = isLive ? '#f97316' : hasScore ? 'var(--sp-text)' : 'var(--sp-text-40)';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(match.homeTeam.teamId)}
      onKeyDown={(e) => e.key === 'Enter' && onClick(match.homeTeam.teamId)}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        gap: isMobile ? 8 : 12,
        padding: isMobile ? '10px 12px' : '12px 16px',
        background: 'var(--sp-surface-card)',
        border: isLive
          ? '1px solid rgba(239,68,68,0.45)'
          : '1px solid var(--sp-border-8)',
        borderRadius: 12,
        cursor: 'pointer',
        transition: 'border-color 0.15s ease',
        minHeight: 44,
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--sp-primary-40)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = isLive ? 'rgba(239,68,68,0.45)' : 'var(--sp-border-8)'; }}
    >
      {/* Equipo local */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', minWidth: 0 }}>
        <span style={{
          fontSize: isMobile ? 12 : 13, fontWeight: 600, color: 'var(--sp-text-88)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          textAlign: 'right',
        }}>
          {match.homeTeam.name}
        </span>
        <Crest url={match.homeTeam.crestUrl} size={isMobile ? 18 : 20} />
      </div>

      {/* Marcador / hora */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, minWidth: isMobile ? 56 : 70 }}>
        {hasScore ? (
          <>
            <span style={{
              fontSize: isMobile ? 15 : 18, fontWeight: 900, color: scoreColor,
              fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.03em', lineHeight: 1,
            }}>
              {match.scoreHome} — {match.scoreAway}
            </span>
            {hasPens && (
              <span style={{ fontSize: 10, color: 'var(--sp-text-35)', marginTop: 2 }}>
                ({match.scoreHomePenalties} — {match.scoreAwayPenalties} pen)
              </span>
            )}
            {(match.scoreHomeExtraTime != null || match.scoreAwayExtraTime != null) && !hasPens && (
              <span style={{ fontSize: 10, color: 'var(--sp-text-35)', marginTop: 2 }}>
                (pró.)
              </span>
            )}
          </>
        ) : isLive ? (
          <span style={{
            fontSize: 8, fontWeight: 900, letterSpacing: '0.1em',
            padding: '2px 8px', borderRadius: 20,
            background: '#ef4444', color: '#fff', lineHeight: 1.6,
          }}>
            LIVE
          </span>
        ) : match.kickoffUtc ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: isMobile ? 10 : 11, fontWeight: 700, color: 'var(--sp-text-70)', lineHeight: 1 }}>
              {fmtDate(match.kickoffUtc)}
            </div>
            <div style={{ fontSize: isMobile ? 10 : 11, fontWeight: 500, color: 'var(--sp-text-40)', marginTop: 2 }}>
              {fmtTime(match.kickoffUtc)}
            </div>
          </div>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--sp-text-30)' }}>—</span>
        )}
      </div>

      {/* Equipo visitante */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-start', minWidth: 0 }}>
        <Crest url={match.awayTeam.crestUrl} size={isMobile ? 18 : 20} />
        <span style={{
          fontSize: isMobile ? 12 : 13, fontWeight: 600, color: 'var(--sp-text-88)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {match.awayTeam.name}
        </span>
      </div>
    </div>
  );
}

// ── ScrollableTabBar — selector horizontal con scroll ─────────────────────────

function ScrollableTabBar<T extends string>({
  items,
  selected,
  onSelect,
  isMobile,
  accent = 'var(--sp-primary)',
}: {
  items: { id: T; label: string }[];
  selected: T | null;
  onSelect: (id: T) => void;
  isMobile: boolean;
  accent?: string;
}) {
  return (
    <div style={{
      display: 'flex',
      gap: 6,
      overflowX: 'auto',
      paddingBottom: 4,
      scrollbarWidth: 'none',
      WebkitOverflowScrolling: 'touch',
    }}>
      {items.map((item) => {
        const isActive = selected === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            style={{
              flexShrink: 0,
              padding: isMobile ? '6px 14px' : '7px 18px',
              borderRadius: 9999,
              border: isActive
                ? `1px solid ${accent}60`
                : '1px solid var(--sp-border-8)',
              background: isActive ? `${accent}18` : 'var(--sp-surface)',
              color: isActive ? accent : 'var(--sp-text-40)',
              fontSize: isMobile ? 12 : 13,
              fontWeight: isActive ? 700 : 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              minHeight: 36,
              transition: 'all 0.15s ease',
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonList({ count = 6 }: { count?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{
          height: 52,
          background: 'var(--sp-surface-card)',
          border: '1px solid var(--sp-border-8)',
          borderRadius: 12,
          animation: 'pulse 1.8s ease-in-out infinite',
        }} />
      ))}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

type FilterMode = 'ronda' | 'grupo';

interface TournamentPartidosViewProps {
  competitionId: string;
  accent?: string;
}

export function TournamentPartidosView({ competitionId, accent = 'var(--sp-primary)' }: TournamentPartidosViewProps) {
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';

  const { data, loading } = useTournamentMatches(competitionId);

  const [filterMode, setFilterMode] = useState<FilterMode>('ronda');
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const [focusTeamId, setFocusTeamId] = useState<string | null>(null);
  const [focusDateLocal, setFocusDateLocal] = useState<string | null>(null);
  const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Montevideo' });
  const { data: teamDetail } = useTeamDetail(competitionId, focusTeamId, null, 'America/Montevideo', focusDateLocal ?? todayLocal);

  const rounds = data?.rounds ?? [];
  const groups = data?.groups ?? [];

  // Auto-seleccionar primera ronda/grupo cuando llegan datos
  const effectiveRoundId = selectedRoundId ?? rounds[0]?.stageId ?? null;
  const effectiveGroupId = selectedGroupId ?? groups[0]?.groupId ?? null;

  const selectedRound = rounds.find((r) => r.stageId === effectiveRoundId);
  const selectedGroup = groups.find((g) => g.groupId === effectiveGroupId);

  const visibleMatches: TournamentMatchItem[] =
    filterMode === 'ronda'
      ? (selectedRound?.matches ?? [])
      : (selectedGroup?.matches ?? []);

  const hasGroups = groups.length > 0;

  const modeButtonStyle = (active: boolean): React.CSSProperties => ({
    padding: isMobile ? '7px 18px' : '8px 22px',
    borderRadius: 9999,
    border: active ? `1px solid ${accent}60` : '1px solid var(--sp-border-8)',
    background: active ? `${accent}18` : 'var(--sp-surface)',
    color: active ? accent : 'var(--sp-text-40)',
    fontSize: isMobile ? 13 : 14,
    fontWeight: active ? 700 : 500,
    cursor: 'pointer',
    minHeight: 40,
    transition: 'all 0.15s ease',
  });

  return (
    <div>
      {/* ── Selector de modo (Por ronda / Por grupo) ── */}
      {hasGroups && (
        <div style={{ display: 'flex', gap: 6, marginBottom: isMobile ? 14 : 18 }}>
          <button style={modeButtonStyle(filterMode === 'ronda')} onClick={() => setFilterMode('ronda')}>
            Por ronda
          </button>
          <button style={modeButtonStyle(filterMode === 'grupo')} onClick={() => setFilterMode('grupo')}>
            Por grupo
          </button>
        </div>
      )}

      {loading ? (
        <SkeletonList />
      ) : (
        <>
          {/* ── Selector de ronda o grupo ── */}
          <div style={{ marginBottom: isMobile ? 12 : 16 }}>
            {filterMode === 'ronda' && rounds.length > 0 && (
              <ScrollableTabBar
                items={rounds.map((r) => ({ id: r.stageId, label: r.name }))}
                selected={effectiveRoundId}
                onSelect={(id) => { setSelectedRoundId(id); setFocusTeamId(null); setFocusDateLocal(null); }}
                isMobile={isMobile}
                accent={accent}
              />
            )}
            {filterMode === 'grupo' && groups.length > 0 && (
              <ScrollableTabBar
                items={groups.map((g) => ({ id: g.groupId, label: g.name }))}
                selected={effectiveGroupId}
                onSelect={(id) => { setSelectedGroupId(id); setFocusTeamId(null); setFocusDateLocal(null); }}
                isMobile={isMobile}
                accent={accent}
              />
            )}
          </div>

          {/* ── Lista de partidos ── */}
          {visibleMatches.length === 0 ? (
            <div style={{
              padding: isMobile ? '24px 16px' : '40px 24px',
              background: 'var(--sp-surface-card)',
              border: '1px solid var(--sp-border-8)',
              borderRadius: 12, textAlign: 'center',
            }}>
              <div style={{ fontSize: 14, color: 'var(--sp-text-40)' }}>Sin partidos para esta selección.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {visibleMatches.map((match) => (
                <MatchRow
                  key={match.matchId}
                  match={match}
                  isMobile={isMobile}
                  onClick={(teamId) => {
                    const isToggleOff = focusTeamId === teamId;
                    setFocusTeamId(isToggleOff ? null : teamId);
                    setFocusDateLocal(isToggleOff ? null : (match.kickoffUtc
                      ? new Date(match.kickoffUtc).toLocaleDateString('en-CA', { timeZone: 'America/Montevideo' })
                      : todayLocal));
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── DetailPanel ── */}
      {focusTeamId && teamDetail && (
        <DetailPanel
          detail={teamDetail}
          onClose={() => { setFocusTeamId(null); setFocusDateLocal(null); }}
        />
      )}
    </div>
  );
}
