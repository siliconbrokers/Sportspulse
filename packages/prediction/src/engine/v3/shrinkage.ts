/**
 * shrinkage.ts — Motor Predictivo V3: §6 Shrinkage Bayesiano.
 *
 * Spec: SP-PRED-V3-Unified-Engine-Spec.md §6
 *
 * Función pura. Sin IO. Determinista.
 */

import type { TeamTDStats, ShrunkStats } from './types.js';
import { K_SHRINK } from './constants.js';

/**
 * Aplica shrinkage bayesiano hacia el baseline de liga.
 *
 * attack_shrunk  = (games × attack_td  + K_SHRINK × league_goals_pg) / (games + K_SHRINK)
 * defense_shrunk = (games × defense_td + K_SHRINK × league_goals_pg) / (games + K_SHRINK)
 *
 * Con pocos partidos (games ≪ K_SHRINK): resultado anclado al baseline.
 * Con muchos partidos (games ≫ K_SHRINK): resultado converge al observado.
 *
 * @param stats           Stats time-decay del equipo
 * @param leagueAvgGoals  league_goals_pg (media de home y away baselines)
 */
export function applyShrinkage(stats: TeamTDStats, leagueAvgGoals: number): ShrunkStats {
  const denom = stats.games + K_SHRINK;

  return {
    attack_shrunk: (stats.games * stats.attack_td + K_SHRINK * leagueAvgGoals) / denom,
    defense_shrunk: (stats.games * stats.defense_td + K_SHRINK * leagueAvgGoals) / denom,
  };
}
