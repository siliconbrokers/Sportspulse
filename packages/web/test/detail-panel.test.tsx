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

  it('renders match estimate with probabilities when form data available', () => {
    const basePrediction = {
      type: 'winner' as const,
      label: 'Ganador: FC Barcelona',
      value: { winner: 'HOME' as const, probHome: 0.55, probDraw: 0.25, probAway: 0.20 },
      confidence: 'high' as const,
      generatedAt: '2026-03-04T11:00:00Z',
    };
    const withForm: TeamDetailDTO = {
      ...detail,
      team: {
        ...detail.team,
        recentForm: ['W', 'W', 'W', 'D', 'L'],
        homeGoalStats: { goalsFor: 20, goalsAgainst: 8, goalDifference: 12, points: 30, playedGames: 10, lambdaAttack: 2.0, lambdaDefense: 0.8 },
      },
      nextMatch: {
        ...detail.nextMatch!,
        opponentRecentForm: ['L', 'L', 'D', 'W', 'L'],
        opponentAwayGoalStats: { goalsFor: 10, goalsAgainst: 15, goalDifference: -5, points: 10, playedGames: 8, lambdaAttack: 1.2, lambdaDefense: 1.9 },
        prediction: basePrediction,
      },
    };
    render(<DetailPanel detail={withForm} onClose={() => {}} />);
    expect(screen.getByTestId('match-estimate')).toBeInTheDocument();
    expect(screen.getByText('Empate')).toBeInTheDocument();
  });

  it('renders match estimate based on form only when no venue stats', () => {
    const basePrediction = {
      type: 'winner' as const,
      label: 'Ganador: FC Barcelona',
      value: { winner: 'HOME' as const, probHome: 0.45, probDraw: 0.30, probAway: 0.25 },
      confidence: 'medium' as const,
      generatedAt: '2026-03-04T11:00:00Z',
    };
    const withForm: TeamDetailDTO = {
      ...detail,
      team: { ...detail.team, recentForm: ['W', 'D', 'L', 'W', 'D'] },
      nextMatch: { ...detail.nextMatch!, venue: 'AWAY', opponentRecentForm: ['D', 'W', 'L', 'D', 'W'], prediction: basePrediction },
    };
    render(<DetailPanel detail={withForm} onClose={() => {}} />);
    expect(screen.getByTestId('match-estimate')).toBeInTheDocument();
    expect(screen.getByText('Empate')).toBeInTheDocument();
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
