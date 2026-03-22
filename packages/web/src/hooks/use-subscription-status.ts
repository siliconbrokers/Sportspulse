// SPF-SUB-001 — Subscription status hook
// Branch: reingenieria/v2 · Acceptance: K-04
//
// Fetches GET /api/subscription/status when user is authenticated.
// Returns null data when anonymous (no error — anonymous is expected).
// AbortController cancels on unmount.
//
// Never import from pipeline packages.

import { useEffect, useState } from 'react';
import { useSession } from '../auth/SessionProvider.js';
import { apiClient } from '../api/client.js';
import type { SubscriptionStatusResponse } from '../types/auth.js';

export interface UseSubscriptionStatusResult {
  data: SubscriptionStatusResponse | null;
  loading: boolean;
  error: string | null;
}

export function useSubscriptionStatus(): UseSubscriptionStatusResult {
  const { sessionStatus } = useSession();
  const [data, setData] = useState<SubscriptionStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Only fetch when authenticated
    if (sessionStatus !== 'authenticated') {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    apiClient
      .getSubscriptionStatus({ signal: controller.signal })
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Error al cargar estado de suscripción.');
        setLoading(false);
      });

    return () => controller.abort();
  }, [sessionStatus]);

  return { data, loading, error };
}
