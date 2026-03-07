import { useState, useEffect } from 'react';

// ── Types mirroring the API response ─────────────────────────────────────────

export interface RadarCardEntry {
  matchId: string;
  editorialRank: number;
  editorialState: 'PRE_MATCH' | 'IN_PLAY' | 'POST_MATCH';
  labelKey: string;
  labelText: string;
  preMatchText: string;
  hasVerdict: boolean;
  verdict: 'CONFIRMED' | 'PARTIAL' | 'REJECTED' | null;
  verdictTitle: string | null;
  verdictText: string | null;
  detailFile: string;
}

export interface RadarIndex {
  schemaVersion: number;
  module: string;
  competitionKey: string;
  seasonKey: string;
  matchday: number;
  radarKey: string;
  sectionTitle: string;
  sectionSubtitle: string;
  moduleState: 'READY_PRE_MATCH' | 'READY_MIXED' | 'READY_POST_MATCH' | 'EMPTY' | 'UNAVAILABLE';
  evidenceTier: 'BOOTSTRAP' | 'EARLY' | 'STABLE';
  dataQuality: string;
  policyVersion: number;
  generatedAt: string;
  updatedAt: string;
  cardsCount: number;
  cards: RadarCardEntry[];
}

export interface RadarLiveMatchData {
  matchId: string;
  status: string;
  scoreHome: number | null;
  scoreAway: number | null;
  startTimeUtc: string | null;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  homeTeamCrest?: string;
  awayTeamCrest?: string;
  probHomeWin?: number;
  probDraw?: number;
  probAwayWin?: number;
}

export interface RadarData {
  index: RadarIndex | null;
  liveData: RadarLiveMatchData[];
  state: 'ok' | 'empty' | 'unavailable';
}

interface UseRadarResult {
  data: RadarData | null;
  loading: boolean;
  error: string | null;
}

/**
 * Hook that fetches the Radar editorial snapshot for the given competition+matchday.
 * Re-fetches whenever competitionId or matchday changes.
 */
export function useRadar(competitionId: string | null, matchday: number | null): UseRadarResult {
  const [data, setData] = useState<RadarData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!competitionId || !matchday) {
      setData(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const url = `/api/ui/radar?competitionId=${encodeURIComponent(competitionId)}&matchday=${matchday}`;

    fetch(url, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<RadarData>;
      })
      .then((json) => {
        if (!controller.signal.aborted) setData(json);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Error al cargar Radar');
        setData({ index: null, liveData: [], state: 'unavailable' });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [competitionId, matchday]);

  return { data, loading, error };
}
