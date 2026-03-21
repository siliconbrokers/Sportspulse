import { useAdBlockerDetection } from '../../hooks/use-adblocker-detection.js';

/**
 * Banner informativo que recomienda la solución correcta para ver partidos sin popups,
 * adaptado a la plataforma del usuario:
 * - iOS → Brave (bloqueador integrado)
 * - Android + no Firefox → Firefox + uBlock Origin
 * - Android + Firefox → instalar uBlock Origin
 * - Desktop → instalar uBlock Origin (link al store correcto)
 *
 * No se muestra si ya hay un bloqueador activo o si el usuario cerró el banner.
 */
export function AdBlockerBanner({ isMobile }: { isMobile: boolean }) {
  const { state, dismissed, dismiss, recommendation: rec } = useAdBlockerDetection();

  if (state !== 'not-detected' || dismissed) return null;

  return (
    <div
      style={{
        background: 'var(--sp-status-zombie-soft)',
        border: '1px solid rgba(245,158,11,0.25)', /* zombie border alpha — no exact token */
        borderRadius: 10,
        padding: isMobile ? '12px 14px' : '14px 18px',
        marginBottom: 20,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
      }}
    >
      {/* Ícono */}
      <span style={{ fontSize: 20, flexShrink: 0, lineHeight: 1.3 }}>
        {rec.platform === 'ios' ? '🦁' : '🛡️'}
      </span>

      {/* Texto */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontSize: isMobile ? 13 : 14,
          fontWeight: 600,
          color: 'var(--sp-status-zombie)',
          margin: '0 0 4px',
          lineHeight: 1.4,
        }}>
          {rec.title}
        </p>
        <p style={{
          fontSize: isMobile ? 11 : 12,
          color: 'var(--sp-text-50)',
          margin: '0 0 10px',
          lineHeight: 1.5,
        }}>
          {rec.body}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <a
            href={rec.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--sp-status-zombie)',
              background: 'var(--sp-status-zombie-soft)',
              border: '1px solid rgba(245,158,11,0.3)',
              borderRadius: 6,
              padding: '5px 12px',
              textDecoration: 'none',
            }}
          >
            {rec.cta} →
          </a>
          {rec.note && (
            <span style={{ fontSize: 11, color: 'var(--sp-text-20)' }}>
              {rec.note}
            </span>
          )}
        </div>
      </div>

      {/* Botón cerrar */}
      <button
        onClick={dismiss}
        title="No mostrar más"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--sp-text-30)',
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
