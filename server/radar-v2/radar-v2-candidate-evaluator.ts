/**
 * Radar SportPulse v2 — Candidate Evaluator
 * Wraps v1 signal computation and adds family-level scoring.
 *
 * Spec: spec.sportpulse.radar-v2-core.md §8, §12
 *
 * Signal → Family mapping:
 *   CONTEXT:      attentionScore, hiddenValueScore
 *   DYNAMICS:     openGameScore, tightGameScore
 *   MISALIGNMENT: favoriteVulnerabilityScore, surfaceContradictionScore
 */

import type { Match } from '@sportpulse/canonical';
import type { StandingEntry } from '@sportpulse/snapshot';
import type { RadarCandidate, RadarSignalScores, RadarEvaluatedMatch } from '../radar/radar-types.js';
import { buildCandidatePool, buildTeamContextMap } from '../radar/radar-candidate-builder.js';
import { evaluateCandidates } from '../radar/radar-signal-evaluator.js';
import type {
  RadarV2Family,
  RadarV2Label,
  RadarV2EvidenceTier,
  RadarV2ConfidenceBand,
  FamilyScore,
} from './radar-v2-types.js';
import { VALID_FAMILY_LABELS, LABEL_TO_FAMILY } from './radar-v2-types.js';

// ── Signal → label mapping (same as v1) ──────────────────────────────────────

const SIGNAL_LABELS: Record<string, RadarV2Label> = {
  ATTENTION_CONTEXT: 'EN_LA_MIRA',
  HIDDEN_VALUE: 'BAJO_EL_RADAR',
  OPEN_GAME: 'PARTIDO_ABIERTO',
  TIGHT_GAME: 'DUELO_CERRADO',
  FAVORITE_VULNERABILITY: 'SENAL_DE_ALERTA',
  SURFACE_CONTRADICTION: 'PARTIDO_ENGANOSO',
};

// ── Signal thresholds (reuse from v1) ────────────────────────────────────────

const SIGNAL_THRESHOLDS: Record<string, number> = {
  SURFACE_CONTRADICTION: 68,
  FAVORITE_VULNERABILITY: 64,
  OPEN_GAME: 63,
  TIGHT_GAME: 63,
  HIDDEN_VALUE: 60,
  ATTENTION_CONTEXT: 58,
};

// ── V2 evaluated match ──────────────────────────────────────────────────────

export interface V2EvaluatedMatch {
  matchId: string;
  v1Eval: RadarEvaluatedMatch;
  familyScores: FamilyScore[];
  dominantFamily: RadarV2Family;
  primaryLabel: RadarV2Label;
  radarScore: number;
  confidenceBand: RadarV2ConfidenceBand;
  evidenceTier: RadarV2EvidenceTier;
}

export interface V2EvaluatorInput {
  competitionKey: string;
  seasonKey: string;
  matchday: number;
  matches: readonly Match[];
  standings: readonly StandingEntry[];
  buildNowUtc: string;
}

/**
 * Evaluates all candidate matches using v1 signal computation,
 * then layers family-level scoring on top.
 */
export function evaluateV2Candidates(input: V2EvaluatorInput): V2EvaluatedMatch[] {
  const { competitionKey, seasonKey, matchday, matches, standings, buildNowUtc } = input;

  // Build v1 candidate pool
  const candidates = buildCandidatePool({
    competitionKey,
    seasonKey,
    matchday,
    matches,
    standings,
  });

  if (candidates.length === 0) return [];

  const totalTeams = standings.length || 20;

  // Run v1 signal evaluation
  const v1Evaluated = evaluateCandidates({
    candidates,
    matches,
    standings,
    buildNowUtc,
    totalTeams,
  });

  // Layer v2 family scoring on top
  return v1Evaluated
    .map((ev) => buildV2Evaluation(ev))
    .filter((v): v is V2EvaluatedMatch => v !== null)
    .sort((a, b) => b.radarScore - a.radarScore);
}

function buildV2Evaluation(ev: RadarEvaluatedMatch): V2EvaluatedMatch | null {
  const scores = ev.signalScores;

  // Compute per-label scores
  const labelScores: { label: RadarV2Label; score: number; signalKey: string }[] = [
    { label: 'EN_LA_MIRA', score: scores.attentionScore, signalKey: 'ATTENTION_CONTEXT' },
    { label: 'BAJO_EL_RADAR', score: scores.hiddenValueScore, signalKey: 'HIDDEN_VALUE' },
    { label: 'PARTIDO_ABIERTO', score: scores.openGameScore, signalKey: 'OPEN_GAME' },
    { label: 'DUELO_CERRADO', score: scores.tightGameScore, signalKey: 'TIGHT_GAME' },
    { label: 'SENAL_DE_ALERTA', score: scores.favoriteVulnerabilityScore, signalKey: 'FAVORITE_VULNERABILITY' },
    { label: 'PARTIDO_ENGANOSO', score: scores.surfaceContradictionScore, signalKey: 'SURFACE_CONTRADICTION' },
  ];

  // Compute family scores
  const families: RadarV2Family[] = ['CONTEXT', 'DYNAMICS', 'MISALIGNMENT'];
  const familyScores: FamilyScore[] = families.map((family) => {
    const allowedLabels = VALID_FAMILY_LABELS[family];
    const familyLabels = labelScores
      .filter((ls) => allowedLabels.includes(ls.label))
      .map((ls) => ({
        label: ls.label,
        score: ls.score,
      }));

    const bestLabel = familyLabels.reduce(
      (best, cur) => (cur.score > best.score ? cur : best),
      familyLabels[0],
    );

    const familyScore = bestLabel.score;
    const threshold = SIGNAL_THRESHOLDS[
      labelScores.find((ls) => ls.label === bestLabel.label)?.signalKey ?? ''
    ] ?? 60;

    return {
      family,
      score: familyScore,
      active: familyScore >= threshold,
      bestLabel: bestLabel.label,
      bestLabelScore: bestLabel.score,
      labels: familyLabels,
    };
  });

  // At least one family must be active
  const activeFamilies = familyScores.filter((fs) => fs.active);
  if (activeFamilies.length === 0) return null;

  // Resolve dominant family: highest score, break ties by precedence
  const FAMILY_PRECEDENCE_ORDER: Record<RadarV2Family, number> = {
    MISALIGNMENT: 0,
    DYNAMICS: 1,
    CONTEXT: 2,
  };

  const dominant = activeFamilies.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return FAMILY_PRECEDENCE_ORDER[a.family] - FAMILY_PRECEDENCE_ORDER[b.family];
  })[0];

  // Bootstrap guard: demote aggressive labels with thin evidence
  let primaryLabel = dominant.bestLabel;
  const evidenceTier = ev.candidate.evidenceTier as RadarV2EvidenceTier;

  if (evidenceTier === 'BOOTSTRAP') {
    if (primaryLabel === 'SENAL_DE_ALERTA' && dominant.bestLabelScore < 80) {
      primaryLabel = 'EN_LA_MIRA';
    }
    if (primaryLabel === 'PARTIDO_ENGANOSO' && dominant.bestLabelScore < 85) {
      primaryLabel = 'BAJO_EL_RADAR';
    }
  }

  // Recalculate dominant family after potential label demotion
  const actualFamily = LABEL_TO_FAMILY[primaryLabel];

  // radarScore = dominant score + small context boost
  const contextBoost = computeContextBoost(ev);
  const radarScore = Math.min(100, dominant.bestLabelScore + contextBoost);

  // Confidence band
  const confidenceBand = resolveConfidenceBand(radarScore, evidenceTier);

  return {
    matchId: ev.candidate.matchId,
    v1Eval: ev,
    familyScores,
    dominantFamily: actualFamily,
    primaryLabel,
    radarScore,
    confidenceBand,
    evidenceTier,
  };
}

function computeContextBoost(ev: RadarEvaluatedMatch): number {
  let boost = 0;
  if (ev.homeContext.position <= 4 || ev.awayContext.position <= 4) boost += 3;
  if (Math.abs(ev.homeContext.points - ev.awayContext.points) <= 3) boost += 2;
  return boost;
}

function resolveConfidenceBand(
  radarScore: number,
  evidenceTier: RadarV2EvidenceTier,
): RadarV2ConfidenceBand {
  if (radarScore >= 75 && evidenceTier === 'STABLE') return 'HIGH';
  if (radarScore >= 60 || evidenceTier === 'EARLY') return 'MEDIUM';
  return 'LOW';
}
