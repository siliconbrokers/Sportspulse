// spec §11: lógica de selección del mejor video — score basado en señales simples

import { isBlockedByPolitics } from './video-filters.js';
import { isTodayInMontevideo } from './video-filters.js';

const POSITIVE_TERMS = [
  'highlights', 'highlight',
  'resumen', 'goles', 'goals',
  'jornada', 'matchday', 'spieltag',
  'zusammenfassung',
  'previa', 'preview',
  'fecha',
];

const NEGATIVE_TERMS = [
  'live', 'en vivo',
  'promo', 'institucional', 'bienvenido', 'welcome',
  'entrevista', 'interview',
  'conferencia', 'rueda de prensa', 'press conference',
  'training', 'entrenamiento',
  'noticias del dia', 'noticias hoy',
  'behind the scenes',
];

function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .trim();
}

export interface VideoCandidate {
  videoId: string;
  title: string;
  publishedAtUtc: string;
  channelTitle: string;
  thumbnailUrl: string | null;
}

export function scoreCandidate(candidate: VideoCandidate): number {
  const title = norm(candidate.title);

  // Discard immediately if politics
  if (isBlockedByPolitics(candidate.title)) return -100;

  let score = 0;

  // Positive: relevant sport terms
  for (const term of POSITIVE_TERMS) {
    if (title.includes(term)) score += 3;
  }

  // Positive: published today > yesterday
  if (isTodayInMontevideo(candidate.publishedAtUtc)) {
    score += 4;
  }

  // Positive: has thumbnail
  if (candidate.thumbnailUrl) score += 1;

  // Negative: live / promo / generic
  for (const term of NEGATIVE_TERMS) {
    if (title.includes(norm(term))) score -= 4;
  }

  return score;
}

// Returns best candidate (score >= 0) or null
export function selectBestVideo(candidates: VideoCandidate[]): VideoCandidate | null {
  return selectTopVideos(candidates, 1)[0] ?? null;
}

/** Extrae el segmento de partido de un título (antes del primer | o —) */
function matchKey(title: string): string {
  return norm(title.split(/[|—–]/)[0]).slice(0, 40);
}

// Returns top N candidates sorted by score descending (score >= 0), deduplicated by match
export function selectTopVideos(candidates: VideoCandidate[], n: number): VideoCandidate[] {
  const scored = candidates
    .map((c) => ({ c, score: scoreCandidate(c) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score);

  // Deduplicar: primero por videoId exacto, luego por prefijo de título
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const result: VideoCandidate[] = [];
  for (const { c } of scored) {
    const key = matchKey(c.title);
    if (seenIds.has(c.videoId) || seenKeys.has(key)) continue;
    seenIds.add(c.videoId);
    seenKeys.add(key);
    result.push(c);
    if (result.length >= n) break;
  }
  return result;
}
