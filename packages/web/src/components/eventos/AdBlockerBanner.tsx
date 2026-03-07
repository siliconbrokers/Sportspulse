import { useAdBlockerDetection, getUBlockInstallUrl } from '../../hooks/use-adblocker-detection.js';

/**
 * Banner informativo que recomienda instalar uBlock Origin si el usuario no tiene
 * un bloqueador activo. Se oculta automáticamente si detecta uno instalado,
 * y puede ser descartado permanentemente (localStorage).
 */
export function AdBlockerBanner({ isMobile }: { isMobile: boolean }) {
  const { state, dismissed, dismiss } = useAdBlockerDetection();

  // No renderizar si: aún chequeando, bloqueador detectado, o usuario ya descartó
  if (state !== 'not-detected' || dismissed) return null;

  const { url, label } = getUBlockInstallUrl();

  return (
    <div
      style={{
        background: 'rgba(251,191,36,0.08)',
        border: '1px solid rgba(251,191,36,0.25)',
        borderRadius: 10,
        padding: isMobile ? '12px 14px' : '14px 18px',
        marginBottom: 20,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
      }}
    >
      {/* Ícono */}
      <span style={{ fontSize: 20, flexShrink: 0, lineHeight: 1.3 }}>🛡️</span>

      {/* Texto */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontSize: isMobile ? 13 : 14,
          fontWeight: 600,
          color: 'rgba(251,191,36,0.95)',
          margin: '0 0 4px',
          lineHeight: 1.4,
        }}>
          Recomendamos usar uBlock Origin para ver los partidos sin interrupciones
        </p>
        <p style={{
          fontSize: isMobile ? 11 : 12,
          color: 'rgba(255,255,255,0.5)',
          margin: '0 0 10px',
          lineHeight: 1.5,
        }}>
          Al abrir un partido pueden aparecer ventanas emergentes del proveedor de streaming.
          Con uBlock Origin instalado se bloquean automáticamente y el partido se reproduce sin interrupciones.
        </p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-block',
            fontSize: 12,
            fontWeight: 600,
            color: '#fbbf24',
            background: 'rgba(251,191,36,0.12)',
            border: '1px solid rgba(251,191,36,0.3)',
            borderRadius: 6,
            padding: '5px 12px',
            textDecoration: 'none',
          }}
        >
          {label} →
        </a>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginLeft: 10 }}>
          Es gratuito y de código abierto
        </span>
      </div>

      {/* Botón cerrar */}
      <button
        onClick={dismiss}
        title="No mostrar más"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'rgba(255,255,255,0.3)',
          fontSize: 18,
          cursor: 'pointer',
          padding: '0 2px',
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}
