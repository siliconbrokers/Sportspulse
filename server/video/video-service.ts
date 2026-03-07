import { VIDEO_SOURCES } from './video-sources-config.js';
import type { LeagueKey } from './video-sources-config.js';
import { fetchChannelUploads, searchYouTubeVideos, fetchVideoAvailability } from './youtube-client.js';
import { isWithin48Hours, isBlockedByPolitics, isAvailableInRegion } from './video-filters.js';
import { selectTopVideos } from './video-relevance.js';
import { playlistItemToCandidate, searchItemToCandidate, toHighlight } from './video-normalizer.js';
import type { LeagueVideoHighlight } from './video-normalizer.js';
import { VideoCache } from './video-cache.js';
import type { VideoCandidate } from './video-relevance.js';

const LEAGUE_ORDER: LeagueKey[] = ['URU', 'LL', 'EPL', 'BUN'];

const MAX_VIDEOS_PER_LEAGUE = 3;

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

    // Estrategia principal — uploads del canal
    let channelHighlights: LeagueVideoHighlight[] = [];
    try {
      channelHighlights = await this.resolveFromChannel(leagueKey);
    } catch (channelErr) {
      const msg = channelErr instanceof Error ? channelErr.message : String(channelErr);
      console.warn(`[VideoService] ${leagueKey}: channel error, trying fallback — ${msg.slice(0, 80)}`);
    }

    if (channelHighlights.length > 0) {
      this.cache.set(leagueKey, channelHighlights);
      console.log(`[VideoService] ${leagueKey}: found ${channelHighlights.length} videos`);
      return { leagueKey, highlights: channelHighlights };
    }

    // Fallback — búsqueda libre si canal no devolvió resultados
    try {
      if (this.cache.canUseFallback(leagueKey)) {
        this.cache.markFallbackUsed(leagueKey);
        const fallbackHighlights = await this.resolveFromSearch(leagueKey);
        this.cache.set(leagueKey, fallbackHighlights);
        console.log(`[VideoService] ${leagueKey}: fallback found ${fallbackHighlights.length} videos`);
        return { leagueKey, highlights: fallbackHighlights };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[VideoService] ${leagueKey}: fallback error — ${msg}`);
    }

    this.cache.set(leagueKey, []);
    return { leagueKey, highlights: [] };
  }

  /**
   * Batch-checks video availability for the configured region and filters out
   * unavailable or non-embeddable videos. Falls back gracefully if the API call fails.
   */
  private async filterByRegion(candidates: VideoCandidate[]): Promise<VideoCandidate[]> {
    if (candidates.length === 0) return [];

    let availabilityMap;
    try {
      availabilityMap = await fetchVideoAvailability(
        candidates.map((c) => c.videoId),
        this.youtubeApiKey,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[VideoService] region check failed, skipping filter — ${msg.slice(0, 80)}`);
      return candidates; // optimistic fallback: return all if check fails
    }

    const filtered = candidates.filter((c) => {
      const avail = availabilityMap.get(c.videoId);
      const ok = isAvailableInRegion(avail, REGION_CODE);
      if (!ok) {
        console.log(`[VideoService] Filtered out video ${c.videoId} (not available in ${REGION_CODE}): "${c.title.slice(0, 60)}"`);
      }
      return ok;
    });

    return filtered;
  }

  private async resolveFromChannel(leagueKey: LeagueKey): Promise<LeagueVideoHighlight[]> {
    const config = VIDEO_SOURCES[leagueKey];
    const items = await fetchChannelUploads(config.channelId, this.youtubeApiKey, 20);

    const candidates = items
      .map(playlistItemToCandidate)
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .filter((c) => isWithin48Hours(c.publishedAtUtc))
      .filter((c) => !isBlockedByPolitics(c.title));

    const available = await this.filterByRegion(candidates);

    return selectTopVideos(available, MAX_VIDEOS_PER_LEAGUE)
      .map((c) => toHighlight(c, leagueKey, config.channelLabel));
  }

  private async resolveFromSearch(leagueKey: LeagueKey): Promise<LeagueVideoHighlight[]> {
    const config = VIDEO_SOURCES[leagueKey];
    const publishedAfter = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const requiredTerms = config.titleRequiredTerms.map((t) => t.toLowerCase());

    const matchesLeague = (title: string): boolean => {
      const lower = title.toLowerCase();
      return requiredTerms.some((t) => lower.includes(t));
    };

    const allCandidates = [];
    for (const query of config.fallbackSearchTerms) {
      const items = await searchYouTubeVideos(query, this.youtubeApiKey, publishedAfter, 5);
      const candidates = items
        .map(searchItemToCandidate)
        .filter((c): c is NonNullable<typeof c> => c !== null)
        .filter((c) => !isBlockedByPolitics(c.title))
        .filter((c) => matchesLeague(c.title));
      allCandidates.push(...candidates);
    }

    const available = await this.filterByRegion(allCandidates);

    return selectTopVideos(available, MAX_VIDEOS_PER_LEAGUE)
      .map((c) => toHighlight(c, leagueKey, 'YouTube'));
  }
}
