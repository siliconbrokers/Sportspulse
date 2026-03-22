/**
 * server/commerce/subscription-service.ts — Subscription entitlement management (WP-06C)
 *
 * Governing spec: subscription-checkout-contract v1.0.0, api.contract v1.1.0 §6.2, §6.4
 * Acceptance: K-04 (Pro depth paywall), K-05 (subscription entitlement gating), K-07
 * Version impact: none
 *
 * Storage strategy:
 *   - DATABASE_URL present → PgEntitlementStore (uses subscription_entitlements table)
 *   - DATABASE_URL absent  → MemoryEntitlementStore (Map — local dev / tests)
 *
 * Dev vs prod refresh:
 *   - Dev (no STRIPE_SECRET_KEY): refreshEntitlement returns current stored state unchanged
 *   - Prod: would query Stripe Billing for live subscription status and update DB
 */

import { getPool } from '../db/client.js';
import type { Pool } from 'pg';

// ── Types ─────────────────────────────────────────────────────────────────────

export type EntitlementTier = 'free' | 'pro';
export type EntitlementState = 'inactive' | 'active' | 'grace' | 'pending_reconcile';

export interface EntitlementRecord {
  userId: string;
  tier: EntitlementTier;
  state: EntitlementState;
  entitlementUpdatedAt: Date;
}

// ── Storage interface ─────────────────────────────────────────────────────────

export interface EntitlementStore {
  /** Returns the entitlement for the given userId, or null if not found. */
  find(userId: string): Promise<EntitlementRecord | null>;

  /** Inserts or updates the entitlement for the given userId. */
  upsert(record: EntitlementRecord): Promise<void>;
}

// ── In-memory store (dev / tests) ─────────────────────────────────────────────

export class MemoryEntitlementStore implements EntitlementStore {
  private readonly records = new Map<string, EntitlementRecord>();

  async find(userId: string): Promise<EntitlementRecord | null> {
    return this.records.get(userId) ?? null;
  }

  async upsert(record: EntitlementRecord): Promise<void> {
    this.records.set(record.userId, { ...record });
  }
}

// ── PostgreSQL store (prod) ───────────────────────────────────────────────────

export class PgEntitlementStore implements EntitlementStore {
  constructor(private readonly pool: Pool) {}

  async find(userId: string): Promise<EntitlementRecord | null> {
    const result = await this.pool.query<{
      user_id: string;
      tier: string;
      state: string;
      entitlement_updated_at: Date;
    }>(
      `SELECT user_id, tier, state, entitlement_updated_at
         FROM subscription_entitlements
        WHERE user_id = $1
        LIMIT 1`,
      [userId],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0]!;
    return {
      userId: row.user_id,
      tier: row.tier as EntitlementTier,
      state: row.state as EntitlementState,
      entitlementUpdatedAt: row.entitlement_updated_at,
    };
  }

  async upsert(record: EntitlementRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO subscription_entitlements (user_id, tier, state, entitlement_updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id)
       DO UPDATE SET tier = $2, state = $3, entitlement_updated_at = $4`,
      [record.userId, record.tier, record.state, record.entitlementUpdatedAt],
    );
  }
}

// ── Store factory & override ──────────────────────────────────────────────────

let _entitlementStore: EntitlementStore | null = null;

export function getEntitlementStore(): EntitlementStore {
  if (_entitlementStore) return _entitlementStore;
  const dbUrl = process.env['DATABASE_URL'];
  if (dbUrl && dbUrl.trim() !== '') {
    _entitlementStore = new PgEntitlementStore(getPool());
  } else {
    _entitlementStore = new MemoryEntitlementStore();
  }
  return _entitlementStore;
}

/** Overrides the store singleton — for use in tests only. */
export function setEntitlementStore(store: EntitlementStore): void {
  _entitlementStore = store;
}

// ── Error types ───────────────────────────────────────────────────────────────

export class EntitlementStatusUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      `Entitlement status unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'EntitlementStatusUnavailableError';
  }
}

export class EntitlementRefreshUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      `Entitlement refresh unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'EntitlementRefreshUnavailableError';
  }
}

// ── Default inactive record ───────────────────────────────────────────────────

function defaultEntitlement(userId: string): EntitlementRecord {
  return {
    userId,
    tier: 'free',
    state: 'inactive',
    entitlementUpdatedAt: new Date(),
  };
}

// ── Service functions ─────────────────────────────────────────────────────────

/**
 * Returns the current entitlement status for a user.
 * If no entitlement record exists, returns a default inactive/free record.
 * Throws EntitlementStatusUnavailableError on store failure.
 */
export async function getEntitlementStatus(
  userId: string,
  opts?: { store?: EntitlementStore },
): Promise<EntitlementRecord> {
  const store = opts?.store ?? getEntitlementStore();
  try {
    const record = await store.find(userId);
    return record ?? defaultEntitlement(userId);
  } catch (err) {
    throw new EntitlementStatusUnavailableError(err);
  }
}

/**
 * Refreshes the entitlement status for a user.
 *
 * Dev (no STRIPE_SECRET_KEY): returns current stored state unchanged.
 * Prod: would query Stripe Billing and update the DB (not yet implemented —
 * returns current state same as dev until Stripe Billing integration is added).
 *
 * Throws EntitlementRefreshUnavailableError on store failure.
 */
export async function refreshEntitlement(
  userId: string,
  opts?: { store?: EntitlementStore },
): Promise<EntitlementRecord> {
  const store = opts?.store ?? getEntitlementStore();
  try {
    // In prod this would query Stripe for the live subscription status.
    // For now (and in dev) we return the current stored state.
    const record = await store.find(userId);
    return record ?? defaultEntitlement(userId);
  } catch (err) {
    throw new EntitlementRefreshUnavailableError(err);
  }
}

/**
 * Upserts a subscription entitlement record for a user.
 * Called by reconcile-service after confirming payment.
 */
export async function upsertEntitlement(
  userId: string,
  tier: EntitlementTier,
  state: EntitlementState,
  opts?: { store?: EntitlementStore },
): Promise<EntitlementRecord> {
  const store = opts?.store ?? getEntitlementStore();
  const record: EntitlementRecord = {
    userId,
    tier,
    state,
    entitlementUpdatedAt: new Date(),
  };
  await store.upsert(record);
  return record;
}
