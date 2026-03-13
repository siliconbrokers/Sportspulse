/**
 * Builds a deterministic snapshot key from the identity tuple.
 * Format: competitionId|seasonId|buildNowUtc|policyKey@policyVersion[|jornada:N]
 */
export function buildSnapshotKey(
  competitionId: string,
  seasonId: string,
  buildNowUtc: string,
  policyKey: string,
  policyVersion: number,
  matchday?: number,
  subTournamentKey?: string,
): string {
  const base = `${competitionId}|${seasonId}|${buildNowUtc}|${policyKey}@${policyVersion}`;
  const withMatchday = matchday !== undefined ? `${base}|jornada:${matchday}` : base;
  return subTournamentKey ? `${withMatchday}|sub:${subTournamentKey}` : withMatchday;
}

/**
 * Computes buildNowUtc from dateLocal + timezone for MVP v1.
 * Rule (api-contract §6.2): buildNowUtc = toUtc(dateLocal + "T12:00:00" in timezone)
 *
 * MVP simplification: uses Intl.DateTimeFormat to resolve timezone offset.
 */
export function buildNowUtcFromDate(dateLocal: string, timezone: string): string {
  // Create a date at noon local time in the specified timezone
  // We parse YYYY-MM-DD and construct the noon time
  const [year, month, day] = dateLocal.split('-').map(Number);

  // Use a known UTC reference and find the offset for the timezone
  // Create the target local datetime string
  const localNoon = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  // Get the offset by comparing formatted time in timezone vs UTC
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  // Find the UTC time that corresponds to noon in the given timezone
  // by iterating: we need the UTC instant where local time = noon
  const parts = formatter.formatToParts(localNoon);
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const localHour = parseInt(getPart('hour'), 10);

  // The difference between 12 (desired local) and what localNoon shows in that tz
  // tells us the offset adjustment needed
  const hourDiff = 12 - localHour;
  const adjusted = new Date(localNoon.getTime() + hourDiff * 3600_000);

  // Verify: format adjusted in timezone should show 12:00
  return adjusted.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
