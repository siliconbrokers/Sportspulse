/**
 * AfOddsService — fetches and normalizes market odds from API-Football v3.
 *
 * Uses the /odds endpoint with fixture ID for exact matching (no fuzzy team-name logic needed).
 * Averages all bookmakers that have a 'Match Winner' (1X2) bet.
 * De-vigs the averaged prices to produce implied probabilities summing to 1.0.
 *
 * SP-V4-10 — market odds activation via API-Football v3.
 */

import type { ImpliedOdds } from './odds-service.js';

// ── API-Football response types ────────────────────────────────────────────────

interface AfOddsValue {
  value: 'Home' | 'Draw' | 'Away' | string;
  odd: string;
}

interface AfOddsBet {
  id: number;
  name: string;
  values: AfOddsValue[];
}

interface AfOddsBookmaker {
  id: number;
  name: string;
  bets: AfOddsBet[];
}

interface AfOddsEntry {
  fixture: { id: number };
  bookmakers: AfOddsBookmaker[];
}

interface AfOddsResponse {
  response: AfOddsEntry[];
}

// ── Cache ──────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS  = 2 * 60 * 60 * 1000; // 2h  — cuando hay odds
const NULL_TTL_MS   = 30 * 60 * 1000;      // 30min — cuando no hay odds (confirmed no-odds)

interface CacheEntry {
  fetchedAtMs: number;
  odds: ImpliedOdds | null; // null = confirmed no odds (short TTL)
}

// ── AfOddsService ──────────────────────────────────────────────────────────────

export class AfOddsService {
  private readonly apiKey: string | null;
  private readonly cache: Map<number, CacheEntry> = new Map();

  constructor(apiKey: string | null) {
    if (!apiKey || apiKey.trim().length === 0) {
      this.apiKey = null;
      console.warn('[AfOddsService] APIFOOTBALL_KEY not set — AF odds disabled');
    } else {
      this.apiKey = apiKey.trim();
    }
  }

  /**
   * Returns implied (de-vigged) odds for a specific fixture, or null if:
   * - API key not configured
   * - No bookmakers with Match Winner found
   * - Any fetch/parse error
   *
   * Never throws.
   */
  async getOddsForFixture(fixtureId: number): Promise<ImpliedOdds | null> {
    if (!this.apiKey) return null;

    const now = Date.now();
    const cached = this.cache.get(fixtureId);
    if (cached) {
      const ttl = cached.odds !== null ? CACHE_TTL_MS : NULL_TTL_MS;
      if (now - cached.fetchedAtMs < ttl) return cached.odds;
    }

    try {
      const url = `https://v3.football.api-sports.io/odds?fixture=${fixtureId}`;
      const response = await fetch(url, {
        headers: { 'x-apisports-key': this.apiKey },
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.warn(`[AfOddsService] fixture ${fixtureId}: HTTP ${response.status} ${body.slice(0, 120)}`);
        return null;
      }

      const data = (await response.json()) as AfOddsResponse;

      if (!data.response || data.response.length === 0) {
        console.log(`[AfOddsService] fixture ${fixtureId}: no odds`);
        this.cache.set(fixtureId, { fetchedAtMs: now, odds: null });
        return null;
      }

      const entry = data.response[0];
      const result = this._parseEntry(entry);

      if (!result) {
        console.log(`[AfOddsService] fixture ${fixtureId}: no odds`);
        this.cache.set(fixtureId, { fetchedAtMs: now, odds: null });
        return null;
      }

      this.cache.set(fixtureId, { fetchedAtMs: now, odds: result });
      console.log(`[AfOddsService] fixture ${fixtureId}: ${result.bookmakerCount} bookmakers OK`);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[AfOddsService] fixture ${fixtureId}: fetch error — ${msg}`);
      return null;
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _parseEntry(entry: AfOddsEntry): ImpliedOdds | null {
    const homePrices: number[] = [];
    const drawPrices: number[] = [];
    const awayPrices: number[] = [];

    for (const bk of entry.bookmakers) {
      const matchWinnerBet = bk.bets.find((b) => b.name === 'Match Winner');
      if (!matchWinnerBet) continue;

      const homeVal = matchWinnerBet.values.find((v) => v.value === 'Home');
      const drawVal = matchWinnerBet.values.find((v) => v.value === 'Draw');
      const awayVal = matchWinnerBet.values.find((v) => v.value === 'Away');

      if (!homeVal || !drawVal || !awayVal) continue;

      const homeOdd = parseFloat(homeVal.odd);
      const drawOdd = parseFloat(drawVal.odd);
      const awayOdd = parseFloat(awayVal.odd);

      if (!isFinite(homeOdd) || !isFinite(drawOdd) || !isFinite(awayOdd)) continue;
      if (homeOdd <= 0 || drawOdd <= 0 || awayOdd <= 0) continue;

      homePrices.push(homeOdd);
      drawPrices.push(drawOdd);
      awayPrices.push(awayOdd);
    }

    if (homePrices.length === 0) return null;

    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

    const avgHome = avg(homePrices);
    const avgDraw = avg(drawPrices);
    const avgAway = avg(awayPrices);

    // Convert to raw implied probabilities (1 / decimal_odds) and de-vig
    const rawHome = 1 / avgHome;
    const rawDraw = 1 / avgDraw;
    const rawAway = 1 / avgAway;
    const total = rawHome + rawDraw + rawAway;

    return {
      probHome: rawHome / total,
      probDraw: rawDraw / total,
      probAway: rawAway / total,
      capturedAtUtc: new Date().toISOString(),
      bookmakerCount: homePrices.length,
      matchedOn: 'exact',
    };
  }
}
