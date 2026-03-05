import { describe, it, expect } from 'vitest';
import { WarningCollector } from '../src/index.js';

describe('WarningCollector', () => {
  it('starts empty', () => {
    const wc = new WarningCollector();
    expect(wc.toArray()).toEqual([]);
    expect(wc.length).toBe(0);
  });

  it('add() creates warning with correct shape', () => {
    const wc = new WarningCollector();
    wc.add('TEST_CODE', 'WARN', 'test message', 'entity:1');
    const [w] = wc.toArray();
    expect(w.code).toBe('TEST_CODE');
    expect(w.severity).toBe('WARN');
    expect(w.message).toBe('test message');
    expect(w.entityId).toBe('entity:1');
  });

  it('add() defaults message to null', () => {
    const wc = new WarningCollector();
    wc.add('CODE', 'INFO');
    expect(wc.toArray()[0].message).toBeNull();
  });

  it('missingSignal() produces correct warning', () => {
    const wc = new WarningCollector();
    wc.missingSignal('team:1', 'NEXT_MATCH_HOURS');
    const [w] = wc.toArray();
    expect(w.code).toBe('MISSING_SIGNAL');
    expect(w.severity).toBe('WARN');
    expect(w.entityId).toBe('team:1');
    expect(w.message).toContain('NEXT_MATCH_HOURS');
  });

  it('insufficientHistory() produces INFO warning', () => {
    const wc = new WarningCollector();
    wc.insufficientHistory('team:1', 3);
    const [w] = wc.toArray();
    expect(w.code).toBe('INSUFFICIENT_HISTORY');
    expect(w.severity).toBe('INFO');
    expect(w.message).toContain('3');
  });

  it('noUpcomingMatch() produces INFO warning', () => {
    const wc = new WarningCollector();
    wc.noUpcomingMatch('team:1');
    const [w] = wc.toArray();
    expect(w.code).toBe('NO_UPCOMING_MATCH');
    expect(w.severity).toBe('INFO');
    expect(w.entityId).toBe('team:1');
  });

  it('layoutDegraded() produces WARN without entityId', () => {
    const wc = new WarningCollector();
    wc.layoutDegraded();
    const [w] = wc.toArray();
    expect(w.code).toBe('LAYOUT_DEGRADED');
    expect(w.severity).toBe('WARN');
    expect(w.entityId).toBeUndefined();
  });

  it('staleData() produces WARN', () => {
    const wc = new WarningCollector();
    wc.staleData();
    expect(wc.toArray()[0].code).toBe('STALE_DATA');
    expect(wc.toArray()[0].severity).toBe('WARN');
  });

  it('providerError() produces ERROR', () => {
    const wc = new WarningCollector();
    wc.providerError('timeout');
    const [w] = wc.toArray();
    expect(w.code).toBe('PROVIDER_ERROR');
    expect(w.severity).toBe('ERROR');
    expect(w.message).toBe('timeout');
  });

  it('accumulates multiple warnings', () => {
    const wc = new WarningCollector();
    wc.missingSignal('t1', 'SIG_A');
    wc.layoutDegraded();
    wc.staleData();
    expect(wc.length).toBe(3);
    expect(wc.toArray()).toHaveLength(3);
  });

  it('toArray() returns a copy', () => {
    const wc = new WarningCollector();
    wc.add('A', 'INFO');
    const arr = wc.toArray();
    arr.push({ code: 'B', severity: 'WARN', message: null });
    expect(wc.length).toBe(1);
  });
});
