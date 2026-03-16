/**
 * Radar SportPulse — Radar Service
 * Orchestrates the full lifecycle: build → live refresh → post-match resolve.
 * Spec: radar-03-json-contracts-and-lifecycle.md §10
 */

import type { Match } from '@sportpulse/canonical';
import type { DataSource } from '@sportpulse/snapshot';
import type {
  RadarIndexSnapshot,
  RadarMatchSnapshot,
  RadarCardEntry,
  RadarEvaluatedMatch,
  RadarModuleState,
  RadarEvidenceTier,
} from './radar-types.js';
import { LABEL_TEXT } from './radar-types.js';
import { buildCandidatePool } from './radar-candidate-builder.js';
import { evaluateCandidates } from './radar-signal-evaluator.js';
import { applyDiversityFilter } from './radar-diversity-filter.js';
import {
  resolveSubtype,
  renderPreMatchText,
  selectReasons,
  isVenenosoContext,
  type SubtypeHints,
} from './radar-text-renderer.js';
import { resolveEvidenceTier } from './radar-evidence-tier.js';
import {
  writeMatchSnapshot,
  writeIndexSnapshot,
  updateMatchSnapshotVerdict,
  updateIndexSnapshot,
  radarScopeDir,
} from './radar-snapshot-writer.js';
import {
  readRadarSnapshot,
  snapshotExists,
  type RadarReadResult,
} from './radar-snapshot-reader.js';
import { resolveVerdict, supportsVerdict } from './radar-verdict-resolver.js';

const POLICY_VERSION = 1;
const SCHEMA_VERSION = 1 as const;
const MAX_CARDS = 3;

export interface BuildRadarInput {
  competitionKey: string;
  seasonKey: string;
  matchday: number;
  competitionId: string;
  dataSource: DataSource;
  buildNowUtc: string;
  force?: boolean;
}

export interface RadarServiceResult {
  index: RadarIndexSnapshot;
  matchSnapshots: Map<string, RadarMatchSnapshot>;
}

/**
 * Builds or retrieves the Radar snapshot for a given league+season+matchday.
 *
 * - If a snapshot already exists and force=false, returns the existing one.
 * - Otherwise runs the full build pipeline.
 */
export async function buildOrGetRadarSnapshot(
  input: BuildRadarInput,
): Promise<RadarServiceResult | null> {
  const { competitionKey, seasonKey, matchday, competitionId, dataSource, buildNowUtc, force } = input;

  // Return existing snapshot unless force rebuild
  if (!force) {
    const existing = await readRadarSnapshot(competitionKey, seasonKey, matchday);
    if (existing.index && !existing.corrupt) {
      return { index: existing.index, matchSnapshots: existing.matchSnapshots };
    }
    if (existing.corrupt) {
      console.error(`[RadarService] Corrupt snapshot for ${competitionKey}:${matchday}, rebuilding`);
    }
  }

  return buildRadarSnapshot(input);
}

/**
 * Full build pipeline for a Radar snapshot.
 */
async function buildRadarSnapshot(input: BuildRadarInput): Promise<RadarServiceResult | null> {
  const { competitionKey, seasonKey, matchday, competitionId, dataSource, buildNowUtc, force } = input;

  const seasonId = dataSource.getSeasonId?.(competitionId);
  if (!seasonId) {
    console.warn(`[RadarService] No seasonId for ${competitionId}`);
    return null;
  }

  const matches = dataSource.getMatches(seasonId);
  const standings = dataSource.getStandings?.(competitionId) ?? [];
  const totalTeams = standings.length || 20;

  // Build candidate pool
  const candidates = buildCandidatePool({
    competitionKey,
    seasonKey,
    matchday,
    matches,
    standings,
  });

  if (candidates.length === 0) {
    // Write EMPTY index
    const emptyIndex = buildEmptyIndex(competitionKey, seasonKey, matchday, buildNowUtc);
    const dir = radarScopeDir(competitionKey, seasonKey, matchday);
    await writeIndexSnapshot(emptyIndex, dir);
    return { index: emptyIndex, matchSnapshots: new Map() };
  }

  // Evaluate signals
  const evaluated = evaluateCandidates({
    candidates,
    matches,
    standings,
    buildNowUtc,
    totalTeams,
  });

  // Apply diversity
  const selected = applyDiversityFilter(evaluated, MAX_CARDS);

  if (selected.length === 0) {
    const emptyIndex = buildEmptyIndex(competitionKey, seasonKey, matchday, buildNowUtc);
    const dir = radarScopeDir(competitionKey, seasonKey, matchday);
    await writeIndexSnapshot(emptyIndex, dir);
    return { index: emptyIndex, matchSnapshots: new Map() };
  }

  const evidenceTier = resolveEvidenceTier(matchday);
  const dir = radarScopeDir(competitionKey, seasonKey, matchday);
  const generatedAt = buildNowUtc;
  const radarKey = `radar:${competitionKey}:${seasonKey}:${matchday}`;

  const isHistoricalRebuild = force === true;

  // Build and write match snapshots (first, before index)
  const matchSnapshotMap = new Map<string, RadarMatchSnapshot>();
  const cardEntries: RadarCardEntry[] = [];
  const usedTexts = new Set<string>();
  const usedTemplateIds = new Set<string>();
  const usedRemateIds = new Set<string>();
  // Tone-dedup tracking: opening patterns and venenoso count per snapshot
  const usedOpenings = new Set<string>();
  let venenosoCount = 0;

  for (let i = 0; i < selected.length; i++) {
    const ev = selected[i];
    const rank = i + 1;

    const hints = buildSubtypeHints(ev);
    const subtype = resolveSubtype(ev.labelKey, hints);
    const preMatchText = renderPreMatchText(
      ev.labelKey,
      subtype,
      rank,
      ev.dominantSignalScore,
      usedTemplateIds,
      usedRemateIds,
      ev.candidate.matchId,
      usedOpenings,
      venenosoCount,
    );
    // Update venenosoCount if a venenoso-tone template was rendered
    if (preMatchText && isVenenosoContext(ev.labelKey, subtype)) {
      venenosoCount++;
    }
    const reasons = selectReasons(ev.labelKey, evidenceTier, usedTexts);

    if (!preMatchText || reasons.length < 2) {
      console.warn(`[RadarService] Could not build card for match ${ev.candidate.matchId}, skipping`);
      continue;
    }

    const detailFile = `match_${ev.candidate.matchId}.json`;

    const matchSnap: RadarMatchSnapshot = {
      schemaVersion: SCHEMA_VERSION,
      module: 'radar_sportpulse',
      competitionKey,
      seasonKey,
      matchday,
      radarKey,
      matchId: ev.candidate.matchId,
      editorialRank: rank,
      editorialState: 'PRE_MATCH',
      evidenceTier,
      dataQuality: 'OK',
      policyVersion: POLICY_VERSION,
      isHistoricalSnapshot: false,
      isHistoricalRebuild,
      buildReason: isHistoricalRebuild ? 'MANUAL_FORCE_REBUILD' : 'AUTO_PRE_MATCH_GENERATION',
      generatedAt,
      updatedAt: generatedAt,
      resolvedAt: null,
      lastLiveStatusSeen: null,
      labelKey: ev.labelKey,
      labelText: LABEL_TEXT[ev.labelKey],
      signalKey: ev.dominantSignal,
      signalSubtype: subtype,
      radarScore: ev.radarScore,
      preMatchText,
      reasons,
      favoriteSide: ev.candidate.favoriteSide,
      underdogSide: ev.candidate.underdogSide,
      signalScores: ev.signalScores,
      evidenceSources: {
        seasonCurrentUsed: true,
        seasonPreviousUsed: false,
        bootstrapMode: evidenceTier === 'BOOTSTRAP',
      },
      verdict: null,
      verdictTitle: null,
      verdictText: null,
      postMatchNote: null,
      resolutionState: 'UNRESOLVED',
      selectionContext: {
        cardsPoolSize: evaluated.length,
        selectedBy: 'radarScore',
        contextBoostApplied: ev.radarScore - ev.dominantSignalScore,
      },
    };

    await writeMatchSnapshot(matchSnap, dir);
    matchSnapshotMap.set(ev.candidate.matchId, matchSnap);

    cardEntries.push({
      matchId: ev.candidate.matchId,
      editorialRank: rank,
      editorialState: 'PRE_MATCH',
      labelKey: ev.labelKey,
      labelText: LABEL_TEXT[ev.labelKey],
      preMatchText,
      hasVerdict: false,
      verdict: null,
      verdictTitle: null,
      verdictText: null,
      detailFile,
    });
  }

  if (cardEntries.length === 0) {
    const emptyIndex = buildEmptyIndex(competitionKey, seasonKey, matchday, buildNowUtc);
    await writeIndexSnapshot(emptyIndex, dir);
    return { index: emptyIndex, matchSnapshots: new Map() };
  }

  // Write index last
  const index: RadarIndexSnapshot = {
    schemaVersion: SCHEMA_VERSION,
    module: 'radar_sportpulse',
    competitionKey,
    seasonKey,
    matchday,
    radarKey,
    sectionTitle: 'Radar SportPulse',
    sectionSubtitle: 'Lo que está en la mira hoy',
    moduleState: 'READY_PRE_MATCH',
    evidenceTier,
    dataQuality: 'OK',
    policyVersion: POLICY_VERSION,
    isHistoricalSnapshot: false,
    isHistoricalRebuild,
    generatedAt,
    updatedAt: generatedAt,
    cardsCount: cardEntries.length,
    cards: cardEntries,
    buildReason: isHistoricalRebuild ? 'MANUAL_FORCE_REBUILD' : 'AUTO_PRE_MATCH_GENERATION',
  };

  await writeIndexSnapshot(index, dir);

  return { index, matchSnapshots: matchSnapshotMap };
}

/**
 * Resolves post-match verdicts for all cards in a snapshot.
 * Called when matches move to FINISHED state.
 */
export async function resolveRadarVerdicts(
  competitionKey: string,
  seasonKey: string,
  matchday: number,
  matchResults: Map<string, { scoreHome: number; scoreAway: number; status: string }>,
  resolvedAt: string,
): Promise<void> {
  const { index, matchSnapshots } = await readRadarSnapshot(competitionKey, seasonKey, matchday);
  if (!index) return;

  const dir = radarScopeDir(competitionKey, seasonKey, matchday);
  let anyResolved = false;
  const updatedCards = [...index.cards];

  for (const [matchId, result] of matchResults) {
    const snap = matchSnapshots.get(matchId);
    if (!snap) continue;
    if (snap.resolutionState === 'RESOLVED') continue;
    if (result.status !== 'FINISHED') continue;

    const verdictResult = supportsVerdict(snap.labelKey)
      ? resolveVerdict(snap.labelKey, result.scoreHome, result.scoreAway, snap.favoriteSide)
      : null;

    await updateMatchSnapshotVerdict(dir, matchId, {
      editorialState: 'POST_MATCH',
      resolvedAt,
      updatedAt: resolvedAt,
      lastLiveStatusSeen: 'FINISHED',
      resolutionState: 'RESOLVED',
      verdict: verdictResult?.verdict ?? null,
      verdictTitle: verdictResult?.verdictTitle ?? null,
      verdictText: verdictResult?.verdictText ?? null,
    });

    // Update card entry in index
    const cardIdx = updatedCards.findIndex((c) => c.matchId === matchId);
    if (cardIdx >= 0) {
      updatedCards[cardIdx] = {
        ...updatedCards[cardIdx],
        editorialState: 'POST_MATCH',
        hasVerdict: verdictResult !== null,
        verdict: verdictResult?.verdict ?? null,
        verdictTitle: verdictResult?.verdictTitle ?? null,
        verdictText: verdictResult?.verdictText ?? null,
      };
    }

    anyResolved = true;
  }

  if (!anyResolved) return;

  // Recompute module state
  const allResolved = updatedCards.every((c) => c.editorialState === 'POST_MATCH');
  const anyPost = updatedCards.some((c) => c.editorialState === 'POST_MATCH');
  const moduleState: RadarModuleState = allResolved
    ? 'READY_POST_MATCH'
    : anyPost
    ? 'READY_MIXED'
    : 'READY_PRE_MATCH';

  await updateIndexSnapshot(dir, {
    cards: updatedCards,
    moduleState,
    updatedAt: resolvedAt,
    lastResolvedAt: resolvedAt,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildEmptyIndex(
  competitionKey: string,
  seasonKey: string,
  matchday: number,
  generatedAt: string,
): RadarIndexSnapshot {
  const evidenceTier = resolveEvidenceTier(matchday);
  return {
    schemaVersion: SCHEMA_VERSION,
    module: 'radar_sportpulse',
    competitionKey,
    seasonKey,
    matchday,
    radarKey: `radar:${competitionKey}:${seasonKey}:${matchday}`,
    sectionTitle: 'Radar SportPulse',
    sectionSubtitle: 'Lo que está en la mira hoy',
    moduleState: 'EMPTY',
    evidenceTier,
    dataQuality: 'OK',
    policyVersion: POLICY_VERSION,
    isHistoricalSnapshot: false,
    isHistoricalRebuild: false,
    generatedAt,
    updatedAt: generatedAt,
    cardsCount: 0,
    cards: [],
    buildReason: 'AUTO_PRE_MATCH_GENERATION',
  };
}

function buildSubtypeHints(ev: RadarEvaluatedMatch): SubtypeHints {
  const { signalScores, homeContext: home, awayContext: away, candidate } = ev;

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
