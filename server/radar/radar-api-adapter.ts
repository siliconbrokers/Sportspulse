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
    const matches = this.dataSource.getMatches(seasonId);
    const teams = this.dataSource.getTeams(competitionId);
    const teamMap = new Map(teams.map((t) => [t.teamId, t]));

    const liveData: RadarLiveMatchData[] = [];

    for (const card of index.cards) {
      const match = matches.find((m) => m.matchId === card.matchId);
      if (!match) continue;

      const homeTeam = teamMap.get(match.homeTeamId);
      const awayTeam = teamMap.get(match.awayTeamId);

      // Compute Poisson+DC probabilities for scheduled matches
      let probHomeWin: number | undefined;
      let probDraw:    number | undefined;
      let probAwayWin: number | undefined;

      if (match.status === EventStatus.SCHEDULED) {
        const homeLambdas = resolveTeamLambdas(match.homeTeamId, matches, buildNowUtc, 'HOME');
        const awayLambdas = resolveTeamLambdas(match.awayTeamId, matches, buildNowUtc, 'AWAY');
        const probs = computeMatchProbs(homeLambdas, awayLambdas);
        if (probs) {
          probHomeWin = probs.homeWin;
          probDraw    = probs.draw;
          probAwayWin = probs.awayWin;
        }
      }

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
      });
    }

    return liveData;
  }
}

// ── Poisson + Dixon-Coles probability model ───────────────────────────────────

const DECAY_XI    = 0.006;  // exponential decay per day, half-life ≈ 115d
const MS_PER_DAY  = 86_400_000;
const MIN_GAMES   = 2;      // minimum games to trust a split (venue or total)
const MAX_GOALS   = 7;      // scoreline grid up to 7-7
const DC_RHO      = -0.13;  // Dixon-Coles low-score correlation parameter

interface TeamLambdas { attack: number; defense: number; games: number }

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

/** Returns venue-specific lambdas when enough data, otherwise falls back to season totals. */
function resolveTeamLambdas(
  teamId: string,
  matches: readonly Match[],
  buildNowUtc: string,
  venue: 'HOME' | 'AWAY',
): TeamLambdas {
  const venueLambdas = computeTeamLambdas(teamId, matches, buildNowUtc, venue);
  if (venueLambdas.games >= MIN_GAMES) return venueLambdas;
  return computeTeamLambdas(teamId, matches, buildNowUtc); // season totals fallback
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
  if (homeLambdas.games < MIN_GAMES || awayLambdas.games < MIN_GAMES) return null;

  const lh = (homeLambdas.attack  + awayLambdas.defense) / 2;
  const la = (awayLambdas.attack  + homeLambdas.defense) / 2;

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

function normalizeSeasonKey(raw: string): string {
  // "football-data:PD:2025" → "2025"
  // "thesportsdb:4432-2025" → "4432_2025"
  // We just sanitize to use as directory name
  return raw.replace(/[^a-z0-9_-]/gi, '_').replace(/-+/g, '_').toLowerCase();
}
