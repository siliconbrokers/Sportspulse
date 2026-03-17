/**
 * PE-78 UI Tests — PredictionExperimentalSection
 *
 * UI1: 404 (flag off or no prediction) → no render, clean absence
 * UI2: LIMITED_MODE → degradation notice visible, markets shown if available
 * UI3: FULL_MODE → markets visible (O/U, BTTS, xG, scorelines), no degradation notice
 *
 * Stabilization gate requirement: validate the visible representation
 * of the experimental section, not just the API layer.
 *
 * Spec authority: PE-78 rollout doc, PredictionExperimentalSection.tsx
 * NOTE: 1X2 block is intentionally absent from ExperimentalSection (shown in PronosticoCard radar).
 * NOTE: "Resultado esperado" row was removed per design decision (duplicate with card header).
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

function makeMarkets(xgHome = 1.8, xgAway = 1.2) {
  return {
    over_under: { over_0_5: 0.95, under_0_5: 0.05, over_1_5: 0.80, under_1_5: 0.20, over_2_5: 0.55, under_2_5: 0.45, over_3_5: 0.30, under_3_5: 0.70, over_4_5: 0.15, under_4_5: 0.85 },
    btts: { yes: 0.52, no: 0.48 },
    double_chance: { home_or_draw: 0.72, draw_or_away: 0.55, home_or_away: 0.73 },
    dnb: { home: 0.62, away: 0.38 },
    asian_handicap: { home_minus_half: 0.45, home_plus_half: 0.72, away_minus_half: 0.28, away_plus_half: 0.55 },
    expected_goals: { home: xgHome, away: xgAway, total: xgHome + xgAway, implied_goal_line: 2.5 },
    top_scorelines: [
      { home: 1, away: 1, probability: 0.13 },
      { home: 2, away: 1, probability: 0.11 },
      { home: 1, away: 0, probability: 0.10 },
    ],
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
    markets: makeMarkets(1.8, 1.2),
    signals: null,
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
    markets: makeMarkets(1.6, 1.1),
    signals: null,
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
      // Label is now "Goles esperados" inside MarketsPanel
      expect(screen.getByText('Goles esperados')).toBeInTheDocument();
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
  it('shows market sections in FULL_MODE', async () => {
    vi.stubGlobal('fetch', mockFetchOk(fullModePayload()));

    render(<PredictionExperimentalSection {...makeProps()} />);

    await waitFor(() => {
      // MarketsPanel renders with O/U section (1X2 is intentionally omitted — shown in PronosticoCard radar)
      expect(screen.getByText('Over / Under 2.5')).toBeInTheDocument();
    });
    expect(screen.getByText('Anotan ambos equipos')).toBeInTheDocument();
  });

  it('shows expected goals in FULL_MODE', async () => {
    vi.stubGlobal('fetch', mockFetchOk(fullModePayload()));

    render(<PredictionExperimentalSection {...makeProps()} />);

    await waitFor(() => {
      // xG section is now labeled "Goles esperados" inside MarketsPanel
      expect(screen.getByText('Goles esperados')).toBeInTheDocument();
    });
    expect(document.body.textContent).toContain('1.80');
    expect(document.body.textContent).toContain('1.20');
  });

  it('does NOT show "Resultado esperado" row (removed — shown in card header)', async () => {
    vi.stubGlobal('fetch', mockFetchOk(fullModePayload()));

    render(<PredictionExperimentalSection {...makeProps()} />);

    await waitFor(() => {
      expect(screen.getByText('Over / Under 2.5')).toBeInTheDocument();
    });

    expect(screen.queryByText(/resultado esperado/i)).toBeNull();
  });

  it('does NOT show degradation notice in FULL_MODE', async () => {
    vi.stubGlobal('fetch', mockFetchOk(fullModePayload()));

    render(<PredictionExperimentalSection {...makeProps()} />);

    await waitFor(() => {
      expect(screen.getByText('Over / Under 2.5')).toBeInTheDocument();
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
