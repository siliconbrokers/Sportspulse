import { useState, useEffect } from 'react';
import type { TieDTO } from '../types/tournament.js';

export interface TournamentMatchItem {
  matchId: string;
  kickoffUtc: string | null;
  status: string;
  homeTeam: { teamId: string; name: string; crestUrl?: string };
  awayTeam: { teamId: string; name: string; crestUrl?: string };
  scoreHome: number | null;
  scoreAway: number | null;
  scoreHomeExtraTime?: number | null;
  scoreAwayExtraTime?: number | null;
  scoreHomePenalties?: number | null;
  scoreAwayPenalties?: number | null;
}

export interface TournamentRoundMatchesBlock {
  stageId: string;
  name: string;
  orderIndex: number;
  matches: TournamentMatchItem[];
  /**
   * Cruces del round con scores reconciliados con el overlay activo.
   * Presente para fases eliminatorias y previas (orderIndex ≠ 0).
   * Ausente para GROUP_STAGE.
   */
  ties?: TieDTO[];
}

export interface TournamentGroupMatchesBlock {
  groupId: string;
  name: string;
  orderIndex: number;
  matches: TournamentMatchItem[];
}

export interface TournamentMatchesData {
  rounds: TournamentRoundMatchesBlock[];
  groups: TournamentGroupMatchesBlock[];
  /** 1 = partido único (WC, CA), 2 = ida+vuelta (CLI). */
  legsPerTie: 1 | 2;
}

interface UseTournamentMatchesResult {
  data: TournamentMatchesData | null;
  loading: boolean;
  error: string | null;
}

const POLL_INTERVAL_MS = 60_000;

export function useTournamentMatches(competitionId: string): UseTournamentMatchesResult {
  const [data, setData] = useState<TournamentMatchesData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function fetchData(isFirst: boolean) {
      if (isFirst) setLoading(true);
      try {
        const params = new URLSearchParams({ competitionId });
        const res = await fetch(`/api/ui/tournament-matches?${params}`);
        if (cancelled) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as TournamentMatchesData;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error al cargar partidos');
      } finally {
        if (!cancelled && isFirst) setLoading(false);
      }
      if (!cancelled) {
        timer = setTimeout(() => fetchData(false), POLL_INTERVAL_MS);
      }
    }

    fetchData(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [competitionId]);

  return { data, loading, error };
}
