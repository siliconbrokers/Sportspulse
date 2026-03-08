import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DashboardHeader } from '../src/components/DashboardHeader.js';

const header = {
  snapshotSchemaVersion: 1,
  competitionId: 'comp:football-data:PD',
  seasonId: 'season:2025',
  buildNowUtc: '2026-03-04T11:00:00Z',
  timezone: 'Europe/Madrid',
  policyKey: 'test',
  policyVersion: 1,
  computedAtUtc: '2026-03-04T11:00:01Z',
};

describe('DashboardHeader', () => {
  it('shows competition and date from snapshot header', () => {
    render(<DashboardHeader header={header} warnings={[]} source={null} />);
    expect(screen.getByText(/La Liga/)).toBeInTheDocument();
    // Europe/Madrid is Spanish → DD/MM/YYYY format
    expect(screen.getByText(/04\/03\/2026/)).toBeInTheDocument();
  });

  it('shows warning badge when warnings present', () => {
    const warnings = [{ code: 'LAYOUT_DEGRADED', severity: 'WARN' as const }];
    render(<DashboardHeader header={header} warnings={warnings} source={null} />);
    expect(screen.getByTestId('warning-badge')).toHaveTextContent('1 alerta');
  });

  it('does not show badge when no WARN/ERROR warnings', () => {
    const warnings = [{ code: 'MISSING_SIGNAL', severity: 'INFO' as const }];
    render(<DashboardHeader header={header} warnings={warnings} source={null} />);
    expect(screen.queryByTestId('warning-badge')).not.toBeInTheDocument();
  });

  it('shows stale indicator when source is stale_fallback', () => {
    render(<DashboardHeader header={header} warnings={[]} source="stale_fallback" />);
    expect(screen.getByTestId('stale-indicator')).toBeInTheDocument();
  });
});
