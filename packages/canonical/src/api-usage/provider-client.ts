/**
 * provider-client.ts — InstrumentedProviderClient
 * Spec: SPEC-SPORTPULSE-OPS-API-USAGE-GOVERNANCE §10
 *
 * A fetch wrapper that:
 * 1. Checks quota before making the request (hard stop for providers with dailyLimit > 0)
 * 2. Executes the request
 * 3. Records a normalized ApiUsageEvent to the ledger
 * 4. Returns the Response unchanged
 *
 * Never blocks the caller due to ledger failures (errors are caught and logged).
 */

import { randomUUID } from 'node:crypto';
import type { ApiUsageEvent, ConsumerType, ProviderKey, PriorityTier } from '@sportpulse/shared';
import type { ApiUsageLedger } from './ledger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProviderCallContext {
  providerKey: ProviderKey;
  consumerType: ConsumerType;
  priorityTier: PriorityTier;
  moduleKey: string;
  operationKey: string;
  /** Cost in provider units. Default: 1. YouTube search = 100, list = 1. */
  quotaCost?: number;
  /** Additional structured context (no secrets). */
  metadata?: Record<string, string>;
}

export class QuotaExhaustedError extends Error {
  constructor(public readonly providerKey: ProviderKey) {
    super(`Quota exhausted for provider: ${providerKey}`);
    this.name = 'QuotaExhaustedError';
  }
}

// ── InstrumentedProviderClient ────────────────────────────────────────────────

export class InstrumentedProviderClient {
  constructor(private readonly ledger: ApiUsageLedger) {}

  /**
   * Makes a governed provider HTTP request.
   *
   * @throws QuotaExhaustedError if quota is exhausted for a provider with dailyLimit > 0
   */
  async fetch(url: string, init: RequestInit & ProviderCallContext): Promise<Response> {
    const {
      providerKey,
      consumerType,
      priorityTier,
      moduleKey,
      operationKey,
      quotaCost = 1,
      metadata,
      // Separate ProviderCallContext fields from RequestInit
      ...fetchInit
    } = init;

    // Pre-flight quota check
    if (this.ledger.isQuotaExhausted(providerKey)) {
      throw new QuotaExhaustedError(providerKey);
    }

    const startedAt = new Date();
    const requestId = randomUUID();

    let response: Response;
    let success = true;
    let rateLimited = false;
    let statusCode: number | null = null;
    let errorCode: string | null = null;
    let errorClass: string | null = null;
    let remoteLimit: number | null = null;
    let remoteRemaining: number | null = null;
    let remoteResetAtUtc: string | null = null;

    try {
      response = await globalThis.fetch(url, fetchInit as RequestInit);
      statusCode = response.status;

      // Detect rate limiting
      if (response.status === 429) {
        rateLimited = true;
        success = false;
      } else if (!response.ok) {
        success = false;
        errorCode = `HTTP_${response.status}`;
        errorClass = 'HTTP_ERROR';
      }

      // Extract provider quota headers (API-Football style and standard)
      remoteLimit = parseHeaderInt(response.headers, [
        'x-ratelimit-requests-limit',
        'x-ratelimit-limit',
        'x-quota-limit',
        'x-requests-used', // The Odds API: total used this month (proxy for limit context)
      ]);
      remoteRemaining = parseHeaderInt(response.headers, [
        'x-ratelimit-requests-remaining',
        'x-ratelimit-remaining',
        'x-quota-remaining',
        'x-requests-remaining', // The Odds API: remaining this month
      ]);
      const resetHeader =
        response.headers.get('x-ratelimit-reset') ?? response.headers.get('x-quota-reset');
      if (resetHeader) {
        // May be a Unix timestamp or ISO string
        const ts = parseInt(resetHeader, 10);
        remoteResetAtUtc = isNaN(ts) ? resetHeader : new Date(ts * 1000).toISOString();
      }

      // If provider says quota exhausted via headers
      if (remoteRemaining !== null && remoteRemaining <= 0) {
        this.ledger.markQuotaExhausted(providerKey);
      }
    } catch (err) {
      success = false;
      errorClass = 'NETWORK_ERROR';
      errorCode = err instanceof Error ? err.constructor.name : 'UNKNOWN';
      // Re-throw so caller gets the network error
      const finishedAt = new Date();
      this.recordEvent({
        providerKey,
        consumerType,
        priorityTier,
        moduleKey,
        operationKey,
        quotaCost,
        metadata,
        requestId,
        startedAt,
        finishedAt,
        url,
        success,
        rateLimited,
        statusCode,
        errorCode,
        errorClass,
        remoteLimit,
        remoteRemaining,
        remoteResetAtUtc,
      });
      throw err;
    }

    const finishedAt = new Date();
    this.recordEvent({
      providerKey,
      consumerType,
      priorityTier,
      moduleKey,
      operationKey,
      quotaCost,
      metadata,
      requestId,
      startedAt,
      finishedAt,
      url,
      success,
      rateLimited,
      statusCode,
      errorCode,
      errorClass,
      remoteLimit,
      remoteRemaining,
      remoteResetAtUtc,
    });

    return response;
  }

  private recordEvent(params: {
    providerKey: ProviderKey;
    consumerType: ConsumerType;
    priorityTier: PriorityTier;
    moduleKey: string;
    operationKey: string;
    quotaCost: number;
    metadata?: Record<string, string>;
    requestId: string;
    startedAt: Date;
    finishedAt: Date;
    url: string;
    success: boolean;
    rateLimited: boolean;
    statusCode: number | null;
    errorCode: string | null;
    errorClass: string | null;
    remoteLimit: number | null;
    remoteRemaining: number | null;
    remoteResetAtUtc: string | null;
  }): void {
    const now = params.finishedAt.toISOString();
    const event: ApiUsageEvent = {
      id: randomUUID(),
      providerKey: params.providerKey,
      usageDateLocal: params.startedAt.toISOString().slice(0, 10),
      unitType: 'REQUEST',
      usageUnits: params.quotaCost,
      consumerType: params.consumerType,
      consumerId: null,
      moduleKey: params.moduleKey,
      operationKey: params.operationKey,
      requestMethod: 'GET',
      endpointTemplate: sanitizeUrl(params.url),
      statusCode: params.statusCode,
      success: params.success,
      rateLimited: params.rateLimited,
      cacheHit: false,
      startedAtUtc: params.startedAt.toISOString(),
      finishedAtUtc: now,
      latencyMs: params.finishedAt.getTime() - params.startedAt.getTime(),
      remoteLimit: params.remoteLimit,
      remoteRemaining: params.remoteRemaining,
      remoteResetAtUtc: params.remoteResetAtUtc,
      errorCode: params.errorCode,
      errorClass: params.errorClass,
      requestId: params.requestId,
      metadataJson: params.metadata ? JSON.stringify(params.metadata) : null,
      createdAtUtc: now,
    };

    this.ledger.recordEvent(event);

    // Reconcile ledger with provider-reported quota if headers were present.
    // This closes the gap that arises when prior requests (from other processes or
    // server restarts) were not recorded by this ledger instance.
    if (event.remoteRemaining !== null && event.remoteLimit !== null) {
      try {
        this.ledger.reconcileFromProviderHeaders(
          params.providerKey,
          event.remoteRemaining,
          event.remoteLimit,
        );
      } catch {
        // Non-critical: reconciliation failure never breaks the request path
      }
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseHeaderInt(headers: Headers, names: string[]): number | null {
  for (const name of names) {
    const val = headers.get(name);
    if (val !== null) {
      const n = parseInt(val, 10);
      if (!isNaN(n)) return n;
    }
  }
  return null;
}

/**
 * Strips query params that may contain API keys.
 * Keeps path and known non-secret params for observability.
 */
function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Remove params that are likely API keys
    const secretParams = ['key', 'api_key', 'apikey', 'token', 'access_token', 'secret'];
    for (const p of secretParams) {
      u.searchParams.delete(p);
    }
    return u.pathname + (u.search ? u.search : '');
  } catch {
    // Not a valid URL — return just the path portion
    return url.split('?')[0] ?? url;
  }
}
