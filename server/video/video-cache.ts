import type { LeagueKey } from './video-sources-config.js';
import type { LeagueVideoHighlight } from './video-normalizer.js';

interface CacheEntry {
  highlights: LeagueVideoHighlight[];
  fetchedAtUtc: string;
  error?: string;
}

// spec §15: TTL 30-60 min (usamos 45 min); errores 2 min para reintento rápido
const TTL_MS = 45 * 60 * 1000;
const ERROR_TTL_MS = 2 * 60 * 1000;

// Per-league per-day limit on fallback search (spec §6.2 — búsqueda libre costosa)
interface FallbackRecord {
  date: string; // YYYY-MM-DD
  used: boolean;
}

export class VideoCache {
  private store = new Map<LeagueKey, CacheEntry>();
  private fallbackRecord = new Map<LeagueKey, FallbackRecord>();

  get(leagueKey: LeagueKey): CacheEntry | null {
    const entry = this.store.get(leagueKey);
    if (!entry) return null;
    const ttl = entry.error ? ERROR_TTL_MS : TTL_MS;
    if (Date.now() - new Date(entry.fetchedAtUtc).getTime() > ttl) return null;
    return entry;
  }

  set(leagueKey: LeagueKey, highlights: LeagueVideoHighlight[], error?: string): void {
    this.store.set(leagueKey, {
      highlights,
      fetchedAtUtc: new Date().toISOString(),
      error,
    });
  }

  // Returns true if fallback search is allowed for this league today
  canUseFallback(leagueKey: LeagueKey): boolean {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo' }).format(new Date());
    const rec = this.fallbackRecord.get(leagueKey);
    if (!rec || rec.date !== today) return true;
    return !rec.used;
  }

  markFallbackUsed(leagueKey: LeagueKey): void {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo' }).format(new Date());
    this.fallbackRecord.set(leagueKey, { date: today, used: true });
  }
}
