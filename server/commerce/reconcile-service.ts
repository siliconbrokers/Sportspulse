/**
 * server/commerce/reconcile-service.ts — Checkout reconciliation logic (WP-06B)
 *
 * Governing spec: subscription-checkout-contract v1.0.0, api.contract v1.1.0 §6.3
 * Acceptance: K-04 (Pro depth paywall — checkout init), K-05 (subscription entitlement gating)
 * Version impact: none
 *
 * Responsibilities:
 *   - Verify a Stripe checkout session's payment status
 *   - Guard against owner mismatch (CHECKOUT_OWNER_MISMATCH)
 *   - On confirmed payment, write the subscription_entitlements row (delegate to
 *     subscription-service) and return 'reconciled'
 *   - Return 'pending' when payment is in async processing (SEPA, bank transfer)
 *   - Throw CheckoutNotPaidError when checkout was abandoned or expired without payment
 *
 * Dev vs prod:
 *   - STRIPE_SECRET_KEY absent → MockStripeStatusProvider (returns 'paid' for any
 *     session ID that exists in the checkout store, 'not_found' otherwise; supports
 *     per-session overrides via setStatus() for tests)
 *   - STRIPE_SECRET_KEY present → StripeStatusProvider (calls Stripe API)
 */

import { getCheckoutStore } from './checkout-service.js';
import type { CheckoutStore } from './checkout-service.js';
import { upsertEntitlement } from './subscription-service.js';

// ── Payment status provider ───────────────────────────────────────────────────

export type PaymentStatus = 'paid' | 'pending' | 'not_paid' | 'not_found';

export interface StripeStatusProvider {
  getCheckoutStatus(checkoutSessionId: string): Promise<PaymentStatus>;
}

/** Dev/test provider: relies on what's stored in the checkout store.
 *  Supports per-session status overrides via setStatus() for test scenarios. */
export class MockStripeStatusProvider implements StripeStatusProvider {
  private readonly overrides = new Map<string, 'paid' | 'pending' | 'not_paid'>();

  constructor(private readonly store: CheckoutStore) {}

  /** Override the returned status for a specific checkout session ID. */
  setStatus(checkoutSessionId: string, status: 'paid' | 'pending' | 'not_paid'): void {
    this.overrides.set(checkoutSessionId, status);
  }

  async getCheckoutStatus(checkoutSessionId: string): Promise<PaymentStatus> {
    if (this.overrides.has(checkoutSessionId)) {
      return this.overrides.get(checkoutSessionId)!;
    }
    const record = await this.store.findByCheckoutSessionId(checkoutSessionId);
    return record ? 'paid' : 'not_found';
  }
}

/** Production provider: calls Stripe API to verify session payment_status.
 *  - session.status === 'complete' && payment_status === 'paid'  → 'paid'
 *  - session.status === 'open'    && payment_status === 'unpaid' → 'pending' (async payment)
 *  - session.status === 'expired' OR payment_status === 'unpaid' in other states → 'not_paid'
 */
export class LiveStripeStatusProvider implements StripeStatusProvider {
  constructor(private readonly secretKey: string) {}

  async getCheckoutStatus(checkoutSessionId: string): Promise<PaymentStatus> {
    const res = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(checkoutSessionId)}`,
      {
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
        },
      },
    );

    if (res.status === 404) return 'not_found';

    if (!res.ok) {
      throw new Error(`Stripe status check error ${res.status}`);
    }

    const data = (await res.json()) as { status: string; payment_status: string };

    if (data.payment_status === 'paid') return 'paid';

    // Async payment methods (SEPA, bank transfer): session open, payment processing.
    if (data.status === 'open' && data.payment_status === 'unpaid') return 'pending';

    // Expired or any other unpaid state: checkout was abandoned or expired.
    return 'not_paid';
  }
}

// ── Provider factory & override ───────────────────────────────────────────────

let _statusProvider: StripeStatusProvider | null = null;

function getStripeStatusProvider(): StripeStatusProvider {
  if (_statusProvider) return _statusProvider;
  const key = process.env['STRIPE_SECRET_KEY'];
  if (key && key.trim() !== '') {
    _statusProvider = new LiveStripeStatusProvider(key);
  } else {
    _statusProvider = new MockStripeStatusProvider(getCheckoutStore());
  }
  return _statusProvider!;
}

/** Overrides the provider singleton — for use in tests only. */
export function setStripeStatusProvider(provider: StripeStatusProvider): void {
  _statusProvider = provider;
}

// ── Error types ───────────────────────────────────────────────────────────────

export class InvalidCheckoutSessionIdError extends Error {
  constructor(checkoutSessionId: string) {
    super(`Checkout session not found: ${checkoutSessionId}`);
    this.name = 'InvalidCheckoutSessionIdError';
  }
}

export class CheckoutOwnerMismatchError extends Error {
  constructor() {
    super('The active session does not match the owner of this checkout session.');
    this.name = 'CheckoutOwnerMismatchError';
  }
}

export class ReconcileUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      `Reconcile service unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'ReconcileUnavailableError';
  }
}

export class CheckoutNotPaidError extends Error {
  constructor(public readonly checkoutSessionId: string) {
    super('Checkout session not paid');
    this.name = 'CheckoutNotPaidError';
  }
}

// ── Result type ───────────────────────────────────────────────────────────────

export type ReconcileOutcome = 'reconciled' | 'pending';

export interface ReconcileResult {
  outcome: ReconcileOutcome;
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * Verifies a checkout session payment status and, if paid, upserts the
 * subscription entitlement for the given user.
 *
 * Throws:
 *   - InvalidCheckoutSessionIdError — session ID not found in store or Stripe
 *   - CheckoutOwnerMismatchError    — session userId ≠ requestUserId
 *   - ReconcileUnavailableError     — Stripe API failure
 */
export async function reconcileCheckout(
  checkoutSessionId: string,
  requestUserId: string,
  opts?: {
    stripeStatusProvider?: StripeStatusProvider;
    checkoutStore?: CheckoutStore;
  },
): Promise<ReconcileResult> {
  const store = opts?.checkoutStore ?? getCheckoutStore();
  const statusProvider = opts?.stripeStatusProvider ?? getStripeStatusProvider();

  // 1. Verify the checkout session was created by requestUserId.
  const record = await store.findByCheckoutSessionId(checkoutSessionId);
  if (!record) {
    throw new InvalidCheckoutSessionIdError(checkoutSessionId);
  }

  if (record.userId !== requestUserId) {
    throw new CheckoutOwnerMismatchError();
  }

  // 2. Check payment status with Stripe (or mock).
  let paymentStatus: PaymentStatus;
  try {
    paymentStatus = await statusProvider.getCheckoutStatus(checkoutSessionId);
  } catch (err) {
    throw new ReconcileUnavailableError(err);
  }

  if (paymentStatus === 'not_found') {
    throw new InvalidCheckoutSessionIdError(checkoutSessionId);
  }

  if (paymentStatus === 'not_paid') {
    throw new CheckoutNotPaidError(checkoutSessionId);
  }

  if (paymentStatus === 'pending') {
    return { outcome: 'pending' };
  }

  // 3. Payment confirmed — upsert entitlement.
  await upsertEntitlement(requestUserId, 'pro', 'active');

  return { outcome: 'reconciled' };
}
