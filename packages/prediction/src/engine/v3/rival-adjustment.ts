/**
 * rival-adjustment.ts — Motor Predictivo V3: §8 Rival Adjustment.
 *
 * Spec: SP-PRED-V3-Unified-Engine-Spec.md §8
 *
 * Función pura. Sin IO. Determinista.
 */

import type { V3MatchRecord, MatchSignalRA } from './types.js';
import { RA_MIN_RIVAL_GAMES } from './constants.js';

/**
 * Para cada partido del historial de un equipo, ajusta la señal por la calidad del rival.
 *
 * attack_signal_i  = goals_scored_i   / rival_defense_baseline_i
 * defense_signal_i = goals_conceded_i / rival_attack_baseline_i
 *
 * rival_defense_baseline_i = effective_defense del rival para ese partido.
 * Si el rival no tiene suficientes datos (< RA_MIN_RIVAL_GAMES), usar league_goals_pg.
 *
 * Estos rival-adjusted signals reemplazan los goles crudos para recency (§9)
 * cuando rival_adjustment_available = true (rival tiene ≥ RA_MIN_RIVAL_GAMES partidos).
 *
 * @param matches                 Partidos filtrados de la temporada actual
 * @param teamId                  ID del equipo a analizar
 * @param getOpponentEffective    Función que retorna { attack_eff, defense_eff, games } del rival
 */
export function computeMatchSignalsRA(
  matches: readonly V3MatchRecord[],
  teamId: string,
  getOpponentEffective: (
    opponentId: string,
  ) => { attack_eff: number; defense_eff: number; games: number },
): MatchSignalRA[] {
  const signals: MatchSignalRA[] = [];

  for (const m of matches) {
    const isHome = m.homeTeamId === teamId;
    const isAway = m.awayTeamId === teamId;
    if (!isHome && !isAway) continue;

    const opponentId = isHome ? m.awayTeamId : m.homeTeamId;
    const scored = isHome ? m.homeGoals : m.awayGoals;
    const conceded = isHome ? m.awayGoals : m.homeGoals;

    const oppEff = getOpponentEffective(opponentId);
    const rivalAdjustmentAvailable = oppEff.games >= RA_MIN_RIVAL_GAMES;

    // Si el rival no tiene suficientes datos, los signals son los goles crudos normalizados
    // (equivale a dividir por 1.0 — no hay ajuste real, pero mantenemos la estructura)
    const rival_defense_baseline = rivalAdjustmentAvailable && oppEff.defense_eff > 0
      ? oppEff.defense_eff
      : 1.0;
    const rival_attack_baseline = rivalAdjustmentAvailable && oppEff.attack_eff > 0
      ? oppEff.attack_eff
      : 1.0;

    // §SP-V4-05: rival_strength para SoS-weighted recency.
    // Solo disponible cuando el rival tiene suficientes datos para effective rates.
    const rivalStrength = rivalAdjustmentAvailable
      ? (oppEff.attack_eff + oppEff.defense_eff) / 2
      : undefined;

    signals.push({
      utcDate: m.utcDate,
      attack_signal: scored / rival_defense_baseline,
      defense_signal: conceded / rival_attack_baseline,
      rivalStrength,
    });
  }

  return signals;
}
