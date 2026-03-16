import { describe, it, expect } from 'vitest';
import {
  isValidFamilyLabel,
  VALID_FAMILY_LABELS,
  LABEL_TO_FAMILY,
} from '../radar-v2-types.js';

describe('RadarV2 Types', () => {
  describe('isValidFamilyLabel', () => {
    // All valid combinations
    const VALID: [string, string][] = [
      ['CONTEXT', 'EN_LA_MIRA'],
      ['CONTEXT', 'BAJO_EL_RADAR'],
      ['DYNAMICS', 'PARTIDO_ABIERTO'],
      ['DYNAMICS', 'DUELO_CERRADO'],
      ['MISALIGNMENT', 'SENAL_DE_ALERTA'],
      ['MISALIGNMENT', 'PARTIDO_ENGANOSO'],
    ];

    for (const [family, label] of VALID) {
      it(`accepts ${family} + ${label}`, () => {
        expect(isValidFamilyLabel(family, label)).toBe(true);
      });
    }

    // Invalid combinations
    const INVALID: [string, string][] = [
      ['CONTEXT', 'PARTIDO_ABIERTO'],
      ['CONTEXT', 'DUELO_CERRADO'],
      ['CONTEXT', 'SENAL_DE_ALERTA'],
      ['CONTEXT', 'PARTIDO_ENGANOSO'],
      ['DYNAMICS', 'EN_LA_MIRA'],
      ['DYNAMICS', 'BAJO_EL_RADAR'],
      ['DYNAMICS', 'SENAL_DE_ALERTA'],
      ['DYNAMICS', 'PARTIDO_ENGANOSO'],
      ['MISALIGNMENT', 'EN_LA_MIRA'],
      ['MISALIGNMENT', 'BAJO_EL_RADAR'],
      ['MISALIGNMENT', 'PARTIDO_ABIERTO'],
      ['MISALIGNMENT', 'DUELO_CERRADO'],
    ];

    for (const [family, label] of INVALID) {
      it(`rejects ${family} + ${label}`, () => {
        expect(isValidFamilyLabel(family, label)).toBe(false);
      });
    }

    it('rejects invalid family', () => {
      expect(isValidFamilyLabel('BOGUS', 'EN_LA_MIRA')).toBe(false);
    });
  });

  describe('LABEL_TO_FAMILY consistency', () => {
    it('every label maps to a family that contains it', () => {
      for (const [label, family] of Object.entries(LABEL_TO_FAMILY)) {
        const allowed = VALID_FAMILY_LABELS[family];
        expect(allowed).toContain(label);
      }
    });

    it('every family label appears in LABEL_TO_FAMILY', () => {
      for (const [family, labels] of Object.entries(VALID_FAMILY_LABELS)) {
        for (const label of labels) {
          expect(LABEL_TO_FAMILY[label]).toBe(family);
        }
      }
    });
  });
});
