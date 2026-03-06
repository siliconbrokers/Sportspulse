import { useDashboardSnapshot } from '../hooks/use-dashboard-snapshot.js';
import { useTeamDetail } from '../hooks/use-team-detail.js';
import { useUrlState } from '../hooks/use-url-state.js';
import { DashboardHeader } from './DashboardHeader.js';
import { WarningBanner } from './WarningBanner.js';
import { TreemapCanvas } from './TreemapCanvas.js';
import { DetailPanel } from './DetailPanel.js';
import { LoadingSkeleton } from './LoadingSkeleton.js';
import { EmptyState } from './EmptyState.js';
import { ErrorState } from './ErrorState.js';

interface DashboardLayoutProps {
  competitionId: string;
  matchday: number | null;
  timezone: string;
}

export function DashboardLayout({ competitionId, matchday, timezone }: DashboardLayoutProps) {
  const { data, loading, error, source, refetch } = useDashboardSnapshot(
    competitionId,
    matchday,
    timezone,
  );
  const { focus, setFocus } = useUrlState();
  const { data: teamDetail } = useTeamDetail(competitionId, focus, matchday, timezone);

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
      {data.teams.length === 0 ? (
        <EmptyState />
      ) : (
        <TreemapCanvas
          teams={data.teams}
          layout={data.layout}
          focusedTeamId={focus}
          onSelectTeam={(id) => setFocus(id === focus ? null : id)}
        />
      )}
      {focus && teamDetail && <DetailPanel detail={teamDetail} onClose={() => setFocus(null)} />}
    </div>
  );
}
