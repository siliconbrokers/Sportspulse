import { useState, useEffect } from 'react';

export interface NewsHeadline {
  id: string;
  leagueKey: string;
  title: string;
  url: string;
  imageUrl: string | null;
  sourceName: string;
  publishedAtUtc: string;
  competitionLabel: string;
}

export interface NewsBlock {
  leagueKey: string;
  competitionLabel: string;
  headlines: NewsHeadline[];
  error?: string;
}

export interface NewsFeed {
  blocks: NewsBlock[];
  fetchedAtUtc: string;
}

interface UseNewsResult {
  data: NewsFeed | null;
  loading: boolean;
  error: string | null;
}

export function useNews(enabled: boolean): UseNewsResult {
  const [data, setData] = useState<NewsFeed | null>(null);
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

    fetch('/api/ui/news')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<NewsFeed>;
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error al cargar noticias');
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
