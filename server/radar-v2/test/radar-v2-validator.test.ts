import { describe, it, expect } from 'vitest';
import { validateSnapshot, canAttachVerdict, isRenderSafe } from '../radar-v2-validator.js';
import type { RadarV2Snapshot, RadarV2Card } from '../radar-v2-types.js';

function makeCard(overrides: Partial<RadarV2Card> = {}): RadarV2Card {
  return {
    matchId: 'match-1',
    family: 'CONTEXT',
    primaryLabel: 'EN_LA_MIRA',
    secondaryBadges: [],
    subtype: 'TOP_CONTEXT',
    confidenceBand: 'MEDIUM',
    radarScore: 70,
    evidenceTier: 'STABLE',
    reasons: [
      { code: 'R1', weight: 0.8, text: 'Reason 1' },
      { code: 'R2', weight: 0.7, text: 'Reason 2' },
    ],
    preMatchText: 'Tiene peso dentro de la fecha.',
    verdict: null,
    predictionContext: null,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<RadarV2Snapshot> = {}): RadarV2Snapshot {
  return {
    schemaVersion: '2.0.0',
    competitionKey: 'la_liga',
    seasonKey: '2025',
    matchday: 10,
    generatedAt: '2026-03-16T12:00:00Z',
    generatorVersion: 'radar-v2-standalone-1.0.0',
    status: 'READY',
    dataQuality: 'OK',
    isHistoricalRebuild: false,
    evidenceTier: 'STABLE',
    cards: [makeCard()],
    ...overrides,
  };
}

describe('RadarV2 Validator', () => {
  describe('scope isolation', () => {
    it('rejects missing competitionKey', () => {
      const snap = makeSnapshot({ competitionKey: '' });
      const errors = validateSnapshot(snap);
      expect(errors.some((e) => e.code === 'MISSING_SCOPE')).toBe(true);
    });

    it('rejects missing seasonKey', () => {
      const snap = makeSnapshot({ seasonKey: '' });
      const errors = validateSnapshot(snap);
      expect(errors.some((e) => e.code === 'MISSING_SCOPE')).toBe(true);
    });

    it('rejects missing matchday', () => {
      const snap = makeSnapshot({ matchday: '' });
      const errors = validateSnapshot(snap);
      expect(errors.some((e) => e.code === 'MISSING_SCOPE')).toBe(true);
    });

    it('accepts valid scope', () => {
      const snap = makeSnapshot();
      const errors = validateSnapshot(snap);
      expect(errors).toHaveLength(0);
    });
  });

  describe('empty valid scope (0 cards)', () => {
    it('accepts snapshot with 0 cards', () => {
      const snap = makeSnapshot({ cards: [], status: 'EMPTY' });
      const errors = validateSnapshot(snap);
      expect(errors).toHaveLength(0);
    });
  });

  describe('max 3 cards enforced', () => {
    it('rejects > 3 cards', () => {
      const cards = [
        makeCard({ matchId: 'a' }),
        makeCard({ matchId: 'b' }),
        makeCard({ matchId: 'c' }),
        makeCard({ matchId: 'd' }),
      ];
      const snap = makeSnapshot({ cards });
      const errors = validateSnapshot(snap);
      expect(errors.some((e) => e.code === 'MAX_CARDS_EXCEEDED')).toBe(true);
    });

    it('accepts exactly 3 cards', () => {
      const cards = [
        makeCard({ matchId: 'a' }),
        makeCard({ matchId: 'b' }),
        makeCard({ matchId: 'c' }),
      ];
      const snap = makeSnapshot({ cards });
      const errors = validateSnapshot(snap);
      expect(errors).toHaveLength(0);
    });
  });

  describe('duplicate matchId rejected', () => {
    it('rejects duplicate matchId', () => {
      const cards = [
        makeCard({ matchId: 'same' }),
        makeCard({ matchId: 'same' }),
      ];
      const snap = makeSnapshot({ cards });
      const errors = validateSnapshot(snap);
      expect(errors.some((e) => e.code === 'DUPLICATE_MATCH_ID')).toBe(true);
    });
  });

  describe('primaryLabel missing', () => {
    it('rejects card without primaryLabel', () => {
      const snap = makeSnapshot({
        cards: [makeCard({ primaryLabel: '' as any })],
      });
      const errors = validateSnapshot(snap);
      expect(errors.some((e) => e.code === 'MISSING_PRIMARY_LABEL')).toBe(true);
    });
  });

  describe('preMatchText empty', () => {
    it('rejects card with empty preMatchText', () => {
      const snap = makeSnapshot({
        cards: [makeCard({ preMatchText: '' })],
      });
      const errors = validateSnapshot(snap);
      expect(errors.some((e) => e.code === 'EMPTY_PRE_MATCH_TEXT')).toBe(true);
    });

    it('rejects card with whitespace-only preMatchText', () => {
      const snap = makeSnapshot({
        cards: [makeCard({ preMatchText: '   ' })],
      });
      const errors = validateSnapshot(snap);
      expect(errors.some((e) => e.code === 'EMPTY_PRE_MATCH_TEXT')).toBe(true);
    });
  });

  describe('invalid family', () => {
    it('rejects invalid family', () => {
      const snap = makeSnapshot({
        cards: [makeCard({ family: 'INVALID' as any })],
      });
      const errors = validateSnapshot(snap);
      expect(errors.some((e) => e.code === 'INVALID_FAMILY')).toBe(true);
    });
  });

  describe('invalid family/label combinations', () => {
    it('rejects CONTEXT + SENAL_DE_ALERTA', () => {
      const snap = makeSnapshot({
        cards: [makeCard({ family: 'CONTEXT', primaryLabel: 'SENAL_DE_ALERTA' })],
      });
      const errors = validateSnapshot(snap);
      expect(errors.some((e) => e.code === 'INVALID_FAMILY_LABEL')).toBe(true);
    });

    it('rejects DYNAMICS + EN_LA_MIRA', () => {
      const snap = makeSnapshot({
        cards: [makeCard({ family: 'DYNAMICS', primaryLabel: 'EN_LA_MIRA' })],
      });
      const errors = validateSnapshot(snap);
      expect(errors.some((e) => e.code === 'INVALID_FAMILY_LABEL')).toBe(true);
    });

    it('rejects MISALIGNMENT + PARTIDO_ABIERTO', () => {
      const snap = makeSnapshot({
        cards: [makeCard({ family: 'MISALIGNMENT', primaryLabel: 'PARTIDO_ABIERTO' })],
      });
      const errors = validateSnapshot(snap);
      expect(errors.some((e) => e.code === 'INVALID_FAMILY_LABEL')).toBe(true);
    });

    it('accepts CONTEXT + EN_LA_MIRA', () => {
      const snap = makeSnapshot({
        cards: [makeCard({ family: 'CONTEXT', primaryLabel: 'EN_LA_MIRA' })],
      });
      const errors = validateSnapshot(snap);
      expect(errors).toHaveLength(0);
    });

    it('accepts DYNAMICS + PARTIDO_ABIERTO', () => {
      const snap = makeSnapshot({
        cards: [makeCard({ family: 'DYNAMICS', primaryLabel: 'PARTIDO_ABIERTO' })],
      });
      const errors = validateSnapshot(snap);
      expect(errors).toHaveLength(0);
    });

    it('accepts MISALIGNMENT + SENAL_DE_ALERTA', () => {
      const snap = makeSnapshot({
        cards: [makeCard({ family: 'MISALIGNMENT', primaryLabel: 'SENAL_DE_ALERTA' })],
      });
      const errors = validateSnapshot(snap);
      expect(errors).toHaveLength(0);
    });

    it('accepts MISALIGNMENT + PARTIDO_ENGANOSO', () => {
      const snap = makeSnapshot({
        cards: [makeCard({ family: 'MISALIGNMENT', primaryLabel: 'PARTIDO_ENGANOSO' })],
      });
      const errors = validateSnapshot(snap);
      expect(errors).toHaveLength(0);
    });
  });

  describe('verdict before final state', () => {
    it('canAttachVerdict returns true only for FINISHED', () => {
      expect(canAttachVerdict('FINISHED')).toBe(true);
      expect(canAttachVerdict('SCHEDULED')).toBe(false);
      expect(canAttachVerdict('IN_PROGRESS')).toBe(false);
    });
  });

  describe('historical rebuild flag', () => {
    it('accepts isHistoricalRebuild = true', () => {
      const snap = makeSnapshot({ isHistoricalRebuild: true });
      const errors = validateSnapshot(snap);
      expect(errors).toHaveLength(0);
    });

    it('accepts isHistoricalRebuild = false', () => {
      const snap = makeSnapshot({ isHistoricalRebuild: false });
      const errors = validateSnapshot(snap);
      expect(errors).toHaveLength(0);
    });
  });

  describe('isRenderSafe', () => {
    it('returns false for FAILED status', () => {
      const snap = makeSnapshot({ status: 'FAILED', cards: [] });
      expect(isRenderSafe(snap)).toBe(false);
    });

    it('returns true for valid READY snapshot', () => {
      const snap = makeSnapshot();
      expect(isRenderSafe(snap)).toBe(true);
    });

    it('returns false for snapshot with validation errors', () => {
      const snap = makeSnapshot({
        cards: [makeCard({ family: 'INVALID' as any })],
      });
      expect(isRenderSafe(snap)).toBe(false);
    });
  });
});
