/**
 * TournamentPronosticosView — Pronósticos para torneos (Copa Libertadores, etc.)
 * Muestra un selector de fases (Fase Previa 1/2/3, Grupos, Eliminatorias) en lugar
 * del MatchdayCarousel numérico que se usa en ligas.
 * Fuente de datos: useKnockoutBracket para estructura de fases y matches.
 * Para la fase de Grupos (cuando aplica): usa useTournamentMatches con filtro de grupo.
 */

import { useState, useEffect } from 'react';
import { useWindowWidth } from '../../hooks/use-window-width.js';
import { useKnockoutBracket } from '../../hooks/use-knockout-bracket.js';
import { useRadar } from '../../hooks/use-radar.js';
import { useTeamDetail } from '../../hooks/use-team-detail.js';
import { useTournamentMatches, type TournamentMatchItem } from '../../hooks/use-tournament-matches.js';
import type { RoundDTO, TieDTO } from '../../types/tournament.js';
import type { MatchCardDTO } from '../../types/snapshot.js';
import { PronosticoCard } from './PronosticoCard.js';
import { DetailPanel } from '../DetailPanel.js';
import { getCompMeta } from '../../utils/competition-meta.js';

interface TournamentPronosticosViewProps {
  competitionId: string;
}

// Identificador virtual para la fase de grupos en el selector de fases
const GRUPOS_STAGE_ID = '__grupos__';

// ── TieDTO → MatchCardDTO adapter ─────────────────────────────────────────────

function tieToMatchCard(tie: TieDTO, competitionId: string): MatchCardDTO {
  const kickoffUtc = tie.utcDate ?? tie.legs?.[0]?.utcDate ?? undefined;
  const scoreHome = tie.scoreA ?? null;
  const scoreAway = tie.scoreB ?? null;
  let status: MatchCardDTO['status'] = 'UNKNOWN';
  if (scoreHome !== null && scoreAway !== null) {
    status = 'FINISHED';
  } else if (kickoffUtc) {
    const now = Date.now();
    const kick = new Date(kickoffUtc).getTime();
    if (kick > now) status = 'SCHEDULED';
  }
  return {
    matchId: tie.tieId,
    kickoffUtc,
    status,
    scoreHome,
    scoreAway,
    home: {
      teamId: tie.slotA.participantId ?? tie.slotA.slotId,
      name: tie.slotA.teamName ?? tie.slotA.placeholderText ?? '?',
      crestUrl: tie.slotA.crestUrl,
    },
    away: {
      teamId: tie.slotB.participantId ?? tie.slotB.slotId,
      name: tie.slotB.teamName ?? tie.slotB.placeholderText ?? '?',
      crestUrl: tie.slotB.crestUrl,
    },
    timeChip: { icon: '', label: '', level: 'UNKNOWN', kind: 'TOURNAMENT' },
  };
}

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
    home: { teamId: m.homeTeam.teamId, name: m.homeTeam.name, crestUrl: m.homeTeam.crestUrl },
    away: { teamId: m.awayTeam.teamId, name: m.awayTeam.name, crestUrl: m.awayTeam.crestUrl },
    timeChip: { icon: '', label: '', level: 'UNKNOWN', kind: 'TOURNAMENT' },
  };
}

// ── Phase tab selector ────────────────────────────────────────────────────────

function PhaseTabBar({
  rounds,
  selectedStageId,
  onSelect,
  isMobile,
}: {
  rounds: RoundDTO[];
  selectedStageId: string | null;
  onSelect: (stageId: string) => void;
  isMobile: boolean;
}) {
  if (rounds.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: isMobile ? 14 : 18 }}>
      {rounds.map((round) => {
        const isActive = selectedStageId === round.stageId;
        return (
          <button
            key={round.stageId}
            onClick={() => onSelect(round.stageId)}
            style={{
              padding: isMobile ? '6px 14px' : '7px 18px',
              borderRadius: 9999,
              border: isActive ? '1px solid var(--sp-primary-40)' : '1px solid var(--sp-border-8)',
              background: isActive ? 'var(--sp-primary-10)' : 'var(--sp-surface)',
              color: isActive ? 'var(--sp-text)' : 'var(--sp-text-40)',
              fontSize: isMobile ? 12 : 13,
              fontWeight: isActive ? 700 : 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              minHeight: 36,
              transition: 'all 0.15s ease',
              boxShadow: isActive ? '0 0 12px var(--sp-primary-10)' : 'none',
            }}
          >
            {round.name}
          </button>
        );
      })}
    </div>
  );
}

// ── Group sub-filter ──────────────────────────────────────────────────────────

function GroupFilterBar({
  groups,
  selectedGroupId,
  onSelect,
  isMobile,
}: {
  groups: { groupId: string; name: string }[];
  selectedGroupId: string | null;
  onSelect: (groupId: string) => void;
  isMobile: boolean;
}) {
  const allId = '__all__';
  const items = [{ groupId: allId, name: 'Todos' }, ...groups];
  return (
    <div style={{
      display: 'flex',
      gap: 6,
      overflowX: 'auto',
      paddingBottom: 4,
      scrollbarWidth: 'none',
      marginBottom: isMobile ? 12 : 16,
    }}>
      {items.map((g) => {
        const isActive = (selectedGroupId ?? allId) === g.groupId;
        return (
          <button
            key={g.groupId}
            onClick={() => onSelect(g.groupId === allId ? '__all__' : g.groupId)}
            style={{
              flexShrink: 0,
              padding: isMobile ? '5px 12px' : '6px 14px',
              borderRadius: 9999,
              border: isActive ? '1px solid var(--sp-primary-40)' : '1px solid var(--sp-border-8)',
              background: isActive ? 'var(--sp-primary-10)' : 'var(--sp-surface)',
              color: isActive ? 'var(--sp-text)' : 'var(--sp-text-40)',
              fontSize: isMobile ? 11 : 12,
              fontWeight: isActive ? 700 : 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              minHeight: 32,
              transition: 'all 0.15s ease',
            }}
          >
            {g.name}
          </button>
        );
      })}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ isMobile }: { isMobile: boolean }) {
  return (
    <div style={{
      padding: isMobile ? '24px 16px' : '40px 24px',
      background: 'var(--sp-surface-card)',
      border: '1px solid var(--sp-border-8)',
      borderRadius: 16,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 28, marginBottom: 10 }}>🎯</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sp-text-50)', marginBottom: 4 }}>
        Sin partidos para esta fase
      </div>
      <div style={{ fontSize: 12, color: 'var(--sp-text-30)' }}>
        Seleccioná otra fase para ver los partidos.
      </div>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonGrid({ cols, isMobile }: { cols: number; isMobile: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: isMobile ? 10 : 14 }}>
      {Array.from({ length: cols * 2 }).map((_, i) => (
        <div
          key={i}
          style={{
            background: 'var(--sp-surface-card)',
            border: '1px solid var(--sp-border-8)',
            borderRadius: isMobile ? 14 : 16,
            height: isMobile ? 72 : 180,
            animation: 'pulse 1.8s ease-in-out infinite',
          }}
        />
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TournamentPronosticosView({ competitionId }: TournamentPronosticosViewProps) {
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';
  const isTablet = breakpoint === 'tablet';
  const cols = isMobile ? 1 : isTablet ? 3 : 5;

  const compMeta = getCompMeta(competitionId);
  const competitionHasGroups = compMeta?.phases?.includes('grupos') ?? false;

  const { data: bracket, loading: bracketLoading } = useKnockoutBracket(competitionId, true);
  const { data: tournamentMatchesData, loading: matchesLoading } = useTournamentMatches(
    competitionHasGroups ? competitionId : '',
  );

  const [focusTeamId, setFocusTeamId] = useState<string | null>(null);
  const [focusMatchId, setFocusMatchId] = useState<string | null>(null);
  const [focusDateLocal, setFocusDateLocal] = useState<string | null>(null);
  const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Montevideo' });
  const { data: teamDetail } = useTeamDetail(
    competitionId,
    focusTeamId,
    null,
    'America/Montevideo',
    focusDateLocal ?? todayLocal,
  );

  // ── Construir lista de fases ───────────────────────────────────────────────
  // Fase "Grupos" virtual va primero cuando la competición tiene grupos
  const gruposRound: RoundDTO | null = competitionHasGroups
    ? { stageId: GRUPOS_STAGE_ID, name: 'Grupos', stageType: 'GROUP_STAGE', orderIndex: 0, ties: [] }
    : null;

  const allRounds: RoundDTO[] = [
    ...(gruposRound ? [gruposRound] : []),
    ...(bracket?.preliminaryRounds ?? []),
    ...(bracket?.knockoutRounds ?? []),
  ];

  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  // Seleccionar primera fase disponible cuando llegan los datos
  useEffect(() => {
    if (allRounds.length > 0 && !selectedStageId) {
      setSelectedStageId(allRounds[0].stageId);
    }
  }, [allRounds.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const isGruposActive = selectedStageId === GRUPOS_STAGE_ID;

  // ── Datos según fase activa ────────────────────────────────────────────────
  const selectedRound = isGruposActive
    ? null
    : (allRounds.find((r) => r.stageId === selectedStageId) ?? null);

  // Para radar (fases de bracket)
  const radarMatchday = selectedRound
    ? selectedRound.orderIndex < 0
      ? Math.abs(selectedRound.orderIndex)
      : selectedRound.orderIndex
    : null;
  const { data: radarData } = useRadar(competitionId, radarMatchday);

  const radarLiveMap = new Map(
    (radarData?.liveData ?? []).map((ld) => [ld.matchId, ld]),
  );
  const radarCardMap = new Map(
    (radarData?.index?.cards ?? []).map((c) => [c.matchId, c]),
  );

  // ── Datos de grupos ────────────────────────────────────────────────────────
  const availableGroups = tournamentMatchesData?.groups ?? [];
  const groupsForFilter = availableGroups.map((g) => ({ groupId: g.groupId, name: g.name }));

  const groupMatchesVisible: TournamentMatchItem[] = (() => {
    if (!isGruposActive) return [];
    if (!selectedGroupId || selectedGroupId === '__all__') {
      return availableGroups.flatMap((g) => g.matches);
    }
    return availableGroups.find((g) => g.groupId === selectedGroupId)?.matches ?? [];
  })();

  const loading = bracketLoading || (isGruposActive && matchesLoading);

  if (loading) {
    return <SkeletonGrid cols={cols} isMobile={isMobile} />;
  }

  if (allRounds.length === 0) {
    return <EmptyState isMobile={isMobile} />;
  }

  const bracketTies: TieDTO[] = selectedRound?.ties ?? [];

  function clearFocus() {
    setFocusTeamId(null);
    setFocusMatchId(null);
    setFocusDateLocal(null);
  }

  return (
    <div>
      <PhaseTabBar
        rounds={allRounds}
        selectedStageId={selectedStageId}
        onSelect={(id) => { setSelectedStageId(id); clearFocus(); setSelectedGroupId(null); }}
        isMobile={isMobile}
      />

      {/* Segunda capa: filtro de grupos — solo visible cuando fase Grupos está activa */}
      {isGruposActive && groupsForFilter.length > 0 && (
        <GroupFilterBar
          groups={groupsForFilter}
          selectedGroupId={selectedGroupId}
          onSelect={(id) => { setSelectedGroupId(id); clearFocus(); }}
          isMobile={isMobile}
        />
      )}

      {/* Contenido */}
      {isGruposActive ? (
        groupMatchesVisible.length === 0 ? (
          <EmptyState isMobile={isMobile} />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: isMobile ? 10 : 14 }}>
            {groupMatchesVisible.map((m, i) => {
              const matchCard = matchItemToCard(m);
              return (
                <PronosticoCard
                  key={m.matchId}
                  matchCard={matchCard}
                  radarCard={null}
                  live={null}
                  onViewMatch={(teamId) => {
                    const isToggleOff = focusTeamId === teamId;
                    setFocusTeamId(isToggleOff ? null : teamId);
                    setFocusMatchId(isToggleOff ? null : m.matchId);
                    setFocusDateLocal(isToggleOff ? null : (m.kickoffUtc
                      ? new Date(m.kickoffUtc).toLocaleDateString('en-CA', { timeZone: 'America/Montevideo' })
                      : todayLocal));
                  }}
                  animationDelay={i * 40}
                />
              );
            })}
          </div>
        )
      ) : bracketTies.length === 0 ? (
        <EmptyState isMobile={isMobile} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: isMobile ? 10 : 14 }}>
          {bracketTies.map((tie, i) => {
            const matchCard = tieToMatchCard(tie, competitionId);
            return (
              <PronosticoCard
                key={tie.tieId}
                matchCard={matchCard}
                radarCard={radarCardMap.get(tie.tieId) ?? null}
                live={radarLiveMap.get(tie.tieId) ?? null}
                onViewMatch={(teamId) => {
                  const isToggleOff = focusTeamId === teamId;
                  setFocusTeamId(isToggleOff ? null : teamId);
                  setFocusMatchId(isToggleOff ? null : tie.tieId);
                  const kickoffUtc = tie.utcDate ?? tie.legs?.[0]?.utcDate;
                  setFocusDateLocal(isToggleOff ? null : (kickoffUtc
                    ? new Date(kickoffUtc).toLocaleDateString('en-CA', { timeZone: 'America/Montevideo' })
                    : todayLocal));
                }}
                animationDelay={i * 40}
              />
            );
          })}
        </div>
      )}

      {focusTeamId && teamDetail && (() => {
        const live = focusMatchId ? radarLiveMap.get(focusMatchId) : undefined;
        const probsOverride = live?.probHomeWin != null && live.probDraw != null && live.probAwayWin != null
          ? { probHome: live.probHomeWin, probDraw: live.probDraw, probAway: live.probAwayWin }
          : undefined;
        return (
          <DetailPanel
            detail={teamDetail}
            onClose={clearFocus}
            predictionProbsOverride={probsOverride}
          />
        );
      })()}
    </div>
  );
}
