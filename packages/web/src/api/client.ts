// SPF-FND-003 — Unified typed API client.
// Acceptance: pre-condition for K-03 (track-record), K-06 (session), K-04/K-05 (checkout)
//
// Hard rules:
//   - NEVER import from @sportpulse/canonical, @sportpulse/signals, @sportpulse/scoring,
//     @sportpulse/layout, @sportpulse/snapshot, @sportpulse/prediction.
//   - All response types come from packages/web/src/types/ or are defined inline below.
//
// Existing hooks are NOT migrated here (migration in WP-09+).
// This file establishes the client contract only.

import type { DashboardSnapshotDTO } from '../types/snapshot.js';
import type { TeamDetailDTO } from '../types/team-detail.js';
import type { StandingEntry } from '../hooks/use-standings.js';
import type { CompetitionInfo } from '../hooks/use-competition-info.js';
import type { NewsFeed } from '../hooks/use-news.js';
import type { VideoFeed } from '../hooks/use-videos.js';
import type { EventosFeed } from '../hooks/use-events.js';
import type { PortalConfig } from '../hooks/use-portal-config.js';
import type {
  SessionResponse,
  TrackRecordResponse,
  ReturnContextDTO,
  MagicLinkStartResponse,
  MagicLinkCompleteResponse,
  CheckoutSessionResponse,
  ReconcileResponse,
  SubscriptionStatusResponse,
} from '../types/auth.js';

// ── Typed error ─────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── Internal helpers ─────────────────────────────────────────────────────────

async function request<T>(url: string, opts?: { signal?: AbortSignal }): Promise<T> {
  const res = await fetch(url, opts?.signal ? { signal: opts.signal } : undefined);
  if (!res.ok) {
    let code: string | undefined;
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string; code?: string } };
      code = body?.error?.code;
      if (body?.error?.message) message = body.error.message;
    } catch {
      // ignore parse failures
    }
    throw new ApiError(res.status, message, code);
  }
  return res.json() as Promise<T>;
}

async function post<T>(url: string, body: unknown, opts?: { signal?: AbortSignal }): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(opts?.signal ? { signal: opts.signal } : {}),
  });
  if (!res.ok) {
    let code: string | undefined;
    let message = `HTTP ${res.status}`;
    try {
      const errBody = (await res.json()) as { error?: { message?: string; code?: string } };
      code = errBody?.error?.code;
      if (errBody?.error?.message) message = errBody.error.message;
    } catch {
      // ignore parse failures
    }
    throw new ApiError(res.status, message, code);
  }
  // Some POST endpoints return 204 No Content
  const contentType = res.headers.get('content-type') ?? '';
  if (res.status === 204 || !contentType.includes('application/json')) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

function buildUrl(
  base: string,
  params: Record<string, string | number | undefined | null>,
): string {
  const sp = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null) {
      sp.set(key, String(val));
    }
  }
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

// ── Request param types ───────────────────────────────────────────────────────

export interface TeamDetailParams {
  competitionId: string;
  teamId: string;
  timezone: string;
  matchday?: number | null;
  dateLocal?: string | null;
  subTournamentKey?: string | null;
}

// ── API client ────────────────────────────────────────────────────────────────

export const apiClient = {
  /**
   * GET /api/ui/dashboard
   * Returns the treemap snapshot DTO for a given competition and matchday.
   */
  getDashboard(
    competitionId: string,
    matchday: number | null,
    opts?: {
      signal?: AbortSignal;
      timezone?: string;
      dateLocal?: string;
      subTournamentKey?: string;
    },
  ): Promise<DashboardSnapshotDTO> {
    const url = buildUrl('/api/ui/dashboard', {
      competitionId,
      timezone: opts?.timezone ?? 'America/Montevideo',
      matchday: matchday ?? undefined,
      dateLocal: opts?.dateLocal,
      subTournament: opts?.subTournamentKey,
    });
    return request<DashboardSnapshotDTO>(url, opts);
  },

  /**
   * GET /api/ui/team
   * Returns the team detail projection for a specific team in a competition.
   */
  getTeamDetail(params: TeamDetailParams, opts?: { signal?: AbortSignal }): Promise<TeamDetailDTO> {
    const url = buildUrl('/api/ui/team', {
      competitionId: params.competitionId,
      teamId: params.teamId,
      timezone: params.timezone,
      matchday: params.matchday ?? undefined,
      dateLocal: params.dateLocal ?? undefined,
      subTournamentKey: params.subTournamentKey ?? undefined,
    });
    return request<TeamDetailDTO>(url, opts);
  },

  /**
   * GET /api/ui/standings
   * Returns the league standings table.
   */
  getStandings(
    competitionId: string,
    subTournamentKey?: string,
    opts?: { signal?: AbortSignal },
  ): Promise<{ standings: StandingEntry[] }> {
    const url = buildUrl('/api/ui/standings', {
      competitionId,
      subTournament: subTournamentKey,
    });
    return request<{ standings: StandingEntry[] }>(url, opts);
  },

  /**
   * GET /api/ui/competition-info
   * Returns matchday info and sub-tournament list for a competition.
   */
  getCompetitionInfo(
    competitionId: string,
    subTournamentKey?: string,
    opts?: { signal?: AbortSignal },
  ): Promise<CompetitionInfo> {
    const url = buildUrl('/api/ui/competition-info', {
      competitionId,
      subTournament: subTournamentKey,
    });
    return request<CompetitionInfo>(url, opts);
  },

  /**
   * GET /api/ui/news
   * Returns the news feed. competitionId is passed as a query param for future scoping.
   */
  getNews(competitionId: string, opts?: { signal?: AbortSignal }): Promise<NewsFeed> {
    const url = buildUrl('/api/ui/news', { competitionId });
    return request<NewsFeed>(url, opts);
  },

  /**
   * GET /api/ui/videos
   * Returns the video highlights feed. competitionId is passed for future scoping.
   */
  getVideos(competitionId: string, opts?: { signal?: AbortSignal }): Promise<VideoFeed> {
    const url = buildUrl('/api/ui/videos', { competitionId });
    return request<VideoFeed>(url, opts);
  },

  /**
   * GET /api/ui/eventos
   * Returns the streaming events list.
   */
  getEventos(opts?: { signal?: AbortSignal }): Promise<EventosFeed> {
    return request<EventosFeed>('/api/ui/eventos', opts);
  },

  /**
   * GET /api/ui/track-record
   * Returns the prediction track record disclosure for a competition.
   * V2 endpoint — implemented in WP-08+.
   */
  getTrackRecord(
    competitionId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<TrackRecordResponse> {
    const url = buildUrl('/api/ui/track-record', { competitionId });
    return request<TrackRecordResponse>(url, opts);
  },

  /**
   * GET /api/session
   * Returns the current auth session state.
   * V2 endpoint — implemented in WP-09+.
   */
  getSession(opts?: { signal?: AbortSignal }): Promise<SessionResponse> {
    return request<SessionResponse>('/api/session', opts);
  },

  /**
   * GET /api/ui/portal-config
   * Returns the portal configuration (enabled competitions, features).
   */
  getPortalConfig(opts?: { signal?: AbortSignal }): Promise<PortalConfig> {
    return request<PortalConfig>('/api/ui/portal-config', opts);
  },

  /**
   * POST /api/auth/magic-link/start
   * Requests a magic-link email for the given address.
   * Returns 202 { requestAccepted, cooldownSeconds } on success.
   * Throws ApiError with code MAGIC_LINK_RATE_LIMITED on 429.
   */
  postMagicLinkStart(
    email: string,
    returnContext: ReturnContextDTO,
    opts?: { signal?: AbortSignal },
  ): Promise<MagicLinkStartResponse> {
    return post<MagicLinkStartResponse>(
      '/api/auth/magic-link/start',
      { email, returnContext },
      opts,
    );
  },

  /**
   * POST /api/auth/magic-link/complete
   * Completes the magic-link flow with the one-time token from the email.
   * Returns { session: SessionResponse, resume: ReturnContextDTO } on success.
   * Throws ApiError with code INVALID_TOKEN / TOKEN_EXPIRED / TOKEN_ALREADY_USED.
   */
  postMagicLinkComplete(
    token: string,
    opts?: { signal?: AbortSignal },
  ): Promise<MagicLinkCompleteResponse> {
    return post<MagicLinkCompleteResponse>('/api/auth/magic-link/complete', { token }, opts);
  },

  /**
   * POST /api/auth/logout
   * Invalidates the current session cookie / token.
   */
  postLogout(opts?: { signal?: AbortSignal }): Promise<void> {
    return post<void>('/api/auth/logout', {}, opts);
  },

  /**
   * POST /api/checkout/session
   * Creates a Stripe checkout session. Requires authenticated session.
   * Errors: 401 SESSION_REQUIRED, 400 INVALID_PLAN_KEY, 409 ALREADY_ENTITLED,
   *         503 CHECKOUT_PROVIDER_UNAVAILABLE
   */
  postCheckoutSession(
    planKey: string,
    returnContext: ReturnContextDTO,
    opts?: { signal?: AbortSignal },
  ): Promise<CheckoutSessionResponse> {
    return post<CheckoutSessionResponse>('/api/checkout/session', { planKey, returnContext }, opts);
  },

  /**
   * POST /api/checkout/return/reconcile
   * Called on return from Stripe to confirm entitlement.
   * Errors: 400 INVALID_CHECKOUT_SESSION_ID, 401 SESSION_REQUIRED,
   *         409 CHECKOUT_OWNER_MISMATCH, 409 CHECKOUT_NOT_PAID,
   *         503 RECONCILE_UNAVAILABLE
   */
  postReconcile(
    checkoutSessionId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<ReconcileResponse> {
    return post<ReconcileResponse>('/api/checkout/return/reconcile', { checkoutSessionId }, opts);
  },

  /**
   * GET /api/subscription/status
   * Returns subscription state for the authenticated user.
   * Errors: 401 SESSION_REQUIRED, 503 ENTITLEMENT_STATUS_UNAVAILABLE
   */
  getSubscriptionStatus(opts?: { signal?: AbortSignal }): Promise<SubscriptionStatusResponse> {
    return request<SubscriptionStatusResponse>('/api/subscription/status', opts);
  },

  /**
   * POST /api/subscription/refresh-entitlement
   * Forces a backend entitlement refresh for the authenticated user.
   * Errors: 401 SESSION_REQUIRED, 503 ENTITLEMENT_REFRESH_UNAVAILABLE
   */
  postRefreshEntitlement(opts?: { signal?: AbortSignal }): Promise<void> {
    return post<void>('/api/subscription/refresh-entitlement', {}, opts);
  },
};
