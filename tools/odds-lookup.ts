/**
 * odds-lookup.ts — Índice en memoria de odds históricas de football-data.co.uk.
 *
 * Carga archivos de cache/odds-data/{COMP}/{SEASON}.json y construye un índice
 * por clave `{league}:{date}:{fthg}:{ftag}` para lookup O(1).
 *
 * Estrategia de matching: date (UTC) + score del partido.
 * Para partidos FINISHED esto es determinístico y sin ambigüedad en >99.9% de casos.
 *
 * Uso:
 *   import { buildOddsIndex, lookupOdds } from './odds-lookup.js';
 *   const index = buildOddsIndex(['PD','PL','BL1']);
 *   const odds = lookupOdds(index, 'PD', '2023-08-11', 0, 2);
 */

import * as fs   from 'fs';
import * as path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OddsLookupResult {
  impliedProbHome: number;
  impliedProbDraw: number;
  impliedProbAway: number;
  oddsSource: 'pinnacle' | 'bet365' | 'avg' | 'unknown';
  b365h: number | null;
  b365d: number | null;
  b365a: number | null;
  psh:   number | null;
  psd:   number | null;
  psa:   number | null;
}

// key: `{league}:{date}:{fthg}:{ftag}` → OddsLookupResult
// Colisiones (misma fecha, mismo score, misma liga): se descarta la segunda
export type OddsIndex = Map<string, OddsLookupResult>;

// ── Loader ────────────────────────────────────────────────────────────────────

const ODDS_BASE = path.join(process.cwd(), 'cache', 'odds-data');

interface OddsFileMatch {
  date:            string;
  homeTeam:        string;
  awayTeam:        string;
  ftr:             string;
  fthg:            number;
  ftag:            number;
  b365h:           number | null;
  b365d:           number | null;
  b365a:           number | null;
  psh:             number | null;
  psd:             number | null;
  psa:             number | null;
  impliedProbHome: number;
  impliedProbDraw: number;
  impliedProbAway: number;
  oddsSource:      'pinnacle' | 'bet365' | 'avg' | 'unknown';
}

/**
 * Construye el índice a partir de los archivos cache/odds-data/{leagues}/*.json.
 * Si hay colisión de clave (misma fecha+score+liga), se mantiene la primera entrada.
 */
export function buildOddsIndex(leagues: string[]): OddsIndex {
  const index: OddsIndex = new Map();
  let loaded = 0;
  let collisions = 0;

  for (const league of leagues) {
    const dir = path.join(ODDS_BASE, league);
    if (!fs.existsSync(dir)) continue;

    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .sort();

    for (const file of files) {
      let data: { matches?: OddsFileMatch[] };
      try {
        data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
      } catch { continue; }

      const matches = data.matches ?? [];
      for (const m of matches) {
        if (typeof m.fthg !== 'number' || typeof m.ftag !== 'number') continue;

        const key = `${league}:${m.date}:${m.fthg}:${m.ftag}`;
        if (index.has(key)) {
          collisions++;
          // También intentar con clave invertida para detectar si hay ambigüedad real
          // (dos partidos misma fecha mismo score misma liga)
          continue;
        }

        index.set(key, {
          impliedProbHome: m.impliedProbHome,
          impliedProbDraw: m.impliedProbDraw,
          impliedProbAway: m.impliedProbAway,
          oddsSource:      m.oddsSource,
          b365h: m.b365h,
          b365d: m.b365d,
          b365a: m.b365a,
          psh:   m.psh,
          psd:   m.psd,
          psa:   m.psa,
        });
        loaded++;
      }
    }
  }

  if (collisions > 0) {
    process.stderr.write(`[odds-lookup] ${loaded} records loaded, ${collisions} skipped (key collision)\n`);
  }

  return index;
}

/**
 * Busca odds para un partido dado.
 *
 * @param index    Índice construido con buildOddsIndex
 * @param league   Código de liga (PD, PL, BL1)
 * @param utcDate  ISO date string del partido — se usa solo la parte YYYY-MM-DD
 * @param scoreHome  Goles local en el partido FINISHED
 * @param scoreAway  Goles visitante
 * @returns OddsLookupResult o null si no se encuentra
 */
export function lookupOdds(
  index:     OddsIndex,
  league:    string,
  utcDate:   string,
  scoreHome: number,
  scoreAway: number,
): OddsLookupResult | null {
  // Extraer YYYY-MM-DD del timestamp (los partidos europeos se juegan de tarde/noche — fecha UTC = fecha local)
  const date = utcDate.slice(0, 10);
  const key  = `${league}:${date}:${scoreHome}:${scoreAway}`;
  return index.get(key) ?? null;
}

/**
 * Estadísticas del índice — útil para debugging.
 */
export function oddsIndexStats(index: OddsIndex): { total: number; bySource: Record<string, number> } {
  const bySource: Record<string, number> = {};
  for (const v of index.values()) {
    bySource[v.oddsSource] = (bySource[v.oddsSource] ?? 0) + 1;
  }
  return { total: index.size, bySource };
}
