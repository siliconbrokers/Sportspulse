import type { GoalStatsDTO, PredictionDTO } from '../dto/team-score.js';

const MIN_GAMES = 3;
const MAX_GOALS = 7;
const DC_RHO = -0.13;
const HOME_ADVANTAGE = 1.15;
/** Predict DRAW when probDraw ≥ threshold AND ≥ ratio × max(probHome, probAway). */
const DRAW_THRESHOLD = 0.31;
const DRAW_RATIO = 0.75;

/** P(X = k) for Poisson distribution with mean λ */
function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/**
 * Dixon-Coles τ correction factor for low-scoring scorelines.
 * Corrects the systematic under-prediction of 0-0, 1-0, 0-1, 1-1.
 * ρ ≈ -0.13 (empirically validated in the original D-C paper).
 */
function tau(h: number, a: number, lh: number, la: number, rho: number): number {
  if (h === 0 && a === 0) return 1 - lh * la * rho;
  if (h === 0 && a === 1) return 1 + lh * rho;
  if (h === 1 && a === 0) return 1 + la * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

interface MatchProbs {
  homeWin: number;
  draw: number;
  awayWin: number;
}

function computeProbs(
  isHome: boolean,
  teamHomeGS: GoalStatsDTO | undefined,
  teamAwayGS: GoalStatsDTO | undefined,
  teamGS: GoalStatsDTO | undefined,
  oppHomeGS: GoalStatsDTO | undefined,
  oppAwayGS: GoalStatsDTO | undefined,
  oppGS: GoalStatsDTO | undefined,
): MatchProbs | null {
  // Use venue-specific stats when enough games played, fall back to season totals
  const teamVenueGS = isHome
    ? teamHomeGS && teamHomeGS.playedGames >= MIN_GAMES
      ? teamHomeGS
      : teamGS
    : teamAwayGS && teamAwayGS.playedGames >= MIN_GAMES
      ? teamAwayGS
      : teamGS;

  const oppVenueGS = isHome
    ? oppAwayGS && oppAwayGS.playedGames >= MIN_GAMES
      ? oppAwayGS
      : oppGS
    : oppHomeGS && oppHomeGS.playedGames >= MIN_GAMES
      ? oppHomeGS
      : oppGS;

  if (
    !teamVenueGS ||
    teamVenueGS.playedGames < MIN_GAMES ||
    !oppVenueGS ||
    oppVenueGS.playedGames < MIN_GAMES
  ) {
    return null;
  }

  const lambdaTeam = (teamVenueGS.lambdaAttack + oppVenueGS.lambdaDefense) / 2;
  const lambdaOpp = (oppVenueGS.lambdaAttack + teamVenueGS.lambdaDefense) / 2;

  // Detect whether each side used venue-split stats (home advantage already captured)
  // or fell back to season totals (home advantage must be applied explicitly)
  const teamUsedVenueSplit = isHome
    ? !!(teamHomeGS && teamHomeGS.playedGames >= MIN_GAMES)
    : !!(teamAwayGS && teamAwayGS.playedGames >= MIN_GAMES);
  const oppUsedVenueSplit = isHome
    ? !!(oppAwayGS && oppAwayGS.playedGames >= MIN_GAMES)
    : !!(oppHomeGS && oppHomeGS.playedGames >= MIN_GAMES);

  let lambdaHome = isHome ? lambdaTeam : lambdaOpp;
  let lambdaAway = isHome ? lambdaOpp : lambdaTeam;
  if (!teamUsedVenueSplit || !oppUsedVenueSplit) {
    lambdaHome *= HOME_ADVANTAGE;
  }

  let pHomeWin = 0,
    pDraw = 0,
    pAwayWin = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    const ph = poissonPmf(lambdaHome, h);
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = ph * poissonPmf(lambdaAway, a) * tau(h, a, lambdaHome, lambdaAway, DC_RHO);
      if (h > a) pHomeWin += p;
      else if (h === a) pDraw += p;
      else pAwayWin += p;
    }
  }

  const total = pHomeWin + pDraw + pAwayWin || 1;
  return {
    homeWin: pHomeWin / total,
    draw: pDraw / total,
    awayWin: pAwayWin / total,
  };
}

/**
 * Builds a PredictionDTO (type='winner') using Poisson+Dixon-Coles.
 * Returns undefined when there are insufficient stats (< MIN_GAMES played).
 */
export function buildPrediction(
  isHome: boolean,
  teamName: string,
  opponentName: string,
  teamHomeGS: GoalStatsDTO | undefined,
  teamAwayGS: GoalStatsDTO | undefined,
  teamGS: GoalStatsDTO | undefined,
  oppHomeGS: GoalStatsDTO | undefined,
  oppAwayGS: GoalStatsDTO | undefined,
  oppGS: GoalStatsDTO | undefined,
  generatedAt: string,
): PredictionDTO | undefined {
  const probs = computeProbs(isHome, teamHomeGS, teamAwayGS, teamGS, oppHomeGS, oppAwayGS, oppGS);
  if (!probs) return undefined;

  let winner: 'HOME' | 'AWAY' | 'DRAW';
  let label: string;

  const maxOther = Math.max(probs.homeWin, probs.awayWin);
  if (probs.draw >= DRAW_THRESHOLD && probs.draw >= maxOther * DRAW_RATIO) {
    winner = 'DRAW';
    label = 'Empate favorecido';
  } else if (probs.homeWin >= probs.awayWin) {
    winner = 'HOME';
    label = `Ganador: ${isHome ? teamName : opponentName}`;
  } else {
    winner = 'AWAY';
    label = `Ganador: ${isHome ? opponentName : teamName}`;
  }

  // Confidence based on margin over second-best outcome
  const sorted = [probs.homeWin, probs.draw, probs.awayWin].sort((a, b) => b - a);
  const margin = sorted[0] - sorted[1];
  const confidence: 'high' | 'medium' | 'low' =
    margin > 0.2 ? 'high' : margin > 0.1 ? 'medium' : 'low';

  return {
    type: 'winner',
    label,
    value: {
      winner,
      probHome: probs.homeWin,
      probDraw: probs.draw,
      probAway: probs.awayWin,
    },
    confidence,
    generatedAt,
  };
}
