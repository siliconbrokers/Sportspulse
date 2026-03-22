// SPF-SUB-001 — Paywall trigger component
// Branch: reingenieria/v2 · Acceptance: K-04, K-05
//
// Invariants:
//  - Renders nothing while loading === true (fail-closed, no content flicker)
//  - Renders nothing when isPro === true
//  - isPro is NEVER set locally — only useSession().refresh() updates it
//  - pending_reconcile does NOT unlock Pro
//
// Never import from pipeline packages.

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useSession } from '../auth/SessionProvider.js';
import { MagicLinkForm } from '../auth/MagicLinkForm.js';
import { apiClient, ApiError } from '../api/client.js';
import type { ReturnContextDTO } from '../types/auth.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PaywallProps {
  returnContext?: ReturnContextDTO;
  onDismiss?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Paywall({ returnContext, onDismiss }: PaywallProps) {
  const { sessionStatus, isPro, loading, refresh } = useSession();
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Fail-closed: render nothing while session is unresolved
  if (loading) return null;

  // Already Pro — nothing to show
  if (isPro) return null;

  const effectiveReturnContext: ReturnContextDTO = returnContext ?? {
    returnTo: typeof window !== 'undefined' ? window.location.pathname : '/',
    intent: { type: 'checkout_return' },
  };

  // Anonymous: prompt sign-in first
  if (sessionStatus === 'anonymous') {
    return (
      <div
        className="w-full max-w-sm mx-auto flex flex-col gap-4 p-6 rounded-2xl"
        style={{
          background: 'var(--sp-surface)',
          border: '1px solid var(--sp-border-8)',
        }}
        data-testid="paywall-signin"
      >
        <div className="flex flex-col gap-1 text-center">
          <h2 className="text-base font-semibold" style={{ color: 'var(--sp-text)' }}>
            Inicia sesión para mejorar tu plan
          </h2>
          <p className="text-sm" style={{ color: 'var(--sp-text-40)' }}>
            Necesitas una cuenta para suscribirte a SportPulse Pro.
          </p>
        </div>
        <MagicLinkForm returnContext={effectiveReturnContext} />
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-xs text-center"
            style={{ color: 'var(--sp-text-40)', background: 'none', border: 'none', cursor: 'pointer' }}
            data-testid="paywall-dismiss"
          >
            Cancelar
          </button>
        )}
      </div>
    );
  }

  // Authenticated + not Pro: show upgrade CTA
  async function handleStartSubscription() {
    setCheckoutError(null);
    setCheckoutLoading(true);
    try {
      const res = await apiClient.postCheckoutSession('pro_monthly', effectiveReturnContext);
      window.location.href = res.checkoutUrl;
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'ALREADY_ENTITLED') {
          // Session was stale — refresh and dismiss
          refresh();
          onDismiss?.();
          return;
        }
        if (err.status === 503) {
          setCheckoutError('Servicio no disponible. Intenta más tarde.');
        } else if (err.status === 401) {
          setCheckoutError('Sesión expirada. Recarga la página.');
        } else {
          setCheckoutError('Error al iniciar el proceso. Intenta de nuevo.');
        }
      } else {
        setCheckoutError('Error inesperado. Intenta de nuevo.');
      }
    } finally {
      setCheckoutLoading(false);
    }
  }

  return (
    <div
      className="w-full max-w-sm mx-auto flex flex-col gap-4 p-6 rounded-2xl"
      style={{
        background: 'var(--sp-surface)',
        border: '1px solid var(--sp-border-8)',
      }}
      data-testid="paywall-upgrade"
    >
      <div className="flex flex-col gap-1 text-center">
        <h2 className="text-base font-semibold" style={{ color: 'var(--sp-text)' }}>
          Hazte Pro
        </h2>
        <p className="text-sm" style={{ color: 'var(--sp-text-40)' }}>
          Accede a estadísticas avanzadas, predicciones en profundidad y sin publicidad.
        </p>
      </div>

      <button
        onClick={() => { void handleStartSubscription(); }}
        disabled={checkoutLoading}
        className="w-full rounded-lg text-sm font-semibold transition-opacity flex items-center justify-center gap-2"
        style={{
          minHeight: 44,
          background: 'var(--sp-primary)',
          color: '#fff',
          border: 'none',
          cursor: checkoutLoading ? 'not-allowed' : 'pointer',
          opacity: checkoutLoading ? 0.6 : 1,
        }}
        data-testid="paywall-subscribe-btn"
      >
        {checkoutLoading && <Loader2 size={16} className="animate-spin" />}
        {checkoutLoading ? 'Redirigiendo...' : 'Iniciar suscripción'}
      </button>

      {checkoutError && (
        <p
          className="text-xs text-center"
          style={{ color: 'var(--sp-danger, #ef4444)' }}
          data-testid="paywall-error"
        >
          {checkoutError}
        </p>
      )}

      {onDismiss && (
        <button
          onClick={onDismiss}
          className="text-xs text-center"
          style={{ color: 'var(--sp-text-40)', background: 'none', border: 'none', cursor: 'pointer' }}
          data-testid="paywall-dismiss"
        >
          Cancelar
        </button>
      )}
    </div>
  );
}
