// SPF-TR-001 — Hook for fetching prediction track record data.
// Acceptance: K-03
// Pattern mirrors use-standings.ts — AbortController on unmount.

import { useEffect, useState } from 'react';
import { apiClient } from '../api/client.js';
import type { TrackRecordResponse } from '../types/auth.js';

export interface UseTrackRecordResult {
  data: TrackRecordResponse | null;
  loading: boolean;
  error: string | null;
}

export function useTrackRecord(competitionId: string | null): UseTrackRecordResult {
  const [data, setData] = useState<TrackRecordResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!competitionId) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    apiClient
      .getTrackRecord(competitionId, { signal: controller.signal })
      .then((res) => {
        setData(res);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Error al cargar el historial');
        setData(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [competitionId]);

  return { data, loading, error };
}
