import { useDashboardSnapshot } from '../hooks/use-dashboard-snapshot.js';
import { useTeamDetail } from '../hooks/use-team-detail.js';
import { useUrlState } from '../hooks/use-url-state.js';
import { useWindowWidth } from '../hooks/use-window-width.js';
import { DashboardHeader } from './DashboardHeader.js';
import { WarningBanner } from './WarningBanner.js';
import { TreemapCanvas } from './TreemapCanvas.js';
import { MobileTeamList } from './MobileTeamList.js';
import { MatchCardList } from './MatchCardList.js';
import { DetailPanel } from './DetailPanel.js';
import { LoadingSkeleton } from './LoadingSkeleton.js';
import { EmptyState } from './EmptyState.js';
import { ErrorState } from './ErrorState.js';

interface DashboardLayoutProps {
  competitionId: string;
  matchday: number | null;
  timezone: string;
  viewMode?: 'treemap' | 'partidos';
}

export function DashboardLayout({ competitionId, matchday, timezone, viewMode = 'treemap' }: DashboardLayoutProps) {
  const { data, loading, error, source, refetch } = useDashboardSnapshot(
    competitionId,
    matchday,
    timezone,
  );
  const { focus, setFocus } = useUrlState();
  const { data: teamDetail } = useTeamDetail(competitionId, focus, matchday, timezone);
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';

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
      {viewMode === 'partidos' ? (
        <MatchCardList matchCards={data.matchCards ?? []} />
      ) : data.teams.length === 0 ? (
        <EmptyState />
      ) : isMobile ? (
        <MobileTeamList
          teams={data.teams}
          focusedTeamId={focus}
          onSelectTeam={(id) => setFocus(id === focus ? null : id)}
          timezone={timezone}
        />
      ) : (
        <TreemapCanvas
          teams={data.teams}
          layout={data.layout}
          focusedTeamId={focus}
          onSelectTeam={(id) => setFocus(id === focus ? null : id)}
        />
      )}
      {viewMode !== 'partidos' && focus && teamDetail && (
        <DetailPanel detail={teamDetail} onClose={() => setFocus(null)} />
      )}
    </div>
  );
}
