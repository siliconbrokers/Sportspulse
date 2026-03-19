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

  it('renders detail panel with team and match data', () => {
    render(<DetailPanel detail={detail} onClose={() => {}} />);
    expect(screen.getByTestId('detail-panel')).toBeInTheDocument();
    expect(screen.getAllByText('FC Barcelona').length).toBeGreaterThanOrEqual(1);
  });

  it('renders match estimate block when match is IN_PROGRESS with prediction', () => {
    // PRE_MATCH no longer renders a match-estimate block — prediction for upcoming matches
    // is handled by PredictionExperimentalSection (fetches /api/ui/predictions/experimental).
    // match-estimate is rendered for IN_PLAY, PENDING_CONFIRMATION, and FINISHED states only.
    const basePrediction = {
      type: 'winner' as const,
      label: 'FC Barcelona',
      value: { winner: 'DRAW' as const, probHome: 0.30, probDraw: 0.40, probAway: 0.30 },
      confidence: 'high' as const,
      generatedAt: '2026-03-04T11:00:00Z',
    };
    // Use a recent kickoff so uiState resolves to IN_PLAY
    const recentKickoff = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    const withPrediction: TeamDetailDTO = {
      ...detail,
      team: {
        ...detail.team,
        recentForm: ['W', 'W', 'W', 'D', 'L'],
        homeGoalStats: { goalsFor: 20, goalsAgainst: 8, goalDifference: 12, points: 30, playedGames: 10, lambdaAttack: 2.0, lambdaDefense: 0.8 },
      },
      nextMatch: {
        ...detail.nextMatch!,
        kickoffUtc: recentKickoff,
        matchStatus: 'IN_PROGRESS',
        prediction: basePrediction,
      },
    };
    render(<DetailPanel detail={withPrediction} onClose={() => {}} />);
    expect(screen.getByTestId('match-estimate')).toBeInTheDocument();
    // IN_PLAY renders the prediction label inside match-estimate
    expect(screen.getByTestId('match-estimate').textContent).toContain('FC Barcelona');
  });

  it('does not render match-estimate in PRE_MATCH (prediction handled by PredictionExperimentalSection)', () => {
    // Prediction for scheduled matches moved to PredictionExperimentalSection which
    // fetches from /api/ui/predictions/experimental and auto-hides when not available.
    const basePrediction = {
      type: 'winner' as const,
      label: 'FC Barcelona',
      value: { winner: 'HOME' as const, probHome: 0.45, probDraw: 0.30, probAway: 0.25 },
      confidence: 'medium' as const,
      generatedAt: '2026-03-04T11:00:00Z',
    };
    // Use a future kickoff so matchStatus SCHEDULED resolves to PRE_MATCH (not FINISHED heuristic)
    const futureKickoff = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const withForm: TeamDetailDTO = {
      ...detail,
      team: { ...detail.team, recentForm: ['W', 'D', 'L', 'W', 'D'] },
      nextMatch: {
        ...detail.nextMatch!,
        kickoffUtc: futureKickoff,
        matchStatus: 'SCHEDULED',
        opponentRecentForm: ['D', 'W', 'L', 'D', 'W'],
        prediction: basePrediction,
      },
    };
    render(<DetailPanel detail={withForm} onClose={() => {}} />);
    // PRE_MATCH does not render match-estimate block
    expect(screen.queryByTestId('match-estimate')).toBeNull();
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
