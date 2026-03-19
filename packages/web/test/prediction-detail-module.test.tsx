import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DetailPanel } from '../src/components/DetailPanel.js';
import type { TeamDetailDTO } from '../src/types/team-detail.js';
import type { PredictionDTO, PredictionOutcomeDTO } from '../src/types/snapshot.js';

const basePrediction: PredictionDTO = {
  type: 'winner',
  label: 'FC Barcelona',
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

  it('con prediction → no renderiza match-estimate en PRE_MATCH (prediction va a PredictionExperimentalSection)', () => {
    // PRE_MATCH mueve el pronóstico a PredictionExperimentalSection (fetch a /api/ui/predictions/experimental).
    // El bloque match-estimate solo existe en IN_PLAY, PENDING_CONFIRMATION y FINISHED.
    render(<DetailPanel detail={makeDetail('SCHEDULED', basePrediction)} onClose={() => {}} />);
    expect(screen.queryByTestId('match-estimate')).toBeNull();
  });

  it('con prediction en IN_PROGRESS → renderiza módulo', () => {
    render(<DetailPanel detail={makeDetail('IN_PROGRESS', basePrediction)} onClose={() => {}} />);
    expect(screen.getByTestId('match-estimate')).toBeTruthy();
  });
});

describe('PredictionDetailModule — badges por estado', () => {
  it('SCHEDULED con predicción → no hay match-estimate (PRE_MATCH usa PredictionExperimentalSection)', () => {
    // En PRE_MATCH el componente no renderiza el bloque match-estimate inline.
    // La predicción se delega a PredictionExperimentalSection (fetch experimental).
    render(<DetailPanel detail={makeDetail('SCHEDULED', basePrediction, { status: 'pending' })} onClose={() => {}} />);
    expect(screen.queryByTestId('match-estimate')).toBeNull();
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

  it('SCHEDULED → no existe bloque match-estimate (PRE_MATCH no tiene resultado final)', () => {
    // En PRE_MATCH no hay match-estimate, por lo que tampoco hay "Resultado final".
    // Esto es consistente con el comportamiento actual del componente.
    render(<DetailPanel detail={makeDetail('SCHEDULED', basePrediction, { status: 'pending' })} onClose={() => {}} />);
    expect(screen.queryByTestId('match-estimate')).toBeNull();
  });
});

describe('PredictionDetailModule — label de predicción', () => {
  it('muestra el label de predicción en IN_PROGRESS', () => {
    // PRE_MATCH (SCHEDULED) ya no muestra match-estimate inline; usa PredictionExperimentalSection.
    // El bloque match-estimate en IN_PLAY muestra el label de la predicción.
    render(<DetailPanel detail={makeDetail('IN_PROGRESS', basePrediction)} onClose={() => {}} />);
    const el = screen.getByTestId('match-estimate');
    // El label del basePrediction es 'FC Barcelona'
    expect(el.textContent).toContain('FC Barcelona');
  });
});
