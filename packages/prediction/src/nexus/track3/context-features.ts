/**
 * context-features.ts — NEXUS Track 3: contextual feature extraction.
 *
 * Spec authority:
 *   - taxonomy spec S5.3.1: eligible features (rest, form, H2H, table context)
 *   - taxonomy spec S5.3.2: conditionally eligible features (H2H)
 *   - taxonomy spec S5.3.3: excluded features (no market data, no lookahead)
 *   - taxonomy spec S5.6: degradation — MISSING not 0 for absent features
 *   - NEXUS-0 S3.1, S3.2: strict as-of semantics, anti-lookahead
 *   - NEXUS-0 S6.1: MISSING sentinel — never null/0/undefined for absent values
 *   - NEXUS-0 S6.3: missingness policy — global mean imputation prohibited
 *
 * ANTI-LOOKAHEAD INVARIANT (NEXUS-0 S3.2):
 *   All functions that receive `history: HistoricalMatch[]` must filter
 *   to only matches where `utcDate < buildNowUtc` (strict less-than).
 *   The match being predicted (utcDate === kickoffUtc) and any future
 *   matches are excluded from every computation.
 *
 * @module nexus/track3/context-features
 */

import { MISSING } from '../feature-store/types.js';
import type { FeatureValue, MissingValue } from '../feature-store/types.js';
import type { HistoricalMatch } from '../track1/types.js';
import type { CompetitiveImportance, SeasonPhase, Track3FeatureVector } from './types.js';

// ── Provenance builder ─────────────────────────────────────────────────────

/**
 * Build a minimal derived provenance record for Track 3 contextual features.
 * All Track 3 features are 'derived' from canonical match history (NEXUS-0 S5.3).
 *
 * freshness is computed as seconds between buildNowUtc and the most recent
 * match used (effectiveAt).
 */
function makeDerivedProvenance(
  buildNowUtc: string,
  effectiveAt: string,
): FeatureValue<never>['provenance'] {
  const buildMs = new Date(buildNowUtc).getTime();
  const effectiveMs = new Date(effectiveAt).getTime();
  const freshness = Math.max(0, Math.floor((buildMs - effectiveMs) / 1000));
  return {
    source: 'derived',
    ingestedAt: buildNowUtc,
    effectiveAt,
    confidence: 'HIGH',
    freshness,
  };
}

/**
 * Build a MISSING feature value — used when no data is available.
 * Still carries provenance: a lookup was attempted and found no data (NEXUS-0 S6.1).
 */
function makeMissing(buildNowUtc: string): FeatureValue<never> {
  return {
    value: MISSING as MissingValue,
    provenance: {
      source: 'derived',
      ingestedAt: buildNowUtc,
      effectiveAt: buildNowUtc,
      confidence: 'UNKNOWN',
      freshness: 0,
    },
  };
}

// ── Anti-lookahead filter (NEXUS-0 S3.2) ──────────────────────────────────

/**
 * Filter matches to only those STRICTLY BEFORE buildNowUtc.
 *
 * NEXUS-0 S3.2 anti-lookahead invariant:
 *   effectiveAt < buildNowUtc (strict less-than).
 *   The match being predicted and any future matches are excluded.
 */
function filterByAsOf(history: HistoricalMatch[], buildNowUtc: string): HistoricalMatch[] {
  const buildMs = new Date(buildNowUtc).getTime();
  return history.filter((m) => new Date(m.utcDate).getTime() < buildMs);
}

// ── Rest days (taxonomy spec S5.3.1: restDaysHome, restDaysAway) ───────────

/**
 * Compute rest days for a team as of buildNowUtc.
 *
 * taxonomy spec S5.3.1: `restDaysHome` / `restDaysAway` — days since
 * the team's last match.
 *
 * ANTI-LOOKAHEAD (NEXUS-0 S3.2): Only considers matches with utcDate < buildNowUtc.
 * MISSING when no prior match is found in history.
 *
 * @param teamId     - Canonical team ID.
 * @param buildNowUtc - Temporal anchor (ISO-8601 UTC with Z).
 * @param history    - Full canonical history (WILL be filtered by as-of).
 * @returns FeatureValue<number> — rest days, or MISSING.
 */
export function computeRestDays(
  teamId: string,
  buildNowUtc: string,
  history: HistoricalMatch[],
): FeatureValue<number> {
  // Anti-lookahead: strict less-than (NEXUS-0 S3.2)
  const eligible = filterByAsOf(history, buildNowUtc);

  // Find matches involving this team
  const teamMatches = eligible.filter(
    (m) => m.homeTeamId === teamId || m.awayTeamId === teamId,
  );

  if (teamMatches.length === 0) {
    return makeMissing(buildNowUtc) as FeatureValue<number>;
  }

  // Find the most recent match (latest utcDate)
  const lastMatch = teamMatches.reduce((latest, m) =>
    new Date(m.utcDate) > new Date(latest.utcDate) ? m : latest,
  );

  const buildMs = new Date(buildNowUtc).getTime();
  const lastMatchMs = new Date(lastMatch.utcDate).getTime();
  const restDays = (buildMs - lastMatchMs) / (1000 * 60 * 60 * 24);

  return {
    value: restDays,
    provenance: makeDerivedProvenance(buildNowUtc, lastMatch.utcDate),
  };
}

// ── Matches in last 4 weeks (taxonomy spec S5.3.1: matchesLast4WeeksHome) ──

/**
 * Count how many matches a team played in the last 28 days before buildNowUtc.
 *
 * taxonomy spec S5.3.1: `matchesLast4WeeksHome` / `matchesLast4WeeksAway`.
 *
 * ANTI-LOOKAHEAD (NEXUS-0 S3.2): Only considers matches with utcDate < buildNowUtc.
 * MISSING when no history available for the team.
 */
export function computeMatchesLast4Weeks(
  teamId: string,
  buildNowUtc: string,
  history: HistoricalMatch[],
): FeatureValue<number> {
  const eligible = filterByAsOf(history, buildNowUtc);

  const teamMatches = eligible.filter(
    (m) => m.homeTeamId === teamId || m.awayTeamId === teamId,
  );

  if (teamMatches.length === 0) {
    return makeMissing(buildNowUtc) as FeatureValue<number>;
  }

  const buildMs = new Date(buildNowUtc).getTime();
  const windowMs = 28 * 24 * 60 * 60 * 1000; // 28 days in ms
  const windowStart = buildMs - windowMs;

  const count = teamMatches.filter(
    (m) => new Date(m.utcDate).getTime() >= windowStart,
  ).length;

  // effectiveAt = most recent match used (or buildNowUtc if none in window)
  const effectiveAt = teamMatches[teamMatches.length - 1]?.utcDate ?? buildNowUtc;

  return {
    value: count,
    provenance: makeDerivedProvenance(buildNowUtc, effectiveAt),
  };
}

// ── General form (taxonomy spec S5.3.1: formHome_last5, formAway_last5) ────

/**
 * Compute points-per-game from a team's last N matches (any venue).
 *
 * taxonomy spec S5.3.1: `formHome_last5`, `formAway_last5` — points per match
 * in team's last 5 league matches.
 *
 * Scoring: 3 pts for win, 1 for draw, 0 for loss.
 *
 * ANTI-LOOKAHEAD (NEXUS-0 S3.2): Only considers matches with utcDate < buildNowUtc.
 *
 * taxonomy spec S5.6 degradation:
 *   - Fewer than N matches: uses whatever matches exist (team's own prior).
 *   - Zero matches: MISSING.
 *   - League average imputation is PROHIBITED (NEXUS-0 S6.3).
 */
export function computeFormGeneral(
  teamId: string,
  buildNowUtc: string,
  history: HistoricalMatch[],
  lastN: number = 5,
): FeatureValue<number> {
  const eligible = filterByAsOf(history, buildNowUtc);

  const teamMatches = eligible
    .filter((m) => m.homeTeamId === teamId || m.awayTeamId === teamId)
    .sort((a, b) => new Date(b.utcDate).getTime() - new Date(a.utcDate).getTime())
    .slice(0, lastN);

  if (teamMatches.length === 0) {
    // taxonomy spec S5.6: MISSING when zero history (not league average)
    return makeMissing(buildNowUtc) as FeatureValue<number>;
  }

  const totalPoints = teamMatches.reduce((sum, m) => {
    const isHome = m.homeTeamId === teamId;
    const teamGoals = isHome ? m.homeGoals : m.awayGoals;
    const oppGoals = isHome ? m.awayGoals : m.homeGoals;
    if (teamGoals > oppGoals) return sum + 3;
    if (teamGoals === oppGoals) return sum + 1;
    return sum;
  }, 0);

  const ptsPerGame = totalPoints / teamMatches.length;
  // effectiveAt = oldest match in the window (earliest data used)
  const oldestMatch = teamMatches[teamMatches.length - 1];

  return {
    value: ptsPerGame,
    provenance: {
      ...makeDerivedProvenance(buildNowUtc, oldestMatch.utcDate),
      // Confidence: MEDIUM if fewer than N matches used (team's own prior)
      confidence: teamMatches.length < lastN ? 'MEDIUM' : 'HIGH',
    },
  };
}

// ── Context-specific form (taxonomy spec S5.3.1: homeFormHome, awayFormAway) ─

/**
 * Compute points-per-game for a team in a specific venue context.
 *
 * taxonomy spec S5.3.1:
 *   `homeFormHome_last5` — home team's last 5 HOME matches only.
 *   `awayFormAway_last5` — away team's last 5 AWAY matches only.
 *
 * ANTI-LOOKAHEAD (NEXUS-0 S3.2): Only considers matches with utcDate < buildNowUtc.
 *
 * @param teamId        - Canonical team ID.
 * @param isHomeContext - true = only home matches; false = only away matches.
 * @param buildNowUtc   - Temporal anchor.
 * @param history       - Full canonical history (will be filtered).
 * @param lastN         - Number of context-specific matches to use.
 */
export function computeFormSplit(
  teamId: string,
  isHomeContext: boolean,
  buildNowUtc: string,
  history: HistoricalMatch[],
  lastN: number = 5,
): FeatureValue<number> {
  const eligible = filterByAsOf(history, buildNowUtc);

  const contextMatches = eligible
    .filter((m) =>
      isHomeContext
        ? m.homeTeamId === teamId
        : m.awayTeamId === teamId,
    )
    .sort((a, b) => new Date(b.utcDate).getTime() - new Date(a.utcDate).getTime())
    .slice(0, lastN);

  if (contextMatches.length === 0) {
    return makeMissing(buildNowUtc) as FeatureValue<number>;
  }

  const totalPoints = contextMatches.reduce((sum, m) => {
    const teamGoals = isHomeContext ? m.homeGoals : m.awayGoals;
    const oppGoals = isHomeContext ? m.awayGoals : m.homeGoals;
    if (teamGoals > oppGoals) return sum + 3;
    if (teamGoals === oppGoals) return sum + 1;
    return sum;
  }, 0);

  const ptsPerGame = totalPoints / contextMatches.length;
  const oldestMatch = contextMatches[contextMatches.length - 1];

  return {
    value: ptsPerGame,
    provenance: {
      ...makeDerivedProvenance(buildNowUtc, oldestMatch.utcDate),
      confidence: contextMatches.length < lastN ? 'MEDIUM' : 'HIGH',
    },
  };
}

// ── H2H features (taxonomy spec S5.3.2 — CONDITIONALLY ELIGIBLE) ──────────

/**
 * Result of H2H feature computation.
 */
export interface H2hFeatures {
  /** Win rate for the designated home team in H2H encounters. MISSING if no H2H data. */
  h2hWinRateHome: FeatureValue<number>;
  /** Average goal difference (home perspective) in H2H encounters. MISSING if no H2H data. */
  h2hGoalDiffHome: FeatureValue<number>;
  /** Draw rate in H2H encounters. MISSING if no H2H data. */
  h2hDrawRate: FeatureValue<number>;
  /** Number of H2H matches found (always a plain number, 0 when no history). */
  h2hSampleSize: number;
}

/**
 * Compute H2H features for a specific home-away team pair.
 *
 * taxonomy spec S5.3.2 — CONDITIONALLY ELIGIBLE:
 *   These features must demonstrate lift (p < 0.10 in 2 of 3 production leagues)
 *   before being included in the default input vector. Include them in the feature
 *   vector for tracking but mark as conditionally eligible in the model.
 *
 * ANTI-LOOKAHEAD (NEXUS-0 S3.2): Only considers matches with utcDate < buildNowUtc.
 *
 * H2H matching: any encounter between homeTeamId and awayTeamId regardless of
 * which side they played (the `isHomeContext` argument determines win attribution).
 *
 * @param homeTeamId  - Canonical home team ID for the prediction.
 * @param awayTeamId  - Canonical away team ID for the prediction.
 * @param buildNowUtc - Temporal anchor.
 * @param history     - Full canonical history (will be filtered).
 * @param maxMatches  - Max H2H encounters to consider (default: 5).
 */
export function computeH2hFeatures(
  homeTeamId: string,
  awayTeamId: string,
  buildNowUtc: string,
  history: HistoricalMatch[],
  maxMatches: number = 5,
): H2hFeatures {
  const eligible = filterByAsOf(history, buildNowUtc);

  // Find all encounters between these two teams (any combination of home/away)
  const h2hMatches = eligible
    .filter(
      (m) =>
        (m.homeTeamId === homeTeamId && m.awayTeamId === awayTeamId) ||
        (m.homeTeamId === awayTeamId && m.awayTeamId === homeTeamId),
    )
    .sort((a, b) => new Date(b.utcDate).getTime() - new Date(a.utcDate).getTime())
    .slice(0, maxMatches);

  const sampleSize = h2hMatches.length;

  if (sampleSize === 0) {
    // taxonomy spec S5.3.2: MISSING when no H2H history
    return {
      h2hWinRateHome: makeMissing(buildNowUtc) as FeatureValue<number>,
      h2hGoalDiffHome: makeMissing(buildNowUtc) as FeatureValue<number>,
      h2hDrawRate: makeMissing(buildNowUtc) as FeatureValue<number>,
      h2hSampleSize: 0,
    };
  }

  let homeWins = 0;
  let draws = 0;
  let totalGoalDiff = 0;

  for (const m of h2hMatches) {
    // Determine goals from homeTeamId's perspective
    const homeGoalsForPred =
      m.homeTeamId === homeTeamId ? m.homeGoals : m.awayGoals;
    const awayGoalsForPred =
      m.homeTeamId === homeTeamId ? m.awayGoals : m.homeGoals;

    const diff = homeGoalsForPred - awayGoalsForPred;
    totalGoalDiff += diff;

    if (diff > 0) homeWins++;
    else if (diff === 0) draws++;
  }

  const oldestMatch = h2hMatches[h2hMatches.length - 1];
  const provenance = makeDerivedProvenance(buildNowUtc, oldestMatch.utcDate);

  return {
    h2hWinRateHome: {
      value: homeWins / sampleSize,
      provenance: { ...provenance, confidence: sampleSize >= 3 ? 'HIGH' : 'LOW' },
    },
    h2hGoalDiffHome: {
      value: totalGoalDiff / sampleSize,
      provenance: { ...provenance, confidence: sampleSize >= 3 ? 'HIGH' : 'LOW' },
    },
    h2hDrawRate: {
      value: draws / sampleSize,
      provenance: { ...provenance, confidence: sampleSize >= 3 ? 'HIGH' : 'LOW' },
    },
    h2hSampleSize: sampleSize,
  };
}

// ── Competitive importance (taxonomy spec S5.3.1: competitiveImportance) ───

/**
 * Derive competitive importance category for a team.
 *
 * taxonomy spec S5.3.1: `competitiveImportance` — categorical enum.
 *   TITLE_RACE:        Team within 3 positions of top (position <= 3).
 *   RELEGATION_BATTLE: Team within 3 positions of bottom (position >= totalTeams - 2).
 *   MID_TABLE:         Otherwise.
 *   NEUTRAL:           Default when position is unavailable.
 *
 * @param position   - Current table position (1 = top). 0 = unavailable.
 * @param totalTeams - Total teams in the competition.
 */
export function deriveCompetitiveImportance(
  position: number,
  totalTeams: number,
): CompetitiveImportance {
  if (position <= 0 || totalTeams <= 0) return 'NEUTRAL';
  if (position <= 3) return 'TITLE_RACE';
  if (position >= totalTeams - 2) return 'RELEGATION_BATTLE';
  return 'MID_TABLE';
}

// ── Season phase (taxonomy spec S5.3.1: seasonPhase) ───────────────────────

/**
 * Derive season phase from matchday number.
 *
 * taxonomy spec S5.3.1:
 *   EARLY:  matchday 1-10
 *   MID:    matchday 11-25
 *   LATE:   matchday 26+
 */
export function deriveSeasonPhase(matchday: number): SeasonPhase {
  if (matchday <= 10) return 'EARLY';
  if (matchday <= 25) return 'MID';
  return 'LATE';
}

// ── Match importance composite (for logistic model input) ─────────────────

/**
 * Compute a scalar match importance score for the logistic model.
 *
 * Used internally to synthesize a single importance value from
 * position-derived categorical data. Not a direct spec feature, but
 * derived from `competitiveImportance` and `seasonPhase`.
 *
 * Returns a value in [0..1]:
 *   - High importance (title/relegation + late season): 0.8-1.0
 *   - Moderate: 0.4-0.7
 *   - Low: 0.1-0.3
 */
export function computeMatchImportanceScore(
  competitiveImportance: CompetitiveImportance,
  seasonPhase: SeasonPhase,
): number {
  const baseByImportance: Record<CompetitiveImportance, number> = {
    TITLE_RACE: 0.8,
    RELEGATION_BATTLE: 0.9,
    MID_TABLE: 0.3,
    NEUTRAL: 0.5,
  };

  const phaseMultiplier: Record<SeasonPhase, number> = {
    EARLY: 0.6,
    MID: 0.8,
    LATE: 1.0,
  };

  const base = baseByImportance[competitiveImportance];
  const mult = phaseMultiplier[seasonPhase];

  // Clamp to [0.1, 1.0]
  return Math.min(1.0, Math.max(0.1, base * mult));
}

// ── Full feature vector builder ────────────────────────────────────────────

/**
 * Build the complete Track 3 feature vector from canonical inputs.
 *
 * taxonomy spec S5.3.1 + S5.3.2: assembles all eligible and conditionally
 * eligible features into the Track3FeatureVector.
 *
 * All anti-lookahead filtering happens within the individual feature functions.
 *
 * @param homeTeamId      - Canonical home team ID.
 * @param awayTeamId      - Canonical away team ID.
 * @param buildNowUtc     - Temporal anchor (ISO-8601 UTC with Z).
 * @param history         - Full canonical match history (will be filtered).
 * @param eloHome         - Track 1 effective Elo for home team.
 * @param eloAway         - Track 1 effective Elo for away team.
 * @param homePosition    - Home team table position (0 = unavailable).
 * @param awayPosition    - Away team table position (0 = unavailable).
 * @param totalTeams      - Total teams in the competition.
 * @param matchday        - Current matchday number (0 = unknown).
 */
export function buildTrack3FeatureVector(
  homeTeamId: string,
  awayTeamId: string,
  buildNowUtc: string,
  history: HistoricalMatch[],
  eloHome: number,
  eloAway: number,
  homePosition: number,
  awayPosition: number,
  totalTeams: number,
  matchday: number,
): Track3FeatureVector {
  // Rest days
  const restDaysHome = computeRestDays(homeTeamId, buildNowUtc, history);
  const restDaysAway = computeRestDays(awayTeamId, buildNowUtc, history);

  // Schedule congestion
  const matchesLast4WeeksHome = computeMatchesLast4Weeks(homeTeamId, buildNowUtc, history);
  const matchesLast4WeeksAway = computeMatchesLast4Weeks(awayTeamId, buildNowUtc, history);

  // Table position features — MISSING when unavailable
  const tablePositionHome: FeatureValue<number> =
    homePosition > 0
      ? { value: homePosition, provenance: makeDerivedProvenance(buildNowUtc, buildNowUtc) }
      : (makeMissing(buildNowUtc) as FeatureValue<number>);

  const tablePositionAway: FeatureValue<number> =
    awayPosition > 0
      ? { value: awayPosition, provenance: makeDerivedProvenance(buildNowUtc, buildNowUtc) }
      : (makeMissing(buildNowUtc) as FeatureValue<number>);

  // Competitive importance — derived from positions
  // taxonomy spec S5.6: NEUTRAL when position data unavailable
  const homeImportance = deriveCompetitiveImportance(homePosition, totalTeams);
  const awayImportance = deriveCompetitiveImportance(awayPosition, totalTeams);

  // Use the more "intense" competitive context for this match
  const importanceRank: Record<CompetitiveImportance, number> = {
    RELEGATION_BATTLE: 3,
    TITLE_RACE: 2,
    MID_TABLE: 1,
    NEUTRAL: 0,
  };
  const competitiveImportance: CompetitiveImportance =
    importanceRank[homeImportance] >= importanceRank[awayImportance]
      ? homeImportance
      : awayImportance;

  // Form features
  const formHome_last5 = computeFormGeneral(homeTeamId, buildNowUtc, history, 5);
  const formAway_last5 = computeFormGeneral(awayTeamId, buildNowUtc, history, 5);
  const homeFormHome_last5 = computeFormSplit(homeTeamId, true, buildNowUtc, history, 5);
  const awayFormAway_last5 = computeFormSplit(awayTeamId, false, buildNowUtc, history, 5);

  // Season phase
  const seasonPhase = deriveSeasonPhase(matchday);

  // H2H (conditionally eligible — computed but flagged)
  const h2h = computeH2hFeatures(homeTeamId, awayTeamId, buildNowUtc, history);

  return {
    eloHome,
    eloAway,
    eloDiff: eloHome - eloAway,
    restDaysHome,
    restDaysAway,
    matchesLast4WeeksHome,
    matchesLast4WeeksAway,
    tablePositionHome,
    tablePositionAway,
    competitiveImportance,
    formHome_last5,
    formAway_last5,
    homeFormHome_last5,
    awayFormAway_last5,
    matchday,
    seasonPhase,
    // H2H — conditionally eligible (taxonomy spec S5.3.2)
    h2hWinRateHome_last5: h2h.h2hWinRateHome,
    h2hGoalDiffHome_last5: h2h.h2hGoalDiffHome,
    h2hDrawRate_last5: h2h.h2hDrawRate,
    h2hSampleSize: h2h.h2hSampleSize,
  };
}
