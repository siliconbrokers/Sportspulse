/**
 * dixon-coles.ts — Motor Predictivo V3: §12 Dixon-Coles Correction.
 *
 * Spec: SP-PRED-V3-Unified-Engine-Spec.md §12
 *
 * Función pura. Sin estado. Determinista.
 */

import { DC_RHO } from './constants.js';

/**
 * Factor de corrección Dixon-Coles para scores bajos del producto de Poisson independiente.
 *
 * tau(h, a, lh, la, rho) =
 *   h=0, a=0 → 1 − lh × la × rho
 *   h=0, a=1 → 1 + lh × rho
 *   h=1, a=0 → 1 + la × rho
 *   h=1, a=1 → 1 − rho
 *   otherwise → 1
 *
 * @param h    Goles del equipo local (0 o 1 para que aplique la corrección)
 * @param a    Goles del equipo visitante (0 o 1 para que aplique la corrección)
 * @param lh   Lambda del equipo local
 * @param la   Lambda del equipo visitante
 * @param rho  Parámetro de correlación (opcional — default: constante DC_RHO)
 */
export function dcTau(h: number, a: number, lh: number, la: number, rho: number = DC_RHO): number {
  if (h === 0 && a === 0) return 1 - lh * la * rho;
  if (h === 0 && a === 1) return 1 + lh * rho;
  if (h === 1 && a === 0) return 1 + la * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}
