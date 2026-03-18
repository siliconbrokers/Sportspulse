/**
 * api-usage-routes.test.ts — Tests for GET /api/internal/ops/api-usage/* endpoints.
 * Uses Fastify inject() with a mock IApiUsageLedger to avoid any real DB dependency.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerApiUsageRoutes } from '../src/internal/api-usage-routes.js';
import type { IApiUsageLedger, IQuotaConfigStore } from '../src/internal/api-usage-routes.js';
import type {
  ApiUsageEvent,
  DailyRollup,
  ProviderKey,
  ProviderQuotaDefinition,
  QuotaWarningLevel,
} from '@sportpulse/shared';

// ── Fixture helpers ────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<ApiUsageEvent> = {}): ApiUsageEvent {
  const now = new Date().toISOString();
  return {
    id: `ev-${Math.random().toString(36).slice(2)}`,
    providerKey: 'api-football',
    usageDateLocal: now.slice(0, 10),
    unitType: 'REQUEST',
    usageUnits: 1,
    consumerType: 'PORTAL_RUNTIME',
    consumerId: null,
    moduleKey: 'test',
    operationKey: 'fixtures',
    requestMethod: 'GET',
    endpointTemplate: '/v3/fixtures',
    statusCode: 200,
    success: true,
    rateLimited: false,
    cacheHit: false,
    startedAtUtc: now,
    finishedAtUtc: now,
    latencyMs: 50,
    remoteLimit: 100,
    remoteRemaining: 80,
    remoteResetAtUtc: null,
    errorCode: null,
    errorClass: null,
    requestId: null,
    metadataJson: null,
    createdAtUtc: now,
    ...overrides,
  };
}

function makeQuota(overrides: Partial<ProviderQuotaDefinition> = {}): ProviderQuotaDefinition {
  return {
    providerKey: 'api-football',
    displayName: 'API-Football',
    unitType: 'REQUEST',
    dailyLimit: 100,
    timezone: 'UTC',
    warningThresholdPct: 75,
    criticalThresholdPct: 90,
    hardStopThresholdPct: 95,
    allowNoncriticalWhenLowQuota: false,
    brakeLiveThreshold: 80,
    isActive: true,
    notes: null,
    ...overrides,
  };
}

function makeRollup(overrides: Partial<DailyRollup> = {}): DailyRollup {
  const now = new Date().toISOString();
  return {
    providerKey: 'api-football',
    usageDateLocal: now.slice(0, 10),
    consumerType: 'PORTAL_RUNTIME',
    usedUnits: 10,
    successCount: 9,
    errorCount: 1,
    rateLimitedCount: 0,
    cacheHitCount: 0,
    lastRemoteLimit: 100,
    lastRemoteRemaining: 90,
    lastRemoteResetAtUtc: null,
    lastSeenAtUtc: now,
    ...overrides,
  };
}

// ── Mock ledger builder ────────────────────────────────────────────────────

function makeMockLedger(overrides: Partial<{
  rollups: DailyRollup[];
  quotas: ProviderQuotaDefinition[];
  events: Map<ProviderKey, ApiUsageEvent[]>;
  topOps: { operationKey: string; count: number; totalUnits: number }[];
  topConsumers: { consumerId: string; count: number; totalUnits: number }[];
}>= {}): IApiUsageLedger {
  const rollups = overrides.rollups ?? [makeRollup()];
  const quotas = overrides.quotas ?? [makeQuota()];
  const eventsMap = overrides.events ?? new Map<ProviderKey, ApiUsageEvent[]>([
    ['api-football', [makeEvent()]],
  ]);
  const topOps = overrides.topOps ?? [{ operationKey: 'fixtures', count: 3, totalUnits: 3 }];
  const topConsumers = overrides.topConsumers ?? [];

  const quotaStore: IQuotaConfigStore = { getAll: () => quotas };

  return {
    getAllTodayRollups: () => rollups,
    getQuotaConfig: () => quotaStore,
    getProviderSummary: (pk: ProviderKey) => {
      const rollup = rollups.find((r) => r.providerKey === pk) ?? null;
      const quota = quotas.find((q) => q.providerKey === pk) ?? null;
      const usedUnits = rollup?.usedUnits ?? 0;
      const dailyLimit = quota?.dailyLimit ?? 0;
      const percentUsed = dailyLimit > 0 ? (usedUnits / dailyLimit) * 100 : 0;
      let warningLevel: QuotaWarningLevel = 'NORMAL';
      if (dailyLimit > 0) {
        if (percentUsed >= (quota?.hardStopThresholdPct ?? 95)) warningLevel = 'EXHAUSTED';
        else if (percentUsed >= (quota?.criticalThresholdPct ?? 90)) warningLevel = 'CRITICAL';
        else if (percentUsed >= (quota?.warningThresholdPct ?? 75)) warningLevel = 'WARNING';
      }
      return { rollup, quota, percentUsed, warningLevel };
    },
    getRecentEvents: (pk: ProviderKey, _limit = 50) =>
      (eventsMap.get(pk) ?? []).slice(0, _limit),
    getProviderTopOps: (_pk: ProviderKey, _limit: number) => topOps.slice(0, _limit),
    getProviderTopConsumers: (_pk: ProviderKey, _limit: number) => topConsumers.slice(0, _limit),
  };
}

// ── Test setup ────────────────────────────────────────────────────────────

let app: FastifyInstance;

function buildTestApp(ledger: IApiUsageLedger): FastifyInstance {
  const f = Fastify({ logger: false });
  registerApiUsageRoutes(f, ledger);
  return f;
}

// ── /providers/:providerKey ────────────────────────────────────────────────

describe('GET /api/internal/ops/api-usage/providers/:providerKey', () => {
  beforeEach(() => {
    app = buildTestApp(makeMockLedger());
  });

  it('returns topOperations in response', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/internal/ops/api-usage/providers/api-football',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ topOperations: unknown[] }>();
    expect(Array.isArray(body.topOperations)).toBe(true);
    expect(body.topOperations.length).toBeGreaterThan(0);
    const first = body.topOperations[0] as { operationKey: string; count: number; totalUnits: number };
    expect(typeof first.operationKey).toBe('string');
    expect(typeof first.count).toBe('number');
    expect(typeof first.totalUnits).toBe('number');
  });

  it('returns topConsumers in response', async () => {
    const ledger = makeMockLedger({
      topConsumers: [{ consumerId: 'consumer-A', count: 5, totalUnits: 5 }],
    });
    app = buildTestApp(ledger);
    const res = await app.inject({
      method: 'GET',
      url: '/api/internal/ops/api-usage/providers/api-football',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ topConsumers: unknown[] }>();
    expect(Array.isArray(body.topConsumers)).toBe(true);
    expect(body.topConsumers.length).toBe(1);
  });

  it('returns rateLimitIncidents as subset of rate-limited events', async () => {
    const rateLimitedEvent = makeEvent({ rateLimited: true, success: false });
    const normalEvent = makeEvent({ rateLimited: false, success: true });
    const ledger = makeMockLedger({
      events: new Map([['api-football', [rateLimitedEvent, normalEvent]]]),
    });
    app = buildTestApp(ledger);
    const res = await app.inject({
      method: 'GET',
      url: '/api/internal/ops/api-usage/providers/api-football',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ rateLimitIncidents: ApiUsageEvent[] }>();
    expect(Array.isArray(body.rateLimitIncidents)).toBe(true);
    expect(body.rateLimitIncidents.every((e) => e.rateLimited)).toBe(true);
    expect(body.rateLimitIncidents.length).toBe(1);
  });

  it('returns discrepancyStatus in response', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/internal/ops/api-usage/providers/api-football',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ discrepancyStatus: string }>();
    expect(['NONE', 'MINOR', 'MAJOR', 'UNKNOWN']).toContain(body.discrepancyStatus);
  });

  it('returns 404 for unknown provider', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/internal/ops/api-usage/providers/nonexistent-provider',
    });
    expect(res.statusCode).toBe(404);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('Provider not found');
  });
});

// ── /events ────────────────────────────────────────────────────────────────

describe('GET /api/internal/ops/api-usage/events', () => {
  it('returns events for a single provider when provider param is supplied', async () => {
    app = buildTestApp(makeMockLedger());
    const res = await app.inject({
      method: 'GET',
      url: '/api/internal/ops/api-usage/events?provider=api-football',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ events: ApiUsageEvent[]; count: number }>();
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.count).toBe(body.events.length);
  });

  it('returns events from multiple providers when provider is omitted', async () => {
    const afEvent = makeEvent({ providerKey: 'api-football', id: 'ev-af' });
    const fdEvent = makeEvent({ providerKey: 'football-data', id: 'ev-fd' });
    const ledger = makeMockLedger({
      quotas: [
        makeQuota({ providerKey: 'api-football' }),
        makeQuota({ providerKey: 'football-data', displayName: 'Football-Data' }),
      ],
      rollups: [makeRollup({ providerKey: 'api-football' }), makeRollup({ providerKey: 'football-data' })],
      events: new Map<ProviderKey, ApiUsageEvent[]>([
        ['api-football', [afEvent]],
        ['football-data', [fdEvent]],
      ]),
    });
    app = buildTestApp(ledger);
    const res = await app.inject({
      method: 'GET',
      url: '/api/internal/ops/api-usage/events',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ events: ApiUsageEvent[] }>();
    const ids = body.events.map((e) => e.id);
    expect(ids).toContain('ev-af');
    expect(ids).toContain('ev-fd');
  });

  it('filters by rateLimited=true', async () => {
    const rlEvent = makeEvent({ id: 'rl-ev', rateLimited: true, success: false });
    const okEvent = makeEvent({ id: 'ok-ev', rateLimited: false, success: true });
    const ledger = makeMockLedger({
      events: new Map([['api-football', [rlEvent, okEvent]]]),
    });
    app = buildTestApp(ledger);
    const res = await app.inject({
      method: 'GET',
      url: '/api/internal/ops/api-usage/events?provider=api-football&rateLimited=true',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ events: ApiUsageEvent[] }>();
    expect(body.events.every((e) => e.rateLimited)).toBe(true);
    expect(body.events.length).toBe(1);
    expect(body.events[0].id).toBe('rl-ev');
  });

  it('filters by success=false', async () => {
    const failedEvent = makeEvent({ id: 'fail-ev', success: false, errorCode: 'SERVER_ERROR' });
    const okEvent = makeEvent({ id: 'ok-ev', success: true });
    const ledger = makeMockLedger({
      events: new Map([['api-football', [failedEvent, okEvent]]]),
    });
    app = buildTestApp(ledger);
    const res = await app.inject({
      method: 'GET',
      url: '/api/internal/ops/api-usage/events?provider=api-football&success=false',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ events: ApiUsageEvent[] }>();
    expect(body.events.every((e) => !e.success)).toBe(true);
    expect(body.events.length).toBe(1);
    expect(body.events[0].id).toBe('fail-ev');
  });

  it('returns 404 for unknown provider', async () => {
    app = buildTestApp(makeMockLedger());
    const res = await app.inject({
      method: 'GET',
      url: '/api/internal/ops/api-usage/events?provider=unknown-provider',
    });
    expect(res.statusCode).toBe(404);
  });
});
