/**
 * promotion.test.ts — NEXUS Promotion Gate + Swap Tests.
 *
 * Spec authority: evaluation-and-promotion spec S6, S7, S8, S12.
 *
 * Mandatory tests (per task specification):
 *   T-01: Gate passes with correct data (all thresholds satisfied)
 *   T-02: Gate fails — insufficient total samples (n < 600)
 *   T-03: Gate fails — live_shadow RPS too high (> V3 + 0.005)
 *   T-04: Gate fails — DRAW recall regression (relative to V3)
 *   T-05: Demotion trigger activated (RPS_live > RPS_hwf + 0.015 is NOT the spec rule)
 *         Spec S8.2: trigger fires when nexusRps > v3Rps + 0.005 for >= 10 consecutive
 *   T-06: Demotion trigger not activated (within threshold)
 *   T-07: Swap state correct after ACTIVATE_NEXUS
 *   T-08: Deprecation blocked pre-observation period (< 30 days)
 *   T-09: Deprecation allowed post-observation period (>= 30 days)
 *   T-10: live_shadow condition non-substitutable (gate fails if live_shadow.n < 100)
 *
 * Additional coverage:
 *   T-11: Gate fails — accuracy regression (below tolerance)
 *   T-12: Gate fails — per-league RPS regression (one league exceeds +0.005)
 *   T-13: Gate fails — matchday consistency below 70%
 *   T-14: activate_nexus returns BLOCKED when gate not passed
 *   T-15: demotion_check returns DEMOTE_NEXUS when signal fires
 *   T-16: demotion_check returns NO_ACTION when no signal
 *   T-17: deprecation blocked when demotion fired
 *   T-18: evaluateDemotionSequence fires on 10+ consecutive trigger matches
 *   T-19: evaluateDemotionSequence does NOT fire on 9 consecutive trigger matches
 *   T-20: applySwapAction transitions correctly for all action types
 *
 * NOTE ON PROMPT VS SPEC (demotion trigger tests T-05, T-06):
 * The implementation prompt described: "RPS_live > RPS_hwf + 0.015 → demotionSignal = true"
 * The spec S8.2 defines: "RPS_NEXUS > RPS_V3 + 0.005 sustained for >= 10 consecutive matches"
 * THE SPEC GOVERNS. Tests T-05/T-06 test the spec's rule (checkDemotionTrigger point-in-time).
 * The prompt's framing is NOT tested because it contradicts the spec.
 */

import { describe, it, expect } from 'vitest';

import { evaluatePromotionGate } from '../../src/nexus/promotion/gate-evaluator.js';

import {
  GATE_CONDITION,
  DEFAULT_VOLUME_REQUIREMENTS,
  DEFAULT_PERFORMANCE_REQUIREMENTS,
  OBSERVATION_PERIOD_DAYS,
} from '../../src/nexus/promotion/types.js';

import type {
  GateEvaluationInput,
  SwapState,
  GateResult,
  DemotionCheckResult,
} from '../../src/nexus/promotion/types.js';

import {
  checkDemotionTrigger,
  evaluateDemotionSequence,
} from '../../src/nexus/promotion/demotion-trigger.js';

import {
  activate_nexus,
  demotion_check,
  deprecate_v3,
  applySwapAction,
} from '../../src/nexus/promotion/swap-controller.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = '2026-06-15T10:00:00.000Z';

/** Build a passing GateEvaluationInput — all conditions satisfied. */
function buildPassingInput(): GateEvaluationInput {
  return {
    // Combined slice: 700 total, NEXUS better than V3
    combinedN: 700,
    combinedNexusRps: 0.200,
    combinedV3Rps: 0.215,      // NEXUS is better by 0.015
    combinedNexusDrawRecall: 0.28,
    combinedV3DrawRecall: 0.27, // NEXUS draw recall >= V3 - 0.03
    combinedNexusAccuracy: 0.56,
    combinedV3Accuracy: 0.55,   // NEXUS accuracy >= V3 - 0.02
    combinedNexusLogLoss: 1.00,
    combinedV3LogLoss: 1.02,    // NEXUS log-loss <= V3 + 0.02

    // Live shadow slice: 350 (>= 100 per league), NEXUS not worse by > 0.005
    liveShadowN: 350,
    liveShadowNexusRps: 0.202,
    liveShadowV3Rps: 0.214,    // delta = -0.012, NEXUS better

    // HWF slice
    hwfN: 350,

    // Per-league: 3 leagues, each >= 200 total, >= 100 live_shadow
    leagueSummaries: [
      {
        competitionId: 'comp:football-data:PD',
        n: 250,
        nLiveShadow: 120,
        matchdayCount: 12,
        nexusRps: 0.198,
        v3Rps: 0.210,  // NEXUS wins
      },
      {
        competitionId: 'comp:football-data:PL',
        n: 240,
        nLiveShadow: 120,
        matchdayCount: 11,
        nexusRps: 0.201,
        v3Rps: 0.216,  // NEXUS wins
      },
      {
        competitionId: 'comp:football-data:BL1',
        n: 210,
        nLiveShadow: 110,
        matchdayCount: 10,
        nexusRps: 0.203,
        v3Rps: 0.218,  // NEXUS wins
      },
    ],

    // Matchday consistency: 8 of 10 matchdays NEXUS wins = 80% >= 70%
    matchdaySummaries: Array.from({ length: 10 }, (_, i) => ({
      matchdayId: `MD${i + 1}`,
      nexusRps: i < 8 ? 0.195 : 0.220,  // first 8: NEXUS wins; last 2: V3 wins
      v3Rps: 0.210,
    })),

    seasonPhaseCount: 3,  // EARLY + MID + LATE
  };
}

/** Build a passing SwapState (NEXUS active, V3 in shadow). */
function buildActiveSwapState(promotedAt: string = NOW): SwapState {
  return {
    activeModel: 'nexus',
    v3InShadow: true,
    nexusPromotedAt: promotedAt,
    v3DeprecatedAt: null,
    demotionFired: false,
  };
}

/** Build initial SwapState (V3 active, NEXUS not yet promoted). */
function buildInitialSwapState(): SwapState {
  return {
    activeModel: 'v3',
    v3InShadow: false,
    nexusPromotedAt: null,
    v3DeprecatedAt: null,
    demotionFired: false,
  };
}

// ── T-01: Gate passes with correct data ──────────────────────────────────────

describe('T-01: Gate passes with all thresholds satisfied', () => {
  it('evaluatePromotionGate returns passed=true when all conditions met', () => {
    const input = buildPassingInput();
    const result = evaluatePromotionGate(input, NOW);

    expect(result.passed).toBe(true);
    expect(result.failedConditions).toHaveLength(0);
    expect(result.evaluatedAt).toBe(NOW);
  });

  it('evidence is populated with correct values', () => {
    const input = buildPassingInput();
    const result = evaluatePromotionGate(input, NOW);

    expect(result.evidence.totalN).toBe(700);
    expect(result.evidence.liveShadowN).toBe(350);
    expect(result.evidence.rpsDelta).toBeCloseTo(0.200 - 0.215, 6);
    expect(result.evidence.leaguesWhereNexusWins).toHaveLength(3);
  });
});

// ── T-02: Gate fails — insufficient total samples ─────────────────────────────

describe('T-02: Gate fails — insufficient total samples (n < 600)', () => {
  it('returns passed=false with INSUFFICIENT_SAMPLES when combinedN < 600', () => {
    const input: GateEvaluationInput = {
      ...buildPassingInput(),
      combinedN: 450,   // below threshold of 600
      hwfN: 100,
      liveShadowN: 350,
    };
    const result = evaluatePromotionGate(input, NOW);

    expect(result.passed).toBe(false);
    expect(result.failedConditions).toContain(GATE_CONDITION.INSUFFICIENT_SAMPLES);
  });

  it('reason string includes INSUFFICIENT_SAMPLES condition name', () => {
    const input: GateEvaluationInput = {
      ...buildPassingInput(),
      combinedN: 100,
      hwfN: 0,
      liveShadowN: 100,
    };
    const result = evaluatePromotionGate(input, NOW);
    const action = activate_nexus(result, NOW);

    expect(action.action).toBe('BLOCKED');
    expect(action.reason).toContain('INSUFFICIENT_SAMPLES');
  });
});

// ── T-03: Gate fails — live_shadow RPS too high ───────────────────────────────

describe('T-03: Gate fails — live_shadow RPS regression > 0.005', () => {
  it('returns passed=false with LIVE_SHADOW_RPS_REGRESSION', () => {
    const input: GateEvaluationInput = {
      ...buildPassingInput(),
      liveShadowNexusRps: 0.220,
      liveShadowV3Rps: 0.210,  // delta = +0.010 > 0.005 → fail
    };
    const result = evaluatePromotionGate(input, NOW);

    expect(result.passed).toBe(false);
    expect(result.failedConditions).toContain(GATE_CONDITION.LIVE_SHADOW_RPS_REGRESSION);
  });

  it('passes when live_shadow delta is well within threshold (0.003 < 0.005)', () => {
    const input: GateEvaluationInput = {
      ...buildPassingInput(),
      liveShadowNexusRps: 0.213,
      liveShadowV3Rps: 0.210,  // delta = 0.003 < 0.005 → pass
    };
    const result = evaluatePromotionGate(input, NOW);

    // live_shadow condition passes; check it's not in failedConditions
    expect(result.failedConditions).not.toContain(GATE_CONDITION.LIVE_SHADOW_RPS_REGRESSION);
  });
});

// ── T-04: Gate fails — DRAW recall regression ─────────────────────────────────

describe('T-04: Gate fails — DRAW recall regression below tolerance', () => {
  it('returns passed=false with DRAW_RECALL_REGRESSION', () => {
    const input: GateEvaluationInput = {
      ...buildPassingInput(),
      combinedNexusDrawRecall: 0.20,  // below V3 (0.27) by 0.07 > 0.03 tolerance
      combinedV3DrawRecall: 0.27,
    };
    const result = evaluatePromotionGate(input, NOW);

    expect(result.passed).toBe(false);
    expect(result.failedConditions).toContain(GATE_CONDITION.DRAW_RECALL_REGRESSION);
    expect(result.evidence.drawRecallDelta).toBeCloseTo(-0.07, 6);
  });

  it('passes when NEXUS draw recall is well within tolerance boundary', () => {
    const input: GateEvaluationInput = {
      ...buildPassingInput(),
      combinedNexusDrawRecall: 0.245,  // V3 = 0.27, delta = -0.025 > -0.03 → pass
      combinedV3DrawRecall: 0.27,
    };
    const result = evaluatePromotionGate(input, NOW);

    expect(result.failedConditions).not.toContain(GATE_CONDITION.DRAW_RECALL_REGRESSION);
  });
});

// ── T-05: Demotion trigger activated ─────────────────────────────────────────

describe('T-05: Demotion trigger activated (spec S8.2: nexusRps > v3Rps + 0.005)', () => {
  it('checkDemotionTrigger returns true when nexusRps > v3Rps + threshold', () => {
    // NEXUS RPS = 0.220, V3 RPS = 0.210 → delta = 0.010 > 0.005 → trigger
    const result = checkDemotionTrigger(0.220, 0.210);
    expect(result).toBe(true);
  });

  it('evaluateDemotionSequence: demotionSignal=true after 10+ consecutive matches', () => {
    // Build 12 consecutive matches where NEXUS is worse by 0.010
    const matches = Array.from({ length: 12 }, () => ({
      nexusRps: 0.220,
      v3Rps: 0.210,
    }));
    const result = evaluateDemotionSequence(matches);

    expect(result.demotionSignal).toBe(true);
    expect(result.consecutiveMatches).toBeGreaterThanOrEqual(10);
  });

  it('DemotionCheckResult.demotionSignal is true with expected rpsDelta', () => {
    const matches = Array.from({ length: 10 }, () => ({
      nexusRps: 0.220,
      v3Rps: 0.210,
    }));
    const result = evaluateDemotionSequence(matches);

    expect(result.demotionSignal).toBe(true);
    expect(result.rpsDelta).toBeGreaterThan(0); // positive = NEXUS worse
  });
});

// ── T-06: Demotion trigger NOT activated ─────────────────────────────────────

describe('T-06: Demotion trigger not activated', () => {
  it('checkDemotionTrigger returns false when within threshold (delta = 0.010, threshold = 0.015)', () => {
    // nexusRps = 0.220, v3Rps = 0.210, delta = 0.010
    // With a custom threshold of 0.015: 0.010 < 0.015 → false
    const result = checkDemotionTrigger(0.220, 0.210, 0.015);
    expect(result).toBe(false);
  });

  it('checkDemotionTrigger returns false when exactly at default threshold (0.005)', () => {
    // delta = exactly 0.005 → NOT > threshold → false
    const result = checkDemotionTrigger(0.215, 0.210);
    expect(result).toBe(false);
  });

  it('evaluateDemotionSequence: demotionSignal=false with only 9 consecutive trigger matches', () => {
    const matches = Array.from({ length: 9 }, () => ({
      nexusRps: 0.220,
      v3Rps: 0.210,
    }));
    const result = evaluateDemotionSequence(matches);
    expect(result.demotionSignal).toBe(false);
  });

  it('evaluateDemotionSequence: demotionSignal=false when run is reset by non-trigger match', () => {
    // 9 trigger matches, 1 non-trigger, 9 more trigger matches → max run = 9 < 10
    const matches = [
      ...Array.from({ length: 9 }, () => ({ nexusRps: 0.220, v3Rps: 0.210 })),
      { nexusRps: 0.205, v3Rps: 0.210 }, // NEXUS wins this one — resets run
      ...Array.from({ length: 9 }, () => ({ nexusRps: 0.220, v3Rps: 0.210 })),
    ];
    const result = evaluateDemotionSequence(matches);
    expect(result.demotionSignal).toBe(false);
  });
});

// ── T-07: Swap state correct after activation ─────────────────────────────────

describe('T-07: Swap state correct after activating NEXUS', () => {
  it('applySwapAction with ACTIVATE_NEXUS → activeModel=nexus, v3InShadow=true, v3DeprecatedAt=null', () => {
    const initial = buildInitialSwapState();
    const action = activate_nexus({ passed: true, failedConditions: [], evidence: {} as any, evaluatedAt: NOW }, NOW);
    const nextState = applySwapAction(initial, action, NOW);

    expect(nextState.activeModel).toBe('nexus');
    expect(nextState.v3InShadow).toBe(true);
    expect(nextState.v3DeprecatedAt).toBeNull();
    expect(nextState.nexusPromotedAt).toBe(NOW);
  });

  it('v3DeprecatedAt remains null after activation', () => {
    const initial = buildInitialSwapState();
    const gateResult: GateResult = {
      passed: true,
      failedConditions: [],
      evidence: {} as any,
      evaluatedAt: NOW,
    };
    const action = activate_nexus(gateResult, NOW);
    const state = applySwapAction(initial, action, NOW);

    expect(state.v3DeprecatedAt).toBeNull();
  });

  it('demotionFired is false in initial swap state after promotion', () => {
    const initial = buildInitialSwapState();
    const action = activate_nexus(
      { passed: true, failedConditions: [], evidence: {} as any, evaluatedAt: NOW },
      NOW,
    );
    const state = applySwapAction(initial, action, NOW);
    expect(state.demotionFired).toBe(false);
  });
});

// ── T-08: Deprecation blocked pre-observation period ──────────────────────────

describe('T-08: Deprecation blocked before observation period completes', () => {
  it('deprecate_v3 returns BLOCKED when < 30 days since promotion', () => {
    // Promoted at NOW, check 10 days later
    const promotedAt = NOW;
    const checkAt = '2026-06-25T10:00:00.000Z'; // 10 days later
    const state = buildActiveSwapState(promotedAt);
    const action = deprecate_v3(state, checkAt);

    expect(action.action).toBe('BLOCKED');
    expect(action.reason).toContain(`${OBSERVATION_PERIOD_DAYS} days`);
  });

  it('deprecate_v3 returns BLOCKED at exactly 29 days (boundary)', () => {
    const promotedAt = '2026-06-01T00:00:00.000Z';
    const checkAt = '2026-06-30T00:00:00.000Z'; // exactly 29 days
    const state = buildActiveSwapState(promotedAt);
    const action = deprecate_v3(state, checkAt);

    expect(action.action).toBe('BLOCKED');
  });

  it('deprecate_v3 reason mentions remaining days', () => {
    const promotedAt = NOW;
    const checkAt = '2026-06-20T10:00:00.000Z'; // 5 days later
    const state = buildActiveSwapState(promotedAt);
    const action = deprecate_v3(state, checkAt);

    expect(action.action).toBe('BLOCKED');
    expect(action.reason).toMatch(/Remaining/i);
  });
});

// ── T-09: Deprecation allowed post-observation period ─────────────────────────

describe('T-09: Deprecation allowed after >= 30 days without demotion', () => {
  it('deprecate_v3 returns DEPRECATE_V3 when >= 30 days and no demotion', () => {
    // Promoted at 2026-05-01, check at 2026-06-15 = 45 days later
    const promotedAt = '2026-05-01T00:00:00.000Z';
    const checkAt = '2026-06-15T00:00:00.000Z';
    const state = buildActiveSwapState(promotedAt);
    const action = deprecate_v3(state, checkAt);

    expect(action.action).toBe('DEPRECATE_V3');
    expect(action.reason).toContain('Observation period complete');
  });

  it('deprecate_v3 returns DEPRECATE_V3 at exactly 30 days', () => {
    const promotedAt = '2026-06-01T00:00:00.000Z';
    const checkAt = '2026-07-01T00:00:00.000Z'; // exactly 30 days
    const state = buildActiveSwapState(promotedAt);
    const action = deprecate_v3(state, checkAt);

    expect(action.action).toBe('DEPRECATE_V3');
  });

  it('state transition applies DEPRECATE_V3: v3DeprecatedAt is set', () => {
    const promotedAt = '2026-05-01T00:00:00.000Z';
    const checkAt = '2026-06-15T00:00:00.000Z';
    const state = buildActiveSwapState(promotedAt);
    const action = deprecate_v3(state, checkAt);
    const nextState = applySwapAction(state, action, checkAt);

    expect(nextState.v3DeprecatedAt).toBe(checkAt);
    expect(nextState.v3InShadow).toBe(false);
  });
});

// ── T-10: live_shadow condition non-substitutable ─────────────────────────────

describe('T-10: live_shadow condition is non-substitutable', () => {
  it('gate fails when live_shadow.n < 100 even if combined passes all other thresholds', () => {
    const input: GateEvaluationInput = {
      ...buildPassingInput(),
      // Combined still >= 600, HWF picks up the rest
      combinedN: 700,
      liveShadowN: 50,   // below the 100 minimum per-league
      hwfN: 650,
      // Per-league live_shadow also below threshold
      leagueSummaries: buildPassingInput().leagueSummaries.map((ls) => ({
        ...ls,
        nLiveShadow: 15,   // well below 100 per league
      })),
    };
    const result = evaluatePromotionGate(input, NOW);

    expect(result.passed).toBe(false);
    expect(result.failedConditions).toContain(GATE_CONDITION.INSUFFICIENT_LIVE_SHADOW);
  });

  it('combined passing does not substitute live_shadow — they are independent', () => {
    // combined RPS is great, but live_shadow has too few samples
    const input: GateEvaluationInput = {
      ...buildPassingInput(),
      combinedNexusRps: 0.185, // excellent
      combinedV3Rps: 0.215,
      liveShadowN: 0,          // zero live shadow data
      hwfN: 700,
      leagueSummaries: buildPassingInput().leagueSummaries.map((ls) => ({
        ...ls,
        nLiveShadow: 0,
      })),
    };
    const result = evaluatePromotionGate(input, NOW);

    // Must fail on live_shadow sample size
    expect(result.failedConditions).toContain(GATE_CONDITION.INSUFFICIENT_LIVE_SHADOW);
    expect(result.passed).toBe(false);
  });
});

// ── T-21: Per-league live_shadow check (not aggregate) — FINDING-004 ─────────
//
// Spec §S6.2: "≥ 100 predictions per production league in the live_shadow slice."
// This is a PER-LEAGUE constraint ONLY. No aggregate check is authorized.
// Gate must fail when one league has < 100 live_shadow even if the aggregate total ≥ 100.

describe('T-21: Gate fails by per-league live_shadow check, not by aggregate total (FINDING-004)', () => {
  it('fails on INSUFFICIENT_LIVE_SHADOW when one league has 80 but total is 230', () => {
    // Liga A: live_shadow n=80 (< 100 threshold)
    // Liga B: live_shadow n=150 (≥ 100)
    // Total: 230 — well above the per-league threshold of 100
    // Expected: gate FAILS because liga A violates the per-league minimum
    const input: GateEvaluationInput = {
      ...buildPassingInput(),
      liveShadowN: 230,
      leagueSummaries: [
        {
          competitionId: 'comp:football-data:PD',
          n: 250,
          nLiveShadow: 80,       // below 100 per-league threshold
          matchdayCount: 12,
          nexusRps: 0.198,
          v3Rps: 0.210,
        },
        {
          competitionId: 'comp:football-data:PL',
          n: 240,
          nLiveShadow: 150,      // above threshold
          matchdayCount: 11,
          nexusRps: 0.201,
          v3Rps: 0.216,
        },
      ],
    };
    const result = evaluatePromotionGate(input, NOW);

    expect(result.passed).toBe(false);
    expect(result.failedConditions).toContain(GATE_CONDITION.INSUFFICIENT_LIVE_SHADOW);
  });

  it('passes live_shadow check when all leagues individually meet ≥ 100', () => {
    // All per-league live_shadow values ≥ 100 — gate should pass live_shadow condition
    const input: GateEvaluationInput = {
      ...buildPassingInput(),
      leagueSummaries: buildPassingInput().leagueSummaries.map((ls) => ({
        ...ls,
        nLiveShadow: 105,   // each league individually meets the 100 threshold
      })),
    };
    const result = evaluatePromotionGate(input, NOW);

    expect(result.failedConditions).not.toContain(GATE_CONDITION.INSUFFICIENT_LIVE_SHADOW);
  });

  it('aggregate total does not substitute individual per-league check: 0+0+300 total fails', () => {
    // Two leagues have 0 live_shadow, one has 300. Total = 300 ≥ 100, but two leagues fail.
    const input: GateEvaluationInput = {
      ...buildPassingInput(),
      liveShadowN: 300,
      leagueSummaries: [
        {
          competitionId: 'comp:football-data:PD',
          n: 250,
          nLiveShadow: 0,    // fails per-league
          matchdayCount: 12,
          nexusRps: 0.198,
          v3Rps: 0.210,
        },
        {
          competitionId: 'comp:football-data:PL',
          n: 240,
          nLiveShadow: 0,    // fails per-league
          matchdayCount: 11,
          nexusRps: 0.201,
          v3Rps: 0.216,
        },
        {
          competitionId: 'comp:football-data:BL1',
          n: 210,
          nLiveShadow: 300,  // passes per-league
          matchdayCount: 10,
          nexusRps: 0.203,
          v3Rps: 0.218,
        },
      ],
    };
    const result = evaluatePromotionGate(input, NOW);

    expect(result.passed).toBe(false);
    expect(result.failedConditions).toContain(GATE_CONDITION.INSUFFICIENT_LIVE_SHADOW);
  });

  it('INSUFFICIENT_LIVE_SHADOW appears exactly once (no duplicate) even when per-league fails', () => {
    // The removed aggregate check could produce a duplicate condition entry. Verify it does not.
    const input: GateEvaluationInput = {
      ...buildPassingInput(),
      liveShadowN: 50,
      leagueSummaries: buildPassingInput().leagueSummaries.map((ls) => ({
        ...ls,
        nLiveShadow: 15,  // well below 100
      })),
    };
    const result = evaluatePromotionGate(input, NOW);

    const liveShadowFailures = result.failedConditions.filter(
      (c) => c === GATE_CONDITION.INSUFFICIENT_LIVE_SHADOW,
    );
    // Must appear exactly once — no duplicate from a spurious aggregate check
    expect(liveShadowFailures).toHaveLength(1);
  });
});

// ── T-11: Gate fails — accuracy regression ────────────────────────────────────

describe('T-11: Gate fails — accuracy regression beyond tolerance', () => {
  it('returns ACCURACY_REGRESSION when accuracy drops more than 2pp', () => {
    const input: GateEvaluationInput = {
      ...buildPassingInput(),
      combinedNexusAccuracy: 0.50,
      combinedV3Accuracy: 0.56,  // delta = -0.06 > 0.02 tolerance
    };
    const result = evaluatePromotionGate(input, NOW);

    expect(result.passed).toBe(false);
    expect(result.failedConditions).toContain(GATE_CONDITION.ACCURACY_REGRESSION);
  });
});

// ── T-12: Gate fails — per-league RPS regression ─────────────────────────────

describe('T-12: Gate fails — per-league RPS regression (one league > +0.005)', () => {
  it('returns PER_LEAGUE_RPS_REGRESSION when one league worsens by more than 0.005', () => {
    const input: GateEvaluationInput = {
      ...buildPassingInput(),
      leagueSummaries: [
        {
          competitionId: 'comp:football-data:PD',
          n: 250,
          nLiveShadow: 120,
          matchdayCount: 12,
          nexusRps: 0.198,
          v3Rps: 0.210,  // NEXUS wins
        },
        {
          competitionId: 'comp:football-data:PL',
          n: 240,
          nLiveShadow: 120,
          matchdayCount: 11,
          nexusRps: 0.201,
          v3Rps: 0.216,  // NEXUS wins
        },
        {
          competitionId: 'comp:football-data:BL1',
          n: 210,
          nLiveShadow: 110,
          matchdayCount: 10,
          nexusRps: 0.225,
          v3Rps: 0.210,  // NEXUS LOSES by 0.015 > 0.005 → regression
        },
      ],
    };
    const result = evaluatePromotionGate(input, NOW);

    expect(result.failedConditions).toContain(GATE_CONDITION.PER_LEAGUE_RPS_REGRESSION);
  });
});

// ── T-13: Gate fails — matchday consistency below 70% ─────────────────────────

describe('T-13: Gate fails — matchday consistency below 70%', () => {
  it('returns MATCHDAY_CONSISTENCY_FAILED when NEXUS wins < 70% of matchdays', () => {
    // 6 of 10 matchdays NEXUS wins = 60% < 70%
    const input: GateEvaluationInput = {
      ...buildPassingInput(),
      matchdaySummaries: Array.from({ length: 10 }, (_, i) => ({
        matchdayId: `MD${i + 1}`,
        nexusRps: i < 6 ? 0.195 : 0.220,  // first 6: NEXUS wins; last 4: V3 wins
        v3Rps: 0.210,
      })),
    };
    const result = evaluatePromotionGate(input, NOW);

    expect(result.failedConditions).toContain(GATE_CONDITION.MATCHDAY_CONSISTENCY_FAILED);
    expect(result.evidence.matchdayConsistencyFraction).toBeCloseTo(0.60, 6);
  });
});

// ── T-14: activate_nexus blocked ─────────────────────────────────────────────

describe('T-14: activate_nexus returns BLOCKED when gate not passed', () => {
  it('BLOCKED when failedConditions is non-empty', () => {
    const failedGate: GateResult = {
      passed: false,
      failedConditions: [GATE_CONDITION.INSUFFICIENT_SAMPLES],
      evidence: {} as any,
      evaluatedAt: NOW,
    };
    const action = activate_nexus(failedGate, NOW);

    expect(action.action).toBe('BLOCKED');
    expect(action.reason).toContain('INSUFFICIENT_SAMPLES');
  });
});

// ── T-15: demotion_check returns DEMOTE_NEXUS ────────────────────────────────

describe('T-15: demotion_check returns DEMOTE_NEXUS when signal fires', () => {
  it('returns DEMOTE_NEXUS action when demotionSignal=true', () => {
    const state = buildActiveSwapState();
    const demotionResult: DemotionCheckResult = {
      demotionSignal: true,
      rpsDelta: 0.012,
      consecutiveMatches: 11,
      threshold: 0.005,
    };
    const action = demotion_check(state, demotionResult, NOW);

    expect(action.action).toBe('DEMOTE_NEXUS');
    expect(action.reason).toContain('11 consecutive');
  });

  it('applySwapAction after DEMOTE_NEXUS → activeModel=v3, v3InShadow=false, demotionFired=true', () => {
    const state = buildActiveSwapState();
    const demotionResult: DemotionCheckResult = {
      demotionSignal: true,
      rpsDelta: 0.010,
      consecutiveMatches: 10,
      threshold: 0.005,
    };
    const action = demotion_check(state, demotionResult, NOW);
    const nextState = applySwapAction(state, action, NOW);

    expect(nextState.activeModel).toBe('v3');
    expect(nextState.v3InShadow).toBe(false);
    expect(nextState.demotionFired).toBe(true);
  });
});

// ── T-16: demotion_check returns NO_ACTION ────────────────────────────────────

describe('T-16: demotion_check returns NO_ACTION when no signal', () => {
  it('returns NO_ACTION when demotionSignal=false', () => {
    const state = buildActiveSwapState();
    const demotionResult: DemotionCheckResult = {
      demotionSignal: false,
      rpsDelta: 0.002,
      threshold: 0.005,
    };
    const action = demotion_check(state, demotionResult, NOW);

    expect(action.action).toBe('NO_ACTION');
  });
});

// ── T-17: Deprecation blocked when demotion fired ────────────────────────────

describe('T-17: Deprecation blocked when demotion was fired', () => {
  it('deprecate_v3 returns BLOCKED when demotionFired=true', () => {
    const promotedAt = '2026-05-01T00:00:00.000Z';
    const checkAt = '2026-06-15T00:00:00.000Z'; // 45 days later — would pass time check
    const state: SwapState = {
      activeModel: 'v3',
      v3InShadow: false,
      nexusPromotedAt: promotedAt,
      v3DeprecatedAt: null,
      demotionFired: true,  // demotion was triggered
    };
    const action = deprecate_v3(state, checkAt);

    expect(action.action).toBe('BLOCKED');
    expect(action.reason).toContain('Demotion');
  });
});

// ── T-18: evaluateDemotionSequence fires on 10+ consecutive ──────────────────

describe('T-18: evaluateDemotionSequence fires on >= 10 consecutive trigger matches', () => {
  it('exactly 10 consecutive → demotionSignal=true', () => {
    const matches = Array.from({ length: 10 }, () => ({
      nexusRps: 0.220,
      v3Rps: 0.210,
    }));
    const result = evaluateDemotionSequence(matches);

    expect(result.demotionSignal).toBe(true);
    expect(result.consecutiveMatches).toBe(10);
  });

  it('15 consecutive → demotionSignal=true, consecutiveMatches=15', () => {
    const matches = Array.from({ length: 15 }, () => ({
      nexusRps: 0.220,
      v3Rps: 0.210,
    }));
    const result = evaluateDemotionSequence(matches);

    expect(result.demotionSignal).toBe(true);
    expect(result.consecutiveMatches).toBe(15);
  });
});

// ── T-19: evaluateDemotionSequence does NOT fire on 9 consecutive ────────────

describe('T-19: evaluateDemotionSequence does NOT fire on exactly 9 consecutive trigger matches', () => {
  it('9 consecutive → demotionSignal=false', () => {
    const matches = Array.from({ length: 9 }, () => ({
      nexusRps: 0.220,
      v3Rps: 0.210,
    }));
    const result = evaluateDemotionSequence(matches);
    expect(result.demotionSignal).toBe(false);
  });
});

// ── T-20: applySwapAction state transitions ───────────────────────────────────

describe('T-20: applySwapAction handles all action types correctly', () => {
  it('NO_ACTION leaves state unchanged', () => {
    const state = buildActiveSwapState();
    const action = { action: 'NO_ACTION' as const, reason: 'test', recommendedAt: NOW };
    const next = applySwapAction(state, action, NOW);

    expect(next).toEqual(state);
  });

  it('BLOCKED leaves state unchanged', () => {
    const state = buildInitialSwapState();
    const action = { action: 'BLOCKED' as const, reason: 'gate failed', recommendedAt: NOW };
    const next = applySwapAction(state, action, NOW);

    expect(next).toEqual(state);
  });

  it('ACTIVATE_NEXUS sets nexusPromotedAt only once (idempotent)', () => {
    const firstPromotion = '2026-05-01T00:00:00.000Z';
    const state: SwapState = {
      activeModel: 'v3',
      v3InShadow: false,
      nexusPromotedAt: firstPromotion,
      v3DeprecatedAt: null,
      demotionFired: false,
    };
    const laterDate = '2026-06-01T00:00:00.000Z';
    const action = { action: 'ACTIVATE_NEXUS' as const, reason: 'test', recommendedAt: laterDate };
    const next = applySwapAction(state, action, laterDate);

    // nexusPromotedAt must not change if already set
    expect(next.nexusPromotedAt).toBe(firstPromotion);
  });

  it('DEPRECATE_V3 sets v3DeprecatedAt and v3InShadow=false', () => {
    const state = buildActiveSwapState('2026-05-01T00:00:00.000Z');
    const deprecateTime = '2026-06-15T00:00:00.000Z';
    const action = { action: 'DEPRECATE_V3' as const, reason: 'test', recommendedAt: deprecateTime };
    const next = applySwapAction(state, action, deprecateTime);

    expect(next.v3DeprecatedAt).toBe(deprecateTime);
    expect(next.v3InShadow).toBe(false);
  });
});
