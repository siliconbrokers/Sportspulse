import { describe, it, expect, beforeEach } from 'vitest';
import { ApiUsageLedger } from '../ledger.js';
import type { ApiUsageEvent } from '@sportpulse/shared';

function makeEvent(overrides: Partial<ApiUsageEvent> = {}): ApiUsageEvent {
  const now = new Date().toISOString();
  return {
    id: `test-${Math.random().toString(36).slice(2)}`,
    providerKey: 'api-football',
    usageDateLocal: now.slice(0, 10),
    unitType: 'REQUEST',
    usageUnits: 1,
    consumerType: 'PORTAL_RUNTIME',
    consumerId: null,
    moduleKey: 'test',
    operationKey: 'test-op',
    requestMethod: 'GET',
    endpointTemplate: '/test',
    statusCode: 200,
    success: true,
    rateLimited: false,
    cacheHit: false,
    startedAtUtc: now,
    finishedAtUtc: now,
    latencyMs: 50,
    remoteLimit: null,
    remoteRemaining: null,
    remoteResetAtUtc: null,
    errorCode: null,
    errorClass: null,
    requestId: null,
    metadataJson: null,
    createdAtUtc: now,
    ...overrides,
  };
}

describe('ApiUsageLedger', () => {
  let ledger: ApiUsageLedger;

  beforeEach(() => {
    // Use in-memory SQLite for tests
    ledger = new ApiUsageLedger(':memory:');
  });

  it('records an event and updates rollup', () => {
    const event = makeEvent();
    ledger.recordEvent(event);

    const rollup = ledger.getTodayRollup('api-football');
    expect(rollup).not.toBeNull();
    expect(rollup!.usedUnits).toBe(1);
    expect(rollup!.successCount).toBe(1);
    expect(rollup!.errorCount).toBe(0);
  });

  it('accumulates multiple events in rollup', () => {
    ledger.recordEvent(makeEvent());
    ledger.recordEvent(makeEvent());
    ledger.recordEvent(makeEvent({ success: false, errorCode: 'TIMEOUT' }));

    const rollup = ledger.getTodayRollup('api-football');
    expect(rollup!.usedUnits).toBe(3);
    expect(rollup!.successCount).toBe(2);
    expect(rollup!.errorCount).toBe(1);
  });

  it('tracks rate-limited events', () => {
    ledger.recordEvent(makeEvent({ rateLimited: true, success: false }));
    const rollup = ledger.getTodayRollup('api-football');
    expect(rollup!.rateLimitedCount).toBe(1);
  });

  it('isQuotaExhausted returns false when under limit', () => {
    ledger.recordEvent(makeEvent());
    expect(ledger.isQuotaExhausted('api-football')).toBe(false);
  });

  it('isQuotaExhausted returns false for providers with dailyLimit=0', () => {
    ledger.recordEvent(makeEvent({ providerKey: 'thesportsdb' }));
    expect(ledger.isQuotaExhausted('thesportsdb')).toBe(false);
  });

  it('markQuotaExhausted sets in-memory exhaustion', () => {
    ledger.markQuotaExhausted('api-football');
    expect(ledger.isQuotaExhausted('api-football')).toBe(true);
  });

  it('consumeRequest compatibility facade works', () => {
    ledger.consumeRequest();
    const stats = ledger.getBudgetStats();
    expect(stats.requestsToday).toBe(1);
    expect(stats.exhausted).toBe(false);
  });

  it('getBudgetStats returns correct shape', () => {
    ledger.consumeRequest();
    ledger.consumeRequest();
    const stats = ledger.getBudgetStats();
    expect(stats.requestsToday).toBe(2);
    expect(stats.limit).toBe(7500);
    expect(typeof stats.exhausted).toBe('boolean');
    expect(typeof stats.brakeActive).toBe('boolean');
    expect(typeof stats.quotaExhaustedUntil).toBe('number');
  });

  it('getAllTodayRollups returns rows for all tracked providers', () => {
    ledger.recordEvent(makeEvent({ providerKey: 'api-football' }));
    ledger.recordEvent(makeEvent({ providerKey: 'football-data' }));
    const rollups = ledger.getAllTodayRollups();
    const keys = rollups.map((r) => r.providerKey);
    expect(keys).toContain('api-football');
    expect(keys).toContain('football-data');
  });

  it('getRecentEvents returns events in descending order', () => {
    const t1 = '2026-01-01T00:00:00.001Z';
    const t2 = '2026-01-01T00:00:00.002Z';
    const e1 = makeEvent({ id: 'e1', createdAtUtc: t1, startedAtUtc: t1, finishedAtUtc: t1, usageDateLocal: '2026-01-01' });
    const e2 = makeEvent({ id: 'e2', createdAtUtc: t2, startedAtUtc: t2, finishedAtUtc: t2, usageDateLocal: '2026-01-01' });
    ledger.recordEvent(e1);
    ledger.recordEvent(e2);
    const events = ledger.getRecentEvents('api-football', 10);
    expect(events.length).toBe(2);
    expect(events[0].id).toBe('e2'); // newest first
  });

  it('recordEvent is non-blocking on error (returns without throwing)', () => {
    // Simulate a broken event (missing required field) — should not throw
    expect(() => {
      ledger.recordEvent(makeEvent({ id: '' })); // empty PK might fail, but should be caught
    }).not.toThrow();
  });

  describe('getProviderTopOps', () => {
    it('returns operations ordered by count desc', () => {
      const today = new Date().toISOString().slice(0, 10);
      ledger.recordEvent(makeEvent({ operationKey: 'fixtures', usageDateLocal: today }));
      ledger.recordEvent(makeEvent({ operationKey: 'fixtures', usageDateLocal: today }));
      ledger.recordEvent(makeEvent({ operationKey: 'standings', usageDateLocal: today }));

      const topOps = ledger.getProviderTopOps('api-football', 10);
      expect(topOps.length).toBeGreaterThanOrEqual(2);
      expect(topOps[0].operationKey).toBe('fixtures');
      expect(topOps[0].count).toBe(2);
      // standings should appear after fixtures
      const standingsEntry = topOps.find((o) => o.operationKey === 'standings');
      expect(standingsEntry).toBeDefined();
      expect(standingsEntry!.count).toBe(1);
    });

    it('respects limit=1', () => {
      const today = new Date().toISOString().slice(0, 10);
      ledger.recordEvent(makeEvent({ operationKey: 'fixtures', usageDateLocal: today }));
      ledger.recordEvent(makeEvent({ operationKey: 'fixtures', usageDateLocal: today }));
      ledger.recordEvent(makeEvent({ operationKey: 'standings', usageDateLocal: today }));

      const topOps = ledger.getProviderTopOps('api-football', 1);
      expect(topOps.length).toBe(1);
      expect(topOps[0].operationKey).toBe('fixtures');
    });

    it('aggregates totalUnits correctly', () => {
      const today = new Date().toISOString().slice(0, 10);
      ledger.recordEvent(makeEvent({ operationKey: 'fixtures', usageUnits: 3, usageDateLocal: today }));
      ledger.recordEvent(makeEvent({ operationKey: 'fixtures', usageUnits: 5, usageDateLocal: today }));

      const topOps = ledger.getProviderTopOps('api-football', 10);
      const entry = topOps.find((o) => o.operationKey === 'fixtures');
      expect(entry!.totalUnits).toBe(8);
    });
  });

  describe('reconcileFromProviderHeaders', () => {
    it('closes the gap when provider reports more usage than ledger observed', () => {
      // Ledger has 5 observed units
      for (let i = 0; i < 5; i++) {
        ledger.recordEvent(makeEvent());
      }
      // Provider reports limit=7500, remaining=7400 → providerUsed=100, gap=95
      ledger.reconcileFromProviderHeaders('api-football', 7400, 7500);

      const rollup = ledger.getTodayRollup('api-football');
      // total = 5 observed + 95 reconciliation = 100
      expect(rollup!.usedUnits).toBe(100);
    });

    it('does not double-count when called twice with the same values', () => {
      for (let i = 0; i < 5; i++) {
        ledger.recordEvent(makeEvent());
      }
      ledger.reconcileFromProviderHeaders('api-football', 7400, 7500);
      // Second call with identical values — gap should remain 95, not add another 95
      ledger.reconcileFromProviderHeaders('api-football', 7400, 7500);

      const rollup = ledger.getTodayRollup('api-football');
      expect(rollup!.usedUnits).toBe(100);
    });

    it('does not reconcile when ledger already has >= providerUsed', () => {
      // Record 200 observed units
      ledger.recordEvent(makeEvent({ usageUnits: 200 }));
      // Provider reports only 100 used — ledger already exceeds this
      ledger.reconcileFromProviderHeaders('api-football', 7400, 7500); // providerUsed=100

      const rollup = ledger.getTodayRollup('api-football');
      // Still 200 — no reconciliation row inserted
      expect(rollup!.usedUnits).toBe(200);
    });

    it('getTodayObservedUnits excludes RECONCILIATION rows', () => {
      ledger.recordEvent(makeEvent({ usageUnits: 5 }));
      ledger.reconcileFromProviderHeaders('api-football', 7400, 7500); // adds 95 reconciliation

      const observed = ledger.getTodayObservedUnits('api-football');
      // Must be 5 — reconciliation row is excluded
      expect(observed).toBe(5);
    });

    it('reconciliation updates the gap value when provider usage increases', () => {
      ledger.recordEvent(makeEvent({ usageUnits: 5 }));
      // First reconcile: providerUsed=100, gap=95
      ledger.reconcileFromProviderHeaders('api-football', 7400, 7500);
      expect(ledger.getTodayRollup('api-football')!.usedUnits).toBe(100);

      // Ledger records another 10 requests (total observed = 15)
      ledger.recordEvent(makeEvent({ usageUnits: 10 }));
      // Provider now reports remaining=7380 → providerUsed=120, ledger observed=15, gap=105
      ledger.reconcileFromProviderHeaders('api-football', 7380, 7500);

      const rollup = ledger.getTodayRollup('api-football');
      // total = 15 observed + 105 reconciliation = 120
      expect(rollup!.usedUnits).toBe(120);
    });
  });

  describe('getProviderTopConsumers', () => {
    it('filters out null consumerId rows', () => {
      const today = new Date().toISOString().slice(0, 10);
      // consumerId=null — must NOT appear in results
      ledger.recordEvent(makeEvent({ consumerId: null, usageDateLocal: today }));
      // consumerId set — must appear
      ledger.recordEvent(makeEvent({ consumerId: 'consumer-A', usageDateLocal: today }));
      ledger.recordEvent(makeEvent({ consumerId: 'consumer-A', usageDateLocal: today }));

      const topConsumers = ledger.getProviderTopConsumers('api-football', 10);
      const consumerIds = topConsumers.map((c) => c.consumerId);
      expect(consumerIds).not.toContain(null);
      expect(consumerIds).toContain('consumer-A');
      expect(topConsumers.find((c) => c.consumerId === 'consumer-A')!.count).toBe(2);
    });

    it('returns consumers ordered by count desc', () => {
      const today = new Date().toISOString().slice(0, 10);
      ledger.recordEvent(makeEvent({ consumerId: 'consumer-B', usageDateLocal: today }));
      ledger.recordEvent(makeEvent({ consumerId: 'consumer-A', usageDateLocal: today }));
      ledger.recordEvent(makeEvent({ consumerId: 'consumer-A', usageDateLocal: today }));

      const topConsumers = ledger.getProviderTopConsumers('api-football', 10);
      expect(topConsumers[0].consumerId).toBe('consumer-A');
      expect(topConsumers[0].count).toBe(2);
    });

    it('respects limit', () => {
      const today = new Date().toISOString().slice(0, 10);
      ledger.recordEvent(makeEvent({ consumerId: 'consumer-A', usageDateLocal: today }));
      ledger.recordEvent(makeEvent({ consumerId: 'consumer-B', usageDateLocal: today }));
      ledger.recordEvent(makeEvent({ consumerId: 'consumer-C', usageDateLocal: today }));

      const topConsumers = ledger.getProviderTopConsumers('api-football', 1);
      expect(topConsumers.length).toBe(1);
    });
  });
});
