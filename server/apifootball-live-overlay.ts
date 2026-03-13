/**
 * ApifootballLiveOverlay — scores en vivo via API-Football v3 (api-sports.io).
 *
 * Estrategia de budget (free tier: 100 req/día):
 *   - Hay partidos en vivo  → poll cada 2 min
 *   - Sin partidos en vivo  → poll cada 15 min
 *   - Requests today >= 90  → throttle a 20 min sin importar estado
 *
 * Peor caso (3 ventanas de 90 min en vivo):  3 × 45 = 135 req — podría exceder 100.
 * Caso típico (1-2 ventanas + idle):         ~50-80 req — dentro del límite.
 *
 * Un único call a /fixtures?live=all trae TODOS los partidos en vivo de todas las ligas.
 */

const BASE_URL = 'https://v3.football.api-sports.io';

const POLL_LIVE_MS   = 2  * 60_000;  // 2 min — hay live
const POLL_IDLE_MS   = 15 * 60_000;  // 15 min — sin live
const POLL_BUDGET_MS = 20 * 60_000;  // 20 min — cerca del límite diario
const DAILY_BUDGET   = 100;
const BUDGET_BRAKE   = 90;           // empieza a throttlear a partir de 90

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

/** Normaliza nombre de equipo para comparar entre football-data.org y API-Football. */
export function normLiveName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')           // strip accents
    .replace(/\b(club|deportivo|atletico|atl|cd|cf|ca|fc|ac|rc|sc|cs|af|sd|sp|ud|rcd|sporting|real)\b/g, '')
    .replace(/[^\w]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeKey(home: string, away: string): string {
  return `${normLiveName(home)}|${normLiveName(away)}`;
}

// ── Overlay ───────────────────────────────────────────────────────────────────

export class ApifootballLiveOverlay {
  /** Index primario: normKey → LiveScoreEntry */
  private cache: Map<string, LiveScoreEntry> = new Map();
  /** Lista raw para fallback de búsqueda por contains */
  private rawList: Array<{ homeNorm: string; awayNorm: string; entry: LiveScoreEntry }> = [];

  private hasLive       = false;
  private requestsToday = 0;
  private dayStart      = Date.now();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly apiKey: string) {}

  start(): void {
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

    // Fallback: contains matching para nombres que difieren (ej: "Atletico" vs "Club Atletico")
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
    return null;
  }

  get liveCount(): number { return this.rawList.length; }

  // ── Private ──────────────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    this.resetDayIfNeeded();

    let nextInterval: number;

    if (this.requestsToday >= BUDGET_BRAKE) {
      nextInterval = POLL_BUDGET_MS;
      console.log(`[LiveOverlay] Budget brake activo (${this.requestsToday}/${DAILY_BUDGET} req hoy) — próximo poll en 20 min`);
    } else {
      try {
        const data = await this.apiFetch<{ response: AfFixture[] }>('/fixtures?live=all');
        this.requestsToday++;

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
          newRaw.push({ homeNorm, awayNorm, entry });
        }

        this.cache   = newCache;
        this.rawList = newRaw;
        this.hasLive = newRaw.length > 0;

        if (this.hasLive) {
          console.log(
            `[LiveOverlay] ${newRaw.length} partidos en vivo ` +
            `(req hoy: ${this.requestsToday}/${DAILY_BUDGET})`,
          );
        }
      } catch (err) {
        console.warn('[LiveOverlay] Error en poll:', err instanceof Error ? err.message : err);
        this.hasLive = false;
      }

      nextInterval = this.hasLive ? POLL_LIVE_MS : POLL_IDLE_MS;
    }

    this.timer = setTimeout(() => void this.poll(), nextInterval);
  }

  private resetDayIfNeeded(): void {
    const dayMs = 24 * 60 * 60_000;
    if (Date.now() - this.dayStart >= dayMs) {
      this.dayStart      = Date.now();
      this.requestsToday = 0;
    }
  }

  private async apiFetch<T>(endpoint: string): Promise<T> {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      headers: { 'x-apisports-key': this.apiKey },
      signal:  AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`API-Football HTTP ${res.status}: ${endpoint}`);
    return res.json() as Promise<T>;
  }
}
