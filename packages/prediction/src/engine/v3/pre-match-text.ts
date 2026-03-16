/**
 * pre-match-text.ts — Motor Predictivo V3: texto editorial pre-partido.
 *
 * Portado exactamente desde server/radar/radar-api-adapter.ts líneas 334–397.
 * Misma lógica, mismos umbrales, mismo texto. Sin cambios semánticos.
 *
 * Función pura. Sin IO. Determinista (seed basado en matchId).
 */

/**
 * Genera un comentario analítico en voz rioplatense a partir de las probabilidades
 * del modelo Poisson+DC. Usa el matchId como seed para variedad determinista.
 *
 * @param probHome  Probabilidad de victoria local
 * @param probDraw  Probabilidad de empate
 * @param probAway  Probabilidad de victoria visitante
 * @param matchId   ID del partido (usado como seed para determinismo)
 */
export function renderProbText(
  probHome: number,
  probDraw: number,
  probAway: number,
  matchId: string,
): string {
  // Seed determinista basado en matchId
  let h = 0;
  for (let i = 0; i < matchId.length; i++) h = (Math.imul(31, h) + matchId.charCodeAt(i)) | 0;
  const seed = Math.abs(h);
  const pick = (arr: string[]) => arr[seed % arr.length];

  // Dominancia clara del local (≥ 60%)
  if (probHome >= 0.60) {
    return pick([
      'El local llega como favorito claro. El modelo no le da mucho margen al visitante.',
      'Los datos ubican al local con ventaja significativa. El visitante sale de atrás.',
      'El partido llega con una diferencia marcada a favor del local. Difícil de remontar para el de afuera.',
    ]);
  }

  // Dominancia clara del visitante (≥ 60%)
  if (probAway >= 0.60) {
    return pick([
      'El visitante llega como favorito claro. El modelo no espera mucho del local en esta salida.',
      'Número inusual: el visitante supera al local en el modelo. Vale la pena no pasarlo por alto.',
      'Los datos marcan una ventaja clara para el equipo de afuera. El local tiene que remar.',
    ]);
  }

  // Empate como resultado más probable (≥ 35%)
  if (probDraw >= 0.35) {
    return pick([
      'Un cruce que llega muy equilibrado. El empate entra como opción fuerte y ningún resultado queda descartado.',
      'El modelo no define un favorito claro. Partido abierto para cualquier desenlace.',
      'El equilibrio es la nota del partido. Difícil inclinar la balanza hacia alguno de los dos lados.',
    ]);
  }

  // Leve ventaja local (45-60%)
  if (probHome >= 0.45) {
    return pick([
      'Leve ventaja para el local, pero sin margen cómodo. El visitante puede complicar.',
      'El local tiene la mano, aunque el partido llega parejo. No hay favorito que se imponga con claridad.',
      'Partido con inclinación local, pero el visitante llega con chances reales de sacar algo.',
    ]);
  }

  // Leve ventaja visitante (45-60%)
  if (probAway >= 0.45) {
    return pick([
      'El visitante llega con chances reales. El local no tiene asegurada la condición de local.',
      'Ventaja ajustada para el de afuera. El partido llega más parejo de lo que sugiere el fixture.',
      'El modelo le da una leve ventaja al visitante. Un cruce que puede resolverse para cualquier lado.',
    ]);
  }

  // Máxima paridad
  return pick([
    'Pronóstico abierto. El modelo no se juega por ninguno de los dos.',
    'Un partido sin favorito definido. Las tres opciones se reparten las chances de forma casi pareja.',
    'Pocas veces el modelo deja un cruce tan parejo. Cualquier resultado tiene sentido.',
  ]);
}
