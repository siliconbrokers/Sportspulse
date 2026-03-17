/**
 * PronosticosView — Todos los partidos de la jornada con análisis de pronóstico.
 * Fuente base: useDashboardSnapshot (todos los matchCards).
 * Fuente editorial: useRadar (predicciones + probabilidades para matches destacados).
 * Desktop: 5 columnas. Tablet: 3 cols. Mobile: 1 columna horizontal compacta.
 */

import { useState } from 'react';
import { useWindowWidth } from '../../hooks/use-window-width.js';
import { useRadar, type RadarCardEntry, type RadarLiveMatchData } from '../../hooks/use-radar.js';
import { useDashboardSnapshot } from '../../hooks/use-dashboard-snapshot.js';
import { useTeamDetail } from '../../hooks/use-team-detail.js';
import type { MatchCardDTO } from '../../types/snapshot.js';
import { PronosticoCard } from './PronosticoCard.js';
import { DetailPanel } from '../DetailPanel.js';

interface PronosticosViewProps {
  competitionId: string;
  matchday: number | null;
  subTournamentKey?: string;
}

// ── Skeletons ─────────────────────────────────────────────────────────────────

function SkeletonCard({ isMobile }: { isMobile: boolean }) {
  return (
    <div style={{
      background: 'var(--sp-surface-card)',
      border: '1px solid var(--sp-border-8)',
      borderRadius: isMobile ? 14 : 16,
      height: isMobile ? 72 : 180,
      animation: 'pulse 1.8s ease-in-out infinite',
    }} />
  );
}

// ── Empty / unavailable ───────────────────────────────────────────────────────

function EmptyState({ isMobile }: { isMobile: boolean }) {
  return (
    <div style={{
      padding: isMobile ? '24px 16px' : '40px 24px',
      background: 'var(--sp-surface-card)',
      border: '1px solid var(--sp-border-8)',
      borderRadius: 16, textAlign: 'center',
    }}>
      <div style={{ fontSize: 28, marginBottom: 10 }}>🎯</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sp-text-50)', marginBottom: 4 }}>
        Sin partidos para esta jornada
      </div>
      <div style={{ fontSize: 12, color: 'var(--sp-text-30)' }}>
        Seleccioná otra jornada para ver los partidos.
      </div>
    </div>
  );
}

// ── Sort helper ───────────────────────────────────────────────────────────────

function sortMatchCards(
  cards: MatchCardDTO[],
  _radarMap: Map<string, RadarCardEntry>,
): MatchCardDTO[] {
  // Orden temporal descendente: el partido con kickoff más tardío aparece primero
  return [...cards].sort((a, b) => {
    const aTime = a.kickoffUtc ?? '';
    const bTime = b.kickoffUtc ?? '';
    return aTime > bTime ? -1 : aTime < bTime ? 1 : 0;
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function PronosticosView({ competitionId, matchday, subTournamentKey }: PronosticosViewProps) {
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';
  const isTablet = breakpoint === 'tablet';
  const [focusTeamId, setFocusTeamId] = useState<string | null>(null);
  const [focusMatchId, setFocusMatchId] = useState<string | null>(null);
  const { data: teamDetail } = useTeamDetail(competitionId, focusTeamId, matchday, 'America/Montevideo');

  // Todos los partidos de la jornada (filtrado por sub-torneo si aplica)
  const { data: snapshot, loading: snapshotLoading } = useDashboardSnapshot(
    competitionId,
    matchday,
    'America/Montevideo',
    undefined,
    subTournamentKey,
  );

  // Datos editoriales de radar (predicciones, probabilidades) — opcional
  const { data: radarData, loading: radarLoading } = useRadar(competitionId, matchday);

  const loading = snapshotLoading || matchday === null;
  const cols = isMobile ? 1 : isTablet ? 3 : 5;

  // Índices de radar por matchId
  const radarMap = new Map<string, RadarCardEntry>(
    (radarData?.index?.cards ?? []).map((c) => [c.matchId, c]),
  );
  const liveMap = new Map<string, RadarLiveMatchData>(
    (radarData?.liveData ?? []).map((ld) => [ld.matchId, ld]),
  );

  // Loading skeleton
  if (loading || radarLoading) {
    const skeletonCount = isMobile ? 4 : cols;
    return (
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: isMobile ? 10 : 14,
      }}>
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <SkeletonCard key={i} isMobile={isMobile} />
        ))}
      </div>
    );
  }

  const allMatchCards = snapshot?.matchCards ?? [];

  if (allMatchCards.length === 0) {
    return <EmptyState isMobile={isMobile} />;
  }

  const sorted = sortMatchCards(allMatchCards, radarMap);

  return (
    <>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: isMobile ? 10 : 14,
      }}>
        {sorted.map((matchCard, i) => (
          <PronosticoCard
            key={matchCard.matchId}
            matchCard={matchCard}
            radarCard={radarMap.get(matchCard.matchId) ?? null}
            live={liveMap.get(matchCard.matchId) ?? null}
            onViewMatch={(teamId) => {
              const isToggleOff = focusTeamId === teamId;
              setFocusTeamId(isToggleOff ? null : teamId);
              setFocusMatchId(isToggleOff ? null : matchCard.matchId);
            }}
            animationDelay={i * 40}
            competitionId={competitionId}
          />
        ))}
      </div>
      {focusTeamId && teamDetail && (() => {
        const live = focusMatchId ? liveMap.get(focusMatchId) : undefined;
        const probsOverride = live?.probHomeWin != null && live.probDraw != null && live.probAwayWin != null
          ? { probHome: live.probHomeWin, probDraw: live.probDraw, probAway: live.probAwayWin }
          : undefined;
        return (
          <DetailPanel
            detail={teamDetail}
            onClose={() => { setFocusTeamId(null); setFocusMatchId(null); }}
            predictionProbsOverride={probsOverride}
          />
        );
      })()}
    </>
  );
}
