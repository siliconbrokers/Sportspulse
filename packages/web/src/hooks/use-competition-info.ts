import { useState, useEffect } from 'react';

export interface SubTournamentInfo {
  key: string;
  label: string;
  isActive: boolean;
}

interface CompetitionInfo {
  currentMatchday: number | null;
  lastPlayedMatchday: number | null;
  nextMatchday: number | null;
  totalMatchdays: number;
  subTournaments: SubTournamentInfo[];
  activeSubTournament: string | null;
}

interface UseCompetitionInfoResult {
  data: CompetitionInfo | null;
  loading: boolean;
}

export function useCompetitionInfo(
  competitionId: string,
  subTournamentKey?: string,
): UseCompetitionInfoResult {
  const [data, setData] = useState<CompetitionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);

    const paramObj: Record<string, string> = { competitionId };
    if (subTournamentKey) paramObj.subTournament = subTournamentKey;
    const params = new URLSearchParams(paramObj);
    fetch(`/api/ui/competition-info?${params}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) return;
        return res.json();
      })
      .then((json) => {
        if (!cancelled && json) {
          setData({
            currentMatchday: json.currentMatchday ?? null,
            lastPlayedMatchday: json.lastPlayedMatchday ?? null,
            nextMatchday: json.nextMatchday ?? null,
            totalMatchdays: json.totalMatchdays ?? 38,
            subTournaments: json.subTournaments ?? [],
            activeSubTournament: json.activeSubTournament ?? null,
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [competitionId, subTournamentKey]);

  return { data, loading };
}
