/**
 * flashscore-scraper — scraping de incidentes de partido desde Flashscore.
 *
 * URL target: https://www.flashscore.com/match/{fsId}/#/match-summary/match-summary
 *
 * Los incidentes (goles, tarjetas, sustituciones) están en .smv__incident elements.
 * El teamSide se infiere por la posición del elemento (izquierda = local, derecha = visita).
 *
 * NOTA: Los selectores CSS deben verificarse contra el HTML real de Flashscore.
 * Si cambia el markup, actualizar los selectores aquí.
 */
import { load as cheerioLoad } from 'cheerio';
import type { IncidentEvent, IncidentType } from './types.js';

const FS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Referer': 'https://www.flashscore.com/',
  'DNT': '1',
};

// ── Mapeo de clases CSS → tipo de incidente ───────────────────────────────────

function detectIncidentType(classAttr: string, detail: string): IncidentType {
  const c = classAttr.toLowerCase();
  const d = detail.toLowerCase();

  if (c.includes('yellowred') || c.includes('yellow-red')) return 'YELLOW_RED_CARD';
  if (c.includes('redcard') || c.includes('red-card'))     return 'RED_CARD';
  if (c.includes('yellowcard') || c.includes('yellow-card')) return 'YELLOW_CARD';
  if (c.includes('substitution') || c.includes('subst'))   return 'SUBSTITUTION';
  if (c.includes('var'))                                   return 'VAR';
  if (c.includes('penalty') && d.includes('miss'))         return 'PENALTY_MISSED';
  if (c.includes('penalty'))                               return 'PENALTY_GOAL';
  if (c.includes('owngoal') || c.includes('own-goal') || d.includes('own goal')) return 'OWN_GOAL';
  if (c.includes('goal'))                                  return 'GOAL';

  return 'GOAL'; // fallback
}

/**
 * Parsea el HTML del match summary de Flashscore y extrae los incidentes.
 * Retorna array vacío si no hay datos o la estructura cambió.
 */
function parseIncidentsHtml(html: string): IncidentEvent[] {
  const $ = cheerioLoad(html);
  const events: IncidentEvent[] = [];

  // Flashscore estructura los incidentes en .smv__incident dentro de .smv__incidentsList
  // Cada incident tiene:
  //   .smv__incidentTime        — minuto (e.g., "23'", "45+2'")
  //   .smv__incidentIcon img    — clase del ícono revela el tipo de evento
  //   .smv__incidentParticipant — nombre del jugador principal
  //   .smv__assist              — nombre del asistente (goles) o jugador que sale (sustituciones)
  //   clase del contenedor:  smv__incident--home o smv__incident--away → teamSide

  $('.smv__incident').each((_, el) => {
    const $el = $(el);
    const classAttr = $el.attr('class') ?? '';
    const teamSide: 'HOME' | 'AWAY' = classAttr.includes('--away') ? 'AWAY' : 'HOME';

    // Minuto
    const timeText = $el.find('.smv__incidentTime').text().trim().replace("'", '');
    const [minPart, extraPart] = timeText.split('+');
    const minute = parseInt(minPart, 10);
    if (isNaN(minute)) return;
    const minuteExtra = extraPart ? parseInt(extraPart, 10) : undefined;

    // Tipo de incidente (por clase del ícono o del contenedor)
    const iconClass = $el.find('.smv__incidentIcon').attr('class') ?? '';
    const detailText = $el.find('.smv__incidentParticipant').text().trim();
    const type = detectIncidentType(classAttr + ' ' + iconClass, detailText);

    // Nombres de jugadores
    const playerName   = $el.find('.smv__incidentParticipant').first().text().trim() || undefined;
    const assistOrSub  = $el.find('.smv__assist').text().trim() || undefined;

    const event: IncidentEvent = {
      type,
      minute,
      minuteExtra,
      teamSide,
      playerName,
    };

    if (type === 'SUBSTITUTION') {
      event.playerOutName = assistOrSub;
    } else if (type === 'GOAL' || type === 'PENALTY_GOAL') {
      event.assistName = assistOrSub;
    }

    events.push(event);
  });

  return events;
}

/**
 * Fetch y parsea incidentes de un partido de Flashscore por su ID interno.
 * Retorna [] si falla el fetch o el HTML no tiene datos esperados (AC-7).
 */
export async function scrapeMatchIncidents(fsId: string): Promise<IncidentEvent[]> {
  const url = `https://www.flashscore.com/match/${fsId}/#/match-summary/match-summary`;
  console.log(`[FlashscoreScraper] Scraping ${url}`);

  try {
    const res = await fetch(url, { headers: FS_HEADERS });
    if (!res.ok) {
      console.warn(`[FlashscoreScraper] HTTP ${res.status} for fsId=${fsId}`);
      return [];
    }
    const html = await res.text();
    const events = parseIncidentsHtml(html);
    console.log(`[FlashscoreScraper] fsId=${fsId} → ${events.length} incidents`);
    return events;
  } catch (err) {
    console.warn(`[FlashscoreScraper] Failed for fsId=${fsId}:`, err);
    return [];
  }
}
