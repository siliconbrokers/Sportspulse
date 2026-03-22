/**
 * server/commerce/checkout-service.ts — Checkout session creation (WP-06A)
 *
 * Governing spec: subscription-checkout-contract v1.0.0, api.contract v1.1.0 §6.1
 * Acceptance: K-04 (Pro depth paywall — checkout init), K-05 (subscription entitlement gating)
 * Version impact: none
 *
 * Storage strategy:
 *   - DATABASE_URL present → PgCheckoutStore (uses checkout_reconciliations table)
 *   - DATABASE_URL absent  → MemoryCheckoutStore (Map — local dev / tests)
 */

import { randomUUID } from 'node:crypto';
import { getCheckoutProvider, setCheckoutProvider } from './stripe-client.js';
import type { CheckoutProvider } from './stripe-client.js';
import { getPool } from '../db/client.js';
import type { Pool } from 'pg';

// ── Shared types ──────────────────────────────────────────────────────────────

export interface ReturnContext {
  returnTo: string;
  intent?: unknown;
}

export interface CheckoutReconciliationRecord {
  reconciliationId: string;
  userId: string;
  email: string;
  planKey: string;
  checkoutSessionId: string;
  returnContext: ReturnContext | null;
  createdAtUtc: Date;
}

// ── Storage interface ─────────────────────────────────────────────────────────

export interface CheckoutStore {
  /** Persists a new reconciliation record. */
  save(record: CheckoutReconciliationRecord): Promise<void>;

  /** Returns the reconciliation record for the given Stripe checkout session ID, or null. */
  findByCheckoutSessionId(checkoutSessionId: string): Promise<CheckoutReconciliationRecord | null>;
}

// ── In-memory store (dev / tests) ─────────────────────────────────────────────

export class MemoryCheckoutStore implements CheckoutStore {
  private readonly records = new Map<string, CheckoutReconciliationRecord>();

  async save(record: CheckoutReconciliationRecord): Promise<void> {
    this.records.set(record.reconciliationId, record);
  }

  /** Inspection helper for tests. */
  getAll(): CheckoutReconciliationRecord[] {
    return Array.from(this.records.values());
  }

  async findByCheckoutSessionId(
    checkoutSessionId: string,
  ): Promise<CheckoutReconciliationRecord | null> {
    for (const record of this.records.values()) {
      if (record.checkoutSessionId === checkoutSessionId) return record;
    }
    return null;
  }
}

// ── PostgreSQL store (prod) ───────────────────────────────────────────────────

export class PgCheckoutStore implements CheckoutStore {
  constructor(private readonly pool: Pool) {}

  async save(record: CheckoutReconciliationRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO checkout_reconciliations
         (reconciliation_id, user_id, email, plan_key, checkout_session_id,
          return_context_json, created_at_utc)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        record.reconciliationId,
        record.userId,
        record.email,
        record.planKey,
        record.checkoutSessionId,
        record.returnContext ? JSON.stringify(record.returnContext) : null,
        record.createdAtUtc,
      ],
    );
  }

  async findByCheckoutSessionId(
    checkoutSessionId: string,
  ): Promise<CheckoutReconciliationRecord | null> {
    const result = await this.pool.query<{
      reconciliation_id: string;
      user_id: string;
      email: string;
      plan_key: string;
      checkout_session_id: string;
      return_context_json: string | null;
      created_at_utc: Date;
    }>(
      `SELECT reconciliation_id, user_id, email, plan_key, checkout_session_id,
              return_context_json, created_at_utc
         FROM checkout_reconciliations
        WHERE checkout_session_id = $1
        LIMIT 1`,
      [checkoutSessionId],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0]!;
    return {
      reconciliationId: row.reconciliation_id,
      userId: row.user_id,
      email: row.email,
      planKey: row.plan_key,
      checkoutSessionId: row.checkout_session_id,
      returnContext: row.return_context_json
        ? (JSON.parse(row.return_context_json) as ReturnContext)
        : null,
      createdAtUtc: row.created_at_utc,
    };
  }
}

// ── Store factory & override ──────────────────────────────────────────────────

let _store: CheckoutStore | null = null;

export function getCheckoutStore(): CheckoutStore {
  if (_store) return _store;
  const dbUrl = process.env['DATABASE_URL'];
  if (dbUrl && dbUrl.trim() !== '') {
    _store = new PgCheckoutStore(getPool());
  } else {
    _store = new MemoryCheckoutStore();
  }
  return _store;
}

/** Overrides the store singleton — for use in tests only. */
export function setCheckoutStore(store: CheckoutStore): void {
  _store = store;
}

// ── Exported error types ──────────────────────────────────────────────────────

export class CheckoutProviderUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      `Checkout provider unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'CheckoutProviderUnavailableError';
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

export interface CreateCheckoutSessionResult {
  checkoutSessionId: string;
  checkoutUrl: string;
}

/**
 * Creates a checkout session for the given user and plan.
 * Persists a reconciliation record before returning the provider URL.
 * Throws CheckoutProviderUnavailableError if the provider call fails.
 */
export async function createCheckoutSession(
  userId: string,
  email: string,
  planKey: string,
  returnContext: ReturnContext | null,
  opts?: {
    checkoutProvider?: CheckoutProvider;
    appBaseUrl?: string;
  },
): Promise<CreateCheckoutSessionResult> {
  const store = getCheckoutStore();
  const provider = opts?.checkoutProvider ?? getCheckoutProvider();
  const appBaseUrl = opts?.appBaseUrl ?? process.env['APP_BASE_URL'] ?? 'http://localhost:3000';

  const returnUrl = returnContext?.returnTo
    ? `${appBaseUrl}${returnContext.returnTo}`
    : `${appBaseUrl}/pro?checkout=success`;

  const cancelUrl = `${appBaseUrl}/pro?checkout=cancelled`;

  let result: { checkoutSessionId: string; checkoutUrl: string };
  try {
    result = await provider.createCheckoutSession({
      userId,
      email,
      planKey,
      returnUrl,
      cancelUrl,
    });
  } catch (err) {
    throw new CheckoutProviderUnavailableError(err);
  }

  // Persist reconciliation record after successful provider call.
  const record: CheckoutReconciliationRecord = {
    reconciliationId: randomUUID(),
    userId,
    email,
    planKey,
    checkoutSessionId: result.checkoutSessionId,
    returnContext,
    createdAtUtc: new Date(),
  };

  await store.save(record);

  return result;
}

// Re-export so tests can inject without importing from stripe-client directly.
export { setCheckoutProvider };
