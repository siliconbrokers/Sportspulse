// spec §16 — página interna de prueba de reproducción
// La URL del proveedor se obtiene del servidor por ID — nunca se expone en query params ni en UI
import { useState, useRef } from 'react';
import { useEventById } from '../../hooks/use-events.js';

const LEAGUE_LABEL: Record<string, string> = {
  URUGUAY_PRIMERA: 'Primera División Uruguay',
  LALIGA: 'LaLiga',
  PREMIER_LEAGUE: 'Premier League',
  BUNDESLIGA: 'Bundesliga',
  OTRA: 'Otra',
  EXCLUIDA: 'Excluida',
};

function readParams(): { id: string; mode: 'direct' | 'embed' } {
  const p = new URLSearchParams(window.location.search);
  const mode = p.get('mode') === 'direct' ? 'direct' : 'embed';
  return { id: p.get('id') ?? '', mode };
}

function formatTime(isoStr: string | null): string {
  if (!isoStr) return '—';
  try {
    return new Date(isoStr).toLocaleTimeString('es-UY', {
      timeZone: 'America/Montevideo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return isoStr;
  }
}

export function EventPlayerTest() {
  const [{ id, mode }] = useState(readParams);
  const [iframeError, setIframeError] = useState(false);
  const [loadStart] = useState(Date.now());
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // La URL del stream solo existe en el objeto event, nunca en la query string ni en el DOM visible
  const { data: event, loading, error } = useEventById(id || null);

  const hasUrl = Boolean(event?.openUrl);

  function handleIframeLoad() {
    console.log('[Eventos] event_player_loaded', {
      event_id: id,
      open_mode: mode === 'direct' ? 'DIRECT' : 'EMBED_TEST',
      success: true,
      load_duration_ms: Date.now() - loadStart,
    });
  }

  function handleIframeError() {
    setIframeError(true);
    console.log('[Eventos] event_player_failed', {
      event_id: id,
      open_mode: mode === 'direct' ? 'DIRECT' : 'EMBED_TEST',
      reason: 'iframe_load_error',
    });
  }

  // Abre el origen directamente en la misma pestaña (fallback cuando iframe falla)
  function openOrigin() {
    if (event?.openUrl) {
      window.location.href = event.openUrl;
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>Cargando...</span>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>
          {error ?? 'Evento no encontrado'}
        </span>
      </div>
    );
  }

  const leagueLabel = LEAGUE_LABEL[event.normalizedLeague] ?? event.normalizedLeague;

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#0f172a',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#fff',
    }}>
      {/* Header — sin ninguna referencia a URLs externas */}
      <div style={{
        padding: '12px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        background: 'rgba(255,255,255,0.03)',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#fff' }}>
            {event.homeTeam ?? '?'} vs {event.awayTeam ?? '?'}
          </h1>
          <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
              {leagueLabel}
            </span>
            {event.startsAtPortalTz && (
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
                {formatTime(event.startsAtPortalTz)} (UY)
              </span>
            )}
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
              background: event.normalizedStatus === 'EN_VIVO'
                ? 'rgba(239,68,68,0.15)'
                : 'rgba(100,116,139,0.15)',
              color: event.normalizedStatus === 'EN_VIVO' ? '#ef4444' : '#94a3b8',
            }}>
              {event.normalizedStatus}
            </span>
          </div>
        </div>

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

      {/* Player area */}
      <div style={{ padding: '16px 20px' }}>
        {!hasUrl ? (
          <div style={{
            background: 'rgba(100,116,139,0.1)',
            border: '1px solid rgba(100,116,139,0.2)',
            borderRadius: 10,
            padding: 24,
            textAlign: 'center',
          }}>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', margin: 0 }}>
              No hay reproducción disponible para este evento.
            </p>
          </div>
        ) : iframeError ? (
          /* spec §17.7 — fallback si el player no funciona bajo sandbox */
          <div style={{
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.2)',
            borderRadius: 10,
            padding: 24,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', margin: '0 0 6px' }}>
              El reproductor no pudo cargarse.
            </p>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', margin: '0 0 16px' }}>
              Podés intentar abrirlo directamente.
            </p>
            <button
              onClick={openOrigin}
              style={{
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '8px 20px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Abrir en esta pestaña
            </button>
          </div>
        ) : (
          <div style={{ position: 'relative', width: '100%', paddingTop: '56.25%' }}>
            {/*
              mode=direct → iframe sin sandbox: el proveedor detecta y bloquea sandbox activamente.
                            La URL permanece oculta (el usuario ve /eventos/ver en la barra).
              mode=embed  → sandbox restrictivo para pruebas de aislamiento (puede fallar en
                            proveedores con anti-sandbox; el fallback ofrece navegar directo).
            */}
            {mode === 'direct' ? (
              <iframe
                ref={iframeRef}
                src={event.openUrl!}
                title={`${event.homeTeam} vs ${event.awayTeam}`}
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
            ) : (
              <iframe
                ref={iframeRef}
                src={event.openUrl!}
                title={`${event.homeTeam} vs ${event.awayTeam}`}
                sandbox="allow-scripts allow-same-origin allow-forms allow-presentation allow-popups"
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
            )}
          </div>
        )}
      </div>
    </div>
  );
}
