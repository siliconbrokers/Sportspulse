// spec §7 — adapter de fuente externa
// Fuente real: https://streamtp10.com/eventos.json
// Formato: [{ title: "COMPETITION: HOME vs AWAY", time: "HH:MM", status: "en vivo"|"pronto", link: url, category, language }]
import type { RawEvent } from './types.js';

export const STREAMTP_EVENTOS_URL = 'https://streamtp10.com/eventos.json';

export interface IEventSource {
  getEvents(): Promise<RawEvent[]>;
}

// Formato nativo de streamtp10.com/eventos.json
interface StreamtpEvent {
  title: string;
  time: string;
  category: string;
  status: string;
  link: string;
  language: string;
}

/**
 * Adapter para streamtp10.com/eventos.json.
 *
 * El JSON devuelve múltiples filas para el mismo partido (distintos canales).
 * Se deduplica por (title + time): se conserva el primer registro con language="Español",
 * o si no hay español, el primer registro del grupo.
 *
 * El campo `text` se construye como "HH:MM - TITLE" para que el parser regex del spec §8.2
 * lo acepte sin cambios.
 */
export class StreamtpEventSource implements IEventSource {
  constructor(private readonly sourceUrl: string = STREAMTP_EVENTOS_URL) {}

  async getEvents(): Promise<RawEvent[]> {
    const res = await fetch(this.sourceUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; SportsPulse/1.0)',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`StreamTP fetch error: ${res.status}`);
    }
    const data = await res.json() as StreamtpEvent[];
    if (!Array.isArray(data)) {
      throw new Error('StreamTP: response is not an array');
    }

    // Deduplicar por (title + time), preferir language="Español"
    const groups = new Map<string, StreamtpEvent>();
    for (const item of data) {
      const key = `${item.time}|${item.title}`;
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, item);
      } else {
        // Prefiero el stream en español sobre vacío o inglés
        const lang = (item.language ?? '').toLowerCase();
        if (lang === 'español' || lang === 'spanish') {
          groups.set(key, item);
        }
      }
    }

    return Array.from(groups.values()).map((item) => ({
      // Construir el texto en el formato que espera el parser: "HH:MM - COMPETITION: HOME vs AWAY"
      text: `${item.time} - ${item.title}`,
      url: item.link || null,
      statusText: item.status || null,
    }));
  }
}

// Mock con datos de prueba (usado solo cuando no hay fuente configurada)
export class MockEventSource implements IEventSource {
  async getEvents(): Promise<RawEvent[]> {
    return [
      { text: '20:00 - Primera División: Peñarol vs Nacional', url: 'https://streamtp10.com/global1.php?stream=goltv', statusText: 'pronto' },
      { text: '22:30 - Liga AUF Uruguaya: Danubio vs Defensor Sporting', url: 'https://streamtp10.com/global1.php?stream=goltv', statusText: null },
      { text: '18:00 - Primera División: Cerro Largo vs Boston River', url: 'https://streamtp10.com/global1.php?stream=goltv', statusText: 'en vivo' },
      { text: '19:00 - Primera División: Ajax vs PSV', url: null, statusText: null },
      { text: '21:00 - LaLiga EA Sports: Real Madrid vs Barcelona', url: 'https://streamtp10.com/global1.php?stream=laligahypermotion', statusText: 'pronto' },
      { text: '17:30 - Premier League: Arsenal vs Manchester City', url: null, statusText: 'en vivo' },
      { text: '15:00 - FA Cup: Chelsea vs Liverpool', url: null, statusText: null },
      { text: '16:30 - Bundesliga: Bayern Munich vs Borussia Dortmund', url: null, statusText: 'pronto' },
      { text: '21:00 - Champions League: Real Madrid vs Bayern Munich', url: null, statusText: null },
    ];
  }
}

export function buildEventSource(sourceUrl?: string): IEventSource {
  // Por defecto siempre usa streamtp10.com; EVENTOS_SOURCE_URL puede sobreescribir
  const url = sourceUrl ?? STREAMTP_EVENTOS_URL;
  return new StreamtpEventSource(url);
}
