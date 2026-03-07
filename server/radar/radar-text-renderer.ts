/**
 * Radar SportPulse — Text Renderer (Rioplatense Editorial Copy Library v3)
 * Source: radar_docs/radar-editorial-copy-library-rioplatense-v3.json
 * Dev notes: radar_docs/radar-editorial-copy-v3-dev-notes.md
 *
 * V3 changes vs v2:
 *   - Templates are plain strings (no id/tone/text objects)
 *   - Tone is per-context (all templates in a context share same tone)
 *   - No remates_opcionales — every phrase is self-contained
 *   - No voice_policy/banned_phrases
 *   - New context keys per label
 *   - New tone: 'futbolero' added alongside sobrio/picante/venenoso
 */

import { createRequire } from 'node:module';
import type {
  RadarLabelKey,
  RadarSignalSubtype,
} from './radar-types.js';

const require = createRequire(import.meta.url);

// ── Copy library types (v3) ────────────────────────────────────────────────────

type ToneLevel = 'sobrio' | 'picante' | 'venenoso' | 'futbolero';

interface LibraryContextV3 {
  tone: ToneLevel;
  templates: string[];
}

interface LibraryLabelV3 {
  displayName: string;
  contexts: Record<string, LibraryContextV3>;
}

interface CopyLibraryV3 {
  version: string;
  name: string;
  labels: Record<string, LibraryLabelV3>;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const copyLib: CopyLibraryV3 = require('../../radar_docs/radar-editorial-copy-library-rioplatense-v3.json');

// ── Label key mapping (code key → v3 JSON key) ────────────────────────────────

const LABEL_TO_LIB_KEY: Record<RadarLabelKey, string> = {
  EN_LA_MIRA:       'CRUCE_PESADO',
  BAJO_EL_RADAR:    'BAJO_EL_RADAR',
  SENAL_DE_ALERTA:  'SEÑAL_DE_ALERTA',
  PARTIDO_ENGANOSO: 'PARTIDO_ENGAÑOSO',
  PARTIDO_ABIERTO:  'PARTIDO_ABIERTO',
  DUELO_CERRADO:    'DUELO_CERRADO',
};

// ── Subtype → v3 context key mapping ──────────────────────────────────────────

const SUBTYPE_TO_CONTEXT: Record<RadarSignalSubtype, string> = {
  // SENAL_DE_ALERTA → SEÑAL_DE_ALERTA (3 contexts)
  FAVORITE_DEFENSIVE_FRAGILITY:    'favorite_concedes',   // concede mucho
  UNDERDOG_COMPETITIVE_RESISTANCE: 'rival_bites',         // rival muerde
  FAVORITE_WEAK_LOCAL_EDGE:        'favorite_shaky',      // favorito inestable

  // PARTIDO_ENGANOSO → PARTIDO_ENGAÑOSO (3 contexts)
  TABLE_FORM_CONTRADICTION:    'table_lies',         // tabla engaña
  SURFACE_DISTANCE_OVERSOLD:   'surface_trap',       // trampa de superficie
  FAVORITE_NOT_AS_COMFORTABLE: 'favorite_inflated',  // favorito inflado

  // PARTIDO_ABIERTO (3 contexts)
  BOTH_SCORE_AND_CONCEDE: 'both_concede',   // los dos meten y reciben
  GOAL_EXCHANGE_SIGNAL:   'both_score',     // intercambio de goles
  LOW_CONTROL_PROFILE:    'chaos_profile',  // perfil caótico

  // DUELO_CERRADO (3 contexts)
  LOW_GOAL_VOLUME:    'low_goal',       // poco gol
  TIGHT_BALANCE:      'tight_balance',  // equilibrio duro
  LOW_MARGIN_PROFILE: 'rough_match',    // partido feo y cerrado

  // EN_LA_MIRA → CRUCE_PESADO (3 contexts)
  TOP_CONTEXT:     'season_turning',   // partido bisagra de temporada
  FORM_CONTEXT:    'heat_of_matchday', // caliente en la fecha
  MATCHDAY_WEIGHT: 'table_pressure',   // presión de tabla

  // BAJO_EL_RADAR (3 contexts)
  QUIET_COMPETITIVE_SIGNAL: 'quiet_but_spicy',  // callado pero picante
  LOW_VISIBILITY_CONTEXT:   'hidden_signals',   // señales ocultas
  NON_OBVIOUS_BALANCE:      'steals_the_show',  // se roba la fecha
};

// ── Template selection ─────────────────────────────────────────────────────────

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function selectTemplate(
  libKey: string,
  contextKey: string,
  usedTexts: Set<string>,
  seed: string = '',
): string | null {
  const label = copyLib.labels[libKey];
  if (!label) return null;

  const ctx = label.contexts[contextKey];
  if (!ctx || !ctx.templates.length) return null;

  const available = ctx.templates.filter((t) => !usedTexts.has(t));

  if (available.length > 0) {
    const offset = hashSeed(seed);
    return available[offset % available.length];
  }

  // All used in this build — fallback without dedup restriction
  const offset = hashSeed(seed);
  return ctx.templates[offset % ctx.templates.length];
}

// ── Subtype selection hints ────────────────────────────────────────────────────

export interface SubtypeHints {
  hasFavoriteFragility: boolean;
  hasUnderdogResistance: boolean;
  hasFavoriteWeakEdge: boolean;
  hasTableFormContra: boolean;
  hasHighGoalVolume: boolean;
  hasLowGoalVolume: boolean;
  hasHighBalance: boolean;
  hasTopContext: boolean;
  hasFormContext: boolean;
}

export function resolveSubtype(
  label: RadarLabelKey,
  hints: SubtypeHints,
): RadarSignalSubtype {
  if (label === 'SENAL_DE_ALERTA') {
    if (hints.hasFavoriteFragility) return 'FAVORITE_DEFENSIVE_FRAGILITY';
    if (hints.hasUnderdogResistance) return 'UNDERDOG_COMPETITIVE_RESISTANCE';
    return 'FAVORITE_WEAK_LOCAL_EDGE';
  }

  if (label === 'PARTIDO_ENGANOSO') {
    if (hints.hasTableFormContra) return 'TABLE_FORM_CONTRADICTION';
    return 'FAVORITE_NOT_AS_COMFORTABLE';
  }

  if (label === 'PARTIDO_ABIERTO') {
    if (hints.hasHighGoalVolume) return 'BOTH_SCORE_AND_CONCEDE';
    return 'GOAL_EXCHANGE_SIGNAL';
  }

  if (label === 'DUELO_CERRADO') {
    if (hints.hasLowGoalVolume) return 'LOW_GOAL_VOLUME';
    if (hints.hasHighBalance) return 'TIGHT_BALANCE';
    return 'LOW_MARGIN_PROFILE';
  }

  if (label === 'EN_LA_MIRA') {
    if (hints.hasTopContext) return 'TOP_CONTEXT';
    if (hints.hasFormContext) return 'FORM_CONTEXT';
    return 'MATCHDAY_WEIGHT';
  }

  // BAJO_EL_RADAR
  return 'QUIET_COMPETITIVE_SIGNAL';
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Renders the preMatchText for a given label + subtype using the v3
 * rioplatense editorial copy library.
 *
 * @param label               RadarLabelKey (e.g. SENAL_DE_ALERTA)
 * @param subtype             Resolved signal subtype
 * @param editorialRank       Card rank (1-based), unused in v3 (kept for compat)
 * @param dominantSignalScore Signal score [0..100], unused in v3 (kept for compat)
 * @param usedTemplateIds     Set of already-used template texts in this build
 * @param _usedRemateTexts    Unused in v3 (no remates); kept for call-site compat
 * @param matchId             Used as seed for deterministic template offset
 */
export function renderPreMatchText(
  label: RadarLabelKey,
  subtype: RadarSignalSubtype,
  _editorialRank: number,
  _dominantSignalScore: number,
  usedTemplateIds: Set<string>,
  _usedRemateTexts: Set<string>,
  matchId: string = '',
): string | null {
  const libKey = LABEL_TO_LIB_KEY[label];
  const contextKey = SUBTYPE_TO_CONTEXT[subtype];

  const text = selectTemplate(libKey, contextKey, usedTemplateIds, matchId);
  if (!text) return null;

  usedTemplateIds.add(text);
  return text;
}

// ── Reasons library ────────────────────────────────────────────────────────────
// Razones editoriales para el panel de detalle (voz rioplatense).

const REASON_TEMPLATES: Record<RadarLabelKey, string[][]> = {
  EN_LA_MIRA: [
    ['Tiene peso dentro de la fecha y no conviene mirarlo de costado.'],
    ['El contexto lo mete entre los partidos que más pueden mover.'],
    ['Llega con suficiente forma como para no pasarlo por alto.'],
  ],
  BAJO_EL_RADAR: [
    ['No es de los cruces más visibles, pero llega con señales que vale revisar.'],
    ['El momento reciente lo vuelve más interesante de lo que sugiere el fixture.'],
    ['Hay una lectura menos obvia en un partido que pasa bastante desapercibido.'],
  ],
  SENAL_DE_ALERTA: [
    ['El favorito viene concediendo con más frecuencia de la que su posición sugiere.'],
    ['El rival compite mejor de lo que la diferencia de tabla indica.'],
    ['La ventaja existe, pero la solidez reciente no termina de sostenerla.'],
  ],
  PARTIDO_ENGANOSO: [
    ['La tabla marca una diferencia que la forma reciente no acompaña del todo.'],
    ['El contexto aparente sugiere un cruce más simple del que muestran las señales.'],
    ['La distancia visible existe, pero el partido llega menos lineal de lo esperado.'],
  ],
  PARTIDO_ABIERTO: [
    ['Ambos llegan marcando con frecuencia en la previa reciente.'],
    ['Los dos vienen dejando huecos como para abrir margen al intercambio.'],
    ['El momento reciente deja más señales de ida y vuelta que de control.'],
  ],
  DUELO_CERRADO: [
    ['La previa reciente deja poca amplitud y bastante margen corto.'],
    ['No aparecen demasiadas señales de gol alto en ninguno de los dos lados.'],
    ['El cruce llega con bastante equilibrio y poco espacio para una diferencia amplia.'],
  ],
};

import type { RadarEvidenceTier } from './radar-types.js';

/**
 * Selects reasons for a Radar card.
 * Returns 2 or 3 reasons depending on evidence tier.
 */
export function selectReasons(
  label: RadarLabelKey,
  tier: RadarEvidenceTier,
  usedTexts: Set<string>,
): string[] {
  const pool = REASON_TEMPLATES[label] ?? [];
  const maxCount = 3;
  const minCount = tier === 'STABLE' ? 3 : 2;

  const selected: string[] = [];

  for (const group of pool) {
    if (selected.length >= maxCount) break;
    for (const candidate of group) {
      if (!usedTexts.has(candidate)) {
        selected.push(candidate);
        usedTexts.add(candidate);
        break;
      }
    }
  }

  // Fill to minimum if needed (allow reuse)
  if (selected.length < minCount) {
    for (const group of pool) {
      if (selected.length >= minCount) break;
      const candidate = group[0];
      if (!selected.includes(candidate)) {
        selected.push(candidate);
      }
    }
  }

  return selected.slice(0, maxCount);
}
