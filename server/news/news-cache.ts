import type { NewsHeadline, LeagueKey } from './types.js';

interface CacheEntry {
  headlines: NewsHeadline[];
  fetchedAtUtc: string;
  dayKey: string; // "2026-03-06" in America/Montevideo
  error?: string;
}

// spec §17: caché 30-60 min; URU=30min (RSS without quota), GNews=60min (100 req/day limit)
const TTL_MS: Record<LeagueKey, number> = {
  URU: 30 * 60 * 1000,
  AR:  60 * 60 * 1000,
  LL:  60 * 60 * 1000,
  EPL: 60 * 60 * 1000,
  BUN: 60 * 60 * 1000,
  WC:  60 * 60 * 1000,
  CA:  60 * 60 * 1000,
  CLI: 60 * 60 * 1000,
};

function todayKeyMontevideo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo' }).format(new Date());
}

export class NewsCache {
  private store = new Map<LeagueKey, CacheEntry>();

  get(leagueKey: LeagueKey): CacheEntry | null {
    const entry = this.store.get(leagueKey);
    if (!entry) return null;
    // Invalidate on day change (spec §17)
    if (entry.dayKey !== todayKeyMontevideo()) return null;
    // Errors expire quickly (2 min) so the next request retries
    const ttl = entry.error ? 2 * 60 * 1000 : TTL_MS[leagueKey];
    if (Date.now() - new Date(entry.fetchedAtUtc).getTime() > ttl) return null;
    return entry;
  }

  set(leagueKey: LeagueKey, headlines: NewsHeadline[], error?: string): void {
    this.store.set(leagueKey, {
      headlines,
      fetchedAtUtc: new Date().toISOString(),
      dayKey: todayKeyMontevideo(),
      error,
    });
  }
}
