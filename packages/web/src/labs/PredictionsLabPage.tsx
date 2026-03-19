// PE-76 — Internal diagnostics page for Predictive Engine snapshots
// Route: /labs/predicciones — not linked in Navbar, internal only
import { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../hooks/use-theme.js';
import { ThemeToggle } from '../components/ThemeToggle.js';

type Snapshot = {
  match_id: string;
  competition_id: string;
  generated_at: string;
  engine_version: string;
  generation_status: 'ok' | 'error';
  error_detail?: string;
  mode: string;
  calibration_mode: string | null;
  reasons: string[];
  degradation_notes: unknown[];
  p_home_win: number | null;
  p_draw: number | null;
  p_away_win: number | null;
  predicted_result: string | null;
  expected_goals_home: number | null;
  expected_goals_away: number | null;
  favorite_margin: number | null;
  draw_risk: number | null;
  request_payload: unknown;
  response_payload: unknown;
};

async function fetchSnapshots(params: { competitionId?: string; limit?: number }): Promise<Snapshot[]> {
  const url = new URL('/api/internal/predictions', window.location.origin);
  if (params.competitionId) url.searchParams.set('competitionId', params.competitionId);
  if (params.limit) url.searchParams.set('limit', String(params.limit));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as { items: Snapshot[]; count: number };
  return data.items;
}

function formatDate(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    return `${hh}:${mm} ${dd}/${mo}`;
  } catch {
    return isoStr;
  }
}

function fmtProb(v: number | null): string {
  if (v === null) return '—';
  return v.toFixed(2);
}

function fmtXg(v: number | null): string {
  if (v === null) return '—';
  return v.toFixed(2);
}

function modeBadge(mode: string): { label: string; bg: string; color: string } {
  switch (mode) {
    case 'FULL_MODE':
      return { label: 'FULL', bg: 'rgba(34,197,94,0.15)', color: '#4ade80' };
    case 'LIMITED_MODE':
      return { label: 'LIMITED', bg: 'rgba(234,179,8,0.15)', color: '#facc15' };
    case 'NOT_ELIGIBLE':
      return { label: 'N/ELIG', bg: 'rgba(239,68,68,0.15)', color: '#f87171' };
    case 'ERROR':
      return { label: 'ERROR', bg: 'rgba(127,29,29,0.4)', color: '#fca5a5' };
    default:
      return { label: mode, bg: 'rgba(100,116,139,0.15)', color: '#94a3b8' };
  }
}

function expandKey(snap: Snapshot): string {
  return `${snap.match_id}__${snap.generated_at}`;
}

function ExpandedRow({ snap }: { snap: Snapshot }) {
  const [showRequest, setShowRequest] = useState(false);
  const [showResponse, setShowResponse] = useState(false);
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const cellStyle: React.CSSProperties = {
    padding: '14px 16px',
    background: isDark ? '#111' : '#f8fafc',
    borderBottom: isDark ? '1px solid #2a2a2a' : '1px solid #e2e8f0',
  };

  const sectionTitle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    color: isDark ? '#64748b' : '#475569',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: 6,
  };

  const preStyle: React.CSSProperties = {
    background: isDark ? '#0a0a0a' : '#f1f5f9',
    border: isDark ? '1px solid #2a2a2a' : '1px solid #e2e8f0',
    borderRadius: 6,
    padding: '10px 12px',
    fontSize: 11,
    color: isDark ? '#94a3b8' : '#475569',
    overflowX: 'auto',
    maxHeight: 300,
    overflowY: 'auto',
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  };

  const toggleBtn: React.CSSProperties = {
    fontSize: 11,
    color: '#3b82f6',
    background: 'none',
    border: '1px solid rgba(59,130,246,0.3)',
    borderRadius: 4,
    padding: '2px 8px',
    cursor: 'pointer',
    marginBottom: 6,
    display: 'block',
  };

  return (
    <tr>
      <td colSpan={11} style={cellStyle}>
        {/* Summary line */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: 12, fontSize: 12, color: isDark ? '#94a3b8' : '#64748b' }}>
          <span><span style={{ color: '#64748b' }}>Mode:</span> {snap.mode}</span>
          <span><span style={{ color: '#64748b' }}>Calibration:</span> {snap.calibration_mode ?? '—'}</span>
          {snap.favorite_margin !== null && (
            <span><span style={{ color: '#64748b' }}>favorite_margin:</span> {snap.favorite_margin.toFixed(3)}</span>
          )}
          {snap.draw_risk !== null && (
            <span><span style={{ color: '#64748b' }}>draw_risk:</span> {snap.draw_risk.toFixed(3)}</span>
          )}
          {snap.engine_version && (
            <span><span style={{ color: '#64748b' }}>engine:</span> {snap.engine_version}</span>
          )}
        </div>

        {/* Reasons */}
        {snap.reasons.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={sectionTitle}>Reasons</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {snap.reasons.map((r, i) => (
                <span key={i} style={{
                  fontSize: 11,
                  background: 'rgba(100,116,139,0.12)',
                  border: '1px solid rgba(100,116,139,0.2)',
                  borderRadius: 4,
                  padding: '2px 7px',
                  color: '#94a3b8',
                }}>
                  {r}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Degradation notes */}
        {Array.isArray(snap.degradation_notes) && snap.degradation_notes.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={sectionTitle}>Degradation notes</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {snap.degradation_notes.map((n, i) => (
                <span key={i} style={{
                  fontSize: 11,
                  background: 'rgba(234,179,8,0.1)',
                  border: '1px solid rgba(234,179,8,0.2)',
                  borderRadius: 4,
                  padding: '2px 7px',
                  color: '#facc15',
                }}>
                  {JSON.stringify(n)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Error detail */}
        {snap.error_detail && (
          <div style={{ marginBottom: 10 }}>
            <div style={sectionTitle}>Error detail</div>
            <pre style={{ ...preStyle, color: '#f87171' }}>{snap.error_detail}</pre>
          </div>
        )}

        {/* Request payload */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ ...sectionTitle, borderTop: isDark ? '1px solid #2a2a2a' : '1px solid #e2e8f0', paddingTop: 10 }}>
            Request Payload
          </div>
          <button style={toggleBtn} onClick={() => setShowRequest((v) => !v)}>
            {showRequest ? 'Ocultar payload' : 'Ver payload'}
          </button>
          {showRequest && (
            <pre style={preStyle}>{JSON.stringify(snap.request_payload, null, 2)}</pre>
          )}
        </div>

        {/* Response payload */}
        <div>
          <div style={{ ...sectionTitle, borderTop: isDark ? '1px solid #2a2a2a' : '1px solid #e2e8f0', paddingTop: 10 }}>
            Response Payload
          </div>
          <button style={toggleBtn} onClick={() => setShowResponse((v) => !v)}>
            {showResponse ? 'Ocultar payload' : 'Ver payload'}
          </button>
          {showResponse && (
            <pre style={preStyle}>{JSON.stringify(snap.response_payload, null, 2)}</pre>
          )}
        </div>
      </td>
    </tr>
  );
}

export function PredictionsLabPage() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await fetchSnapshots({ limit: 20 });
      setSnapshots(items);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('HTTP 404')) {
        setUnavailable(true);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Probe availability once on mount
  useEffect(() => {
    load();
  }, [load]);

  const root: React.CSSProperties = {
    minHeight: '100vh',
    backgroundColor: isDark ? '#0f0f0f' : '#f8fafc',
    color: isDark ? '#e2e8f0' : '#0f172a',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace',
    padding: 16,
  };

  const headerRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  };

  const title: React.CSSProperties = {
    fontSize: 15,
    fontWeight: 700,
    color: isDark ? '#e2e8f0' : '#0f172a',
    margin: 0,
    flex: 1,
  };

  const refreshBtn: React.CSSProperties = {
    fontSize: 12,
    background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    color: isDark ? '#94a3b8' : '#64748b',
    border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.12)',
    borderRadius: 6,
    padding: '5px 12px',
    cursor: 'pointer',
  };

  const thStyle: React.CSSProperties = {
    padding: '8px 10px',
    fontSize: 11,
    fontWeight: 600,
    color: isDark ? '#64748b' : '#475569',
    textAlign: 'left',
    whiteSpace: 'nowrap',
    borderBottom: isDark ? '1px solid #2a2a2a' : '1px solid #e2e8f0',
    background: isDark ? '#141414' : '#f1f5f9',
  };

  function tdStyle(isEven: boolean): React.CSSProperties {
    return {
      padding: '8px 10px',
      fontSize: 12,
      color: isDark ? '#e2e8f0' : '#0f172a',
      background: isDark ? (isEven ? '#222' : '#1a1a1a') : (isEven ? '#ffffff' : '#f8fafc'),
      borderBottom: isDark ? '1px solid #222' : '1px solid #e8ecf0',
      whiteSpace: 'nowrap',
      cursor: 'pointer',
    };
  }

  if (unavailable) {
    return (
      <div style={root}>
        <div style={{ position: 'fixed', top: 12, right: 16, zIndex: 100 }}>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
        <div style={headerRow}>
          <h1 style={title}>Labs — Predicciones</h1>
        </div>
        <div style={{ fontSize: 13, color: isDark ? '#94a3b8' : '#64748b', background: isDark ? '#1a1a1a' : '#ffffff', border: isDark ? '1px solid #2a2a2a' : '1px solid #e2e8f0', borderRadius: 8, padding: '16px 20px' }}>
          Labs no disponible — <code style={{ color: '#f87171' }}>PREDICTION_INTERNAL_VIEW_ENABLED</code> no esta configurado.
        </div>
      </div>
    );
  }

  return (
    <div style={root}>
      <div style={headerRow}>
        <h1 style={title}>Labs — Predicciones</h1>
        <button
          style={refreshBtn}
          onClick={() => { void load(); }}
          disabled={loading}
        >
          {loading ? 'Cargando...' : 'Refresh'}
        </button>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </div>

      {error && (
        <div style={{ fontSize: 12, color: '#f87171', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '10px 14px', marginBottom: 16 }}>
          Error: {error}
        </div>
      )}

      {!loading && !error && snapshots.length === 0 && (
        <div style={{ fontSize: 13, color: isDark ? '#64748b' : '#475569', background: isDark ? '#1a1a1a' : '#ffffff', border: isDark ? '1px solid #2a2a2a' : '1px solid #e2e8f0', borderRadius: 8, padding: '16px 20px' }}>
          Sin predicciones almacenadas. Activa{' '}
          <code style={{ color: '#facc15' }}>PREDICTION_SHADOW_ENABLED=comp:apifootball:140</code>{' '}
          para comenzar.
        </div>
      )}

      {snapshots.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={thStyle}>Match ID</th>
                <th style={thStyle}>Comp</th>
                <th style={thStyle}>Fecha</th>
                <th style={thStyle}>Mode</th>
                <th style={thStyle}>p_home</th>
                <th style={thStyle}>p_draw</th>
                <th style={thStyle}>p_away</th>
                <th style={thStyle}>Result</th>
                <th style={thStyle}>xG H</th>
                <th style={thStyle}>xG A</th>
                <th style={thStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((snap, idx) => {
                const key = expandKey(snap);
                const isExpanded = expandedId === key;
                const isEven = idx % 2 === 0;
                const shortId = snap.match_id.slice(-12);
                const badge = modeBadge(snap.mode);
                const td = tdStyle(isEven);

                return (
                  <>
                    <tr
                      key={key}
                      onClick={() => setExpandedId((prev) => (prev === key ? null : key))}
                      style={{ ...td, cursor: 'pointer' } as React.CSSProperties}
                    >
                      <td style={{ ...td, fontFamily: 'monospace', color: '#94a3b8' }}>
                        {shortId}
                      </td>
                      <td style={td}>{snap.competition_id.split(':').pop() ?? snap.competition_id}</td>
                      <td style={{ ...td, color: '#94a3b8' }}>{formatDate(snap.generated_at)}</td>
                      <td style={td}>
                        <span style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: badge.bg,
                          color: badge.color,
                        }}>
                          {badge.label}
                        </span>
                      </td>
                      <td style={td}>{fmtProb(snap.p_home_win)}</td>
                      <td style={td}>{fmtProb(snap.p_draw)}</td>
                      <td style={td}>{fmtProb(snap.p_away_win)}</td>
                      <td style={{ ...td, color: '#94a3b8' }}>{snap.predicted_result ?? '—'}</td>
                      <td style={td}>{fmtXg(snap.expected_goals_home)}</td>
                      <td style={td}>{fmtXg(snap.expected_goals_away)}</td>
                      <td style={td}>{snap.generation_status === 'ok' ? '✅' : '❌'}</td>
                    </tr>
                    {isExpanded && <ExpandedRow key={`${key}__expanded`} snap={snap} />}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
