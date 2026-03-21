/**
 * AfOddsService — fetches and normalizes market odds from API-Football v3.
 *
 * Uses the /odds endpoint with fixture ID for exact matching (no fuzzy team-name logic needed).
 * Averages all bookmakers that have a 'Match Winner' (1X2) bet.
 * De-vigs the averaged prices to produce implied probabilities summing to 1.0.
 *
 * Cache de dos niveles para minimizar requests al API:
 *   1. In-memory (MEM_TTL_MS = 2h) — acceso rápido dentro del mismo proceso.
 *   2. Disco (DISK_TTL_MS = 4h, cache/odds/{fixtureId}.json) — sobrevive reinicios de Render.
 *      Sin disco, cada redeploy re-fetcha las odds de todos los fixtures activos.
 *
 * SP-V4-10 — market odds activation via API-Football v3.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
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

const MEM_TTL_MS   = 2 * 60 * 60 * 1000;  // 2h  — memoria, cuando hay odds
const NULL_TTL_MS  = 30 * 60 * 1000;       // 30min — cuando no hay odds (confirmed no-odds)
const DISK_TTL_MS  = 4 * 60 * 60 * 1000;  // 4h  — disco, sobrevive reinicios de Render

const ODDS_CACHE_DIR = path.resolve(process.cwd(), 'cache', 'odds');

interface CacheEntry {
  fetchedAtMs: number;
  odds: ImpliedOdds | null; // null = confirmed no odds (short TTL)
}

// ── Disk cache helpers ─────────────────────────────────────────────────────────

interface OddsDiskDoc {
  version: 1;
  fixtureId: number;
  savedAt: string;
  odds: ImpliedOdds | null;
}

function oddsDiskPath(fixtureId: number): string {
  return path.join(ODDS_CACHE_DIR, `${fixtureId}.json`);
}

function readOddsFromDisk(fixtureId: number): CacheEntry | null {
  try {
    const raw = fs.readFileSync(oddsDiskPath(fixtureId), 'utf-8');
    const doc = JSON.parse(raw) as OddsDiskDoc;
    if (doc.version !== 1 || doc.fixtureId !== fixtureId) return null;
    const savedMs = new Date(doc.savedAt).getTime();
    const ttl = doc.odds !== null ? DISK_TTL_MS : NULL_TTL_MS;
    if (Date.now() - savedMs > ttl) return null;
    return { fetchedAtMs: savedMs, odds: doc.odds };
  } catch {
    return null;
  }
}

function writeOddsToDisk(fixtureId: number, odds: ImpliedOdds | null): void {
  const p = oddsDiskPath(fixtureId);
  const tmp = `${p}.tmp`;
  try {
    fs.mkdirSync(ODDS_CACHE_DIR, { recursive: true });
    const doc: OddsDiskDoc = {
      version: 1,
      fixtureId,
      savedAt: new Date().toISOString(),
      odds,
    };
    fs.writeFileSync(tmp, JSON.stringify(doc), 'utf-8');
    fs.renameSync(tmp, p);
  } catch { /* non-fatal */ }
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

    // Level 1: in-memory cache (fastest)
    const mem = this.cache.get(fixtureId);
    if (mem) {
      const ttl = mem.odds !== null ? MEM_TTL_MS : NULL_TTL_MS;
      if (now - mem.fetchedAtMs < ttl) return mem.odds;
    }

    // Level 2: disk cache (survives Render restarts)
    const disk = readOddsFromDisk(fixtureId);
    if (disk) {
      this.cache.set(fixtureId, disk);
      console.log(`[AfOddsService] fixture ${fixtureId}: DISK HIT`);
      return disk.odds;
    }

    // Level 3: API fetch
    try {
      const url = `https://v3.football.api-sports.io/odds?fixture=${fixtureId}`;
      const response = await fetch(url, {
        headers: { 'x-apisports-key': this.apiKey },
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.warn(`[AfOddsService] fixture ${fixtureId}: HTTP ${response.status} ${body.slice(0, 120)}`);
        const entry: CacheEntry = { fetchedAtMs: now, odds: null };
        this.cache.set(fixtureId, entry);
        writeOddsToDisk(fixtureId, null);
        return null;
      }

      const data = (await response.json()) as AfOddsResponse;

      if (!data.response || data.response.length === 0) {
        console.log(`[AfOddsService] fixture ${fixtureId}: no odds`);
        const entry: CacheEntry = { fetchedAtMs: now, odds: null };
        this.cache.set(fixtureId, entry);
        writeOddsToDisk(fixtureId, null);
        return null;
      }

      const afEntry = data.response[0];
      const result = this._parseEntry(afEntry);

      if (!result) {
        console.log(`[AfOddsService] fixture ${fixtureId}: no odds`);
        const entry: CacheEntry = { fetchedAtMs: now, odds: null };
        this.cache.set(fixtureId, entry);
        writeOddsToDisk(fixtureId, null);
        return null;
      }

      this.cache.set(fixtureId, { fetchedAtMs: now, odds: result });
      writeOddsToDisk(fixtureId, result);
      console.log(`[AfOddsService] fixture ${fixtureId}: ${result.bookmakerCount} bookmakers OK`);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[AfOddsService] fixture ${fixtureId}: fetch error — ${msg}`);
      const entry: CacheEntry = { fetchedAtMs: now, odds: null };
      this.cache.set(fixtureId, entry);
      writeOddsToDisk(fixtureId, null);
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
