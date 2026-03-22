// SPF-AUTH-001 — Session hydration provider
// Branch: reingenieria/v2 · Acceptance: K-01, K-06
//
// Rules:
//  - Anonymous-first: initial state is anonymous + loading:true, never forces auth
//  - isPro is NEVER inferred locally — only from SessionDTO
//  - On error, fall back to anonymous (never break the portal)
//  - fail-closed: while loading === true, isPro === false
//
// Never import from pipeline packages.

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { apiClient } from '../api/client.js';

// ── Context shape ─────────────────────────────────────────────────────────────

export interface SessionContextValue {
  sessionStatus: 'anonymous' | 'authenticated' | 'expired';
  userId: string | null;
  email: string | null;
  tier: string;
  isPro: boolean;
  loading: boolean;
  refresh: () => void;
}

const ANONYMOUS_STATE: SessionContextValue = {
  sessionStatus: 'anonymous',
  userId: null,
  email: null,
  tier: 'free',
  isPro: false,
  loading: true,
  refresh: () => {},
};

const SessionContext = createContext<SessionContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<SessionContextValue, 'refresh'>>({
    sessionStatus: 'anonymous',
    userId: null,
    email: null,
    tier: 'free',
    isPro: false,
    loading: true,
  });

  const fetchSession = useCallback(() => {
    const controller = new AbortController();

    setState((prev) => ({ ...prev, loading: true }));

    apiClient
      .getSession({ signal: controller.signal })
      .then((dto) => {
        setState({
          sessionStatus: dto.sessionStatus,
          userId: dto.userId,
          email: dto.email,
          tier: dto.tier,
          isPro: dto.isPro,
          loading: false,
        });
      })
      .catch((err) => {
        // AbortError means the component unmounted — do not update state
        if (err instanceof Error && err.name === 'AbortError') return;
        // Any other error: fall back to anonymous (never break the portal)
        setState({
          sessionStatus: 'anonymous',
          userId: null,
          email: null,
          tier: 'free',
          isPro: false,
          loading: false,
        });
      });

    return controller;
  }, []);

  useEffect(() => {
    const controller = fetchSession();
    return () => controller.abort();
  }, [fetchSession]);

  const refresh = useCallback(() => {
    fetchSession();
  }, [fetchSession]);

  const value: SessionContextValue = { ...state, refresh };

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (ctx === null) {
    throw new Error('useSession must be used inside <SessionProvider>');
  }
  return ctx;
}
