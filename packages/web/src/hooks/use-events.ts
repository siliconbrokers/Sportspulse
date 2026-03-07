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
function trackEventOpen(event: ParsedEvent, mode: 'DIRECT' | 'EMBED_TEST') {
  console.log('[Eventos] event_open_clicked', {
    event_id: event.id,
    normalized_league: event.normalizedLeague,
    open_mode: mode,
    source_url: event.openUrl,
    timestamp: new Date().toISOString(),
  });
}

export function openEventDirect(event: ParsedEvent) {
  trackEventOpen(event, 'DIRECT');
  if (event.openUrl) {
    window.open(event.openUrl, '_blank', 'noopener,noreferrer');
  }
}

export function openEventEmbedTest(event: ParsedEvent) {
  trackEventOpen(event, 'EMBED_TEST');
  const params = new URLSearchParams({
    id: event.id,
    url: event.openUrl ?? '',
    home: event.homeTeam ?? '',
    away: event.awayTeam ?? '',
    league: event.normalizedLeague,
    status: event.normalizedStatus,
    time: event.startsAtPortalTz ?? '',
  });
  window.open(`/eventos/player-test?${params.toString()}`, '_blank', 'noopener');
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
