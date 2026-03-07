// spec §13: modelo de datos canónico LeagueVideoHighlight

import type { LeagueKey } from './video-sources-config.js';
import type { VideoCandidate } from './video-relevance.js';
import type { YtPlaylistItem, YtSearchItem } from './youtube-client.js';
import { extractThumbnail } from './youtube-client.js';

export interface LeagueVideoHighlight {
  id: string;
  leagueKey: LeagueKey;
  title: string;
  videoId: string;
  videoUrl: string;
  embedUrl: string;
  thumbnailUrl: string | null;
  channelTitle: string;
  publishedAtUtc: string;
  sourceName: string;
}

export function playlistItemToCandidate(item: YtPlaylistItem): VideoCandidate | null {
  const videoId = item.snippet.resourceId?.videoId;
  if (!videoId) return null;
  return {
    videoId,
    title: item.snippet.title ?? '',
    publishedAtUtc: item.snippet.publishedAt ?? '',
    channelTitle: item.snippet.channelTitle ?? '',
    thumbnailUrl: extractThumbnail(item.snippet.thumbnails),
  };
}

export function searchItemToCandidate(item: YtSearchItem): VideoCandidate | null {
  const videoId = item.id.videoId;
  if (!videoId) return null;
  return {
    videoId,
    title: item.snippet.title ?? '',
    publishedAtUtc: item.snippet.publishedAt ?? '',
    channelTitle: item.snippet.channelTitle ?? '',
    thumbnailUrl: extractThumbnail(item.snippet.thumbnails),
  };
}

export function toHighlight(
  candidate: VideoCandidate,
  leagueKey: LeagueKey,
  sourceName: string,
): LeagueVideoHighlight {
  return {
    id: candidate.videoId,
    leagueKey,
    title: candidate.title,
    videoId: candidate.videoId,
    videoUrl: `https://www.youtube.com/watch?v=${candidate.videoId}`,
    embedUrl: `https://www.youtube.com/embed/${candidate.videoId}?rel=0&modestbranding=1`,
    thumbnailUrl: candidate.thumbnailUrl,
    channelTitle: candidate.channelTitle,
    publishedAtUtc: candidate.publishedAtUtc,
    sourceName,
  };
}
