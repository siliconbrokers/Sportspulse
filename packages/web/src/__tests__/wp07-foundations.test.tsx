// WP-07 QA Fix — Smoke tests for SPF-FND-001, SPF-FND-002, SPF-FND-003
// Branch: reingenieria/v2

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { TrackRecordPage } from '../pages/TrackRecordPage.js';
import { AuthCallbackPage } from '../pages/AuthCallbackPage.js';
import { CheckoutReturnPage } from '../pages/CheckoutReturnPage.js';
import { CompetitionProvider, useCompetitions } from '../contexts/CompetitionContext.js';
import { SessionProvider } from '../auth/SessionProvider.js';
import { apiClient } from '../api/client.js';

// ── Suite 1: SPF-FND-001 — Route placeholder mounting ────────────────────────

describe('SPF-FND-001 — Route placeholder pages mount without throwing', () => {
  it('renders TrackRecordPage without throwing', () => {
    const { container } = render(<TrackRecordPage />);
    expect(container.firstChild).not.toBeNull();
  });

  it('renders AuthCallbackPage without throwing', () => {
    vi.spyOn(apiClient, 'getSession').mockResolvedValue({
      sessionStatus: 'anonymous',
      userId: null,
      email: null,
      tier: 'free',
      isPro: false,
      sessionIssuedAt: null,
    });
    const { container } = render(
      <SessionProvider>
        <MemoryRouter initialEntries={['/auth/callback']}>
          <AuthCallbackPage />
        </MemoryRouter>
      </SessionProvider>,
    );
    expect(container.firstChild).not.toBeNull();
  });

  it('renders CheckoutReturnPage without throwing', () => {
    vi.spyOn(apiClient, 'getSession').mockReturnValue(new Promise(() => {}));
    const { container } = render(
      <SessionProvider>
        <MemoryRouter initialEntries={['/checkout/return']}>
          <CheckoutReturnPage />
        </MemoryRouter>
      </SessionProvider>,
    );
    expect(container.firstChild).not.toBeNull();
  });
});

// ── Suite 2: SPF-FND-002 — CompetitionContext ─────────────────────────────────

describe('SPF-FND-002 — CompetitionContext', () => {
  it('CompetitionProvider renders children', () => {
    const { container } = render(
      <CompetitionProvider competitions={[]}>
        <span data-testid="child">hello</span>
      </CompetitionProvider>,
    );
    expect(container.querySelector('[data-testid="child"]')).not.toBeNull();
  });

  it('useCompetitions returns the passed competitions array', () => {
    const competitions = [
      { id: 'comp:football-data:PD', code: 'PD', isTournament: false, enabled: true },
      { id: 'comp:football-data:PL', code: 'PL', isTournament: false, enabled: false },
    ];

    function Consumer() {
      const { competitions: comps, enabledIds } = useCompetitions();
      return <div data-testid="result">{comps.length} / {enabledIds.length}</div>;
    }

    render(
      <CompetitionProvider competitions={competitions}>
        <Consumer />
      </CompetitionProvider>,
    );

    expect(screen.getByTestId('result').textContent).toBe('2 / 1');
  });
});

// ── Suite 3: SPF-FND-003 — API client URL construction ───────────────────────

describe('SPF-FND-003 — API client URL construction', () => {
  beforeEach(() => {
    // Restore any spies set up in earlier suites (e.g. apiClient.getSession spy from Suite 1)
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    }));
  });

  it('getSession() calls fetch("/api/session", ...)', async () => {
    await apiClient.getSession();
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledOnce();
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toBe('/api/session');
  });

  it('getTrackRecord() calls fetch with /api/ui/track-record and encoded competitionId', async () => {
    await apiClient.getTrackRecord('comp:football-data:PD');
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledOnce();
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/ui/track-record');
    expect(calledUrl).toContain('competitionId=comp%3Afootball-data%3APD');
  });

  it('getDashboard() calls fetch with /api/ui/dashboard, competitionId, and matchday', async () => {
    await apiClient.getDashboard('comp:football-data:PL', 20);
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledOnce();
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/ui/dashboard');
    expect(calledUrl).toContain('competitionId=');
    expect(calledUrl).toContain('matchday=20');
  });
});
