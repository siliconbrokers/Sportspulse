// spec §8, §9, §10, §11, §12 — parsing, normalización y manejo horario
import type { ParsedEvent, RawEvent, NormalizedLeague, EventStatus } from './types.js';

// spec §8.2
const EVENT_PATTERN = /^(?<time>\d{2}:\d{2})\s*-\s*(?<competition>[^:]+):\s*(?<home>.+?)\s+vs\s+(?<away>.+?)$/i;

// spec §9.1 — aliases por liga objetivo
const BUNDESLIGA_ALIASES = ['bundesliga', 'german bundesliga', 'bundesliga 1'];
const LALIGA_ALIASES = ['laliga', 'spanish la liga', 'laliga ea sports', 'la liga'];
const PREMIER_ALIASES = ['premier league', 'epl', 'english premier league'];
const URUGUAY_ALIASES = ['primera división', 'primera division', 'liga auf uruguaya', 'apertura auf'];

// spec §9.2 — torneos excluidos
const EXCLUDED_COMPETITIONS = [
  'fa cup', 'copa del rey', 'dfb pokal', 'carabao cup',
  'champions league', 'europa league', 'conference league',
  'copa libertadores', 'copa sudamericana',
];

// spec §10.3 — whitelist inicial de equipos uruguayos
const URUGUAY_TEAM_WHITELIST = [
  'peñarol', 'penarol', 'nacional', 'danubio', 'progreso', 'albion',
  'defensor sporting', 'liverpool montevideo', 'liverpool', 'montevideo wanderers',
  'wanderers', 'cerro largo', 'racing montevideo', 'racing', 'boston river',
  'plaza colonia', 'cerro', 'river plate uy', 'river plate', 'miramar misiones',
  'miramar', 'juventud',
];

function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

// spec §9 — normalización de competición
function normalizeLeague(competition: string, home: string | null, away: string | null): NormalizedLeague {
  const c = norm(competition);

  // spec §9.2 — excluir primero
  for (const ex of EXCLUDED_COMPETITIONS) {
    if (c.includes(ex)) return 'EXCLUIDA';
  }

  if (BUNDESLIGA_ALIASES.some((a) => c === a || c.includes(a))) return 'BUNDESLIGA';
  if (LALIGA_ALIASES.some((a) => c === a || c.includes(a))) return 'LALIGA';
  if (PREMIER_ALIASES.some((a) => c === a || c.includes(a))) return 'PREMIER_LEAGUE';

  // spec §10 — Uruguay requiere validación por equipos
  if (URUGUAY_ALIASES.some((a) => c === a || c.includes(a))) {
    if (isUruguayMatch(home, away)) return 'URUGUAY_PRIMERA';
    // spec §10.4 — sin equipos válidos → OTRA
    return 'OTRA';
  }

  // spec §9.3
  return 'OTRA';
}

// spec §10.2 — al menos uno de los equipos debe estar en whitelist
function isUruguayMatch(home: string | null, away: string | null): boolean {
  if (!home && !away) return false;
  const teams = [home, away].filter(Boolean).map((t) => norm(t!));
  return teams.some((t) => URUGUAY_TEAM_WHITELIST.some((wl) => t.includes(wl)));
}

// spec §11 — normalización de estado
// Cubre: "En Vivo", "en vivo", "Live", "LIVE" → EN_VIVO
//        "Pronto", "pronto", "Soon", "Upcoming" → PROXIMO
function normalizeStatus(statusText: string | null): EventStatus {
  if (!statusText) return 'DESCONOCIDO';
  const s = norm(statusText);
  if (s === 'en vivo' || s === 'live' || s === 'en_vivo') return 'EN_VIVO';
  if (s === 'pronto' || s === 'soon' || s === 'upcoming' || s === 'next') return 'PROXIMO';
  return 'DESCONOCIDO';
}

// spec §12 — conversión horaria configurable
function convertTime(
  timeText: string,
  referenceDate: Date,
  sourceOffsetMinutes: number,
  portalTimezone: string,
): { startsAtSource: string; startsAtPortalTz: string; isTodayInPortalTz: boolean } {
  const [hh, mm] = timeText.split(':').map(Number);
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();
  const day = referenceDate.getUTCDate();

  // Construir datetime de origen: la hora del proveedor en su offset (UTC-5 = -300 min)
  // hour:min es la hora local del proveedor → UTC = local - offset
  const sourceLocalMs = Date.UTC(year, month, day, hh, mm, 0, 0);
  // offset del proveedor: si sourceOffsetMinutes = -300, proveedor está UTC-5
  // UTC = sourceLocal - offsetMinutes*60000  (offset negativo → restar negativo = sumar)
  const utcMs = sourceLocalMs - sourceOffsetMinutes * 60_000;

  const utcDate = new Date(utcMs);
  const startsAtSource = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${timeText}:00`;

  const startsAtPortalTz = utcDate.toLocaleString('sv-SE', { timeZone: portalTimezone }).replace(' ', 'T');

  // Verificar si es hoy en la zona del portal
  const nowInPortal = new Date().toLocaleDateString('sv-SE', { timeZone: portalTimezone });
  const eventDateInPortal = utcDate.toLocaleDateString('sv-SE', { timeZone: portalTimezone });
  const isTodayInPortalTz = nowInPortal === eventDateInPortal;

  return { startsAtSource, startsAtPortalTz, isTodayInPortalTz };
}

// Generar ID determinista a partir del texto del evento
function generateId(rawText: string, index: number): string {
  const base = rawText.replace(/\s+/g, '-').toLowerCase().slice(0, 40);
  return `ev-${index}-${base}`;
}

// spec §8 — parse de un evento raw
export function parseEvent(
  raw: RawEvent,
  index: number,
  referenceDate: Date,
  sourceOffsetMinutes: number,
  portalTimezone: string,
  debugMode: boolean,
): ParsedEvent {
  const match = EVENT_PATTERN.exec(raw.text.trim());

  if (!match?.groups) {
    // spec §8.3 — no matchea → conservar rawText, marcar OTRA / DESCONOCIDO
    return {
      id: generateId(raw.text, index),
      rawText: raw.text,
      sourceUrl: raw.url ?? '',
      sourceLanguage: 'UNKNOWN',
      sourceTimeText: null,
      sourceCompetitionText: null,
      sourceStatusText: raw.statusText,
      homeTeam: null,
      awayTeam: null,
      normalizedLeague: 'OTRA',
      normalizedStatus: 'DESCONOCIDO',
      sourceTimezoneOffsetMinutes: sourceOffsetMinutes,
      startsAtSource: null,
      startsAtPortalTz: null,
      isTodayInPortalTz: false,
      isDebugVisible: debugMode,
      openUrl: raw.url,
    };
  }

  const { time, competition, home, away } = match.groups;
  const normalizedLeague = normalizeLeague(competition, home.trim(), away.trim());
  const normalizedStatus = normalizeStatus(raw.statusText);

  let startsAtSource: string | null = null;
  let startsAtPortalTz: string | null = null;
  let isTodayInPortalTz = false;

  try {
    const converted = convertTime(time, referenceDate, sourceOffsetMinutes, portalTimezone);
    startsAtSource = converted.startsAtSource;
    startsAtPortalTz = converted.startsAtPortalTz;
    isTodayInPortalTz = converted.isTodayInPortalTz;
  } catch {
    // spec §23.3 — hora inválida: mantener en debug
  }

  return {
    id: generateId(raw.text, index),
    rawText: raw.text,
    sourceUrl: raw.url ?? '',
    sourceLanguage: 'ES',
    sourceTimeText: time,
    sourceCompetitionText: competition.trim(),
    sourceStatusText: raw.statusText,
    homeTeam: home.trim(),
    awayTeam: away.trim(),
    normalizedLeague,
    normalizedStatus,
    sourceTimezoneOffsetMinutes: sourceOffsetMinutes,
    startsAtSource,
    startsAtPortalTz,
    isTodayInPortalTz,
    isDebugVisible: debugMode,
    openUrl: raw.url,
  };
}

// spec §11.3 — ordenamiento por estado y hora
export function sortEvents(events: ParsedEvent[]): ParsedEvent[] {
  const statusOrder: Record<EventStatus, number> = { EN_VIVO: 0, PROXIMO: 1, DESCONOCIDO: 2 };
  return [...events].sort((a, b) => {
    const so = (statusOrder[a.normalizedStatus] ?? 2) - (statusOrder[b.normalizedStatus] ?? 2);
    if (so !== 0) return so;
    const ta = a.startsAtPortalTz ?? a.startsAtSource ?? '';
    const tb = b.startsAtPortalTz ?? b.startsAtSource ?? '';
    return ta.localeCompare(tb);
  });
}
