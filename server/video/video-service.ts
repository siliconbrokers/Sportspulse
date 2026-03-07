import { VIDEO_SOURCES } from './video-sources-config.js';
import type { LeagueKey } from './video-sources-config.js';
import { fetchChannelUploads, searchYouTubeVideos } from './youtube-client.js';
import { isWithin48Hours, isBlockedByPolitics } from './video-filters.js';
import { selectBestVideo } from './video-relevance.js';
import { playlistItemToCandidate, searchItemToCandidate, toHighlight } from './video-normalizer.js';
import type { LeagueVideoHighlight } from './video-normalizer.js';
import { VideoCache } from './video-cache.js';

const LEAGUE_ORDER: LeagueKey[] = ['URU', 'LL', 'EPL', 'BUN'];

export interface VideoBlock {
  leagueKey: LeagueKey;
  highlight: LeagueVideoHighlight | null;
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
    const blocks: VideoBlock[] = [];
    for (const leagueKey of LEAGUE_ORDER) {
      blocks.push(await this.getBlock(leagueKey));
    }
    return { blocks, fetchedAtUtc: new Date().toISOString() };
  }

  private async getBlock(leagueKey: LeagueKey): Promise<VideoBlock> {
    const cached = this.cache.get(leagueKey);
    if (cached) {
      return { leagueKey, highlight: cached.highlight, error: cached.error };
    }

    const config = VIDEO_SOURCES[leagueKey];
    if (!config.enabled || !this.youtubeApiKey) {
      return { leagueKey, highlight: null };
    }

    // spec §6.1: estrategia principal — uploads del canal
    let channelHighlight: LeagueVideoHighlight | null = null;
    try {
      channelHighlight = await this.resolveFromChannel(leagueKey);
    } catch (channelErr) {
      const msg = channelErr instanceof Error ? channelErr.message : String(channelErr);
      console.warn(`[VideoService] ${leagueKey}: channel error, trying fallback — ${msg.slice(0, 80)}`);
    }

    if (channelHighlight) {
      this.cache.set(leagueKey, channelHighlight);
      console.log(`[VideoService] ${leagueKey}: found "${channelHighlight.title}"`);
      return { leagueKey, highlight: channelHighlight };
    }

    // spec §6.2: fallback — búsqueda libre si canal no devolvió resultado
    try {
      if (this.cache.canUseFallback(leagueKey)) {
        this.cache.markFallbackUsed(leagueKey);
        const fallbackHighlight = await this.resolveFromSearch(leagueKey);
        this.cache.set(leagueKey, fallbackHighlight);
        if (fallbackHighlight) {
          console.log(`[VideoService] ${leagueKey}: fallback found "${fallbackHighlight.title}"`);
        } else {
          console.log(`[VideoService] ${leagueKey}: no video found`);
        }
        return { leagueKey, highlight: fallbackHighlight };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[VideoService] ${leagueKey}: fallback error — ${msg}`);
    }

    // spec §5: no hay video válido → null
    this.cache.set(leagueKey, null);
    return { leagueKey, highlight: null };
  }

  private async resolveFromChannel(leagueKey: LeagueKey): Promise<LeagueVideoHighlight | null> {
    const config = VIDEO_SOURCES[leagueKey];
    const items = await fetchChannelUploads(config.channelId, this.youtubeApiKey, 15);

    const candidates = items
      .map(playlistItemToCandidate)
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .filter((c) => isWithin48Hours(c.publishedAtUtc))
      .filter((c) => !isBlockedByPolitics(c.title));

    const best = selectBestVideo(candidates);
    if (!best) return null;
    return toHighlight(best, leagueKey, config.channelLabel);
  }

  private async resolveFromSearch(leagueKey: LeagueKey): Promise<LeagueVideoHighlight | null> {
    const config = VIDEO_SOURCES[leagueKey];
    const publishedAfter = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const requiredTerms = config.titleRequiredTerms.map((t) => t.toLowerCase());

    const matchesLeague = (title: string): boolean => {
      const lower = title.toLowerCase();
      return requiredTerms.some((t) => lower.includes(t));
    };

    let best = null;
    for (const query of config.fallbackSearchTerms) {
      const items = await searchYouTubeVideos(query, this.youtubeApiKey, publishedAfter, 5);
      const candidates = items
        .map(searchItemToCandidate)
        .filter((c): c is NonNullable<typeof c> => c !== null)
        .filter((c) => !isBlockedByPolitics(c.title))
        .filter((c) => matchesLeague(c.title));

      const candidate = selectBestVideo(candidates);
      if (candidate) {
        best = candidate;
        break;
      }
    }

    if (!best) return null;
    return toHighlight(best, leagueKey, 'YouTube');
  }
}
