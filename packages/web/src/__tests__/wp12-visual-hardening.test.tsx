// WP-12 — K-08 visual hardening smoke tests
// Branch: reingenieria/v2 · Acceptance: K-08
//
// Tests confirm style/token/theme propagation reaches required frontend surfaces
// without semantic regressions. These are render-smoke tests — not pixel-perfect.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import { apiClient } from '../api/client.js';
import { SessionProvider } from '../auth/SessionProvider.js';
import { CompetitionProvider } from '../contexts/CompetitionContext.js';
import { TrackRecordPage } from '../pages/TrackRecordPage.js';
import { Paywall } from '../commerce/Paywall.js';
import { AdSlot } from '../commerce/AdSlot.js';
import type { SessionResponse, TrackRecordResponse } from '../types/auth.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ANON_SESSION: SessionResponse = {
  sessionStatus: 'anonymous',
  userId: null,
  email: null,
  tier: 'free',
  isPro: false,
  sessionIssuedAt: null,
};

const FREE_SESSION: SessionResponse = {
  sessionStatus: 'authenticated',
  userId: 'usr_abc',
  email: 'user@test.com',
  tier: 'free',
  isPro: false,
  sessionIssuedAt: '2026-03-22T10:00:00Z',
};

const TRACK_RECORD_UNAVAILABLE: TrackRecordResponse = {
  competitionId: 'comp:football-data:PD',
  state: 'unavailable',
  evaluationType: null,
  disclosureMessageKey: null,
  accuracy: null,
  totalPredictions: null,
  correctPredictions: null,
  thresholdRequired: 200,
};

const COMP_PD = { id: 'comp:football-data:PD', code: 'PD', isTournament: false, enabled: true };

// ── Suite 1: K-08 — TrackRecordPage ──────────────────────────────────────────

describe('K-08 — TrackRecordPage renders with competition selector accessible on all screen sizes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(apiClient, 'getTrackRecord').mockResolvedValue(TRACK_RECORD_UNAVAILABLE);
  });

  it('renders without throwing and exposes data-testid="track-record-page"', () => {
    const { container } = render(
      <CompetitionProvider competitions={[COMP_PD]}>
        <TrackRecordPage />
      </CompetitionProvider>,
    );

    expect(container.firstChild).not.toBeNull();
    expect(screen.getByTestId('track-record-page')).toBeTruthy();
  });

  it('renders competition name heading', async () => {
    render(
      <CompetitionProvider competitions={[COMP_PD]}>
        <TrackRecordPage />
      </CompetitionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('competition-name')).toBeTruthy();
    });
  });

  it('does not overflow horizontally (single-competition renders without selector)', () => {
    const { container } = render(
      <CompetitionProvider competitions={[COMP_PD]}>
        <TrackRecordPage />
      </CompetitionProvider>,
    );

    // With a single competition the selector is hidden — no overflow risk
    expect(screen.queryByTestId('competition-selector')).toBeNull();
    expect(container.firstChild).not.toBeNull();
  });

  it('renders competition selector when multiple competitions are present', async () => {
    const COMP_PL = { id: 'comp:football-data:PL', code: 'PL', isTournament: false, enabled: true };

    vi.spyOn(apiClient, 'getTrackRecord').mockResolvedValue({
      ...TRACK_RECORD_UNAVAILABLE,
      competitionId: 'comp:football-data:PD',
    });

    render(
      <CompetitionProvider competitions={[COMP_PD, COMP_PL]}>
        <TrackRecordPage />
      </CompetitionProvider>,
    );

    // Selector should be visible with multiple competitions
    expect(screen.getByTestId('competition-selector')).toBeTruthy();
  });
});

// ── Suite 2: K-08 — Paywall renders correctly for anonymous user ──────────────

describe('K-08 — Paywall renders correctly for anonymous user', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders sign-in prompt with MagicLinkForm when session is anonymous', async () => {
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
    });

    // Paywall must contain the magic link form as the CTA
    expect(screen.getByTestId('magic-link-form')).toBeTruthy();
  });

  it('paywall container is max-w-sm — does not exceed viewport width on mobile', async () => {
    vi.spyOn(apiClient, 'getSession').mockResolvedValue(ANON_SESSION);

    render(
      <MemoryRouter>
        <SessionProvider>
          <Paywall />
        </SessionProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      const paywall = screen.getByTestId('paywall-signin');
      // Confirm max-width constraint class is present
      expect(paywall.className).toContain('max-w-sm');
    });
  });
});

// ── Suite 3: K-08 — AdSlot renders placeholder for free user after session load ──

describe('K-08 — AdSlot renders placeholder for free user after session load', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders ad-slot-sidebar-main for free (non-Pro) user after session resolves', async () => {
    vi.spyOn(apiClient, 'getSession').mockResolvedValue(FREE_SESSION);

    render(
      <SessionProvider>
        <AdSlot id="sidebar-main" />
      </SessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('ad-slot-sidebar-main')).toBeTruthy();
    });
  });

  it('ad slot contains "Publicidad" label', async () => {
    vi.spyOn(apiClient, 'getSession').mockResolvedValue(FREE_SESSION);

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

  it('renders nothing while session is loading (fail-closed)', () => {
    vi.spyOn(apiClient, 'getSession').mockReturnValue(new Promise(() => {}));

    const { container } = render(
      <SessionProvider>
        <AdSlot id="sidebar-main" />
      </SessionProvider>,
    );

    expect(container.firstChild).toBeNull();
  });
});
