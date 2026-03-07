import { useState, useEffect, useCallback } from 'react';
import type { DashboardSnapshotDTO } from '../types/snapshot.js';

interface UseDashboardSnapshotResult {
  data: DashboardSnapshotDTO | null;
  loading: boolean;
  error: string | null;
  source: string | null;
  refetch: () => void;
}

export function useDashboardSnapshot(
  competitionId: string,
  matchday: number | null,
  timezone: string,
): UseDashboardSnapshotResult {
  const [data, setData] = useState<DashboardSnapshotDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  // Incrementar trigger dispara un refetch manual sin cambiar los otros deps
  const [trigger, setTrigger] = useState(0);

  const refetch = useCallback(() => setTrigger((t) => t + 1), []);

  useEffect(() => {
    if (matchday === null) return;

    // AbortController cancela la request anterior cuando competitionId/matchday cambia
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      competitionId,
      matchday: String(matchday),
      timezone,
    });

    fetch(`/api/ui/dashboard?${params}`, { signal: controller.signal })
      .then(async (res) => {
        const snapshotSource = res.headers.get('X-Snapshot-Source');
        setSource(snapshotSource);
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          const msg = body?.error?.message;
          if (res.status === 400) throw new Error(msg || 'Invalid request');
          if (res.status === 404) throw new Error(msg || 'Competition not found');
          if (res.status === 503) throw new Error(msg || 'Service temporarily unavailable');
          throw new Error(msg || 'Something went wrong');
        }
        return res.json() as Promise<DashboardSnapshotDTO>;
      })
      .then((json) => {
        setData(json);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Something went wrong');
        setData(null);
      })
      .finally(() => {
        // Solo apagar loading si esta request no fue abortada
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [competitionId, matchday, timezone, trigger]);

  // Auto-refresh adaptivo: 60s si hay partido LIVE, 2min si hay partido en <10min, 1h si no
  useEffect(() => {
    if (!data) return;

    const now = Date.now();
    const hasLive = data.matchCards.some((m) => m.status === 'LIVE');
    const hasImminent = data.matchCards.some((m) => {
      if (m.status !== 'SCHEDULED' || !m.kickoffUtc) return false;
      const diff = new Date(m.kickoffUtc).getTime() - now;
      return diff >= 0 && diff <= 10 * 60 * 1000;
    });

    const intervalMs = hasLive ? 60_000 : hasImminent ? 2 * 60_000 : 3_600_000;
    const interval = setInterval(() => setTrigger((t) => t + 1), intervalMs);
    return () => clearInterval(interval);
  }, [data]);

  return { data, loading, error, source, refetch };
}
