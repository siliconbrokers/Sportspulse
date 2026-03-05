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
  dateLocal: string,
  timezone: string,
): UseDashboardSnapshotResult {
  const [data, setData] = useState<DashboardSnapshotDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);

  const fetchSnapshot = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ competitionId, dateLocal, timezone });
      const res = await fetch(`/api/ui/dashboard?${params}`);

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

      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [competitionId, dateLocal, timezone]);

  useEffect(() => {
    fetchSnapshot();
  }, [fetchSnapshot]);

  return { data, loading, error, source, refetch: fetchSnapshot };
}
