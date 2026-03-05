import type { SnapshotHeaderDTO, WarningDTO } from '../types/snapshot.js';

interface DashboardHeaderProps {
  header: SnapshotHeaderDTO;
  warnings: WarningDTO[];
  source: string | null;
}

export function DashboardHeader({ header, warnings, source }: DashboardHeaderProps) {
  const warningCount = warnings.filter((w) => w.severity === 'WARN' || w.severity === 'ERROR').length;

  return (
    <header data-testid="dashboard-header" style={{ padding: '12px 16px', color: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
            {header.competitionId.split(':').pop()?.toUpperCase() ?? 'Dashboard'}
          </h1>
          <span style={{ fontSize: 13, opacity: 0.7 }}>
            {header.buildNowUtc.split('T')[0]} · {header.timezone}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {source === 'stale_fallback' && (
            <span data-testid="stale-indicator" style={{ fontSize: 12, color: '#fbbf24' }}>
              Stale data · {header.computedAtUtc.split('T')[0]}
            </span>
          )}
          {warningCount > 0 && (
            <span
              data-testid="warning-badge"
              style={{
                backgroundColor: warnings.some((w) => w.severity === 'ERROR') ? '#ef4444' : '#f59e0b',
                color: '#000',
                borderRadius: 12,
                padding: '2px 8px',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {warningCount} warning{warningCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
