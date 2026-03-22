// SPF-FND-003 — Auth and Track Record response types for the unified API client.
// These mirror the V2 endpoint contracts (/api/session, /api/ui/track-record).
// Never import from pipeline packages (canonical/signals/scoring/layout/snapshot/prediction).

export interface SessionResponse {
  sessionStatus: 'authenticated' | 'anonymous' | 'expired';
  userId: string | null;
  email: string | null;
  tier: string;
  isPro: boolean;
  sessionIssuedAt: string | null;
}

export interface ReturnContextDTO {
  returnTo: string;
  intent?: {
    type: 'pro_depth' | 'auth_entry' | 'checkout_return';
    competitionId?: string;
    matchId?: string;
    depthKey?: string;
  };
}

export interface MagicLinkStartResponse {
  requestAccepted: boolean;
  cooldownSeconds: number;
}

export interface MagicLinkCompleteResponse {
  session: SessionResponse;
  resume: ReturnContextDTO;
}

export interface TrackRecordResponse {
  competitionId: string;
  state: 'available' | 'below_threshold' | 'unavailable';
  evaluationType: string | null;
  disclosureMessageKey: string | null;
  accuracy: number | null;
  totalPredictions: number | null;
  correctPredictions: number | null;
  thresholdRequired: number;
}

// ── Commerce types (WP-10) ────────────────────────────────────────────────────

export interface CheckoutSessionResponse {
  checkoutSessionId: string;
  checkoutUrl: string;
}

export interface ReconcileResponse {
  result: 'reconciled' | 'pending' | 'reauth_required';
  session?: SessionResponse;
}

export interface SubscriptionStatusResponse {
  userId: string;
  tier: string;
  state: 'inactive' | 'active' | 'grace' | 'pending_reconcile';
  entitlementUpdatedAt: string;
}
