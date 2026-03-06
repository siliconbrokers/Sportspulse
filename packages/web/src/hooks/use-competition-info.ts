import { useState, useEffect } from 'react';

interface CompetitionInfo {
  currentMatchday: number | null;
  lastPlayedMatchday: number | null;
  totalMatchdays: number;
}

interface UseCompetitionInfoResult {
  data: CompetitionInfo | null;
  loading: boolean;
}

export function useCompetitionInfo(competitionId: string): UseCompetitionInfoResult {
  const [data, setData] = useState<CompetitionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);

    const params = new URLSearchParams({ competitionId });
    fetch(`/api/ui/competition-info?${params}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) return;
        return res.json();
      })
      .then((json) => {
        if (!cancelled && json) {
          setData({
            currentMatchday: json.currentMatchday ?? null,
            lastPlayedMatchday: json.lastPlayedMatchday ?? null,
            totalMatchdays: json.totalMatchdays ?? 38,
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [competitionId]);

  return { data, loading };
}
