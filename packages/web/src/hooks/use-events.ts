import { useState, useEffect } from 'react';

export type EventStatus = 'EN_VIVO' | 'PROXIMO' | 'DESCONOCIDO';
export type NormalizedLeague =
  | 'URUGUAY_PRIMERA'
  | 'LALIGA'
  | 'PREMIER_LEAGUE'
  | 'BUNDESLIGA'
  | 'OTRA'
  | 'EXCLUIDA';

export interface ParsedEvent {
  id: string;
  rawText: string;
  sourceUrl: string;
  sourceLanguage: string;
  sourceTimeText: string | null;
  sourceCompetitionText: string | null;
  sourceStatusText: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  normalizedLeague: NormalizedLeague;
  normalizedStatus: EventStatus;
  sourceTimezoneOffsetMinutes: number | null;
  startsAtSource: string | null;
  startsAtPortalTz: string | null;
  isTodayInPortalTz: boolean;
  isDebugVisible: boolean;
  openUrl: string | null;
}

export interface EventosFeed {
  events: ParsedEvent[];
  fetchedAtUtc: string;
  debugMode: boolean;
}

// spec §18.2 — telemetría mínima (console.log estructurado en V1)
function trackEventOpen(eventId: string, league: string, mode: 'DIRECT' | 'EMBED_TEST') {
  console.log('[Eventos] event_open_clicked', {
    event_id: eventId,
    normalized_league: league,
    open_mode: mode,
    timestamp: new Date().toISOString(),
  });
}

// Abre en nueva pestaña con URL del portal (la URL del proveedor permanece server-side)
export function openEventDirect(event: ParsedEvent) {
  trackEventOpen(event.id, event.normalizedLeague, 'DIRECT');
  window.open(`/eventos/ver?id=${encodeURIComponent(event.id)}&mode=direct`, '_blank', 'noopener');
}

export function openEventEmbedTest(event: ParsedEvent) {
  trackEventOpen(event.id, event.normalizedLeague, 'EMBED_TEST');
  window.open(`/eventos/ver?id=${encodeURIComponent(event.id)}&mode=embed`, '_blank', 'noopener');
}

export function useEvents(enabled: boolean) {
  const [data, setData] = useState<EventosFeed | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch('/api/ui/eventos', { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<EventosFeed>;
      })
      .then((feed) => {
        if (!controller.signal.aborted) {
          setData(feed);
          // spec §18.2 — event_list_loaded en frontend
          const byLeague: Record<string, number> = {};
          let excluded = 0;
          for (const ev of feed.events) {
            if (ev.normalizedLeague === 'EXCLUIDA') {
              excluded++;
              continue;
            }
            byLeague[ev.normalizedLeague] = (byLeague[ev.normalizedLeague] ?? 0) + 1;
          }
          console.log('[Eventos] event_list_loaded (frontend)', {
            total: feed.events.length,
            byLeague,
            excluded,
          });
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Error desconocido');
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [enabled]);

  return { data, loading, error };
}

// Carga un evento individual por ID — la openUrl viene del servidor, nunca del query param
export function useEventById(id: string | null) {
  const [data, setData] = useState<ParsedEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`/api/ui/eventos/event/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ParsedEvent>;
      })
      .then((event) => {
        if (!controller.signal.aborted) {
          setData(event);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Error');
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [id]);

  return { data, loading, error };
}
