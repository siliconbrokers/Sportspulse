/**
 * Radar SportPulse v2 — Card Resolver
 * Spec: spec.sportpulse.radar-v2-core.md §12 (Step 4)
 *       spec.sportpulse.radar-v2-json-contracts-and-lifecycle.md §5, §6
 *
 * Resolves the final card structure from evaluated+family-resolved candidates.
 * Applies diversity filter, builds structured reasons, attaches subtype.
 */

import type {
  RadarV2Card,
  RadarV2Reason,
  RadarV2Label,
} from './radar-v2-types.js';
import { V2_LABEL_TEXT, RADAR_V2_MAX_CARDS, LABEL_TO_FAMILY } from './radar-v2-types.js';
import type { V2EvaluatedMatch } from './radar-v2-candidate-evaluator.js';
import { resolveFamilies } from './radar-v2-family-resolver.js';
import { applyDiversityFilter } from '../radar/radar-diversity-filter.js';
import {
  resolveSubtype,
  renderPreMatchText,
  isVenenosoContext,
  type SubtypeHints,
} from '../radar/radar-text-renderer.js';
import type { RadarLabelKey, RadarSignalSubtype } from '../radar/radar-types.js';

// ── Structured reasons per label ─────────────────────────────────────────────

const REASON_LIBRARY: Record<RadarV2Label, RadarV2Reason[]> = {
  EN_LA_MIRA: [
    { code: 'MATCHDAY_WEIGHT', weight: 0.8, text: 'Tiene peso dentro de la fecha y no conviene mirarlo de costado.' },
    { code: 'COMPETITIVE_CONTEXT', weight: 0.7, text: 'El contexto lo mete entre los partidos que más pueden mover.' },
    { code: 'FORM_RELEVANCE', weight: 0.6, text: 'Llega con suficiente forma como para no pasarlo por alto.' },
  ],
  BAJO_EL_RADAR: [
    { code: 'LOW_VISIBILITY', weight: 0.7, text: 'No es de los cruces más visibles, pero llega con señales que vale revisar.' },
    { code: 'HIDDEN_MOMENTUM', weight: 0.6, text: 'El momento reciente lo vuelve más interesante de lo que sugiere el fixture.' },
    { code: 'QUIET_READING', weight: 0.5, text: 'Hay una lectura menos obvia en un partido que pasa bastante desapercibido.' },
  ],
  SENAL_DE_ALERTA: [
    { code: 'FAVORITE_FRAGILITY', weight: 0.8, text: 'El favorito viene concediendo con más frecuencia de la que su posición sugiere.' },
    { code: 'UNDERDOG_RESISTANCE', weight: 0.7, text: 'El rival compite mejor de lo que la diferencia de tabla indica.' },
    { code: 'STABILITY_GAP', weight: 0.6, text: 'La ventaja existe, pero la solidez reciente no termina de sostenerla.' },
  ],
  PARTIDO_ENGANOSO: [
    { code: 'TABLE_FORM_GAP', weight: 0.8, text: 'La tabla marca una diferencia que la forma reciente no acompaña del todo.' },
    { code: 'SURFACE_MISMATCH', weight: 0.7, text: 'El contexto aparente sugiere un cruce más simple del que muestran las señales.' },
    { code: 'NONLINEAR_APPROACH', weight: 0.6, text: 'La distancia visible existe, pero el partido llega menos lineal de lo esperado.' },
  ],
  PARTIDO_ABIERTO: [
    { code: 'SCORING_FREQUENCY', weight: 0.7, text: 'Ambos llegan marcando con frecuencia en la previa reciente.' },
    { code: 'DEFENSIVE_GAPS', weight: 0.7, text: 'Los dos vienen dejando huecos como para abrir margen al intercambio.' },
    { code: 'EXCHANGE_SIGNALS', weight: 0.6, text: 'El momento reciente deja más señales de ida y vuelta que de control.' },
  ],
  DUELO_CERRADO: [
    { code: 'LOW_AMPLITUDE', weight: 0.7, text: 'La previa reciente deja poca amplitud y bastante margen corto.' },
    { code: 'LOW_GOAL_SIGNAL', weight: 0.6, text: 'No aparecen demasiadas señales de gol alto en ninguno de los dos lados.' },
    { code: 'TIGHT_EQUILIBRIUM', weight: 0.6, text: 'El cruce llega con bastante equilibrio y poco espacio para una diferencia amplia.' },
  ],
};

/**
 * Selects reasons for a card. Returns 2-3 structured reasons.
 */
function selectV2Reasons(
  label: RadarV2Label,
  isStable: boolean,
  usedCodes: Set<string>,
): RadarV2Reason[] {
  const pool = REASON_LIBRARY[label] ?? [];
  const minCount = isStable ? 3 : 2;

  const selected: RadarV2Reason[] = [];

  // First pass: pick unused
  for (const reason of pool) {
    if (selected.length >= 3) break;
    if (!usedCodes.has(reason.code)) {
      selected.push(reason);
      usedCodes.add(reason.code);
    }
  }

  // Fill to minimum if needed
  if (selected.length < minCount) {
    for (const reason of pool) {
      if (selected.length >= minCount) break;
      if (!selected.find((r) => r.code === reason.code)) {
        selected.push(reason);
        usedCodes.add(reason.code);
      }
    }
  }

  return selected.slice(0, 3);
}

// ── Card building ────────────────────────────────────────────────────────────

export interface CardResolverInput {
  evaluated: V2EvaluatedMatch[];
}

/**
 * Resolves final v2 cards from evaluated candidates.
 * Applies diversity filter, renders text, builds structured output.
 */
export function resolveV2Cards(input: CardResolverInput): RadarV2Card[] {
  const { evaluated } = input;

  if (evaluated.length === 0) return [];

  // Adapt for diversity filter: map V2EvaluatedMatch to v1 shape for the filter
  const v1Adapted = evaluated.map((ev) => ({
    ...ev.v1Eval,
    // Override labelKey with v2 primary label for diversity filter
    labelKey: ev.primaryLabel as unknown as RadarLabelKey,
  }));

  const diverseV1 = applyDiversityFilter(v1Adapted, RADAR_V2_MAX_CARDS);

  // Map back to V2EvaluatedMatch
  const selectedMatchIds = new Set(diverseV1.map((d) => d.candidate.matchId));
  const selected = evaluated.filter((ev) => selectedMatchIds.has(ev.matchId));

  // Sort by radarScore desc to maintain ranking
  selected.sort((a, b) => b.radarScore - a.radarScore);

  const cards: RadarV2Card[] = [];
  const usedTemplateIds = new Set<string>();
  const usedRemateIds = new Set<string>();
  const usedOpenings = new Set<string>();
  const usedReasonCodes = new Set<string>();
  let venenosoCount = 0;

  for (let i = 0; i < selected.length; i++) {
    const ev = selected[i];
    const rank = i + 1;

    // Resolve families and secondary badges
    const familyRes = resolveFamilies(ev);

    // Resolve subtype using v1 logic
    const hints = buildSubtypeHints(ev);
    const subtype = resolveSubtype(ev.primaryLabel as RadarLabelKey, hints);

    // Render preMatchText using v1 renderer
    const preMatchText = renderPreMatchText(
      ev.primaryLabel as RadarLabelKey,
      subtype,
      rank,
      ev.radarScore,
      usedTemplateIds,
      usedRemateIds,
      ev.matchId,
      usedOpenings,
      venenosoCount,
    );

    if (isVenenosoContext(ev.primaryLabel as RadarLabelKey, subtype)) {
      venenosoCount++;
    }

    // Select structured reasons
    const reasons = selectV2Reasons(
      ev.primaryLabel,
      ev.evidenceTier === 'STABLE',
      usedReasonCodes,
    );

    if (!preMatchText || reasons.length < 2) {
      console.warn(`[RadarV2] Could not build card for match ${ev.matchId}, skipping`);
      continue;
    }

    // Sanitize text
    const sanitized = sanitizeText(preMatchText);

    cards.push({
      matchId: ev.matchId,
      family: familyRes.dominantFamily,
      primaryLabel: familyRes.primaryLabel,
      secondaryBadges: familyRes.secondaryBadges,
      subtype: subtype as string,
      confidenceBand: ev.confidenceBand,
      radarScore: ev.radarScore,
      evidenceTier: ev.evidenceTier,
      reasons,
      preMatchText: sanitized,
      verdict: null,
    });
  }

  return cards;
}

// ── Sanitization (spec: editorial-rendering-policy §13) ─────────────────────

function sanitizeText(text: string): string {
  return text
    .replace(/\s{2,}/g, ' ')          // duplicate spaces
    .replace(/,,+/g, ',')             // repeated commas
    .replace(/\.\.+/g, '.')           // repeated periods
    .replace(/\s+([.,;:!?])/g, '$1') // space before punctuation
    .trim();
}

// ── Subtype hints (reuse from v1 service) ───────────────────────────────────

function buildSubtypeHints(ev: V2EvaluatedMatch): SubtypeHints {
  const { v1Eval } = ev;
  const { homeContext: home, awayContext: away, candidate } = v1Eval;

  const favoriteCtx = candidate.favoriteSide === 'HOME' ? home : away;
  const underdogCtx = candidate.favoriteSide === 'HOME' ? away : home;

  return {
    hasFavoriteFragility: favoriteCtx.concededLast5 >= 4,
    hasUnderdogResistance:
      underdogCtx.recentForm.filter((r) => r === 'W').length >= 2,
    hasFavoriteWeakEdge: favoriteCtx.formScore < 0.5,
    hasTableFormContra:
      underdogCtx.formScore >= favoriteCtx.formScore,
    hasHighGoalVolume:
      home.scoredLast5 >= 4 && away.scoredLast5 >= 4,
    hasLowGoalVolume:
      home.cleanSheetsLast5 >= 2 && away.cleanSheetsLast5 >= 2,
    hasHighBalance:
      Math.abs(home.points - away.points) <= 4,
    hasTopContext: home.position <= 4 || away.position <= 4,
    hasFormContext:
      home.formScore > 0.6 || away.formScore > 0.6,
  };
}
