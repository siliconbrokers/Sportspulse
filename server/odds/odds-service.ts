/**
 * OddsService — fetches and normalizes market odds from The Odds API v4.
 *
 * Used ONLY for evaluation purposes (edge calculation).
 * Market odds never influence prediction engine outputs.
 *
 * MKT-T3-02 Fase A
 */

import { getGlobalProviderClient } from '@sportpulse/canonical';

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface ImpliedOdds {
  probHome: number;      // de-vigged, sums to 1.0 with draw and away
  probDraw: number;
  probAway: number;
  capturedAtUtc: string;
  bookmakerCount: number;  // how many bookmakers were averaged
  matchedOn: 'exact' | 'fuzzy';
}

// ── The Odds API response types ────────────────────────────────────────────────

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

// ── Constants ─────────────────────────────────────────────────────────────────

const SPORT_KEYS: Record<string, string> = {
  // Legacy IDs — kept for backward compatibility (AF_CANONICAL_ENABLED=false)
  'comp:football-data:PD':  'soccer_spain_la_liga',
  'comp:football-data:PL':  'soccer_epl',
  'comp:football-data:BL1': 'soccer_germany_bundesliga',
  'comp:thesportsdb:4432':  'soccer_uruguay_primera_division',
  // AF canonical IDs (AF_CANONICAL_ENABLED=true)
  'comp:apifootball:140':   'soccer_spain_la_liga',
  'comp:apifootball:39':    'soccer_epl',
  'comp:apifootball:78':    'soccer_germany_bundesliga',
  'comp:apifootball:268':   'soccer_uruguay_primera_division',
  'comp:apifootball:128':   'soccer_argentina_primera_division',
};

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const MATCH_WINDOW_MS = 2 * 60 * 60 * 1000; // ±2 hours for kickoff matching

// ── Text normalization for team name matching ─────────────────────────────────

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
  // Substring match for abbreviated names (e.g. "Bayer Leverkusen" vs "Leverkusen")
  return na.includes(nb) || nb.includes(na);
}

// ── Cache entry ────────────────────────────────────────────────────────────────

interface CacheEntry {
  fetchedAtMs: number;
  events: OddsEvent[];
}

// ── OddsService ────────────────────────────────────────────────────────────────

export class OddsService {
  private readonly apiKey: string | null;
  private readonly cache: Map<string, CacheEntry> = new Map();

  constructor() {
    const key = process.env.THE_ODDS_API_KEY;
    this.apiKey = key && key.trim().length > 0 ? key.trim() : null;
    if (!this.apiKey) {
      console.warn('[OddsService] THE_ODDS_API_KEY not set — market odds disabled');
    }
  }

  /**
   * Returns implied (de-vigged) odds for a specific match, or null if:
   * - API key not configured
   * - Competition not supported
   * - No matching event found
   * - Any fetch/parse error
   *
   * Never throws.
   */
  async getOddsForMatch(
    competitionId: string,
    kickoffUtc: string,
    homeTeamName: string,
    awayTeamName: string,
  ): Promise<ImpliedOdds | null> {
    if (!this.apiKey) return null;

    const sportKey = SPORT_KEYS[competitionId];
    if (!sportKey) {
      return null;
    }

    try {
      const events = await this._fetchEvents(sportKey);
      return this._matchEvent(events, kickoffUtc, homeTeamName, awayTeamName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[OddsService] error for ${competitionId} ${homeTeamName} vs ${awayTeamName}: ${msg}`);
      return null;
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private async _fetchEvents(sportKey: string): Promise<OddsEvent[]> {
    const now = Date.now();
    const cached = this.cache.get(sportKey);
    if (cached && now - cached.fetchedAtMs < CACHE_TTL_MS) {
      return cached.events;
    }

    const url = new URL(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds/`);
    url.searchParams.set('apiKey', this.apiKey!);
    url.searchParams.set('regions', 'eu');
    url.searchParams.set('markets', 'h2h');
    url.searchParams.set('oddsFormat', 'decimal');
    url.searchParams.set('dateFormat', 'iso');

    const client = getGlobalProviderClient();
    const urlStr = url.toString();
    const response = client
      ? await client.fetch(urlStr, {
          providerKey: 'the-odds-api',
          consumerType: 'PORTAL_RUNTIME',
          priorityTier: 'deferrable',
          moduleKey: 'odds-service',
          operationKey: 'sports-odds',
        })
      : await fetch(urlStr);

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
    }

    const events = (await response.json()) as OddsEvent[];
    this.cache.set(sportKey, { fetchedAtMs: now, events });
    console.log(`[OddsService] fetched ${events.length} events for ${sportKey}`);
    return events;
  }

  private _matchEvent(
    events: OddsEvent[],
    kickoffUtc: string,
    homeTeamName: string,
    awayTeamName: string,
  ): ImpliedOdds | null {
    const kickoffMs = new Date(kickoffUtc).getTime();
    const capturedAtUtc = new Date().toISOString();

    // Find events within ±2h of kickoff with matching team names
    let bestEvent: OddsEvent | null = null;
    let matchedOn: 'exact' | 'fuzzy' = 'fuzzy';

    for (const ev of events) {
      const evMs = new Date(ev.commence_time).getTime();
      if (Math.abs(evMs - kickoffMs) > MATCH_WINDOW_MS) continue;

      const homeMatch = teamsMatch(ev.home_team, homeTeamName);
      const awayMatch = teamsMatch(ev.away_team, awayTeamName);

      if (homeMatch && awayMatch) {
        // Prefer exact time match
        const normHome = normTeam(ev.home_team) === normTeam(homeTeamName);
        const normAway = normTeam(ev.away_team) === normTeam(awayTeamName);
        if (normHome && normAway) matchedOn = 'exact';
        bestEvent = ev;
        break;
      }
    }

    if (!bestEvent) return null;

    // Average prices across all bookmakers
    const homePrices: number[] = [];
    const drawPrices: number[] = [];
    const awayPrices: number[] = [];

    for (const bk of bestEvent.bookmakers) {
      const h2h = bk.markets.find((m) => m.key === 'h2h');
      if (!h2h) continue;

      for (const outcome of h2h.outcomes) {
        if (outcome.name === 'Draw') {
          drawPrices.push(outcome.price);
        } else if (teamsMatch(outcome.name, bestEvent.home_team)) {
          homePrices.push(outcome.price);
        } else if (teamsMatch(outcome.name, bestEvent.away_team)) {
          awayPrices.push(outcome.price);
        }
      }
    }

    if (homePrices.length === 0 || drawPrices.length === 0 || awayPrices.length === 0) {
      console.warn(`[OddsService] incomplete odds for ${homeTeamName} vs ${awayTeamName}`);
      return null;
    }

    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

    const avgHome = avg(homePrices);
    const avgDraw = avg(drawPrices);
    const avgAway = avg(awayPrices);

    // Convert to raw implied probabilities (1/decimal_odds)
    const rawHome = 1 / avgHome;
    const rawDraw = 1 / avgDraw;
    const rawAway = 1 / avgAway;

    // Normalize to remove vig (overround)
    const total = rawHome + rawDraw + rawAway;
    const probHome = rawHome / total;
    const probDraw = rawDraw / total;
    const probAway = rawAway / total;

    return {
      probHome,
      probDraw,
      probAway,
      capturedAtUtc,
      bookmakerCount: Math.min(homePrices.length, drawPrices.length, awayPrices.length),
      matchedOn,
    };
  }
}
