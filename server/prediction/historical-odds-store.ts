/**
 * historical-odds-store.ts — reads cached historical odds from disk and provides
 * per-match lookup used by the blend accuracy analysis.
 *
 * Cache files are produced by tools/backfill-historical-odds.ts.
 * Location: cache/historical-odds/{sport_key}/{YYYY-MM-DD}.json
 *
 * Lookup strategy:
 *   1. Load the cache file for (sport_key, kickoff_date)
 *   2. Find the event with commence_time ≈ kickoffUtc (±30min tolerance)
 *   3. If multiple matches at the same time: use team name fuzzy matching
 *   4. Average h2h prices across all bookmakers, de-vig (normalize to sum=1)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ImpliedOdds {
  probHome: number;  // de-vigged, sums to 1.0
  probDraw: number;
  probAway: number;
  bookmakerCount: number;
  homeTeamName: string;
  awayTeamName: string;
}

interface OddsOutcome {
  name: string;
  price: number;
}

interface OddsMarket {
  key: string;
  outcomes: OddsOutcome[];
}

interface OddsBookmaker {
  key: string;
  markets: OddsMarket[];
}

interface OddsEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsBookmaker[];
}

interface CacheFile {
  events: OddsEvent[];
}

// ── Constants ───────────────────────────────────────────────────────────────

const KICKOFF_TOLERANCE_MS = 30 * 60 * 1000; // ±30 min for commence_time matching

// Competition code → sport_key (same mapping as OddsService + backfill script)
export const COMP_CODE_TO_SPORT_KEY: Record<string, string> = {
  PD:    'soccer_spain_la_liga',
  PL:    'soccer_epl',
  BL1:   'soccer_germany_bundesliga',
  SA:    'soccer_italy_serie_a',
  FL1:   'soccer_france_ligue_one',
  DED:   'soccer_netherlands_eredivisie',
  PPL:   'soccer_portugal_primeira_liga',
  URU:   'soccer_uruguay_primera_division',
  AR:    'soccer_argentina_primera_division',
  MX:    'soccer_mexico_ligamx',
  BR:    'soccer_brazil_campeonato',
  // AF numeric codes
  '140': 'soccer_spain_la_liga',
  '39':  'soccer_epl',
  '78':  'soccer_germany_bundesliga',
  '268': 'soccer_uruguay_primera_division',
  '128': 'soccer_argentina_primera_division',
  '262': 'soccer_mexico_ligamx',
  '71':  'soccer_brazil_campeonato',
  '265': 'soccer_chile_campeonato',
  'CL':  'soccer_chile_campeonato',
};

// ── Team name normalization ─────────────────────────────────────────────────

function normTeam(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

function teamsMatch(a: string, b: string): boolean {
  const na = normTeam(a);
  const nb = normTeam(b);
  if (na === nb) return true;
  return na.includes(nb) || nb.includes(na);
}

// ── Probability extraction ──────────────────────────────────────────────────

function extractImpliedOdds(
  event: OddsEvent,
): ImpliedOdds | null {
  const homePrices: number[] = [];
  const drawPrices: number[] = [];
  const awayPrices: number[] = [];

  for (const bm of event.bookmakers) {
    const h2h = bm.markets.find((m) => m.key === 'h2h');
    if (!h2h) continue;

    let homeP: number | null = null;
    let drawP: number | null = null;
    let awayP: number | null = null;

    for (const outcome of h2h.outcomes) {
      if (outcome.name === 'Draw') {
        drawP = outcome.price;
      } else if (teamsMatch(outcome.name, event.home_team)) {
        homeP = outcome.price;
      } else if (teamsMatch(outcome.name, event.away_team)) {
        awayP = outcome.price;
      }
    }

    if (homeP !== null && drawP !== null && awayP !== null) {
      homePrices.push(homeP);
      drawPrices.push(drawP);
      awayPrices.push(awayP);
    }
  }

  if (homePrices.length === 0) return null;

  const avgHome = homePrices.reduce((a, b) => a + b, 0) / homePrices.length;
  const avgDraw = drawPrices.reduce((a, b) => a + b, 0) / drawPrices.length;
  const avgAway = awayPrices.reduce((a, b) => a + b, 0) / awayPrices.length;

  // Convert to implied probabilities (1/decimal) and de-vig by normalizing
  const rawHome = 1 / avgHome;
  const rawDraw = 1 / avgDraw;
  const rawAway = 1 / avgAway;
  const total = rawHome + rawDraw + rawAway;

  return {
    probHome: rawHome / total,
    probDraw: rawDraw / total,
    probAway: rawAway / total,
    bookmakerCount: homePrices.length,
    homeTeamName: event.home_team,
    awayTeamName: event.away_team,
  };
}

// ── HistoricalOddsStore ─────────────────────────────────────────────────────

export class HistoricalOddsStore {
  private readonly cacheDir: string;
  /** In-memory cache: sport_key:date → events */
  private readonly fileCache = new Map<string, OddsEvent[]>();

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir ?? path.resolve(process.cwd(), 'cache/historical-odds');
  }

  /**
   * Look up historical pre-match odds for a match.
   *
   * @param compCode      Competition code (e.g. 'PD', 'PL', 'BL1', 'URU')
   * @param kickoffUtc    ISO-8601 UTC kickoff (e.g. '2024-08-31T17:00:00Z')
   * @param homeTeamName  Team name for disambiguation (optional)
   * @param awayTeamName  Team name for disambiguation (optional)
   */
  lookup(
    compCode: string,
    kickoffUtc: string,
    homeTeamName?: string,
    awayTeamName?: string,
  ): ImpliedOdds | null {
    const sportKey = COMP_CODE_TO_SPORT_KEY[compCode];
    if (!sportKey) return null;

    const date = kickoffUtc.slice(0, 10); // 'YYYY-MM-DD'
    const events = this._loadEvents(sportKey, date);
    if (!events) return null;

    const kickoffMs = new Date(kickoffUtc).getTime();

    // Find candidates by commence_time proximity
    const candidates = events.filter((e) => {
      const diff = Math.abs(new Date(e.commence_time).getTime() - kickoffMs);
      return diff <= KICKOFF_TOLERANCE_MS;
    });

    if (candidates.length === 0) return null;

    // If only one candidate at this time, use it directly
    if (candidates.length === 1) {
      return extractImpliedOdds(candidates[0]!);
    }

    // Multiple matches at the same time — try team name disambiguation
    if (homeTeamName && awayTeamName) {
      const exact = candidates.find(
        (e) => teamsMatch(e.home_team, homeTeamName) && teamsMatch(e.away_team, awayTeamName),
      );
      if (exact) return extractImpliedOdds(exact);

      // Partial: at least home team matches
      const partial = candidates.find(
        (e) => teamsMatch(e.home_team, homeTeamName) || teamsMatch(e.away_team, awayTeamName),
      );
      if (partial) return extractImpliedOdds(partial);
    }

    // Fallback: use first candidate (ambiguous — caller should log warning)
    return extractImpliedOdds(candidates[0]!);
  }

  /**
   * Returns true if a cache file exists for this (compCode, kickoffDate).
   */
  hasCacheFile(compCode: string, kickoffUtc: string): boolean {
    const sportKey = COMP_CODE_TO_SPORT_KEY[compCode];
    if (!sportKey) return false;
    const date = kickoffUtc.slice(0, 10);
    return fs.existsSync(path.join(this.cacheDir, sportKey, `${date}.json`));
  }

  /**
   * Returns coverage stats: how many (sportKey, date) pairs exist on disk.
   */
  coverageStats(): { sportKey: string; dates: number }[] {
    if (!fs.existsSync(this.cacheDir)) return [];
    const result: { sportKey: string; dates: number }[] = [];
    for (const sk of fs.readdirSync(this.cacheDir)) {
      const dir = path.join(this.cacheDir, sk);
      if (!fs.statSync(dir).isDirectory()) continue;
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
      result.push({ sportKey: sk, dates: files.length });
    }
    return result.sort((a, b) => a.sportKey.localeCompare(b.sportKey));
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _loadEvents(sportKey: string, date: string): OddsEvent[] | null {
    const key = `${sportKey}:${date}`;
    if (this.fileCache.has(key)) return this.fileCache.get(key)!;

    // Try exact date first, then scan backwards up to 5 days.
    // The historical endpoint returns all upcoming events (~5–14 days ahead),
    // so a cache file from D-5 still contains events for date D.
    const dateMs = new Date(`${date}T00:00:00Z`).getTime();
    for (let d = 0; d <= 5; d++) {
      const candidateDate = new Date(dateMs - d * 86400000).toISOString().slice(0, 10);
      const filePath = path.join(this.cacheDir, sportKey, `${candidateDate}.json`);
      if (!fs.existsSync(filePath)) continue;

      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw) as CacheFile;
        const events = data.events ?? [];
        // Cache under the requested date for fast re-lookup
        this.fileCache.set(key, events);
        return events;
      } catch {
        continue;
      }
    }
    return null;
  }
}
