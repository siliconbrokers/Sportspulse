/**
 * ApifootballLiveOverlay — scores en vivo via API-Football v3 (api-sports.io).
 *
 * Estrategia de polling adaptativa basada en estado de partidos:
 *
 *   1. Hay partidos en vivo            → poll cada 2 min
 *   2. Sin live, próximo partido ≤60 min → poll cada 15 min
 *   3. Sin live, próximo partido >60 min → duerme hasta 60 min antes del kickoff
 *   4. Sin live, nada en <24h o null   → poll cada 12h (máximo)
 *   5. Budget brake activo             → throttle a 20 min
 *
 * La lógica de "cuándo es el próximo partido" se inyecta como callback
 * `minutesUntilNextMatch` desde server/index.ts, que consulta el DataSource.
 * Esto evita que el overlay haga requests innecesarios en días sin partidos.
 *
 * El contador de requests es compartido via af-budget.ts para coordinar
 * todos los consumidores del mismo APIFOOTBALL_KEY.
 *
 * Un único call a /fixtures?live=all trae TODOS los partidos en vivo de todas las ligas.
 */
import { isQuotaExhausted, isLiveBrakeActive, consumeRequest, markQuotaExhausted, getBudgetStats, getGlobalProviderClient } from '@sportpulse/canonical';
import { isCompetitionEnabled } from './portal-config-store.js';

const BASE_URL = 'https://v3.football.api-sports.io';

const POLL_LIVE_MS        =   2 * 60_000;  // 2 min  — hay live
const POLL_IDLE_MS        =  15 * 60_000;  // 15 min — sin live pero hay partido próximo
const POLL_NO_MATCH_MS    = 12 * 60 * 60_000;  // 12h — no hay partidos en las próximas 24h
const POLL_BUDGET_MS      =  20 * 60_000;  // 20 min — brake activo

/** Minutos antes del kickoff en los que el overlay retoma el poll normal (15 min). */
const WAKE_BEFORE_KICKOFF_MINS = 60;

// ── API response types ────────────────────────────────────────────────────────

interface AfFixture {
  fixture: {
    id:     number;
    date:   string;
    status: { long: string; short: string; elapsed: number | null };
  };
  league: { id: number; name: string };
  teams:  { home: { id: number; name: string }; away: { id: number; name: string } };
  goals:  { home: number | null; away: number | null };
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface LiveScoreEntry {
  home:        number;
  away:        number;
  statusShort: string;   // '1H' | 'HT' | '2H' | 'ET' | 'BT' | 'P' | 'FT' | 'AET' | 'PEN'
  elapsed:     number | null;
}

// ── Name normalization (para matching cross-API) ──────────────────────────────

/**
 * Alias table para casos irreducibles donde los nombres difieren estructuralmente
 * entre proveedores y ningún strip genérico los resuelve.
 * Clave: nombre ya normalizado por normLiveName. Valor: forma canónica compartida.
 */
const TEAM_ALIASES: Record<string, string> = {
  // Bundesliga — M'Gladbach tiene múltiples formas entre proveedores
  'borussia monchengladbach': 'gladbach',
  'borussia m gladbach':      'gladbach',
  'borussia mgladbach':       'gladbach',
  'mgladbach':                'gladbach',
  // Bundesliga — algunos proveedores omiten el año del nombre fundacional
  'bayer leverkusen':         'leverkusen',
  // LaLiga — Betis con y sin "Balompié"
  'real betis balompie':      'betis',
  'betis balompie':           'betis',
  'betis':                    'betis',
  // Argentina — nombres largos con localidad que algunos proveedores acortan
  'colon santa fe':           'colon',
  'colon':                    'colon',
  'union santa fe':           'union',
  'sarmiento junin':          'sarmiento',
  'sarmiento':                'sarmiento',
  'atletico tucuman':         'tucuman',
  'tucuman':                  'tucuman',
  'central cordoba santiago del estero': 'central cordoba',
  'central cordoba':          'central cordoba',
};

/**
 * Normaliza nombre de equipo para comparar entre proveedores (football-data.org,
 * TheSportsDB, API-Football). Diseñado para ser idempotente y seguro en ambas
 * direcciones: mismo resultado tanto si el nombre viene de la fuente primaria
 * como de API-Football.
 */
export function normLiveName(name: string): string {
  let n = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip diacritics
    .replace(/[^\w\s]/g, ' ')         // non-word chars → space (apostrophes, puntos, guiones)
    .replace(
      /\b(club|deportivo|atletico|atletica|asociacion|atl|cd|cf|ca|fc|ac|rc|sc|cs|af|sd|sp|ud|rcd|sporting|real|sv|vfb|vfl|bv|tsv|fsv|de|del|la|el|los|las)\b/g,
      '',
    )
    .replace(/\b\d{2,4}\b/g, '')      // strip year/number suffixes: "04", "1846", etc.
    .replace(/\s+/g, ' ')
    .trim();

  return TEAM_ALIASES[n] ?? n;
}

function makeKey(home: string, away: string): string {
  return `${normLiveName(home)}|${normLiveName(away)}`;
}

// ── Overlay ───────────────────────────────────────────────────────────────────

export class ApifootballLiveOverlay {
  /** Index primario: normKey → LiveScoreEntry */
  private cache: Map<string, LiveScoreEntry> = new Map();
  /** Lista raw para fallback de búsqueda por contains */
  private rawList: Array<{ homeNorm: string; awayNorm: string; leagueId: number; entry: LiveScoreEntry }> = [];

  private hasLive = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private _started = false;

  constructor(
    private readonly apiKey: string,
    private readonly trackedCompetitionIds: string[] = [],
    /** Optional: returns minutes until the next scheduled match, or null if unknown. */
    private readonly minutesUntilNextMatch?: () => number | null,
  ) {}

  start(): void {
    if (this._started) return;
    this._started = true;
    if (!this.apiKey) {
      console.warn('[LiveOverlay] APIFOOTBALL_KEY no configurada — overlay desactivado');
      return;
    }
    console.log('[LiveOverlay] Iniciando polling de scores en vivo (API-Football v3)');
    void this.poll();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Devuelve el score en vivo para el par de equipos dado, o null si no está en vivo.
   * Primero busca por exact normalized key; si no encuentra, intenta contains matching.
   */
  getLiveScore(homeTeam: string, awayTeam: string): LiveScoreEntry | null {
    const key = makeKey(homeTeam, awayTeam);
    const hit = this.cache.get(key);
    if (hit) return hit;

    // Fallback: contains matching para nombres que difieren estructuralmente
    const homeNorm = normLiveName(homeTeam);
    const awayNorm = normLiveName(awayTeam);
    for (const { homeNorm: kh, awayNorm: ka, entry } of this.rawList) {
      if (
        (kh.includes(homeNorm) || homeNorm.includes(kh)) &&
        (ka.includes(awayNorm) || awayNorm.includes(ka))
      ) {
        return entry;
      }
    }

    // Log miss para diagnóstico — solo si hay partidos en el cache (evita spam cuando no hay live)
    if (this.rawList.length > 0) {
      console.warn(
        `[LiveOverlay] MISS "${homeTeam}" vs "${awayTeam}" ` +
        `(norm: "${homeNorm}" | "${awayNorm}") — ` +
        `cache keys: ${[...this.cache.keys()].slice(0, 5).join(', ')}${this.cache.size > 5 ? ` (+${this.cache.size - 5} más)` : ''}`,
      );
    }
    return null;
  }

  get liveCount(): number { return this.rawList.length; }

  /** Returns the set of AF league IDs that currently have a live match in the overlay. */
  getLiveLeagueIds(): Set<number> {
    const ids = new Set<number>();
    for (const { leagueId } of this.rawList) ids.add(leagueId);
    return ids;
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private clearLiveData(): void {
    this.cache   = new Map();
    this.rawList = [];
    this.hasLive = false;
  }

  private async poll(): Promise<void> {
    // Skip poll entirely if all tracked competitions are disabled in portal config
    if (
      this.trackedCompetitionIds.length > 0 &&
      !this.trackedCompetitionIds.some((id) => isCompetitionEnabled(id))
    ) {
      console.log('[LiveOverlay] Todas las competencias AF deshabilitadas — poll omitido');
      this.cache   = new Map();
      this.rawList = [];
      this.hasLive = false;
      this.timer = setTimeout(() => void this.poll(), POLL_IDLE_MS);
      return;
    }

    let nextInterval: number;

    if (isQuotaExhausted()) {
      nextInterval = POLL_BUDGET_MS;
      const stats = getBudgetStats();
      console.log(`[LiveOverlay] Cuota agotada (${stats.requestsToday}/${stats.limit} req hoy) — próximo poll en 20 min`);
    } else if (isLiveBrakeActive()) {
      nextInterval = POLL_BUDGET_MS;
      const stats = getBudgetStats();
      console.log(`[LiveOverlay] Budget brake activo (${stats.requestsToday}/${stats.limit} req hoy) — próximo poll en 20 min`);
    } else {
      try {
        const data = await this.apiFetch<{ response: AfFixture[] }>('/fixtures?live=all');
        // consumeRequest() is called inside apiFetch when no instrumented client is available.
        // When the global client is used, recordEvent() already captures the usage.

        const newCache  = new Map<string, LiveScoreEntry>();
        const newRaw: typeof this.rawList = [];

        for (const f of data.response ?? []) {
          const entry: LiveScoreEntry = {
            home:        f.goals.home  ?? 0,
            away:        f.goals.away  ?? 0,
            statusShort: f.fixture.status.short,
            elapsed:     f.fixture.status.elapsed,
          };
          const homeNorm = normLiveName(f.teams.home.name);
          const awayNorm = normLiveName(f.teams.away.name);
          newCache.set(`${homeNorm}|${awayNorm}`, entry);
          newRaw.push({ homeNorm, awayNorm, leagueId: f.league.id, entry });
        }

        this.cache   = newCache;
        this.rawList = newRaw;
        this.hasLive = newRaw.length > 0;

        if (this.hasLive) {
          const stats = getBudgetStats();
          console.log(
            `[LiveOverlay] ${newRaw.length} partidos en vivo ` +
            `(req hoy: ${stats.requestsToday}/${stats.limit})`,
          );
        }
      } catch (err) {
        console.warn('[LiveOverlay] Error en poll:', err instanceof Error ? err.message : err);
        // Clear stale live data so zombie scores do not persist across failed poll cycles.
        this.clearLiveData();
      }

      if (this.hasLive) {
        nextInterval = POLL_LIVE_MS;
      } else {
        // If a callback is available, check how far the next match is.
        // If it's more than WAKE_BEFORE_KICKOFF_MINS away, sleep until
        // WAKE_BEFORE_KICKOFF_MINS before kickoff (capped at POLL_NO_MATCH_MS).
        const mins = this.minutesUntilNextMatch?.() ?? null;
        if (mins !== null && mins > WAKE_BEFORE_KICKOFF_MINS) {
          const sleepMins = Math.min(mins - WAKE_BEFORE_KICKOFF_MINS, POLL_NO_MATCH_MS / 60_000);
          nextInterval = sleepMins * 60_000;
          console.log(`[LiveOverlay] Próximo partido en ${Math.round(mins)} min — durmiendo ${Math.round(sleepMins)} min`);
        } else {
          nextInterval = POLL_IDLE_MS;
        }
      }
    }

    this.timer = setTimeout(() => void this.poll(), nextInterval);
  }

  private async apiFetch<T extends object>(endpoint: string): Promise<T> {
    const url = `${BASE_URL}${endpoint}`;
    const client = getGlobalProviderClient();
    let res: Response;
    if (client) {
      res = await client.fetch(url, {
        headers: { 'x-apisports-key': this.apiKey },
        signal:  AbortSignal.timeout(10_000),
        providerKey: 'api-football',
        consumerType: 'PORTAL_RUNTIME',
        priorityTier: 'product-critical',
        moduleKey: 'apifootball-live-overlay',
        operationKey: 'fixtures-live-all',
      });
    } else {
      res = await fetch(url, {
        headers: { 'x-apisports-key': this.apiKey },
        signal:  AbortSignal.timeout(10_000),
      });
      // Legacy path: manually record usage when no instrumented client available
      consumeRequest();
    }
    if (!res.ok) throw new Error(`API-Football HTTP ${res.status}: ${endpoint}`);
    const data = await res.json() as T;
    const dataAny = data as { errors?: { requests?: unknown } };
    if (dataAny?.errors?.requests) {
      markQuotaExhausted();
      throw new Error(`API-Football quota: ${dataAny.errors.requests}`);
    }
    return data;
  }
}
