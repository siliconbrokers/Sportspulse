/**
 * ApiFootballCLIOverlay — score overlay para Copa Libertadores.
 *
 * football-data.org free tier no actualiza scores de Copa Libertadores en tiempo real.
 * Este overlay usa free-api-live-football-data (Creativesdev/RapidAPI) como fuente
 * primaria de scores y status, parchando los datos estructurales de football-data.org.
 *
 * Budget: ~1 req/día con partidos de Copa Lib. Plan free: 100 req/mes.
 * Consulta por fecha (YYYYMMDD) — no por temporada completa.
 */
import { readRawCache, writeRawCache } from './raw-response-cache.js';

const API_HOST    = 'free-api-live-football-data.p.rapidapi.com';
const DISK_PREFIX = 'clioverlay-date-';

// TTLs en memoria
const CACHE_TTL_PAST_MS   = Infinity;     // pasados: carga una vez, nunca refresca en memoria
const CACHE_TTL_NORMAL_MS = 60 * 60_000;  // 60 min — hoy sin live
const CACHE_TTL_LIVE_MS   = 15 * 60_000;  // 15 min — hoy con live (ahorra req/mes)

// TTLs en disco — los pasados se cachean ~30 días (nunca cambian)
const DISK_TTL_PAST_MS    = 30 * 24 * 60 * 60_000; // 30 días
const DISK_TTL_NORMAL_MS  = 60 * 60_000;            // 60 min
const DISK_TTL_LIVE_MS    = 15 * 60_000;            // 15 min

const ERROR_BACKOFF_MS = 5 * 60_000; // 5 min de backoff tras error de API

// ── API response types ────────────────────────────────────────────────────────

interface CdMatchStatus {
  utcTime:   string;
  finished:  boolean;
  started:   boolean;
  ongoing:   boolean;
  cancelled: boolean;
  reason?:   { short: string };
}

interface CdMatch {
  id:       number;
  leagueId: number;
  home: { id: number; score: number | null; name: string };
  away: { id: number; score: number | null; name: string };
  status: CdMatchStatus;
}

// ── Public contract ────────────────────────────────────────────────────────────

export interface CliScoreOverride {
  scoreHome: number | null;
  scoreAway: number | null;
  status:    'FINISHED' | 'IN_PROGRESS' | 'SCHEDULED';
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

function normalizeCdStatus(m: CdMatch): CliScoreOverride['status'] {
  const s = m.status;
  if (s.finished) return 'FINISHED';
  if (s.ongoing)  return 'IN_PROGRESS';
  const reasonShort = s.reason?.short ?? '';
  if (['FT', 'AET', 'AWD', 'WO', 'Pen'].includes(reasonShort)) return 'FINISHED';
  // Zombie guard: si pasaron >240 min desde el kickoff
  const elapsed = (Date.now() - new Date(s.utcTime).getTime()) / 60_000;
  if (elapsed > 240) return 'FINISHED';
  return 'SCHEDULED';
}

function cacheKey(datePrefix: string, homeNorm: string, awayNorm: string): string {
  return `${datePrefix}|${homeNorm}|${awayNorm}`;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Overlay class ──────────────────────────────────────────────────────────────

export class ApiFootballCLIOverlay {
  // Per-date maps: datePrefix → lookup map
  private dateMaps = new Map<string, Map<string, CliScoreOverride>>();
  private dateMeta = new Map<string, { fetchedAt: number; hasLive: boolean }>();
  private lastErrorAt = 0;

  constructor(private readonly apiKey: string) {}

  /**
   * Devuelve el score/status correcto para un partido de CLI dado
   * fecha UTC (YYYY-MM-DD), nombre del equipo local y visitante.
   * Retorna null si no se encuentra el partido o la API falla.
   */
  async getOverride(
    utcDatePrefix: string,
    homeTeamName: string,
    awayTeamName: string,
  ): Promise<CliScoreOverride | null> {
    await this.ensureDateFresh(utcDatePrefix);
    const map = this.dateMaps.get(utcDatePrefix);
    if (!map) return null;

    const homeNorm = normTeamName(homeTeamName);
    const awayNorm = normTeamName(awayTeamName);
    const key = cacheKey(utcDatePrefix, homeNorm, awayNorm);
    const hit = map.get(key);
    if (hit) return hit;

    // Fallback: búsqueda por fecha + nombre normalizado parcial
    for (const [k, v] of map) {
      const parts = k.split('|');
      const kHome = parts[1] ?? '';
      const kAway = parts[2] ?? '';
      if (
        (kHome.includes(homeNorm) || homeNorm.includes(kHome)) &&
        (kAway.includes(awayNorm) || awayNorm.includes(kAway))
      ) {
        return v;
      }
    }

    return null;
  }

  // ── Cache management ────────────────────────────────────────────────────────

  private async ensureDateFresh(datePrefix: string): Promise<void> {
    const nowMs   = Date.now();
    const isToday = datePrefix === todayUtc();
    const meta    = this.dateMeta.get(datePrefix);

    if (meta) {
      const ttl = !isToday
        ? CACHE_TTL_PAST_MS
        : meta.hasLive
          ? CACHE_TTL_LIVE_MS
          : CACHE_TTL_NORMAL_MS;
      if (nowMs - meta.fetchedAt < ttl) return;
    }

    // Backoff: si hubo error reciente, no reintentar
    if (nowMs - this.lastErrorAt < ERROR_BACKOFF_MS) return;

    // Disco
    const diskKey = `${DISK_PREFIX}${datePrefix}`;
    const diskTtl = !isToday
      ? DISK_TTL_PAST_MS
      : meta?.hasLive
        ? DISK_TTL_LIVE_MS
        : DISK_TTL_NORMAL_MS;
    const diskHit = await readRawCache<CdMatch[]>(diskKey, diskTtl);
    if (diskHit) {
      this.buildDateMap(datePrefix, diskHit);
      console.log(`[CLIOverlay] DISK_HIT ${datePrefix} — ${diskHit.length} matches`);
      return;
    }

    // API fetch
    const apiDate = datePrefix.replace(/-/g, ''); // YYYY-MM-DD → YYYYMMDD
    try {
      const data = await this.apiGet<{ status: string; response: { matches: CdMatch[] } }>(
        `/football-get-matches-by-date?date=${apiDate}`,
      );
      if (data.status !== 'success') throw new Error(`API status: ${data.status}`);
      const matches = data.response?.matches ?? [];
      await writeRawCache<CdMatch[]>(diskKey, matches);
      this.buildDateMap(datePrefix, matches);
      console.log(`[CLIOverlay] API fetch ${datePrefix} — ${matches.length} total matches`);
    } catch (err) {
      this.lastErrorAt = Date.now();
      console.warn('[CLIOverlay] Fetch error (backoff 5min):', err instanceof Error ? err.message : err);
      // Degradación silenciosa: el sistema usa football-data.org como fallback
    }
  }

  private buildDateMap(datePrefix: string, matches: CdMatch[]): void {
    const map    = new Map<string, CliScoreOverride>();
    let hasLive  = false;

    for (const m of matches) {
      // Usar la fecha UTC del partido como clave; fallback a datePrefix si falta
      const matchDate = m.status?.utcTime ? m.status.utcTime.slice(0, 10) : datePrefix;
      const homeNorm  = normTeamName(m.home.name);
      const awayNorm  = normTeamName(m.away.name);
      const status    = normalizeCdStatus(m);
      if (status === 'IN_PROGRESS') hasLive = true;

      // Indexar bajo la fecha UTC real del partido
      map.set(cacheKey(matchDate, homeNorm, awayNorm), {
        scoreHome: m.home.score ?? null,
        scoreAway: m.away.score ?? null,
        status,
      });

      // También indexar bajo la fecha de consulta para cubrir edge cases de timezone
      if (matchDate !== datePrefix) {
        const altMap = this.dateMaps.get(matchDate) ?? new Map<string, CliScoreOverride>();
        altMap.set(cacheKey(matchDate, homeNorm, awayNorm), {
          scoreHome: m.home.score ?? null,
          scoreAway: m.away.score ?? null,
          status,
        });
        this.dateMaps.set(matchDate, altMap);
      }
    }

    this.dateMaps.set(datePrefix, map);
    this.dateMeta.set(datePrefix, { fetchedAt: Date.now(), hasLive });
  }

  // ── HTTP ────────────────────────────────────────────────────────────────────

  private async apiGet<T>(endpoint: string): Promise<T> {
    const url = `https://${API_HOST}${endpoint}`;
    const res = await fetch(url, {
      headers: {
        'x-rapidapi-key':  this.apiKey,
        'x-rapidapi-host': API_HOST,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`CLIOverlay HTTP ${res.status}: ${endpoint}`);
    return res.json() as Promise<T>;
  }
}
