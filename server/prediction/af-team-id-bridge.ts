/**
 * af-team-id-bridge.ts — Bridge entre AF team IDs y canonical team IDs.
 *
 * Llama /teams?league={id}&season={year} y cruza por nombre normalizado
 * contra el mapa canónico provisto por el llamador (construido desde DataSource.getTeams).
 *
 * Cache: /cache/af-team-bridge/{leagueId}-{season}.json — TTL 30 días.
 * Fault isolation: cualquier error retorna Map vacío silenciosamente.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  consumeRequest,
  isQuotaExhausted,
  markQuotaExhausted,
} from '@sportpulse/canonical';
import { normTeamName } from './injury-source.js';

// ── Cache types ───────────────────────────────────────────────────────────────

interface BridgeEntry {
  afTeamId: number;
  afTeamName: string;
  canonicalTeamId: string;
}

interface BridgeCacheDoc {
  version: 1;
  leagueId: number;
  season: number;
  builtAt: string;
  entries: BridgeEntry[];
  unmatchedAfTeams: string[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CACHE_ROOT    = path.resolve(process.cwd(), 'cache/af-team-bridge');
const CACHE_TTL_MS  = 30 * 24 * 3600_000; // 30 days

// ── Cache I/O ─────────────────────────────────────────────────────────────────

function bridgeCachePath(leagueId: number, season: number): string {
  return path.join(CACHE_ROOT, `${leagueId}-${season}.json`);
}

async function readBridgeCache(leagueId: number, season: number): Promise<BridgeCacheDoc | null> {
  try {
    const raw  = await fs.readFile(bridgeCachePath(leagueId, season), 'utf-8');
    const doc  = JSON.parse(raw) as BridgeCacheDoc;
    const age  = Date.now() - new Date(doc.builtAt).getTime();
    if (age > CACHE_TTL_MS) return null;
    return doc;
  } catch {
    return null;
  }
}

async function writeBridgeCache(
  leagueId: number,
  season:   number,
  entries:  BridgeEntry[],
  unmatched: string[],
): Promise<void> {
  const p      = bridgeCachePath(leagueId, season);
  const tmpPath = `${p}.tmp`;
  const doc: BridgeCacheDoc = {
    version: 1,
    leagueId,
    season,
    builtAt: new Date().toISOString(),
    entries,
    unmatchedAfTeams: unmatched,
  };
  try {
    await fs.mkdir(CACHE_ROOT, { recursive: true });
    await fs.writeFile(tmpPath, JSON.stringify(doc, null, 2), 'utf-8');
    await fs.rename(tmpPath, p);
  } catch (err) {
    console.warn(`[AfTeamIdBridge] cache write error: ${err}`);
  }
}

// ── AF API types ──────────────────────────────────────────────────────────────

interface AfTeamsResponse {
  errors?:   Record<string, string>;
  response?: Array<{ team: { id: number; name: string } }>;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface TeamBridgeResult {
  /** AF team ID → canonical team ID */
  bridge:           Map<number, string>;
  /** AF teams that could not be mapped to a canonical ID */
  unmatchedAfTeams: string[];
  /** % of AF teams successfully mapped [0..1] */
  coverage:         number;
}

/**
 * Construye un bridge AF team ID → canonical team ID para una liga/temporada.
 *
 * @param leagueId          AF league ID (e.g. 140 para LaLiga)
 * @param season            Año de inicio de temporada (e.g. 2024 para 2024-25)
 * @param canonicalNameMap  Map de normTeamName(name) → canonicalTeamId (del DataSource)
 * @param apiKey            APIFOOTBALL_KEY
 */
export async function buildTeamBridge(
  leagueId:         number,
  season:           number,
  canonicalNameMap: Map<string, string>,
  apiKey:           string,
): Promise<TeamBridgeResult> {
  const empty: TeamBridgeResult = { bridge: new Map(), unmatchedAfTeams: [], coverage: 0 };

  // Disk cache hit
  const cached = await readBridgeCache(leagueId, season);
  if (cached) {
    const bridge = new Map<number, string>();
    for (const e of cached.entries) bridge.set(e.afTeamId, e.canonicalTeamId);
    const coverage = cached.entries.length / (cached.entries.length + cached.unmatchedAfTeams.length) || 0;
    console.log(
      `[AfTeamIdBridge] CACHE HIT league=${leagueId} season=${season}: ` +
      `${bridge.size} mapped, ${cached.unmatchedAfTeams.length} unmatched`,
    );
    return { bridge, unmatchedAfTeams: cached.unmatchedAfTeams, coverage };
  }

  if (!apiKey || isQuotaExhausted()) return empty;

  // Fetch teams from AF
  const url = `https://v3.football.api-sports.io/teams?league=${leagueId}&season=${season}`;
  let data: AfTeamsResponse;
  try {
    const res = await fetch(url, { headers: { 'x-apisports-key': apiKey } });
    consumeRequest();
    if (!res.ok) {
      console.warn(`[AfTeamIdBridge] HTTP ${res.status} league=${leagueId} season=${season}`);
      return empty;
    }
    data = await res.json() as AfTeamsResponse;
  } catch (err) {
    console.warn(`[AfTeamIdBridge] fetch error: ${err}`);
    return empty;
  }

  if (data.errors && Object.values(data.errors).some(
    (v) => typeof v === 'string' && v.toLowerCase().includes('limit'),
  )) {
    markQuotaExhausted();
    return empty;
  }

  const afTeams    = data.response ?? [];
  const entries:   BridgeEntry[] = [];
  const bridge     = new Map<number, string>();
  const unmatched: string[] = [];

  for (const item of afTeams) {
    const afId   = item.team.id;
    const afName = item.team.name;
    const normed = normTeamName(afName);

    // 1. Exact match
    let canonicalId = canonicalNameMap.get(normed);

    // 2. Substring match (handles "Ath Bilbao" ↔ "Athletic Club", etc.)
    if (!canonicalId) {
      for (const [key, val] of canonicalNameMap.entries()) {
        if (key.includes(normed) || normed.includes(key)) {
          canonicalId = val;
          break;
        }
      }
    }

    if (canonicalId) {
      entries.push({ afTeamId: afId, afTeamName: afName, canonicalTeamId: canonicalId });
      bridge.set(afId, canonicalId);
    } else {
      unmatched.push(afName);
    }
  }

  const coverage = afTeams.length > 0 ? entries.length / afTeams.length : 0;

  console.log(
    `[AfTeamIdBridge] league=${leagueId} season=${season}: ` +
    `${entries.length}/${afTeams.length} teams mapped (${Math.round(coverage * 100)}%)` +
    (unmatched.length ? ` — UNMATCHED: ${unmatched.join(', ')}` : ''),
  );

  await writeBridgeCache(leagueId, season, entries, unmatched);
  return { bridge, unmatchedAfTeams: unmatched, coverage };
}
