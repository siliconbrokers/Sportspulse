import { useEffect, useState } from 'react';

/**
 * Pantalla de carga mientras el servidor está arrancando.
 * Muestra un spinner, un contador de segundos y un mensaje explicativo.
 */
export function ServerBootScreen() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const dots = '.'.repeat((elapsed % 3) + 1);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--sp-bg)',
        color: 'var(--sp-text)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        gap: 24,
        padding: 24,
      }}
    >
      {/* Spinner */}
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          border: '3px solid var(--sp-border-8)',
          borderTopColor: 'var(--sp-primary)',
          animation: 'sp-spin 0.8s linear infinite',
        }}
      />

      {/* Mensaje principal */}
      <div style={{ textAlign: 'center', maxWidth: 320 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
          Iniciando servidor{dots}
        </div>
        <div style={{ fontSize: 13, color: 'var(--sp-text-40)', lineHeight: 1.5 }}>
          El servidor está cargando los datos de todas las ligas.
          Esto puede tardar hasta un minuto.
        </div>
      </div>

      {/* Contador */}
      <div style={{ fontSize: 12, color: 'var(--sp-text-40)' }}>
        {elapsed}s
      </div>

      <style>{`
        @keyframes sp-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
