import fs from 'node:fs';
import path from 'node:path';
import type { LeagueKey } from './video-sources-config.js';
import type { LeagueVideoHighlight } from './video-normalizer.js';

interface CacheEntry {
  highlights: LeagueVideoHighlight[];
  fetchedAtUtc: string;
  error?: string;
}

// 6 hours for success; errors 2 min for fast retry
const TTL_MS = 6 * 60 * 60 * 1000;
const ERROR_TTL_MS = 2 * 60 * 1000;

// Per-league per-day limit on fallback search (spec §6.2 — búsqueda libre costosa)
interface FallbackRecord {
  date: string; // YYYY-MM-DD
  used: boolean;
}

type FallbackDiskRecord = Partial<Record<LeagueKey, FallbackRecord>>;

function videoCacheDir(): string {
  return path.join(process.cwd(), 'cache', 'video');
}

function cacheFilePath(leagueKey: LeagueKey): string {
  return path.join(videoCacheDir(), `${leagueKey}.json`);
}

function fallbackFilePath(): string {
  return path.join(videoCacheDir(), '_fallback.json');
}

function ensureCacheDir(): void {
  try {
    fs.mkdirSync(videoCacheDir(), { recursive: true });
  } catch {
    // non-fatal
  }
}

function atomicWrite(filePath: string, data: unknown): void {
  const tmp = `${filePath}.tmp`;
  try {
    ensureCacheDir();
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  } catch {
    // non-fatal — clean up tmp if it exists
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export class VideoCache {
  private store = new Map<LeagueKey, CacheEntry>();
  private fallbackRecord = new Map<LeagueKey, FallbackRecord>();

  private isEntryFresh(entry: CacheEntry): boolean {
    const ttl = entry.error ? ERROR_TTL_MS : TTL_MS;
    return Date.now() - new Date(entry.fetchedAtUtc).getTime() <= ttl;
  }

  get(leagueKey: LeagueKey): CacheEntry | null {
    // 1. Try in-memory first
    const mem = this.store.get(leagueKey);
    if (mem && this.isEntryFresh(mem)) return mem;

    // 2. Try disk if in-memory miss or stale
    const disk = readJsonFile<CacheEntry>(cacheFilePath(leagueKey));
    if (disk && this.isEntryFresh(disk)) {
      // Warm the in-memory store from disk
      this.store.set(leagueKey, disk);
      return disk;
    }

    return null;
  }

  set(leagueKey: LeagueKey, highlights: LeagueVideoHighlight[], error?: string): void {
    const entry: CacheEntry = {
      highlights,
      fetchedAtUtc: new Date().toISOString(),
      error,
    };
    this.store.set(leagueKey, entry);
    atomicWrite(cacheFilePath(leagueKey), entry);
  }

  // Returns true if fallback search is allowed for this league today
  canUseFallback(leagueKey: LeagueKey): boolean {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo' }).format(new Date());

    // Check in-memory first
    const mem = this.fallbackRecord.get(leagueKey);
    if (mem) {
      if (mem.date !== today) return true;
      return !mem.used;
    }

    // Check disk if in-memory has no record
    const disk = readJsonFile<FallbackDiskRecord>(fallbackFilePath());
    if (disk) {
      const rec = disk[leagueKey];
      if (rec) {
        // Warm in-memory
        this.fallbackRecord.set(leagueKey, rec);
        if (rec.date !== today) return true;
        return !rec.used;
      }
    }

    return true;
  }

  markFallbackUsed(leagueKey: LeagueKey): void {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo' }).format(new Date());
    const rec: FallbackRecord = { date: today, used: true };
    this.fallbackRecord.set(leagueKey, rec);

    // Merge with existing disk record and persist
    const existing = readJsonFile<FallbackDiskRecord>(fallbackFilePath()) ?? {};
    existing[leagueKey] = rec;
    atomicWrite(fallbackFilePath(), existing);
  }
}
