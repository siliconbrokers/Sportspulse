/**
 * CrestCache — downloads team crest images to disk on first use.
 * Cached files are served via /api/crests/:filename.
 * On subsequent server starts the cache is reused (no re-download).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const CACHE_DIR = path.resolve(process.cwd(), 'cache', 'crests');

/** Returns the local filename for a given (provider, id) pair. */
function localFilename(provider: string, teamId: string, originalUrl: string): string {
  const ext = originalUrl.match(/\.(svg|png|jpg|jpeg|webp)(\?|$)/i)?.[1] ?? 'png';
  return `${provider}_${teamId}.${ext}`;
}

export class CrestCache {
  private readonly basePublicPath: string;

  constructor(basePublicPath = '/api/crests') {
    this.basePublicPath = basePublicPath;
  }

  /**
   * Warms up the cache for a list of teams.
   * Returns a map of teamId → local public URL (or original URL if download failed).
   * Non-blocking: errors are logged but don't throw.
   */
  async warmup(
    teams: { providerTeamId: string; crestUrl?: string }[],
    provider: string,
  ): Promise<Map<string, string>> {
    await fs.mkdir(CACHE_DIR, { recursive: true });

    const result = new Map<string, string>();

    // Sequential with small delay to avoid Wikimedia rate limiting (429)
    for (const team of teams) {
      await (async (team) => {
        if (!team.crestUrl) return;
        const filename = localFilename(provider, team.providerTeamId, team.crestUrl);
        const filePath = path.join(CACHE_DIR, filename);
        const publicUrl = `${this.basePublicPath}/${filename}`;

        // Already cached — use local URL
        try {
          await fs.access(filePath);
          result.set(team.providerTeamId, publicUrl);
          return;
        } catch {
          // Not cached yet — download
        }

        try {
          const res = await fetch(team.crestUrl, {
            headers: { 'User-Agent': 'SportsPulse/1.0' },
            signal: AbortSignal.timeout(8000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = Buffer.from(await res.arrayBuffer());
          // Atomic write: .tmp → rename
          const tmp = `${filePath}.tmp`;
          await fs.writeFile(tmp, buf);
          await fs.rename(tmp, filePath);
          result.set(team.providerTeamId, publicUrl);
          console.log(`[CrestCache] cached ${team.providerTeamId} → ${filename}`);
        } catch (err) {
          console.warn(`[CrestCache] failed to cache ${team.providerTeamId} (${team.crestUrl}):`, err);
          result.set(team.providerTeamId, team.crestUrl); // fallback to original
        }
      })(team);
      // Small delay between downloads to avoid rate limiting
      await new Promise((r) => setTimeout(r, 300));
    }

    return result;
  }

  /** Returns the absolute path to the cache directory (for Fastify static serving). */
  static get cacheDir(): string {
    return CACHE_DIR;
  }
}
