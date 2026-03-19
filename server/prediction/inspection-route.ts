/**
 * PE-75: Internal inspection endpoint for the Predictive Engine.
 *
 * GET /api/internal/predictions
 *
 * Query params:
 *   ?matchId=      — inspect a specific match (takes priority over competitionId)
 *   ?competitionId= — list recent predictions for a competition
 *   ?limit=        — max results (default 20, min 1, max 100)
 *
 * Gating: enabled if PREDICTION_INTERNAL_VIEW_ENABLED is non-empty.
 * Returns 404 if the flag is off.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PredictionStore } from './prediction-store.js';
import { NexusShadowReader } from './nexus-shadow-reader.js';
import { loadTeamsCache } from '../matchday-cache.js';

// ── Response shape ─────────────────────────────────────────────────────────────

interface InspectionItem {
  // -- Identity --
  match_id: string;
  competition_id: string;
  generated_at: string;
  engine_version: string;
  kickoff_utc: string | null;
  generation_status: 'ok' | 'error';
  error_detail?: string;

  // -- Mode and reasons --
  mode: string;
  calibration_mode: string | null;
  reasons: string[];
  degradation_notes: string[];

  // -- P1 core probabilities --
  p_home_win: number | null;
  p_draw: number | null;
  p_away_win: number | null;
  predicted_result: string | null;
  expected_goals_home: number | null;
  expected_goals_away: number | null;

  // -- P2 extended --
  favorite_margin: number | null;
  draw_risk: number | null;

  // -- Full payloads --
  request_payload: unknown;
  response_payload: unknown;

  // -- Engine source --
  engine_source: 'v3' | 'nexus';

  // -- Human-readable team display --
  home_team_name?: string;
  away_team_name?: string;
}

// ── Helper: extract core probabilities from a parsed PredictionResponse ────────

function extractCoreFields(response: unknown): Pick<
  InspectionItem,
  | 'p_home_win' | 'p_draw' | 'p_away_win' | 'predicted_result'
  | 'expected_goals_home' | 'expected_goals_away'
  | 'favorite_margin' | 'draw_risk'
> {
  const r = response as Record<string, unknown> | null | undefined;

  function num(v: unknown): number | null {
    return typeof v === 'number' ? v : null;
  }
  function str(v: unknown): string | null {
    return typeof v === 'string' ? v : null;
  }

  // New format (PE v1.3+): nested predictions.core + internals
  // Old format (flat): prob_home_win, prob_draw, prob_away_win, lambda_home, lambda_away
  // Both formats must be supported for backward compatibility with snapshots on disk.
  const core = (r?.['predictions'] as Record<string, unknown> | undefined)?.['core'] as Record<string, unknown> | undefined;
  const internals = (r?.['internals'] as Record<string, unknown> | undefined);

  const ph = num(core?.['p_home_win'] ?? r?.['prob_home_win']);
  const pd = num(core?.['p_draw'] ?? r?.['prob_draw']);
  const pa = num(core?.['p_away_win'] ?? r?.['prob_away_win']);
  let predicted = str(core?.['predicted_result'] ?? r?.['predicted_result']);

  // Some snapshots (e.g. NO_PRIOR) store null predicted_result despite having probs.
  // Derive via argmax to ensure the lab always shows a result.
  if (predicted === null && ph !== null && pd !== null && pa !== null) {
    if (ph >= pd && ph >= pa) predicted = 'HOME_WIN';
    else if (pd >= ph && pd >= pa) predicted = 'DRAW';
    else predicted = 'AWAY_WIN';
  }

  return {
    p_home_win:           ph,
    p_draw:               pd,
    p_away_win:           pa,
    predicted_result:     predicted,
    expected_goals_home:  num(internals?.['lambda_home'] ?? r?.['lambda_home']),
    expected_goals_away:  num(internals?.['lambda_away'] ?? r?.['lambda_away']),
    favorite_margin:      num(core?.['favorite_margin'] ?? r?.['favorite_margin']),
    draw_risk:            num(core?.['draw_risk'] ?? null),
  };
}

// ── Helper: safely parse a JSON string, returning null on failure ──────────────

function safeParse(json: string, context: string): unknown {
  try {
    return JSON.parse(json);
  } catch (err) {
    console.error(`[InspectionRoute] JSON parse failed for ${context}:`, err);
    return null;
  }
}

// ── Helper: parse reasons array from reasons_json ─────────────────────────────

function parseReasons(json: string): string[] {
  const parsed = safeParse(json, 'reasons_json');
  if (!Array.isArray(parsed)) return [];
  return parsed.map((r) => (typeof r === 'string' ? r : JSON.stringify(r)));
}

// ── Helper: parse degradation notes from degradation_flags_json ───────────────

function parseDegradationNotes(json: string): string[] {
  const parsed = safeParse(json, 'degradation_flags_json');
  if (!Array.isArray(parsed)) return [];
  return parsed.map((f) => (typeof f === 'string' ? f : JSON.stringify(f)));
}

// ── Team name resolution ───────────────────────────────────────────────────────

/** Cache of teamId → shortName for each AF competition (in-process, never expires). */
const teamNameCache = new Map<string, Map<string, string>>();

function resolveTeamNames(items: InspectionItem[]): void {
  for (const item of items) {
    const req = item.request_payload as Record<string, unknown> | null | undefined;
    if (!req) continue;

    // V3 uses camelCase (homeTeamId), NEXUS stores weights — skip if missing
    const homeId = (req['homeTeamId'] ?? req['home_team_id']) as string | undefined;
    const awayId = (req['awayTeamId'] ?? req['away_team_id']) as string | undefined;
    if (!homeId || !awayId) continue;

    // Only AF canonical competitions have a teams cache
    const compId = item.competition_id;
    if (!compId.startsWith('comp:apifootball:')) continue;

    if (!teamNameCache.has(compId)) {
      const leagueId = compId.split(':').pop() ?? '';
      const teams = loadTeamsCache('apifootball', leagueId);
      const map = new Map<string, string>();
      if (teams) {
        for (const t of teams) {
          map.set(t.teamId, t.name ?? t.shortName ?? t.teamId);
        }
      }
      teamNameCache.set(compId, map);
    }

    const nameMap = teamNameCache.get(compId)!;
    item.home_team_name = nameMap.get(homeId);
    item.away_team_name = nameMap.get(awayId);
  }
}

// ── isEndpointEnabled ──────────────────────────────────────────────────────────

function isEndpointEnabled(): boolean {
  const val = process.env.PREDICTION_INTERNAL_VIEW_ENABLED;
  return typeof val === 'string' && val.trim().length > 0;
}

// ── Helper: build V3 InspectionItem from PredictionStore snapshot ─────────────

function buildV3Item(snap: ReturnType<PredictionStore['findAll']>[number]): InspectionItem {
  const requestPayload = safeParse(snap.request_payload_json, `request_payload[${snap.match_id}]`);
  const responsePayload = safeParse(snap.response_payload_json, `response_payload[${snap.match_id}]`);

  const coreFields = responsePayload !== null
    ? extractCoreFields(responsePayload)
    : {
        p_home_win: null,
        p_draw: null,
        p_away_win: null,
        predicted_result: null,
        expected_goals_home: null,
        expected_goals_away: null,
        favorite_margin: null,
        draw_risk: null,
      };

  const req = requestPayload as Record<string, unknown> | null | undefined;
  const kickoffUtc = (req?.['kickoffUtc'] ?? req?.['kickoff_utc'] ?? null) as string | null;

  const item: InspectionItem = {
    match_id:           snap.match_id,
    competition_id:     snap.competition_id,
    generated_at:       snap.generated_at,
    engine_version:     snap.engine_version,
    kickoff_utc:        kickoffUtc,
    generation_status:  snap.generation_status,
    mode:               snap.mode,
    calibration_mode:   snap.calibration_mode,
    reasons:            parseReasons(snap.reasons_json),
    degradation_notes:  parseDegradationNotes(snap.degradation_flags_json),
    request_payload:    requestPayload,
    response_payload:   responsePayload,
    engine_source:      'v3',
    ...coreFields,
  };

  if (snap.error_detail !== undefined) {
    item.error_detail = snap.error_detail;
  }

  return item;
}

// ── registerInspectionRoute ───────────────────────────────────────────────────

export function registerInspectionRoute(
  app: FastifyInstance,
  store: PredictionStore,
  nexusReader: NexusShadowReader,
): void {
  app.get('/api/internal/predictions', async (req: FastifyRequest, reply: FastifyReply) => {
    // Gate: endpoint is off if no competition is in the internal view list
    if (!isEndpointEnabled()) {
      return reply.code(404).send({ error: 'Not available' });
    }

    const q = req.query as Record<string, string>;

    // Parse limit (default 100, clamp 1..2000)
    const rawLimit = parseInt(q['limit'] ?? '100', 10);
    const limit = isNaN(rawLimit) ? 100 : Math.min(2000, Math.max(1, rawLimit));

    // Parse engine filter (default: both)
    const engine = (q['engine'] ?? 'both') as 'v3' | 'nexus' | 'both';

    const { matchId, competitionId } = q;

    // ── Build V3 items ──────────────────────────────────────────────────────
    let v3Items: InspectionItem[] = [];
    if (engine === 'v3' || engine === 'both') {
      let snapshots;
      if (matchId) {
        snapshots = store.findByMatch(matchId).slice(0, limit);
      } else if (competitionId) {
        snapshots = store.findByCompetition(competitionId, limit);
      } else {
        snapshots = store.findAll(limit);
      }
      v3Items = snapshots.map(buildV3Item);
    }

    // ── Build NEXUS items ───────────────────────────────────────────────────
    let nexusItems: InspectionItem[] = [];
    if (engine === 'nexus' || engine === 'both') {
      if (matchId) {
        const found = nexusReader.findByMatch(matchId);
        nexusItems = found ? [found] : [];
      } else if (competitionId) {
        nexusItems = nexusReader.findByCompetition(competitionId, limit);
      } else {
        nexusItems = nexusReader.findAll(limit);
      }
    }

    // ── Sort by kickoff_utc desc (fallback generated_at) ───────────────────
    function sortByKickoff(arr: InspectionItem[]): InspectionItem[] {
      return arr.sort((a, b) => {
        const ka = a.kickoff_utc ?? a.generated_at;
        const kb = b.kickoff_utc ?? b.generated_at;
        return kb.localeCompare(ka);
      });
    }

    // ── Merge and sort ──────────────────────────────────────────────────────
    let items: InspectionItem[];
    if (engine === 'v3') {
      items = sortByKickoff(v3Items);
    } else if (engine === 'nexus') {
      items = sortByKickoff(nexusItems).slice(0, limit);
    } else {
      items = sortByKickoff([...v3Items, ...nexusItems]).slice(0, limit);
    }

    resolveTeamNames(items);

    reply.header('Cache-Control', 'no-store');
    return reply.send({ items, count: items.length });
  });
}
