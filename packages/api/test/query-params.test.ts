import { describe, it, expect } from 'vitest';
import {
  parseDashboardQuery,
  parseTeamQuery,
  QueryValidationError,
} from '../src/validation/query-params.js';

describe('parseDashboardQuery', () => {
  it('parses valid query with all params', () => {
    const result = parseDashboardQuery({
      competitionId: 'comp:football-data:PD',
      dateLocal: '2026-03-04',
      timezone: 'Europe/London',
      includeSignals: 'true',
    });
    expect(result.competitionId).toBe('comp:football-data:PD');
    expect(result.dateLocal).toBe('2026-03-04');
    expect(result.timezone).toBe('Europe/London');
    expect(result.includeSignals).toBe(true);
  });

  it('defaults timezone to Europe/Madrid', () => {
    const result = parseDashboardQuery({
      competitionId: 'comp:test',
      dateLocal: '2026-03-04',
    });
    expect(result.timezone).toBe('Europe/Madrid');
  });

  it('accepts date alias for dateLocal', () => {
    const result = parseDashboardQuery({
      competitionId: 'comp:test',
      date: '2026-03-04',
    });
    expect(result.dateLocal).toBe('2026-03-04');
  });

  it('defaults includeSignals to false', () => {
    const result = parseDashboardQuery({
      competitionId: 'comp:test',
      dateLocal: '2026-03-04',
    });
    expect(result.includeSignals).toBe(false);
  });

  it('throws on missing competitionId', () => {
    expect(() => parseDashboardQuery({ dateLocal: '2026-03-04' })).toThrow(QueryValidationError);
  });

  it('throws on missing dateLocal and matchday', () => {
    expect(() => parseDashboardQuery({ competitionId: 'comp:test' })).toThrow(QueryValidationError);
  });

  it('accepts matchday instead of dateLocal', () => {
    const result = parseDashboardQuery({
      competitionId: 'comp:test',
      matchday: '25',
    });
    expect(result.matchday).toBe(25);
    expect(result.dateLocal).toBeUndefined();
  });

  it('throws on invalid dateLocal format', () => {
    expect(() =>
      parseDashboardQuery({ competitionId: 'comp:test', dateLocal: '04-03-2026' }),
    ).toThrow(QueryValidationError);
  });
});

describe('parseTeamQuery', () => {
  it('parses valid query', () => {
    const result = parseTeamQuery({
      competitionId: 'comp:test',
      teamId: 'team:football-data:86',
      dateLocal: '2026-03-04',
    });
    expect(result.teamId).toBe('team:football-data:86');
    expect(result.timezone).toBe('Europe/Madrid');
  });

  it('accepts participantId alias', () => {
    const result = parseTeamQuery({
      competitionId: 'comp:test',
      participantId: 'team:football-data:86',
      dateLocal: '2026-03-04',
    });
    expect(result.teamId).toBe('team:football-data:86');
  });

  it('throws on missing teamId', () => {
    expect(() => parseTeamQuery({ competitionId: 'comp:test', dateLocal: '2026-03-04' })).toThrow(
      QueryValidationError,
    );
  });
});
