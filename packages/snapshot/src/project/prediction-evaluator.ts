import type { PredictionDTO, PredictionOutcomeDTO } from '../dto/team-score.js';

/**
 * Evaluates a PredictionDTO against the actual match result.
 * Applies deterministic rules per prediction type (spec §16).
 */
export function evaluatePrediction(
  prediction: PredictionDTO,
  matchStatus: string,
  scoreHome?: number | null,
  scoreAway?: number | null,
): PredictionOutcomeDTO {
  if (matchStatus === 'SCHEDULED') return { status: 'pending' };
  if (matchStatus === 'IN_PROGRESS') return { status: 'in_progress' };

  const now = new Date().toISOString();

  if (matchStatus !== 'FINISHED' || scoreHome == null || scoreAway == null) {
    return { status: 'not_evaluable', evaluatedAt: now };
  }

  const actualResult = { home: scoreHome, away: scoreAway };

  if (prediction.type === 'winner') {
    const val = prediction.value as { winner: 'HOME' | 'AWAY' | 'DRAW' };
    const actualWinner: 'HOME' | 'AWAY' | 'DRAW' =
      scoreHome > scoreAway ? 'HOME' : scoreAway > scoreHome ? 'AWAY' : 'DRAW';
    return {
      status: val.winner === actualWinner ? 'hit' : 'miss',
      evaluatedAt: now,
      actualResult,
    };
  }

  if (prediction.type === 'double_chance') {
    const val = prediction.value as string;
    const homeWon = scoreHome > scoreAway;
    const awayWon = scoreAway > scoreHome;
    const drew = scoreHome === scoreAway;
    let hit = false;
    if (val === 'HOME_OR_DRAW') hit = homeWon || drew;
    else if (val === 'AWAY_OR_DRAW') hit = awayWon || drew;
    else if (val === 'HOME_OR_AWAY') hit = homeWon || awayWon;
    return { status: hit ? 'hit' : 'miss', evaluatedAt: now, actualResult };
  }

  if (prediction.type === 'both_teams_score') {
    const val = prediction.value as unknown as boolean;
    const bothScored = scoreHome > 0 && scoreAway > 0;
    return {
      status: val === bothScored ? 'hit' : 'miss',
      evaluatedAt: now,
      actualResult,
    };
  }

  if (prediction.type === 'over_under') {
    const val = prediction.value as { direction: 'over' | 'under'; threshold: number };
    const total = scoreHome + scoreAway;
    const hit = val.direction === 'over' ? total > val.threshold : total < val.threshold;
    return { status: hit ? 'hit' : 'miss', evaluatedAt: now, actualResult };
  }

  if (prediction.type === 'exact_score') {
    const val = prediction.value as { home: number; away: number };
    const hit = val.home === scoreHome && val.away === scoreAway;
    return { status: hit ? 'hit' : 'miss', evaluatedAt: now, actualResult };
  }

  return { status: 'not_evaluable', evaluatedAt: now, actualResult };
}
