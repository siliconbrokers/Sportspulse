/**
 * poisson-matrix.ts — Motor Predictivo V3: §13 Poisson Matrix y 1X2.
 *
 * Spec: SP-PRED-V3-Unified-Engine-Spec.md §13
 *
 * Función pura. Sin IO. Determinista.
 */

import type { PoissonMatrixResult } from './types.js';
import { MAX_GOALS, MAX_TAIL_MASS } from './constants.js';
import { dcTau } from './dixon-coles.js';

/**
 * Calcula la PMF de Poisson: P(X = k) dado lambda.
 * Implementación log-space para precisión numérica.
 */
function poissonPMF(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/**
 * Calcula las probabilidades 1X2 usando grilla Poisson con corrección Dixon-Coles.
 *
 * Grilla de marcadores 0..MAX_GOALS × 0..MAX_GOALS
 * cell(h, a) = poissonPMF(lh, h) × poissonPMF(la, a) × tau(h, a, lh, la, rho)
 *
 * Renormaliza para garantizar suma = 1.
 * Detecta tail mass excedida (1 − suma > MAX_TAIL_MASS).
 *
 * Si tail mass excedida, expande a MAX_GOALS+2 (= 9) automáticamente.
 *
 * @param lh   Lambda del equipo local
 * @param la   Lambda del equipo visitante
 * @param rho  Parámetro DC (opcional — default: constante DC_RHO). Pasa el valor
 *             estimado por dc-rho-estimator cuando está disponible.
 */
export function computePoissonMatrix(lh: number, la: number, rho?: number): PoissonMatrixResult {
  let maxGoals = MAX_GOALS;
  let tailMassExceeded = false;

  // Primera pasada con MAX_GOALS
  const firstResult = computeWithGrid(lh, la, maxGoals, rho);
  const tailMass = 1 - firstResult.rawTotal;

  if (tailMass > MAX_TAIL_MASS) {
    // Expandir grilla a MAX_GOALS + 2 (= 9) como indica el spec §13
    tailMassExceeded = true;
    maxGoals = MAX_GOALS + 2;
  }

  const result = tailMassExceeded
    ? computeWithGrid(lh, la, maxGoals, rho)
    : firstResult;

  // Renormalizar
  const total = result.rawTotal > 0 ? result.rawTotal : 1;

  // Renormalizar la matriz celda a celda
  const matrix: number[][] = result.cells.map((row) => row.map((cell) => cell / total));

  return {
    prob_home_win: result.hw / total,
    prob_draw: result.dr / total,
    prob_away_win: result.aw / total,
    tailMassExceeded,
    matrix,
  };
}

interface GridResult {
  hw: number;
  dr: number;
  aw: number;
  rawTotal: number;
  cells: number[][];
}

function computeWithGrid(lh: number, la: number, maxGoals: number, rho?: number): GridResult {
  let hw = 0;
  let dr = 0;
  let aw = 0;
  const cells: number[][] = [];

  for (let h = 0; h <= maxGoals; h++) {
    const ph = poissonPMF(lh, h);
    const row: number[] = [];
    for (let a = 0; a <= maxGoals; a++) {
      const cell = ph * poissonPMF(la, a) * dcTau(h, a, lh, la, rho);
      row.push(cell);
      if (h > a) hw += cell;
      else if (h === a) dr += cell;
      else aw += cell;
    }
    cells.push(row);
  }

  return { hw, dr, aw, rawTotal: hw + dr + aw, cells };
}
