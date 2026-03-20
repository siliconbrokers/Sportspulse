// spec §5.1 — orquestador: source → parse → sort → cache → respond
import type { ParsedEvent, EventosServiceConfig } from './types.js';
import type { IEventSource } from './event-source.js';
import { parseEvent, sortEvents } from './event-parser.js';

export type CrestResolver = (teamName: string, league?: string) => string | null;

const DEFAULT_CONFIG: EventosServiceConfig = {
  sourceTimezoneOffsetMinutes: -300, // spec §12.4: UTC-5
  portalTimezone: 'America/Montevideo', // spec §12.3
  debugMode: false,
};

interface CachedResponse {
  events: ParsedEvent[];
  fetchedAtUtc: string;
  expiresAtMs: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

export class EventosService {
  private cache: CachedResponse | null = null;
  private readonly config: EventosServiceConfig;

  constructor(
    private readonly source: IEventSource,
    config: Partial<EventosServiceConfig> = {},
    private readonly crestResolver?: CrestResolver,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async getEvents(): Promise<{ events: ParsedEvent[]; fetchedAtUtc: string; debugMode: boolean }> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAtMs > now) {
      return {
        events: this.cache.events,
        fetchedAtUtc: this.cache.fetchedAtUtc,
        debugMode: this.config.debugMode,
      };
    }

    let rawEvents: Awaited<ReturnType<IEventSource['getEvents']>>;
    try {
      rawEvents = await this.source.getEvents();
    } catch (err) {
      if (this.cache) {
        console.warn('[Eventos] source.getEvents() failed — serving stale cache', { err: String(err) });
        return {
          events: this.cache.events,
          fetchedAtUtc: this.cache.fetchedAtUtc,
          debugMode: this.config.debugMode,
        };
      }
      console.error('[Eventos] source.getEvents() failed and no cache available', { err: String(err) });
      return { events: [], fetchedAtUtc: new Date().toISOString(), debugMode: this.config.debugMode };
    }
    const referenceDate = new Date();

    const parsed = rawEvents.map((raw, i) => {
      const ev = parseEvent(
        raw,
        i,
        referenceDate,
        this.config.sourceTimezoneOffsetMinutes,
        this.config.portalTimezone,
        this.config.debugMode,
      );
      // Enriquecer con escudos del DataSource canónico (league-aware para evitar confusión entre homónimos)
      ev.homeCrestUrl = ev.homeTeam && this.crestResolver ? this.crestResolver(ev.homeTeam, ev.normalizedLeague) : null;
      ev.awayCrestUrl = ev.awayTeam && this.crestResolver ? this.crestResolver(ev.awayTeam, ev.normalizedLeague) : null;
      return ev;
    });

    const sorted = sortEvents(parsed);
    const fetchedAtUtc = new Date().toISOString();

    this.cache = { events: sorted, fetchedAtUtc, expiresAtMs: now + CACHE_TTL_MS };

    // spec §18.2 — telemetría event_list_loaded
    const byLeague: Record<string, number> = {};
    let excluded = 0;
    for (const ev of sorted) {
      if (ev.normalizedLeague === 'EXCLUIDA') { excluded++; continue; }
      byLeague[ev.normalizedLeague] = (byLeague[ev.normalizedLeague] ?? 0) + 1;
    }
    console.log('[Eventos] event_list_loaded', { total: rawEvents.length, byLeague, excluded });

    return { events: sorted, fetchedAtUtc, debugMode: this.config.debugMode };
  }
}
