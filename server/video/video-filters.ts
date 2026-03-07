// spec §7: ventana temporal — hoy o últimas 48h
// spec §9: filtro anti-política obligatorio

const BLOCKED_PHRASES = [
  'elecciones nacionales',
  'campaña electoral',
  'partido político',
  'presidente de la república',
];

const BLOCKED_WORDS = [
  'elecciones',
  'presidenciales',
  'candidato',
  'parlamento',
  'congreso',
  'senado',
  'diputado',
  'senador',
  'gobierno',
  'ministerio',
  'ministro',
  'coalición',
  'intendencia',
  'alcalde',
];

function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isBlockedByPolitics(title: string): boolean {
  const text = norm(title);
  for (const phrase of BLOCKED_PHRASES) {
    if (text.includes(norm(phrase))) return true;
  }
  for (const word of BLOCKED_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return true;
  }
  return false;
}

export function isWithin48Hours(publishedAtUtc: string): boolean {
  const pub = new Date(publishedAtUtc);
  if (isNaN(pub.getTime())) return false;
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  return pub >= cutoff && pub <= new Date();
}

export function isTodayInMontevideo(publishedAtUtc: string): boolean {
  const pub = new Date(publishedAtUtc);
  if (isNaN(pub.getTime())) return false;
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo' });
  return fmt.format(pub) === fmt.format(new Date()) && pub <= new Date();
}

/**
 * Returns true if the video is available in the given region.
 * Uses the availability data from videos.list (contentDetails.regionRestriction).
 *
 * - If embeddable === false → blocked
 * - If blockedRegions includes regionCode (case-insensitive) → blocked
 * - If allowedRegions is non-empty and doesn't include regionCode → blocked
 * - Otherwise → available
 */
import type { YtVideoAvailability } from './youtube-client.js';

export function isAvailableInRegion(
  availability: YtVideoAvailability | undefined,
  regionCode: string,
): boolean {
  if (!availability) return true; // unknown → optimistic, let it through
  if (!availability.embeddable) return false;

  const region = regionCode.toUpperCase();

  if (availability.blockedRegions.map((r) => r.toUpperCase()).includes(region)) {
    return false;
  }

  if (
    availability.allowedRegions.length > 0 &&
    !availability.allowedRegions.map((r) => r.toUpperCase()).includes(region)
  ) {
    return false;
  }

  return true;
}
