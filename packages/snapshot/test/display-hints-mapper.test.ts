import { describe, it, expect } from 'vitest';
import type { SignalDTO } from '@sportpulse/signals';
import {
  mapFormChip,
  mapTimeChip,
  mapDisplayHints,
  DISPLAY_RULES_KEY,
  DISPLAY_RULES_VERSION,
  DISPLAY_RULES,
} from '../src/display-hints/display-hints-mapper.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFormSignal(rawPoints: number, matchesUsed = 5): SignalDTO {
  return {
    key: 'FORM_POINTS_LAST_5',
    entityKind: 'TEAM',
    entityId: 'team:test',
    value: rawPoints / (matchesUsed * 3),
    unit: 'points',
    params: { rawPoints, matchesUsed, maxPoints: matchesUsed * 3 },
    quality: { source: 'canonical_derived', missing: false },
  };
}

function makeMissingFormSignal(): SignalDTO {
  return {
    key: 'FORM_POINTS_LAST_5',
    entityKind: 'TEAM',
    entityId: 'team:test',
    value: 0,
    unit: 'points',
    params: { rawPoints: 0, matchesUsed: 0, maxPoints: 0, reason: 'no_finished_matches' },
    quality: { source: 'canonical_derived', missing: true },
  };
}

function makeTimeSignal(hours: number): SignalDTO {
  return {
    key: 'NEXT_MATCH_HOURS',
    entityKind: 'TEAM',
    entityId: 'team:test',
    value: 1 - Math.min(hours / 168, 1),
    unit: 'hours',
    params: { hours, minHours: 0, maxHours: 168 },
    quality: { source: 'canonical_derived', missing: false },
  };
}

function makeMissingTimeSignal(): SignalDTO {
  return {
    key: 'NEXT_MATCH_HOURS',
    entityKind: 'TEAM',
    entityId: 'team:test',
    value: 0,
    unit: 'hours',
    params: { hours: null, reason: 'no_next_match' },
    quality: { source: 'canonical_derived', missing: true },
  };
}

// ─── Form chip ────────────────────────────────────────────────────────────────

describe('mapFormChip', () => {
  it('missing signal → FORM_MISSING chip', () => {
    const chip = mapFormChip([makeMissingFormSignal()]);
    expect(chip.kind).toBe('FORM_MISSING');
    expect(chip.level).toBe('UNKNOWN');
    expect(chip.icon).toBe('⚠️');
  });

  it('no signal → FORM_MISSING chip', () => {
    const chip = mapFormChip([]);
    expect(chip.kind).toBe('FORM_MISSING');
  });

  it('rawPoints 15 → FORM_HOT', () => {
    expect(mapFormChip([makeFormSignal(15)]).kind).toBe('FORM_HOT');
  });

  it('rawPoints 12 → FORM_HOT (boundary)', () => {
    expect(mapFormChip([makeFormSignal(12)]).kind).toBe('FORM_HOT');
  });

  it('rawPoints 11 → FORM_GOOD', () => {
    expect(mapFormChip([makeFormSignal(11)]).kind).toBe('FORM_GOOD');
  });

  it('rawPoints 8 → FORM_GOOD (boundary)', () => {
    expect(mapFormChip([makeFormSignal(8)]).kind).toBe('FORM_GOOD');
  });

  it('rawPoints 7 → FORM_NORMAL', () => {
    expect(mapFormChip([makeFormSignal(7)]).kind).toBe('FORM_NORMAL');
  });

  it('rawPoints 5 → FORM_NORMAL (boundary)', () => {
    expect(mapFormChip([makeFormSignal(5)]).kind).toBe('FORM_NORMAL');
  });

  it('rawPoints 4 → FORM_BAD', () => {
    expect(mapFormChip([makeFormSignal(4)]).kind).toBe('FORM_BAD');
  });

  it('rawPoints 0 → FORM_BAD', () => {
    expect(mapFormChip([makeFormSignal(0)]).kind).toBe('FORM_BAD');
  });

  it('FORM_HOT has correct icon and label', () => {
    const chip = mapFormChip([makeFormSignal(13)]);
    expect(chip.icon).toBe('🔥');
    expect(chip.label).toBe('Picante');
    expect(chip.level).toBe('HOT');
  });

  it('FORM_GOOD has correct icon and label', () => {
    const chip = mapFormChip([makeFormSignal(9)]);
    expect(chip.icon).toBe('✅');
    expect(chip.label).toBe('Viene bien');
    expect(chip.level).toBe('OK');
  });

  it('FORM_NORMAL has correct icon and label', () => {
    const chip = mapFormChip([makeFormSignal(6)]);
    expect(chip.icon).toBe('➖');
    expect(chip.label).toBe('Normal');
    expect(chip.level).toBe('INFO');
  });

  it('FORM_BAD has correct icon and label', () => {
    const chip = mapFormChip([makeFormSignal(2)]);
    expect(chip.icon).toBe('❌');
    expect(chip.label).toBe('Viene mal');
    expect(chip.level).toBe('WARN');
  });
});

// ─── Time chip ────────────────────────────────────────────────────────────────

describe('mapTimeChip', () => {
  it('missing signal → TIME_UNKNOWN chip', () => {
    const chip = mapTimeChip([makeMissingTimeSignal()]);
    expect(chip.kind).toBe('TIME_UNKNOWN');
    expect(chip.level).toBe('UNKNOWN');
    expect(chip.icon).toBe('⚠️');
  });

  it('no signal → TIME_UNKNOWN chip', () => {
    const chip = mapTimeChip([]);
    expect(chip.kind).toBe('TIME_UNKNOWN');
  });

  it('hours <= 0 → TIME_STARTED', () => {
    expect(mapTimeChip([makeTimeSignal(0)]).kind).toBe('TIME_STARTED');
    const chip = mapTimeChip([makeTimeSignal(0)]);
    expect(chip.icon).toBe('⏱️');
    expect(chip.label).toBe('Ya empezó');
    expect(chip.level).toBe('WARN');
  });

  it('hours=6 → TIME_TODAY_HOURS, label uses ceil', () => {
    const chip = mapTimeChip([makeTimeSignal(6)]);
    expect(chip.kind).toBe('TIME_TODAY_HOURS');
    expect(chip.icon).toBe('⏳');
    expect(chip.label).toBe('Hoy · en 6 h');
    expect(chip.level).toBe('HOT');
  });

  it('hours=23.5 → TIME_TODAY_HOURS, ceil applied', () => {
    const chip = mapTimeChip([makeTimeSignal(23.5)]);
    expect(chip.kind).toBe('TIME_TODAY_HOURS');
    expect(chip.label).toBe('Hoy · en 24 h');
  });

  it('hours=24 → TIME_TOMORROW_HOURS', () => {
    const chip = mapTimeChip([makeTimeSignal(24)]);
    expect(chip.kind).toBe('TIME_TOMORROW_HOURS');
    expect(chip.icon).toBe('⏳');
    expect(chip.label).toBe('Mañana · en 24 h');
  });

  it('hours=47.9 → TIME_TOMORROW_HOURS', () => {
    const chip = mapTimeChip([makeTimeSignal(47.9)]);
    expect(chip.kind).toBe('TIME_TOMORROW_HOURS');
    expect(chip.label).toBe('Mañana · en 48 h');
  });

  it('hours=48 → TIME_DAYS', () => {
    const chip = mapTimeChip([makeTimeSignal(48)]);
    expect(chip.kind).toBe('TIME_DAYS');
    expect(chip.icon).toBe('📅');
    expect(chip.label).toBe('En 2 días');
    expect(chip.level).toBe('INFO');
  });

  it('hours=168 → TIME_DAYS (boundary)', () => {
    const chip = mapTimeChip([makeTimeSignal(168)]);
    expect(chip.kind).toBe('TIME_DAYS');
    expect(chip.label).toBe('En 7 días');
  });

  it('hours=200 → TIME_LATER_DAYS', () => {
    const chip = mapTimeChip([makeTimeSignal(200)]);
    expect(chip.kind).toBe('TIME_LATER_DAYS');
    expect(chip.icon).toBe('🗓️');
    expect(chip.label).toBe('En 8 días');
  });
});

// ─── mapDisplayHints ──────────────────────────────────────────────────────────

describe('mapDisplayHints', () => {
  it('always returns formChip and nextMatchChip', () => {
    const hints = mapDisplayHints([makeFormSignal(10), makeTimeSignal(72)]);
    expect(hints.formChip).toBeDefined();
    expect(hints.nextMatchChip).toBeDefined();
  });

  it('returns missing variants when signals absent', () => {
    const hints = mapDisplayHints([]);
    expect(hints.formChip?.kind).toBe('FORM_MISSING');
    expect(hints.nextMatchChip?.kind).toBe('TIME_UNKNOWN');
  });
});

// ─── DisplayRules identity ────────────────────────────────────────────────────

describe('DISPLAY_RULES', () => {
  it('has correct key and version', () => {
    expect(DISPLAY_RULES.displayRulesKey).toBe(DISPLAY_RULES_KEY);
    expect(DISPLAY_RULES.displayRulesVersion).toBe(DISPLAY_RULES_VERSION);
    expect(DISPLAY_RULES_KEY).toBe('sportpulse.display.dummies');
    expect(DISPLAY_RULES_VERSION).toBe(1);
  });
});
