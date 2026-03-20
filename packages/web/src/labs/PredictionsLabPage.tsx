// PE-76 — Internal diagnostics page for Predictive Engine snapshots
// Route: /labs/predicciones — not linked in Navbar, internal only
import React, { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../hooks/use-theme.js';
import { ThemeToggle } from '../components/ThemeToggle.js';
import { usePredictionLeagues } from './use-prediction-leagues.js';

type Snapshot = {
  match_id: string;
  competition_id: string;
  generated_at: string;
  engine_version: string;
  kickoff_utc: string | null;
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
  engine_source?: 'v3' | 'nexus';
  home_team_name?: string;
  away_team_name?: string;
};

async function fetchSnapshots(params: { competitionId?: string; limit?: number; engine?: 'both' | 'v3' | 'nexus' }): Promise<Snapshot[]> {
  const url = new URL('/api/internal/predictions', window.location.origin);
  if (params.competitionId) url.searchParams.set('competitionId', params.competitionId);
  if (params.limit) url.searchParams.set('limit', String(params.limit));
  if (params.engine) url.searchParams.set('engine', params.engine);
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
  return `${Math.round(v * 100)}%`;
}

function fmtXg(v: number | null): string {
  if (v === null) return '—';
  return v.toFixed(1);
}

function fmtResult(v: string | null): string {
  if (!v) return '—';
  if (v === 'HOME_WIN') return 'Local';
  if (v === 'DRAW') return 'Empate';
  if (v === 'AWAY_WIN') return 'Visita';
  return v;
}

function getKickoffUtc(snap: Snapshot): string | null {
  return snap.kickoff_utc ?? null;
}

function matchLabel(snap: Snapshot): string {
  if (snap.home_team_name && snap.away_team_name) {
    return `${snap.home_team_name} vs ${snap.away_team_name}`;
  }
  return snap.match_id.split(':').pop() ?? snap.match_id;
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
      <td colSpan={12} style={cellStyle}>
        {/* Summary line */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: 12, fontSize: 12, color: isDark ? '#94a3b8' : '#64748b' }}>
          <span style={{ fontFamily: 'monospace', color: '#64748b', fontSize: 11 }}>{snap.match_id}</span>
          <span><span style={{ color: '#64748b' }}>Mode:</span> {snap.mode}</span>
          <span><span style={{ color: '#64748b' }}>Calibración:</span> {snap.calibration_mode ?? '—'}</span>
          {snap.favorite_margin !== null && (
            <span><span style={{ color: '#64748b' }}>margen favorito:</span> {snap.favorite_margin.toFixed(3)}</span>
          )}
          {snap.draw_risk !== null && (
            <span><span style={{ color: '#64748b' }}>riesgo empate:</span> {snap.draw_risk.toFixed(3)}</span>
          )}
          {snap.engine_version && (
            <span><span style={{ color: '#64748b' }}>motor:</span> {snap.engine_version}</span>
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
  const [engineFilter, setEngineFilter] = useState<'both' | 'v3' | 'nexus'>('both');
  const [compFilter, setCompFilter] = useState<string>('');
  const [limitValue, setLimitValue] = useState<number>(200);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await fetchSnapshots({
        limit: limitValue,
        engine: engineFilter,
        competitionId: compFilter || undefined,
      });
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
  }, [engineFilter, compFilter, limitValue]);

  useEffect(() => {
    void load();
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

  const engineToggleBase: React.CSSProperties = {
    fontSize: 11,
    borderRadius: 4,
    padding: '3px 10px',
    cursor: 'pointer',
    border: isDark ? '1px solid #2a3a4a' : '1px solid #cbd5e1',
  };

  function engineToggleStyle(active: boolean): React.CSSProperties {
    return {
      ...engineToggleBase,
      background: active ? '#1e3a5f' : (isDark ? '#1a1a1a' : '#f1f5f9'),
      color: active ? '#60a5fa' : (isDark ? '#64748b' : '#475569'),
    };
  }

  const selectStyle: React.CSSProperties = {
    fontSize: 11,
    borderRadius: 4,
    padding: '3px 8px',
    border: isDark ? '1px solid #2a3a4a' : '1px solid #cbd5e1',
    background: isDark ? '#1a1a1a' : '#f1f5f9',
    color: isDark ? '#94a3b8' : '#475569',
    cursor: 'pointer',
  };

  const leagues = usePredictionLeagues();
  const compOptions: Array<{ value: string; label: string }> = [
    { value: '', label: 'Todas las ligas' },
    ...leagues.map((l) => ({ value: l.id, label: l.displayName })),
  ];

  return (
    <div style={root}>
      <div style={{ ...headerRow, flexWrap: 'wrap' }}>
        <h1 style={title}>Labs — Predicciones</h1>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {(['both', 'v3', 'nexus'] as const).map((opt) => (
            <button
              key={opt}
              style={engineToggleStyle(engineFilter === opt)}
              onClick={() => setEngineFilter(opt)}
            >
              {opt === 'both' ? 'Todos' : opt === 'v3' ? 'V3' : 'NEXUS'}
            </button>
          ))}
        </div>
        <select
          style={selectStyle}
          value={compFilter}
          onChange={(e) => setCompFilter(e.target.value)}
        >
          {compOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          style={selectStyle}
          value={limitValue}
          onChange={(e) => setLimitValue(Number(e.target.value))}
        >
          {[50, 100, 200, 500, 1000].map((n) => (
            <option key={n} value={n}>{n} registros</option>
          ))}
        </select>
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
          <code style={{ color: '#facc15' }}>PREDICTION_NEXUS_SHADOW_ENABLED=comp:apifootball:140</code>{' '}
          para comenzar.
        </div>
      )}

      {snapshots.length > 0 && (() => {
        const kickoffs = snapshots
          .map((s) => s.kickoff_utc)
          .filter((k): k is string => k !== null && k !== '');
        const oldest = kickoffs.length > 0
          ? kickoffs.reduce((a, b) => (a < b ? a : b)).slice(0, 10)
          : null;
        const newest = kickoffs.length > 0
          ? kickoffs.reduce((a, b) => (a > b ? a : b)).slice(0, 10)
          : null;
        return (
          <div style={{ marginBottom: 8, fontSize: 11, color: isDark ? '#475569' : '#94a3b8', flexWrap: 'wrap', display: 'flex', gap: 4 }}>
            <span>{snapshots.length} predicciones</span>
            {oldest && newest && (
              <>
                <span style={{ color: isDark ? '#2d3748' : '#cbd5e1' }}>·</span>
                <span>kickoff {oldest} → {newest}</span>
              </>
            )}
          </div>
        );
      })()}

      {snapshots.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={thStyle}>Partido</th>
                <th style={thStyle}>Liga</th>
                <th style={thStyle}>Motor</th>
                <th style={thStyle}>Kickoff</th>
                <th style={thStyle}>Mode</th>
                <th style={thStyle}>Local</th>
                <th style={thStyle}>Empate</th>
                <th style={thStyle}>Visita</th>
                <th style={thStyle}>Pronóstico</th>
                <th style={thStyle}>xG L</th>
                <th style={thStyle}>xG V</th>
                <th style={thStyle}>Gen</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                // In compare mode (both), group by match_id to show pairs consecutively
                let ordered: Array<{ snap: Snapshot; isDivider: boolean }>;
                if (engineFilter === 'both') {
                  const byMatchId = new Map<string, Snapshot[]>();
                  for (const snap of snapshots) {
                    const group = byMatchId.get(snap.match_id) ?? [];
                    group.push(snap);
                    byMatchId.set(snap.match_id, group);
                  }
                  ordered = [];
                  for (const group of byMatchId.values()) {
                    const sorted = [...group].sort((a, b) => {
                      const order = { v3: 0, nexus: 1 };
                      return (order[a.engine_source ?? 'v3'] ?? 0) - (order[b.engine_source ?? 'v3'] ?? 0);
                    });
                    sorted.forEach((snap, i) => {
                      ordered.push({ snap, isDivider: i > 0 && group.length > 1 });
                    });
                  }
                } else {
                  ordered = snapshots.map((snap) => ({ snap, isDivider: false }));
                }

                return ordered.map(({ snap, isDivider }, idx) => {
                  const key = expandKey(snap);
                  const isExpanded = expandedId === key;
                  const isEven = idx % 2 === 0;
                  const badge = modeBadge(snap.mode);
                  const kickoffStr = getKickoffUtc(snap);
                  const displayDate = kickoffStr ? formatDate(kickoffStr) : formatDate(snap.generated_at);
                  const engineSrc = snap.engine_source ?? 'v3';
                  const engineBadge = engineSrc === 'nexus'
                    ? { label: 'NEXUS', bg: 'rgba(139,92,246,0.15)', color: '#a78bfa' }
                    : { label: 'V3',    bg: 'rgba(59,130,246,0.15)',  color: '#60a5fa' };
                  const td = tdStyle(isEven);
                  const dividerBorder = isDivider ? '1px dashed #2a2a2a' : undefined;

                  return (
                    <React.Fragment key={key}>
                      <tr
                        onClick={() => setExpandedId((prev) => (prev === key ? null : key))}
                        style={{ ...td, cursor: 'pointer', borderTop: dividerBorder } as React.CSSProperties}
                      >
                        <td style={{ ...td, borderTop: dividerBorder, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {matchLabel(snap)}
                        </td>
                        <td style={{ ...td, borderTop: dividerBorder }}>{snap.competition_id.split(':').pop() ?? snap.competition_id}</td>
                        <td style={{ ...td, borderTop: dividerBorder }}>
                          <span style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: 4,
                            background: engineBadge.bg,
                            color: engineBadge.color,
                          }}>
                            {engineBadge.label}
                          </span>
                        </td>
                        <td style={{ ...td, color: '#94a3b8', borderTop: dividerBorder }}>{displayDate}</td>
                        <td style={{ ...td, borderTop: dividerBorder }}>
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
                        <td style={{ ...td, borderTop: dividerBorder }}>{fmtProb(snap.p_home_win)}</td>
                        <td style={{ ...td, borderTop: dividerBorder }}>{fmtProb(snap.p_draw)}</td>
                        <td style={{ ...td, borderTop: dividerBorder }}>{fmtProb(snap.p_away_win)}</td>
                        <td style={{ ...td, fontWeight: 600, borderTop: dividerBorder }}>{fmtResult(snap.predicted_result)}</td>
                        <td style={{ ...td, color: '#94a3b8', borderTop: dividerBorder }}>{fmtXg(snap.expected_goals_home)}</td>
                        <td style={{ ...td, color: '#94a3b8', borderTop: dividerBorder }}>{fmtXg(snap.expected_goals_away)}</td>
                        <td style={{ ...td, borderTop: dividerBorder, color: snap.generation_status === 'ok' ? '#4ade80' : '#f87171', fontSize: 10, fontWeight: 600 }}>{snap.generation_status === 'ok' ? 'OK' : 'ERR'}</td>
                      </tr>
                      {isExpanded && <ExpandedRow key={`${key}__expanded`} snap={snap} />}
                    </React.Fragment>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
