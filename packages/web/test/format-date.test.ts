import { describe, it, expect } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatLocalDate,
  isSpanishTimezone,
} from '../src/utils/format-date.js';

describe('isSpanishTimezone', () => {
  it('detects America/Montevideo', () => {
    expect(isSpanishTimezone('America/Montevideo')).toBe(true);
  });

  it('detects Europe/Madrid', () => {
    expect(isSpanishTimezone('Europe/Madrid')).toBe(true);
  });

  it('detects America/Argentina/Buenos_Aires', () => {
    expect(isSpanishTimezone('America/Argentina/Buenos_Aires')).toBe(true);
  });

  it('detects America/Mexico_City as prefix match', () => {
    expect(isSpanishTimezone('America/Mexico_City')).toBe(true);
  });

  it('rejects Europe/London', () => {
    expect(isSpanishTimezone('Europe/London')).toBe(false);
  });

  it('rejects America/New_York', () => {
    expect(isSpanishTimezone('America/New_York')).toBe(false);
  });
});

describe('formatDate', () => {
  it('Spanish TZ → DD/MM/YYYY', () => {
    const result = formatDate('2026-03-05T15:00:00Z', 'America/Montevideo');
    expect(result).toBe('05/03/2026');
  });

  it('Non-Spanish TZ → YYYY-MM-DD', () => {
    const result = formatDate('2026-03-05T15:00:00Z', 'Europe/London');
    expect(result).toBe('2026-03-05');
  });
});

describe('formatDateTime', () => {
  it('Spanish TZ → DD/MM/YYYY - HH:MM', () => {
    const result = formatDateTime('2026-03-07T20:00:00Z', 'America/Montevideo');
    // Montevideo is UTC-3, so 20:00 UTC → 17:00 local
    expect(result).toBe('07/03/2026 - 17:00');
  });

  it('Non-Spanish TZ → YYYY-MM-DD HH:MM', () => {
    const result = formatDateTime('2026-03-07T20:00:00Z', 'Europe/London');
    expect(result).toBe('2026-03-07 20:00');
  });

  it('Europe/Madrid applies offset', () => {
    // Madrid is UTC+1 (CET), March is still winter time
    const result = formatDateTime('2026-03-07T20:00:00Z', 'Europe/Madrid');
    expect(result).toBe('07/03/2026 - 21:00');
  });
});

describe('formatLocalDate', () => {
  it('Spanish TZ → DD/MM/YYYY', () => {
    expect(formatLocalDate('2026-03-05', 'America/Montevideo')).toBe('05/03/2026');
  });

  it('Non-Spanish TZ → unchanged', () => {
    expect(formatLocalDate('2026-03-05', 'Europe/London')).toBe('2026-03-05');
  });
});
