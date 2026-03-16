/**
 * Radar SportPulse v2 — API Adapter
 * Bridges the v2 radar service with the API layer.
 *
 * CRITICAL: NO predictor integration. NO PredictionStore. NO V3PredictionOutput.
 * This adapter is standalone per spec.sportpulse.radar-v2-package-index.md §Explicitly Out of Scope.
 */

import type { Match } from '@sportpulse/canonical';
import type { DataSource } from '@sportpulse/snapshot';
import { buildOrGetV2Snapshot } from './radar-v2-service.js';
import type { RadarV2Snapshot } from './radar-v2-types.js';

export interface RadarV2LiveMatchData {
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
}

export type RadarV2ApiResult = {
  snapshot: RadarV2Snapshot | null;
  liveData: RadarV2LiveMatchData[];
  state: 'ok' | 'empty' | 'unavailable';
};

/** Maps competition ID to its canonical competition key. */
function competitionKeyFromId(competitionId: string): string {
  const parts = competitionId.split(':');
  const code = parts[2] ?? parts[1] ?? competitionId;
  const codeMap: Record<string, string> = {
    PD: 'la_liga',
    PL: 'premier_league',
    BL1: 'bundesliga',
    '4432': 'liga_uruguaya',
  };
  return codeMap[code] ?? code.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function normalizeSeasonKey(raw: string): string {
  return raw.replace(/[^a-z0-9_-]/gi, '_').replace(/-+/g, '_').toLowerCase();
}

export class RadarV2ApiAdapter {
  constructor(private readonly dataSource: DataSource) {}

  async getRadar(
    competitionId: string,
    matchday: number,
    buildNowUtc: string,
  ): Promise<RadarV2ApiResult> {
    const competitionKey = competitionKeyFromId(competitionId);
    const seasonId = this.dataSource.getSeasonId?.(competitionId);
    if (!seasonId) {
      console.warn(`[RadarV2Adapter] No seasonId for ${competitionId}`);
      return { snapshot: null, liveData: [], state: 'unavailable' };
    }

    const seasonKeyRaw = seasonId.split(':').slice(2).join(':') ?? seasonId;
    const seasonKey = normalizeSeasonKey(seasonKeyRaw);

    try {
      const snapshot = await buildOrGetV2Snapshot({
        competitionKey,
        seasonKey,
        matchday,
        competitionId,
        dataSource: this.dataSource,
        buildNowUtc,
      });

      if (!snapshot) {
        return { snapshot: null, liveData: [], state: 'unavailable' };
      }

      if (snapshot.status === 'EMPTY' || snapshot.status === 'FAILED') {
        return { snapshot, liveData: [], state: snapshot.status === 'EMPTY' ? 'empty' : 'unavailable' };
      }

      // Build live data for matches in this matchday
      const liveData = this.buildLiveData(snapshot, competitionId, seasonId);

      return { snapshot, liveData, state: 'ok' };
    } catch (err) {
      console.error('[RadarV2Adapter] Error:', err);
      return { snapshot: null, liveData: [], state: 'unavailable' };
    }
  }

  private buildLiveData(
    snapshot: RadarV2Snapshot,
    competitionId: string,
    seasonId: string,
  ): RadarV2LiveMatchData[] {
    const allMatches = this.dataSource.getMatches(seasonId);
    const teams = this.dataSource.getTeams(competitionId);
    const teamMap = new Map(teams.map((t) => [t.teamId, t]));

    const matchday = snapshot.matchday;
    const matches = allMatches.filter(
      (m) => (m as Match & { matchday?: number }).matchday === Number(matchday),
    );

    return matches.map((match) => {
      const homeTeam = teamMap.get(match.homeTeamId);
      const awayTeam = teamMap.get(match.awayTeamId);

      return {
        matchId: match.matchId,
        status: match.status,
        scoreHome: match.scoreHome,
        scoreAway: match.scoreAway,
        startTimeUtc: match.startTimeUtc,
        homeTeamId: match.homeTeamId,
        awayTeamId: match.awayTeamId,
        homeTeamName: homeTeam?.name ?? match.homeTeamId,
        awayTeamName: awayTeam?.name ?? match.awayTeamId,
        homeTeamCrest: homeTeam?.crestUrl,
        awayTeamCrest: awayTeam?.crestUrl,
      };
    });
  }
}
