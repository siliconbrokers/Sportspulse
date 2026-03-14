/**
 * StreamPopup — modal limpio con iframe de stream embebido.
 * Al abrirse:
 *   1. Fetcha /api/ui/stream-source para obtener la lista de embed URLs activas.
 *   2. Prueba cada URL con fetch HEAD (no-cors) para detectar dominios caídos.
 *   3. Carga en iframe la primera URL que responda.
 * Usa createPortal para evitar el problema de backdrop-filter en iOS Safari.
 */
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useWindowWidth } from '../hooks/use-window-width.js';

interface StreamPopupProps {
  sourcePageUrl: string;
  fallbackUrl: string;
  label: string;
  onClose: () => void;
}

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; embedUrl: string }
  | { phase: 'unavailable' };

/** Prueba si una URL es alcanzable (servidor responde). Lanza si DNS falla o ECONNREFUSED. */
async function probeUrl(url: string): Promise<boolean> {
  try {
    await fetch(url, {
      method: 'HEAD',
      mode: 'no-cors',
      signal: AbortSignal.timeout(4000),
    });
    return true; // respuesta opaca = servidor alcanzable
  } catch {
    return false;
  }
}

export function StreamPopup({ sourcePageUrl, fallbackUrl, label, onClose }: StreamPopupProps) {
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    const ctrl = new AbortController();

    (async () => {
      try {
        // 1. Obtener URLs candidatas del backend
        const apiUrl = `/api/ui/stream-source?sourcePageUrl=${encodeURIComponent(sourcePageUrl)}`;
        const res = await fetch(apiUrl, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { embedUrls: string[] };

        if (ctrl.signal.aborted) return;

        if (data.embedUrls.length === 0) {
          setState({ phase: 'unavailable' });
          return;
        }

        // 2. Probar cada URL — usar la primera que esté viva
        for (const candidateUrl of data.embedUrls) {
          if (ctrl.signal.aborted) return;
          const alive = await probeUrl(candidateUrl);
          if (alive) {
            setState({ phase: 'ready', embedUrl: candidateUrl });
            return;
          }
        }

        // Ninguna URL respondió
        setState({ phase: 'unavailable' });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        console.warn('[StreamPopup] error:', err);
        setState({ phase: 'unavailable' });
      }
    })();

    return () => ctrl.abort();
  }, [sourcePageUrl]);

  return createPortal(
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.88)', zIndex: 9998 }}
      />

      {/* Contenedor */}
      <div style={{
        position: 'fixed', zIndex: 9999,
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: isMobile ? '100vw' : 'min(860px, 92vw)',
        aspectRatio: state.phase === 'unavailable' ? 'unset' : '16 / 9',
        backgroundColor: '#000',
        borderRadius: isMobile ? 0 : 12,
        overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Barra superior */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 38,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 12px',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.75), transparent)',
          zIndex: 2,
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            {label} · En vivo
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '50%', width: 28, height: 28,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'rgba(255,255,255,0.8)', fontSize: 14, cursor: 'pointer',
            }}
          >✕</button>
        </div>

        {/* Cargando */}
        {state.phase === 'loading' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'rgba(255,255,255,0.5)' }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', border: '3px solid rgba(255,255,255,0.15)', borderTopColor: '#22c55e', animation: 'spin 0.8s linear infinite' }} />
            <span style={{ fontSize: 13 }}>Buscando señal…</span>
          </div>
        )}

        {/* Stream listo */}
        {state.phase === 'ready' && (
          <iframe
            src={state.embedUrl}
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
            allow="autoplay; fullscreen; encrypted-media"
            allowFullScreen
            referrerPolicy="no-referrer-when-downgrade"
          />
        )}

        {/* Sin señal */}
        {state.phase === 'unavailable' && (
          <div style={{ padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center' }}>
            <span style={{ fontSize: 32 }}>📡</span>
            <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 1.5 }}>
              El stream no está disponible en este momento.<br />
              Solo funciona durante partidos en vivo.
            </div>
            <a
              href={fallbackUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ padding: '10px 20px', backgroundColor: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, color: '#22c55e', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}
            >
              Abrir {label} en nueva pestaña ↗
            </a>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>,
    document.body,
  );
}
