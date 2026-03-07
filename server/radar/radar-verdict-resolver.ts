/**
 * Radar SportPulse — Verdict Resolver
 * Spec: radar-02-editorial-policy.md §22, §23, §24
 * Only analytical labels can receive a verdict.
 */

import type {
  RadarLabelKey,
  RadarVerdict,
} from './radar-types.js';

export type VerdictResult = {
  verdict: RadarVerdict;
  verdictTitle: string;
  verdictText: string;
} | null;

const VERDICT_TITLES: Record<RadarVerdict, string> = {
  CONFIRMED: 'La lectura se confirmó',
  PARTIAL: 'La lectura se cumplió a medias',
  REJECTED: 'La lectura no se confirmó',
};

const ANALYTICAL_LABELS: RadarLabelKey[] = [
  'SENAL_DE_ALERTA',
  'PARTIDO_ENGANOSO',
  'PARTIDO_ABIERTO',
  'DUELO_CERRADO',
];

/**
 * Returns true if the label supports post-match verdict.
 */
export function supportsVerdict(label: RadarLabelKey): boolean {
  return ANALYTICAL_LABELS.includes(label);
}

/**
 * Resolves the post-match verdict for a card.
 * Requires: final score, label, and the pre-match favorite side.
 */
export function resolveVerdict(
  label: RadarLabelKey,
  scoreHome: number,
  scoreAway: number,
  favoriteSide: 'HOME' | 'AWAY' | null,
): VerdictResult {
  if (!supportsVerdict(label)) return null;

  let verdict: RadarVerdict;
  let verdictText: string;

  const totalGoals = scoreHome + scoreAway;
  const goalDifference = Math.abs(scoreHome - scoreAway);
  const homeWon = scoreHome > scoreAway;
  const awayWon = scoreAway > scoreHome;
  const draw = scoreHome === scoreAway;
  const bothScored = scoreHome > 0 && scoreAway > 0;

  const favoriteWon =
    favoriteSide === 'HOME' ? homeWon : favoriteSide === 'AWAY' ? awayWon : false;
  const favoriteWonBy = favoriteSide === 'HOME'
    ? scoreHome - scoreAway
    : favoriteSide === 'AWAY'
    ? scoreAway - scoreHome
    : 0;
  const favoriteKeptCleanSheet =
    favoriteSide === 'HOME' ? scoreAway === 0 : favoriteSide === 'AWAY' ? scoreHome === 0 : false;

  switch (label) {
    case 'SENAL_DE_ALERTA':
      // Confirmed: favorite does not win OR wins by 1 and concedes
      if (!favoriteWon || (favoriteWonBy === 1 && !favoriteKeptCleanSheet)) {
        verdict = 'CONFIRMED';
        verdictText = 'La lectura se confirmó: el favorito no resolvió el cruce con la solidez esperada.';
      } else if (
        (favoriteWonBy === 1 && favoriteKeptCleanSheet) ||
        (favoriteWonBy >= 2 && !favoriteKeptCleanSheet)
      ) {
        verdict = 'PARTIAL';
        verdictText = 'La lectura se cumplió a medias: hubo señales de alerta, pero no alcanzaron para torcer el desenlace.';
      } else {
        verdict = 'REJECTED';
        verdictText = 'La lectura no se confirmó: el favorito resolvió el partido con autoridad.';
      }
      break;

    case 'PARTIDO_ENGANOSO':
      // Confirmed: favorite does not win OR wins by only 1
      if (!favoriteWon || favoriteWonBy === 1) {
        verdict = 'CONFIRMED';
        verdictText = 'La lectura se confirmó: el cruce no fue tan simple como la superficie sugería.';
      } else if (favoriteWonBy === 2 && bothScored) {
        verdict = 'PARTIAL';
        verdictText = 'La lectura se cumplió a medias: hubo matices del engaño previo, aunque el resultado final se ordenó.';
      } else {
        verdict = 'REJECTED';
        verdictText = 'La lectura no se confirmó: el resultado terminó alineado con la apariencia previa.';
      }
      break;

    case 'PARTIDO_ABIERTO':
      // Confirmed: both score + total >= 3, OR total >= 4
      if ((bothScored && totalGoals >= 3) || totalGoals >= 4) {
        verdict = 'CONFIRMED';
        verdictText = 'La lectura se confirmó: el partido dejó el intercambio que sugería la previa.';
      } else if ((bothScored && totalGoals === 2) || (!bothScored && totalGoals === 3)) {
        verdict = 'PARTIAL';
        verdictText = 'La lectura se cumplió a medias: aparecieron señales de apertura, pero no de forma completa.';
      } else {
        verdict = 'REJECTED';
        verdictText = 'La lectura no se confirmó: el cruce terminó mucho más contenido de lo esperado.';
      }
      break;

    case 'DUELO_CERRADO':
      // Confirmed: total <= 2 and gd <= 1
      if (totalGoals <= 2 && goalDifference <= 1) {
        verdict = 'CONFIRMED';
        verdictText = 'La lectura se confirmó: el partido se mantuvo corto y con poco margen.';
      } else if (
        (totalGoals <= 2 && goalDifference === 2) ||
        (totalGoals === 3 && goalDifference <= 1)
      ) {
        verdict = 'PARTIAL';
        verdictText = 'La lectura se cumplió a medias: hubo margen corto por momentos, pero no un cierre completo.';
      } else {
        verdict = 'REJECTED';
        verdictText = 'La lectura no se confirmó: el cruce terminó más abierto de lo que sugería la previa.';
      }
      break;

    default:
      return null;
  }

  return {
    verdict,
    verdictTitle: VERDICT_TITLES[verdict],
    verdictText,
  };
}
