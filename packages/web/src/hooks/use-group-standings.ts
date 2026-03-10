import { useState, useEffect, useRef } from 'react';
import type { GroupStandingsDTO } from '../types/tournament.js';

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

const POLL_INTERVAL_MS = 60_000;

export function useGroupStandings(
  competitionId: string,
  enabled: boolean,
): UseGroupStandingsResult {
  const [data, setData] = useState<GroupStandingsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      return;
    }

    let cancelled = false;

    async function fetchData(isFirst: boolean) {
      if (isFirst) setLoading(true);
      setError(null);
      const params = new URLSearchParams({ competitionId });
      try {
        const res = await fetch(`/api/ui/group-standings?${params}`);
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.message || 'Failed to load group standings');
        }
        const json = await res.json();
        if (!cancelled && json) {
          setData({
            formatFamily: json.formatFamily,
            groups: json.groups as GroupStandingsDTO[],
            bestThirdsCount: json.bestThirdsCount ?? 0,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Something went wrong');
          setData(null);
        }
      } finally {
        if (!cancelled && isFirst) setLoading(false);
      }

      if (!cancelled) {
        timerRef.current = setTimeout(() => fetchData(false), POLL_INTERVAL_MS);
      }
    }

    fetchData(true);

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [competitionId, enabled]);

  return { data, loading, error };
}
