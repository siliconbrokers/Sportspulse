/**
 * server/commerce/stripe-client.ts — Checkout provider abstraction (WP-06A)
 *
 * Governing spec: subscription-checkout-contract v1.0.0, api.contract v1.1.0 §6.1
 * Acceptance: K-04 (Pro depth paywall — checkout init)
 * Version impact: none
 *
 * Factory pattern:
 *   - STRIPE_SECRET_KEY present → StripeCheckoutProvider (live Stripe API)
 *   - STRIPE_SECRET_KEY absent  → MockCheckoutProvider (local dev / tests)
 *
 * Tests can inject a custom provider via setCheckoutProvider().
 */

// ── Interface ─────────────────────────────────────────────────────────────────

export interface CheckoutProvider {
  createCheckoutSession(params: {
    userId: string;
    email: string;
    planKey: string;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<{ checkoutSessionId: string; checkoutUrl: string }>;
}

// ── Mock provider (dev / tests) ───────────────────────────────────────────────

export class MockCheckoutProvider implements CheckoutProvider {
  async createCheckoutSession(params: {
    userId: string;
    email: string;
    planKey: string;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<{ checkoutSessionId: string; checkoutUrl: string }> {
    return {
      checkoutSessionId: `cs_mock_${Date.now()}`,
      checkoutUrl: `${params.returnUrl}?mock=true&session=${Date.now()}`,
    };
  }
}

// ── Stripe provider (production) ──────────────────────────────────────────────

export class StripeCheckoutProvider implements CheckoutProvider {
  constructor(private readonly secretKey: string) {}

  async createCheckoutSession(params: {
    userId: string;
    email: string;
    planKey: string;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<{ checkoutSessionId: string; checkoutUrl: string }> {
    const body = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': getPriceId(params.planKey),
      'line_items[0][quantity]': '1',
      success_url: params.returnUrl,
      cancel_url: params.cancelUrl,
      customer_email: params.email,
      'metadata[userId]': params.userId,
      'metadata[planKey]': params.planKey,
    });

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!res.ok) {
      throw new Error(`Stripe error ${res.status}`);
    }

    const data = (await res.json()) as { id: string; url: string };
    return { checkoutSessionId: data.id, checkoutUrl: data.url };
  }
}

// ── Price ID mapping ──────────────────────────────────────────────────────────

function getPriceId(planKey: string): string {
  const priceIds: Record<string, string> = {
    pro_monthly: process.env['STRIPE_PRICE_PRO_MONTHLY'] ?? 'price_mock_pro_monthly',
  };
  return priceIds[planKey] ?? planKey;
}

// ── Factory & override ────────────────────────────────────────────────────────

let _provider: CheckoutProvider | null = null;

/**
 * Returns the shared CheckoutProvider instance, creating it on first call.
 * Uses StripeCheckoutProvider when STRIPE_SECRET_KEY is set, MockCheckoutProvider otherwise.
 */
export function getCheckoutProvider(): CheckoutProvider {
  if (_provider) return _provider;
  const key = process.env['STRIPE_SECRET_KEY'];
  if (key && key.trim() !== '') {
    _provider = new StripeCheckoutProvider(key);
  } else {
    _provider = new MockCheckoutProvider();
  }
  return _provider;
}

/**
 * Overrides the provider singleton — for use in tests only.
 * Call this before registering any routes under test.
 */
export function setCheckoutProvider(provider: CheckoutProvider): void {
  _provider = provider;
}
