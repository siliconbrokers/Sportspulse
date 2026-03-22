// WP-09 — Tests for AuthArea logout flow (Navbar)
// Branch: reingenieria/v2 · Acceptance: K-01, K-06

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import { apiClient } from '../api/client.js';
import { Navbar } from '../components/Navbar.js';

// ── Mock useSession so AuthArea sees an authenticated user ────────────────────

const mockRefresh = vi.fn();

vi.mock('../auth/SessionProvider.js', () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSession: () => ({
    sessionStatus: 'authenticated',
    email: 'user@example.com',
    loading: false,
    refresh: mockRefresh,
    userId: 'usr_001',
    tier: 'free',
    isPro: false,
    sessionIssuedAt: '2026-03-22T10:00:00Z',
  }),
}));

// ── Mock hooks that depend on browser APIs ────────────────────────────────────

vi.mock('../hooks/use-window-width.js', () => ({
  useWindowWidth: () => ({ breakpoint: 'desktop', width: 1280 }),
}));

vi.mock('../hooks/use-theme.js', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEFAULT_NAVBAR_PROPS = {
  view: 'home' as const,
  onViewChange: vi.fn(),
  competitionId: 'PD',
  onCompetitionChange: vi.fn(),
  competitions: [],
  hasLiveMatches: false,
};

function renderNavbar() {
  return render(
    <MemoryRouter>
      <Navbar {...DEFAULT_NAVBAR_PROPS} />
    </MemoryRouter>,
  );
}

// ── Suite: AuthArea logout flow ───────────────────────────────────────────────

describe('SPF-AUTH-002 — AuthArea logout flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders logout button when session is authenticated', () => {
    renderNavbar();
    expect(screen.getByTestId('navbar-logout-btn')).toBeTruthy();
  });

  it('calls postLogout and then refresh() when logout button is clicked', async () => {
    const logoutMock = vi
      .spyOn(apiClient, 'postLogout')
      .mockResolvedValue(undefined);

    renderNavbar();

    const logoutBtn = screen.getByTestId('navbar-logout-btn');

    await act(async () => {
      fireEvent.click(logoutBtn);
    });

    await waitFor(() => {
      expect(logoutMock).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });
  });

  it('still calls refresh() even when postLogout rejects', async () => {
    vi.spyOn(apiClient, 'postLogout').mockRejectedValue(new Error('Network error'));

    renderNavbar();

    const logoutBtn = screen.getByTestId('navbar-logout-btn');

    await act(async () => {
      fireEvent.click(logoutBtn);
    });

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });
  });
});
