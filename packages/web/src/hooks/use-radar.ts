import { useState, useEffect, useRef } from 'react';

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
  preMatchText?: string;
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

const POLL_LIVE_MS = 60_000;

/**
 * Hook that fetches the Radar editorial snapshot for the given competition+matchday.
 * Re-fetches whenever competitionId or matchday changes.
 * Polls every 60s when there is at least one IN_PLAY match.
 */
export function useRadar(competitionId: string | null, matchday: number | null): UseRadarResult {
  const [data, setData] = useState<RadarData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dataRef = useRef<RadarData | null>(null);

  useEffect(() => {
    if (!competitionId || !matchday) {
      setData(null);
      return;
    }

    const url = `/api/ui/radar?competitionId=${encodeURIComponent(competitionId)}&matchday=${matchday}`;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    async function fetchOnce(isInitial: boolean) {
      const controller = new AbortController();
      if (isInitial) setLoading(true);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as RadarData;
        if (!active) return;
        dataRef.current = json;
        setData(json);
        setError(null);
      } catch (err: unknown) {
        if (!active) return;
        if ((err as { name?: string }).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Error al cargar Radar');
        if (!dataRef.current) setData({ index: null, liveData: [], state: 'unavailable' });
      } finally {
        if (active && isInitial) setLoading(false);
      }

      if (!active) return;
      const hasLive = (dataRef.current?.liveData ?? []).some((m) => m.status === 'IN_PROGRESS');
      if (hasLive) {
        pollTimer = setTimeout(() => {
          void fetchOnce(false);
        }, POLL_LIVE_MS);
      }
    }

    void fetchOnce(true);

    return () => {
      active = false;
      if (pollTimer !== null) clearTimeout(pollTimer);
    };
  }, [competitionId, matchday]);

  return { data, loading, error };
}
