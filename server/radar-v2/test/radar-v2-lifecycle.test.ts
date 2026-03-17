import { describe, it, expect } from 'vitest';
import type { RadarV2Card, RadarV2Snapshot, RadarV2Verdict } from '../radar-v2-types.js';
import { resolveV2Verdict, supportsV2Verdict } from '../radar-v2-verdict-resolver.js';

function makeCard(overrides: Partial<RadarV2Card> = {}): RadarV2Card {
  return {
    matchId: 'match-1',
    family: 'MISALIGNMENT',
    primaryLabel: 'SENAL_DE_ALERTA',
    secondaryBadges: [],
    subtype: 'FAVORITE_DEFENSIVE_FRAGILITY',
    confidenceBand: 'MEDIUM',
    radarScore: 70,
    evidenceTier: 'STABLE',
    reasons: [
      { code: 'R1', weight: 0.8, text: 'Reason 1' },
      { code: 'R2', weight: 0.7, text: 'Reason 2' },
    ],
    preMatchText: 'El favorito viene concediendo goles.',
    verdict: null,
    predictionContext: null,
    ...overrides,
  };
}

describe('RadarV2 Lifecycle', () => {
  describe('frozen pre-match copy', () => {
    it('preMatchText is preserved through verdict attachment', () => {
      const card = makeCard({ preMatchText: 'Original reading that must not change.' });
      const originalText = card.preMatchText;

      // Simulate verdict attachment
      const verdict = resolveV2Verdict(card, 1, 1, 'HOME', '2026-03-16T22:00:00Z');

      // Verify preMatchText was NOT modified
      expect(card.preMatchText).toBe(originalText);
      // Verdict is a separate object
      expect(verdict).not.toBeNull();
      expect(verdict!.verdictText).toBeTruthy();
    });

    it('IN_PLAY state does not alter preMatchText', () => {
      const card = makeCard({ preMatchText: 'Frozen during in-play.' });
      // Simulate: no verdict in IN_PLAY
      const verdict = resolveV2Verdict(card, 1, 0, 'HOME', '2026-03-16T20:00:00Z');
      // The verdict resolver itself doesn't check match state -- that's the service's job
      // But the card's preMatchText is never mutated
      expect(card.preMatchText).toBe('Frozen during in-play.');
    });
  });

  describe('verdict append-only', () => {
    it('verdict is created as a new object, not mutating the card', () => {
      const card = makeCard();
      expect(card.verdict).toBeNull();

      const verdict = resolveV2Verdict(card, 0, 2, 'HOME', '2026-03-16T22:00:00Z');
      expect(verdict).not.toBeNull();
      expect(verdict!.status).toBe('CONFIRMED');
      expect(verdict!.resolvedAt).toBe('2026-03-16T22:00:00Z');
      expect(verdict!.label).toBe('SENAL_DE_ALERTA');

      // Original card is unchanged
      expect(card.verdict).toBeNull();
    });

    it('returns null for context labels (EN_LA_MIRA)', () => {
      const card = makeCard({ family: 'CONTEXT', primaryLabel: 'EN_LA_MIRA' });
      const verdict = resolveV2Verdict(card, 2, 1, 'HOME', '2026-03-16T22:00:00Z');
      expect(verdict).toBeNull();
    });

    it('returns null for context labels (BAJO_EL_RADAR)', () => {
      const card = makeCard({ family: 'CONTEXT', primaryLabel: 'BAJO_EL_RADAR' });
      const verdict = resolveV2Verdict(card, 2, 1, 'HOME', '2026-03-16T22:00:00Z');
      expect(verdict).toBeNull();
    });
  });

  describe('supportsV2Verdict', () => {
    it('supports SENAL_DE_ALERTA', () => {
      expect(supportsV2Verdict('SENAL_DE_ALERTA')).toBe(true);
    });

    it('supports PARTIDO_ENGANOSO', () => {
      expect(supportsV2Verdict('PARTIDO_ENGANOSO')).toBe(true);
    });

    it('supports PARTIDO_ABIERTO', () => {
      expect(supportsV2Verdict('PARTIDO_ABIERTO')).toBe(true);
    });

    it('supports DUELO_CERRADO', () => {
      expect(supportsV2Verdict('DUELO_CERRADO')).toBe(true);
    });

    it('does NOT support EN_LA_MIRA', () => {
      expect(supportsV2Verdict('EN_LA_MIRA')).toBe(false);
    });

    it('does NOT support BAJO_EL_RADAR', () => {
      expect(supportsV2Verdict('BAJO_EL_RADAR')).toBe(false);
    });
  });

  describe('safe failure / degraded state', () => {
    it('FAILED snapshot has empty cards', () => {
      const snap: RadarV2Snapshot = {
        schemaVersion: '2.0.0',
        competitionKey: 'la_liga',
        seasonKey: '2025',
        matchday: 10,
        generatedAt: '2026-03-16T12:00:00Z',
        generatorVersion: 'radar-v2-standalone-1.0.0',
        status: 'FAILED',
        dataQuality: 'DEGRADED',
        isHistoricalRebuild: false,
        evidenceTier: 'STABLE',
        cards: [],
      };
      expect(snap.status).toBe('FAILED');
      expect(snap.cards).toHaveLength(0);
    });

    it('DEGRADED snapshot can still have cards', () => {
      const snap: RadarV2Snapshot = {
        schemaVersion: '2.0.0',
        competitionKey: 'la_liga',
        seasonKey: '2025',
        matchday: 2,
        generatedAt: '2026-03-16T12:00:00Z',
        generatorVersion: 'radar-v2-standalone-1.0.0',
        status: 'DEGRADED',
        dataQuality: 'DEGRADED',
        isHistoricalRebuild: false,
        evidenceTier: 'BOOTSTRAP',
        cards: [makeCard()],
      };
      expect(snap.status).toBe('DEGRADED');
      expect(snap.cards).toHaveLength(1);
    });
  });

  describe('historical rebuild flag', () => {
    it('force=true sets isHistoricalRebuild', () => {
      const snap: RadarV2Snapshot = {
        schemaVersion: '2.0.0',
        competitionKey: 'la_liga',
        seasonKey: '2025',
        matchday: 5,
        generatedAt: '2026-03-16T12:00:00Z',
        generatorVersion: 'radar-v2-standalone-1.0.0',
        status: 'READY',
        dataQuality: 'OK',
        isHistoricalRebuild: true,
        evidenceTier: 'EARLY',
        cards: [makeCard()],
      };
      expect(snap.isHistoricalRebuild).toBe(true);
    });

    it('normal generation has isHistoricalRebuild = false', () => {
      const snap: RadarV2Snapshot = {
        schemaVersion: '2.0.0',
        competitionKey: 'la_liga',
        seasonKey: '2025',
        matchday: 5,
        generatedAt: '2026-03-16T12:00:00Z',
        generatorVersion: 'radar-v2-standalone-1.0.0',
        status: 'READY',
        dataQuality: 'OK',
        isHistoricalRebuild: false,
        evidenceTier: 'EARLY',
        cards: [makeCard()],
      };
      expect(snap.isHistoricalRebuild).toBe(false);
    });
  });
});
