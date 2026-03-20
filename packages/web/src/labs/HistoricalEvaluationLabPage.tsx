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
 * Engine selector: V3 | NEXUS | Comparar
 *
 * H5 — Internal Evaluation UI
 */

import { useState, useEffect } from 'react';
import { useTheme } from '../hooks/use-theme.js';
import { ThemeToggle } from '../components/ThemeToggle.js';
import { usePredictionLeagues } from './use-prediction-leagues.js';

// ── Types (mirror server HistoricalBacktestSnapshot + HistoricalEvaluationReport) ──

type Outcome = 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';

type EngineMode = 'v3' | 'nexus' | 'compare';

type Snapshot = {
  snapshot_id: string;
  source_type: 'HISTORICAL_BACKTEST' | 'NEXUS_SHADOW';
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

// ── NEXUS types ────────────────────────────────────────────────────────────────

interface NexusSnapshotRow {
  match_id: string;
  kickoff_utc: string;
  predicted: string;
  actual: string;
  correct: boolean;
  p_home: number;
  p_draw: number;
  p_away: number;
}

interface NexusReport {
  accuracy: number | null;
  brier_score: number | null;
  log_loss: number | null;
  total_evaluated: number;
  snapshots: NexusSnapshotRow[];
}

interface NexusResponse {
  source_type: 'NEXUS_SHADOW';
  competition_code: string;
  snapshot_count: number;
  report: NexusReport;
}

interface OverlapInfo {
  match_count: number;
  v3_accuracy: number | null;
  nexus_accuracy: number | null;
  v3_brier: number | null;
  nexus_brier: number | null;
}

interface CompareResponse {
  mode: 'compare';
  v3: object;
  nexus: NexusResponse;
  overlap: OverlapInfo;
}

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

async function fetchHistoricalEvaluation(code = 'PD', engine: EngineMode = 'v3'): Promise<ApiResponse | NexusResponse | CompareResponse> {
  const url = new URL('/api/internal/historical-evaluation', window.location.origin);
  url.searchParams.set('competitionCode', code);
  if (engine !== 'v3') url.searchParams.set('engine', engine);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status} — asegúrate de tener PREDICTION_INTERNAL_VIEW_ENABLED=true en .env`);
  return res.json() as Promise<ApiResponse | NexusResponse | CompareResponse>;
}

// ── Formatters ────────────────────────────────────────────────────────────

function fmtPct(v: number | null): string {
  if (v === null) return '—';
  return `${Math.round(v * 100)}%`;
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
function fmtResult(v: string | null): string {
  if (v === null) return '—';
  if (v === 'HOME_WIN') return 'Local';
  if (v === 'DRAW') return 'Empate';
  if (v === 'AWAY_WIN') return 'Visita';
  return v;
}
function teamShort(id: string): string {
  return id.split(':').pop() ?? id;
}
function resultColor(r: string | null): string {
  if (r === 'HOME_WIN') return '#22c55e';
  if (r === 'AWAY_WIN') return '#ef4444';
  if (r === 'DRAW') return '#f59e0b';
  return '#64748b';
}

// ── Styles ────────────────────────────────────────────────────────────────

function makeRoot(isDark: boolean): React.CSSProperties {
  return {
    minHeight: '100vh',
    backgroundColor: isDark ? '#0a0a0a' : '#f8fafc',
    color: isDark ? '#e2e8f0' : '#0f172a',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace',
    fontSize: 12,
    padding: '12px 16px',
  };
}

function makePanel(isDark: boolean): React.CSSProperties {
  return {
    background: isDark ? '#141414' : '#ffffff',
    border: isDark ? '1px solid #2a2a2a' : '1px solid #e2e8f0',
    borderRadius: 8,
    padding: '12px 14px',
    marginBottom: 12,
  };
}

function makeSectionTitle(isDark: boolean): React.CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 700,
    color: isDark ? '#64748b' : '#475569',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    marginBottom: 8,
    marginTop: 16,
  };
}

function makeTH(isDark: boolean): React.CSSProperties {
  return {
    padding: '6px 8px',
    fontSize: 10,
    fontWeight: 600,
    color: isDark ? '#64748b' : '#475569',
    textAlign: 'left',
    whiteSpace: 'nowrap',
    borderBottom: isDark ? '1px solid #2a2a2a' : '1px solid #e2e8f0',
    background: isDark ? '#0f0f0f' : '#f1f5f9',
    cursor: 'default',
  };
}

function makeTD(isDark: boolean, i: number, right = false): React.CSSProperties {
  return {
    padding: '5px 8px',
    fontSize: 11,
    background: isDark ? (i % 2 === 0 ? '#141414' : '#111') : (i % 2 === 0 ? '#ffffff' : '#f8fafc'),
    borderBottom: isDark ? '1px solid #1c1c1c' : '1px solid #e8ecf0',
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

const BADGE_NEXUS_STYLE: React.CSSProperties = {
  display: 'inline-block',
  background: '#4a1d96',
  color: '#c4b5fd',
  border: '1px solid #7c3aed',
  borderRadius: 4,
  padding: '2px 7px',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.05em',
};

// ── Small bar chart ───────────────────────────────────────────────────────

function DistBar({ value, total, color, isDark }: { value: number; total: number; color: string; isDark: boolean }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 120, height: 8, background: isDark ? '#2a2a2a' : '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4 }} />
      </div>
      <span style={{ color: isDark ? '#94a3b8' : '#64748b', fontSize: 11, minWidth: 60 }}>
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

function FilterBar({ filters, onChange, isDark }: { filters: Filters; onChange: (f: Filters) => void; isDark: boolean }) {
  const sel: React.CSSProperties = {
    background: isDark ? '#1a1a1a' : '#ffffff',
    border: isDark ? '1px solid #2a2a2a' : '1px solid #d1d5db',
    color: isDark ? '#e2e8f0' : '#0f172a',
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
        <option value="HOME_WIN">Local</option>
        <option value="DRAW">Empate</option>
        <option value="AWAY_WIN">Visita</option>
      </select>
      <select style={sel} value={filters.predicted} onChange={e => onChange({ ...filters, predicted: e.target.value })}>
        <option value="">Todas las predicciones</option>
        <option value="HOME_WIN">pred Local</option>
        <option value="DRAW">pred Empate</option>
        <option value="AWAY_WIN">pred Visita</option>
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

function MatchTable({ snapshots, isDark }: { snapshots: Snapshot[]; isDark: boolean }) {
  const [filters, setFilters] = useState<Filters>({ mode: '', actual: '', predicted: '', hit: '' });
  const TH = makeTH(isDark);

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
      <FilterBar filters={filters} onChange={setFilters} isDark={isDark} />
      <div style={{ color: isDark ? '#64748b' : '#475569', fontSize: 10, marginBottom: 6 }}>
        Mostrando {filtered.length} de {snapshots.length} partidos · source_type = HISTORICAL_BACKTEST
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
          <thead>
            <tr>
              {['Kickoff','Partido','Resultado','Pred.','Hit?','Mode','L','E','V','xG L','xG V','Baseline','Elo L/V','365d'].map(h => (
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
                  <td style={makeTD(isDark, i)}>{fmtDate(s.kickoff_utc)}</td>
                  <td style={makeTD(isDark, i)}>
                    <span style={{ color: isDark ? '#e2e8f0' : '#0f172a', fontSize: 11 }}>
                      {teamShort(s.home_team_id)} vs {teamShort(s.away_team_id)}
                    </span>
                    <span style={{ marginLeft: 5, color: '#f59e0b', fontWeight: 600 }}>
                      {s.home_goals}–{s.away_goals}
                    </span>
                  </td>
                  <td style={{ ...makeTD(isDark, i), color: resultColor(s.actual_result), fontWeight: 600 }}>
                    {fmtResult(s.actual_result)}
                  </td>
                  <td style={{ ...makeTD(isDark, i), color: resultColor(s.predicted_result) }}>
                    {fmtResult(s.predicted_result)}
                  </td>
                  <td style={{ ...makeTD(isDark, i), textAlign: 'center' }}>
                    {s.predicted_result === null ? <span style={{ color: '#475569' }}>—</span>
                      : hit ? <span style={{ color: '#22c55e', fontWeight: 700 }}>✓</span>
                      : miss ? <span style={{ color: '#ef4444', fontWeight: 700 }}>✗</span>
                      : null}
                  </td>
                  <td style={{ ...makeTD(isDark, i), color: s.mode === 'FULL_MODE' ? '#60a5fa' : s.mode === 'LIMITED_MODE' ? '#f59e0b' : '#64748b', fontSize: 10 }}>
                    {s.mode.replace('_MODE','').replace('NOT_ELIGIBLE','N/E')}
                  </td>
                  <td style={{ ...makeTD(isDark, i, true), color: isDark ? '#94a3b8' : '#64748b' }}>{fmtPct(s.p_home_win)}</td>
                  <td style={{ ...makeTD(isDark, i, true), color: s.actual_result === 'DRAW' ? '#f59e0b' : (isDark ? '#94a3b8' : '#64748b') }}>{fmtPct(s.p_draw)}</td>
                  <td style={{ ...makeTD(isDark, i, true), color: isDark ? '#94a3b8' : '#64748b' }}>{fmtPct(s.p_away_win)}</td>
                  <td style={{ ...makeTD(isDark, i, true), color: isDark ? '#94a3b8' : '#64748b' }}>{fmtNum(s.expected_goals_home, 1)}</td>
                  <td style={{ ...makeTD(isDark, i, true), color: isDark ? '#94a3b8' : '#64748b' }}>{fmtNum(s.expected_goals_away, 1)}</td>
                  <td style={{ ...makeTD(isDark, i), color: resultColor(s.baseline_predicted_result), fontSize: 10 }}>
                    {fmtResult(s.baseline_predicted_result)}
                  </td>
                  <td style={{ ...makeTD(isDark, i, true), color: isDark ? '#64748b' : '#475569', fontSize: 10 }}>
                    {s.elo_home_pre.toFixed(0)}/{s.elo_away_pre.toFixed(0)}
                  </td>
                  <td style={{ ...makeTD(isDark, i, true), color: isDark ? '#64748b' : '#475569', fontSize: 10 }}>
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

// ── NEXUS snapshot table ───────────────────────────────────────────────────

function NexusSnapshotTable({ snapshots, isDark }: { snapshots: NexusSnapshotRow[]; isDark: boolean }) {
  const TH = makeTH(isDark);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
        <thead>
          <tr>
            {['Fecha', 'Partido', 'Predicción', 'Real', '¿Correcto?', 'Local', 'Empate', 'Visita'].map(h => (
              <th key={h} style={TH}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {snapshots.map((s, i) => (
            <tr key={`${s.match_id}-${i}`}>
              <td style={makeTD(isDark, i)}>{fmtDate(s.kickoff_utc)}</td>
              <td style={{ ...makeTD(isDark, i), color: isDark ? '#94a3b8' : '#64748b', fontSize: 10 }}>
                {shortId(s.match_id)}
              </td>
              <td style={{ ...makeTD(isDark, i), color: resultColor(s.predicted) }}>
                {fmtResult(s.predicted)}
              </td>
              <td style={{ ...makeTD(isDark, i), color: resultColor(s.actual), fontWeight: 600 }}>
                {fmtResult(s.actual)}
              </td>
              <td style={{ ...makeTD(isDark, i), textAlign: 'center' }}>
                {s.correct
                  ? <span style={{ color: '#22c55e', fontWeight: 700 }}>✓</span>
                  : <span style={{ color: '#ef4444', fontWeight: 700 }}>✗</span>
                }
              </td>
              <td style={{ ...makeTD(isDark, i, true), color: isDark ? '#94a3b8' : '#64748b' }}>{fmtPct(s.p_home)}</td>
              <td style={{ ...makeTD(isDark, i, true), color: isDark ? '#94a3b8' : '#64748b' }}>{fmtPct(s.p_draw)}</td>
              <td style={{ ...makeTD(isDark, i, true), color: isDark ? '#94a3b8' : '#64748b' }}>{fmtPct(s.p_away)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {snapshots.length === 0 && (
        <div style={{ padding: '20px 0', textAlign: 'center', color: '#475569', fontSize: 12 }}>
          No hay snapshots NEXUS disponibles.
        </div>
      )}
    </div>
  );
}

// ── NEXUS panel ───────────────────────────────────────────────────────────

function NexusPanel({ data, isDark }: { data: NexusResponse; isDark: boolean }) {
  const PANEL = makePanel(isDark);
  const SECTION_TITLE = makeSectionTitle(isDark);
  const r = data.report;

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 12 }}>
        <div style={PANEL}>
          <div style={{ fontSize: 10, color: '#a78bfa', textTransform: 'uppercase' as const, letterSpacing: '0.07em', marginBottom: 4 }}>Accuracy</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#c4b5fd' }}>{fmtPct(r.accuracy)}</div>
        </div>
        <div style={PANEL}>
          <div style={{ fontSize: 10, color: '#a78bfa', textTransform: 'uppercase' as const, letterSpacing: '0.07em', marginBottom: 4 }}>Brier Score</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#c4b5fd' }}>{fmtNum(r.brier_score)}</div>
        </div>
        <div style={PANEL}>
          <div style={{ fontSize: 10, color: '#a78bfa', textTransform: 'uppercase' as const, letterSpacing: '0.07em', marginBottom: 4 }}>Log Loss</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#c4b5fd' }}>{fmtNum(r.log_loss)}</div>
        </div>
        <div style={PANEL}>
          <div style={{ fontSize: 10, color: '#a78bfa', textTransform: 'uppercase' as const, letterSpacing: '0.07em', marginBottom: 4 }}>Evaluados</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#c4b5fd' }}>{r.total_evaluated}</div>
        </div>
      </div>
      <div style={PANEL}>
        <div style={{ ...SECTION_TITLE, marginTop: 0 }}>Snapshots NEXUS</div>
        <NexusSnapshotTable snapshots={r.snapshots} isDark={isDark} />
      </div>
    </>
  );
}

// ── Compare panel ─────────────────────────────────────────────────────────

function ComparePanel({ data, isDark }: { data: CompareResponse; isDark: boolean }) {
  const PANEL = makePanel(isDark);
  const o = data.overlap;

  return (
    <div style={PANEL}>
      <div style={{ fontSize: 12, fontWeight: 700, color: isDark ? '#e2e8f0' : '#0f172a', marginBottom: 12 }}>
        Comparacion V3 vs NEXUS — {o.match_count} partidos en overlap
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        {/* Accuracy */}
        <div style={{ background: isDark ? '#1a1a1a' : '#f8fafc', border: isDark ? '1px solid #2a2a2a' : '1px solid #e2e8f0', borderRadius: 6, padding: '10px 14px' }}>
          <div style={{ fontSize: 10, color: isDark ? '#64748b' : '#475569', textTransform: 'uppercase' as const, letterSpacing: '0.07em', marginBottom: 8 }}>Accuracy</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 10, color: '#60a5fa', marginBottom: 2 }}>V3</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#60a5fa' }}>{fmtPct(o.v3_accuracy)}</div>
            </div>
            <div style={{ color: isDark ? '#334155' : '#cbd5e1', fontSize: 20 }}>vs</div>
            <div style={{ textAlign: 'right' as const }}>
              <div style={{ fontSize: 10, color: '#a78bfa', marginBottom: 2 }}>NEXUS</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#a78bfa' }}>{fmtPct(o.nexus_accuracy)}</div>
            </div>
          </div>
        </div>
        {/* Brier */}
        <div style={{ background: isDark ? '#1a1a1a' : '#f8fafc', border: isDark ? '1px solid #2a2a2a' : '1px solid #e2e8f0', borderRadius: 6, padding: '10px 14px' }}>
          <div style={{ fontSize: 10, color: isDark ? '#64748b' : '#475569', textTransform: 'uppercase' as const, letterSpacing: '0.07em', marginBottom: 8 }}>Brier Score</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 10, color: '#60a5fa', marginBottom: 2 }}>V3</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#60a5fa' }}>{fmtNum(o.v3_brier)}</div>
            </div>
            <div style={{ color: isDark ? '#334155' : '#cbd5e1', fontSize: 20 }}>vs</div>
            <div style={{ textAlign: 'right' as const }}>
              <div style={{ fontSize: 10, color: '#a78bfa', marginBottom: 2 }}>NEXUS</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#a78bfa' }}>{fmtNum(o.nexus_brier)}</div>
            </div>
          </div>
        </div>
        {/* Match count */}
        <div style={{ background: isDark ? '#1a1a1a' : '#f8fafc', border: isDark ? '1px solid #2a2a2a' : '1px solid #e2e8f0', borderRadius: 6, padding: '10px 14px' }}>
          <div style={{ fontSize: 10, color: isDark ? '#64748b' : '#475569', textTransform: 'uppercase' as const, letterSpacing: '0.07em', marginBottom: 8 }}>Partidos en Overlap</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: isDark ? '#e2e8f0' : '#0f172a' }}>{o.match_count}</div>
          <div style={{ fontSize: 10, color: isDark ? '#475569' : '#94a3b8', marginTop: 4 }}>evaluados en ambos motores</div>
        </div>
      </div>
    </div>
  );
}

// ── DRAW Diagnosis Panel ───────────────────────────────────────────────────

function DrawDiagnosisPanel({ snapshots, isDark }: { snapshots: Snapshot[]; isDark: boolean }) {
  const PANEL = makePanel(isDark);
  const TH = makeTH(isDark);
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
        <span style={{ color: isDark ? '#64748b' : '#475569', fontSize: 11 }}>
          — Real DRAWs: <strong style={{ color: '#f59e0b' }}>{drawMatches.length}</strong>
          {' · '}Predicted DRAWs: <strong style={{ color: '#ef4444' }}>0</strong>
        </span>
      </div>

      {/* Summary boxes */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ background: isDark ? '#1a1a1a' : '#ffffff', border: isDark ? '1px solid #2a2a2a' : '1px solid #e2e8f0', borderRadius: 6, padding: '8px 12px', minWidth: 160 }}>
          <div style={{ fontSize: 10, color: isDark ? '#64748b' : '#475569', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Prob problem</div>
          <div style={{ fontSize: 20, color: '#ef4444', fontWeight: 700 }}>{probProblem.length}</div>
          <div style={{ fontSize: 10, color: isDark ? '#94a3b8' : '#64748b' }}>selected_minus_draw &gt; 5%</div>
          <div style={{ fontSize: 10, color: isDark ? '#94a3b8' : '#64748b' }}>Model genuinely underestimates DRAW</div>
        </div>
        <div style={{ background: isDark ? '#1a1a1a' : '#ffffff', border: isDark ? '1px solid #2a2a2a' : '1px solid #e2e8f0', borderRadius: 6, padding: '8px 12px', minWidth: 160 }}>
          <div style={{ fontSize: 10, color: isDark ? '#64748b' : '#475569', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Borderline</div>
          <div style={{ fontSize: 20, color: '#f59e0b', fontWeight: 700 }}>{borderline.length}</div>
          <div style={{ fontSize: 10, color: isDark ? '#94a3b8' : '#64748b' }}>selected_minus_draw ≤ 5%</div>
          <div style={{ fontSize: 10, color: isDark ? '#94a3b8' : '#64748b' }}>Decision rule blocks DRAW call</div>
        </div>
        <div style={{ background: isDark ? '#1a1a1a' : '#ffffff', border: isDark ? '1px solid #2a2a2a' : '1px solid #e2e8f0', borderRadius: 6, padding: '8px 12px', minWidth: 160 }}>
          <div style={{ fontSize: 10, color: isDark ? '#64748b' : '#475569', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>No probs</div>
          <div style={{ fontSize: 20, color: isDark ? '#64748b' : '#475569', fontWeight: 700 }}>{noProbs.length}</div>
          <div style={{ fontSize: 10, color: isDark ? '#94a3b8' : '#64748b' }}>NOT_ELIGIBLE / LIMITED_MODE</div>
          <div style={{ fontSize: 10, color: isDark ? '#94a3b8' : '#64748b' }}>Cannot diagnose</div>
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
                {['Kickoff','Score','Mode','Pred.','L','E','V','Top-1','Top-2','Δtop1-2','Δsel-draw','xG L/V'].map(h => (
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
                    <td style={makeTD(isDark, i)}>{fmtDate(row.snap.kickoff_utc)}</td>
                    <td style={makeTD(isDark, i)}>
                      <span style={{ color: isDark ? '#e2e8f0' : '#0f172a', fontSize: 11 }}>{teamShort(row.snap.home_team_id)} vs {teamShort(row.snap.away_team_id)}</span>
                      <span style={{ marginLeft: 5, color: '#f59e0b', fontWeight: 600 }}>
                        {row.snap.home_goals}–{row.snap.away_goals}
                      </span>
                    </td>
                    <td style={{ ...makeTD(isDark, i), color: '#60a5fa', fontSize: 10 }}>
                      {row.snap.mode.replace('_MODE','').replace('NOT_ELIGIBLE','N/E')}
                    </td>
                    <td style={{ ...makeTD(isDark, i), color: resultColor(row.snap.predicted_result) }}>
                      {fmtResult(row.snap.predicted_result)}
                    </td>
                    <td style={makeTD(isDark, i, true)}>{fmtPct(row.snap.p_home_win)}</td>
                    <td style={{ ...makeTD(isDark, i, true), color: '#f59e0b', fontWeight: 600 }}>
                      {fmtPct(row.snap.p_draw)}
                    </td>
                    <td style={makeTD(isDark, i, true)}>{fmtPct(row.snap.p_away_win)}</td>
                    <td style={{ ...makeTD(isDark, i), color: isDark ? '#94a3b8' : '#64748b', fontSize: 10 }}>{fmtResult(row.top1_class)}</td>
                    <td style={{ ...makeTD(isDark, i), color: isDark ? '#64748b' : '#475569', fontSize: 10 }}>{fmtResult(row.top2_class)}</td>
                    <td style={{ ...makeTD(isDark, i, true), color: isDark ? '#94a3b8' : '#64748b' }}>{fmtNum(row.top1_minus_top2, 3)}</td>
                    <td style={{ ...makeTD(isDark, i, true), color: selColor, fontWeight: 700 }}>
                      {row.selected_minus_draw !== null ? fmtNum(row.selected_minus_draw, 3) : '—'}
                    </td>
                    <td style={{ ...makeTD(isDark, i, true), color: isDark ? '#64748b' : '#475569', fontSize: 10 }}>
                      {fmtNum(row.snap.expected_goals_home, 1)}/{fmtNum(row.snap.expected_goals_away, 1)}
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

function SummaryPanel({ report, isDark }: { report: EvaluationReport; isDark: boolean }) {
  const PANEL = makePanel(isDark);
  const SECTION_TITLE = makeSectionTitle(isDark);
  const TH = makeTH(isDark);
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
                ['Total snapshots', ex.total_snapshots, isDark ? '#e2e8f0' : '#0f172a'],
                ['NOT_ELIGIBLE', ex.not_eligible, isDark ? '#64748b' : '#475569'],
                ['ERROR', ex.error, '#ef4444'],
                ['LIMITED_MODE sin pred.', ex.limited_mode_no_prediction, isDark ? '#64748b' : '#475569'],
                ['TOO_CLOSE', ex.too_close, isDark ? '#64748b' : '#475569'],
                ['Total excluidos', ex.total_excluded, isDark ? '#94a3b8' : '#64748b'],
              ].map(([label, value, color]) => (
                <tr key={String(label)}>
                  <td style={{ padding: '3px 0', color: isDark ? '#94a3b8' : '#64748b', fontSize: 11 }}>{label}</td>
                  <td style={{ padding: '3px 0', color: color as string, fontWeight: 600, textAlign: 'right', fontSize: 12 }}>{String(value)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: isDark ? '1px solid #2a2a2a' : '1px solid #e2e8f0' }}>
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
                      <DistBar value={acd[cls]} total={acd.total} color={resultColor(cls)} isDark={isDark} />
                    </td>
                    <td style={{ padding: '4px 0' }}>
                      {pcd[cls] === 0
                        ? <span style={{ color: '#ef4444', fontSize: 11, fontWeight: 700 }}>0 ⚠ colapso</span>
                        : <DistBar value={pcd[cls]} total={acd.total} color={resultColor(cls)} isDark={isDark} />
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
                <td style={{ padding: '4px 0', color: isDark ? '#94a3b8' : '#64748b', fontSize: 11 }}>Accuracy (n={cm?.denominator ?? 0})</td>
                <td style={{ padding: '4px 0', textAlign: 'right', color: isDark ? '#e2e8f0' : '#0f172a', fontWeight: 700, fontSize: 14 }}>{fmtPct(cm?.accuracy ?? null)}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 0', color: isDark ? '#94a3b8' : '#64748b', fontSize: 11 }}>Correcto / total</td>
                <td style={{ padding: '4px 0', textAlign: 'right', color: isDark ? '#94a3b8' : '#64748b', fontSize: 11 }}>{cm?.correct ?? 0} / {cm?.denominator ?? 0}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 0', color: isDark ? '#94a3b8' : '#64748b', fontSize: 11 }}>Brier score (n={fm?.prob_denominator ?? 0})</td>
                <td style={{ padding: '4px 0', textAlign: 'right', color: isDark ? '#e2e8f0' : '#0f172a', fontSize: 12 }}>{fmtNum(fm?.brier_score ?? null)}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 0', color: isDark ? '#94a3b8' : '#64748b', fontSize: 11 }}>Log loss</td>
                <td style={{ padding: '4px 0', textAlign: 'right', color: isDark ? '#e2e8f0' : '#0f172a', fontSize: 12 }}>{fmtNum(fm?.log_loss ?? null)}</td>
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
                              color: isHit ? '#22c55e' : (isDark ? '#94a3b8' : '#64748b'),
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
                <td style={{ padding: '5px 0', textAlign: 'right', color: isDark ? '#e2e8f0' : '#0f172a', fontWeight: 700 }}>{fmtPct(cm?.accuracy ?? null)}</td>
                <td style={{ padding: '5px 0', textAlign: 'right', color: isDark ? '#e2e8f0' : '#0f172a' }}>{fmtNum(fm?.brier_score ?? null)}</td>
                <td style={{ padding: '5px 0', textAlign: 'right', color: isDark ? '#e2e8f0' : '#0f172a' }}>{fmtNum(fm?.log_loss ?? null)}</td>
                <td></td>
              </tr>
              {/* Cat baselines */}
              {report.baselines && (
                <>
                  <tr>
                    <td style={{ padding: '4px 0', color: isDark ? '#94a3b8' : '#64748b', fontSize: 10 }}>
                      MOST_FREQ ("{report.baselines.most_frequent_class.always_predicts.replace('_WIN','')}")
                    </td>
                    <td style={{ padding: '4px 0', textAlign: 'right', color: isDark ? '#94a3b8' : '#64748b' }}>{fmtPct(report.baselines.most_frequent_class.accuracy)}</td>
                    <td style={{ padding: '4px 0', textAlign: 'right', color: '#475569' }}>—</td>
                    <td style={{ padding: '4px 0', textAlign: 'right', color: '#475569' }}>—</td>
                    <td style={{ padding: '4px 0', textAlign: 'center' }}>
                      <span style={{ color: report.beats_most_frequent_class ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
                        {report.beats_most_frequent_class ? '✓' : '✗'}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px 0', color: isDark ? '#94a3b8' : '#64748b', fontSize: 10 }}>ALWAYS_HOME_WIN</td>
                    <td style={{ padding: '4px 0', textAlign: 'right', color: isDark ? '#94a3b8' : '#64748b' }}>{fmtPct(report.baselines.always_home_win.accuracy)}</td>
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
                  <tr style={{ borderTop: isDark ? '1px solid #1c1c1c' : '1px solid #e8ecf0' }}>
                    <td style={{ padding: '4px 0', color: isDark ? '#94a3b8' : '#64748b', fontSize: 10 }}>UNIFORM (1/3,1/3,1/3)</td>
                    <td style={{ padding: '4px 0', textAlign: 'right', color: '#475569' }}>—</td>
                    <td style={{ padding: '4px 0', textAlign: 'right', color: isDark ? '#94a3b8' : '#64748b' }}>{fmtNum(pb.uniform.brier_score)}</td>
                    <td style={{ padding: '4px 0', textAlign: 'right', color: isDark ? '#94a3b8' : '#64748b' }}>{fmtNum(pb.uniform.log_loss)}</td>
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
                    <td style={{ padding: '4px 0', color: isDark ? '#94a3b8' : '#64748b', fontSize: 10 }}>
                      EMPIRICAL ({(pb.empirical_freq.probs.HOME_WIN * 100).toFixed(0)}%/{(pb.empirical_freq.probs.DRAW * 100).toFixed(0)}%/{(pb.empirical_freq.probs.AWAY_WIN * 100).toFixed(0)}%)
                    </td>
                    <td style={{ padding: '4px 0', textAlign: 'right', color: '#475569' }}>—</td>
                    <td style={{ padding: '4px 0', textAlign: 'right', color: isDark ? '#94a3b8' : '#64748b' }}>{fmtNum(pb.empirical_freq.brier_score)}</td>
                    <td style={{ padding: '4px 0', textAlign: 'right', color: isDark ? '#94a3b8' : '#64748b' }}>{fmtNum(pb.empirical_freq.log_loss)}</td>
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
            <div style={{ fontSize: 11, color: isDark ? '#94a3b8' : '#64748b' }}>
              Breaks symmetry: {' '}
              <strong style={{ color: '#60a5fa' }}>
                {report.elo_breaks_symmetry}/{report.elo_breaks_symmetry_denominator}
              </strong>
              {report.elo_breaks_symmetry_denominator > 0 && (
                <span style={{ color: isDark ? '#64748b' : '#475569' }}>
                  {' '}({((report.elo_breaks_symmetry / report.elo_breaks_symmetry_denominator) * 100).toFixed(0)}%)
                </span>
              )}
            </div>
            <div style={{ fontSize: 10, color: isDark ? '#64748b' : '#475569', marginTop: 3 }}>
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
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const ROOT = makeRoot(isDark);
  const PANEL = makePanel(isDark);
  const leagues = usePredictionLeagues();
  const [compCode, setCompCode] = useState('PD');
  const [data, setData] = useState<ApiResponse | null>(null);
  const [nexusData, setNexusData] = useState<NexusResponse | null>(null);
  const [compareData, setCompareData] = useState<CompareResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'summary' | 'draws' | 'table'>('summary');
  const [engineMode, setEngineMode] = useState<EngineMode>('v3');

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchHistoricalEvaluation(compCode, engineMode)
      .then(result => {
        if (engineMode === 'v3') {
          setData(result as ApiResponse);
          setNexusData(null);
          setCompareData(null);
        } else if (engineMode === 'nexus') {
          setNexusData(result as NexusResponse);
          setData(null);
          setCompareData(null);
        } else {
          setCompareData(result as CompareResponse);
          setData(null);
          setNexusData(null);
        }
        setLoading(false);
      })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, [engineMode, compCode]);

  const tabBtn = (key: typeof tab, label: string): React.CSSProperties => ({
    padding: '6px 14px',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    border: 'none',
    borderRadius: 4,
    background: tab === key ? '#1e3a5f' : (isDark ? '#1a1a1a' : '#f1f5f9'),
    color: tab === key ? '#60a5fa' : (isDark ? '#64748b' : '#475569'),
    outline: 'none',
  });

  const snapshotCount = data?.snapshot_count ?? nexusData?.snapshot_count ?? 0;

  return (
    <div style={ROOT}>
      {/* Header */}
      <div style={{ ...PANEL, borderColor: '#1e3a5f', background: '#0f1923', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {engineMode === 'nexus'
            ? <span style={BADGE_NEXUS_STYLE}>NEXUS SHADOW</span>
            : <span style={BADGE_HBT}>HISTORICAL BACKTEST</span>
          }
          <strong style={{ color: '#60a5fa', fontSize: 14 }}>Evaluación Histórica — Lab Interno</strong>
          <span style={{ color: '#475569', fontSize: 11, marginLeft: 8 }}>
            {`source_type = ${engineMode === 'nexus' ? 'NEXUS_SHADOW' : 'HISTORICAL_BACKTEST'} · ${leagues.find(l => l.slug.toUpperCase() === compCode)?.displayName ?? compCode}`}
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
            NO MEZCLA con datos forward (EvaluationRecord)
          </span>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>

        {/* Engine mode selector */}
        <div className="flex gap-2 flex-wrap mt-2" style={{ alignItems: 'center' }}>
          {(['v3', 'nexus', 'compare'] as EngineMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setEngineMode(mode)}
              className={`px-3 py-1 rounded text-xs font-semibold border transition-colors ${
                engineMode === mode
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-transparent text-indigo-400 border-indigo-600 hover:bg-indigo-900'
              }`}
            >
              {mode === 'v3' ? 'V3' : mode === 'nexus' ? 'NEXUS' : 'Comparar'}
            </button>
          ))}
          <select
            style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, border: isDark ? '1px solid #334155' : '1px solid #e2e8f0', background: isDark ? '#1a1a1a' : '#fff', color: isDark ? '#e2e8f0' : '#0f172a', cursor: 'pointer' }}
            value={compCode}
            onChange={(e) => setCompCode(e.target.value)}
          >
            {leagues.length === 0
              ? <option value="PD">LaLiga (PD)</option>
              : leagues.map((l) => (
                  <option key={l.id} value={l.slug.toUpperCase()}>{l.displayName}</option>
                ))
            }
          </select>
        </div>

        {snapshotCount > 0 && (
          <div style={{ marginTop: 6, color: isDark ? '#64748b' : '#475569', fontSize: 10 }}>
            {snapshotCount} snapshots
          </div>
        )}
      </div>

      {loading && (
        <div style={{ color: isDark ? '#64748b' : '#475569', padding: '40px 0', textAlign: 'center' }}>
          Cargando evaluación histórica…
        </div>
      )}

      {error && (
        <div style={{ color: '#ef4444', background: isDark ? '#1a0f0f' : '#fef2f2', border: '1px solid #ef4444', borderRadius: 8, padding: '12px 16px', marginBottom: 12 }}>
          <strong>Error:</strong> {error}
          <div style={{ marginTop: 6, color: isDark ? '#94a3b8' : '#64748b', fontSize: 10 }}>
            Asegurate de tener <code>PREDICTION_INTERNAL_VIEW_ENABLED=true</code> en .env y de haber ejecutado
            {' '}<code>npx tsx --tsconfig tsconfig.server.json scripts/run-backtest.ts</code> al menos una vez.
          </div>
        </div>
      )}

      {/* NEXUS view */}
      {!loading && !error && engineMode === 'nexus' && nexusData && (
        <NexusPanel data={nexusData} isDark={isDark} />
      )}

      {/* Compare view */}
      {!loading && !error && engineMode === 'compare' && compareData && (
        <ComparePanel data={compareData} isDark={isDark} />
      )}

      {/* V3 view */}
      {!loading && !error && engineMode === 'v3' && data && (
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

          {tab === 'summary' && <SummaryPanel report={data.report} isDark={isDark} />}
          {tab === 'draws' && <DrawDiagnosisPanel snapshots={data.snapshots} isDark={isDark} />}
          {tab === 'table' && <MatchTable snapshots={data.snapshots} isDark={isDark} />}
        </>
      )}
    </div>
  );
}
