import { useState, useEffect } from 'react';
import type { GroupStandingsDTO } from '../types/tournament.js';
import type { StandingEntry } from './use-standings.js';

export interface GroupStandingsResult {
  formatFamily: string;
  groups: GroupStandingsDTO[];
  bestThirdsCount: number;
}

interface UseGroupStandingsResult {
  data: GroupStandingsResult | null;
  loading: boolean;
  error: string | null;
}

export function useGroupStandings(
  competitionId: string,
  enabled: boolean,
): UseGroupStandingsResult {
  const [data, setData] = useState<GroupStandingsResult | null>(null);
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

    const params = new URLSearchParams({ competitionId });
    fetch(`/api/ui/group-standings?${params}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.message || 'Failed to load group standings');
        }
        return res.json();
      })
      .then((json) => {
        if (!cancelled && json) {
          setData({
            formatFamily: json.formatFamily,
            groups: json.groups as GroupStandingsDTO[],
            bestThirdsCount: json.bestThirdsCount ?? 0,
          });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Something went wrong');
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [competitionId, enabled]);

  return { data, loading, error };
}
