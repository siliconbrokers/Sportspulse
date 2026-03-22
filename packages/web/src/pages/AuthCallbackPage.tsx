// SPF-AUTH-002 — Auth callback page (magic-link completion)
// Branch: reingenieria/v2 · Acceptance: K-01, K-06
//
// Flow:
//   1. Read ?token= from URL query params
//   2. If present → POST /api/auth/magic-link/complete
//   3. On success → refresh session context → navigate to resume.returnTo (or /)
//   4. On error  → show keyed error message
//   5. If no token → show "Enlace inválido"
//
// Never import from pipeline packages.

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { apiClient, ApiError } from '../api/client.js';
import { useSession } from '../auth/SessionProvider.js';

// ── Error messages keyed to API error codes ───────────────────────────────────

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_TOKEN: 'El enlace no es válido.',
  TOKEN_EXPIRED: 'El enlace ha expirado. Solicita uno nuevo.',
  TOKEN_ALREADY_USED: 'El enlace ya fue utilizado. Solicita uno nuevo.',
};

function errorMessage(code: string | undefined): string {
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  return 'Error al autenticar. Intenta de nuevo.';
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useSession();

  const token = searchParams.get('token');

  type PageState = 'loading' | 'error' | 'no_token';
  const [pageState, setPageState] = useState<PageState>(token ? 'loading' : 'no_token');
  const [errMsg, setErrMsg] = useState<string>('');

  // Guard against double-fire in React StrictMode
  const calledRef = useRef(false);

  useEffect(() => {
    if (!token) return;
    if (calledRef.current) return;
    calledRef.current = true;

    const controller = new AbortController();

    apiClient
      .postMagicLinkComplete(token, { signal: controller.signal })
      .then((result) => {
        refresh();
        const returnTo = result.resume?.returnTo ?? '/';
        navigate(returnTo, { replace: true });
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        const code = err instanceof ApiError ? err.code : undefined;
        setErrMsg(errorMessage(code));
        setPageState('error');
      });

    return () => controller.abort();
  }, [token, navigate, refresh]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center px-4"
      style={{ backgroundColor: 'var(--sp-bg)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-8 flex flex-col items-center gap-6 text-center"
        style={{
          background: 'var(--sp-surface)',
          border: '1px solid var(--sp-border-8)',
        }}
      >
        {pageState === 'loading' && (
          <>
            <Loader2
              className="animate-spin"
              size={32}
              style={{ color: 'var(--sp-primary)' }}
              data-testid="auth-callback-loading"
            />
            <p
              className="text-sm"
              style={{ color: 'var(--sp-text-40)' }}
            >
              Autenticando...
            </p>
          </>
        )}

        {pageState === 'no_token' && (
          <>
            <p
              className="text-sm font-semibold"
              style={{ color: 'var(--sp-danger, #ef4444)' }}
              data-testid="auth-callback-no-token"
            >
              Enlace inválido
            </p>
            <p
              className="text-xs"
              style={{ color: 'var(--sp-text-40)' }}
            >
              El enlace de acceso no contiene un token válido.
            </p>
          </>
        )}

        {pageState === 'error' && (
          <>
            <p
              className="text-sm font-semibold"
              style={{ color: 'var(--sp-danger, #ef4444)' }}
              data-testid="auth-callback-error"
            >
              {errMsg}
            </p>
            <a
              href="/"
              className="text-xs underline"
              style={{ color: 'var(--sp-primary)' }}
            >
              Volver al inicio
            </a>
          </>
        )}
      </div>
    </div>
  );
}
