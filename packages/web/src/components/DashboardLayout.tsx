import { useDashboardSnapshot } from '../hooks/use-dashboard-snapshot.js';
import { useTeamDetail } from '../hooks/use-team-detail.js';
import { useUrlState } from '../hooks/use-url-state.js';
import { useRadar } from '../hooks/use-radar.js';
import { DashboardHeader } from './DashboardHeader.js';
import { WarningBanner } from './WarningBanner.js';
import { MatchCardList } from './MatchCardList.js';
import { DetailPanel } from './DetailPanel.js';
import { LoadingSkeleton } from './LoadingSkeleton.js';
import { ErrorState } from './ErrorState.js';
import { RadarSection } from './radar/RadarSection.js';

interface DashboardLayoutProps {
  competitionId: string;
  matchday: number | null;
  currentMatchday: number | null;
  timezone: string;
  viewMode?: 'radar' | 'partidos';
}

export function DashboardLayout({ competitionId, matchday, currentMatchday, timezone, viewMode = 'radar' }: DashboardLayoutProps) {
  const { data, loading, error, source, refetch } = useDashboardSnapshot(
    competitionId,
    matchday,
    timezone,
  );
  const { focus, setFocus } = useUrlState();
  const { data: teamDetail } = useTeamDetail(competitionId, focus, matchday, timezone);
  const { data: radarData, loading: radarLoading } = useRadar(competitionId, matchday);

  if (matchday === null || loading) {
    return (
      <div style={{ padding: 16 }}>
        <LoadingSkeleton width={1200} height={700} />
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

  if (!data) return null;

  return (
    <div data-testid="dashboard-layout">
      <DashboardHeader header={data.header} warnings={data.warnings} source={source} />
      <WarningBanner warnings={data.warnings} />
      {viewMode === 'radar' ? (
        <div style={{ padding: 16 }}>
          <RadarSection
            data={radarData}
            loading={radarLoading}
            onViewMatch={(matchId) => setFocus(matchId === focus ? null : matchId)}
          />
        </div>
      ) : (
        <MatchCardList
          matchCards={data.matchCards ?? []}
          onSelectTeam={(id) => setFocus(id === focus ? null : id)}
          focusedTeamId={focus}
          showForm={matchday === currentMatchday}
        />
      )}
      {focus && teamDetail && (
        <DetailPanel detail={teamDetail} onClose={() => setFocus(null)} />
      )}
    </div>
  );
}
