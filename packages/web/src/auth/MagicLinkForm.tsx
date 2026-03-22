// SPF-AUTH-003 — Magic-link request form (deferred auth entry)
// Branch: reingenieria/v2 · Acceptance: K-01, K-06
//
// Props:
//   returnContext — stored and forwarded to /api/auth/magic-link/start
//   onSuccess     — optional callback after 202 accepted (e.g. to navigate away)
//
// Never import from pipeline packages.

import { useState } from 'react';
import { apiClient, ApiError } from '../api/client.js';
import type { ReturnContextDTO } from '../types/auth.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MagicLinkFormProps {
  returnContext: ReturnContextDTO;
  onSuccess?: () => void;
}

type FormState = 'idle' | 'loading' | 'sent' | 'rate_limited' | 'error';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MagicLinkForm({ returnContext, onSuccess }: MagicLinkFormProps) {
  const [email, setEmail] = useState('');
  const [formState, setFormState] = useState<FormState>('idle');
  const [validationError, setValidationError] = useState<string | null>(null);

  const isLoading = formState === 'loading';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError(null);

    if (!isValidEmail(email)) {
      setValidationError('Ingresa un email válido.');
      return;
    }

    setFormState('loading');

    try {
      await apiClient.postMagicLinkStart(email.trim(), returnContext);
      setFormState('sent');
      onSuccess?.();
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setFormState('rate_limited');
      } else {
        setFormState('error');
      }
    }
  }

  // ── Sent confirmation ──────────────────────────────────────────────────────

  if (formState === 'sent') {
    return (
      <div
        className="w-full text-center py-3 px-4 rounded-lg text-sm"
        style={{
          background: 'var(--sp-primary-10)',
          border: '1px solid var(--sp-primary-40)',
          color: 'var(--sp-text)',
        }}
        data-testid="magic-link-sent"
      >
        Te enviamos un enlace a <strong>{email}</strong>. Revisa tu correo.
      </div>
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────────

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full flex flex-col gap-3"
      data-testid="magic-link-form"
      noValidate
    >
      <div className="flex flex-col gap-1">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@email.com"
          autoComplete="email"
          disabled={isLoading}
          aria-label="Email"
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{
            background: 'var(--sp-surface)',
            border: '1px solid var(--sp-border-8)',
            color: 'var(--sp-text)',
            minHeight: 44,
            transition: 'border-color 0.15s ease',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--sp-primary-40)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--sp-border-8)';
          }}
        />
        {validationError && (
          <p
            className="text-xs"
            style={{ color: 'var(--sp-danger, #ef4444)' }}
            data-testid="magic-link-validation-error"
          >
            {validationError}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="w-full rounded-lg text-sm font-semibold transition-opacity"
        style={{
          minHeight: 44,
          background: 'var(--sp-primary)',
          color: '#fff',
          border: 'none',
          cursor: isLoading ? 'not-allowed' : 'pointer',
          opacity: isLoading ? 0.6 : 1,
        }}
        data-testid="magic-link-submit"
      >
        {isLoading ? 'Enviando...' : 'Enviar enlace'}
      </button>

      {formState === 'rate_limited' && (
        <p
          className="text-xs text-center"
          style={{ color: 'var(--sp-text-40)' }}
          data-testid="magic-link-rate-limited"
        >
          Demasiados intentos. Espera un momento.
        </p>
      )}

      {formState === 'error' && (
        <p
          className="text-xs text-center"
          style={{ color: 'var(--sp-danger, #ef4444)' }}
          data-testid="magic-link-error"
        >
          Error al enviar el enlace. Intenta de nuevo.
        </p>
      )}
    </form>
  );
}
