import { useState, useEffect } from 'react';

export interface StandingEntry {
  position: number;
  teamId: string;
  teamName: string;
  tla?: string;
  crestUrl?: string;
  playedGames: number;
  won: number;
  draw: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  /** Presente en standings de torneos con grupos. Undefined para ligas. */
  groupId?: string;
  /** Badge semántico que viene de la API. Solo visual, no es motor de clasificación. */
  statusBadge?: string | null;
}

interface UseStandingsResult {
  data: StandingEntry[] | null;
  loading: boolean;
  error: string | null;
}

export function useStandings(
  competitionId: string,
  enabled: boolean,
  subTournamentKey?: string,
): UseStandingsResult {
  const [data, setData] = useState<StandingEntry[] | null>(null);
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

    const paramObj: Record<string, string> = { competitionId };
    if (subTournamentKey) paramObj.subTournament = subTournamentKey;
    const params = new URLSearchParams(paramObj);
    fetch(`/api/ui/standings?${params}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.message || 'Failed to load standings');
        }
        return res.json();
      })
      .then((json) => {
        if (!cancelled && json) setData(json.standings);
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
  }, [competitionId, enabled, subTournamentKey]);

  return { data, loading, error };
}
