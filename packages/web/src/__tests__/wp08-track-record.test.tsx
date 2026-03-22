// WP-08 — Tests for SPF-TR-001 (track record states) and SPF-TR-002 (disclosure rendering)
// Branch: reingenieria/v2
// Acceptance: K-03

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { TrackRecordPage } from '../pages/TrackRecordPage.js';
import { CompetitionProvider } from '../contexts/CompetitionContext.js';
import { apiClient } from '../api/client.js';
import type { TrackRecordResponse } from '../types/auth.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const COMP_PD = { id: 'comp:football-data:PD', code: 'PD', isTournament: false, enabled: true };
const COMP_PL = { id: 'comp:football-data:PL', code: 'PL', isTournament: false, enabled: true };

function renderWithProvider(
  ui: React.ReactElement,
  competitions = [COMP_PD],
) {
  return render(
    <CompetitionProvider competitions={competitions}>
      {ui}
    </CompetitionProvider>,
  );
}

// ── Suite 1: useTrackRecord — API call contract ───────────────────────────────

describe('useTrackRecord — API call contract', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getTrackRecord').mockResolvedValue({
      competitionId: 'comp:football-data:PD',
      state: 'unavailable',
      evaluationType: null,
      disclosureMessageKey: null,
      accuracy: null,
      totalPredictions: null,
      correctPredictions: null,
      thresholdRequired: 200,
    } satisfies TrackRecordResponse);
  });

  it('calls apiClient.getTrackRecord with the correct competitionId', async () => {
    renderWithProvider(<TrackRecordPage />, [COMP_PD]);

    await waitFor(() => {
      expect(apiClient.getTrackRecord).toHaveBeenCalledWith(
        'comp:football-data:PD',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it('calls apiClient.getTrackRecord with first enabled competition by default', async () => {
    renderWithProvider(<TrackRecordPage />, [COMP_PL]);

    await waitFor(() => {
      expect(apiClient.getTrackRecord).toHaveBeenCalledWith(
        'comp:football-data:PL',
        expect.anything(),
      );
    });
  });
});

// ── Suite 2: State rendering ──────────────────────────────────────────────────

describe('TrackRecordPage — state rendering', () => {
  it('renders "available" state with formatted accuracy', async () => {
    vi.spyOn(apiClient, 'getTrackRecord').mockResolvedValue({
      competitionId: 'comp:football-data:PD',
      state: 'available',
      evaluationType: 'operational',
      disclosureMessageKey: null,
      accuracy: 0.567,
      totalPredictions: 342,
      correctPredictions: 194,
      thresholdRequired: 200,
    } satisfies TrackRecordResponse);

    renderWithProvider(<TrackRecordPage />, [COMP_PD]);

    await waitFor(() => {
      expect(screen.getByTestId('state-available')).toBeDefined();
    });

    const accuracyEl = screen.getByTestId('accuracy-value');
    expect(accuracyEl.textContent).toBe('56.7%');
  });

  it('renders "below_threshold" state with counts', async () => {
    vi.spyOn(apiClient, 'getTrackRecord').mockResolvedValue({
      competitionId: 'comp:football-data:PD',
      state: 'below_threshold',
      evaluationType: null,
      disclosureMessageKey: null,
      accuracy: null,
      totalPredictions: 87,
      correctPredictions: null,
      thresholdRequired: 200,
    } satisfies TrackRecordResponse);

    renderWithProvider(<TrackRecordPage />, [COMP_PD]);

    await waitFor(() => {
      expect(screen.getByTestId('state-below-threshold')).toBeDefined();
    });

    const el = screen.getByTestId('state-below-threshold');
    expect(el.textContent).toContain('87');
    expect(el.textContent).toContain('200');
    expect(el.textContent).toContain('umbral');
  });

  it('renders "unavailable" state with message', async () => {
    vi.spyOn(apiClient, 'getTrackRecord').mockResolvedValue({
      competitionId: 'comp:football-data:PD',
      state: 'unavailable',
      evaluationType: null,
      disclosureMessageKey: null,
      accuracy: null,
      totalPredictions: null,
      correctPredictions: null,
      thresholdRequired: 200,
    } satisfies TrackRecordResponse);

    renderWithProvider(<TrackRecordPage />, [COMP_PD]);

    await waitFor(() => {
      expect(screen.getByTestId('state-unavailable')).toBeDefined();
    });

    const el = screen.getByTestId('state-unavailable');
    expect(el.textContent).toContain('Sin historial disponible');
  });
});

// ── Suite 3: SPF-TR-002 — Disclosure rendering ───────────────────────────────

describe('SPF-TR-002 — Disclosure rendering', () => {
  it('renders disclosure notice when evaluationType is historical_walk_forward with known key', async () => {
    vi.spyOn(apiClient, 'getTrackRecord').mockResolvedValue({
      competitionId: 'comp:football-data:PD',
      state: 'available',
      evaluationType: 'historical_walk_forward',
      disclosureMessageKey: 'historical_walk_forward_disclosure',
      accuracy: 0.543,
      totalPredictions: 450,
      correctPredictions: 244,
      thresholdRequired: 200,
    } satisfies TrackRecordResponse);

    renderWithProvider(<TrackRecordPage />, [COMP_PD]);

    await waitFor(() => {
      expect(screen.getByTestId('disclosure-notice')).toBeDefined();
    });

    const notice = screen.getByTestId('disclosure-notice');
    expect(notice.textContent).toContain('walk-forward histórica');
    expect(notice.textContent).toContain('operacionales en producción');
  });

  it('renders the raw key as fallback for unknown disclosure keys', async () => {
    vi.spyOn(apiClient, 'getTrackRecord').mockResolvedValue({
      competitionId: 'comp:football-data:PD',
      state: 'available',
      evaluationType: 'historical_walk_forward',
      disclosureMessageKey: 'some_unknown_future_key',
      accuracy: 0.543,
      totalPredictions: 450,
      correctPredictions: 244,
      thresholdRequired: 200,
    } satisfies TrackRecordResponse);

    renderWithProvider(<TrackRecordPage />, [COMP_PD]);

    await waitFor(() => {
      expect(screen.getByTestId('disclosure-notice')).toBeDefined();
    });

    const notice = screen.getByTestId('disclosure-notice');
    expect(notice.textContent).toContain('some_unknown_future_key');
  });

  it('does NOT render disclosure notice when evaluationType is operational', async () => {
    vi.spyOn(apiClient, 'getTrackRecord').mockResolvedValue({
      competitionId: 'comp:football-data:PD',
      state: 'available',
      evaluationType: 'operational',
      disclosureMessageKey: null,
      accuracy: 0.543,
      totalPredictions: 450,
      correctPredictions: 244,
      thresholdRequired: 200,
    } satisfies TrackRecordResponse);

    renderWithProvider(<TrackRecordPage />, [COMP_PD]);

    await waitFor(() => {
      expect(screen.getByTestId('state-available')).toBeDefined();
    });

    expect(screen.queryByTestId('disclosure-notice')).toBeNull();
  });

  it('does NOT render disclosure notice when state is below_threshold', async () => {
    vi.spyOn(apiClient, 'getTrackRecord').mockResolvedValue({
      competitionId: 'comp:football-data:PD',
      state: 'below_threshold',
      evaluationType: 'historical_walk_forward',
      disclosureMessageKey: 'historical_walk_forward_disclosure',
      accuracy: null,
      totalPredictions: 50,
      correctPredictions: null,
      thresholdRequired: 200,
    } satisfies TrackRecordResponse);

    renderWithProvider(<TrackRecordPage />, [COMP_PD]);

    await waitFor(() => {
      expect(screen.getByTestId('state-below-threshold')).toBeDefined();
    });

    expect(screen.queryByTestId('disclosure-notice')).toBeNull();
  });

  it('renders disclosure notice with unknown evaluationType when disclosureMessageKey is non-null (forward-compat)', async () => {
    // Spec: disclosureMessageKey must be renderable without frontend heuristics.
    // The disclosure must appear even if evaluationType is a future/unknown value.
    vi.spyOn(apiClient, 'getTrackRecord').mockResolvedValue({
      competitionId: 'comp:football-data:PD',
      state: 'available',
      evaluationType: 'some_future_eval_type',
      disclosureMessageKey: 'historical_walk_forward_disclosure',
      accuracy: 0.543,
      totalPredictions: 450,
      correctPredictions: 244,
      thresholdRequired: 200,
    } satisfies TrackRecordResponse);

    renderWithProvider(<TrackRecordPage />, [COMP_PD]);

    await waitFor(() => {
      expect(screen.getByTestId('state-available')).toBeDefined();
    });

    // disclosure-notice MUST appear — driven solely by disclosureMessageKey being non-null
    expect(screen.getByTestId('disclosure-notice')).toBeDefined();
  });
});

// ── Suite 4: Error state ──────────────────────────────────────────────────────

describe('TrackRecordPage — error state', () => {
  it('renders error message when fetch fails', async () => {
    vi.spyOn(apiClient, 'getTrackRecord').mockRejectedValue(new Error('Network error'));

    renderWithProvider(<TrackRecordPage />, [COMP_PD]);

    await waitFor(() => {
      expect(screen.getByTestId('track-record-error')).toBeDefined();
    });
  });
});
