import { useState, useEffect } from 'react';
import type { TeamDetailDTO } from '../types/team-detail.js';

interface UseTeamDetailResult {
  data: TeamDetailDTO | null;
  loading: boolean;
  error: string | null;
}

export function useTeamDetail(
  competitionId: string,
  teamId: string | null,
  matchday: number | null,
  timezone: string,
  /** Fecha local YYYY-MM-DD — alternativa a matchday para partidos de torneo sin jornada */
  dateLocal?: string | null,
  /** Sub-tournament key (e.g. 'CLAUSURA') — required for Liga MX to scope the correct opponent */
  subTournamentKey?: string | null,
): UseTeamDetailResult {
  const [data, setData] = useState<TeamDetailDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);

  useEffect(() => {
    // Necesita teamId + (matchday ó dateLocal)
    if (!teamId || (matchday === null && !dateLocal)) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    // Solo mostrar spinner en el fetch inicial (trigger === 0), no en re-fetches silenciosos
    if (trigger === 0) setLoading(true);
    setError(null);

    const params = new URLSearchParams({ competitionId, teamId, timezone });
    if (matchday !== null) {
      params.set('matchday', String(matchday));
    } else if (dateLocal) {
      params.set('dateLocal', dateLocal);
    }
    if (subTournamentKey) {
      params.set('subTournamentKey', subTournamentKey);
    }

    fetch(`/api/ui/team?${params}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.message || 'Failed to load team detail');
        }
        return res.json();
      })
      .then((json) => {
        if (!cancelled && json) setData(json);
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
  }, [competitionId, teamId, matchday, dateLocal, timezone, subTournamentKey, trigger]);

  // Polling adaptativo: 60s cuando el partido está IN_PROGRESS
  useEffect(() => {
    const matchStatus = data?.nextMatch?.matchStatus;
    if (matchStatus !== 'IN_PROGRESS') return;
    const interval = setInterval(() => setTrigger((t) => t + 1), 60_000);
    return () => clearInterval(interval);
  }, [data?.nextMatch?.matchStatus]);

  // Reset trigger cuando cambia el equipo o la jornada
  useEffect(() => {
    setTrigger(0);
  }, [teamId, matchday, dateLocal]);

  return { data, loading, error };
}
