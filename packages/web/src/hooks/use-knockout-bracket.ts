import { useState, useEffect, useRef } from 'react';
import type { BracketViewDTO } from '../types/tournament.js';

interface UseKnockoutBracketResult {
  data: BracketViewDTO | null;
  loading: boolean;
  error: string | null;
}

const POLL_INTERVAL_MS = 60_000;

export function useKnockoutBracket(
  competitionId: string,
  enabled: boolean,
): UseKnockoutBracketResult {
  const [data, setData] = useState<BracketViewDTO | null>(null);
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
        const res = await fetch(`/api/ui/bracket?${params}`);
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.message || 'Failed to load bracket');
        }
        const json = await res.json();
        if (!cancelled && json) {
          setData(json as BracketViewDTO);
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
