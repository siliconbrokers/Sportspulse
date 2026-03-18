import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InstrumentedProviderClient, QuotaExhaustedError } from '../provider-client.js';
import { ApiUsageLedger } from '../ledger.js';

describe('InstrumentedProviderClient', () => {
  let ledger: ApiUsageLedger;
  let client: InstrumentedProviderClient;

  beforeEach(() => {
    ledger = new ApiUsageLedger(':memory:');
    client = new InstrumentedProviderClient(ledger);
  });

  it('records a successful event after fetch', async () => {
    const mockResponse = new Response('{}', { status: 200 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    await client.fetch('https://v3.football.api-sports.io/status', {
      providerKey: 'api-football',
      consumerType: 'PORTAL_RUNTIME',
      priorityTier: 'product-critical',
      moduleKey: 'test',
      operationKey: 'status',
    });

    const events = ledger.getRecentEvents('api-football', 10);
    expect(events.length).toBe(1);
    expect(events[0].success).toBe(true);
    expect(events[0].statusCode).toBe(200);
    expect(events[0].operationKey).toBe('status');

    vi.unstubAllGlobals();
  });

  it('records a failed event on HTTP error', async () => {
    const mockResponse = new Response('error', { status: 500 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    await client.fetch('https://v3.football.api-sports.io/fixtures', {
      providerKey: 'api-football',
      consumerType: 'PORTAL_RUNTIME',
      priorityTier: 'product-critical',
      moduleKey: 'test',
      operationKey: 'fixtures',
    });

    const events = ledger.getRecentEvents('api-football', 10);
    expect(events[0].success).toBe(false);
    expect(events[0].errorCode).toBe('HTTP_500');

    vi.unstubAllGlobals();
  });

  it('records a rate-limited event on HTTP 429', async () => {
    const mockResponse = new Response('rate limited', { status: 429 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    await client.fetch('https://v3.football.api-sports.io/fixtures', {
      providerKey: 'api-football',
      consumerType: 'PORTAL_RUNTIME',
      priorityTier: 'product-critical',
      moduleKey: 'test',
      operationKey: 'fixtures',
    });

    const events = ledger.getRecentEvents('api-football', 10);
    expect(events[0].rateLimited).toBe(true);

    vi.unstubAllGlobals();
  });

  it('throws QuotaExhaustedError when quota is marked exhausted', async () => {
    ledger.markQuotaExhausted('api-football');

    await expect(
      client.fetch('https://v3.football.api-sports.io/status', {
        providerKey: 'api-football',
        consumerType: 'PORTAL_RUNTIME',
        priorityTier: 'product-critical',
        moduleKey: 'test',
        operationKey: 'status',
      }),
    ).rejects.toThrow(QuotaExhaustedError);
  });

  it('records a network error and re-throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')));

    await expect(
      client.fetch('https://v3.football.api-sports.io/status', {
        providerKey: 'api-football',
        consumerType: 'PORTAL_RUNTIME',
        priorityTier: 'product-critical',
        moduleKey: 'test',
        operationKey: 'status',
      }),
    ).rejects.toThrow('Network failure');

    const events = ledger.getRecentEvents('api-football', 10);
    expect(events[0].success).toBe(false);
    expect(events[0].errorClass).toBe('NETWORK_ERROR');

    vi.unstubAllGlobals();
  });

  it('respects quotaCost parameter', async () => {
    const mockResponse = new Response('{}', { status: 200 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    await client.fetch('https://www.googleapis.com/youtube/v3/search', {
      providerKey: 'youtube',
      consumerType: 'PORTAL_RUNTIME',
      priorityTier: 'product-critical',
      moduleKey: 'video',
      operationKey: 'search',
      quotaCost: 100,
    });

    const rollup = ledger.getTodayRollup('youtube');
    expect(rollup!.usedUnits).toBe(100);

    vi.unstubAllGlobals();
  });

  it('sanitizes API key from URL', async () => {
    const mockResponse = new Response('{}', { status: 200 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    await client.fetch(
      'https://v3.football.api-sports.io/fixtures?league=140&season=2024',
      {
        providerKey: 'api-football',
        consumerType: 'PORTAL_RUNTIME',
        priorityTier: 'product-critical',
        moduleKey: 'test',
        operationKey: 'fixtures',
      },
    );

    const events = ledger.getRecentEvents('api-football', 10);
    expect(events[0].endpointTemplate).toContain('/fixtures');
    expect(events[0].endpointTemplate).not.toContain('api_key');

    vi.unstubAllGlobals();
  });
});
