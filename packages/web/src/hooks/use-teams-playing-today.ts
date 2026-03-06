import { useState, useEffect } from 'react';

export function useTeamsPlayingToday(
  competitionId: string,
  matchday: number | null,
  timezone: string,
): Set<string> {
  const [teams, setTeams] = useState<Set<string>>(new Set());

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
        const playing = new Set<string>();
        for (const card of j.matchCards ?? []) {
          if (!card.kickoffUtc) continue;
          const hours = (new Date(card.kickoffUtc).getTime() - now) / (1000 * 60 * 60);
          if (hours >= 0 && hours < 24) {
            if (card.home?.teamId) playing.add(card.home.teamId);
            if (card.away?.teamId) playing.add(card.away.teamId);
          }
        }
        setTeams(playing);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [competitionId, matchday, timezone]);

  return teams;
}
