/**
 * StreamPopup — modal limpio con iframe de stream embebido.
 * Muestra el botón de fallback INMEDIATAMENTE (no hay que esperar a que falle).
 * Si el embed carga → el iframe toma el espacio completo.
 * Si no hay match en vivo → el embed falla y el usuario ya tiene el botón visible.
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

/**
 * Abre la URL en nueva pestaña SIN Referer header.
 * Usando <a rel="noreferrer"> el sitio destino ve document.referrer = ''
 * (equivale a navegación directa) → no puede detectar que viene de nuestra app.
 */
function openWithoutReferrer(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noreferrer noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

type EmbedState = 'searching' | 'ready' | 'unavailable';

export function StreamPopup({ sourcePageUrl, fallbackUrl, label, onClose }: StreamPopupProps) {
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';
  const [embedState, setEmbedState] = useState<EmbedState>('searching');
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();

    (async () => {
      try {
        const apiUrl = `/api/ui/stream-source?sourcePageUrl=${encodeURIComponent(sourcePageUrl)}`;
        const res = await fetch(apiUrl, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { embedUrls: string[] };

        if (ctrl.signal.aborted) return;

        // Backend ya validó las URLs server-side — usar la primera directamente
        if (data.embedUrls.length > 0) {
          setEmbedUrl(data.embedUrls[0]);
          setEmbedState('ready');
        } else {
          setEmbedState('unavailable');
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setEmbedState('unavailable');
      }
    })();

    return () => ctrl.abort();
  }, [sourcePageUrl]);

  const hasEmbed = embedState === 'ready' && embedUrl != null;

  return createPortal(
    <>
      {/* Overlay */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.9)', zIndex: 9998 }} />

      {/* Contenedor */}
      <div style={{
        position: 'fixed', zIndex: 9999,
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: isMobile ? '100vw' : 'min(860px, 92vw)',
        height: isMobile ? '100dvh' : 'min(540px, 88vh)',
        backgroundColor: '#0a0a0a',
        borderRadius: isMobile ? 0 : 14,
        overflow: 'hidden',
        boxShadow: '0 32px 80px rgba(0,0,0,0.8)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Barra superior */}
        <div style={{
          position: hasEmbed ? 'absolute' : 'relative',
          top: 0, left: 0, right: 0, height: 44,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 14px',
          background: hasEmbed
            ? 'linear-gradient(to bottom, rgba(0,0,0,0.8), transparent)'
            : 'rgba(255,255,255,0.04)',
          borderBottom: hasEmbed ? 'none' : '1px solid rgba(255,255,255,0.07)',
          zIndex: 2, flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#ef4444', display: 'inline-block', animation: 'pulse-live 2s ease-in-out infinite' }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              {label} · En vivo
            </span>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '50%', width: 28, height: 28,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'rgba(255,255,255,0.7)', fontSize: 13, cursor: 'pointer',
          }}>✕</button>
        </div>

        {/* iframe embed — cuando hay señal */}
        {hasEmbed && (
          <iframe
            src={embedUrl}
            style={{ width: '100%', flex: 1, border: 'none', display: 'block', minHeight: 0 }}
            allow="autoplay; fullscreen; encrypted-media"
            allowFullScreen
            referrerPolicy="no-referrer"
          />
        )}

        {/* Buscando o sin señal */}
        {!hasEmbed && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 120 }}>
            {embedState === 'searching' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>
                <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.1)', borderTopColor: '#22c55e', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
                Buscando señal…
              </div>
            ) : (
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', textAlign: 'center', lineHeight: 1.5, margin: 0, padding: '0 24px' }}>
                Señal no disponible. Solo funciona durante partidos en vivo.
              </p>
            )}
          </div>
        )}

        {/* Botón fallback — siempre visible en la parte inferior */}
        <div style={{
          padding: '10px 14px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <button
            onClick={() => { openWithoutReferrer(fallbackUrl); onClose(); }}
            style={{
              padding: '9px 20px',
              backgroundColor: 'rgba(34,197,94,0.12)',
              border: '1px solid rgba(34,197,94,0.3)',
              borderRadius: 8,
              color: '#22c55e', fontSize: 13, fontWeight: 700,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7,
            }}
          >
            <span>▶</span> Abrir {label} en nueva ventana
          </button>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse-live { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
      `}</style>
    </>,
    document.body,
  );
}
