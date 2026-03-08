import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DetailPanel } from '../src/components/DetailPanel.js';
import type { TeamDetailDTO } from '../src/types/team-detail.js';
import type { PredictionDTO, PredictionOutcomeDTO } from '../src/types/snapshot.js';

const basePrediction: PredictionDTO = {
  type: 'winner',
  label: 'Ganador: FC Barcelona',
  value: { winner: 'HOME', probHome: 0.55, probDraw: 0.25, probAway: 0.20 },
  confidence: 'high',
  generatedAt: '2026-03-04T11:00:00Z',
};

function makeDetail(
  matchStatus: string,
  prediction?: PredictionDTO,
  predictionOutcome?: PredictionOutcomeDTO,
): TeamDetailDTO {
  return {
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
      matchStatus,
      prediction,
      predictionOutcome,
    },
    explainability: { topContributions: [] },
  };
}

describe('PredictionDetailModule — visibility', () => {
  it('sin prediction → no renderiza módulo', () => {
    render(<DetailPanel detail={makeDetail('SCHEDULED')} onClose={() => {}} />);
    expect(screen.queryByTestId('match-estimate')).toBeNull();
  });

  it('con prediction → renderiza módulo', () => {
    render(<DetailPanel detail={makeDetail('SCHEDULED', basePrediction)} onClose={() => {}} />);
    expect(screen.getByTestId('match-estimate')).toBeTruthy();
  });
});

describe('PredictionDetailModule — badges por estado', () => {
  it('SCHEDULED → badge "Pendiente"', () => {
    render(<DetailPanel detail={makeDetail('SCHEDULED', basePrediction, { status: 'pending' })} onClose={() => {}} />);
    expect(screen.getByTestId('match-estimate').textContent).toContain('Pendiente');
  });

  it('IN_PROGRESS → badge "En juego"', () => {
    render(<DetailPanel detail={makeDetail('IN_PROGRESS', basePrediction, { status: 'in_progress' })} onClose={() => {}} />);
    expect(screen.getByTestId('match-estimate').textContent).toContain('En juego');
  });

  it('FINISHED + hit → badge "Acertado"', () => {
    const outcome: PredictionOutcomeDTO = { status: 'hit', evaluatedAt: '2026-03-06T22:00:00Z', actualResult: { home: 2, away: 1 } };
    render(<DetailPanel detail={makeDetail('FINISHED', basePrediction, outcome)} onClose={() => {}} />);
    expect(screen.getByTestId('match-estimate').textContent).toContain('Acertado');
  });

  it('FINISHED + miss → badge "Fallado"', () => {
    const outcome: PredictionOutcomeDTO = { status: 'miss', evaluatedAt: '2026-03-06T22:00:00Z', actualResult: { home: 0, away: 2 } };
    render(<DetailPanel detail={makeDetail('FINISHED', basePrediction, outcome)} onClose={() => {}} />);
    expect(screen.getByTestId('match-estimate').textContent).toContain('Fallado');
  });

  it('FINISHED + not_evaluable → badge "No evaluable"', () => {
    const outcome: PredictionOutcomeDTO = { status: 'not_evaluable' };
    render(<DetailPanel detail={makeDetail('FINISHED', basePrediction, outcome)} onClose={() => {}} />);
    expect(screen.getByTestId('match-estimate').textContent).toContain('No evaluable');
  });
});

describe('PredictionDetailModule — resultado final', () => {
  it('FINISHED + actualResult → muestra resultado', () => {
    const outcome: PredictionOutcomeDTO = { status: 'hit', actualResult: { home: 2, away: 1 } };
    render(<DetailPanel detail={makeDetail('FINISHED', basePrediction, outcome)} onClose={() => {}} />);
    expect(screen.getByTestId('match-estimate').textContent).toContain('2 – 1');
  });

  it('SCHEDULED → no muestra resultado final', () => {
    render(<DetailPanel detail={makeDetail('SCHEDULED', basePrediction, { status: 'pending' })} onClose={() => {}} />);
    expect(screen.getByTestId('match-estimate').textContent).not.toContain('Resultado final');
  });
});

describe('PredictionDetailModule — label de predicción', () => {
  it('muestra el label de la predicción', () => {
    render(<DetailPanel detail={makeDetail('SCHEDULED', basePrediction)} onClose={() => {}} />);
    expect(screen.getByTestId('match-estimate').textContent).toContain('Ganador: FC Barcelona');
  });
});
