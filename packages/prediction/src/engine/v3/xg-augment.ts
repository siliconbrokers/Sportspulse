/**
 * xg-augment.ts — Motor Predictivo V3: §T3-01 Augmentación con Expected Goals.
 *
 * Spec: SP-MKT-T3-00 §6.1
 *
 * Reemplaza homeGoals/awayGoals con xgHome/xgAway en V3MatchRecord[] donde
 * exista un XgRecord correspondiente (join por utcDate + homeTeamId + awayTeamId).
 * Matches sin XgRecord correspondiente retienen sus goles reales.
 *
 * Función pura. Sin IO. Determinista.
 */

import type { V3MatchRecord, XgRecord } from './types.js';

// ── Funciones exportadas ──────────────────────────────────────────────────────

/**
 * Augmenta un array de V3MatchRecord con datos de xG donde disponibles.
 *
 * Para cada match en `matches`, si existe un XgRecord con el mismo
 * (utcDate, homeTeamId, awayTeamId), reemplaza homeGoals/awayGoals
 * con xgHome/xgAway. Matches sin xG retienen sus goles reales.
 *
 * Cuando `xgRecords` es undefined o vacío, retorna `matches` sin modificar
 * (misma referencia — zero cost, zero behavioral change).
 *
 * @param matches    Array de partidos a augmentar.
 * @param xgRecords  XG records opcionales para el join.
 * @returns          Array augmentado (nuevo array si hubo cambios, original si no).
 */
export function augmentMatchesWithXg(
  matches: V3MatchRecord[],
  xgRecords: XgRecord[] | undefined,
): V3MatchRecord[] {
  if (xgRecords === undefined || xgRecords.length === 0) {
    return matches;
  }

  // Construir índice para O(n) join: clave = "utcDate|homeTeamId|awayTeamId"
  const xgIndex = new Map<string, XgRecord>();
  for (const xg of xgRecords) {
    const key = `${xg.utcDate}|${xg.homeTeamId}|${xg.awayTeamId}`;
    xgIndex.set(key, xg);
  }

  // Augmentar: sólo crear nuevo array si hay al menos un match con xG
  let hasAny = false;
  const result: V3MatchRecord[] = matches.map((m) => {
    const key = `${m.utcDate}|${m.homeTeamId}|${m.awayTeamId}`;
    const xg = xgIndex.get(key);
    if (xg !== undefined) {
      hasAny = true;
      return {
        homeTeamId: m.homeTeamId,
        awayTeamId: m.awayTeamId,
        utcDate: m.utcDate,
        homeGoals: xg.xgHome,
        awayGoals: xg.xgAway,
      };
    }
    return m;
  });

  // Si no se encontró ningún match con xG, retornar original para evitar allocación
  return hasAny ? result : matches;
}

/**
 * Computa métricas de cobertura de xG para un set de matches.
 *
 * @param matches    Array de partidos (post anti-lookahead filter).
 * @param xgRecords  XG records opcionales.
 * @returns          { xgUsed, coverageMatches, totalMatches }
 */
export function computeXgCoverage(
  matches: V3MatchRecord[],
  xgRecords: XgRecord[] | undefined,
): { xgUsed: boolean; coverageMatches: number; totalMatches: number } {
  const totalMatches = matches.length;

  if (xgRecords === undefined || xgRecords.length === 0) {
    return { xgUsed: false, coverageMatches: 0, totalMatches };
  }

  // Construir índice para O(n) join
  const xgIndex = new Set<string>();
  for (const xg of xgRecords) {
    xgIndex.add(`${xg.utcDate}|${xg.homeTeamId}|${xg.awayTeamId}`);
  }

  let coverageMatches = 0;
  for (const m of matches) {
    const key = `${m.utcDate}|${m.homeTeamId}|${m.awayTeamId}`;
    if (xgIndex.has(key)) {
      coverageMatches++;
    }
  }

  return {
    xgUsed: coverageMatches > 0,
    coverageMatches,
    totalMatches,
  };
}
