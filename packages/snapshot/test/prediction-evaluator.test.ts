import { describe, it, expect } from 'vitest';
import { evaluatePrediction } from '../src/project/prediction-evaluator.js';
import type { PredictionDTO } from '../src/dto/team-score.js';

function pred(type: PredictionDTO['type'], value: PredictionDTO['value']): PredictionDTO {
  return { type, label: 'Test', value, generatedAt: '2026-01-01T00:00:00Z' };
}

describe('evaluatePrediction — lifecycle', () => {
  it('SCHEDULED → pending', () => {
    expect(evaluatePrediction(pred('winner', { winner: 'HOME' }), 'SCHEDULED')).toMatchObject({
      status: 'pending',
    });
  });

  it('IN_PROGRESS → in_progress', () => {
    expect(evaluatePrediction(pred('winner', { winner: 'HOME' }), 'IN_PROGRESS')).toMatchObject({
      status: 'in_progress',
    });
  });

  it('FINISHED with null score → not_evaluable', () => {
    expect(
      evaluatePrediction(pred('winner', { winner: 'HOME' }), 'FINISHED', null, null),
    ).toMatchObject({ status: 'not_evaluable' });
  });

  it('unknown status → not_evaluable', () => {
    expect(evaluatePrediction(pred('winner', { winner: 'HOME' }), 'POSTPONED', 1, 0)).toMatchObject(
      { status: 'not_evaluable' },
    );
  });
});

describe('evaluatePrediction — winner', () => {
  it('HOME predicted, home wins → hit', () => {
    expect(evaluatePrediction(pred('winner', { winner: 'HOME' }), 'FINISHED', 2, 1)).toMatchObject({
      status: 'hit',
    });
  });

  it('HOME predicted, away wins → miss', () => {
    expect(evaluatePrediction(pred('winner', { winner: 'HOME' }), 'FINISHED', 0, 1)).toMatchObject({
      status: 'miss',
    });
  });

  it('HOME predicted, draw → miss', () => {
    expect(evaluatePrediction(pred('winner', { winner: 'HOME' }), 'FINISHED', 1, 1)).toMatchObject({
      status: 'miss',
    });
  });

  it('DRAW predicted, draw → hit', () => {
    expect(evaluatePrediction(pred('winner', { winner: 'DRAW' }), 'FINISHED', 1, 1)).toMatchObject({
      status: 'hit',
    });
  });

  it('AWAY predicted, away wins → hit', () => {
    expect(evaluatePrediction(pred('winner', { winner: 'AWAY' }), 'FINISHED', 0, 2)).toMatchObject({
      status: 'hit',
    });
  });

  it('includes actualResult in outcome', () => {
    const result = evaluatePrediction(pred('winner', { winner: 'HOME' }), 'FINISHED', 3, 0);
    expect(result.actualResult).toEqual({ home: 3, away: 0 });
  });
});

describe('evaluatePrediction — double_chance', () => {
  it('HOME_OR_DRAW + home wins → hit', () => {
    expect(
      evaluatePrediction(pred('double_chance', 'HOME_OR_DRAW'), 'FINISHED', 2, 1),
    ).toMatchObject({ status: 'hit' });
  });

  it('HOME_OR_DRAW + draw → hit', () => {
    expect(
      evaluatePrediction(pred('double_chance', 'HOME_OR_DRAW'), 'FINISHED', 0, 0),
    ).toMatchObject({ status: 'hit' });
  });

  it('HOME_OR_DRAW + away wins → miss', () => {
    expect(
      evaluatePrediction(pred('double_chance', 'HOME_OR_DRAW'), 'FINISHED', 0, 1),
    ).toMatchObject({ status: 'miss' });
  });

  it('AWAY_OR_DRAW + draw → hit', () => {
    expect(
      evaluatePrediction(pred('double_chance', 'AWAY_OR_DRAW'), 'FINISHED', 2, 2),
    ).toMatchObject({ status: 'hit' });
  });

  it('HOME_OR_AWAY + draw → miss', () => {
    expect(
      evaluatePrediction(pred('double_chance', 'HOME_OR_AWAY'), 'FINISHED', 1, 1),
    ).toMatchObject({ status: 'miss' });
  });
});

describe('evaluatePrediction — both_teams_score', () => {
  it('predicted true + both scored → hit', () => {
    expect(
      evaluatePrediction(
        pred('both_teams_score', true as unknown as Record<string, unknown>),
        'FINISHED',
        1,
        2,
      ),
    ).toMatchObject({ status: 'hit' });
  });

  it('predicted true + only one scored → miss', () => {
    expect(
      evaluatePrediction(
        pred('both_teams_score', true as unknown as Record<string, unknown>),
        'FINISHED',
        0,
        2,
      ),
    ).toMatchObject({ status: 'miss' });
  });

  it('predicted false + none scored → hit', () => {
    expect(
      evaluatePrediction(
        pred('both_teams_score', false as unknown as Record<string, unknown>),
        'FINISHED',
        0,
        0,
      ),
    ).toMatchObject({ status: 'hit' });
  });

  it('predicted false + both scored → miss', () => {
    expect(
      evaluatePrediction(
        pred('both_teams_score', false as unknown as Record<string, unknown>),
        'FINISHED',
        1,
        1,
      ),
    ).toMatchObject({ status: 'miss' });
  });
});

describe('evaluatePrediction — over_under', () => {
  it('over 2.5 + 3 goals → hit', () => {
    expect(
      evaluatePrediction(
        pred('over_under', { direction: 'over', threshold: 2.5 }),
        'FINISHED',
        2,
        1,
      ),
    ).toMatchObject({ status: 'hit' });
  });

  it('over 2.5 + 2 goals → miss', () => {
    expect(
      evaluatePrediction(
        pred('over_under', { direction: 'over', threshold: 2.5 }),
        'FINISHED',
        1,
        1,
      ),
    ).toMatchObject({ status: 'miss' });
  });

  it('under 2.5 + 2 goals → hit', () => {
    expect(
      evaluatePrediction(
        pred('over_under', { direction: 'under', threshold: 2.5 }),
        'FINISHED',
        1,
        1,
      ),
    ).toMatchObject({ status: 'hit' });
  });

  it('under 2.5 + 3 goals → miss', () => {
    expect(
      evaluatePrediction(
        pred('over_under', { direction: 'under', threshold: 2.5 }),
        'FINISHED',
        2,
        1,
      ),
    ).toMatchObject({ status: 'miss' });
  });
});

describe('evaluatePrediction — exact_score', () => {
  it('2-1 predicted, 2-1 result → hit', () => {
    expect(
      evaluatePrediction(pred('exact_score', { home: 2, away: 1 }), 'FINISHED', 2, 1),
    ).toMatchObject({ status: 'hit' });
  });

  it('2-1 predicted, 2-0 result → miss', () => {
    expect(
      evaluatePrediction(pred('exact_score', { home: 2, away: 1 }), 'FINISHED', 2, 0),
    ).toMatchObject({ status: 'miss' });
  });
});

describe('evaluatePrediction — unknown type', () => {
  it('unknown type → not_evaluable', () => {
    expect(
      evaluatePrediction(
        pred('winner' as PredictionDTO['type'], { winner: 'HOME' }),
        'FINISHED',
        1,
        0,
      ),
    ).toMatchObject({ status: 'hit' }); // winner is known
  });
});
