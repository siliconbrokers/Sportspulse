// spec §7 — adapter de fuente externa
// La fuente externa no está especificada en la spec — se implementa como interface configurable.
// EVENTOS_SOURCE_URL en .env apunta al proveedor real.
// Si no está configurado, se usa el mock de prueba.
import type { RawEvent } from './types.js';

export interface IEventSource {
  getEvents(): Promise<RawEvent[]>;
}

// Mock con datos de prueba realistas para validar parser y UI
export class MockEventSource implements IEventSource {
  async getEvents(): Promise<RawEvent[]> {
    return [
      // Uruguay Primera — equipos en whitelist → debe clasificar como URUGUAY_PRIMERA
      {
        text: '20:00 - Primera División: Peñarol vs Nacional',
        url: 'https://example.com/watch/penarol-nacional',
        statusText: 'Pronto',
      },
      {
        text: '22:30 - Liga AUF Uruguaya: Danubio vs Defensor Sporting',
        url: 'https://example.com/watch/danubio-defensor',
        statusText: null,
      },
      {
        text: '18:00 - Primera División: Cerro Largo vs Boston River',
        url: 'https://example.com/watch/cerrolargo-bostonriver',
        statusText: 'En Vivo',
      },
      // Primera División con equipos NO uruguayos → debe clasificar como OTRA
      {
        text: '19:00 - Primera División: Ajax vs PSV',
        url: 'https://example.com/watch/ajax-psv',
        statusText: null,
      },
      // LaLiga
      {
        text: '21:00 - LaLiga EA Sports: Real Madrid vs Barcelona',
        url: 'https://example.com/watch/realmadrid-barcelona',
        statusText: 'Pronto',
      },
      {
        text: '19:00 - Spanish La Liga: Atletico Madrid vs Sevilla',
        url: 'https://example.com/watch/atletico-sevilla',
        statusText: null,
      },
      // Premier League
      {
        text: '17:30 - Premier League: Arsenal vs Manchester City',
        url: 'https://example.com/watch/arsenal-mancity',
        statusText: 'En Vivo',
      },
      // FA Cup — debe clasificar como EXCLUIDA
      {
        text: '15:00 - FA Cup: Chelsea vs Liverpool',
        url: 'https://example.com/watch/chelsea-liverpool-facup',
        statusText: null,
      },
      // Bundesliga
      {
        text: '16:30 - Bundesliga: Bayern Munich vs Borussia Dortmund',
        url: 'https://example.com/watch/bayern-dortmund',
        statusText: 'Pronto',
      },
      // Champions League — debe clasificar como EXCLUIDA
      {
        text: '21:00 - Champions League: Real Madrid vs Bayern Munich',
        url: 'https://example.com/watch/rm-bm-ucl',
        statusText: null,
      },
      // Texto libre sin patrón → OTRA/DESCONOCIDO
      {
        text: 'Partido especial de exhibición',
        url: null,
        statusText: null,
      },
    ];
  }
}

// Adapter HTTP para proveedor externo real (configurable por env)
export class HttpEventSource implements IEventSource {
  constructor(private readonly sourceUrl: string) {}

  async getEvents(): Promise<RawEvent[]> {
    const res = await fetch(this.sourceUrl, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'SportsPulse/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      throw new Error(`EventSource HTTP error: ${res.status}`);
    }
    const data = await res.json() as unknown;
    if (!Array.isArray(data)) {
      throw new Error('EventSource: response is not an array');
    }
    // Normalizar al formato RawEvent
    return (data as Record<string, unknown>[]).map((item) => ({
      text: String(item.text ?? item.title ?? item.name ?? ''),
      url: item.url != null ? String(item.url) : null,
      statusText: item.status != null ? String(item.status) : null,
    }));
  }
}

export function buildEventSource(sourceUrl: string | undefined): IEventSource {
  if (sourceUrl) {
    return new HttpEventSource(sourceUrl);
  }
  console.warn('[EventosService] EVENTOS_SOURCE_URL not set — using mock event source');
  return new MockEventSource();
}
