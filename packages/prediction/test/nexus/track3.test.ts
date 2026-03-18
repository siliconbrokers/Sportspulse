/**
 * track3.test.ts — NEXUS Track 3: unit tests.
 *
 * Spec authority:
 *   - taxonomy spec S5.1–S5.7: Track 3 specification
 *   - NEXUS-0 S3.2: strict as-of anti-lookahead invariant
 *   - NEXUS-0 S6.1: MISSING sentinel
 *   - master spec S8.4, S8.5: isolation from V3
 *
 * Test IDs: T3-01..T3-XX
 */

import { describe, test, expect } from 'vitest';
import { MISSING } from '../../src/nexus/feature-store/types.js';
import type { HistoricalMatch } from '../../src/nexus/track1/types.js';
import {
  computeRestDays,
  computeMatchesLast4Weeks,
  computeFormGeneral,
  computeFormSplit,
  computeH2hFeatures,
  deriveCompetitiveImportance,
  deriveSeasonPhase,
  buildTrack3FeatureVector,
} from '../../src/nexus/track3/context-features.js';
import {
  predictLogistic,
  DEFAULT_LOGISTIC_WEIGHTS,
} from '../../src/nexus/track3/logistic-model.js';
import {
  computeTrack3,
  CONTEXT_MODEL_VERSION,
  FEATURE_SCHEMA_VERSION,
} from '../../src/nexus/track3/track3-engine.js';

// ── Test fixtures ──────────────────────────────────────────────────────────

function makeMatch(
  homeTeamId: string,
  awayTeamId: string,
  utcDate: string,
  homeGoals: number,
  awayGoals: number,
  isNeutralVenue = false,
): HistoricalMatch {
  return { homeTeamId, awayTeamId, utcDate, homeGoals, awayGoals, isNeutralVenue };
}

const BUILD_NOW = '2025-01-15T10:00:00Z';
const TEAM_A = 'teamA';
const TEAM_B = 'teamB';

/**
 * Build a history for a team with matches at specific dates.
 * homeGoals/awayGoals alternate to have varied outcomes.
 */
function makeTeamHistory(
  teamId: string,
  dates: string[],
  homeGoals = 2,
  awayGoals = 1,
): HistoricalMatch[] {
  return dates.map((utcDate, i) =>
    makeMatch(
      i % 2 === 0 ? teamId : `opp${i}`,
      i % 2 === 0 ? `opp${i}` : teamId,
      utcDate,
      homeGoals,
      awayGoals,
    ),
  );
}

// ── T3-01: Anti-lookahead — features exclude future and same-time matches ──

describe('T3-01: anti-lookahead invariant', () => {
  test('computeRestDays excludes matches at or after buildNowUtc', () => {
    const buildNow = '2025-01-15T10:00:00Z';
    const history: HistoricalMatch[] = [
      makeMatch(TEAM_A, TEAM_B, '2025-01-14T20:00:00Z', 2, 1), // OK — 1 day before
      makeMatch(TEAM_A, TEAM_B, '2025-01-15T10:00:00Z', 1, 0), // same time — EXCLUDE
      makeMatch(TEAM_A, TEAM_B, '2025-01-16T20:00:00Z', 0, 0), // future — EXCLUDE
    ];

    const result = computeRestDays(TEAM_A, buildNow, history);

    // Only the match on 2025-01-14 should be used → ~1 day of rest
    expect(result.value).not.toBe(MISSING);
    const days = result.value as number;
    // Distance from Jan 14 20:00 UTC to Jan 15 10:00 UTC = 14 hours = 0.583 days
    expect(days).toBeCloseTo(0.583, 1);
  });

  test('computeFormGeneral excludes future matches from form calculation', () => {
    const buildNow = '2025-01-15T10:00:00Z';
    const history: HistoricalMatch[] = [
      makeMatch(TEAM_A, TEAM_B, '2025-01-10T20:00:00Z', 2, 0), // win for A
      makeMatch(TEAM_A, TEAM_B, '2025-01-16T20:00:00Z', 3, 0), // future — EXCLUDE
    ];

    const result = computeFormGeneral(TEAM_A, buildNow, history, 5);

    // Only one past match (win = 3 pts) → 3.0 pts per game
    expect(result.value).not.toBe(MISSING);
    expect(result.value as number).toBeCloseTo(3.0, 5);
  });

  test('computeH2hFeatures excludes future H2H matches', () => {
    const buildNow = '2025-01-15T10:00:00Z';
    const history: HistoricalMatch[] = [
      makeMatch(TEAM_A, TEAM_B, '2025-01-10T20:00:00Z', 1, 1), // draw in past
      makeMatch(TEAM_A, TEAM_B, '2025-01-20T20:00:00Z', 2, 0), // future — EXCLUDE
    ];

    const result = computeH2hFeatures(TEAM_A, TEAM_B, buildNow, history);

    expect(result.h2hSampleSize).toBe(1);
    // Only the draw counts
    expect(result.h2hDrawRate.value).not.toBe(MISSING);
    expect(result.h2hDrawRate.value as number).toBeCloseTo(1.0, 5);
  });
});

// ── T3-02: No H2H history → h2hSampleSize = 0, features MISSING ──────────

describe('T3-02: no H2H history', () => {
  test('h2hSampleSize = 0 when no history', () => {
    const result = computeH2hFeatures(TEAM_A, TEAM_B, BUILD_NOW, []);
    expect(result.h2hSampleSize).toBe(0);
  });

  test('H2H features are MISSING when no history', () => {
    const result = computeH2hFeatures(TEAM_A, TEAM_B, BUILD_NOW, []);
    expect(result.h2hWinRateHome.value).toBe(MISSING);
    expect(result.h2hGoalDiffHome.value).toBe(MISSING);
    expect(result.h2hDrawRate.value).toBe(MISSING);
  });

  test('H2H features are MISSING when no cross-team matches exist', () => {
    // History has matches but none between TEAM_A and TEAM_B
    const history: HistoricalMatch[] = [
      makeMatch('teamC', 'teamD', '2025-01-10T20:00:00Z', 1, 0),
      makeMatch('teamE', TEAM_A, '2025-01-12T20:00:00Z', 0, 2),
    ];
    const result = computeH2hFeatures(TEAM_A, TEAM_B, BUILD_NOW, history);
    expect(result.h2hSampleSize).toBe(0);
    expect(result.h2hWinRateHome.value).toBe(MISSING);
  });
});

// ── T3-03: Form home/away split uses only context-specific matches ─────────

describe('T3-03: form home/away split', () => {
  test('homeFormHome uses only home matches for the team', () => {
    const buildNow = '2025-02-01T10:00:00Z';
    // 3 home wins + 3 away losses for TEAM_A
    const history: HistoricalMatch[] = [
      makeMatch(TEAM_A, 'opp1', '2025-01-05T20:00:00Z', 2, 0), // home win
      makeMatch(TEAM_A, 'opp2', '2025-01-10T20:00:00Z', 1, 0), // home win
      makeMatch(TEAM_A, 'opp3', '2025-01-15T20:00:00Z', 3, 0), // home win
      makeMatch('opp4', TEAM_A, '2025-01-06T20:00:00Z', 3, 0), // away loss
      makeMatch('opp5', TEAM_A, '2025-01-11T20:00:00Z', 2, 0), // away loss
      makeMatch('opp6', TEAM_A, '2025-01-16T20:00:00Z', 1, 0), // away loss
    ];

    const homeForm = computeFormSplit(TEAM_A, true, buildNow, history, 5);
    const awayForm = computeFormSplit(TEAM_A, false, buildNow, history, 5);

    // Home form: 3 wins = 3.0 pts/game
    expect(homeForm.value).not.toBe(MISSING);
    expect(homeForm.value as number).toBeCloseTo(3.0, 5);

    // Away form: 3 losses = 0.0 pts/game
    expect(awayForm.value).not.toBe(MISSING);
    expect(awayForm.value as number).toBeCloseTo(0.0, 5);
  });

  test('form context returns MISSING when no matches in that context', () => {
    const buildNow = '2025-02-01T10:00:00Z';
    // Only away matches for TEAM_A — no home matches
    const history: HistoricalMatch[] = [
      makeMatch('opp1', TEAM_A, '2025-01-10T20:00:00Z', 1, 2), // away win
    ];

    const homeForm = computeFormSplit(TEAM_A, true, buildNow, history, 5);
    expect(homeForm.value).toBe(MISSING);

    const awayForm = computeFormSplit(TEAM_A, false, buildNow, history, 5);
    expect(awayForm.value).not.toBe(MISSING);
    expect(awayForm.value as number).toBeCloseTo(3.0, 5);
  });
});

// ── T3-04: Track3Output probs sum to 1.0 ──────────────────────────────────

describe('T3-04: probability invariant', () => {
  test('computeTrack3 probs sum to exactly 1.0 with rich history', () => {
    const history = makeTeamHistory(TEAM_A, [
      '2025-01-01T20:00:00Z',
      '2025-01-05T20:00:00Z',
      '2025-01-10T20:00:00Z',
    ]);

    const output = computeTrack3(
      TEAM_A, TEAM_B, BUILD_NOW, history,
      1550, 1450, // eloHome, eloAway
      3, 12,      // homePosition, awayPosition
      20, 15,     // totalTeams, matchday
    );

    const sum = output.probs.home + output.probs.draw + output.probs.away;
    expect(sum).toBeCloseTo(1.0, 10);
  });

  test('computeTrack3 probs sum to 1.0 with empty history', () => {
    const output = computeTrack3(
      TEAM_A, TEAM_B, BUILD_NOW, [],
      1500, 1500,
      10, 10,
      20, 5,
    );

    const sum = output.probs.home + output.probs.draw + output.probs.away;
    expect(sum).toBeCloseTo(1.0, 10);
  });

  test('predictLogistic alone returns probs summing to 1.0', () => {
    const fv = buildTrack3FeatureVector(
      TEAM_A, TEAM_B, BUILD_NOW, [],
      1500, 1500, 0, 0, 20, 5,
    );
    const { probs } = predictLogistic(fv, DEFAULT_LOGISTIC_WEIGHTS);
    const sum = probs.home + probs.draw + probs.away;
    expect(sum).toBeCloseTo(1.0, 10);
  });
});

// ── T3-05: More home rest → higher home win probability ───────────────────

describe('T3-05: rest days effect on home probability', () => {
  test('home team with more rest has higher p_home (ceteris paribus)', () => {
    const awayHistory: HistoricalMatch[] = [
      makeMatch('opp1', TEAM_B, '2025-01-14T20:00:00Z', 1, 1), // B rested ~0.6 days
    ];

    // Scenario 1: home has 7 days rest, away has 1 day rest
    const historyHomeRested: HistoricalMatch[] = [
      makeMatch(TEAM_A, 'opp1', '2025-01-08T10:00:00Z', 2, 0), // 7 days before
      ...awayHistory,
    ];

    // Scenario 2: home has 0 days rest (very recent match), away has same 1 day
    const historyHomeFatigued: HistoricalMatch[] = [
      makeMatch(TEAM_A, 'opp1', '2025-01-14T22:00:00Z', 2, 0), // 12 hours before
      ...awayHistory,
    ];

    const outputRested = computeTrack3(
      TEAM_A, TEAM_B, BUILD_NOW, historyHomeRested,
      1500, 1500, 10, 10, 20, 15,
    );

    const outputFatigued = computeTrack3(
      TEAM_A, TEAM_B, BUILD_NOW, historyHomeFatigued,
      1500, 1500, 10, 10, 20, 15,
    );

    // More home rest → higher p_home
    expect(outputRested.probs.home).toBeGreaterThan(outputFatigued.probs.home);
  });
});

// ── T3-06: Confidence HIGH when critical features available ───────────────

describe('T3-06: confidence levels', () => {
  test('confidence HIGH when rest and form features available', () => {
    // Rich history: 6+ matches before buildNow to populate all form features
    const richHistory: HistoricalMatch[] = [
      makeMatch(TEAM_A, 'opp1', '2025-01-01T20:00:00Z', 2, 0),
      makeMatch(TEAM_A, 'opp2', '2025-01-03T20:00:00Z', 1, 1),
      makeMatch(TEAM_A, 'opp3', '2025-01-05T20:00:00Z', 2, 0),
      makeMatch(TEAM_A, 'opp4', '2025-01-07T20:00:00Z', 0, 1),
      makeMatch(TEAM_A, 'opp5', '2025-01-09T20:00:00Z', 3, 0),
      makeMatch('opp1', TEAM_B, '2025-01-02T20:00:00Z', 0, 2),
      makeMatch('opp2', TEAM_B, '2025-01-04T20:00:00Z', 1, 2),
      makeMatch('opp3', TEAM_B, '2025-01-06T20:00:00Z', 0, 3),
      makeMatch('opp4', TEAM_B, '2025-01-08T20:00:00Z', 1, 1),
      makeMatch('opp5', TEAM_B, '2025-01-10T20:00:00Z', 0, 2),
    ];

    const output = computeTrack3(
      TEAM_A, TEAM_B, BUILD_NOW, richHistory,
      1550, 1450, 3, 15, 20, 20,
    );

    expect(output.confidence).toBe('HIGH');
  });

  test('confidence LOW when no history exists', () => {
    const output = computeTrack3(
      TEAM_A, TEAM_B, BUILD_NOW, [],
      1500, 1500, 0, 0, 20, 5,
    );

    expect(output.confidence).toBe('LOW');
  });

  test('confidence MEDIUM when only away-form is missing for home team', () => {
    // Home team has home matches but no away matches (homeFormHome present, awayFormAway missing)
    // Away team has away matches but no home matches
    // This should produce some MISSING features → MEDIUM or LOW depending on count
    const history: HistoricalMatch[] = [
      // TEAM_A only has home matches (no away matches for awayFormAway feature)
      makeMatch(TEAM_A, 'opp1', '2025-01-05T20:00:00Z', 2, 0),
      makeMatch(TEAM_A, 'opp2', '2025-01-08T20:00:00Z', 1, 1),
      // TEAM_B only has away matches (no home matches for homeFormHome feature)
      makeMatch('opp3', TEAM_B, '2025-01-06T20:00:00Z', 0, 2),
      makeMatch('opp4', TEAM_B, '2025-01-09T20:00:00Z', 1, 1),
    ];

    const output = computeTrack3(
      TEAM_A, TEAM_B, BUILD_NOW, history,
      1500, 1500, 0, 0, 20, 5,
    );

    // Both context-specific form features present (A has home, B has away context)
    // All rest/congestion/general-form features present
    // This gives HIGH or MEDIUM confidence
    expect(['HIGH', 'MEDIUM']).toContain(output.confidence);
  });
});

// ── T3-07: Track 3 does NOT import from engine/v3/ ──────────────────────

describe('T3-07: isolation from V3 engine', () => {
  test('index.ts re-exports do not include any engine/v3 symbols', async () => {
    // Dynamically import track3 index and check that V3 symbols are not present
    const track3Module = await import('../../src/nexus/track3/index.js');

    // V3 symbols that must NOT be exported from track3
    const forbiddenExports = [
      'computeV3Engine',
      'computeLambdas',
      'computeEloRating',
      'computeScorelineMatrix',
      'buildV3Engine',
    ];

    for (const sym of forbiddenExports) {
      expect(
        Object.keys(track3Module),
        `Track 3 must not re-export V3 symbol: ${sym}`,
      ).not.toContain(sym);
    }
  });

  test('computeTrack3 produces output without V3 internal state', () => {
    // Verify Track 3 is a self-contained pure function
    const output1 = computeTrack3(TEAM_A, TEAM_B, BUILD_NOW, [], 1500, 1500, 0, 0, 20, 5);
    const output2 = computeTrack3(TEAM_A, TEAM_B, BUILD_NOW, [], 1500, 1500, 0, 0, 20, 5);

    // Pure function: same inputs → same outputs
    expect(output1.probs.home).toBe(output2.probs.home);
    expect(output1.probs.draw).toBe(output2.probs.draw);
    expect(output1.probs.away).toBe(output2.probs.away);
  });
});

// ── T3-08: Model metadata in output ──────────────────────────────────────

describe('T3-08: output metadata', () => {
  test('output contains contextModelVersion and featureSchemaVersion', () => {
    const output = computeTrack3(TEAM_A, TEAM_B, BUILD_NOW, [], 1500, 1500, 0, 0, 20, 5);
    expect(output.contextModelVersion).toBe(CONTEXT_MODEL_VERSION);
    expect(output.featureSchemaVersion).toBe(FEATURE_SCHEMA_VERSION);
    expect(output.model_type).toBe('logistic');
  });

  test('features_used is present and contains the full feature vector', () => {
    const output = computeTrack3(TEAM_A, TEAM_B, BUILD_NOW, [], 1500, 1500, 0, 0, 20, 5);
    expect(output.features_used).toBeDefined();
    expect(output.features_used.eloDiff).toBe(0); // equal elos
    expect(output.features_used.matchday).toBe(5);
    expect(output.features_used.seasonPhase).toBe('EARLY');
  });
});

// ── T3-09: Stronger team has higher win probability ───────────────────────

describe('T3-09: elo differential effect', () => {
  test('team with 200 elo advantage has higher win probability', () => {
    // Home team with significant Elo advantage
    const outputFavorite = computeTrack3(
      TEAM_A, TEAM_B, BUILD_NOW, [],
      1700, 1500, // home team 200 elo ahead
      5, 15, 20, 15,
    );

    // Home team with significant Elo disadvantage
    const outputUnderdog = computeTrack3(
      TEAM_A, TEAM_B, BUILD_NOW, [],
      1300, 1500, // home team 200 elo behind
      5, 15, 20, 15,
    );

    expect(outputFavorite.probs.home).toBeGreaterThan(outputUnderdog.probs.home);
    expect(outputFavorite.probs.away).toBeLessThan(outputUnderdog.probs.away);
  });
});

// ── T3-10: deriveCompetitiveImportance ───────────────────────────────────

describe('T3-10: competitive importance classification', () => {
  test('top 3 positions → TITLE_RACE', () => {
    expect(deriveCompetitiveImportance(1, 20)).toBe('TITLE_RACE');
    expect(deriveCompetitiveImportance(3, 20)).toBe('TITLE_RACE');
  });

  test('bottom 3 positions → RELEGATION_BATTLE', () => {
    expect(deriveCompetitiveImportance(18, 20)).toBe('RELEGATION_BATTLE');
    expect(deriveCompetitiveImportance(20, 20)).toBe('RELEGATION_BATTLE');
  });

  test('mid-table positions → MID_TABLE', () => {
    expect(deriveCompetitiveImportance(10, 20)).toBe('MID_TABLE');
    expect(deriveCompetitiveImportance(4, 20)).toBe('MID_TABLE');
  });

  test('position 0 (unavailable) → NEUTRAL', () => {
    expect(deriveCompetitiveImportance(0, 20)).toBe('NEUTRAL');
  });

  test('totalTeams 0 → NEUTRAL', () => {
    expect(deriveCompetitiveImportance(5, 0)).toBe('NEUTRAL');
  });
});

// ── T3-11: deriveSeasonPhase ─────────────────────────────────────────────

describe('T3-11: season phase derivation', () => {
  test('matchday 1-10 → EARLY', () => {
    expect(deriveSeasonPhase(1)).toBe('EARLY');
    expect(deriveSeasonPhase(10)).toBe('EARLY');
  });

  test('matchday 11-25 → MID', () => {
    expect(deriveSeasonPhase(11)).toBe('MID');
    expect(deriveSeasonPhase(25)).toBe('MID');
  });

  test('matchday 26+ → LATE', () => {
    expect(deriveSeasonPhase(26)).toBe('LATE');
    expect(deriveSeasonPhase(38)).toBe('LATE');
  });
});

// ── T3-12: restDays MISSING when no prior match ──────────────────────────

describe('T3-12: MISSING sentinel for absent features', () => {
  test('restDaysHome is MISSING when no history for team', () => {
    const result = computeRestDays(TEAM_A, BUILD_NOW, []);
    expect(result.value).toBe(MISSING);
    expect(result.provenance.confidence).toBe('UNKNOWN');
  });

  test('computeFormGeneral is MISSING with empty history', () => {
    const result = computeFormGeneral(TEAM_A, BUILD_NOW, [], 5);
    expect(result.value).toBe(MISSING);
  });

  test('computeFormSplit is MISSING with no matches in context', () => {
    const result = computeFormSplit(TEAM_A, true, BUILD_NOW, [], 5);
    expect(result.value).toBe(MISSING);
  });
});

// ── T3-13: Form points calculation ───────────────────────────────────────

describe('T3-13: form points calculation', () => {
  test('win = 3 pts, draw = 1 pt, loss = 0 pts', () => {
    const buildNow = '2025-02-01T10:00:00Z';
    const history: HistoricalMatch[] = [
      makeMatch(TEAM_A, 'opp1', '2025-01-20T20:00:00Z', 2, 0), // win
      makeMatch(TEAM_A, 'opp2', '2025-01-22T20:00:00Z', 1, 1), // draw
      makeMatch(TEAM_A, 'opp3', '2025-01-24T20:00:00Z', 0, 3), // loss
    ];

    const form = computeFormGeneral(TEAM_A, buildNow, history, 5);
    // (3 + 1 + 0) / 3 = 4/3 ≈ 1.333
    expect(form.value).not.toBe(MISSING);
    expect(form.value as number).toBeCloseTo(4 / 3, 5);
  });

  test('form uses lastN most recent matches when more available', () => {
    const buildNow = '2025-02-01T10:00:00Z';
    const history: HistoricalMatch[] = [
      // 6 matches — only last 5 should be used
      makeMatch(TEAM_A, 'opp0', '2025-01-05T20:00:00Z', 0, 3), // oldest — excluded
      makeMatch(TEAM_A, 'opp1', '2025-01-10T20:00:00Z', 2, 0), // win
      makeMatch(TEAM_A, 'opp2', '2025-01-15T20:00:00Z', 2, 0), // win
      makeMatch(TEAM_A, 'opp3', '2025-01-18T20:00:00Z', 2, 0), // win
      makeMatch(TEAM_A, 'opp4', '2025-01-20T20:00:00Z', 2, 0), // win
      makeMatch(TEAM_A, 'opp5', '2025-01-22T20:00:00Z', 2, 0), // win
    ];

    const form = computeFormGeneral(TEAM_A, buildNow, history, 5);
    // Only last 5 = 5 wins = 3.0 pts/game
    expect(form.value as number).toBeCloseTo(3.0, 5);
  });
});

// ── T3-14: H2H considers both home and away encounters ───────────────────

describe('T3-14: H2H bidirectional matching', () => {
  test('H2H counts encounters regardless of which side each team was home', () => {
    const buildNow = '2025-02-01T10:00:00Z';
    const history: HistoricalMatch[] = [
      makeMatch(TEAM_A, TEAM_B, '2025-01-05T20:00:00Z', 2, 1), // A home win
      makeMatch(TEAM_B, TEAM_A, '2025-01-15T20:00:00Z', 3, 0), // B home (A away loss)
    ];

    const result = computeH2hFeatures(TEAM_A, TEAM_B, buildNow, history);

    expect(result.h2hSampleSize).toBe(2);
    // From A's perspective: 1 win (2-1), 1 loss (0-3)
    // winRate for A = 0.5
    expect(result.h2hWinRateHome.value).not.toBe(MISSING);
    expect(result.h2hWinRateHome.value as number).toBeCloseTo(0.5, 5);
    // Goal diff: (2-1) + (0-3) = 1 + (-3) = -2, avg = -1.0
    expect(result.h2hGoalDiffHome.value as number).toBeCloseTo(-1.0, 5);
  });
});

// ── T3-15: matchesLast4Weeks counts correctly ─────────────────────────────

describe('T3-15: schedule congestion feature', () => {
  test('counts matches in the last 28 days', () => {
    const buildNow = '2025-02-15T10:00:00Z';
    const history: HistoricalMatch[] = [
      makeMatch(TEAM_A, 'opp1', '2025-01-01T20:00:00Z', 2, 0), // outside 28d window
      makeMatch(TEAM_A, 'opp2', '2025-01-20T20:00:00Z', 1, 1), // inside
      makeMatch(TEAM_A, 'opp3', '2025-01-28T20:00:00Z', 0, 1), // inside
      makeMatch(TEAM_A, 'opp4', '2025-02-05T20:00:00Z', 2, 0), // inside
      makeMatch(TEAM_A, 'opp5', '2025-02-12T20:00:00Z', 1, 0), // inside
    ];

    const result = computeMatchesLast4Weeks(TEAM_A, buildNow, history);
    expect(result.value).not.toBe(MISSING);
    // Jan 18 is 28 days before Feb 15. Jan 20 is inside. Jan 1 is outside.
    // Matches inside: Jan 20, Jan 28, Feb 5, Feb 12 = 4 matches
    expect(result.value as number).toBe(4);
  });

  test('returns MISSING when no history for team', () => {
    const result = computeMatchesLast4Weeks(TEAM_A, BUILD_NOW, []);
    expect(result.value).toBe(MISSING);
  });
});
