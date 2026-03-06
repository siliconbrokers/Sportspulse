const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export interface DashboardQueryParams {
  competitionId: string;
  dateLocal?: string;
  matchday?: number;
  timezone: string;
  includeSignals: boolean;
}

export interface TeamQueryParams {
  competitionId: string;
  teamId: string;
  dateLocal?: string;
  matchday?: number;
  timezone: string;
}

export function parseDashboardQuery(query: Record<string, unknown>): DashboardQueryParams {
  const competitionId = asString(query.competitionId);
  if (!competitionId) {
    throw new QueryValidationError('Missing required parameter: competitionId');
  }

  const dateLocal = asString(query.dateLocal ?? query.date);
  const matchdayRaw = asString(query.matchday);
  const matchday = matchdayRaw ? parseInt(matchdayRaw, 10) : undefined;

  if (!dateLocal && matchday === undefined) {
    throw new QueryValidationError(
      'Missing parameter: provide dateLocal (YYYY-MM-DD) or matchday (number)',
    );
  }

  if (dateLocal && !DATE_REGEX.test(dateLocal)) {
    throw new QueryValidationError('Invalid parameter: dateLocal (expected YYYY-MM-DD)');
  }

  if (matchday !== undefined && (isNaN(matchday) || matchday < 1)) {
    throw new QueryValidationError('Invalid parameter: matchday (expected positive integer)');
  }

  const timezone = asString(query.timezone) || 'Europe/Madrid';
  const includeSignals = query.includeSignals === 'true' || query.includeSignals === true;

  return { competitionId, dateLocal, matchday, timezone, includeSignals };
}

export function parseTeamQuery(query: Record<string, unknown>): TeamQueryParams {
  const competitionId = asString(query.competitionId);
  if (!competitionId) {
    throw new QueryValidationError('Missing required parameter: competitionId');
  }

  const teamId = asString(query.teamId ?? query.participantId);
  if (!teamId) {
    throw new QueryValidationError('Missing required parameter: teamId');
  }

  const dateLocal = asString(query.dateLocal ?? query.date);
  const matchdayRaw = asString(query.matchday);
  const matchday = matchdayRaw ? parseInt(matchdayRaw, 10) : undefined;

  if (!dateLocal && matchday === undefined) {
    throw new QueryValidationError(
      'Missing parameter: provide dateLocal (YYYY-MM-DD) or matchday (number)',
    );
  }

  if (dateLocal && !DATE_REGEX.test(dateLocal)) {
    throw new QueryValidationError('Invalid parameter: dateLocal (expected YYYY-MM-DD)');
  }

  const timezone = asString(query.timezone) || 'Europe/Madrid';

  return { competitionId, teamId, dateLocal, matchday, timezone };
}

export class QueryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryValidationError';
  }
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  return undefined;
}
