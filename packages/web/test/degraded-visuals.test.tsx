import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WarningBanner } from '../src/components/WarningBanner.js';
import { LoadingSkeleton } from '../src/components/LoadingSkeleton.js';
import { EmptyState } from '../src/components/EmptyState.js';
import { ErrorState } from '../src/components/ErrorState.js';

describe('WarningBanner (H-03)', () => {
  it('renders correct text for STALE_DATA', () => {
    const warnings = [{ code: 'STALE_DATA', severity: 'WARN' as const }];
    render(<WarningBanner warnings={warnings} />);
    expect(screen.getByTestId('warning-banner')).toHaveTextContent('Data may be outdated');
  });

  it('renders LAYOUT_DEGRADED warning', () => {
    const warnings = [{ code: 'LAYOUT_DEGRADED', severity: 'WARN' as const }];
    render(<WarningBanner warnings={warnings} />);
    expect(screen.getByTestId('warning-banner')).toHaveTextContent('Layout in fallback mode');
  });

  it('does not render when only INFO warnings', () => {
    const warnings = [{ code: 'MISSING_SIGNAL', severity: 'INFO' as const }];
    render(<WarningBanner warnings={warnings} />);
    expect(screen.queryByTestId('warning-banner')).not.toBeInTheDocument();
  });
});

describe('LoadingSkeleton', () => {
  it('shows skeleton during loading', () => {
    render(<LoadingSkeleton width={800} height={600} />);
    expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('shows message when no teams', () => {
    render(<EmptyState />);
    expect(screen.getByTestId('empty-state')).toHaveTextContent('No teams available');
  });
});

describe('ErrorState', () => {
  it('shows error message and retry button', () => {
    render(<ErrorState message="Service temporarily unavailable" onRetry={() => {}} />);
    expect(screen.getByTestId('error-state')).toHaveTextContent('Service temporarily unavailable');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
