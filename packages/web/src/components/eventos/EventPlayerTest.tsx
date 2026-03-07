// spec §16 — página interna de prueba de reproducción
// spec §17 — iframe sandboxed para aislar player externo
import { useState, useEffect, useRef } from 'react';

interface PlayerParams {
  id: string;
  url: string;
  home: string;
  away: string;
  league: string;
  status: string;
  time: string;
}

const LEAGUE_LABEL: Record<string, string> = {
  URUGUAY_PRIMERA: 'Primera División Uruguay',
  LALIGA: 'LaLiga',
  PREMIER_LEAGUE: 'Premier League',
  BUNDESLIGA: 'Bundesliga',
  OTRA: 'Otra',
  EXCLUIDA: 'Excluida',
};

function formatTime(isoStr: string): string {
  if (!isoStr) return '—';
  try {
    return new Date(isoStr).toLocaleTimeString('es-UY', {
      timeZone: 'America/Montevideo',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoStr;
  }
}

function readParams(): PlayerParams {
  const p = new URLSearchParams(window.location.search);
  return {
    id: p.get('id') ?? '',
    url: p.get('url') ?? '',
    home: p.get('home') ?? '?',
    away: p.get('away') ?? '?',
    league: p.get('league') ?? 'OTRA',
    status: p.get('status') ?? 'DESCONOCIDO',
    time: p.get('time') ?? '',
  };
}

export function EventPlayerTest() {
  const [params] = useState<PlayerParams>(readParams);
  const [iframeError, setIframeError] = useState(false);
  const [loadStart] = useState(Date.now());
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const hasUrl = Boolean(params.url);

  useEffect(() => {
    if (!hasUrl) {
      setIframeError(true);
    }
  }, [hasUrl]);

  function handleIframeLoad() {
    // spec §18.2 — event_player_loaded
    const duration = Date.now() - loadStart;
    console.log('[Eventos] event_player_loaded', {
      event_id: params.id,
      open_mode: 'EMBED_TEST',
      success: true,
      load_duration_ms: duration,
    });
  }

  function handleIframeError() {
    setIframeError(true);
    console.log('[Eventos] event_player_failed', {
      event_id: params.id,
      open_mode: 'EMBED_TEST',
      reason: 'iframe_load_error',
    });
  }

  function openOrigin() {
    if (params.url) {
      window.open(params.url, '_blank', 'noopener,noreferrer');
    }
  }

  const leagueLabel = LEAGUE_LABEL[params.league] ?? params.league;

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#0f172a',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#fff',
      padding: 0,
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        background: 'rgba(255,255,255,0.03)',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* spec §16.3 — título del evento */}
          <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#fff' }}>
            {params.home} vs {params.away}
          </h1>
          <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
            {/* spec §16.3 — liga normalizada */}
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
              {leagueLabel}
            </span>
            {/* spec §16.3 — hora local */}
            {params.time && (
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
                {formatTime(params.time)} (UY)
              </span>
            )}
            {/* spec §16.3 — estado */}
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
              background: params.status === 'EN_VIVO'
                ? 'rgba(239,68,68,0.15)'
                : 'rgba(100,116,139,0.15)',
              color: params.status === 'EN_VIVO' ? '#ef4444' : '#94a3b8',
            }}>
              {params.status}
            </span>
          </div>
        </div>

        {/* spec §16.3 — botón Abrir origen */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={openOrigin}
            disabled={!hasUrl}
            style={{
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 600,
              cursor: hasUrl ? 'pointer' : 'not-allowed',
              opacity: hasUrl ? 1 : 0.5,
              whiteSpace: 'nowrap',
            }}
          >
            Abrir origen
          </button>
          <button
            onClick={() => window.close()}
            style={{
              background: 'transparent',
              color: 'rgba(255,255,255,0.5)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Cerrar
          </button>
        </div>
      </div>

      {/* spec §16.3 — fuente externa */}
      {params.url && (
        <div style={{ padding: '6px 20px', background: 'rgba(0,0,0,0.2)', fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>
          Fuente: <span style={{ fontFamily: 'monospace' }}>{params.url}</span>
        </div>
      )}

      {/* Player area */}
      <div style={{ padding: '16px 20px' }}>
        {iframeError ? (
          /* spec §16.3 + §17.7 — fallback si player no funciona */
          <div style={{
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.2)',
            borderRadius: 10,
            padding: 24,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', margin: '0 0 6px' }}>
              El reproductor no pudo cargarse en modo sandbox.
            </p>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', margin: '0 0 16px' }}>
              El player externo puede requerir permisos de navegación no habilitados en modo prueba.
            </p>
            {/* spec §17.7 — botón Abrir origen en nueva pestaña */}
            <button
              onClick={openOrigin}
              disabled={!hasUrl}
              style={{
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '8px 20px',
                fontSize: 13,
                fontWeight: 600,
                cursor: hasUrl ? 'pointer' : 'not-allowed',
                opacity: hasUrl ? 1 : 0.5,
              }}
            >
              Abrir origen en nueva pestaña
            </button>
          </div>
        ) : (
          <div style={{ position: 'relative', width: '100%', paddingTop: '56.25%' }}>
            {/* spec §17.3-17.4 — iframe sandboxed restrictivo */}
            <iframe
              ref={iframeRef}
              src={params.url}
              title={`${params.home} vs ${params.away}`}
              // spec §17.4 — sandbox restrictivo: sin allow-popups ni allow-top-navigation
              sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
              allow="autoplay; fullscreen"
              referrerPolicy="no-referrer"
              loading="lazy"
              onLoad={handleIframeLoad}
              onError={handleIframeError}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                border: 'none',
                borderRadius: 8,
              }}
            />
          </div>
        )}

        {/* Nota técnica */}
        {!iframeError && (
          <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 10, textAlign: 'center' }}>
            Modo prueba — iframe con sandbox restrictivo (sin popups ni navegación de top-level).
            Si el player no funciona, usá "Abrir origen".
          </p>
        )}
      </div>
    </div>
  );
}
