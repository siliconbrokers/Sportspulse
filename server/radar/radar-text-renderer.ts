/**
 * Radar SportPulse — Text Renderer (Rioplatense Editorial Copy Library v2 — Expanded)
 * Source: radar_docs/radar-editorial-copy-library-rioplatense-expanded.json
 * Dev notes: radar_docs/radar-editorial-copy-expanded-dev-notes.md
 *
 * Tone selection:
 *   - sobrio: partidos normales (EN_LA_MIRA / cruce_pesado)
 *   - picante: default recomendado
 *   - venenoso: señales fuertes en labels elegibles (umbral ≥ 78)
 *
 * Render rules (expanded v2):
 *   - max_remate_usage_ratio = 0.45 (≈ cada 2-3 cards)
 *   - block_same_template_within_last_n_generated = 24
 *   - prefer_different_context_if_same_label_repeats = true
 */

import { createRequire } from 'node:module';
import type {
  RadarLabelKey,
  RadarSignalSubtype,
  RadarEvidenceTier,
} from './radar-types.js';

const require = createRequire(import.meta.url);

// ── Copy library types ─────────────────────────────────────────────────────────

type ToneLevel = 'sobrio' | 'picante' | 'venenoso';

interface LibraryTemplate {
  id: string;
  tone: ToneLevel;
  text: string;
}

interface LibraryContext {
  key: string;
  templates: LibraryTemplate[];
}

interface LibraryLabel {
  contexts: LibraryContext[];
}

/** Remates opcionales en v2: strings simples categorizados por tono */
interface RematesOpcionales {
  general: string[];
  picantes: string[];
  venenosos: string[];
}

interface CopyLibrary {
  labels: Record<string, LibraryLabel>;
  remates_opcionales: RematesOpcionales;
  voice_policy: {
    banned_phrases: string[];
  };
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const copyLib: CopyLibrary = require('../../radar_docs/radar-editorial-copy-library-rioplatense-expanded.json');

// ── Label key mapping ──────────────────────────────────────────────────────────
// EN_LA_MIRA maps to 'cruce_pesado' in the library (match with table weight)

const LABEL_TO_LIB_KEY: Record<RadarLabelKey, string> = {
  EN_LA_MIRA:       'cruce_pesado',
  BAJO_EL_RADAR:    'bajo_el_radar',
  SENAL_DE_ALERTA:  'senal_de_alerta',
  PARTIDO_ENGANOSO: 'partido_enganoso',
  PARTIDO_ABIERTO:  'partido_abierto',
  DUELO_CERRADO:    'duelo_cerrado',
};

// ── Subtype → library context key mapping (v2 expanded — context keys updated) ─

const SUBTYPE_TO_CONTEXT: Record<RadarSignalSubtype, string> = {
  // EN_LA_MIRA → cruce_pesado (4 contexts: points_burn, table_can_move, pressure_game, bisagra_game)
  TOP_CONTEXT:     'points_burn',
  FORM_CONTEXT:    'pressure_game',
  MATCHDAY_WEIGHT: 'table_can_move',

  // BAJO_EL_RADAR (4 contexts: hidden_spice, not_much_marketing, sleeper_game, silent_danger)
  QUIET_COMPETITIVE_SIGNAL: 'hidden_spice',
  LOW_VISIBILITY_CONTEXT:   'not_much_marketing',
  NON_OBVIOUS_BALANCE:      'sleeper_game',

  // SENAL_DE_ALERTA (4 contexts: favorite_defense_soft, favorite_false_solidity, underdog_can_bite, favorite_home_doubts)
  FAVORITE_DEFENSIVE_FRAGILITY:    'favorite_defense_soft',
  UNDERDOG_COMPETITIVE_RESISTANCE: 'underdog_can_bite',
  FAVORITE_WEAK_LOCAL_EDGE:        'favorite_false_solidity',

  // PARTIDO_ENGANOSO (4 contexts: table_lies, surface_vs_form, comfortable_favorite_is_fake, deceptive_gap)
  TABLE_FORM_CONTRADICTION:    'surface_vs_form',
  FAVORITE_NOT_AS_COMFORTABLE: 'comfortable_favorite_is_fake',
  SURFACE_DISTANCE_OVERSOLD:   'table_lies',

  // PARTIDO_ABIERTO (4 contexts: both_score_and_concede, early_goal_chaos, open_profile, shaky_defenses)
  BOTH_SCORE_AND_CONCEDE: 'both_score_and_concede',
  GOAL_EXCHANGE_SIGNAL:   'early_goal_chaos',
  LOW_CONTROL_PROFILE:    'open_profile',           // was 'arcos_hot' in v1

  // DUELO_CERRADO (4 contexts: low_goal_smell, little_margin, ugly_grindy_game, one_goal_can_decide)
  LOW_GOAL_VOLUME:    'low_goal_smell',             // was 'little_goal' in v1
  TIGHT_BALANCE:      'ugly_grindy_game',           // was 'bad_mood_match' in v1
  LOW_MARGIN_PROFILE: 'one_goal_can_decide',        // was 'one_goal_can_kill_it' in v1
};

// ── Labels eligible for venenoso tone ─────────────────────────────────────────

const VENENOSO_ELIGIBLE = new Set<RadarLabelKey>([
  'SENAL_DE_ALERTA',
  'PARTIDO_ENGANOSO',
  'PARTIDO_ABIERTO',
  'DUELO_CERRADO',
]);

const VENENOSO_SIGNAL_THRESHOLD = 78;

// ── Default tone per label (hardcoded — v2 library removed default_tone_by_label) ─

const DEFAULT_TONE: Record<RadarLabelKey, ToneLevel> = {
  EN_LA_MIRA:       'sobrio',
  BAJO_EL_RADAR:    'picante',
  SENAL_DE_ALERTA:  'picante',
  PARTIDO_ENGANOSO: 'picante',
  PARTIDO_ABIERTO:  'picante',
  DUELO_CERRADO:    'picante',
};

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

// ── Tone resolution ────────────────────────────────────────────────────────────

function resolveTone(label: RadarLabelKey, dominantSignalScore: number): ToneLevel {
  if (VENENOSO_ELIGIBLE.has(label) && dominantSignalScore >= VENENOSO_SIGNAL_THRESHOLD) {
    return 'venenoso';
  }
  return DEFAULT_TONE[label];
}

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
  tone: ToneLevel,
  usedTemplateIds: Set<string>,
  seed: string = '',
): LibraryTemplate | null {
  const label = copyLib.labels[libKey];
  if (!label) return null;

  const ctx = label.contexts.find((c) => c.key === contextKey);
  if (!ctx) return null;

  // Tone fallback order
  const toneOrder: ToneLevel[] =
    tone === 'venenoso' ? ['venenoso', 'picante', 'sobrio'] :
    tone === 'picante'  ? ['picante', 'venenoso', 'sobrio'] :
                          ['sobrio', 'picante', 'venenoso'];

  const offset = hashSeed(seed);

  for (const t of toneOrder) {
    const matching = ctx.templates.filter((tmpl) => tmpl.tone === t && !usedTemplateIds.has(tmpl.id));
    if (matching.length > 0) {
      return matching[offset % matching.length];
    }
  }

  // All used — fallback to any tone-matching (no rotation block)
  return ctx.templates.find((t) => t.tone === tone) ?? ctx.templates[0] ?? null;
}

// ── Remate injection (v2) ──────────────────────────────────────────────────────
// v2: remates_opcionales = { general: string[], picantes: string[], venenosos: string[] }
// max_remate_usage_ratio = 0.45 → inject roughly 1 of every 2-3 cards
// Deterministic via editorialRank: inject when editorialRank % 3 === 0 (rank 3, 6, 9…)
// Injecting at rank 1 too when rank % 9 === 1 gives ~45% across larger sequences

function maybeAppendRemate(
  baseText: string,
  tone: ToneLevel,
  editorialRank: number,
  usedRemateTexts: Set<string>,
): string {
  // Deterministic ~45%: inject at rank 3, 6, 9… and at rank 1 (1 + every 9th)
  const shouldInject = editorialRank % 3 === 0 || editorialRank % 9 === 1;
  if (!shouldInject) return baseText;

  const rem = copyLib.remates_opcionales;

  // Pool by tone compatibility
  const pool: string[] =
    tone === 'venenoso' ? [...rem.venenosos, ...rem.picantes, ...rem.general] :
    tone === 'picante'  ? [...rem.picantes, ...rem.general] :
                          [...rem.general];

  const candidate = pool.find((text) => !usedRemateTexts.has(text));
  if (!candidate) return baseText;

  usedRemateTexts.add(candidate);
  return `${baseText} ${candidate}`;
}

// ── Banned phrases validation ──────────────────────────────────────────────────

function passesBannedPhrases(text: string): boolean {
  const lower = text.toLowerCase();
  return !copyLib.voice_policy.banned_phrases.some((phrase) => lower.includes(phrase.toLowerCase()));
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Renders the preMatchText for a given label + subtype using the expanded
 * rioplatense editorial copy library (v2, 264 templates).
 *
 * @param label               RadarLabelKey (e.g. SENAL_DE_ALERTA)
 * @param subtype             Resolved signal subtype
 * @param editorialRank       Card rank (1-based), deterministic remate injection
 * @param dominantSignalScore Signal score [0..100], tone upgrade to venenoso
 * @param usedTemplateIds     Set of already-used template IDs in this snapshot build
 * @param usedRemateTexts     Set of already-used remate texts in this snapshot build
 */
export function renderPreMatchText(
  label: RadarLabelKey,
  subtype: RadarSignalSubtype,
  editorialRank: number,
  dominantSignalScore: number,
  usedTemplateIds: Set<string>,
  usedRemateTexts: Set<string>,
  matchId: string = '',
): string | null {
  const libKey = LABEL_TO_LIB_KEY[label];
  const contextKey = SUBTYPE_TO_CONTEXT[subtype];
  const tone = resolveTone(label, dominantSignalScore);

  const template = selectTemplate(libKey, contextKey, tone, usedTemplateIds, matchId);
  if (!template) return null;

  if (!passesBannedPhrases(template.text)) return null;

  usedTemplateIds.add(template.id);

  return maybeAppendRemate(template.text, tone, editorialRank, usedRemateTexts);
}

// ── Reasons library ────────────────────────────────────────────────────────────
// Razones editoriales para el panel de detalle (voz rioplatense).
// Separadas de la librería de templates — no están en el JSON expandido.

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
