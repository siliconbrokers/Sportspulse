/**
 * useMatchIncidents — fetch de incidentes de partido.
 *
 * Polling adaptativo:
 *   IN_PROGRESS (canónico) → cada 90 segundos
 *   FINISHED               → una sola vez (sin polling)
 *   SCHEDULED              → nunca
 */
import { useState, useEffect, useRef } from 'react';
import type { IncidentEvent, SnapshotType } from '../types/incidents.js';

export interface MatchIncidentsParams {
  matchId: string | null | undefined;
  status: string | null | undefined;
  homeScore?: number | null;
  awayScore?: number | null;
  competitionId?: string | null;
  kickoffUtc?: string | null;
  homeTeamName?: string | null;
  awayTeamName?: string | null;
  matchday?: number | null;
}

export interface MatchIncidentsResult {
  matchId: string;
  snapshotType: SnapshotType | null;
  isFinal?: boolean;
  events: IncidentEvent[];
  quotaExhausted?: boolean;
}

export interface UseMatchIncidentsReturn {
  data: MatchIncidentsResult | null;
  loading: boolean;
  error: string | null;
}

const LIVE_POLL_MS = 90_000;

function isActive(status: string | null | undefined): boolean {
  // 'IN_PROGRESS' es el estado canónico para partidos en vivo (TheSportsDB y football-data).
  // 'LIVE' y 'HT' se mantienen por compatibilidad con snapshots anteriores.
  return status === 'IN_PROGRESS' || status === 'LIVE' || status === 'HT' || status === 'PAUSED';
}

function buildUrl(params: MatchIncidentsParams): string {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.homeScore != null) q.set('homeScore', String(params.homeScore));
  if (params.awayScore != null) q.set('awayScore', String(params.awayScore));
  if (params.competitionId) q.set('competitionId', params.competitionId);
  if (params.kickoffUtc) q.set('kickoffUtc', params.kickoffUtc);
  if (params.homeTeamName) q.set('homeTeamName', params.homeTeamName);
  if (params.awayTeamName) q.set('awayTeamName', params.awayTeamName);
  if (params.matchday != null) q.set('matchday', String(params.matchday));
  const encodedId = encodeURIComponent(params.matchId!);
  return `/api/ui/match/${encodedId}/incidents?${q.toString()}`;
}

export function useMatchIncidents(params: MatchIncidentsParams): UseMatchIncidentsReturn {
  const [data, setData] = useState<MatchIncidentsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { matchId, status } = params;

  useEffect(() => {
    // No hay partido o está programado → limpiar
    if (!matchId || status === 'SCHEDULED' || !status) {
      setData(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetch_() {
      if (cancelled) return;
      setLoading((prev) => (prev ? prev : true));

      try {
        const res = await fetch(buildUrl(params));

        if (res.status === 204) {
          if (!cancelled) {
            setData(null);
            setLoading(false);
          }
          return;
        }

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as MatchIncidentsResult;

        if (!cancelled) {
          setData(json);
          setError(null);
          setLoading(false);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error al cargar incidentes');
          setLoading(false);
        }
      }

      // Schedule next poll if active
      if (!cancelled && isActive(status)) {
        timerRef.current = setTimeout(fetch_, LIVE_POLL_MS);
      }
    }

    fetch_();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [matchId, status, params.homeScore, params.awayScore]);

  return { data, loading, error };
}
