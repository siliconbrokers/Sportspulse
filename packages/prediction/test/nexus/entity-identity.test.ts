/**
 * NEXUS Entity Identity and Resolution — Unit Tests
 *
 * Spec authority: entity-identity S3, S5, S7, S8, S9, S10
 *
 * Test coverage:
 * - RESOLVED: player with single match in externalIds → RESOLVED, featureEligible = true
 * - UNRESOLVED: player not found in registry → UNRESOLVED, featureEligible = false
 * - PARTIAL: player registered from a single provider → PARTIAL, featureEligible = true
 * - CONFLICTED: registered with CONFLICTED state → featureEligible = false
 * - BaselineSquad: squad={A,B,C}, absences={B} → effective = {A,C}
 * - BaselineSquad with lineup: squad={A,B,C}, absences={B}, lineup={A,D,E} → {A,D,E}
 * - Name normalization: deterministic, diacritics stripped, suffixes removed
 * - featureEligible is false for UNRESOLVED and CONFLICTED
 */

import { describe, it, expect } from 'vitest';
import {
  EntityResolver,
  normalizeName,
  toPositionGroup,
  buildExternalIds,
} from '../../src/nexus/entity-identity/resolver.js';
import {
  computeEffectiveSquad,
  DOUBT_WEIGHT,
  INTERIM_TACTICAL_CONFIDENCE_THRESHOLD,
} from '../../src/nexus/entity-identity/types.js';
import type {
  CanonicalPlayer,
  BaselineSquad,
  ResolutionState,
} from '../../src/nexus/entity-identity/types.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makePlayer(
  id: string,
  resolution: ResolutionState,
  externalIds: Record<string, string> = {},
): CanonicalPlayer {
  return {
    canonicalPlayerId: id,
    resolution,
    externalIds,
    displayName: 'Test Player',
    normalizedName: 'test player',
    dateOfBirth: '1995-06-15',
    primaryPosition: 'CM',
    secondaryPosition: null,
    nationality: 'ESP',
  };
}

// ── resolvePlayer — RESOLVED state ────────────────────────────────────────

describe('resolvePlayer — RESOLVED', () => {
  it('returns RESOLVED player with featureEligible = true', () => {
    const resolver = new EntityResolver();
    const player = makePlayer(
      'player:canonical:a1b2c3d4',
      'RESOLVED',
      { af: '874', sofascore: '24629' },
    );
    resolver.registerPlayer(player);

    const result = resolver.resolvePlayer('874', 'api-football');

    expect(result.player.resolution).toBe('RESOLVED');
    expect(result.featureEligible).toBe(true);
    expect(result.player.canonicalPlayerId).toBe('player:canonical:a1b2c3d4');
  });

  it('maps both provider IDs to the same canonical entity', () => {
    const resolver = new EntityResolver();
    const player = makePlayer(
      'player:canonical:a1b2c3d4',
      'RESOLVED',
      { af: '874', sofascore: '24629' },
    );
    resolver.registerPlayer(player);

    const resultViaAf = resolver.resolvePlayer('874', 'api-football');
    const resultViaSofascore = resolver.resolvePlayer('24629', 'sofascore');

    expect(resultViaAf.player.canonicalPlayerId).toBe('player:canonical:a1b2c3d4');
    expect(resultViaSofascore.player.canonicalPlayerId).toBe('player:canonical:a1b2c3d4');
  });

  it('matchTier is 1 for RESOLVED players', () => {
    const resolver = new EntityResolver();
    const player = makePlayer('player:canonical:a1b2c3d4', 'RESOLVED', { af: '874' });
    resolver.registerPlayer(player);

    const result = resolver.resolvePlayer('874', 'api-football');
    expect(result.matchTier).toBe(1);
  });
});

// ── resolvePlayer — PARTIAL state ────────────────────────────────────────

describe('resolvePlayer — PARTIAL', () => {
  it('returns PARTIAL player with featureEligible = true', () => {
    // PARTIAL = single-provider, no contradictions, still feature-eligible (S7.1, S9.1)
    const resolver = new EntityResolver();
    const player = makePlayer('player:af:12345', 'PARTIAL', { af: '12345' });
    resolver.registerPlayer(player);

    const result = resolver.resolvePlayer('12345', 'api-football');

    expect(result.player.resolution).toBe('PARTIAL');
    expect(result.featureEligible).toBe(true);
  });
});

// ── resolvePlayer — UNRESOLVED state ─────────────────────────────────────

describe('resolvePlayer — UNRESOLVED', () => {
  it('returns UNRESOLVED when player not found in registry', () => {
    // This is the spec requirement: "player not found → UNRESOLVED"
    const resolver = new EntityResolver();

    const result = resolver.resolvePlayer('unknown-provider-id', 'api-football');

    expect(result.player.resolution).toBe('UNRESOLVED');
    expect(result.featureEligible).toBe(false);
  });

  it('UNRESOLVED canonical ID follows format player:{source}:{id}', () => {
    const resolver = new EntityResolver();
    const result = resolver.resolvePlayer('99999', 'api-football');

    expect(result.player.canonicalPlayerId).toBe('player:af:99999');
  });

  it('featureEligible is false for UNRESOLVED (S9.1)', () => {
    const resolver = new EntityResolver();
    const result = resolver.resolvePlayer('does-not-exist', 'api-football');
    expect(result.featureEligible).toBe(false);
  });

  it('matchTier is NONE for UNRESOLVED', () => {
    const resolver = new EntityResolver();
    const result = resolver.resolvePlayer('not-registered', 'sofascore');
    expect(result.matchTier).toBe('NONE');
  });
});

// ── resolvePlayer — CONFLICTED state ─────────────────────────────────────

describe('resolvePlayer — CONFLICTED', () => {
  it('returns CONFLICTED player with featureEligible = false (S9.1)', () => {
    const resolver = new EntityResolver();
    const player = makePlayer('player:af:55555', 'CONFLICTED', { af: '55555' });
    resolver.registerPlayer(player);

    const result = resolver.resolvePlayer('55555', 'api-football');

    expect(result.player.resolution).toBe('CONFLICTED');
    expect(result.featureEligible).toBe(false);
  });
});

// ── BaselineSquad — computeEffectiveSquad ────────────────────────────────

describe('computeEffectiveSquad', () => {
  const playerA = makePlayer('player:canonical:aaa', 'RESOLVED', { af: '1' });
  const playerB = makePlayer('player:canonical:bbb', 'RESOLVED', { af: '2' });
  const playerC = makePlayer('player:canonical:ccc', 'RESOLVED', { af: '3' });
  const playerD = makePlayer('player:canonical:ddd', 'RESOLVED', { af: '4' });
  const playerE = makePlayer('player:canonical:eee', 'RESOLVED', { af: '5' });

  it('squad={A,B,C} absences={B} → effective squad={A,C}', () => {
    const squad: BaselineSquad = {
      teamId: 'team:test:001',
      baselinePlayers: [playerA, playerB, playerC],
      confirmedAbsences: [playerB],
      confirmedLineup: null,
    };

    const effective = computeEffectiveSquad(squad);

    expect(effective).toHaveLength(2);
    const ids = effective.map((p) => p.canonicalPlayerId);
    expect(ids).toContain('player:canonical:aaa');
    expect(ids).toContain('player:canonical:ccc');
    expect(ids).not.toContain('player:canonical:bbb');
  });

  it('squad={A,B,C} absences={} → effective squad={A,B,C}', () => {
    const squad: BaselineSquad = {
      teamId: 'team:test:001',
      baselinePlayers: [playerA, playerB, playerC],
      confirmedAbsences: [],
      confirmedLineup: null,
    };

    const effective = computeEffectiveSquad(squad);
    expect(effective).toHaveLength(3);
  });

  it('with confirmed lineup: lineup supersedes baseline minus absences (S8.3)', () => {
    // spec: effective_squad = baseline_players - absences + lineup (if available)
    // When lineup is present, it is used directly (supersedes the subtraction)
    const squad: BaselineSquad = {
      teamId: 'team:test:001',
      baselinePlayers: [playerA, playerB, playerC],
      confirmedAbsences: [playerB],
      confirmedLineup: [playerA, playerD, playerE],
    };

    const effective = computeEffectiveSquad(squad);

    expect(effective).toHaveLength(3);
    const ids = effective.map((p) => p.canonicalPlayerId);
    expect(ids).toContain('player:canonical:aaa');
    expect(ids).toContain('player:canonical:ddd');
    expect(ids).toContain('player:canonical:eee');
    // playerB was absent but lineup supersedes — lineup is the ground truth
    expect(ids).not.toContain('player:canonical:bbb');
    // playerC not in lineup — excluded even though not in absences
    expect(ids).not.toContain('player:canonical:ccc');
  });

  it('squad={A,B,C} absences={B} lineup={A,D,E} → {A,D,E}', () => {
    // Explicit test case from task requirements
    const squad: BaselineSquad = {
      teamId: 'team:test:001',
      baselinePlayers: [playerA, playerB, playerC],
      confirmedAbsences: [playerB],
      confirmedLineup: [playerA, playerD, playerE],
    };

    const effective = computeEffectiveSquad(squad);

    expect(effective).toHaveLength(3);
    const ids = effective.map((p) => p.canonicalPlayerId);
    expect(ids).toContain('player:canonical:aaa'); // A
    expect(ids).toContain('player:canonical:ddd'); // D
    expect(ids).toContain('player:canonical:eee'); // E
  });

  it('null confirmed lineup → uses baseline minus absences', () => {
    const squad: BaselineSquad = {
      teamId: 'team:test:001',
      baselinePlayers: [playerA, playerB, playerC],
      confirmedAbsences: [playerC],
      confirmedLineup: null, // not available yet
    };

    const effective = computeEffectiveSquad(squad);

    expect(effective).toHaveLength(2);
    const ids = effective.map((p) => p.canonicalPlayerId);
    expect(ids).toContain('player:canonical:aaa');
    expect(ids).toContain('player:canonical:bbb');
    expect(ids).not.toContain('player:canonical:ccc');
  });

  it('empty baseline squad with no absences → empty effective squad', () => {
    const squad: BaselineSquad = {
      teamId: 'team:test:001',
      baselinePlayers: [],
      confirmedAbsences: [],
      confirmedLineup: null,
    };
    expect(computeEffectiveSquad(squad)).toHaveLength(0);
  });
});

// ── Name normalization (S4.3, S10.6) ─────────────────────────────────────

describe('normalizeName', () => {
  it('converts to lowercase', () => {
    expect(normalizeName('Vinicius Junior')).toBe('vinicius junior');
  });

  it('strips diacritical marks (NFD normalization)', () => {
    expect(normalizeName('Müller')).toBe('muller');
    expect(normalizeName('Rodríguez')).toBe('rodriguez');
    expect(normalizeName('Çelik')).toBe('celik');
  });

  it('removes "Jr." suffix', () => {
    expect(normalizeName('Vinicius Jr.')).toBe('vinicius');
  });

  it('collapses multiple spaces', () => {
    expect(normalizeName('De  Bruyne')).toBe('de bruyne');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeName('  Messi  ')).toBe('messi');
  });

  it('is deterministic: same input always produces same output (S10.6)', () => {
    const input = 'Rodrygo Silva de Goes';
    expect(normalizeName(input)).toBe(normalizeName(input));
    expect(normalizeName(input)).toBe('rodrygo silva de goes');
  });

  it('handles empty string', () => {
    expect(normalizeName('')).toBe('');
  });

  it('handles already-normalized string without change', () => {
    expect(normalizeName('messi')).toBe('messi');
  });
});

// ── toPositionGroup ───────────────────────────────────────────────────────

describe('toPositionGroup', () => {
  it('maps GK → GK', () => {
    expect(toPositionGroup('GK')).toBe('GK');
  });

  it('maps CB/LB/RB → DEF', () => {
    expect(toPositionGroup('CB')).toBe('DEF');
    expect(toPositionGroup('LB')).toBe('DEF');
    expect(toPositionGroup('RB')).toBe('DEF');
  });

  it('maps CM/CDM/CAM → MID', () => {
    expect(toPositionGroup('CM')).toBe('MID');
    expect(toPositionGroup('CDM')).toBe('MID');
    expect(toPositionGroup('CAM')).toBe('MID');
  });

  it('maps ST/CF/LW/RW → FWD', () => {
    expect(toPositionGroup('ST')).toBe('FWD');
    expect(toPositionGroup('CF')).toBe('FWD');
    expect(toPositionGroup('LW')).toBe('FWD');
    expect(toPositionGroup('RW')).toBe('FWD');
  });

  it('returns null for null input', () => {
    expect(toPositionGroup(null)).toBeNull();
    expect(toPositionGroup(undefined)).toBeNull();
  });

  it('returns null for unknown position string', () => {
    expect(toPositionGroup('UNKNOWN_POS')).toBeNull();
  });
});

// ── Feature eligibility rules ─────────────────────────────────────────────

describe('feature eligibility by resolution state', () => {
  it('RESOLVED → featureEligible = true', () => {
    const resolver = new EntityResolver();
    const p = makePlayer('player:canonical:111', 'RESOLVED', { af: '111' });
    resolver.registerPlayer(p);
    expect(resolver.resolvePlayer('111', 'api-football').featureEligible).toBe(true);
  });

  it('PARTIAL → featureEligible = true', () => {
    const resolver = new EntityResolver();
    const p = makePlayer('player:af:222', 'PARTIAL', { af: '222' });
    resolver.registerPlayer(p);
    expect(resolver.resolvePlayer('222', 'api-football').featureEligible).toBe(true);
  });

  it('UNRESOLVED → featureEligible = false (S9.1)', () => {
    const resolver = new EntityResolver();
    expect(resolver.resolvePlayer('not-registered', 'api-football').featureEligible).toBe(false);
  });

  it('CONFLICTED → featureEligible = false (S9.1)', () => {
    const resolver = new EntityResolver();
    const p = makePlayer('player:af:333', 'CONFLICTED', { af: '333' });
    resolver.registerPlayer(p);
    expect(resolver.resolvePlayer('333', 'api-football').featureEligible).toBe(false);
  });
});

// ── Constants ─────────────────────────────────────────────────────────────

describe('entity identity constants', () => {
  it('DOUBT_WEIGHT is 0.5 per spec S8.3', () => {
    expect(DOUBT_WEIGHT).toBe(0.5);
  });

  it('INTERIM_TACTICAL_CONFIDENCE_THRESHOLD is 3 per spec S6.3', () => {
    expect(INTERIM_TACTICAL_CONFIDENCE_THRESHOLD).toBe(3);
  });
});

// ── buildExternalIds ──────────────────────────────────────────────────────

describe('buildExternalIds', () => {
  it('includes only non-superseded entries', () => {
    const entries = [
      { source: 'api-football' as const, providerId: '874', superseded: false },
      { source: 'sofascore' as const, providerId: 'OLD-24629', superseded: true, supersededAt: '2025-01-01T00:00:00Z', supersededReason: 'corrected' },
      { source: 'sofascore' as const, providerId: '24629', superseded: false },
    ];

    const result = buildExternalIds(entries);

    expect(result['af']).toBe('874');
    expect(result['sofascore']).toBe('24629');
    // The superseded old entry must not appear
    const values = Object.values(result);
    expect(values).not.toContain('OLD-24629');
  });
});

// ── State change log ──────────────────────────────────────────────────────

describe('state change log (S7.2, S10.5)', () => {
  it('logs state change when a player is re-registered with different resolution', () => {
    const resolver = new EntityResolver();

    // Register the same canonical ID first as PARTIAL, then as RESOLVED
    // The resolver must detect the state change and log it (S7.2, S10.5)
    const partial = makePlayer('player:af:777', 'PARTIAL', { af: '777' });
    resolver.registerPlayer(partial);

    const resolved = makePlayer('player:af:777', 'RESOLVED', { af: '777', sofascore: '9999' });
    resolver.registerPlayer(resolved);

    const log = resolver.getStateChangeLog();
    expect(log.length).toBeGreaterThan(0);
    expect(log[0]?.entityId).toBe('player:af:777');
    expect(log[0]?.oldState).toBe('PARTIAL');
    expect(log[0]?.newState).toBe('RESOLVED');
  });

  it('returns empty log for a new resolver with no changes', () => {
    const resolver = new EntityResolver();
    expect(resolver.getStateChangeLog()).toHaveLength(0);
  });
});

// ── resolveCoach ─────────────────────────────────────────────────────────

describe('resolveCoach', () => {
  it('returns UNRESOLVED coach with featureEligible = false when not registered', () => {
    const resolver = new EntityResolver();
    const result = resolver.resolveCoach('99999', 'api-football');

    expect(result.coach.resolution).toBe('UNRESOLVED');
    expect(result.featureEligible).toBe(false);
    expect(result.coach.canonicalCoachId).toBe('coach:af:99999');
  });
});
