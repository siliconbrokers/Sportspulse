import { useState, useEffect } from 'react';

export interface TopScorerEntry {
  rank: number;
  playerName: string;
  teamName: string;
  teamCrestUrl?: string | null;
  goals: number;
  assists: number;
  penalties: number;
}

interface UseScorersResult {
  data: TopScorerEntry[] | null;
  loading: boolean;
}

export function useScorers(competitionId: string, enabled: boolean): UseScorersResult {
  const [data, setData] = useState<TopScorerEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const params = new URLSearchParams({ competitionId });
    fetch(`/api/ui/scorers?${params}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((json) => {
        if (!cancelled) setData(json.scorers ?? []);
      })
      .catch(() => {
        if (!cancelled) setData([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [competitionId, enabled]);

  return { data, loading };
}
