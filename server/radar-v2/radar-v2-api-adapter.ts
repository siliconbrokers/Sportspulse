/**
 * Radar SportPulse v2 — API Adapter
 * Bridges the v2 radar service with the API layer.
 *
 * Integración con predictor: opcional.
 * Si se provee un PredictionStore, el adapter construye un PredictionFetcher
 * que se pasa al service para adjuntar predictionContext a las cards.
 * Si no se provee, degradación silenciosa: predictionContext = null en todas las cards.
 */

import type { Match } from '@sportpulse/canonical';
import type { DataSource } from '@sportpulse/snapshot';
import { buildOrGetV2Snapshot } from './radar-v2-service.js';
import type { RadarV2Snapshot } from './radar-v2-types.js';
import type { PredictionStore } from '../prediction/prediction-store.js';
import { buildPredictionFetcher } from './radar-v2-prediction-fetcher.js';

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
  constructor(
    private readonly dataSource: DataSource,
    private readonly predictionStore?: PredictionStore | null,
  ) {}

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
      // Construir fetcher de predicciones si hay store disponible
      const predictionFetcher = this.predictionStore
        ? buildPredictionFetcher(this.predictionStore)
        : null;

      const snapshot = await buildOrGetV2Snapshot({
        competitionKey,
        seasonKey,
        matchday,
        competitionId,
        dataSource: this.dataSource,
        buildNowUtc,
        predictionFetcher,
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
