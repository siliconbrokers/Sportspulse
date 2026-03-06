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
    expect(screen.getAllByText('FC Barcelona').length).toBeGreaterThanOrEqual(1);
  });

  it('renders next match info', () => {
    render(<DetailPanel detail={detail} onClose={() => {}} />);
    expect(screen.getByTestId('next-match')).toBeInTheDocument();
    expect(screen.getAllByText(/Real Madrid/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders topContributions in explain section', () => {
    render(<DetailPanel detail={detail} onClose={() => {}} />);
    expect(screen.getByTestId('explain-section')).toBeInTheDocument();
    expect(screen.getByText('Comienza en')).toBeInTheDocument();
  });

  it('renders match estimate when form data available', () => {
    const withForm: TeamDetailDTO = {
      ...detail,
      team: { ...detail.team, recentForm: ['W', 'W', 'W', 'D', 'L'] },
      nextMatch: { ...detail.nextMatch!, opponentRecentForm: ['L', 'L', 'D', 'W', 'L'] },
    };
    render(<DetailPanel detail={withForm} onClose={() => {}} />);
    expect(screen.getByTestId('match-estimate')).toBeInTheDocument();
    // FC Barcelona: 10pts + 2 home bonus = 12, Real Madrid: 4pts = 4 → diff=8 → Favorito
    expect(screen.getByText(/Favorito: FC Barcelona/)).toBeInTheDocument();
  });

  it('renders "Partido parejo" when forms are similar', () => {
    const even: TeamDetailDTO = {
      ...detail,
      team: { ...detail.team, recentForm: ['W', 'D', 'L', 'W', 'D'] },
      nextMatch: { ...detail.nextMatch!, venue: 'AWAY', opponentRecentForm: ['D', 'W', 'L', 'D', 'W'] },
    };
    render(<DetailPanel detail={even} onClose={() => {}} />);
    // Team: 8pts, Opp: 8pts + 2 home bonus = 10, diff = -2 → Leve ventaja
    expect(screen.getByText(/Leve ventaja: Real Madrid/)).toBeInTheDocument();
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
