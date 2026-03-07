import type { NewsHeadline } from './types.js';

// ── Anti-politics filter (spec §8) ────────────────────────────────────────────
// NOTE: "presidente" solo NO está bloqueado (spec §8 observación)

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

export function isBlockedByPolitics(title: string, snippet = ''): boolean {
  const text = norm(title + ' ' + snippet);
  for (const phrase of BLOCKED_PHRASES) {
    if (text.includes(norm(phrase))) return true;
  }
  for (const word of BLOCKED_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return true;
  }
  return false;
}

// ── "Del día" filter (spec §10) ───────────────────────────────────────────────

export function isTodayInMontevideo(publishedAtUtc: string): boolean {
  const pub = new Date(publishedAtUtc);
  if (isNaN(pub.getTime())) return false;
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo' });
  return fmt.format(pub) === fmt.format(now) && pub <= now;
}

// ── Deduplication (spec §11) ──────────────────────────────────────────────────

export function normalizeTitle(title: string): string {
  return norm(title)
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function deduplicate(items: NewsHeadline[]): NewsHeadline[] {
  const seen = new Map<string, NewsHeadline>();
  for (const item of items) {
    const key = normalizeTitle(item.title) + '|' + extractDomain(item.url);
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, item);
      continue;
    }
    const newer = new Date(item.publishedAtUtc) > new Date(prev.publishedAtUtc);
    const betterImg = !prev.imageUrl && item.imageUrl;
    if (newer || betterImg) seen.set(key, item);
  }
  return [...seen.values()];
}
