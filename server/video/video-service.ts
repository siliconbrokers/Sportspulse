import { VIDEO_SOURCES } from './video-sources-config.js';
import type { LeagueKey } from './video-sources-config.js';
import { fetchChannelUploads, searchYouTubeVideos, fetchVideoAvailability } from './youtube-client.js';
import { isWithinVideoWindow, isBlockedByPolitics, isAvailableInRegion } from './video-filters.js';
import { selectTopVideos } from './video-relevance.js';
import { playlistItemToCandidate, searchItemToCandidate, toHighlight } from './video-normalizer.js';
import type { LeagueVideoHighlight } from './video-normalizer.js';
import { VideoCache } from './video-cache.js';
import type { VideoCandidate } from './video-relevance.js';

const LEAGUE_ORDER: LeagueKey[] = ['URU', 'AR', 'LL', 'EPL', 'BUN', 'WC', 'CA', 'CLI'];

const MAX_VIDEOS_PER_LEAGUE = 4;

// Default region for availability checks. Can be overridden via YOUTUBE_REGION_CODE env var.
const REGION_CODE = process.env.YOUTUBE_REGION_CODE ?? 'UY';

export interface VideoBlock {
  leagueKey: LeagueKey;
  highlights: LeagueVideoHighlight[];
  error?: string;
}

export interface VideoFeedDTO {
  blocks: VideoBlock[];
  fetchedAtUtc: string;
}

export class VideoService {
  private cache = new VideoCache();

  constructor(private readonly youtubeApiKey: string) {}

  async getVideoFeed(): Promise<VideoFeedDTO> {
    const blocks = await Promise.all(LEAGUE_ORDER.map((k) => this.getBlock(k)));
    return { blocks, fetchedAtUtc: new Date().toISOString() };
  }

  private async getBlock(leagueKey: LeagueKey): Promise<VideoBlock> {
    const cached = this.cache.get(leagueKey);
    if (cached) {
      return { leagueKey, highlights: cached.highlights, error: cached.error };
    }

    const config = VIDEO_SOURCES[leagueKey];
    if (!config.enabled || !this.youtubeApiKey) {
      return { leagueKey, highlights: [] };
    }

    let highlights: LeagueVideoHighlight[] = [];

    // Paso 1 — uploads del canal (omitido si searchOnly=true)
    if (!config.searchOnly) {
      try {
        highlights = await this.resolveFromChannel(leagueKey);
        console.log(`[VideoService] ${leagueKey}: channel → ${highlights.length} videos`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[VideoService] ${leagueKey}: channel error — ${msg.slice(0, 80)}`);
      }
    }

    // Paso 2 — búsqueda libre para completar slots que el canal no llenó
    // Gated by per-league per-day limit (each search.list costs 100 YouTube API units)
    if (highlights.length < MAX_VIDEOS_PER_LEAGUE) {
      if (!this.cache.canUseFallback(leagueKey)) {
        console.log(`[VideoService] ${leagueKey}: search skipped — daily fallback limit reached`);
      } else {
        try {
          const seenIds = new Set(highlights.map((h) => h.videoId));
          const needed = MAX_VIDEOS_PER_LEAGUE - highlights.length;
          const searchResults = await this.resolveFromSearch(leagueKey);
          const additional = searchResults.filter((h) => !seenIds.has(h.videoId)).slice(0, needed);
          highlights = [...highlights, ...additional];
          console.log(`[VideoService] ${leagueKey}: search added ${additional.length} → total ${highlights.length}`);
          this.cache.markFallbackUsed(leagueKey);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[VideoService] ${leagueKey}: search error — ${msg}`);
        }
      }
    }

    this.cache.set(leagueKey, highlights);
    return { leagueKey, highlights };
  }

  /**
   * Batch-checks video availability via videos.list and filters out unavailable videos.
   *
   * Key insight: if a video ID is NOT returned by the API, YouTube itself considered
   * it unavailable (deleted, private, or geo-blocked via content-ID). We treat missing
   * entries as blocked — not as "probably fine".
   *
   * Falls back to returning all candidates only if the API call itself fails.
   */
  private async filterByRegion(candidates: VideoCandidate[]): Promise<VideoCandidate[]> {
    if (candidates.length === 0) return [];

    let availabilityMap = new Map<string, import('./youtube-client.js').YtVideoAvailability>();
    let apiCallSucceeded = false;
    try {
      availabilityMap = await fetchVideoAvailability(
        candidates.map((c) => c.videoId),
        this.youtubeApiKey,
      );
      apiCallSucceeded = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[VideoService] region check failed, passing all through — ${msg.slice(0, 80)}`);
      return candidates;
    }

    const filtered = candidates.filter((c) => {
      const avail = availabilityMap.get(c.videoId);

      // Video not returned by YouTube API at all → treat as unavailable
      if (apiCallSucceeded && !avail) {
        console.log(`[VideoService] Filtered out ${c.videoId} (not in API response — likely geo-blocked): "${c.title.slice(0, 55)}"`);
        return false;
      }

      const ok = isAvailableInRegion(avail, REGION_CODE);
      if (!ok) {
        console.log(`[VideoService] Filtered out ${c.videoId} (region ${REGION_CODE} blocked): "${c.title.slice(0, 55)}"`);
      }
      return ok;
    });

    return filtered;
  }

  private async resolveFromChannel(leagueKey: LeagueKey): Promise<LeagueVideoHighlight[]> {
    const config = VIDEO_SOURCES[leagueKey];
    const extraIds = config.extraChannelIds ?? [];

    // Filtro de liga — se aplica a canales extra (multi-deporte); el canal principal es monotemático
    const requiredTerms = config.titleRequiredTerms.map((t) => t.toLowerCase());
    const matchesLeague = (title: string): boolean => {
      const lower = title.toLowerCase();
      return requiredTerms.some((t) => lower.includes(t));
    };

    const seenIds = new Set<string>();
    const allCandidates: VideoCandidate[] = [];

    // Canal principal — sin filtro de liga (es el canal oficial de la competición)
    if (config.channelId) {
      try {
        const items = await fetchChannelUploads(config.channelId, this.youtubeApiKey, 20);
        const candidates = items
          .map(playlistItemToCandidate)
          .filter((c): c is NonNullable<typeof c> => c !== null)
          .filter((c) => isWithinVideoWindow(c.publishedAtUtc))
          .filter((c) => !isBlockedByPolitics(c.title));
        for (const c of candidates) {
          seenIds.add(c.videoId);
          allCandidates.push(c);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[VideoService] ${leagueKey}: primary channel error — ${msg.slice(0, 80)}`);
      }
    }

    // Canales adicionales — se aplica filtro de liga; si están geo-bloqueados la región los descarta
    for (const channelId of extraIds) {
      try {
        const items = await fetchChannelUploads(channelId, this.youtubeApiKey, 20);
        const candidates = items
          .map(playlistItemToCandidate)
          .filter((c): c is NonNullable<typeof c> => c !== null)
          .filter((c) => !seenIds.has(c.videoId))
          .filter((c) => isWithinVideoWindow(c.publishedAtUtc))
          .filter((c) => !isBlockedByPolitics(c.title))
          .filter((c) => matchesLeague(c.title));
        for (const c of candidates) {
          seenIds.add(c.videoId);
          allCandidates.push(c);
        }
        console.log(`[VideoService] ${leagueKey}: extra channel ${channelId} → ${candidates.length} candidates`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[VideoService] ${leagueKey}: extra channel ${channelId} error — ${msg.slice(0, 80)}`);
      }
    }

    const available = await this.filterByRegion(allCandidates);

    return selectTopVideos(available, MAX_VIDEOS_PER_LEAGUE)
      .map((c) => toHighlight(c, leagueKey, config.channelLabel));
  }

  private async resolveFromSearch(leagueKey: LeagueKey): Promise<LeagueVideoHighlight[]> {
    const config = VIDEO_SOURCES[leagueKey];
    const publishedAfter = new Date(Date.now() - 96 * 60 * 60 * 1000).toISOString();
    const requiredTerms = config.titleRequiredTerms.map((t) => t.toLowerCase());

    const matchesLeague = (title: string): boolean => {
      const lower = title.toLowerCase();
      return requiredTerms.some((t) => lower.includes(t));
    };

    const allCandidates = [];
    const seenVideoIds = new Set<string>();
    for (const query of config.fallbackSearchTerms) {
      const items = await searchYouTubeVideos(query, this.youtubeApiKey, publishedAfter, 8);
      const candidates = items
        .map(searchItemToCandidate)
        .filter((c): c is NonNullable<typeof c> => c !== null)
        .filter((c) => !seenVideoIds.has(c.videoId))
        .filter((c) => !isBlockedByPolitics(c.title))
        .filter((c) => matchesLeague(c.title));
      for (const c of candidates) seenVideoIds.add(c.videoId);
      allCandidates.push(...candidates);
    }

    const available = await this.filterByRegion(allCandidates);

    return selectTopVideos(available, MAX_VIDEOS_PER_LEAGUE)
      .map((c) => toHighlight(c, leagueKey, 'YouTube'));
  }
}
