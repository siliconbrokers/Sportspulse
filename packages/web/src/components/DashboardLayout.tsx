import { useEffect } from 'react';
import { useDashboardSnapshot } from '../hooks/use-dashboard-snapshot.js';
import { useTeamDetail } from '../hooks/use-team-detail.js';
import { useUrlState } from '../hooks/use-url-state.js';
import { useRadar } from '../hooks/use-radar.js';
import { WarningBanner } from './WarningBanner.js';
import { MatchCardList } from './MatchCardList.js';
import { DetailPanel } from './DetailPanel.js';
import type { PredictionProbsOverride } from '../utils/match-detail-viewmodel.js';
import { ErrorState } from './ErrorState.js';
import { RadarSection } from './radar/RadarSection.js';

interface DashboardLayoutProps {
  competitionId: string;
  matchday: number | null;
  currentMatchday: number | null;
  timezone: string;
  viewMode?: 'radar' | 'partidos';
  onLiveMatchesChange?: (hasLive: boolean) => void;
  /** Alternativa a matchday para torneos: fecha local ISO (YYYY-MM-DD) */
  dateLocal?: string;
}

export function DashboardLayout({ competitionId, matchday, currentMatchday, timezone, viewMode = 'radar', onLiveMatchesChange, dateLocal }: DashboardLayoutProps) {
  const { data, loading, error, source, refetch } = useDashboardSnapshot(
    competitionId,
    matchday,
    timezone,
    dateLocal,
  );
  const { focus, setFocus } = useUrlState();
  const { data: teamDetail } = useTeamDetail(competitionId, focus, matchday, timezone, dateLocal);
  const { data: radarData, loading: radarLoading } = useRadar(competitionId, matchday);

  // Notificar al padre cuando cambia el estado live (para el ping del Navbar)
  useEffect(() => {
    if (!onLiveMatchesChange) return;
    const hasLive = data?.matchCards.some((m) => m.status === 'LIVE') ?? false;
    onLiveMatchesChange(hasLive);
  }, [data, onLiveMatchesChange]);

  // Vista Partidos: el skeleton lo maneja MatchCardList internamente
  if (viewMode === 'partidos') {
    if (matchday === null && !dateLocal) return null;
    if (error) {
      return (
        <div style={{ padding: 16 }}>
          <ErrorState message={error} onRetry={refetch} />
        </div>
      );
    }
    return (
      <div data-testid="dashboard-layout" style={{ width: '100%', overflowX: 'hidden' }}>
        <MatchCardList
          matchCards={data?.matchCards ?? []}
          onSelectTeam={(id) => setFocus(id === focus ? null : id)}
          focusedTeamId={focus}
          showForm={matchday === currentMatchday}
          loading={loading}
          competitionId={competitionId}
          matchday={matchday}
        />
        {focus && teamDetail && (() => {
          const live = radarData?.liveData?.find(
            (ld) => ld.homeTeamId === focus || ld.awayTeamId === focus,
          );
          const probsOverride: PredictionProbsOverride | undefined =
            live?.probHomeWin != null && live.probDraw != null && live.probAwayWin != null
              ? { probHome: live.probHomeWin, probDraw: live.probDraw, probAway: live.probAwayWin }
              : undefined;
          return (
            <DetailPanel
              detail={teamDetail}
              onClose={() => setFocus(null)}
              predictionProbsOverride={probsOverride}
            />
          );
        })()}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 16 }}>
        <ErrorState message={error} onRetry={refetch} />
      </div>
    );
  }

  // WarningBanner solo si hay datos (y hay warnings que mostrar)
  const warnings = data?.warnings ?? [];

  return (
    <div data-testid="dashboard-layout" style={{ width: '100%', overflowX: 'hidden' }}>
      <WarningBanner warnings={warnings} />
      <div style={{ padding: 16 }}>
        <RadarSection
          data={radarData}
          loading={radarLoading || matchday === null}
          onViewMatch={(matchId) => setFocus(matchId === focus ? null : matchId)}
        />
      </div>
      {focus && teamDetail && (() => {
        const live = radarData?.liveData?.find(
          (ld) => ld.homeTeamId === focus || ld.awayTeamId === focus,
        );
        const probsOverride: PredictionProbsOverride | undefined =
          live?.probHomeWin != null && live.probDraw != null && live.probAwayWin != null
            ? { probHome: live.probHomeWin, probDraw: live.probDraw, probAway: live.probAwayWin }
            : undefined;
        return (
          <DetailPanel
            detail={teamDetail}
            onClose={() => setFocus(null)}
            predictionProbsOverride={probsOverride}
          />
        );
      })()}
    </div>
  );
}
