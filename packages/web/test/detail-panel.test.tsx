import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DetailPanel } from '../src/components/DetailPanel.js';
import type { TeamDetailDTO } from '../src/types/team-detail.js';

const detail: TeamDetailDTO = {
  header: {
    competitionId: 'comp:test',
    seasonId: 'season:2025',
    dateLocal: '2026-03-04',
    timezone: 'Europe/Madrid',
    policyKey: 'test',
    policyVersion: 1,
    buildNowUtc: '2026-03-04T11:00:00Z',
    computedAtUtc: '2026-03-04T11:00:01Z',
    warnings: [],
  },
  team: { teamId: 'team:1', teamName: 'FC Barcelona' },
  score: { rawScore: 75, attentionScore: 80, displayScore: 85, layoutWeight: 0.3 },
  nextMatch: {
    matchId: 'm1',
    kickoffUtc: '2026-03-06T20:00:00Z',
    opponentName: 'Real Madrid',
    venue: 'HOME',
  },
  explainability: {
    topContributions: [
      { signalKey: 'FORM_POINTS_LAST_5', rawValue: 10, normValue: 0.8, weight: 0.6, contribution: 6 },
      { signalKey: 'NEXT_MATCH_HOURS', rawValue: 5, normValue: 0.5, weight: 0.4, contribution: 2 },
    ],
  },
};

describe('DetailPanel', () => {
  it('renders team name from TeamDetailDTO (H-02)', () => {
    render(<DetailPanel detail={detail} onClose={() => {}} />);
    expect(screen.getByText('FC Barcelona')).toBeInTheDocument();
  });

  it('renders next match info', () => {
    render(<DetailPanel detail={detail} onClose={() => {}} />);
    expect(screen.getByTestId('next-match')).toBeInTheDocument();
    expect(screen.getByText(/Real Madrid/)).toBeInTheDocument();
  });

  it('renders topContributions in explain section', () => {
    render(<DetailPanel detail={detail} onClose={() => {}} />);
    expect(screen.getByTestId('explain-section')).toBeInTheDocument();
    expect(screen.getByText('Forma (últimos 5)')).toBeInTheDocument();
    expect(screen.getByText('Horas al próximo partido')).toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<DetailPanel detail={detail} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    render(<DetailPanel detail={detail} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('close-detail'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
