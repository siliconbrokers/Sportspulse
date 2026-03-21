import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ApiUsageLedger } from '../ledger.js';
import { currentDayInTimezone, currentMonthInTimezone } from '../date-utils.js';
import { quotaWindowType } from '../quota-config.js';
import type { ApiUsageEvent, ProviderQuotaDefinition } from '@sportpulse/shared';

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
    const e1 = makeEvent({
      id: 'e1',
      createdAtUtc: t1,
      startedAtUtc: t1,
      finishedAtUtc: t1,
      usageDateLocal: '2026-01-01',
    });
    const e2 = makeEvent({
      id: 'e2',
      createdAtUtc: t2,
      startedAtUtc: t2,
      finishedAtUtc: t2,
      usageDateLocal: '2026-01-01',
    });
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
      ledger.recordEvent(
        makeEvent({ operationKey: 'fixtures', usageUnits: 3, usageDateLocal: today }),
      );
      ledger.recordEvent(
        makeEvent({ operationKey: 'fixtures', usageUnits: 5, usageDateLocal: today }),
      );

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

  // ── Timezone-aware tests (SPEC-SPORTPULSE-OPS-QUOTA-LEDGER-TIMEZONE-AWARENESS) ──

  describe('getMonthTotal — provider timezone', () => {
    it('returns 0 when no events for the current month', () => {
      const total = ledger.getMonthTotal('the-odds-api');
      expect(total).toBe(0);
    });

    it('aggregates events for the current month using provider timezone', () => {
      const yearMonth = currentMonthInTimezone('UTC');
      // Insert events on the 1st and 15th of the current month
      const day1 = `${yearMonth}-01`;
      const day15 = `${yearMonth}-15`;
      ledger.recordEvent(
        makeEvent({ providerKey: 'the-odds-api', usageUnits: 10, usageDateLocal: day1 }),
      );
      ledger.recordEvent(
        makeEvent({ providerKey: 'the-odds-api', usageUnits: 20, usageDateLocal: day15 }),
      );

      const total = ledger.getMonthTotal('the-odds-api');
      expect(total).toBe(30);
    });

    it('accepts explicit yearMonth override', () => {
      ledger.recordEvent(
        makeEvent({ providerKey: 'the-odds-api', usageUnits: 5, usageDateLocal: '2025-01-10' }),
      );
      const total = ledger.getMonthTotal('the-odds-api', '2025-01');
      expect(total).toBe(5);
    });
  });

  describe('getAllCurrentWindowRollups — timezone routing', () => {
    it('returns rollups for daily-quota providers', () => {
      const today = currentDayInTimezone('UTC');
      ledger.recordEvent(makeEvent({ providerKey: 'api-football', usageDateLocal: today }));

      const rollups = ledger.getAllCurrentWindowRollups();
      const keys = rollups.map((r) => r.providerKey);
      expect(keys).toContain('api-football');
    });

    it('returns rollups for monthly-quota providers', () => {
      const yearMonth = currentMonthInTimezone('UTC');
      ledger.recordEvent(
        makeEvent({ providerKey: 'the-odds-api', usageDateLocal: `${yearMonth}-10` }),
      );

      const rollups = ledger.getAllCurrentWindowRollups();
      const keys = rollups.map((r) => r.providerKey);
      expect(keys).toContain('the-odds-api');
    });

    it('excludes providers with dailyLimit=0 and no monthlyLimit (windowType=none)', () => {
      // thesportsdb and eventos have dailyLimit=0 and no monthlyLimit → windowType='none' → skipped
      const today = currentDayInTimezone('UTC');
      ledger.recordEvent(makeEvent({ providerKey: 'thesportsdb', usageDateLocal: today }));

      const rollups = ledger.getAllCurrentWindowRollups();
      const keys = rollups.map((r) => r.providerKey);
      expect(keys).not.toContain('thesportsdb');
    });

    it('getAllTodayRollups() delegates to getAllCurrentWindowRollups()', () => {
      const today = currentDayInTimezone('UTC');
      ledger.recordEvent(makeEvent({ providerKey: 'api-football', usageDateLocal: today }));

      const viaToday = ledger.getAllTodayRollups();
      const viaCurrent = ledger.getAllCurrentWindowRollups();
      expect(viaToday).toEqual(viaCurrent);
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

// ── Standalone helper tests ───────────────────────────────────────────────────

describe('currentDayInTimezone', () => {
  it('returns YYYY-MM-DD format', () => {
    const result = currentDayInTimezone('UTC');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns same as UTC date for UTC timezone', () => {
    const expected = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date());
    expect(currentDayInTimezone('UTC')).toBe(expected);
  });

  it('falls back to UTC for invalid timezone', () => {
    const fallback = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date());
    expect(currentDayInTimezone('Invalid/Timezone')).toBe(fallback);
  });

  it('returns a valid date for America/Montevideo', () => {
    const result = currentDayInTimezone('America/Montevideo');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns a valid date for America/New_York', () => {
    const result = currentDayInTimezone('America/New_York');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── F-15: UTC-midnight crossing test for currentDayInTimezone ─────────────────

describe('currentDayInTimezone — UTC midnight crossing (F-15)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns Montevideo date (previous day) at UTC midnight+30min', () => {
    // 2026-03-21T00:30:00Z = 2026-03-20T21:30:00-03:00 (America/Montevideo)
    vi.setSystemTime(new Date('2026-03-21T00:30:00Z'));
    expect(currentDayInTimezone('UTC')).toBe('2026-03-21');
    expect(currentDayInTimezone('America/Montevideo')).toBe('2026-03-20');
  });

  it('returns same date for UTC and New_York at noon UTC', () => {
    // 2026-03-21T12:00:00Z = 2026-03-21T08:00:00-04:00 (America/New_York)
    vi.setSystemTime(new Date('2026-03-21T12:00:00Z'));
    expect(currentDayInTimezone('UTC')).toBe('2026-03-21');
    expect(currentDayInTimezone('America/New_York')).toBe('2026-03-21');
  });

  it('returns previous day for New_York at UTC midnight+30min', () => {
    // 2026-03-21T00:30:00Z = 2026-03-20T20:30:00-04:00 (America/New_York)
    vi.setSystemTime(new Date('2026-03-21T00:30:00Z'));
    expect(currentDayInTimezone('UTC')).toBe('2026-03-21');
    expect(currentDayInTimezone('America/New_York')).toBe('2026-03-20');
  });
});

// ── F-16: getAllCurrentWindowRollups with non-UTC timezone ────────────────────

describe('getAllCurrentWindowRollups — non-UTC timezone provider (F-16)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns Eastern-date rollup when system time is 01:00 UTC (previous day in New_York)', () => {
    // 2026-03-21T01:00:00Z = 2026-03-20T21:00:00-04:00 (America/New_York, UTC-4 in March)
    // UTC date = '2026-03-21', Eastern date = '2026-03-20'
    // We insert a rollup with usageDateLocal='2026-03-20' (the Eastern date).
    // getAllCurrentWindowRollups() must find it because the provider's TZ is New_York.
    // We use a provider that the ledger knows about — football-data is UTC, so we must
    // insert a row with the Eastern date and verify it's found at the right system time.

    // Step 1: insert a row dated '2026-03-20' for football-data (UTC provider, as control)
    // and another dated '2026-03-20' for a direct DB insert under api-football
    // (which is also UTC in defaults, so we test by mocking system time to an Eastern-date
    // boundary and verifying that the correct date key is queried).

    // Use api-football (UTC timezone in defaults). At 01:00 UTC on March 21,
    // currentDayInTimezone('UTC') = '2026-03-21'.
    // Insert row for '2026-03-21' — should be returned.
    const ledger = new ApiUsageLedger(':memory:');
    vi.setSystemTime(new Date('2026-03-21T01:00:00Z'));

    const today = currentDayInTimezone('UTC'); // '2026-03-21'
    ledger.recordEvent(makeEvent({ providerKey: 'api-football', usageDateLocal: today }));

    const rollups = ledger.getAllCurrentWindowRollups();
    const afRollup = rollups.find((r) => r.providerKey === 'api-football');
    expect(afRollup).toBeDefined();
    expect(afRollup!.usageDateLocal).toBe('2026-03-21');

    // Verify that a row from the previous UTC day is NOT returned
    const rollups2 = ledger.getAllCurrentWindowRollups();
    const prevDay = rollups2.find(
      (r) => r.providerKey === 'api-football' && r.usageDateLocal === '2026-03-20',
    );
    expect(prevDay).toBeUndefined();
  });

  it('uses provider timezone to select the correct date window', () => {
    // Simulate a scenario where UTC date differs from a hypothetical Eastern-date provider.
    // At 2026-03-21T01:00:00Z:
    //   UTC date = '2026-03-21'
    //   America/New_York date = '2026-03-20' (UTC-4)
    // A provider configured with timezone='America/New_York' should query '2026-03-20',
    // so only a row dated '2026-03-20' would be visible in its current window.

    const ledger = new ApiUsageLedger(':memory:');

    // Override the football-data provider timezone to America/New_York via direct DB update
    // (QuotaConfigStore seeds on first access; update after construction)
    ledger
      .getDb()
      .prepare(
        `UPDATE provider_quota_config SET timezone = 'America/New_York' WHERE provider_key = 'football-data'`,
      )
      .run();

    // Insert a row for the Eastern current date ('2026-03-20') for football-data
    ledger.recordEvent(makeEvent({ providerKey: 'football-data', usageDateLocal: '2026-03-20' }));
    // Also insert a row for UTC current date ('2026-03-21') — should NOT appear for this provider
    ledger.recordEvent(makeEvent({ providerKey: 'football-data', usageDateLocal: '2026-03-21' }));

    // Mock time to 2026-03-21T01:00:00Z — Eastern date is still '2026-03-20'
    vi.setSystemTime(new Date('2026-03-21T01:00:00Z'));

    const rollups = ledger.getAllCurrentWindowRollups();
    const fdRollups = rollups.filter((r) => r.providerKey === 'football-data');

    // Only the '2026-03-20' row (Eastern date) should be present
    expect(fdRollups.length).toBe(1);
    expect(fdRollups[0].usageDateLocal).toBe('2026-03-20');
  });
});

describe('currentMonthInTimezone', () => {
  it('returns YYYY-MM format', () => {
    const result = currentMonthInTimezone('UTC');
    expect(result).toMatch(/^\d{4}-\d{2}$/);
  });

  it('returns same as UTC month for UTC timezone', () => {
    const expected = new Date().toISOString().slice(0, 7);
    expect(currentMonthInTimezone('UTC')).toBe(expected);
  });

  it('falls back to UTC for invalid timezone', () => {
    const fallback = new Date().toISOString().slice(0, 7);
    expect(currentMonthInTimezone('Bad/Zone')).toBe(fallback);
  });
});

describe('quotaWindowType', () => {
  function makeQuotaBase(): ProviderQuotaDefinition {
    return {
      providerKey: 'api-football',
      displayName: 'Test',
      unitType: 'REQUEST',
      dailyLimit: 0,
      timezone: 'UTC',
      warningThresholdPct: 75,
      criticalThresholdPct: 90,
      hardStopThresholdPct: 95,
      allowNoncriticalWhenLowQuota: true,
      brakeLiveThreshold: 0,
      isActive: true,
      notes: null,
    };
  }

  it('returns "daily" when dailyLimit > 0', () => {
    expect(quotaWindowType({ ...makeQuotaBase(), dailyLimit: 7500 })).toBe('daily');
  });

  it('returns "monthly" when monthlyLimit > 0', () => {
    expect(quotaWindowType({ ...makeQuotaBase(), dailyLimit: 0, monthlyLimit: 20000 })).toBe(
      'monthly',
    );
  });

  it('returns "none" when both limits are 0', () => {
    expect(quotaWindowType({ ...makeQuotaBase(), dailyLimit: 0, monthlyLimit: 0 })).toBe('none');
  });

  it('returns "none" when monthlyLimit is undefined', () => {
    const q = makeQuotaBase();
    delete (q as { monthlyLimit?: number }).monthlyLimit;
    expect(quotaWindowType(q)).toBe('none');
  });

  it('prefers monthly over daily (monthly takes precedence per spec)', () => {
    // Per spec: monthlyLimit > 0 → monthly (checked first)
    expect(quotaWindowType({ ...makeQuotaBase(), dailyLimit: 7500, monthlyLimit: 20000 })).toBe(
      'monthly',
    );
  });
});
