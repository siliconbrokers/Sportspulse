/**
 * prediction-route.ts — GET /api/ui/prediction
 *
 * Request validation, response shaping for match predictions.
 *
 * Package boundary rules (§boundary rules):
 *   - packages/api MUST NOT import from packages/prediction directly
 *   - The IPredictionService interface is defined here so api can depend on it
 *     without touching prediction package internals
 *   - server/ wires the actual PredictionService implementation to this interface
 *
 * Query params (all required):
 *   - matchId         — canonical match identifier
 *   - competitionId   — canonical competition identifier
 *   - seasonId        — season identifier
 *   - homeTeamId      — canonical home team identifier
 *   - awayTeamId      — canonical away team identifier
 *   - kickoffUtc      — ISO-8601 UTC kickoff time
 *   - teamDomain      — 'CLUB' | 'NATIONAL_TEAM'
 *   - competitionFamily — competition family for validation context
 *
 * Response: PredictionResponsePublic (internals omitted per §22.3)
 *
 * Error codes:
 *   - 400 BAD_REQUEST  — missing or invalid required query params
 *   - 500 INTERNAL_ERROR — unhandled pipeline failure
 *
 * Spec authority: §21, §22.3
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../errors/app-error.js';
import { ErrorCode } from '../errors/error-codes.js';
import type { AppDependencies } from './types.js';

// ── IPredictionService ─────────────────────────────────────────────────────

/**
 * Minimal prediction service interface that packages/api depends on.
 *
 * The full PredictionService lives in server/prediction/ — packages/api
 * only needs to know this contract. §boundary rules
 *
 * The `input` parameter type uses `unknown` here to avoid importing from
 * packages/prediction. server/index.ts wires the concrete implementation
 * which validates input types internally.
 */
export interface IPredictionService {
   
  predict(input: any): Promise<any>;
}

// ── Route registration ─────────────────────────────────────────────────────

/**
 * Register GET /api/ui/prediction route.
 *
 * The prediction service is injected via AppDependencies to preserve
 * the package boundary invariant.
 */
export function predictionRoute(
  deps: AppDependencies & { predictionService?: IPredictionService },
): FastifyPluginAsync {
  return fp(
    async function predictionRoutePlugin(fastify: FastifyInstance) {
      fastify.get('/api/ui/prediction', async (request, reply) => {
        if (!deps.predictionService) {
          throw new AppError(
            ErrorCode.SERVICE_UNAVAILABLE,
            'Prediction service not available',
            503,
          );
        }

        const query = request.query as Record<string, unknown>;

        // ── Required query param validation ──────────────────────────────
        const matchId = query.matchId;
        const competitionId = query.competitionId;
        const seasonId = query.seasonId;
        const homeTeamId = query.homeTeamId;
        const awayTeamId = query.awayTeamId;
        const kickoffUtc = query.kickoffUtc;
        const teamDomain = query.teamDomain;
        const competitionFamily = query.competitionFamily;
        const stageType = query.stageType;
        const formatType = query.formatType;
        const legType = query.legType ?? 'SINGLE';
        const neutralVenue = query.neutralVenue;
        const homeDomainId = query.homeDomainId;
        const awayDomainId = query.awayDomainId;

        // Validate presence of all required params
        const missingParams: string[] = [];
        if (!matchId || typeof matchId !== 'string') missingParams.push('matchId');
        if (!competitionId || typeof competitionId !== 'string')
          missingParams.push('competitionId');
        if (!seasonId || typeof seasonId !== 'string') missingParams.push('seasonId');
        if (!homeTeamId || typeof homeTeamId !== 'string') missingParams.push('homeTeamId');
        if (!awayTeamId || typeof awayTeamId !== 'string') missingParams.push('awayTeamId');
        if (!kickoffUtc || typeof kickoffUtc !== 'string') missingParams.push('kickoffUtc');
        if (!teamDomain || typeof teamDomain !== 'string') missingParams.push('teamDomain');
        if (!competitionFamily || typeof competitionFamily !== 'string')
          missingParams.push('competitionFamily');
        if (!stageType || typeof stageType !== 'string') missingParams.push('stageType');
        if (!formatType || typeof formatType !== 'string') missingParams.push('formatType');
        if (!homeDomainId || typeof homeDomainId !== 'string') missingParams.push('homeDomainId');
        if (!awayDomainId || typeof awayDomainId !== 'string') missingParams.push('awayDomainId');

        if (missingParams.length > 0) {
          throw new AppError(
            ErrorCode.BAD_REQUEST,
            `Missing required query parameters: ${missingParams.join(', ')}`,
            400,
            { missingParams },
          );
        }

        // ── Parse optional numeric/boolean params ────────────────────────
        const homeDone365 = query.homeCompleted365
          ? parseInt(query.homeCompleted365 as string, 10)
          : 0;
        const awayDone365 = query.awayCompleted365
          ? parseInt(query.awayCompleted365 as string, 10)
          : 0;
        const homeDone730 = query.homeCompleted730
          ? parseInt(query.homeCompleted730 as string, 10)
          : 0;
        const awayDone730 = query.awayCompleted730
          ? parseInt(query.awayCompleted730 as string, 10)
          : 0;
        const homePriorAvail = query.homePriorRatingAvailable === 'true';
        const awayPriorAvail = query.awayPriorRatingAvailable === 'true';
        const isNeutralVenue = neutralVenue === 'true' || neutralVenue === true;

        // ── Assemble MatchInput (schemaVersion: 1) ────────────────────────
        // §7 — MatchInput v1 contract
        const matchInput = {
          schemaVersion: 1 as const,
          match_id: matchId as string,
          kickoff_utc: kickoffUtc as string,
          competition_id: competitionId as string,
          season_id: seasonId as string,
          home_team_id: homeTeamId as string,
          away_team_id: awayTeamId as string,
          home_team_domain_id: homeDomainId as string,
          away_team_domain_id: awayDomainId as string,
          competition_profile: {
            team_domain: teamDomain as string,
            competition_family: competitionFamily as string,
            stage_type: stageType as string,
            format_type: formatType as string,
            leg_type: legType as string,
            neutral_venue: isNeutralVenue,
            competition_profile_version: '1.0',
          },
          historical_context: {
            home_completed_official_matches_last_365d: isNaN(homeDone365) ? 0 : homeDone365,
            away_completed_official_matches_last_365d: isNaN(awayDone365) ? 0 : awayDone365,
            home_completed_official_matches_last_730d: isNaN(homeDone730) ? 0 : homeDone730,
            away_completed_official_matches_last_730d: isNaN(awayDone730) ? 0 : awayDone730,
            home_prior_rating_available: homePriorAvail,
            away_prior_rating_available: awayPriorAvail,
          },
        };

        // ── Run prediction pipeline ───────────────────────────────────────
        const predictionResponse = await deps.predictionService!.predict(matchInput);

        // ── Strip internals before sending (§22.3) ────────────────────────
        // PredictionResponsePublic omits the internals field.
        // We explicitly delete it from the response object before serialization.
        const publicResponse = { ...predictionResponse };
        delete (publicResponse as Record<string, unknown>).internals;

        // ── Cache control ─────────────────────────────────────────────────
        // Predictions are deterministic for pre-match data — short cache is safe.
        // Predictions for NOT_ELIGIBLE matches can also be cached briefly.
        const cacheMaxAge = 300; // 5 minutes
        reply
          .header('Cache-Control', `public, max-age=${cacheMaxAge}, stale-while-revalidate=60`)
          .send(publicResponse);
      });
    },
    { name: 'prediction-route' },
  );
}
