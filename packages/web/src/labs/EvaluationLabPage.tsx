// OE-6 — Internal evaluation inspection page
// Route: /labs/evaluacion — not linked in Navbar, internal only
import { useState, useEffect, useCallback } from 'react';

// ── Types (mirror server EvaluationRecord + EvaluationMetrics) ────────────────

type EvaluationRecord = {
  match_id: string;
  competition_id: string;
  home_team_id: string;
  away_team_id: string;
  scheduled_kickoff_utc: string;
  snapshot_id: string;
  snapshot_frozen_at: string;
  snapshot_generated_at: string;
  engine_version: string;
  spec_version: string;
  prediction_available: boolean;
  evaluation_eligible: boolean;
  excluded_reason: string | null;
  mode: string;
  calibration_mode: string | null;
  predicted_result: string | null;
  p_home_win: number | null;
  p_draw: number | null;
  p_away_win: number | null;
  expected_goals_home: number | null;
  expected_goals_away: number | null;
  reasons: string[];
  ground_truth_status: 'PENDING' | 'CAPTURED' | 'UNAVAILABLE';
  ground_truth_captured_at: string | null;
  final_home_goals: number | null;
  final_away_goals: number | null;
  actual_result: string | null;
  ui_render_result: string | null;
  ui_clear_or_confusing: string | null;
  runtime_issue: string | null;
  runtime_notes: string | null;
};

type CoverageFunnel = {
  total_in_scope: number;
  with_pregame_snapshot: number;
  with_ground_truth: number;
  fully_evaluable: number;
  with_ui_observation: number;
  NOT_ELIGIBLE_count: number;
  NO_PREGAME_SNAPSHOT_count: number;
  mode_distribution: Record<string, number>;
};

type ModeMetrics = {
  count: number;
  accuracy: number | null;
  brier: number | null;
  log_loss: number | null;
};

type CalibrationMetrics = {
  count: number;
  accuracy: number | null;
  brier: number | null;
};

type PerformanceMetrics = {
  accuracy_total: number | null;
  confusion_matrix: Record<string, Record<string, number>> | null;
  brier_score_total: number | null;
  log_loss_total: number | null;
  by_mode: Record<string, ModeMetrics>;
  by_calibration_mode: Record<string, CalibrationMetrics>;
  baseline_b_accuracy: number | null;
};

type OperationalMetrics = {
  runtime_error_count: number;
  endpoint_miss_count: number;
  snapshot_miss_count: number;
  scope_mismatch_count: number;
};

type EvaluationResponse = {
  coverage_funnel: CoverageFunnel;
  performance: PerformanceMetrics;
  operational: OperationalMetrics;
  computed_at: string;
  total_records: number;
  records: EvaluationRecord[];
};

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchEvaluation(competitionId?: string): Promise<EvaluationResponse> {
  const url = new URL('/api/internal/evaluation', window.location.origin);
  if (competitionId) url.searchParams.set('competitionId', competitionId);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<EvaluationResponse>;
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch { return iso; }
}

function fmtPct(v: number | null): string {
  if (v === null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function fmtNum(v: number | null, dp = 3): string {
  if (v === null) return '—';
  return v.toFixed(dp);
}

// ── Styles ────────────────────────────────────────────────────────────────────

const ROOT: React.CSSProperties = {
  minHeight: '100vh',
  backgroundColor: '#0f0f0f',
  color: '#e2e8f0',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace',
  padding: 16,
};

const SECTION_TITLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: 8,
  marginTop: 20,
};

const PANEL: React.CSSProperties = {
  background: '#1a1a1a',
  border: '1px solid #2a2a2a',
  borderRadius: 8,
  padding: '14px 16px',
  marginBottom: 12,
};

const TH: React.CSSProperties = {
  padding: '7px 9px',
  fontSize: 10,
  fontWeight: 600,
  color: '#64748b',
  textAlign: 'left',
  whiteSpace: 'nowrap',
  borderBottom: '1px solid #2a2a2a',
  background: '#141414',
};

function tdStyle(isEven: boolean): React.CSSProperties {
  return {
    padding: '6px 9px',
    fontSize: 11,
    color: '#e2e8f0',
    background: isEven ? '#1d1d1d' : '#171717',
    borderBottom: '1px solid #1f1f1f',
    whiteSpace: 'nowrap',
  };
}

// ── Mode badge ────────────────────────────────────────────────────────────────

function modeBadge(mode: string): { label: string; bg: string; color: string } {
  switch (mode) {
    case 'FULL_MODE':     return { label: 'FULL',    bg: 'rgba(34,197,94,0.15)',  color: '#4ade80' };
    case 'LIMITED_MODE':  return { label: 'LIM',     bg: 'rgba(234,179,8,0.15)', color: '#facc15' };
    case 'NOT_ELIGIBLE':  return { label: 'N/ELIG',  bg: 'rgba(239,68,68,0.15)', color: '#f87171' };
    default:              return { label: mode,      bg: 'rgba(100,116,139,0.15)', color: '#94a3b8' };
  }
}

function gtBadge(status: string): { label: string; color: string } {
  switch (status) {
    case 'CAPTURED':     return { label: '✓', color: '#4ade80' };
    case 'UNAVAILABLE':  return { label: '✗', color: '#f87171' };
    default:             return { label: '…', color: '#94a3b8' };
  }
}

function hitBadge(predicted: string | null, actual: string | null): string {
  if (!predicted || !actual) return '—';
  return predicted === actual ? '✅' : '❌';
}

// ── Coverage Funnel Panel ─────────────────────────────────────────────────────

function CoverageFunnelPanel({ funnel }: { funnel: CoverageFunnel }) {
  const rows: [string, number][] = [
    ['1. In scope',            funnel.total_in_scope],
    ['2. Pre-kickoff snapshot', funnel.with_pregame_snapshot],
    ['3. Ground truth',        funnel.with_ground_truth],
    ['4. Fully evaluable',     funnel.fully_evaluable],
    ['5. UI render recorded',  funnel.with_ui_observation],
  ];

  return (
    <div>
      <div style={SECTION_TITLE}>Coverage Funnel</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        {rows.map(([label, count]) => (
          <div key={label} style={{ ...PANEL, minWidth: 130, padding: '10px 14px', marginBottom: 0 }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#e2e8f0' }}>{count}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
        <div style={{ fontSize: 12, color: '#94a3b8' }}>
          NOT_ELIGIBLE: <strong style={{ color: '#f87171' }}>{funnel.NOT_ELIGIBLE_count}</strong>
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginLeft: 12 }}>
          No pregame snapshot: <strong style={{ color: '#facc15' }}>{funnel.NO_PREGAME_SNAPSHOT_count}</strong>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        {Object.entries(funnel.mode_distribution).map(([mode, count]) => {
          const b = modeBadge(mode);
          return (
            <span key={mode} style={{ fontSize: 11, background: b.bg, color: b.color, borderRadius: 4, padding: '2px 7px' }}>
              {mode}: {count}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ── Performance Panel ─────────────────────────────────────────────────────────

function PerformancePanel({ perf }: { perf: PerformanceMetrics }) {
  return (
    <div>
      <div style={SECTION_TITLE}>Performance</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        {[
          { label: 'Accuracy total',  val: fmtPct(perf.accuracy_total) },
          { label: 'Brier total',     val: fmtNum(perf.brier_score_total) },
          { label: 'Log loss total',  val: fmtNum(perf.log_loss_total) },
          { label: 'Baseline B acc.', val: fmtPct(perf.baseline_b_accuracy) },
        ].map(({ label, val }) => (
          <div key={label} style={{ ...PANEL, minWidth: 120, padding: '10px 14px', marginBottom: 0 }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#e2e8f0' }}>{val}</div>
          </div>
        ))}
      </div>

      {/* By mode */}
      {Object.keys(perf.by_mode).length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: '#475569', marginBottom: 6 }}>By mode</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Object.entries(perf.by_mode).map(([mode, m]) => (
              <div key={mode} style={{ ...PANEL, padding: '8px 12px', marginBottom: 0, minWidth: 140 }}>
                <div style={{ fontSize: 10, color: modeBadge(mode).color, fontWeight: 700, marginBottom: 4 }}>{mode} ({m.count})</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>acc: {fmtPct(m.accuracy)}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>brier: {fmtNum(m.brier)}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>logloss: {fmtNum(m.log_loss)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* By calibration mode */}
      {Object.keys(perf.by_calibration_mode).length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: '#475569', marginBottom: 6 }}>By calibration mode</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Object.entries(perf.by_calibration_mode).map(([key, m]) => (
              <div key={key} style={{ ...PANEL, padding: '8px 12px', marginBottom: 0, minWidth: 120 }}>
                <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, marginBottom: 4 }}>{key} ({m.count})</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>acc: {fmtPct(m.accuracy)}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>brier: {fmtNum(m.brier)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confusion matrix */}
      {perf.confusion_matrix && (
        <div>
          <div style={{ fontSize: 11, color: '#475569', marginBottom: 6 }}>Confusion matrix (predicted → actual)</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={{ ...TH, background: '#111' }}>pred\actual</th>
                  {['HOME_WIN', 'DRAW', 'AWAY_WIN'].map((h) => (
                    <th key={h} style={{ ...TH, color: '#94a3b8' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {['HOME_WIN', 'DRAW', 'AWAY_WIN'].map((pred) => (
                  <tr key={pred}>
                    <td style={{ ...tdStyle(false), fontWeight: 600, color: '#94a3b8' }}>{pred}</td>
                    {['HOME_WIN', 'DRAW', 'AWAY_WIN'].map((actual) => {
                      const v = perf.confusion_matrix?.[pred]?.[actual] ?? 0;
                      const isDiag = pred === actual;
                      return (
                        <td key={actual} style={{ ...tdStyle(false), color: isDiag ? '#4ade80' : '#e2e8f0', fontWeight: isDiag ? 700 : 400 }}>
                          {v}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Operational Panel ─────────────────────────────────────────────────────────

function OperationalPanel({ op }: { op: OperationalMetrics }) {
  return (
    <div>
      <div style={SECTION_TITLE}>Operational</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[
          { label: 'Runtime errors',   val: op.runtime_error_count,  warn: op.runtime_error_count > 0 },
          { label: 'Endpoint misses',  val: op.endpoint_miss_count,  warn: op.endpoint_miss_count > 0 },
          { label: 'Snapshot misses',  val: op.snapshot_miss_count,  warn: op.snapshot_miss_count > 0 },
          { label: 'Scope mismatches', val: op.scope_mismatch_count, warn: op.scope_mismatch_count > 0 },
        ].map(({ label, val, warn }) => (
          <div key={label} style={{ ...PANEL, minWidth: 110, padding: '10px 14px', marginBottom: 0 }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: warn ? '#f87171' : '#4ade80' }}>{val}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Per-match table ───────────────────────────────────────────────────────────

function RecordsTable({ records }: { records: EvaluationRecord[] }) {
  if (records.length === 0) {
    return (
      <div style={{ fontSize: 13, color: '#64748b', ...PANEL }}>
        Sin registros de evaluación todavía.
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr>
            <th style={TH}>Kickoff</th>
            <th style={TH}>Match ID</th>
            <th style={TH}>Mode</th>
            <th style={TH}>GT</th>
            <th style={TH}>Actual</th>
            <th style={TH}>Predicted</th>
            <th style={TH}>Hit</th>
            <th style={TH}>p_home</th>
            <th style={TH}>p_draw</th>
            <th style={TH}>p_away</th>
            <th style={TH}>xG H</th>
            <th style={TH}>xG A</th>
            <th style={TH}>UI render</th>
            <th style={TH}>Eligible</th>
            <th style={TH}>Excluded reason</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r, idx) => {
            const isEven = idx % 2 === 0;
            const td = tdStyle(isEven);
            const badge = modeBadge(r.mode);
            const gt = gtBadge(r.ground_truth_status);
            const score = r.final_home_goals !== null && r.final_away_goals !== null
              ? `${r.final_home_goals}:${r.final_away_goals}`
              : '—';

            return (
              <tr key={r.match_id}>
                <td style={{ ...td, color: '#94a3b8' }}>{fmtDate(r.scheduled_kickoff_utc)}</td>
                <td style={{ ...td, fontFamily: 'monospace', color: '#64748b', fontSize: 10 }}>
                  {r.match_id.slice(-12)}
                </td>
                <td style={td}>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: badge.bg, color: badge.color }}>
                    {badge.label}
                  </span>
                </td>
                <td style={{ ...td, color: gt.color, fontWeight: 700 }}>{gt.label}</td>
                <td style={{ ...td, color: '#94a3b8' }}>{r.actual_result ?? score}</td>
                <td style={{ ...td, color: '#94a3b8' }}>{r.predicted_result ?? '—'}</td>
                <td style={td}>{hitBadge(r.predicted_result, r.actual_result)}</td>
                <td style={td}>{fmtNum(r.p_home_win, 2)}</td>
                <td style={td}>{fmtNum(r.p_draw, 2)}</td>
                <td style={td}>{fmtNum(r.p_away_win, 2)}</td>
                <td style={td}>{fmtNum(r.expected_goals_home, 2)}</td>
                <td style={td}>{fmtNum(r.expected_goals_away, 2)}</td>
                <td style={{ ...td, fontSize: 9, color: '#64748b' }}>{r.ui_render_result ?? '—'}</td>
                <td style={{ ...td, color: r.evaluation_eligible ? '#4ade80' : '#f87171' }}>
                  {r.evaluation_eligible ? 'Y' : 'N'}
                </td>
                <td style={{ ...td, fontSize: 9, color: '#94a3b8' }}>{r.excluded_reason ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function EvaluationLabPage() {
  const [data, setData] = useState<EvaluationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchEvaluation('comp:apifootball:140');
      setData(result);
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

  useEffect(() => {
    void load();
  }, [load]);

  const headerRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  };

  const title: React.CSSProperties = {
    fontSize: 15,
    fontWeight: 700,
    color: '#e2e8f0',
    margin: 0,
    flex: 1,
  };

  const refreshBtn: React.CSSProperties = {
    fontSize: 12,
    background: 'rgba(255,255,255,0.06)',
    color: '#94a3b8',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 6,
    padding: '5px 12px',
    cursor: 'pointer',
  };

  if (unavailable) {
    return (
      <div style={ROOT}>
        <div style={headerRow}>
          <h1 style={title}>Labs — Evaluación PE</h1>
        </div>
        <div style={{ fontSize: 13, color: '#94a3b8', ...PANEL }}>
          No disponible — <code style={{ color: '#f87171' }}>PREDICTION_INTERNAL_VIEW_ENABLED</code> no está configurado.
        </div>
      </div>
    );
  }

  return (
    <div style={ROOT}>
      <div style={headerRow}>
        <h1 style={title}>Labs — Evaluación PE</h1>
        {data && (
          <span style={{ fontSize: 11, color: '#475569' }}>
            Calculado: {fmtDate(data.computed_at)} · {data.total_records} registros
          </span>
        )}
        <button style={refreshBtn} onClick={() => { void load(); }} disabled={loading}>
          {loading ? 'Cargando...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ fontSize: 12, color: '#f87171', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '10px 14px', marginBottom: 16 }}>
          Error: {error}
        </div>
      )}

      {loading && !data && (
        <div style={{ fontSize: 13, color: '#64748b', ...PANEL }}>Cargando...</div>
      )}

      {data && (
        <>
          <div style={PANEL}>
            <CoverageFunnelPanel funnel={data.coverage_funnel} />
          </div>
          <div style={PANEL}>
            <PerformancePanel perf={data.performance} />
          </div>
          <div style={PANEL}>
            <OperationalPanel op={data.operational} />
          </div>
          <div style={SECTION_TITLE}>Registros por partido ({data.records.length})</div>
          <div style={PANEL}>
            <RecordsTable records={data.records} />
          </div>
        </>
      )}
    </div>
  );
}
