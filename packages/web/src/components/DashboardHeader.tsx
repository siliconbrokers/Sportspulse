import type { SnapshotHeaderDTO, WarningDTO } from '../types/snapshot.js';
import { formatDate } from '../utils/format-date.js';
import { competitionDisplayName } from '../utils/labels.js';

interface DashboardHeaderProps {
  header: SnapshotHeaderDTO;
  warnings: WarningDTO[];
  source: string | null;
}

export function DashboardHeader({ header, warnings, source }: DashboardHeaderProps) {
  const warningCount = warnings.filter((w) => w.severity === 'WARN' || w.severity === 'ERROR').length;

  return (
    <header data-testid="dashboard-header" style={{ padding: '12px 16px', color: 'var(--sp-text)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
              {competitionDisplayName(header.competitionId)}
            </h1>
            <span style={{ fontSize: 13, opacity: 0.7 }}>
              {formatDate(header.buildNowUtc, header.timezone)} · {header.timezone}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {source === 'stale_fallback' && (
            <span data-testid="stale-indicator" style={{ fontSize: 12, color: 'var(--sp-status-zombie)' }}>
              Datos desactualizados · {formatDate(header.computedAtUtc, header.timezone)}
            </span>
          )}
          {warningCount > 0 && (
            <span
              data-testid="warning-badge"
              style={{
                backgroundColor: warnings.some((w) => w.severity === 'ERROR') ? 'var(--sp-status-error)' : 'var(--sp-status-zombie)',
                color: '#fff',
                borderRadius: 12,
                padding: '2px 8px',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {warningCount} {warningCount > 1 ? 'alertas' : 'alerta'}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
