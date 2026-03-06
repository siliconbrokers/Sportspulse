interface MatchLike {
  matchday?: number;
  startTimeUtc: string | null;
  status: string;
}

/**
 * Given a matchday number, finds the best reference date for that matchday.
 * Prefers earliest SCHEDULED match, falls back to latest FINISHED match,
 * then any match for the matchday, then today's date.
 */
export function resolveDateFromMatchday(
  matches: readonly MatchLike[],
  matchday: number,
  timezone: string,
): string {
  const matchdayMatches = matches.filter((m) => m.matchday === matchday && m.startTimeUtc);

  const scheduled = matchdayMatches
    .filter((m) => m.status === 'SCHEDULED')
    .sort((a, b) => (a.startTimeUtc! < b.startTimeUtc! ? -1 : 1));

  if (scheduled.length > 0) {
    return utcToLocalDate(scheduled[0].startTimeUtc!, timezone);
  }

  const finished = matchdayMatches
    .filter((m) => m.status === 'FINISHED')
    .sort((a, b) => (a.startTimeUtc! > b.startTimeUtc! ? -1 : 1));

  if (finished.length > 0) {
    return utcToLocalDate(finished[0].startTimeUtc!, timezone);
  }

  if (matchdayMatches.length > 0) {
    const sorted = [...matchdayMatches].sort((a, b) =>
      a.startTimeUtc! < b.startTimeUtc! ? -1 : 1,
    );
    return utcToLocalDate(sorted[0].startTimeUtc!, timezone);
  }

  return new Date().toISOString().split('T')[0];
}

function utcToLocalDate(utcIso: string, timezone: string): string {
  const d = new Date(utcIso);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
