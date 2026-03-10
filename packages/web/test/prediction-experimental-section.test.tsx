/**
 * PE-78 UI Tests — PredictionExperimentalSection
 *
 * UI1: 404 (flag off or no prediction) → no render, clean absence
 * UI2: LIMITED_MODE → degradation notice visible, no 1X2 probs
 * UI3: FULL_MODE → probabilities visible, no degradation notice
 *
 * Stabilization gate requirement: validate the visible representation
 * of the experimental section, not just the API layer.
 *
 * Spec authority: PE-78 rollout doc, PredictionExperimentalSection.tsx
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PredictionExperimentalSection } from '../src/components/PredictionExperimentalSection.js';

// ── Test data factories ───────────────────────────────────────────────────────

const MATCH_ID = 'match:football-data:544570';
const COMP_ID = 'comp:football-data:PD';
const HOME = 'Real Madrid';
const AWAY = 'FC Barcelona';

function makeProps(overrides: Partial<{
  matchId: string | null;
  competitionId: string;
}> = {}) {
  return {
    matchId: MATCH_ID,
    competitionId: COMP_ID,
    homeTeamName: HOME,
    awayTeamName: AWAY,
    ...overrides,
  };
}

function fullModePayload() {
  return {
    match_id: MATCH_ID,
    competition_id: COMP_ID,
    mode: 'FULL_MODE',
    calibration_mode: 'calibrated',
    reasons: [],
    p_home_win: 0.45,
    p_draw: 0.27,
    p_away_win: 0.28,
    predicted_result: 'HOME',
    expected_goals_home: 1.8,
    expected_goals_away: 1.2,
    generated_at: '2026-03-10T03:00:00Z',
    engine_version: '1.3',
  };
}

function limitedModePayload() {
  return {
    match_id: MATCH_ID,
    competition_id: COMP_ID,
    mode: 'LIMITED_MODE',
    calibration_mode: 'bootstrap',
    reasons: ['INSUFFICIENT_BILATERAL_HISTORY'],
    p_home_win: null,
    p_draw: null,
    p_away_win: null,
    predicted_result: null,
    expected_goals_home: 1.6,
    expected_goals_away: 1.1,
    generated_at: '2026-03-10T03:00:00Z',
    engine_version: '1.3',
  };
}

/** Returns a mock fetch that resolves with the given payload (status 200). */
function mockFetchOk(payload: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(payload),
  });
}

/** Returns a mock fetch that resolves with 404. */
function mockFetch404() {
  return vi.fn().mockResolvedValue({
    ok: false,
    status: 404,
  });
}

/** Returns a mock fetch that rejects with a network error. */
function mockFetchError() {
  return vi.fn().mockRejectedValue(new Error('Network error'));
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// UI1 — 404 / flag off → no render, clean absence
// ─────────────────────────────────────────────────────────────────────────────

describe('UI1: no render on 404 or error', () => {
  it('renders nothing when endpoint returns 404 (flag off or no prediction)', async () => {
    vi.stubGlobal('fetch', mockFetch404());

    const { container } = render(<PredictionExperimentalSection {...makeProps()} />);

    // Wait for the effect to resolve
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('renders nothing on network error', async () => {
    vi.stubGlobal('fetch', mockFetchError());

    const { container } = render(<PredictionExperimentalSection {...makeProps()} />);

    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('renders nothing when matchId is null', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(
      <PredictionExperimentalSection {...makeProps({ matchId: null })} />,
    );

    // fetch must not even be called
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.firstChild).toBeNull();
  });

  it('DetailPanel-compatible: section is absent, no broken fallback in DOM', async () => {
    vi.stubGlobal('fetch', mockFetch404());

    const { container } = render(<PredictionExperimentalSection {...makeProps()} />);

    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });

    // No error boundaries, no loading skeletons, no stale data
    expect(screen.queryByText(/pronostico del motor/i)).toBeNull();
    expect(screen.queryByText(/experimental/i)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UI2 — LIMITED_MODE → degradation notice + only allowed fields
// ─────────────────────────────────────────────────────────────────────────────

describe('UI2: LIMITED_MODE — degradation notice + permitted fields only', () => {
  it('shows degradation notice for LIMITED_MODE', async () => {
    vi.stubGlobal('fetch', mockFetchOk(limitedModePayload()));

    render(<PredictionExperimentalSection {...makeProps()} />);

    await waitFor(() => {
      expect(screen.getByText(/modo limitado/i)).toBeInTheDocument();
    });
  });

  it('shows expected goals when available in LIMITED_MODE', async () => {
    vi.stubGlobal('fetch', mockFetchOk(limitedModePayload()));

    render(<PredictionExperimentalSection {...makeProps()} />);

    await waitFor(() => {
      // Label is exact "xG" (only the row label span)
      expect(screen.getByText('xG')).toBeInTheDocument();
    });
    // Values appear somewhere in the document
    expect(document.body.textContent).toContain('1.60');
    expect(document.body.textContent).toContain('1.10');
  });

  it('does NOT show 1X2 probabilities in LIMITED_MODE (they are null)', async () => {
    vi.stubGlobal('fetch', mockFetchOk(limitedModePayload()));

    render(<PredictionExperimentalSection {...makeProps()} />);

    await waitFor(() => {
      // Wait for section to appear
      expect(screen.getByText(/modo limitado/i)).toBeInTheDocument();
    });

    // 1X2 row must be absent when all probs are null
    expect(screen.queryByText(/^1X2$/i)).toBeNull();
  });

  it('shows experimental badge and section header in LIMITED_MODE', async () => {
    vi.stubGlobal('fetch', mockFetchOk(limitedModePayload()));

    render(<PredictionExperimentalSection {...makeProps()} />);

    await waitFor(() => {
      expect(screen.getByText(/pronostico del motor/i)).toBeInTheDocument();
      expect(screen.getByText(/experimental/i)).toBeInTheDocument();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UI3 — FULL_MODE → probabilities visible, no degradation notice
// ─────────────────────────────────────────────────────────────────────────────

describe('UI3: FULL_MODE — probabilities visible, no degradation notice', () => {
  it('shows 1X2 probabilities in FULL_MODE', async () => {
    vi.stubGlobal('fetch', mockFetchOk(fullModePayload()));

    render(<PredictionExperimentalSection {...makeProps()} />);

    await waitFor(() => {
      expect(screen.getByText('1X2')).toBeInTheDocument();
    });
    // Probabilities appear somewhere in the document
    expect(document.body.textContent).toContain('45%');
    expect(document.body.textContent).toContain('27%');
    expect(document.body.textContent).toContain('28%');
  });

  it('shows expected goals in FULL_MODE', async () => {
    vi.stubGlobal('fetch', mockFetchOk(fullModePayload()));

    render(<PredictionExperimentalSection {...makeProps()} />);

    await waitFor(() => {
      expect(screen.getByText('xG')).toBeInTheDocument();
    });
    expect(document.body.textContent).toContain('1.80');
    expect(document.body.textContent).toContain('1.20');
  });

  it('shows predicted result label using team name for HOME win', async () => {
    vi.stubGlobal('fetch', mockFetchOk(fullModePayload()));

    render(<PredictionExperimentalSection {...makeProps()} />);

    await waitFor(() => {
      expect(screen.getByText('Resultado esperado')).toBeInTheDocument();
      // predicted_result = 'HOME' → should resolve to homeTeamName
      expect(screen.getByText(HOME)).toBeInTheDocument();
    });
  });

  it('does NOT show degradation notice in FULL_MODE', async () => {
    vi.stubGlobal('fetch', mockFetchOk(fullModePayload()));

    render(<PredictionExperimentalSection {...makeProps()} />);

    await waitFor(() => {
      expect(screen.getByText('1X2')).toBeInTheDocument();
    });

    expect(screen.queryByText(/modo limitado/i)).toBeNull();
    expect(screen.queryByText(/sin datos suficientes/i)).toBeNull();
  });

  it('shows engine footer in FULL_MODE', async () => {
    vi.stubGlobal('fetch', mockFetchOk(fullModePayload()));

    render(<PredictionExperimentalSection {...makeProps()} />);

    await waitFor(() => {
      expect(screen.getByText(/Motor v1\.3/)).toBeInTheDocument();
    });
  });
});
