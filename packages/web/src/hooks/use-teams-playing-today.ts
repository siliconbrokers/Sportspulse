import { useState, useEffect } from 'react';
import { getMatchDisplayStatus } from '../utils/match-status.js';

export interface TeamsPlayingResult {
  teamsPlayingToday: Set<string>;
  teamsPlayingLive: Set<string>;
}

export function useTeamsPlayingToday(
  competitionId: string,
  matchday: number | null,
  timezone: string,
): TeamsPlayingResult {
  const [result, setResult] = useState<TeamsPlayingResult>({
    teamsPlayingToday: new Set(),
    teamsPlayingLive: new Set(),
  });

  useEffect(() => {
    if (!matchday) return;
    let cancelled = false;
    const params = new URLSearchParams({
      competitionId,
      matchday: String(matchday),
      timezone,
    });
    fetch(`/api/ui/dashboard?${params}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const now = Date.now();
        const today = new Set<string>();
        const live = new Set<string>();
        for (const card of j.matchCards ?? []) {
          if (!card.kickoffUtc) continue;
          const hours = (new Date(card.kickoffUtc).getTime() - now) / (1000 * 60 * 60);
          if (hours >= 0 && hours < 24) {
            if (card.home?.teamId) today.add(card.home.teamId);
            if (card.away?.teamId) today.add(card.away.teamId);
          }
          // Live real: zombie guard aplicado — solo partidos en juego confirmados
          const ds = getMatchDisplayStatus(card.status, card.kickoffUtc);
          if (ds === 'LIVE') {
            if (card.home?.teamId) live.add(card.home.teamId);
            if (card.away?.teamId) live.add(card.away.teamId);
          }
        }
        setResult({ teamsPlayingToday: today, teamsPlayingLive: live });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [competitionId, matchday, timezone]);

  return result;
}
