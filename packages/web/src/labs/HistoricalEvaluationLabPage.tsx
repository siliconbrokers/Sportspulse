/**
 * /labs/evaluacion-historica — Internal evaluation UI for historical backtest.
 *
 * source_type = HISTORICAL_BACKTEST only. Never mixes with forward evaluation.
 *
 * Panels:
 *   A. Aggregate summary (denominator, class dist, accuracy, Brier, log-loss, baselines)
 *   B. DRAW collapse diagnosis
 *   C. Per-match table with filters
 *
 * H5 — Internal Evaluation UI
 */

import { useState, useEffect } from 'react';

// ── Types (mirror server HistoricalBacktestSnapshot + HistoricalEvaluationReport) ──

type Outcome = 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';

type Snapshot = {
  snapshot_id: string;
  source_type: 'HISTORICAL_BACKTEST';
  competition_code: string;
  match_id: string;
  kickoff_utc: string;
  home_team_id: string;
  away_team_id: string;
  actual_result: Outcome;
  home_goals: number;
  away_goals: number;
  as_of_quality: 'FULL' | 'PARTIAL' | 'BOOTSTRAP';
  elo_home_pre: number;
  elo_away_pre: number;
  elo_home_update_count: number;
  elo_away_update_count: number;
  matches_365d_home: number;
  matches_365d_away: number;
  total_historical_matches: number;
  mode: string;
  predicted_result: string | null;
  p_home_win: number | null;
  p_draw: number | null;
  p_away_win: number | null;
  expected_goals_home: number | null;
  expected_goals_away: number | null;
  reasons: string[];
  baseline_predicted_result: string | null;
  baseline_p_home_win: number | null;
  baseline_p_draw: number | null;
  baseline_p_away_win: number | null;
  build_status: 'SUCCESS' | 'NOT_ELIGIBLE' | 'ERROR';
  error_detail?: string;
  generated_at: string;
};

type SliceMetrics = {
  denominator: number;
  accuracy: number;
  correct: number;
  brier_score: number | null;
  log_loss: number | null;
  prob_denominator: number;
  confusion_matrix: {
    HOME_WIN: { HOME_WIN: number; DRAW: number; AWAY_WIN: number };
    DRAW:     { HOME_WIN: number; DRAW: number; AWAY_WIN: number };
    AWAY_WIN: { HOME_WIN: number; DRAW: number; AWAY_WIN: number };
  };
};

type BaselineResult = {
  strategy: string;
  always_predicts: string;
  denominator: number;
  correct: number;
  accuracy: number;
};

type ProbBaseline = {
  strategy: string;
  probs: { HOME_WIN: number; DRAW: number; AWAY_WIN: number };
  prob_denominator: number;
  brier_score: number | null;
  log_loss: number | null;
};

type EvaluationReport = {
  exclusion_breakdown: {
    not_eligible: number;
    error: number;
    limited_mode_no_prediction: number;
    too_close: number;
    total_excluded: number;
    total_snapshots: number;
    evaluable: number;
  };
  full_mode_metrics: SliceMetrics | null;
  limited_mode_metrics: SliceMetrics | null;
  combined_metrics: SliceMetrics | null;
  actual_class_distribution: { HOME_WIN: number; DRAW: number; AWAY_WIN: number; total: number } | null;
  prediction_class_distribution: { HOME_WIN: number; DRAW: number; AWAY_WIN: number } | null;
  baselines: {
    most_frequent_class: BaselineResult;
    always_home_win: BaselineResult;
  } | null;
  probabilistic_baselines: {
    uniform: ProbBaseline;
    empirical_freq: ProbBaseline;
  } | null;
  beats_most_frequent_class: boolean | null;
  beats_always_home_win: boolean | null;
  beats_uniform_brier: boolean | null;
  beats_uniform_log_loss: boolean | null;
  beats_empirical_brier: boolean | null;
  beats_empirical_log_loss: boolean | null;
  elo_breaks_symmetry: number;
  elo_breaks_symmetry_denominator: number;
};

type ApiResponse = {
  source_type: 'HISTORICAL_BACKTEST';
  competition_code: string;
  snapshot_count: number;
  report: EvaluationReport;
  snapshots: Snapshot[];
};

// ── Per-row DRAW diagnostics ───────────────────────────────────────────────

type DrawDiagRow = {
  snap: Snapshot;
  top1_class: string;
  top1_prob: number;
  top2_class: string;
  top2_prob: number;
  top1_minus_top2: number;
  selected_minus_draw: number | null;
};

function computeDrawDiag(snap: Snapshot): DrawDiagRow {
  const probs: { class: Outcome; p: number }[] = [];
  if (snap.p_home_win !== null) probs.push({ class: 'HOME_WIN', p: snap.p_home_win });
  if (snap.p_draw !== null)     probs.push({ class: 'DRAW',     p: snap.p_draw });
  if (snap.p_away_win !== null) probs.push({ class: 'AWAY_WIN', p: snap.p_away_win });
  probs.sort((a, b) => b.p - a.p);

  const top1 = probs[0] ?? { class: '?', p: 0 };
  const top2 = probs[1] ?? { class: '?', p: 0 };
  const top1_minus_top2 = top1.p - top2.p;

  let selected_minus_draw: number | null = null;
  if (snap.predicted_result && snap.p_draw !== null) {
    const pSelected = snap.predicted_result === 'HOME_WIN' ? snap.p_home_win
      : snap.predicted_result === 'AWAY_WIN' ? snap.p_away_win
      : snap.p_draw;
    if (pSelected !== null) selected_minus_draw = pSelected - snap.p_draw;
  }

  return {
    snap,
    top1_class: top1.class,
    top1_prob: top1.p,
    top2_class: top2.class,
    top2_prob: top2.p,
    top1_minus_top2,
    selected_minus_draw,
  };
}

// ── Data fetching ─────────────────────────────────────────────────────────

async function fetchHistoricalEvaluation(code = 'PD'): Promise<ApiResponse> {
  const url = new URL('/api/internal/historical-evaluation', window.location.origin);
  url.searchParams.set('competitionCode', code);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status} — asegúrate de tener PREDICTION_INTERNAL_VIEW_ENABLED=true en .env`);
  return res.json() as Promise<ApiResponse>;
}

// ── Formatters ────────────────────────────────────────────────────────────

function fmtPct(v: number | null): string {
  if (v === null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}
function fmtNum(v: number | null, dp = 3): string {
  if (v === null) return '—';
  return v.toFixed(dp);
}
function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  } catch { return iso.slice(0, 16); }
}
function shortId(id: string): string {
  return id.split(':').pop() ?? id;
}
function resultColor(r: string | null): string {
  if (r === 'HOME_WIN') return '#22c55e';
  if (r === 'AWAY_WIN') return '#ef4444';
  if (r === 'DRAW') return '#f59e0b';
  return '#64748b';
}

// ── Styles ────────────────────────────────────────────────────────────────

const ROOT: React.CSSProperties = {
  minHeight: '100vh',
  backgroundColor: '#0a0a0a',
  color: '#e2e8f0',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace',
  fontSize: 12,
  padding: '12px 16px',
};

const PANEL: React.CSSProperties = {
  background: '#141414',
  border: '1px solid #2a2a2a',
  borderRadius: 8,
  padding: '12px 14px',
  marginBottom: 12,
};

const SECTION_TITLE: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  marginBottom: 8,
  marginTop: 16,
};

const TH: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: 10,
  fontWeight: 600,
  color: '#64748b',
  textAlign: 'left',
  whiteSpace: 'nowrap',
  borderBottom: '1px solid #2a2a2a',
  background: '#0f0f0f',
  cursor: 'default',
};

function TD(i: number, right = false): React.CSSProperties {
  return {
    padding: '5px 8px',
    fontSize: 11,
    background: i % 2 === 0 ? '#141414' : '#111',
    borderBottom: '1px solid #1c1c1c',
    whiteSpace: 'nowrap',
    textAlign: right ? 'right' : 'left',
  };
}

const BADGE_HBT: React.CSSProperties = {
  display: 'inline-block',
  background: '#1e3a5f',
  color: '#60a5fa',
  border: '1px solid #2563eb',
  borderRadius: 4,
  padding: '2px 7px',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.05em',
};

// ── Small bar chart ───────────────────────────────────────────────────────

function DistBar({ value, total, color }: { value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 120, height: 8, background: '#2a2a2a', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4 }} />
      </div>
      <span style={{ color: '#94a3b8', fontSize: 11, minWidth: 60 }}>
        {value} / {total} ({pct.toFixed(1)}%)
      </span>
    </div>
  );
}

// ── Verdict badge ─────────────────────────────────────────────────────────

function Verdict({ v, label }: { v: boolean | null; label: string }) {
  const color = v === true ? '#22c55e' : v === false ? '#ef4444' : '#64748b';
  const icon = v === true ? '✓' : v === false ? '✗' : '—';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
      <span style={{ color, fontWeight: 700, fontSize: 12, width: 14 }}>{icon}</span>
      <span style={{ color: '#94a3b8', fontSize: 11 }}>{label}</span>
    </div>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────

type Filters = {
  mode: string;
  actual: string;
  predicted: string;
  hit: string;
};

function FilterBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const sel: React.CSSProperties = {
    background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#e2e8f0',
    borderRadius: 4, padding: '3px 6px', fontSize: 11, marginRight: 8,
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10, alignItems: 'center' }}>
      <span style={{ color: '#64748b', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Filtros:</span>
      <select style={sel} value={filters.mode} onChange={e => onChange({ ...filters, mode: e.target.value })}>
        <option value="">Todos los modos</option>
        <option value="FULL_MODE">FULL_MODE</option>
        <option value="LIMITED_MODE">LIMITED_MODE</option>
        <option value="NOT_ELIGIBLE">NOT_ELIGIBLE</option>
      </select>
      <select style={sel} value={filters.actual} onChange={e => onChange({ ...filters, actual: e.target.value })}>
        <option value="">Todos los resultados</option>
        <option value="HOME_WIN">HOME_WIN</option>
        <option value="DRAW">DRAW</option>
        <option value="AWAY_WIN">AWAY_WIN</option>
      </select>
      <select style={sel} value={filters.predicted} onChange={e => onChange({ ...filters, predicted: e.target.value })}>
        <option value="">Todas las predicciones</option>
        <option value="HOME_WIN">pred HOME_WIN</option>
        <option value="DRAW">pred DRAW</option>
        <option value="AWAY_WIN">pred AWAY_WIN</option>
        <option value="null">pred null</option>
      </select>
      <select style={sel} value={filters.hit} onChange={e => onChange({ ...filters, hit: e.target.value })}>
        <option value="">Hit y Miss</option>
        <option value="hit">Solo hits</option>
        <option value="miss">Solo misses</option>
      </select>
      <button
        style={{ ...sel, cursor: 'pointer', color: '#f59e0b', borderColor: '#f59e0b' }}
        onClick={() => onChange({ mode: '', actual: '', predicted: '', hit: '' })}
      >
        Reset
      </button>
    </div>
  );
}

// ── Per-match table ───────────────────────────────────────────────────────

function MatchTable({ snapshots }: { snapshots: Snapshot[] }) {
  const [filters, setFilters] = useState<Filters>({ mode: '', actual: '', predicted: '', hit: '' });

  const filtered = snapshots.filter(s => {
    if (filters.mode && s.mode !== filters.mode) return false;
    if (filters.actual && s.actual_result !== filters.actual) return false;
    if (filters.predicted) {
      if (filters.predicted === 'null' && s.predicted_result !== null) return false;
      if (filters.predicted !== 'null' && s.predicted_result !== filters.predicted) return false;
    }
    if (filters.hit === 'hit' && s.predicted_result !== s.actual_result) return false;
    if (filters.hit === 'miss' && (s.predicted_result === null || s.predicted_result === s.actual_result)) return false;
    return true;
  });

  return (
    <>
      <FilterBar filters={filters} onChange={setFilters} />
      <div style={{ color: '#64748b', fontSize: 10, marginBottom: 6 }}>
        Mostrando {filtered.length} de {snapshots.length} partidos · source_type = HISTORICAL_BACKTEST
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
          <thead>
            <tr>
              {['Kickoff','Match','Actual','Pred','Hit?','Mode','p_H','p_D','p_A','xG H','xG A','Baseline','Elo H/A','365d'].map(h => (
                <th key={h} style={TH}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((s, i) => {
              const hit = s.predicted_result !== null && s.predicted_result === s.actual_result;
              const miss = s.predicted_result !== null && s.predicted_result !== s.actual_result;
              return (
                <tr key={s.snapshot_id}>
                  <td style={TD(i)}>{fmtDate(s.kickoff_utc)}</td>
                  <td style={TD(i)}>
                    <span style={{ color: '#94a3b8', fontSize: 10 }}>{shortId(s.match_id)}</span>
                    <span style={{ marginLeft: 6, color: '#e2e8f0' }}>
                      {s.home_goals}–{s.away_goals}
                    </span>
                  </td>
                  <td style={{ ...TD(i), color: resultColor(s.actual_result), fontWeight: 600 }}>
                    {s.actual_result.replace('_WIN','')}
                  </td>
                  <td style={{ ...TD(i), color: resultColor(s.predicted_result) }}>
                    {s.predicted_result ? s.predicted_result.replace('_WIN','') : '—'}
                  </td>
                  <td style={{ ...TD(i), textAlign: 'center' }}>
                    {s.predicted_result === null ? <span style={{ color: '#475569' }}>—</span>
                      : hit ? <span style={{ color: '#22c55e', fontWeight: 700 }}>✓</span>
                      : miss ? <span style={{ color: '#ef4444', fontWeight: 700 }}>✗</span>
                      : null}
                  </td>
                  <td style={{ ...TD(i), color: s.mode === 'FULL_MODE' ? '#60a5fa' : s.mode === 'LIMITED_MODE' ? '#f59e0b' : '#64748b', fontSize: 10 }}>
                    {s.mode.replace('_MODE','').replace('NOT_ELIGIBLE','N/E')}
                  </td>
                  <td style={{ ...TD(i, true), color: '#94a3b8' }}>{fmtNum(s.p_home_win, 2)}</td>
                  <td style={{ ...TD(i, true), color: s.actual_result === 'DRAW' ? '#f59e0b' : '#94a3b8' }}>{fmtNum(s.p_draw, 2)}</td>
                  <td style={{ ...TD(i, true), color: '#94a3b8' }}>{fmtNum(s.p_away_win, 2)}</td>
                  <td style={{ ...TD(i, true), color: '#94a3b8' }}>{fmtNum(s.expected_goals_home, 2)}</td>
                  <td style={{ ...TD(i, true), color: '#94a3b8' }}>{fmtNum(s.expected_goals_away, 2)}</td>
                  <td style={{ ...TD(i), color: resultColor(s.baseline_predicted_result), fontSize: 10 }}>
                    {s.baseline_predicted_result ? s.baseline_predicted_result.replace('_WIN','') : '—'}
                  </td>
                  <td style={{ ...TD(i, true), color: '#64748b', fontSize: 10 }}>
                    {s.elo_home_pre.toFixed(0)}/{s.elo_away_pre.toFixed(0)}
                  </td>
                  <td style={{ ...TD(i, true), color: '#64748b', fontSize: 10 }}>
                    {s.matches_365d_home}/{s.matches_365d_away}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div style={{ padding: '20px 0', textAlign: 'center', color: '#475569', fontSize: 12 }}>
            No hay registros con estos filtros.
          </div>
        )}
      </div>
    </>
  );
}

// ── DRAW Diagnosis Panel ───────────────────────────────────────────────────

function DrawDiagnosisPanel({ snapshots }: { snapshots: Snapshot[] }) {
  const drawMatches = snapshots.filter(s => s.actual_result === 'DRAW');
  const withProbs = drawMatches.filter(s => s.p_home_win !== null);
  const diagRows: DrawDiagRow[] = withProbs.map(computeDrawDiag);

  // Classify each row
  const probProblem = diagRows.filter(r => r.selected_minus_draw !== null && r.selected_minus_draw > 0.05);
  const borderline   = diagRows.filter(r => r.selected_minus_draw !== null && r.selected_minus_draw >= 0 && r.selected_minus_draw <= 0.05);
  const noProbs      = drawMatches.filter(s => s.p_home_win === null);

  return (
    <div style={PANEL}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 14, color: '#f59e0b' }}>⚠</span>
        <strong style={{ color: '#f59e0b', fontSize: 13 }}>DRAW Collapse Diagnosis</strong>
        <span style={{ color: '#64748b', fontSize: 11 }}>
          — Real DRAWs: <strong style={{ color: '#f59e0b' }}>{drawMatches.length}</strong>
          {' · '}Predicted DRAWs: <strong style={{ color: '#ef4444' }}>0</strong>
        </span>
      </div>

      {/* Summary boxes */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 6, padding: '8px 12px', minWidth: 160 }}>
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Prob problem</div>
          <div style={{ fontSize: 20, color: '#ef4444', fontWeight: 700 }}>{probProblem.length}</div>
          <div style={{ fontSize: 10, color: '#94a3b8' }}>selected_minus_draw &gt; 5%</div>
          <div style={{ fontSize: 10, color: '#94a3b8' }}>Model genuinely underestimates DRAW</div>
        </div>
        <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 6, padding: '8px 12px', minWidth: 160 }}>
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Borderline</div>
          <div style={{ fontSize: 20, color: '#f59e0b', fontWeight: 700 }}>{borderline.length}</div>
          <div style={{ fontSize: 10, color: '#94a3b8' }}>selected_minus_draw ≤ 5%</div>
          <div style={{ fontSize: 10, color: '#94a3b8' }}>Decision rule blocks DRAW call</div>
        </div>
        <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 6, padding: '8px 12px', minWidth: 160 }}>
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>No probs</div>
          <div style={{ fontSize: 20, color: '#64748b', fontWeight: 700 }}>{noProbs.length}</div>
          <div style={{ fontSize: 10, color: '#94a3b8' }}>NOT_ELIGIBLE / LIMITED_MODE</div>
          <div style={{ fontSize: 10, color: '#94a3b8' }}>Cannot diagnose</div>
        </div>
      </div>

      {/* Decision guide */}
      <div style={{ background: '#0f1923', border: '1px solid #1e3a5f', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 11, color: '#93c5fd' }}>
        <strong>Leer el diagnóstico:</strong>
        {' '}Si la mayoría tiene <code>selected_minus_draw &gt; 5%</code>, el problema está en las <em>probabilidades</em> (el modelo no asigna suficiente masa a DRAW).
        {' '}Si la mayoría tiene <code>selected_minus_draw ≤ 5%</code>, el problema está en la <em>política de decisión</em> (el margen TOO_CLOSE bloquea la predicción DRAW aunque p_draw sea competitivo).
        {' '}Si ambos, hay dos problemas simultáneos.
      </div>

      {/* Detail table */}
      {diagRows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Kickoff','Score','Mode','Predicted','p_H','p_D','p_A','Top-1','Top-2','top1−top2','sel−draw','xG H/A'].map(h => (
                  <th key={h} style={TH}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {diagRows.map((row, i) => {
                const isBorderline = row.selected_minus_draw !== null && row.selected_minus_draw <= 0.05 && row.selected_minus_draw >= 0;
                const isProb = row.selected_minus_draw !== null && row.selected_minus_draw > 0.05;
                const selColor = isBorderline ? '#f59e0b' : isProb ? '#ef4444' : '#64748b';
                return (
                  <tr key={row.snap.snapshot_id}>
                    <td style={TD(i)}>{fmtDate(row.snap.kickoff_utc)}</td>
                    <td style={TD(i)}>
                      <span style={{ color: '#94a3b8', fontSize: 10 }}>{shortId(row.snap.match_id)}</span>
                      <span style={{ marginLeft: 5, color: '#f59e0b', fontWeight: 600 }}>
                        {row.snap.home_goals}–{row.snap.away_goals}
                      </span>
                    </td>
                    <td style={{ ...TD(i), color: '#60a5fa', fontSize: 10 }}>
                      {row.snap.mode.replace('_MODE','').replace('NOT_ELIGIBLE','N/E')}
                    </td>
                    <td style={{ ...TD(i), color: resultColor(row.snap.predicted_result) }}>
                      {row.snap.predicted_result ? row.snap.predicted_result.replace('_WIN','') : '—'}
                    </td>
                    <td style={TD(i, true)}>{fmtNum(row.snap.p_home_win, 3)}</td>
                    <td style={{ ...TD(i, true), color: '#f59e0b', fontWeight: 600 }}>
                      {fmtNum(row.snap.p_draw, 3)}
                    </td>
                    <td style={TD(i, true)}>{fmtNum(row.snap.p_away_win, 3)}</td>
                    <td style={{ ...TD(i), color: '#94a3b8', fontSize: 10 }}>{row.top1_class.replace('_WIN','')}</td>
                    <td style={{ ...TD(i), color: '#64748b', fontSize: 10 }}>{row.top2_class.replace('_WIN','')}</td>
                    <td style={{ ...TD(i, true), color: '#94a3b8' }}>{fmtNum(row.top1_minus_top2, 3)}</td>
                    <td style={{ ...TD(i, true), color: selColor, fontWeight: 700 }}>
                      {row.selected_minus_draw !== null ? fmtNum(row.selected_minus_draw, 3) : '—'}
                    </td>
                    <td style={{ ...TD(i, true), color: '#64748b', fontSize: 10 }}>
                      {fmtNum(row.snap.expected_goals_home, 2)}/{fmtNum(row.snap.expected_goals_away, 2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Summary panel ─────────────────────────────────────────────────────────

function SummaryPanel({ report }: { report: EvaluationReport }) {
  const ex = report.exclusion_breakdown;
  const cm = report.combined_metrics;
  const fm = report.full_mode_metrics;
  const acd = report.actual_class_distribution;
  const pcd = report.prediction_class_distribution;
  const pb = report.probabilistic_baselines;

  return (
    <>
      {/* Row 1: Denominator + Class distribution */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        {/* Denominator */}
        <div style={PANEL}>
          <div style={SECTION_TITLE}>Denominador</div>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {[
                ['Total snapshots', ex.total_snapshots, '#e2e8f0'],
                ['NOT_ELIGIBLE', ex.not_eligible, '#64748b'],
                ['ERROR', ex.error, '#ef4444'],
                ['LIMITED_MODE sin pred.', ex.limited_mode_no_prediction, '#64748b'],
                ['TOO_CLOSE', ex.too_close, '#64748b'],
                ['Total excluidos', ex.total_excluded, '#94a3b8'],
              ].map(([label, value, color]) => (
                <tr key={String(label)}>
                  <td style={{ padding: '3px 0', color: '#94a3b8', fontSize: 11 }}>{label}</td>
                  <td style={{ padding: '3px 0', color: color as string, fontWeight: 600, textAlign: 'right', fontSize: 12 }}>{String(value)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '1px solid #2a2a2a' }}>
                <td style={{ padding: '5px 0', color: '#60a5fa', fontSize: 12, fontWeight: 700 }}>
                  ▶ Evaluable (denominador)
                </td>
                <td style={{ padding: '5px 0', color: '#60a5fa', fontSize: 16, fontWeight: 700, textAlign: 'right' }}>
                  {ex.evaluable}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Class distribution */}
        <div style={PANEL}>
          <div style={SECTION_TITLE}>Distribución de clases (n={acd?.total ?? 0})</div>
          {acd && pcd ? (
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ ...TH, background: 'transparent' }}>Clase</th>
                  <th style={{ ...TH, background: 'transparent' }}>Actual</th>
                  <th style={{ ...TH, background: 'transparent' }}>Predicha</th>
                </tr>
              </thead>
              <tbody>
                {(['HOME_WIN', 'DRAW', 'AWAY_WIN'] as Outcome[]).map(cls => (
                  <tr key={cls}>
                    <td style={{ padding: '4px 0', fontSize: 11, color: resultColor(cls) }}>
                      {cls.replace('_WIN','')}
                    </td>
                    <td style={{ padding: '4px 0' }}>
                      <DistBar value={acd[cls]} total={acd.total} color={resultColor(cls)} />
                    </td>
                    <td style={{ padding: '4px 0' }}>
                      {pcd[cls] === 0
                        ? <span style={{ color: '#ef4444', fontSize: 11, fontWeight: 700 }}>0 ⚠ colapso</span>
                        : <DistBar value={pcd[cls]} total={acd.total} color={resultColor(cls)} />
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ color: '#475569' }}>Sin datos</div>
          )}
        </div>
      </div>

      {/* Row 2: Metrics + Baselines */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        {/* Model metrics */}
        <div style={PANEL}>
          <div style={SECTION_TITLE}>Métricas del modelo</div>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              <tr>
                <td style={{ padding: '4px 0', color: '#94a3b8', fontSize: 11 }}>Accuracy (n={cm?.denominator ?? 0})</td>
                <td style={{ padding: '4px 0', textAlign: 'right', color: '#e2e8f0', fontWeight: 700, fontSize: 14 }}>{fmtPct(cm?.accuracy ?? null)}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 0', color: '#94a3b8', fontSize: 11 }}>Correcto / total</td>
                <td style={{ padding: '4px 0', textAlign: 'right', color: '#94a3b8', fontSize: 11 }}>{cm?.correct ?? 0} / {cm?.denominator ?? 0}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 0', color: '#94a3b8', fontSize: 11 }}>Brier score (n={fm?.prob_denominator ?? 0})</td>
                <td style={{ padding: '4px 0', textAlign: 'right', color: '#e2e8f0', fontSize: 12 }}>{fmtNum(fm?.brier_score ?? null)}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 0', color: '#94a3b8', fontSize: 11 }}>Log loss</td>
                <td style={{ padding: '4px 0', textAlign: 'right', color: '#e2e8f0', fontSize: 12 }}>{fmtNum(fm?.log_loss ?? null)}</td>
              </tr>
            </tbody>
          </table>
          {fm && (
            <>
              <div style={{ ...SECTION_TITLE, marginTop: 12 }}>Confusion matrix</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 10 }}>
                  <thead>
                    <tr>
                      <th style={{ ...TH, background: 'transparent' }}></th>
                      <th style={{ ...TH, background: 'transparent', color: '#22c55e' }}>pred H</th>
                      <th style={{ ...TH, background: 'transparent', color: '#f59e0b' }}>pred D</th>
                      <th style={{ ...TH, background: 'transparent', color: '#ef4444' }}>pred A</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(['HOME_WIN','DRAW','AWAY_WIN'] as Outcome[]).map(row => (
                      <tr key={row}>
                        <td style={{ padding: '3px 8px', color: resultColor(row), fontWeight: 600, fontSize: 10 }}>
                          act {row.replace('_WIN','')}
                        </td>
                        {(['HOME_WIN','DRAW','AWAY_WIN'] as Outcome[]).map(col => {
                          const v = fm.confusion_matrix[row][col];
                          const isHit = row === col;
                          return (
                            <td key={col} style={{
                              padding: '3px 12px',
                              textAlign: 'center',
                              fontWeight: isHit ? 700 : 400,
                              color: isHit ? '#22c55e' : '#94a3b8',
                              background: isHit ? '#0d2618' : 'transparent',
                            }}>{v}</td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Baseline comparison */}
        <div style={PANEL}>
          <div style={SECTION_TITLE}>Comparación de baselines</div>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ ...TH, background: 'transparent' }}>Baseline</th>
                <th style={{ ...TH, background: 'transparent', textAlign: 'right' }}>Acc</th>
                <th style={{ ...TH, background: 'transparent', textAlign: 'right' }}>Brier</th>
                <th style={{ ...TH, background: 'transparent', textAlign: 'right' }}>LogLoss</th>
                <th style={{ ...TH, background: 'transparent', textAlign: 'center' }}>Modelo +?</th>
              </tr>
            </thead>
            <tbody>
              {/* Model */}
              <tr>
                <td style={{ padding: '5px 0', color: '#60a5fa', fontWeight: 700, fontSize: 11 }}>Modelo</td>
                <td style={{ padding: '5px 0', textAlign: 'right', color: '#e2e8f0', fontWeight: 700 }}>{fmtPct(cm?.accuracy ?? null)}</td>
                <td style={{ padding: '5px 0', textAlign: 'right', color: '#e2e8f0' }}>{fmtNum(fm?.brier_score ?? null)}</td>
                <td style={{ padding: '5px 0', textAlign: 'right', color: '#e2e8f0' }}>{fmtNum(fm?.log_loss ?? null)}</td>
                <td></td>
              </tr>
              {/* Cat baselines */}
              {report.baselines && (
                <>
                  <tr>
                    <td style={{ padding: '4px 0', color: '#94a3b8', fontSize: 10 }}>
                      MOST_FREQ ("{report.baselines.most_frequent_class.always_predicts.replace('_WIN','')}")
                    </td>
                    <td style={{ padding: '4px 0', textAlign: 'right', color: '#94a3b8' }}>{fmtPct(report.baselines.most_frequent_class.accuracy)}</td>
                    <td style={{ padding: '4px 0', textAlign: 'right', color: '#475569' }}>—</td>
                    <td style={{ padding: '4px 0', textAlign: 'right', color: '#475569' }}>—</td>
                    <td style={{ padding: '4px 0', textAlign: 'center' }}>
                      <span style={{ color: report.beats_most_frequent_class ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
                        {report.beats_most_frequent_class ? '✓' : '✗'}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px 0', color: '#94a3b8', fontSize: 10 }}>ALWAYS_HOME_WIN</td>
                    <td style={{ padding: '4px 0', textAlign: 'right', color: '#94a3b8' }}>{fmtPct(report.baselines.always_home_win.accuracy)}</td>
                    <td style={{ padding: '4px 0', textAlign: 'right', color: '#475569' }}>—</td>
                    <td style={{ padding: '4px 0', textAlign: 'right', color: '#475569' }}>—</td>
                    <td style={{ padding: '4px 0', textAlign: 'center' }}>
                      <span style={{ color: report.beats_always_home_win ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
                        {report.beats_always_home_win ? '✓' : '✗'}
                      </span>
                    </td>
                  </tr>
                </>
              )}
              {/* Prob baselines */}
              {pb && (
                <>
                  <tr style={{ borderTop: '1px solid #1c1c1c' }}>
                    <td style={{ padding: '4px 0', color: '#94a3b8', fontSize: 10 }}>UNIFORM (1/3,1/3,1/3)</td>
                    <td style={{ padding: '4px 0', textAlign: 'right', color: '#475569' }}>—</td>
                    <td style={{ padding: '4px 0', textAlign: 'right', color: '#94a3b8' }}>{fmtNum(pb.uniform.brier_score)}</td>
                    <td style={{ padding: '4px 0', textAlign: 'right', color: '#94a3b8' }}>{fmtNum(pb.uniform.log_loss)}</td>
                    <td style={{ padding: '4px 0', textAlign: 'center', fontSize: 10 }}>
                      <span style={{ color: report.beats_uniform_brier ? '#22c55e' : '#ef4444' }}>
                        {report.beats_uniform_brier ? '✓' : '✗'}B
                      </span>
                      {' '}
                      <span style={{ color: report.beats_uniform_log_loss ? '#22c55e' : '#ef4444' }}>
                        {report.beats_uniform_log_loss ? '✓' : '✗'}LL
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px 0', color: '#94a3b8', fontSize: 10 }}>
                      EMPIRICAL ({(pb.empirical_freq.probs.HOME_WIN * 100).toFixed(0)}%/{(pb.empirical_freq.probs.DRAW * 100).toFixed(0)}%/{(pb.empirical_freq.probs.AWAY_WIN * 100).toFixed(0)}%)
                    </td>
                    <td style={{ padding: '4px 0', textAlign: 'right', color: '#475569' }}>—</td>
                    <td style={{ padding: '4px 0', textAlign: 'right', color: '#94a3b8' }}>{fmtNum(pb.empirical_freq.brier_score)}</td>
                    <td style={{ padding: '4px 0', textAlign: 'right', color: '#94a3b8' }}>{fmtNum(pb.empirical_freq.log_loss)}</td>
                    <td style={{ padding: '4px 0', textAlign: 'center', fontSize: 10 }}>
                      <span style={{ color: report.beats_empirical_brier ? '#22c55e' : '#ef4444' }}>
                        {report.beats_empirical_brier ? '✓' : '✗'}B
                      </span>
                      {' '}
                      <span style={{ color: report.beats_empirical_log_loss ? '#22c55e' : '#ef4444' }}>
                        {report.beats_empirical_log_loss ? '✓' : '✗'}LL
                      </span>
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>

          <div style={{ marginTop: 14 }}>
            <div style={SECTION_TITLE}>Verdict</div>
            <Verdict v={report.beats_most_frequent_class} label="Supera MOST_FREQ_CLASS (accuracy)" />
            <Verdict v={report.beats_always_home_win} label="Supera ALWAYS_HOME_WIN (accuracy)" />
            <Verdict v={report.beats_uniform_brier} label="Supera UNIFORM (Brier)" />
            <Verdict v={report.beats_uniform_log_loss} label="Supera UNIFORM (log-loss)" />
            <Verdict v={report.beats_empirical_brier} label="Supera EMPIRICAL (Brier)" />
            <Verdict v={report.beats_empirical_log_loss} label="Supera EMPIRICAL (log-loss)" />
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={SECTION_TITLE}>Elo symmetry</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>
              Breaks symmetry: {' '}
              <strong style={{ color: '#60a5fa' }}>
                {report.elo_breaks_symmetry}/{report.elo_breaks_symmetry_denominator}
              </strong>
              {report.elo_breaks_symmetry_denominator > 0 && (
                <span style={{ color: '#64748b' }}>
                  {' '}({((report.elo_breaks_symmetry / report.elo_breaks_symmetry_denominator) * 100).toFixed(0)}%)
                </span>
              )}
            </div>
            <div style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>
              Elo histórico influye en las probabilidades del modelo.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export function HistoricalEvaluationLabPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'summary' | 'draws' | 'table'>('summary');

  useEffect(() => {
    fetchHistoricalEvaluation('PD')
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, []);

  const tabBtn = (key: typeof tab, label: string): React.CSSProperties => ({
    padding: '6px 14px',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    border: 'none',
    borderRadius: 4,
    background: tab === key ? '#1e3a5f' : '#1a1a1a',
    color: tab === key ? '#60a5fa' : '#64748b',
    outline: 'none',
  });

  return (
    <div style={ROOT}>
      {/* Header */}
      <div style={{ ...PANEL, borderColor: '#1e3a5f', background: '#0f1923', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={BADGE_HBT}>HISTORICAL BACKTEST</span>
          <strong style={{ color: '#60a5fa', fontSize: 14 }}>Evaluación Histórica — Lab Interno</strong>
          <span style={{ color: '#475569', fontSize: 11, marginLeft: 8 }}>
            source_type = HISTORICAL_BACKTEST · LaLiga (PD)
          </span>
          <span style={{
            marginLeft: 'auto',
            fontSize: 10,
            color: '#ef4444',
            border: '1px solid #ef4444',
            borderRadius: 4,
            padding: '2px 7px',
            fontWeight: 700,
          }}>
            ⛔ NO MEZCLA con datos forward (EvaluationRecord)
          </span>
        </div>
        {data && (
          <div style={{ marginTop: 6, color: '#64748b', fontSize: 10 }}>
            {data.snapshot_count} snapshots · generado {new Date(data.report.exclusion_breakdown.total_snapshots > 0 ? Date.now() : 0).toLocaleString()}
          </div>
        )}
      </div>

      {loading && (
        <div style={{ color: '#64748b', padding: '40px 0', textAlign: 'center' }}>
          Cargando evaluación histórica…
        </div>
      )}

      {error && (
        <div style={{ color: '#ef4444', background: '#1a0f0f', border: '1px solid #ef4444', borderRadius: 8, padding: '12px 16px', marginBottom: 12 }}>
          <strong>Error:</strong> {error}
          <div style={{ marginTop: 6, color: '#94a3b8', fontSize: 10 }}>
            Asegurate de tener <code>PREDICTION_INTERNAL_VIEW_ENABLED=true</code> en .env y de haber ejecutado
            {' '}<code>npx tsx --tsconfig tsconfig.server.json scripts/run-backtest.ts</code> al menos una vez.
          </div>
        </div>
      )}

      {data && (
        <>
          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <button style={tabBtn('summary', 'Resumen')} onClick={() => setTab('summary')}>
              A. Resumen
            </button>
            <button style={tabBtn('draws', 'DRAW Diagnosis')} onClick={() => setTab('draws')}>
              B. DRAW Collapse {data.report.actual_class_distribution ? `(${data.report.actual_class_distribution.DRAW} reales, 0 predichos)` : ''}
            </button>
            <button style={tabBtn('table', 'Partidos')} onClick={() => setTab('table')}>
              C. Todos los partidos ({data.snapshots.length})
            </button>
          </div>

          {tab === 'summary' && <SummaryPanel report={data.report} />}
          {tab === 'draws' && <DrawDiagnosisPanel snapshots={data.snapshots} />}
          {tab === 'table' && <MatchTable snapshots={data.snapshots} />}
        </>
      )}
    </div>
  );
}
