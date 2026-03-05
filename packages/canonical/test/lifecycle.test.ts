import { describe, it, expect } from 'vitest';
import { classifyStatus, validateTransition, EventStatus } from '../src/index.js';

describe('classifyStatus', () => {
  it('maps SCHEDULED to SCHEDULED', () => {
    expect(classifyStatus('SCHEDULED')).toBe(EventStatus.SCHEDULED);
  });

  it('maps TIMED to SCHEDULED', () => {
    expect(classifyStatus('TIMED')).toBe(EventStatus.SCHEDULED);
  });

  it('maps NOT_STARTED to SCHEDULED', () => {
    expect(classifyStatus('NOT_STARTED')).toBe(EventStatus.SCHEDULED);
  });

  it('maps IN_PLAY to IN_PROGRESS', () => {
    expect(classifyStatus('IN_PLAY')).toBe(EventStatus.IN_PROGRESS);
  });

  it('maps LIVE to IN_PROGRESS', () => {
    expect(classifyStatus('LIVE')).toBe(EventStatus.IN_PROGRESS);
  });

  it('maps PAUSED to IN_PROGRESS', () => {
    expect(classifyStatus('PAUSED')).toBe(EventStatus.IN_PROGRESS);
  });

  it('maps FINISHED to FINISHED', () => {
    expect(classifyStatus('FINISHED')).toBe(EventStatus.FINISHED);
  });

  it('maps FT to FINISHED', () => {
    expect(classifyStatus('FT')).toBe(EventStatus.FINISHED);
  });

  it('maps AWARDED to FINISHED', () => {
    expect(classifyStatus('AWARDED')).toBe(EventStatus.FINISHED);
  });

  it('maps POSTPONED to POSTPONED', () => {
    expect(classifyStatus('POSTPONED')).toBe(EventStatus.POSTPONED);
  });

  it('maps SUSPENDED to POSTPONED', () => {
    expect(classifyStatus('SUSPENDED')).toBe(EventStatus.POSTPONED);
  });

  it('maps CANCELED to CANCELED', () => {
    expect(classifyStatus('CANCELED')).toBe(EventStatus.CANCELED);
  });

  it('maps CANCELLED (British) to CANCELED', () => {
    expect(classifyStatus('CANCELLED')).toBe(EventStatus.CANCELED);
  });

  it('defaults unknown status to TBD', () => {
    expect(classifyStatus('SOMETHING_UNKNOWN')).toBe(EventStatus.TBD);
  });

  it('is case-insensitive', () => {
    expect(classifyStatus('finished')).toBe(EventStatus.FINISHED);
    expect(classifyStatus('Postponed')).toBe(EventStatus.POSTPONED);
  });

  it('trims whitespace', () => {
    expect(classifyStatus('  FINISHED  ')).toBe(EventStatus.FINISHED);
  });
});

describe('validateTransition', () => {
  // §4.1 Standard transitions
  it('allows TBD → SCHEDULED', () => {
    expect(validateTransition(EventStatus.TBD, EventStatus.SCHEDULED)).toEqual({ allowed: true });
  });

  it('allows SCHEDULED → IN_PROGRESS', () => {
    expect(validateTransition(EventStatus.SCHEDULED, EventStatus.IN_PROGRESS)).toEqual({ allowed: true });
  });

  it('allows IN_PROGRESS → FINISHED', () => {
    expect(validateTransition(EventStatus.IN_PROGRESS, EventStatus.FINISHED)).toEqual({ allowed: true });
  });

  // §4.2 Exceptional transitions
  it('allows SCHEDULED → POSTPONED', () => {
    expect(validateTransition(EventStatus.SCHEDULED, EventStatus.POSTPONED)).toEqual({ allowed: true });
  });

  it('allows SCHEDULED → CANCELED', () => {
    expect(validateTransition(EventStatus.SCHEDULED, EventStatus.CANCELED)).toEqual({ allowed: true });
  });

  it('allows POSTPONED → SCHEDULED (reschedule)', () => {
    expect(validateTransition(EventStatus.POSTPONED, EventStatus.SCHEDULED)).toEqual({ allowed: true });
  });

  it('allows IN_PROGRESS → POSTPONED (suspension)', () => {
    expect(validateTransition(EventStatus.IN_PROGRESS, EventStatus.POSTPONED)).toEqual({ allowed: true });
  });

  // §4.3 Corrections
  it('allows FINISHED → FINISHED (score correction)', () => {
    expect(validateTransition(EventStatus.FINISHED, EventStatus.FINISHED)).toEqual({ allowed: true });
  });

  it('allows FINISHED → CANCELED (rare correction)', () => {
    expect(validateTransition(EventStatus.FINISHED, EventStatus.CANCELED)).toEqual({ allowed: true });
  });

  // Forbidden transitions
  it('forbids CANCELED → IN_PROGRESS', () => {
    expect(validateTransition(EventStatus.CANCELED, EventStatus.IN_PROGRESS)).toEqual({
      allowed: false,
      reason: 'forbidden',
    });
  });

  it('forbids CANCELED → FINISHED', () => {
    expect(validateTransition(EventStatus.CANCELED, EventStatus.FINISHED)).toEqual({
      allowed: false,
      reason: 'forbidden',
    });
  });

  it('forbids FINISHED → IN_PROGRESS', () => {
    expect(validateTransition(EventStatus.FINISHED, EventStatus.IN_PROGRESS)).toEqual({
      allowed: false,
      reason: 'forbidden',
    });
  });

  // Same-state no-ops (except FINISHED)
  it('allows same-state no-op for SCHEDULED', () => {
    expect(validateTransition(EventStatus.SCHEDULED, EventStatus.SCHEDULED)).toEqual({ allowed: true });
  });

  it('allows same-state no-op for TBD', () => {
    expect(validateTransition(EventStatus.TBD, EventStatus.TBD)).toEqual({ allowed: true });
  });

  // Unknown transitions
  it('rejects unknown transition TBD → FINISHED', () => {
    expect(validateTransition(EventStatus.TBD, EventStatus.FINISHED)).toEqual({
      allowed: false,
      reason: 'unknown',
    });
  });
});
