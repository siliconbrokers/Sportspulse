/**
 * shouldScrapeIncidents — función pura de decisión.
 * Implementa spec §7.8 + reglas de validez §7.7.
 *
 * No tiene side-effects. Siempre determinística.
 */
import type { IncidentSnapshot, MatchCoreInput } from './types.js';

const LIVE_TTL_SECONDS = 90;
const HT_TTL_MINUTES   = 10;

function ageInSeconds(scrapedAtUtc: string, nowUtc: Date): number {
  return (nowUtc.getTime() - new Date(scrapedAtUtc).getTime()) / 1000;
}

function ageInMinutes(scrapedAtUtc: string, nowUtc: Date): number {
  return ageInSeconds(scrapedAtUtc, nowUtc) / 60;
}

/**
 * Decide si se debe ejecutar scraping de incidentes.
 *
 * @param matchCore  — datos actuales del partido (del provider)
 * @param snapshot   — último snapshot persistido, o null si no existe
 * @param nowUtc     — timestamp actual (inyectado para testability)
 * @returns true si hay que scrapear, false si el snapshot sigue siendo válido
 */
export function shouldScrapeIncidents(
  matchCore: MatchCoreInput,
  snapshot: IncidentSnapshot | null,
  nowUtc: Date,
): boolean {
  // SCHEDULED — nunca scrapear (spec §7.6.1)
  if (matchCore.status === 'SCHEDULED') {
    return false;
  }

  // FINISHED — solo si no existe snapshot final (spec §7.6.2)
  if (matchCore.status === 'FINISHED') {
    return !snapshot || !snapshot.isFinal;
  }

  // Sin snapshot → siempre scrapear
  if (!snapshot) {
    return true;
  }

  // HT — spec §7.6.3
  if (matchCore.status === 'HT') {
    // Caso C: snapshot previo era LIVE → scrapear al entrar en HT
    if (snapshot.matchStatusAtScrape !== 'HT') return true;
    // Caso B: snapshot ya es de HT → respetar TTL
    return ageInMinutes(snapshot.scrapedAtUtc, nowUtc) > HT_TTL_MINUTES;
  }

  // LIVE — spec §7.6.4 + §7.7
  if (matchCore.status === 'LIVE') {
    // Un snapshot final no debe disparar re-scrape automático (regla 3)
    if (snapshot.isFinal) return false;

    // Snapshot era de HT → el partido volvió a LIVE (spec §7.7, Regla 4)
    if (snapshot.matchStatusAtScrape === 'HT') return true;

    // Score cambió respecto al snapshot
    const scoreChanged =
      snapshot.homeScoreAtScrape !== matchCore.homeScore ||
      snapshot.awayScoreAtScrape !== matchCore.awayScore;
    if (scoreChanged) return true;

    // TTL live vencido
    return ageInSeconds(snapshot.scrapedAtUtc, nowUtc) > LIVE_TTL_SECONDS;
  }

  return false;
}
