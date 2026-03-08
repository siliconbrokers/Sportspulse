/**
 * MatchDetailViewModel normalizer.
 * Maps TeamDetailDTO → MatchDetailViewModel per match-detail-card-update-spec-v1.
 *
 * Responsibility: derive uiState, prediction evaluation, narrative tags,
 * and pre/post-match readings — all deterministically, without ad-hoc logic
 * in the rendering component.
 */
import type { TeamDetailDTO } from '../types/team-detail.js';
import type { PredictionDTO } from '../types/snapshot.js';

// ── Types (§14) ───────────────────────────────────────────────────────────────

export type MatchDetailUiState = 'PRE_MATCH' | 'IN_PLAY' | 'FINISHED' | 'UNKNOWN';

/** Minimum v1 event shape (§10). Events block hidden when array is empty. */
export type MatchEvent = {
  id: string;
  teamSide: 'HOME' | 'AWAY';
  type: 'GOAL' | 'PENALTY_GOAL' | 'OWN_GOAL' | 'RED_CARD' | 'MISSED_PENALTY';
  minute: number;
  extraMinute?: number;
  playerName?: string;
};

export interface MatchDetailViewModel {
  matchId: string;
  uiState: MatchDetailUiState;

  // Header (§6) — always stable
  competitionId: string;
  matchday?: number;
  utcDate: string;
  venueName?: string;

  homeTeam: { id: string; name: string; crest?: string; coachName?: string };
  awayTeam: { id: string; name: string; crest?: string; coachName?: string };

  score: { home?: number | null; away?: number | null };

  // Pre-match (§7)
  prediction?: {
    label: string;
    expectedWinner?: 'HOME' | 'DRAW' | 'AWAY';
    homeProbability?: number;
    drawProbability?: number;
    awayProbability?: number;
    confidence?: string | null;
    /** Raw outcome status — used for badge rendering ('pending'|'in_progress'|'hit'|'miss'|'not_evaluable'). */
    outcomeStatus?: string;
    // Post-match evaluation fields (§11)
    actualWinner?: 'HOME' | 'DRAW' | 'AWAY';
    result?: 'HIT' | 'MISS';
    deviation?: 'LOW' | 'MEDIUM' | 'HIGH';
    narrativeTag?: string;
  };

  form?: {
    home: string[];
    away: string[];
  };

  /** Always empty in v1 — no event data in current DTO (§10 fallback: hide block). */
  events: MatchEvent[];

  /** Short pre-match summary (§7.3) — template-driven, never hand-written. */
  preMatchReading?: string;

  /** Short post-match closing sentence (§8.4). */
  postMatchReading?: string;
}

// ── uiState derivation (§4) ───────────────────────────────────────────────────

function deriveUiState(matchStatus?: string): MatchDetailUiState {
  switch (matchStatus) {
    case 'SCHEDULED':
    case 'POSTPONED':
    case 'CANCELED':
      return 'PRE_MATCH';
    case 'IN_PROGRESS':
      return 'IN_PLAY';
    case 'FINISHED':
      return 'FINISHED';
    default:
      return 'UNKNOWN';
  }
}

// ── Actual winner from score (§11) ────────────────────────────────────────────

function deriveActualWinner(
  scoreHome?: number | null,
  scoreAway?: number | null,
): 'HOME' | 'DRAW' | 'AWAY' | undefined {
  if (scoreHome == null || scoreAway == null) return undefined;
  if (scoreHome > scoreAway) return 'HOME';
  if (scoreHome < scoreAway) return 'AWAY';
  return 'DRAW';
}

// ── Prediction expected winner from PredictionDTO (§11) ───────────────────────

function deriveExpectedWinner(prediction?: PredictionDTO): 'HOME' | 'DRAW' | 'AWAY' | undefined {
  if (!prediction || prediction.type !== 'winner') return undefined;
  const v = prediction.value as { winner?: string } | null;
  const w = v?.winner;
  if (w === 'HOME' || w === 'AWAY' || w === 'DRAW') return w;
  return undefined;
}

// ── Prediction probabilities from PredictionDTO ───────────────────────────────

function deriveProbs(prediction?: PredictionDTO) {
  if (
    !prediction ||
    prediction.type !== 'winner' ||
    typeof prediction.value !== 'object' ||
    !prediction.value
  ) {
    return null;
  }
  const v = prediction.value as { probHome?: number; probDraw?: number; probAway?: number };
  return { probHome: v.probHome, probDraw: v.probDraw, probAway: v.probAway };
}

// ── Deviation (§11) — deterministic from probability of actual outcome ────────
// "LOW": high-prob outcome happened (unsurprising)
// "HIGH": low-prob outcome happened (surprise)

function computeDeviation(
  probs: { probHome?: number; probDraw?: number; probAway?: number } | null,
  actualWinner?: 'HOME' | 'DRAW' | 'AWAY',
): 'LOW' | 'MEDIUM' | 'HIGH' | undefined {
  if (!probs || !actualWinner) return undefined;
  const prob =
    actualWinner === 'HOME'
      ? probs.probHome
      : actualWinner === 'AWAY'
        ? probs.probAway
        : probs.probDraw;
  if (prob == null) return undefined;
  if (prob > 0.55) return 'LOW';
  if (prob > 0.35) return 'MEDIUM';
  return 'HIGH';
}

// ── Narrative tag (§11) — deterministic mapper ────────────────────────────────

function computeNarrativeTag(
  expectedWinner?: 'HOME' | 'DRAW' | 'AWAY',
  actualWinner?: 'HOME' | 'DRAW' | 'AWAY',
  deviation?: 'LOW' | 'MEDIUM' | 'HIGH',
): string | undefined {
  if (!expectedWinner || !actualWinner) return undefined;
  if (expectedWinner === actualWinner) {
    return deviation === 'LOW' ? 'LOGICAL_RESULT' : 'MORE_BALANCED_THAN_EXPECTED';
  }
  return deviation === 'HIGH' ? 'SURPRISE' : 'MORE_OPEN_THAN_EXPECTED';
}

// ── Pre-match reading (§7.3) — template-driven ────────────────────────────────

function buildPreMatchReading(
  prediction?: PredictionDTO,
  homeTeamName?: string,
  awayTeamName?: string,
): string | undefined {
  if (!prediction) return undefined;
  const probs = deriveProbs(prediction);
  const expectedWinner = deriveExpectedWinner(prediction);
  if (!probs || !expectedWinner) return undefined;

  const winnerName =
    expectedWinner === 'HOME' ? homeTeamName : expectedWinner === 'AWAY' ? awayTeamName : null;

  const confLabel =
    prediction.confidence === 'high'
      ? 'Confianza alta.'
      : prediction.confidence === 'medium'
        ? 'Confianza media.'
        : 'Confianza baja.';

  return winnerName
    ? `Favorito: ${winnerName}. ${confLabel}`
    : `Se espera un partido equilibrado. ${confLabel}`;
}

// ── Post-match reading (§8.4) — template-driven ───────────────────────────────

const NARRATIVE_LABELS: Record<string, string> = {
  LOGICAL_RESULT: 'Resultado lógico.',
  SURPRISE: 'Resultado sorpresivo.',
  MORE_BALANCED_THAN_EXPECTED: 'Más equilibrado de lo esperado.',
  MORE_OPEN_THAN_EXPECTED: 'Más abierto de lo esperado.',
};

function buildPostMatchReading(result?: 'HIT' | 'MISS', narrativeTag?: string): string | undefined {
  const r =
    result === 'HIT' ? 'El pronóstico acertó.' : result === 'MISS' ? 'El pronóstico falló.' : null;
  const tag = narrativeTag ? (NARRATIVE_LABELS[narrativeTag] ?? null) : null;
  if (r && tag) return `${r} ${tag}`;
  return r ?? tag ?? undefined;
}

// ── Main builder (§14) ────────────────────────────────────────────────────────

export function buildMatchDetailViewModel(detail: TeamDetailDTO): MatchDetailViewModel {
  const nm = detail.nextMatch;
  const isHome = nm?.venue === 'HOME';

  // Resolve home/away identity from the team's perspective
  const homeTeamName = isHome ? detail.team.teamName : (nm?.opponentName ?? 'Local');
  const awayTeamName = isHome ? (nm?.opponentName ?? 'Visitante') : detail.team.teamName;
  const homeTeamCrest = isHome ? detail.team.crestUrl : nm?.opponentCrestUrl;
  const awayTeamCrest = isHome ? nm?.opponentCrestUrl : detail.team.crestUrl;
  const homeCoachName = isHome ? detail.team.coachName : nm?.opponentCoachName;
  const awayCoachName = isHome ? nm?.opponentCoachName : detail.team.coachName;
  const homeTeamId = isHome ? detail.team.teamId : (nm?.opponentTeamId ?? '');
  const awayTeamId = isHome ? (nm?.opponentTeamId ?? '') : detail.team.teamId;

  const uiState = deriveUiState(nm?.matchStatus);

  // Prediction
  const rawPrediction = nm?.prediction;
  const probs = deriveProbs(rawPrediction);
  const expectedWinner = deriveExpectedWinner(rawPrediction);
  const actualWinner = deriveActualWinner(nm?.scoreHome, nm?.scoreAway);

  // Prediction result: derive from predictionOutcome, v1 only HIT/MISS (§11)
  const outcomeStatus = nm?.predictionOutcome?.status;
  const predictionResult: 'HIT' | 'MISS' | undefined =
    outcomeStatus === 'hit' ? 'HIT' : outcomeStatus === 'miss' ? 'MISS' : undefined;

  const deviation = computeDeviation(probs, actualWinner);
  const narrativeTag = computeNarrativeTag(expectedWinner, actualWinner, deviation);

  const prediction: MatchDetailViewModel['prediction'] = rawPrediction
    ? {
        label: rawPrediction.label,
        expectedWinner,
        homeProbability: probs?.probHome,
        drawProbability: probs?.probDraw,
        awayProbability: probs?.probAway,
        confidence: rawPrediction.confidence,
        outcomeStatus: nm?.predictionOutcome?.status,
        actualWinner,
        result: predictionResult,
        deviation,
        narrativeTag,
      }
    : undefined;

  // Form
  const homeForm = (isHome ? detail.team.recentForm : nm?.opponentRecentForm) ?? [];
  const awayForm = (isHome ? nm?.opponentRecentForm : detail.team.recentForm) ?? [];
  const form: MatchDetailViewModel['form'] =
    homeForm.length > 0 || awayForm.length > 0
      ? { home: homeForm as string[], away: awayForm as string[] }
      : undefined;

  // Map events from DTO if available (FINISHED matches may have goals)
  const events: MatchEvent[] = (nm?.events ?? []).map((e, i) => ({
    id: `${nm?.matchId ?? 'match'}-evt-${i}`,
    teamSide: e.team,
    type: e.type === 'OWN_GOAL' ? 'OWN_GOAL' : e.type === 'PENALTY' ? 'PENALTY_GOAL' : 'GOAL',
    minute: e.minute,
    extraMinute: e.injuryTime,
    playerName: e.scorerName,
  }));

  const preMatchReading = buildPreMatchReading(rawPrediction, homeTeamName, awayTeamName);
  const postMatchReading = buildPostMatchReading(predictionResult, narrativeTag);

  return {
    matchId: nm?.matchId ?? detail.team.teamId,
    uiState,
    competitionId: detail.header.competitionId,
    matchday: nm?.matchday,
    utcDate: nm?.kickoffUtc ?? '',
    venueName: nm?.venueName,
    homeTeam: {
      id: homeTeamId,
      name: homeTeamName,
      crest: homeTeamCrest,
      coachName: homeCoachName,
    },
    awayTeam: {
      id: awayTeamId,
      name: awayTeamName,
      crest: awayTeamCrest,
      coachName: awayCoachName,
    },
    score: { home: nm?.scoreHome, away: nm?.scoreAway },
    prediction,
    form,
    events,
    preMatchReading,
    postMatchReading,
  };
}
