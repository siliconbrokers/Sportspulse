import { useState, useEffect } from 'react';
import type { RoundDTO } from '../types/tournament.js';

interface UseKnockoutBracketResult {
  data: RoundDTO[] | null;
  loading: boolean;
  error: string | null;
}

export function useKnockoutBracket(
  competitionId: string,
  enabled: boolean,
): UseKnockoutBracketResult {
  const [data, setData] = useState<RoundDTO[] | null>(null);
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
    fetch(`/api/ui/bracket?${params}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.message || 'Failed to load bracket');
        }
        return res.json();
      })
      .then((json) => {
        if (!cancelled && json) {
          setData(json.rounds as RoundDTO[]);
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
