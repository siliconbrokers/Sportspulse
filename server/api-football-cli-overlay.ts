/**
 * ApiFootballCLIOverlay — score overlay para Copa Libertadores.
 *
 * Usa API-Football v3 (api-sports.io) con /fixtures?live=all&league=13.
 * El free tier no permite queries por fecha para temporadas > 2024,
 * pero live=all no tiene restricción de season.
 * Copa Libertadores = league 13 en API-Football.
 *
 * Para partidos ya finalizados, el outer LiveOverlayDataSource cubre
 * la ventana 0–180 min. Este overlay agrega cobertura específica de Copa Lib.
 *
 * Budget: 1 req por refresh (TTL 2 min con live, 15 min sin live).
 * Comparte APIFOOTBALL_KEY con el live overlay global y el incident service.
 */

import {
  isQuotaExhausted as isAfQuotaExhausted,
  markQuotaExhausted as markAfQuotaExhausted,
  consumeRequest as consumeAfRequest,
} from './af-budget.js';

const AF_BASE       = 'https://v3.football.api-sports.io';
const CLI_LEAGUE_ID = 13;

// TTL para el caché in-memory
const CACHE_TTL_LIVE_MS = 2  * 60_000;  // 2 min — igual que el outer overlay
const CACHE_TTL_IDLE_MS = 15 * 60_000;  // 15 min — sin live

const ERROR_BACKOFF_MS = 5 * 60_000;

// ── API-Football response types ───────────────────────────────────────────────

interface AfFixture {
  fixture: {
    date:   string;
    status: { short: string; elapsed: number | null };
  };
  teams: {
    home: { name: string };
    away: { name: string };
  };
  goals: { home: number | null; away: number | null };
}

// ── Public contract ───────────────────────────────────────────────────────────

export interface CliScoreOverride {
  scoreHome: number | null;
  scoreAway: number | null;
  status:    'FINISHED' | 'IN_PROGRESS' | 'SCHEDULED';
}

// ── In-memory store ───────────────────────────────────────────────────────────

interface LiveStore {
  entries:   Map<string, CliScoreOverride>;
  raw:       Array<{ homeNorm: string; awayNorm: string; entry: CliScoreOverride }>;
  fetchedAt: number;
  hasLive:   boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normaliza nombre de equipo eliminando prefijos comunes y acentos. */
export function normTeamName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(club|deportivo|atletico|atl|cd|cf|ca|fc|ac|rc|sc|cs|af|sd|sp|ud|rcd|sporting|real)\b/g, '')
    .replace(/[^\w]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toCanonicalStatus(short: string): CliScoreOverride['status'] {
  switch (short) {
    case 'FT': case 'AET': case 'PEN': case 'AWD': case 'WO':
      return 'FINISHED';
    case '1H': case 'HT': case '2H': case 'ET': case 'BT': case 'P': case 'LIVE':
      return 'IN_PROGRESS';
    default:
      return 'SCHEDULED';
  }
}

// ── Overlay class ─────────────────────────────────────────────────────────────

export class ApiFootballCLIOverlay {
  private store: LiveStore = {
    entries:   new Map(),
    raw:       [],
    fetchedAt: 0,
    hasLive:   false,
  };
  private lastErrorAt = 0;

  constructor(private readonly apiKey: string) {}

  /**
   * Devuelve el score/status correcto para un partido de Copa Lib dado
   * nombre del equipo local y visitante.
   * Retorna null si no está en vivo o la API falla.
   */
  async getOverride(
    _utcDatePrefix: string,
    homeTeamName: string,
    awayTeamName: string,
  ): Promise<CliScoreOverride | null> {
    await this.ensureLiveFresh();

    const homeNorm = normTeamName(homeTeamName);
    const awayNorm = normTeamName(awayTeamName);
    const hit = this.store.entries.get(`${homeNorm}|${awayNorm}`);
    if (hit) return hit;

    // Fallback: partial contains match
    for (const { homeNorm: kh, awayNorm: ka, entry } of this.store.raw) {
      if (
        (kh.includes(homeNorm) || homeNorm.includes(kh)) &&
        (ka.includes(awayNorm) || awayNorm.includes(ka))
      ) {
        return entry;
      }
    }

    return null;
  }

  // ── Cache management ──────────────────────────────────────────────────────

  private async ensureLiveFresh(): Promise<void> {
    if (isAfQuotaExhausted()) return;
    const nowMs = Date.now();
    const ttl   = this.store.hasLive ? CACHE_TTL_LIVE_MS : CACHE_TTL_IDLE_MS;
    if (nowMs - this.store.fetchedAt < ttl) return;
    if (nowMs - this.lastErrorAt < ERROR_BACKOFF_MS) return;

    try {
      const data = await this.apiGet<{ response: AfFixture[] }>(
        `/fixtures?live=all&league=${CLI_LEAGUE_ID}`,
      );
      const fixtures = data.response ?? [];
      this.buildStore(fixtures);
      if (fixtures.length > 0) {
        console.log(`[CLIOverlay] live=all league=${CLI_LEAGUE_ID} → ${fixtures.length} Copa Lib fixtures`);
      }
    } catch (err) {
      this.lastErrorAt = Date.now();
      console.warn('[CLIOverlay] Fetch error (backoff 5min):', err instanceof Error ? err.message : err);
    }
  }

  private buildStore(fixtures: AfFixture[]): void {
    const entries = new Map<string, CliScoreOverride>();
    const raw: LiveStore['raw'] = [];
    let hasLive = false;

    for (const f of fixtures) {
      const homeNorm = normTeamName(f.teams.home.name);
      const awayNorm = normTeamName(f.teams.away.name);
      const status   = toCanonicalStatus(f.fixture.status.short);
      if (status === 'IN_PROGRESS') hasLive = true;

      const entry: CliScoreOverride = {
        scoreHome: f.goals.home,
        scoreAway: f.goals.away,
        status,
      };
      entries.set(`${homeNorm}|${awayNorm}`, entry);
      raw.push({ homeNorm, awayNorm, entry });
    }

    this.store = { entries, raw, fetchedAt: Date.now(), hasLive };
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────

  private async apiGet<T extends object>(endpoint: string): Promise<T> {
    const res = await fetch(`${AF_BASE}${endpoint}`, {
      headers: { 'x-apisports-key': this.apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`CLIOverlay HTTP ${res.status}: ${endpoint}`);
    const data = await res.json() as T;
    const dataAny = data as { errors?: { requests?: unknown } };
    if (dataAny?.errors?.requests) {
      markAfQuotaExhausted();
      throw new Error(`CLIOverlay quota: ${dataAny.errors.requests}`);
    }
    consumeAfRequest();
    return data;
  }
}
