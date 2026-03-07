import { useState, useEffect } from 'react';

export interface LeagueVideoHighlight {
  id: string;
  leagueKey: string;
  title: string;
  videoId: string;
  videoUrl: string;
  embedUrl: string;
  thumbnailUrl: string | null;
  channelTitle: string;
  publishedAtUtc: string;
  sourceName: string;
}

export interface VideoBlock {
  leagueKey: string;
  highlight: LeagueVideoHighlight | null;
  error?: string;
}

export interface VideoFeed {
  blocks: VideoBlock[];
  fetchedAtUtc: string;
}

interface UseVideosResult {
  data: VideoFeed | null;
  loading: boolean;
  error: string | null;
}

export function useVideos(enabled: boolean): UseVideosResult {
  const [data, setData] = useState<VideoFeed | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch('/api/ui/videos')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<VideoFeed>;
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error al cargar videos');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { data, loading, error };
}
