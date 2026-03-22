// WP-09 — Tests for SPF-AUTH-001 (SessionProvider), SPF-AUTH-002 (AuthCallbackPage),
// SPF-AUTH-003 (MagicLinkForm)
// Branch: reingenieria/v2 · Acceptance: K-01, K-06

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { apiClient, ApiError } from '../api/client.js';
import { SessionProvider, useSession } from '../auth/SessionProvider.js';
import { AuthCallbackPage } from '../pages/AuthCallbackPage.js';
import { MagicLinkForm } from '../auth/MagicLinkForm.js';
import type { SessionResponse, ReturnContextDTO, MagicLinkCompleteResponse } from '../types/auth.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ANON_SESSION: SessionResponse = {
  sessionStatus: 'anonymous',
  userId: null,
  email: null,
  tier: 'free',
  isPro: false,
  sessionIssuedAt: null,
};

const AUTH_SESSION: SessionResponse = {
  sessionStatus: 'authenticated',
  userId: 'usr_abc123',
  email: 'user@test.com',
  tier: 'free',
  isPro: false,
  sessionIssuedAt: '2026-03-22T10:00:00Z',
};

const RETURN_CONTEXT: ReturnContextDTO = { returnTo: '/dashboard' };

// ── Suite 1: SPF-AUTH-001 — SessionProvider ───────────────────────────────────

describe('SPF-AUTH-001 — SessionProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('initial state is sessionStatus: anonymous and loading: true', () => {
    // Mock getSession to never resolve during this test
    vi.spyOn(apiClient, 'getSession').mockReturnValue(new Promise(() => {}));

    // Consumer component that captures initial render
    const states: { sessionStatus: string; loading: boolean }[] = [];
    function Consumer() {
      const ctx = useSession();
      states.push({ sessionStatus: ctx.sessionStatus, loading: ctx.loading });
      return null;
    }

    render(
      <SessionProvider>
        <Consumer />
      </SessionProvider>,
    );

    // First render before promise resolves
    expect(states[0]).toMatchObject({ sessionStatus: 'anonymous', loading: true });
  });

  it('after successful GET /api/session → sessionStatus: authenticated', async () => {
    vi.spyOn(apiClient, 'getSession').mockResolvedValue(AUTH_SESSION);

    function Consumer() {
      const ctx = useSession();
      return (
        <div>
          <span data-testid="status">{ctx.sessionStatus}</span>
          <span data-testid="loading">{String(ctx.loading)}</span>
          <span data-testid="email">{ctx.email}</span>
        </div>
      );
    }

    render(
      <SessionProvider>
        <Consumer />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('authenticated');
    });

    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('email').textContent).toBe('user@test.com');
  });

  it('falls back to anonymous when GET /api/session errors', async () => {
    vi.spyOn(apiClient, 'getSession').mockRejectedValue(new Error('Network error'));

    function Consumer() {
      const ctx = useSession();
      return (
        <div>
          <span data-testid="status">{ctx.sessionStatus}</span>
          <span data-testid="isPro">{String(ctx.isPro)}</span>
          <span data-testid="loading">{String(ctx.loading)}</span>
        </div>
      );
    }

    render(
      <SessionProvider>
        <Consumer />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('status').textContent).toBe('anonymous');
    expect(screen.getByTestId('isPro').textContent).toBe('false');
  });

  it('useSession outside provider throws', () => {
    function BadConsumer() {
      useSession();
      return null;
    }

    // Suppress expected console.error from React
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<BadConsumer />)).toThrow(
      'useSession must be used inside <SessionProvider>',
    );

    consoleError.mockRestore();
  });
});

// ── Suite 2: SPF-AUTH-002 — AuthCallbackPage ──────────────────────────────────

describe('SPF-AUTH-002 — AuthCallbackPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Default: getSession returns anonymous (SessionProvider needs it)
    vi.spyOn(apiClient, 'getSession').mockResolvedValue(ANON_SESSION);
  });

  function renderCallback(search: string) {
    return render(
      <SessionProvider>
        <MemoryRouter initialEntries={[`/auth/callback${search}`]}>
          <Routes>
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="*" element={<span data-testid="landing">landing</span>} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>,
    );
  }

  it('with valid token → calls postMagicLinkComplete with correct token', async () => {
    const completeMock = vi.spyOn(apiClient, 'postMagicLinkComplete').mockResolvedValue({
      session: AUTH_SESSION,
      resume: { returnTo: '/' },
    } satisfies MagicLinkCompleteResponse);

    renderCallback('?token=abc123');

    await waitFor(() => {
      expect(completeMock).toHaveBeenCalledWith(
        'abc123',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it('on INVALID_TOKEN error → shows "El enlace no es válido."', async () => {
    vi.spyOn(apiClient, 'postMagicLinkComplete').mockRejectedValue(
      new ApiError(400, 'Invalid token', 'INVALID_TOKEN'),
    );

    renderCallback('?token=badtoken');

    await waitFor(() => {
      const el = screen.getByTestId('auth-callback-error');
      expect(el.textContent).toContain('El enlace no es válido.');
    });
  });

  it('on TOKEN_EXPIRED error → shows "El enlace ha expirado."', async () => {
    vi.spyOn(apiClient, 'postMagicLinkComplete').mockRejectedValue(
      new ApiError(410, 'Token expired', 'TOKEN_EXPIRED'),
    );

    renderCallback('?token=expiredtoken');

    await waitFor(() => {
      const el = screen.getByTestId('auth-callback-error');
      expect(el.textContent).toContain('El enlace ha expirado.');
    });
  });

  it('on TOKEN_ALREADY_USED error → shows "El enlace ya fue utilizado. Solicita uno nuevo."', async () => {
    vi.spyOn(apiClient, 'postMagicLinkComplete').mockRejectedValue(
      new ApiError(410, 'Token already used', 'TOKEN_ALREADY_USED'),
    );

    renderCallback('?token=usedtoken');

    await waitFor(() => {
      const el = screen.getByTestId('auth-callback-error');
      expect(el.textContent).toContain('El enlace ya fue utilizado. Solicita uno nuevo.');
    });
  });

  it('with no token in URL → shows "Enlace inválido"', () => {
    renderCallback('');

    const el = screen.getByTestId('auth-callback-no-token');
    expect(el.textContent).toContain('Enlace inválido');
  });
});

// ── Suite 3: SPF-AUTH-003 — MagicLinkForm ────────────────────────────────────

describe('SPF-AUTH-003 — MagicLinkForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function renderForm(returnContext: ReturnContextDTO = RETURN_CONTEXT) {
    return render(
      <MemoryRouter>
        <MagicLinkForm returnContext={returnContext} />
      </MemoryRouter>,
    );
  }

  it('on submit calls postMagicLinkStart with email and returnContext', async () => {
    const startMock = vi.spyOn(apiClient, 'postMagicLinkStart').mockResolvedValue({
      requestAccepted: true,
      cooldownSeconds: 60,
    });

    renderForm();

    const input = screen.getByRole('textbox');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'test@example.com' } });
    });

    const btn = screen.getByTestId('magic-link-submit');
    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => {
      expect(startMock).toHaveBeenCalledWith(
        'test@example.com',
        RETURN_CONTEXT,
      );
    });
  });

  it('on 202 → shows confirmation message with email', async () => {
    vi.spyOn(apiClient, 'postMagicLinkStart').mockResolvedValue({
      requestAccepted: true,
      cooldownSeconds: 60,
    });

    renderForm();

    const input = screen.getByRole('textbox');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'hello@example.com' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('magic-link-submit'));
    });

    await waitFor(() => {
      const msg = screen.getByTestId('magic-link-sent');
      expect(msg.textContent).toContain('hello@example.com');
      expect(msg.textContent).toContain('Revisa tu correo');
    });
  });

  it('on rate-limit (429) → shows rate-limit message', async () => {
    vi.spyOn(apiClient, 'postMagicLinkStart').mockRejectedValue(
      new ApiError(429, 'Rate limited', 'MAGIC_LINK_RATE_LIMITED'),
    );

    renderForm();

    const input = screen.getByRole('textbox');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'rate@example.com' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('magic-link-submit'));
    });

    await waitFor(() => {
      const msg = screen.getByTestId('magic-link-rate-limited');
      expect(msg.textContent).toContain('Demasiados intentos');
    });
  });
});
