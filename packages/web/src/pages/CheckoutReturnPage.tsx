// SPF-SUB-002 — Checkout return page
// Branch: reingenieria/v2 · Acceptance: K-05
//
// URL: /checkout/return?session_id={checkoutSessionId}
// Stripe appends ?session_id=... to the return URL.
//
// Behavior:
//  - Reads session_id from URL search params
//  - Calls postReconcile(checkoutSessionId)
//  - On 'reconciled': calls refresh() then shows success
//  - On 'pending': shows processing message
//  - On 'reauth_required': shows reauth message
//  - On 409 CHECKOUT_NOT_PAID: shows payment not completed message
//  - On other errors: shows generic error
//
// Invariant: pending_reconcile does NOT call refresh() — only 'reconciled' does.
//
// Never import from pipeline packages.

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { useSession } from '../auth/SessionProvider.js';
import { apiClient, ApiError } from '../api/client.js';

// ── Types ─────────────────────────────────────────────────────────────────────

type PageState =
  | { phase: 'loading' }
  | { phase: 'no_session_id' }
  | { phase: 'success' }
  | { phase: 'pending' }
  | { phase: 'reauth_required' }
  | { phase: 'not_paid' }
  | { phase: 'error'; message: string };

// ── Component ─────────────────────────────────────────────────────────────────

export function CheckoutReturnPage() {
  const [searchParams] = useSearchParams();
  const { refresh } = useSession();
  const [state, setState] = useState<PageState>({ phase: 'loading' });

  useEffect(() => {
    const checkoutSessionId = searchParams.get('session_id');

    if (!checkoutSessionId) {
      setState({ phase: 'no_session_id' });
      return;
    }

    const controller = new AbortController();

    apiClient
      .postReconcile(checkoutSessionId, { signal: controller.signal })
      .then((res) => {
        if (res.result === 'reconciled') {
          // Only call refresh after authoritative entitlement confirmation
          refresh();
          setState({ phase: 'success' });
        } else if (res.result === 'pending') {
          setState({ phase: 'pending' });
        } else {
          // reauth_required
          setState({ phase: 'reauth_required' });
        }
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (err instanceof ApiError) {
          if (err.code === 'CHECKOUT_NOT_PAID') {
            setState({ phase: 'not_paid' });
          } else {
            setState({
              phase: 'error',
              message: 'Error al verificar el pago. Contacta soporte si el problema persiste.',
            });
          }
        } else {
          setState({
            phase: 'error',
            message: 'Error al verificar el pago. Contacta soporte si el problema persiste.',
          });
        }
      });

    return () => controller.abort();
    // refresh is stable (useCallback), searchParams triggers when URL changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center gap-6 px-4"
      style={{ backgroundColor: 'var(--sp-bg)' }}
      data-testid="checkout-return-page"
    >
      {state.phase === 'loading' && (
        <>
          <Loader2
            className="animate-spin"
            size={32}
            style={{ color: 'var(--sp-text-40)' }}
          />
          <p className="text-sm" style={{ color: 'var(--sp-text-40)' }}>
            Verificando pago...
          </p>
        </>
      )}

      {state.phase === 'no_session_id' && (
        <div
          className="flex flex-col items-center gap-3 text-center max-w-sm"
          data-testid="checkout-return-no-session-id"
        >
          <AlertCircle size={32} style={{ color: 'var(--sp-danger, #ef4444)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--sp-text)' }}>
            Parámetro de sesión no encontrado.
          </p>
          <Link
            to="/"
            className="text-sm underline"
            style={{ color: 'var(--sp-primary)' }}
          >
            Volver al inicio
          </Link>
        </div>
      )}

      {state.phase === 'success' && (
        <div
          className="flex flex-col items-center gap-3 text-center max-w-sm"
          data-testid="checkout-return-success"
        >
          <CheckCircle size={32} style={{ color: 'var(--sp-success, #22c55e)' }} />
          <h1 className="text-lg font-semibold" style={{ color: 'var(--sp-text)' }}>
            ¡Bienvenido a SportPulse Pro!
          </h1>
          <p className="text-sm" style={{ color: 'var(--sp-text-40)' }}>
            Tu suscripción está activa.
          </p>
          <Link
            to="/"
            className="text-sm font-semibold underline"
            style={{ color: 'var(--sp-primary)' }}
          >
            Ir al dashboard
          </Link>
        </div>
      )}

      {state.phase === 'pending' && (
        <div
          className="flex flex-col items-center gap-3 text-center max-w-sm"
          data-testid="checkout-return-pending"
        >
          <Clock size={32} style={{ color: 'var(--sp-text-40)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--sp-text)' }}>
            Tu pago está siendo procesado. Te notificaremos cuando esté confirmado.
          </p>
          <Link
            to="/"
            className="text-sm underline"
            style={{ color: 'var(--sp-primary)' }}
          >
            Volver al inicio
          </Link>
        </div>
      )}

      {state.phase === 'reauth_required' && (
        <div
          className="flex flex-col items-center gap-3 text-center max-w-sm"
          data-testid="checkout-return-reauth"
        >
          <AlertCircle size={32} style={{ color: 'var(--sp-text-40)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--sp-text)' }}>
            Tu sesión expiró durante el proceso de pago. Inicia sesión de nuevo.
          </p>
          <Link
            to="/"
            className="text-sm underline"
            style={{ color: 'var(--sp-primary)' }}
          >
            Volver al inicio
          </Link>
        </div>
      )}

      {state.phase === 'not_paid' && (
        <div
          className="flex flex-col items-center gap-3 text-center max-w-sm"
          data-testid="checkout-return-not-paid"
        >
          <AlertCircle size={32} style={{ color: 'var(--sp-danger, #ef4444)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--sp-text)' }}>
            El pago no se completó. Puedes intentarlo de nuevo.
          </p>
          <Link
            to="/"
            className="text-sm underline"
            style={{ color: 'var(--sp-primary)' }}
          >
            Volver al inicio
          </Link>
        </div>
      )}

      {state.phase === 'error' && (
        <div
          className="flex flex-col items-center gap-3 text-center max-w-sm"
          data-testid="checkout-return-error"
        >
          <AlertCircle size={32} style={{ color: 'var(--sp-danger, #ef4444)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--sp-text)' }}>
            {state.message}
          </p>
          <Link
            to="/"
            className="text-sm underline"
            style={{ color: 'var(--sp-primary)' }}
          >
            Volver al inicio
          </Link>
        </div>
      )}
    </div>
  );
}
