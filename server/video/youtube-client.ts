// YouTube Data API v3 — thin client
// Quota costs: playlistItems.list = 1 unit; search.list = 100 units; videos.list = 1 unit

import { getGlobalProviderClient } from '@sportpulse/canonical';

const YT_BASE = 'https://www.googleapis.com/youtube/v3';

export interface YtSnippet {
  publishedAt: string;       // ISO 8601
  title: string;
  description: string;
  channelTitle: string;
  thumbnails: {
    medium?: { url: string };
    high?:   { url: string };
    default?: { url: string };
  };
  resourceId?: { videoId: string };  // playlistItems
  videoId?: string;                  // search results (via id.videoId)
}

export interface YtPlaylistItem {
  snippet: YtSnippet;
}

export interface YtSearchItem {
  id: { videoId: string };
  snippet: YtSnippet;
}

// spec §6.1: obtener uploads recientes del canal (1 unit)
export async function fetchChannelUploads(
  channelId: string,
  apiKey: string,
  maxResults = 15,
): Promise<YtPlaylistItem[]> {
  // UC → UU trick for uploads playlist
  if (!channelId.startsWith('UC')) {
    throw new Error(`Invalid channel ID format: ${channelId}`);
  }
  const uploadsPlaylistId = 'UU' + channelId.slice(2);

  const params = new URLSearchParams({
    part: 'snippet',
    playlistId: uploadsPlaylistId,
    maxResults: String(maxResults),
    key: apiKey,
  });

  const client = getGlobalProviderClient();
  const url = `${YT_BASE}/playlistItems?${params}`;
  const res = client
    ? await client.fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
        providerKey: 'youtube',
        consumerType: 'PORTAL_RUNTIME',
        priorityTier: 'product-critical',
        moduleKey: 'youtube-client',
        operationKey: 'playlistItems-list',
        quotaCost: 1,
      })
    : await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`YouTube playlistItems error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as { items?: YtPlaylistItem[] };
  return data.items ?? [];
}

// spec §6.2: búsqueda libre como fallback (100 units — usar con moderación)
export async function searchYouTubeVideos(
  query: string,
  apiKey: string,
  publishedAfter: string, // ISO 8601
  maxResults = 5,
): Promise<YtSearchItem[]> {
  const params = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    videoEmbeddable: 'true',
    order: 'date',
    publishedAfter,
    maxResults: String(maxResults),
    key: apiKey,
  });

  const client = getGlobalProviderClient();
  const searchUrl = `${YT_BASE}/search?${params}`;
  const res = client
    ? await client.fetch(searchUrl, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
        providerKey: 'youtube',
        consumerType: 'PORTAL_RUNTIME',
        priorityTier: 'product-critical',
        moduleKey: 'youtube-client',
        operationKey: 'search-list',
        quotaCost: 100,
      })
    : await fetch(searchUrl, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`YouTube search error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as { items?: YtSearchItem[] };
  return data.items ?? [];
}

export function extractThumbnail(thumbnails: YtSnippet['thumbnails']): string | null {
  return thumbnails.high?.url ?? thumbnails.medium?.url ?? thumbnails.default?.url ?? null;
}

// ── videos.list — region availability check (1 unit per batch, up to 50 IDs) ──

export interface YtVideoAvailability {
  videoId: string;
  embeddable: boolean;
  /** Regions where this video is explicitly blocked */
  blockedRegions: string[];
  /** If non-empty, video is ONLY available in these regions */
  allowedRegions: string[];
}

/**
 * Batch-checks availability of up to 50 video IDs.
 * Uses contentDetails.regionRestriction + status.embeddable.
 * Costs 1 quota unit per call.
 */
export async function fetchVideoAvailability(
  videoIds: string[],
  apiKey: string,
): Promise<Map<string, YtVideoAvailability>> {
  if (videoIds.length === 0) return new Map();

  const params = new URLSearchParams({
    part: 'contentDetails,status',
    id: videoIds.slice(0, 50).join(','),
    key: apiKey,
  });

  const client = getGlobalProviderClient();
  const videosUrl = `${YT_BASE}/videos?${params}`;
  const res = client
    ? await client.fetch(videosUrl, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
        providerKey: 'youtube',
        consumerType: 'PORTAL_RUNTIME',
        priorityTier: 'product-critical',
        moduleKey: 'youtube-client',
        operationKey: 'videos-list',
        quotaCost: 1,
      })
    : await fetch(videosUrl, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`YouTube videos.list error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as {
    items?: Array<{
      id: string;
      status?: { embeddable?: boolean };
      contentDetails?: {
        regionRestriction?: {
          blocked?: string[];
          allowed?: string[];
        };
      };
    }>;
  };

  const result = new Map<string, YtVideoAvailability>();
  for (const item of data.items ?? []) {
    result.set(item.id, {
      videoId: item.id,
      embeddable: item.status?.embeddable !== false,
      blockedRegions: item.contentDetails?.regionRestriction?.blocked ?? [],
      allowedRegions: item.contentDetails?.regionRestriction?.allowed ?? [],
    });
  }
  return result;
}
