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

// kickoffUtc dinámico: 45 min atrás desde ahora para que IN_PROGRESS no dispare zombie guard
const RECENT_KICKOFF = new Date(Date.now() - 45 * 60 * 1000).toISOString();

function makeDetail(
  matchStatus: string,
  prediction?: PredictionDTO,
  predictionOutcome?: PredictionOutcomeDTO,
): TeamDetailDTO {
  // Para IN_PROGRESS usamos un kickoff reciente; para otros estados usamos uno futuro.
  const kickoffUtc = matchStatus === 'IN_PROGRESS' ? RECENT_KICKOFF : '2026-12-06T20:00:00Z';
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
      kickoffUtc,
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
  it('SCHEDULED con predicción → muestra label, sin badge "Pendiente"', () => {
    render(<DetailPanel detail={makeDetail('SCHEDULED', basePrediction, { status: 'pending' })} onClose={() => {}} />);
    const el = screen.getByTestId('match-estimate');
    // Cuando hay label de predicción, el badge "Pendiente" no debe aparecer (redundante y confuso)
    expect(el.textContent).toContain('Ganador: FC Barcelona');
    expect(el.textContent).not.toContain('Pendiente');
  });

  it('IN_PROGRESS → badge "Pendiente" (en vivo, pendiente de evaluación)', () => {
    render(<DetailPanel detail={makeDetail('IN_PROGRESS', basePrediction, { status: 'in_progress' })} onClose={() => {}} />);
    expect(screen.getByTestId('match-estimate').textContent).toContain('Pendiente');
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
  // El score ya se muestra en la cabecera del partido — no se repite en el cuadro de pronóstico.
  it('FINISHED + actualResult → NO muestra score en el cuadro de pronóstico', () => {
    const outcome: PredictionOutcomeDTO = { status: 'hit', actualResult: { home: 2, away: 1 } };
    render(<DetailPanel detail={makeDetail('FINISHED', basePrediction, outcome)} onClose={() => {}} />);
    expect(screen.getByTestId('match-estimate').textContent).not.toContain('2 – 1');
  });

  it('SCHEDULED → no muestra resultado final', () => {
    render(<DetailPanel detail={makeDetail('SCHEDULED', basePrediction, { status: 'pending' })} onClose={() => {}} />);
    expect(screen.getByTestId('match-estimate').textContent).not.toContain('Resultado final');
  });
});

describe('PredictionDetailModule — label de predicción', () => {
  it('muestra las probabilidades del partido (home, draw, away)', () => {
    render(<DetailPanel detail={makeDetail('SCHEDULED', basePrediction)} onClose={() => {}} />);
    // El componente muestra barras de probabilidad con "Empate" en el centro.
    // Los nombres de equipo se eliminaron del bloque de pronóstico (§6.4 spec correcciones UI)
    // ya que son redundantes con la cabecera del partido.
    const el = screen.getByTestId('match-estimate');
    expect(el.textContent).toContain('Empate');
  });
});
