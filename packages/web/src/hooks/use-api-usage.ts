/**
 * use-api-usage.ts
 * Fetching utilities for the Ops API Usage dashboard.
 * All types defined inline — no imports from backend packages.
 */
import { useState, useEffect, useRef } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProviderSummaryItem {
  providerKey: string;
  displayName: string;
  dailyLimit: number | null;
  monthlyLimit: number | null;
  monthlyUsed: number | null;
  usedUnitsObserved: number;
  effectiveUsedUnits?: number;
  dataSource?: 'PROVIDER_REPORTED' | 'LEDGER_OBSERVED';
  estimatedRemaining: number | null;
  providerReportedRemaining: number | null;
  discrepancyStatus: 'NONE' | 'MINOR' | 'MAJOR' | 'UNKNOWN';
  warningLevel: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'EXHAUSTED';
  lastSeenAtUtc: string | null;
  byConsumerType: { consumerType: string; usedUnits: number }[];
}

export interface TodayResponse {
  date: string;
  generatedAtUtc: string;
  providers: ProviderSummaryItem[];
}

export interface ApiUsageEventLite {
  id: string;
  providerKey: string;
  startedAtUtc: string;
  operationKey: string;
  consumerType: string;
  consumerId: string | null;
  statusCode: number | null;
  success: boolean;
  rateLimited: boolean;
  cacheHit: boolean;
  latencyMs: number;
  usageUnits: number;
  remoteRemaining: number | null;
  errorCode: string | null;
}

export interface ProviderDetailResponse {
  providerKey: string;
  percentUsed: number;
  warningLevel: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'EXHAUSTED';
  discrepancyStatus: 'NONE' | 'MINOR' | 'MAJOR' | 'UNKNOWN';
  topOperations: { operationKey: string; count: number; totalUnits: number }[];
  topConsumers: { consumerId: string; count: number; totalUnits: number }[];
  rateLimitIncidents: ApiUsageEventLite[];
}

export interface EventsResponse {
  events: ApiUsageEventLite[];
  count: number;
}

export interface EventsFilters {
  provider?: string;
  consumerType?: string;
  rateLimited?: boolean;
  success?: boolean;
  limit?: number;
}

// ─── Plain async fetch functions ─────────────────────────────────────────────

export async function fetchApiUsageToday(token: string): Promise<TodayResponse> {
  const res = await fetch('/api/internal/ops/api-usage/today', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<TodayResponse>;
}

export async function fetchProviderDetail(
  token: string,
  providerKey: string,
): Promise<ProviderDetailResponse> {
  const res = await fetch(
    `/api/internal/ops/api-usage/providers/${encodeURIComponent(providerKey)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<ProviderDetailResponse>;
}

export async function fetchApiUsageEvents(
  token: string,
  filters: EventsFilters,
): Promise<EventsResponse> {
  const params = new URLSearchParams();
  if (filters.provider) params.set('provider', filters.provider);
  if (filters.consumerType) params.set('consumerType', filters.consumerType);
  if (filters.rateLimited !== undefined) params.set('rateLimited', String(filters.rateLimited));
  if (filters.success !== undefined) params.set('success', String(filters.success));
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  const qs = params.toString();
  const url = `/api/internal/ops/api-usage/events${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<EventsResponse>;
}

// ─── React hook with optional polling ────────────────────────────────────────

interface UseApiUsageTodayResult {
  data: TodayResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useApiUsageToday(
  token: string | null,
  autoRefreshMs?: number,
): UseApiUsageTodayResult {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counterRef = useRef(0);

  const refetch = () => {
    counterRef.current += 1;
    setLoading(true);
  };

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchApiUsageToday(token)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Error desconocido');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // counterRef.current used as trigger for manual refetch
  }, [token, counterRef.current]);

  useEffect(() => {
    if (!token || !autoRefreshMs) return;
    const id = setInterval(() => {
      counterRef.current += 1;
      setLoading(true);
    }, autoRefreshMs);
    return () => clearInterval(id);
  }, [token, autoRefreshMs]);

  return { data, loading, error, refetch };
}
