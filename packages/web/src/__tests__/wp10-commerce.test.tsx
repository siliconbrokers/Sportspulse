// WP-10 — Tests for SPF-SUB-001 (Paywall), SPF-SUB-002 (CheckoutReturnPage),
// SPF-SUB-003 (AdSlot)
// Branch: reingenieria/v2 · Acceptance: K-04, K-05, K-07

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { apiClient, ApiError } from '../api/client.js';
import { SessionProvider } from '../auth/SessionProvider.js';
import { Paywall } from '../commerce/Paywall.js';
import { AdSlot } from '../commerce/AdSlot.js';
import { CheckoutReturnPage } from '../pages/CheckoutReturnPage.js';
import type { SessionResponse, ReconcileResponse } from '../types/auth.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ANON_SESSION: SessionResponse = {
  sessionStatus: 'anonymous',
  userId: null,
  email: null,
  tier: 'free',
  isPro: false,
  sessionIssuedAt: null,
};

const AUTH_FREE_SESSION: SessionResponse = {
  sessionStatus: 'authenticated',
  userId: 'usr_abc',
  email: 'user@test.com',
  tier: 'free',
  isPro: false,
  sessionIssuedAt: '2026-03-22T10:00:00Z',
};

const AUTH_PRO_SESSION: SessionResponse = {
  sessionStatus: 'authenticated',
  userId: 'usr_abc',
  email: 'user@test.com',
  tier: 'pro',
  isPro: true,
  sessionIssuedAt: '2026-03-22T10:00:00Z',
};

// ── Suite 1: SPF-SUB-001 — Paywall ────────────────────────────────────────────

describe('SPF-SUB-001 — Paywall', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when loading === true (fail-closed)', () => {
    // Never resolves — keeps loading: true
    vi.spyOn(apiClient, 'getSession').mockReturnValue(new Promise(() => {}));

    const { container } = render(
      <SessionProvider>
        <Paywall />
      </SessionProvider>,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when isPro === true', async () => {
    vi.spyOn(apiClient, 'getSession').mockResolvedValue(AUTH_PRO_SESSION);

    const { container } = render(
      <SessionProvider>
        <Paywall />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('renders MagicLinkForm when sessionStatus === anonymous', async () => {
    vi.spyOn(apiClient, 'getSession').mockResolvedValue(ANON_SESSION);

    render(
      <MemoryRouter>
        <SessionProvider>
          <Paywall />
        </SessionProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('paywall-signin')).toBeTruthy();
      expect(screen.getByTestId('magic-link-form')).toBeTruthy();
    });
  });

  it('renders "Iniciar suscripción" button when authenticated + isPro: false', async () => {
    vi.spyOn(apiClient, 'getSession').mockResolvedValue(AUTH_FREE_SESSION);

    render(
      <MemoryRouter>
        <SessionProvider>
          <Paywall />
        </SessionProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      const btn = screen.getByTestId('paywall-subscribe-btn');
      expect(btn.textContent).toContain('Iniciar suscripción');
    });
  });

  it('on ALREADY_ENTITLED error → calls refresh()', async () => {
    vi.spyOn(apiClient, 'getSession').mockResolvedValue(AUTH_FREE_SESSION);
    vi.spyOn(apiClient, 'postCheckoutSession').mockRejectedValue(
      new ApiError(409, 'Already entitled', 'ALREADY_ENTITLED'),
    );

    // We'll capture the refresh call by observing a second getSession call
    const getSessionSpy = vi.spyOn(apiClient, 'getSession').mockResolvedValue(AUTH_FREE_SESSION);

    render(
      <MemoryRouter>
        <SessionProvider>
          <Paywall />
        </SessionProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('paywall-subscribe-btn')).toBeTruthy();
    });

    const btn = screen.getByTestId('paywall-subscribe-btn');
    await act(async () => {
      fireEvent.click(btn);
    });

    // refresh() triggers another getSession call
    await waitFor(() => {
      // getSession called at least twice: initial mount + after refresh
      expect(getSessionSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });
});

// ── Suite 2: SPF-SUB-002 — CheckoutReturnPage ────────────────────────────────

describe('SPF-SUB-002 — CheckoutReturnPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // SessionProvider needs getSession
    vi.spyOn(apiClient, 'getSession').mockResolvedValue(AUTH_FREE_SESSION);
  });

  function renderReturnPage(search: string) {
    return render(
      <SessionProvider>
        <MemoryRouter initialEntries={[`/checkout/return${search}`]}>
          <Routes>
            <Route path="/checkout/return" element={<CheckoutReturnPage />} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>,
    );
  }

  it('on result === reconciled → shows success message and calls refresh()', async () => {
    vi.spyOn(apiClient, 'postReconcile').mockResolvedValue({
      result: 'reconciled',
    } satisfies ReconcileResponse);

    // Spy on getSession to detect refresh() call (triggers re-fetch)
    const getSessionSpy = vi.spyOn(apiClient, 'getSession').mockResolvedValue(AUTH_PRO_SESSION);

    renderReturnPage('?session_id=cs_test_123');

    await waitFor(() => {
      const el = screen.getByTestId('checkout-return-success');
      expect(el.textContent).toContain('¡Bienvenido a SportPulse Pro!');
      expect(el.textContent).toContain('Tu suscripción está activa.');
    });

    // refresh() should have been called (≥2 getSession calls: mount + refresh)
    expect(getSessionSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('on result === pending → shows processing message', async () => {
    vi.spyOn(apiClient, 'postReconcile').mockResolvedValue({
      result: 'pending',
    } satisfies ReconcileResponse);

    renderReturnPage('?session_id=cs_pending_456');

    await waitFor(() => {
      const el = screen.getByTestId('checkout-return-pending');
      expect(el.textContent).toContain('Tu pago está siendo procesado.');
    });
  });

  it('on result === reauth_required → shows reauth message', async () => {
    vi.spyOn(apiClient, 'postReconcile').mockResolvedValue({
      result: 'reauth_required',
    } satisfies ReconcileResponse);

    renderReturnPage('?session_id=cs_reauth_789');

    await waitFor(() => {
      const el = screen.getByTestId('checkout-return-reauth');
      expect(el.textContent).toContain('Tu sesión expiró durante el proceso de pago.');
    });
  });

  it('on 409 CHECKOUT_NOT_PAID → shows "El pago no se completó"', async () => {
    vi.spyOn(apiClient, 'postReconcile').mockRejectedValue(
      new ApiError(409, 'Checkout not paid', 'CHECKOUT_NOT_PAID'),
    );

    renderReturnPage('?session_id=cs_unpaid_000');

    await waitFor(() => {
      const el = screen.getByTestId('checkout-return-not-paid');
      expect(el.textContent).toContain('El pago no se completó.');
    });
  });
});

// ── Suite 3: SPF-SUB-003 — AdSlot ────────────────────────────────────────────

describe('SPF-SUB-003 — AdSlot', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when loading === true (fail-closed)', () => {
    vi.spyOn(apiClient, 'getSession').mockReturnValue(new Promise(() => {}));

    const { container } = render(
      <SessionProvider>
        <AdSlot id="test-slot" />
      </SessionProvider>,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when isPro === true (ad suppressed)', async () => {
    vi.spyOn(apiClient, 'getSession').mockResolvedValue(AUTH_PRO_SESSION);

    const { container } = render(
      <SessionProvider>
        <AdSlot id="test-slot" />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('renders ad placeholder when isPro: false and loading: false', async () => {
    vi.spyOn(apiClient, 'getSession').mockResolvedValue(ANON_SESSION);

    render(
      <SessionProvider>
        <AdSlot id="sidebar-main" />
      </SessionProvider>,
    );

    await waitFor(() => {
      const slot = screen.getByTestId('ad-slot-sidebar-main');
      expect(slot.textContent).toContain('Publicidad');
    });
  });
});
