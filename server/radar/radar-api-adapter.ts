/**
 * Radar SportPulse — API Adapter
 * Implements IRadarService interface (defined in packages/api/src/ui/types.ts).
 * Bridges the radar service with the API layer by:
 *   1. Building/reading the editorial snapshot
 *   2. Merging live match data from the data source
 */

import type { Match } from '@sportpulse/canonical';
import { EventStatus } from '@sportpulse/canonical';
import type { DataSource } from '@sportpulse/snapshot';
import { buildOrGetRadarSnapshot } from './radar-service.js';
import type { RadarIndexSnapshot } from './radar-types.js';

export interface RadarLiveMatchData {
  matchId: string;
  status: string;
  scoreHome: number | null;
  scoreAway: number | null;
  startTimeUtc: string | null;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  homeTeamCrest?: string;
  awayTeamCrest?: string;
  /** Poisson+Dixon-Coles probabilities — only present for SCHEDULED matches with enough data */
  probHomeWin?: number;
  probDraw?: number;
  probAwayWin?: number;
  /** Comentario analítico generado desde probabilidades (voz rioplatense) */
  preMatchText?: string;
}

export type RadarApiResult = {
  index: RadarIndexSnapshot | null;
  liveData: RadarLiveMatchData[];
  state: 'ok' | 'empty' | 'unavailable';
};

/** Maps competition ID to its canonical competition key (used for file paths). */
function competitionKeyFromId(competitionId: string): string {
  // competitionId format: "comp:{providerKey}:{code}"
  // e.g. "comp:football-data:PD" → "la_liga"
  const parts = competitionId.split(':');
  const code = parts[2] ?? parts[1] ?? competitionId;
  const codeMap: Record<string, string> = {
    PD: 'la_liga',
    PL: 'premier_league',
    BL1: 'bundesliga',
    '4432': 'liga_uruguaya',
  };
  return codeMap[code] ?? code.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

export class RadarApiAdapter {
  constructor(private readonly dataSource: DataSource) {}

  async getRadar(
    competitionId: string,
    matchday: number,
    buildNowUtc: string,
  ): Promise<RadarApiResult> {
    const competitionKey = competitionKeyFromId(competitionId);
    const seasonId = this.dataSource.getSeasonId?.(competitionId);
    if (!seasonId) {
      console.warn(`[RadarAdapter] No seasonId for ${competitionId}`);
      return { index: null, liveData: [], state: 'unavailable' };
    }

    // Derive seasonKey from seasonId (format: "season:{providerKey}:{seasonId}")
    const seasonKeyRaw = seasonId.split(':').slice(2).join(':') ?? seasonId;
    // Normalize: "football-data:PD:2025" → "2025_2026" style not possible from ID alone
    // Use a simple normalized form from seasonId for directory naming
    const seasonKey = normalizeSeasonKey(seasonKeyRaw);

    try {
      const result = await buildOrGetRadarSnapshot({
        competitionKey,
        seasonKey,
        matchday,
        competitionId,
        dataSource: this.dataSource,
        buildNowUtc,
      });

      if (!result) {
        return { index: null, liveData: [], state: 'unavailable' };
      }

      const { index } = result;

      if (index.moduleState === 'EMPTY') {
        return { index, liveData: [], state: 'empty' };
      }

      // Build live data for each card's match
      const liveData = this.buildLiveData(index, competitionId, seasonId, buildNowUtc);

      return { index, liveData, state: 'ok' };
    } catch (err) {
      console.error('[RadarAdapter] Error building radar snapshot:', err);
      return { index: null, liveData: [], state: 'unavailable' };
    }
  }

  private buildLiveData(
    index: RadarIndexSnapshot,
    competitionId: string,
    seasonId: string,
    buildNowUtc: string,
  ): RadarLiveMatchData[] {
    const allMatches = this.dataSource.getMatches(seasonId);
    const teams = this.dataSource.getTeams(competitionId);
    const teamMap = new Map(teams.map((t) => [t.teamId, t]));

    // Usar todos los partidos de la jornada, no solo los del radar editorial
    const matchday = index.matchday;
    const matches = allMatches.filter((m) => (m as Match & { matchday?: number }).matchday === matchday);

    // Compute league average once for all teams (used for shrinkage)
    const leagueAvgGoals = computeLeagueAvgGoals(allMatches, buildNowUtc);

    const liveData: RadarLiveMatchData[] = [];

    for (const match of matches) {

      const homeTeam = teamMap.get(match.homeTeamId);
      const awayTeam = teamMap.get(match.awayTeamId);

      // Compute Poisson+DC probabilities with shrinkage toward league average
      let probHomeWin: number | undefined;
      let probDraw:    number | undefined;
      let probAwayWin: number | undefined;

      const homeLambdas = resolveTeamLambdas(match.homeTeamId, allMatches, buildNowUtc, 'HOME', leagueAvgGoals);
      const awayLambdas = resolveTeamLambdas(match.awayTeamId, allMatches, buildNowUtc, 'AWAY', leagueAvgGoals);
      const probs = computeMatchProbs(homeLambdas, awayLambdas);
      if (probs) {
        probHomeWin = probs.homeWin;
        probDraw    = probs.draw;
        probAwayWin = probs.awayWin;
      }

      const preMatchText = (probHomeWin != null && probDraw != null && probAwayWin != null)
        ? renderProbText(probHomeWin, probDraw, probAwayWin, match.matchId)
        : undefined;

      liveData.push({
        matchId: match.matchId,
        status: match.status,
        scoreHome: match.scoreHome,
        scoreAway: match.scoreAway,
        startTimeUtc: match.startTimeUtc,
        homeTeamId: match.homeTeamId,
        awayTeamId: match.awayTeamId,
        homeTeamName: homeTeam?.name ?? match.homeTeamId,
        awayTeamName: awayTeam?.name ?? match.awayTeamId,
        homeTeamCrest: homeTeam?.crestUrl,
        awayTeamCrest: awayTeam?.crestUrl,
        probHomeWin,
        probDraw,
        probAwayWin,
        preMatchText,
      });
    }

    return liveData;
  }
}

// ── Poisson + Dixon-Coles probability model ───────────────────────────────────

const DECAY_XI          = 0.006;  // exponential decay per day, half-life ≈ 115d
const MS_PER_DAY        = 86_400_000;
const MIN_GAMES_VENUE   = 5;      // min venue-specific games to trust the home/away split
const MIN_GAMES_MODEL   = 1;      // min total games to compute probs at all (shrinkage handles small samples)
const SHRINKAGE_K       = 5;      // prior strength: equivalent to 5 games toward league average
const MAX_GOALS         = 7;      // scoreline grid up to 7-7
const DC_RHO            = -0.13;  // Dixon-Coles low-score correlation parameter
const HOME_ADVANTAGE    = 1.15;   // applied to λ_home when venue split unavailable

interface TeamLambdas { attack: number; defense: number; games: number; venueSplit: boolean }

/**
 * Computes league average goals per team per game from all finished matches.
 * Used as Bayesian prior for shrinkage. Returns 1.3 as fallback (typical European league avg).
 */
function computeLeagueAvgGoals(matches: readonly Match[], buildNowUtc: string): number {
  let totalGoals = 0;
  let totalMatches = 0;
  for (const m of matches) {
    if (
      m.status !== EventStatus.FINISHED ||
      m.startTimeUtc === null ||
      m.startTimeUtc >= buildNowUtc ||
      m.scoreHome === null ||
      m.scoreAway === null
    ) continue;
    totalGoals   += m.scoreHome + m.scoreAway;
    totalMatches += 1;
  }
  // Each match has 2 "team-slots" (one home, one away)
  return totalMatches > 0 ? totalGoals / (2 * totalMatches) : 1.3;
}

/**
 * Applies Bayesian shrinkage toward the league average.
 * λ_shrunk = (n × λ_raw + K × λ_avg) / (n + K)
 * With few games: result is heavily pulled toward average.
 * With many games: result converges to the team's own data.
 */
function shrinkLambda(raw: number, games: number, leagueAvg: number): number {
  return (games * raw + SHRINKAGE_K * leagueAvg) / (games + SHRINKAGE_K);
}

/** Compute time-decay weighted attack/defense rates for a team, optionally filtered by venue. */
function computeTeamLambdas(
  teamId: string,
  matches: readonly Match[],
  buildNowUtc: string,
  venue?: 'HOME' | 'AWAY',
): TeamLambdas {
  const buildMs = new Date(buildNowUtc).getTime();
  let wAttack = 0, wDefense = 0, wTotal = 0, games = 0;

  for (const m of matches) {
    if (
      m.status !== EventStatus.FINISHED ||
      m.startTimeUtc === null ||
      m.startTimeUtc >= buildNowUtc ||
      m.scoreHome === null ||
      m.scoreAway === null
    ) continue;

    const isHome = m.homeTeamId === teamId;
    const isAway = m.awayTeamId === teamId;
    if (!isHome && !isAway) continue;
    if (venue === 'HOME' && !isHome) continue;
    if (venue === 'AWAY' && !isAway) continue;

    const scored   = isHome ? m.scoreHome : m.scoreAway;
    const conceded = isHome ? m.scoreAway : m.scoreHome;
    const daysAgo  = (buildMs - new Date(m.startTimeUtc).getTime()) / MS_PER_DAY;
    const w        = Math.exp(-DECAY_XI * daysAgo);

    wAttack  += scored   * w;
    wDefense += conceded * w;
    wTotal   += w;
    games    += 1;
  }

  return {
    attack:  wTotal > 0 ? wAttack  / wTotal : 0,
    defense: wTotal > 0 ? wDefense / wTotal : 0,
    games,
  };
}

/**
 * Returns venue-specific lambdas when ≥ MIN_GAMES_VENUE, otherwise falls back to season totals.
 * Applies shrinkage toward league average on the resulting lambdas.
 */
function resolveTeamLambdas(
  teamId: string,
  matches: readonly Match[],
  buildNowUtc: string,
  venue: 'HOME' | 'AWAY',
  leagueAvgGoals: number,
): TeamLambdas {
  const venueLambdas = computeTeamLambdas(teamId, matches, buildNowUtc, venue);
  const raw = venueLambdas.games >= MIN_GAMES_VENUE
    ? { ...venueLambdas, venueSplit: true }
    : { ...computeTeamLambdas(teamId, matches, buildNowUtc), venueSplit: false };

  // Apply shrinkage: pull extreme estimates toward league average, proportional to data volume
  return {
    ...raw,
    attack:  shrinkLambda(raw.attack,  raw.games, leagueAvgGoals),
    defense: shrinkLambda(raw.defense, raw.games, leagueAvgGoals),
  };
}

function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function dcTau(h: number, a: number, lh: number, la: number): number {
  if (h === 0 && a === 0) return 1 - lh * la * DC_RHO;
  if (h === 0 && a === 1) return 1 + lh * DC_RHO;
  if (h === 1 && a === 0) return 1 + la * DC_RHO;
  if (h === 1 && a === 1) return 1 - DC_RHO;
  return 1;
}

/** Returns Poisson+DC probabilities or null when not enough data. */
function computeMatchProbs(
  homeLambdas: TeamLambdas,
  awayLambdas: TeamLambdas,
): { homeWin: number; draw: number; awayWin: number } | null {
  // With shrinkage, even 1 game gives a reasonable estimate anchored to league average
  if (homeLambdas.games < MIN_GAMES_MODEL || awayLambdas.games < MIN_GAMES_MODEL) return null;

  let lh = (homeLambdas.attack  + awayLambdas.defense) / 2;
  let la = (awayLambdas.attack  + homeLambdas.defense) / 2;
  if (!homeLambdas.venueSplit || !awayLambdas.venueSplit) {
    lh *= HOME_ADVANTAGE;
  }

  let hw = 0, dr = 0, aw = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    const ph = poissonPmf(lh, h);
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = ph * poissonPmf(la, a) * dcTau(h, a, lh, la);
      if (h > a) hw += p;
      else if (h === a) dr += p;
      else aw += p;
    }
  }

  const total = hw + dr + aw || 1;
  return { homeWin: hw / total, draw: dr / total, awayWin: aw / total };
}

// ── Prob-based pre-match text generator (voz rioplatense) ────────────────────

/**
 * Genera un comentario analítico en voz rioplatense a partir de las probabilidades
 * del modelo Poisson+DC. Usa el matchId como seed para variedad determinista.
 */
function renderProbText(
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

function normalizeSeasonKey(raw: string): string {
  // "football-data:PD:2025" → "2025"
  // "thesportsdb:4432-2025" → "4432_2025"
  // We just sanitize to use as directory name
  return raw.replace(/[^a-z0-9_-]/gi, '_').replace(/-+/g, '_').toLowerCase();
}
