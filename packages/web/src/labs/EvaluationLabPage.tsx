// OE-6 — Internal evaluation inspection page
// Route: /labs/evaluacion — not linked in Navbar, internal only
import { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../hooks/use-theme.js';
import { ThemeToggle } from '../components/ThemeToggle.js';

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

// ── Additional types for engine comparison ────────────────────────────────────

type EngineMode = 'v3' | 'nexus' | 'compare';

type OverlapMetrics = {
  match_count: number;
  v3_accuracy: number | null;
  nexus_accuracy: number | null;
  v3_brier: number | null;
  nexus_brier: number | null;
  v3_log_loss: number | null;
  nexus_log_loss: number | null;
};

type CompareResponse = {
  mode: 'compare';
  v3: EvaluationResponse;
  nexus: EvaluationResponse;
  overlap: OverlapMetrics;
};

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchEvaluation(competitionId?: string, engine?: EngineMode): Promise<EvaluationResponse | CompareResponse> {
  const url = new URL('/api/internal/evaluation', window.location.origin);
  if (competitionId) url.searchParams.set('competitionId', competitionId);
  if (engine) url.searchParams.set('engine', engine);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<EvaluationResponse | CompareResponse>;
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
  return `${Math.round(v * 100)}%`;
}

function fmtNum(v: number | null, dp = 3): string {
  if (v === null) return '—';
  return v.toFixed(dp);
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

// ── Styles ────────────────────────────────────────────────────────────────────

function makeRoot(isDark: boolean): React.CSSProperties {
  return {
    minHeight: '100vh',
    backgroundColor: isDark ? '#0f0f0f' : '#f8fafc',
    color: isDark ? '#e2e8f0' : '#0f172a',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace',
    padding: 16,
  };
}

const SECTION_TITLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: 8,
  marginTop: 20,
};

function makePanel(isDark: boolean): React.CSSProperties {
  return {
    background: isDark ? '#1a1a1a' : '#ffffff',
    border: isDark ? '1px solid #2a2a2a' : '1px solid #e2e8f0',
    borderRadius: 8,
    padding: '14px 16px',
    marginBottom: 12,
  };
}

function makeTH(isDark: boolean): React.CSSProperties {
  return {
    padding: '7px 9px',
    fontSize: 10,
    fontWeight: 600,
    color: isDark ? '#64748b' : '#475569',
    textAlign: 'left',
    whiteSpace: 'nowrap',
    borderBottom: isDark ? '1px solid #2a2a2a' : '1px solid #e2e8f0',
    background: isDark ? '#141414' : '#f1f5f9',
  };
}

function makeTD(isDark: boolean, isEven: boolean): React.CSSProperties {
  return {
    padding: '6px 9px',
    fontSize: 11,
    color: isDark ? '#e2e8f0' : '#0f172a',
    background: isDark ? (isEven ? '#1d1d1d' : '#171717') : (isEven ? '#ffffff' : '#f8fafc'),
    borderBottom: isDark ? '1px solid #1f1f1f' : '1px solid #e8ecf0',
    whiteSpace: 'nowrap',
  };
}

// ── Mode badge ────────────────────────────────────────────────────────────────

function modeBadge(mode: string): { label: string; bg: string; color: string } {
  switch (mode) {
    case 'FULL_MODE':     return { label: 'FULL',    bg: 'rgba(34,197,94,0.15)',  color: '#4ade80' };
    case 'LIMITED_MODE':  return { label: 'LIM',     bg: 'rgba(234,179,8,0.15)', color: '#facc15' };
    case 'NOT_ELIGIBLE':  return { label: 'N/ELIG',  bg: 'rgba(239,68,68,0.15)', color: '#f87171' };
    case 'nexus:HIGH':    return { label: 'N:HIGH',  bg: 'rgba(139,92,246,0.15)', color: '#a78bfa' };
    case 'nexus:MEDIUM':  return { label: 'N:MED',   bg: 'rgba(139,92,246,0.12)', color: '#c4b5fd' };
    case 'nexus:LOW':     return { label: 'N:LOW',   bg: 'rgba(139,92,246,0.08)', color: '#ddd6fe' };
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

function CoverageFunnelPanel({ funnel, isDark }: { funnel: CoverageFunnel; isDark: boolean }) {
  const PANEL = makePanel(isDark);
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
            <div style={{ fontSize: 11, color: isDark ? '#64748b' : '#475569', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: isDark ? '#e2e8f0' : '#0f172a' }}>{count}</div>
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

function PerformancePanel({ perf, isDark }: { perf: PerformanceMetrics; isDark: boolean }) {
  const PANEL = makePanel(isDark);
  const TH = makeTH(isDark);
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
            <div style={{ fontSize: 11, color: isDark ? '#64748b' : '#475569', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: isDark ? '#e2e8f0' : '#0f172a' }}>{val}</div>
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
                <div style={{ fontSize: 11, color: isDark ? '#94a3b8' : '#64748b' }}>acc: {fmtPct(m.accuracy)}</div>
                <div style={{ fontSize: 11, color: isDark ? '#94a3b8' : '#64748b' }}>brier: {fmtNum(m.brier)}</div>
                <div style={{ fontSize: 11, color: isDark ? '#94a3b8' : '#64748b' }}>logloss: {fmtNum(m.log_loss)}</div>
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
                <div style={{ fontSize: 10, color: isDark ? '#94a3b8' : '#64748b', fontWeight: 700, marginBottom: 4 }}>{key} ({m.count})</div>
                <div style={{ fontSize: 11, color: isDark ? '#94a3b8' : '#64748b' }}>acc: {fmtPct(m.accuracy)}</div>
                <div style={{ fontSize: 11, color: isDark ? '#94a3b8' : '#64748b' }}>brier: {fmtNum(m.brier)}</div>
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
                  <th style={{ ...TH, background: isDark ? '#111' : '#f1f5f9' }}>pred\actual</th>
                  {['HOME_WIN', 'DRAW', 'AWAY_WIN'].map((h) => (
                    <th key={h} style={{ ...TH, color: isDark ? '#94a3b8' : '#64748b' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {['HOME_WIN', 'DRAW', 'AWAY_WIN'].map((pred) => (
                  <tr key={pred}>
                    <td style={{ ...makeTD(isDark, false), fontWeight: 600, color: isDark ? '#94a3b8' : '#64748b' }}>{pred}</td>
                    {['HOME_WIN', 'DRAW', 'AWAY_WIN'].map((actual) => {
                      const v = perf.confusion_matrix?.[pred]?.[actual] ?? 0;
                      const isDiag = pred === actual;
                      return (
                        <td key={actual} style={{ ...makeTD(isDark, false), color: isDiag ? '#4ade80' : (isDark ? '#e2e8f0' : '#0f172a'), fontWeight: isDiag ? 700 : 400 }}>
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

function OperationalPanel({ op, isDark }: { op: OperationalMetrics; isDark: boolean }) {
  const PANEL = makePanel(isDark);
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
            <div style={{ fontSize: 11, color: isDark ? '#64748b' : '#475569', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: warn ? '#f87171' : '#4ade80' }}>{val}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Per-match table ───────────────────────────────────────────────────────────

function RecordsTable({ records, isDark }: { records: EvaluationRecord[]; isDark: boolean }) {
  const PANEL = makePanel(isDark);
  const TH = makeTH(isDark);
  if (records.length === 0) {
    return (
      <div style={{ fontSize: 13, color: isDark ? '#64748b' : '#475569', ...PANEL }}>
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
            <th style={TH}>Partido</th>
            <th style={TH}>Mode</th>
            <th style={TH}>GT</th>
            <th style={TH}>Resultado</th>
            <th style={TH}>Pronóstico</th>
            <th style={TH}>Hit</th>
            <th style={TH}>Local</th>
            <th style={TH}>Empate</th>
            <th style={TH}>Visita</th>
            <th style={TH}>xG L</th>
            <th style={TH}>xG V</th>
            <th style={TH}>UI render</th>
            <th style={TH}>Elegible</th>
            <th style={TH}>Excluido por</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r, idx) => {
            const isEven = idx % 2 === 0;
            const td = makeTD(isDark, isEven);
            const badge = modeBadge(r.mode);
            const gt = gtBadge(r.ground_truth_status);
            const score = r.final_home_goals !== null && r.final_away_goals !== null
              ? `${r.final_home_goals}:${r.final_away_goals}`
              : '—';

            return (
              <tr key={r.match_id}>
                <td style={{ ...td, color: isDark ? '#94a3b8' : '#64748b' }}>{fmtDate(r.scheduled_kickoff_utc)}</td>
                <td style={{ ...td, fontSize: 11 }}>
                  <span style={{ color: isDark ? '#e2e8f0' : '#0f172a' }}>
                    {teamShort(r.home_team_id)} vs {teamShort(r.away_team_id)}
                  </span>
                  <div style={{ fontSize: 9, color: isDark ? '#334155' : '#94a3b8', fontFamily: 'monospace' }}>
                    {r.match_id.split(':').pop()}
                  </div>
                </td>
                <td style={td}>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: badge.bg, color: badge.color }}>
                    {badge.label}
                  </span>
                </td>
                <td style={{ ...td, color: gt.color, fontWeight: 700 }}>{gt.label}</td>
                <td style={{ ...td, color: isDark ? '#94a3b8' : '#64748b' }}>{r.actual_result ? fmtResult(r.actual_result) : score}</td>
                <td style={{ ...td, color: isDark ? '#94a3b8' : '#64748b' }}>{fmtResult(r.predicted_result)}</td>
                <td style={td}>{hitBadge(r.predicted_result, r.actual_result)}</td>
                <td style={td}>{fmtPct(r.p_home_win)}</td>
                <td style={td}>{fmtPct(r.p_draw)}</td>
                <td style={td}>{fmtPct(r.p_away_win)}</td>
                <td style={td}>{fmtNum(r.expected_goals_home, 1)}</td>
                <td style={td}>{fmtNum(r.expected_goals_away, 1)}</td>
                <td style={{ ...td, fontSize: 9, color: isDark ? '#64748b' : '#475569' }}>{r.ui_render_result ?? '—'}</td>
                <td style={{ ...td, color: r.evaluation_eligible ? '#4ade80' : '#f87171' }}>
                  {r.evaluation_eligible ? 'Sí' : 'No'}
                </td>
                <td style={{ ...td, fontSize: 9, color: isDark ? '#94a3b8' : '#64748b' }}>{r.excluded_reason ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Overlap Panel ─────────────────────────────────────────────────────────────

function OverlapPanel({ overlap, isDark }: { overlap: OverlapMetrics; isDark: boolean }) {
  const PANEL = makePanel(isDark);
  const TH = makeTH(isDark);

  function deltaColor(delta: number | null, lowerIsBetter: boolean): string {
    if (delta === null) return isDark ? '#94a3b8' : '#64748b';
    const improved = lowerIsBetter ? delta < 0 : delta > 0;
    return improved ? '#4ade80' : '#f87171';
  }

  function fmtDelta(v: number | null, scale = 100, suffix = '%'): string {
    if (v === null) return '—';
    const sign = v >= 0 ? '+' : '';
    return `${sign}${(v * scale).toFixed(1)}${suffix}`;
  }

  function fmtDeltaRaw(v: number | null): string {
    if (v === null) return '—';
    const sign = v >= 0 ? '+' : '';
    return `${sign}${v.toFixed(3)}`;
  }

  const accDelta = overlap.v3_accuracy !== null && overlap.nexus_accuracy !== null
    ? overlap.nexus_accuracy - overlap.v3_accuracy
    : null;
  const brierDelta = overlap.v3_brier !== null && overlap.nexus_brier !== null
    ? overlap.nexus_brier - overlap.v3_brier
    : null;
  const llDelta = overlap.v3_log_loss !== null && overlap.nexus_log_loss !== null
    ? overlap.nexus_log_loss - overlap.v3_log_loss
    : null;

  const rows: Array<{
    label: string;
    v3Val: string;
    nexusVal: string;
    delta: number | null;
    lowerIsBetter: boolean;
    deltaStr: string;
  }> = [
    {
      label: 'Accuracy',
      v3Val: fmtPct(overlap.v3_accuracy),
      nexusVal: fmtPct(overlap.nexus_accuracy),
      delta: accDelta,
      lowerIsBetter: false,
      deltaStr: fmtDelta(accDelta),
    },
    {
      label: 'Brier score',
      v3Val: fmtNum(overlap.v3_brier),
      nexusVal: fmtNum(overlap.nexus_brier),
      delta: brierDelta,
      lowerIsBetter: true,
      deltaStr: fmtDeltaRaw(brierDelta),
    },
    {
      label: 'Log Loss',
      v3Val: fmtNum(overlap.v3_log_loss),
      nexusVal: fmtNum(overlap.nexus_log_loss),
      delta: llDelta,
      lowerIsBetter: true,
      deltaStr: fmtDeltaRaw(llDelta),
    },
  ];

  return (
    <div style={PANEL}>
      <div style={{ ...SECTION_TITLE, marginTop: 0 }}>
        Comparacion — {overlap.match_count} partidos evaluados en ambos motores
      </div>
      {overlap.match_count === 0 ? (
        <div style={{ fontSize: 12, color: isDark ? '#64748b' : '#475569' }}>
          Sin partidos en overlap todavia — se necesita ground truth en ambos motores para el mismo partido.
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 380 }}>
              <thead>
                <tr>
                  <th style={{ ...TH, minWidth: 120 }}>Metrica</th>
                  <th style={{ ...TH, textAlign: 'right' }}>V3</th>
                  <th style={{ ...TH, textAlign: 'right' }}>NEXUS</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Delta</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label}>
                    <td style={{ ...makeTD(isDark, false), color: isDark ? '#94a3b8' : '#64748b' }}>{row.label}</td>
                    <td style={{ ...makeTD(isDark, false), textAlign: 'right' }}>{row.v3Val}</td>
                    <td style={{ ...makeTD(isDark, false), textAlign: 'right' }}>{row.nexusVal}</td>
                    <td style={{ ...makeTD(isDark, false), textAlign: 'right', fontWeight: 700, color: deltaColor(row.delta, row.lowerIsBetter) }}>
                      {row.deltaStr}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 10, color: isDark ? '#475569' : '#94a3b8', marginTop: 8 }}>
            Delta = NEXUS - V3. Verde si NEXUS mejora (accuracy up, Brier/LogLoss down).
            Solo partidos donde ambos motores emitieron prediccion y el resultado es conocido.
            V3 puede abstenerse (TOO_CLOSE) en casos donde NEXUS predice.
          </div>
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function EvaluationLabPage() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const ROOT = makeRoot(isDark);
  const PANEL = makePanel(isDark);
  const [data, setData] = useState<EvaluationResponse | null>(null);
  const [compareData, setCompareData] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [engineMode, setEngineMode] = useState<EngineMode>('v3');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchEvaluation('comp:apifootball:140', engineMode);
      if (engineMode === 'compare') {
        setCompareData(result as CompareResponse);
        setData(null);
      } else {
        setData(result as EvaluationResponse);
        setCompareData(null);
      }
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
  }, [engineMode]);

  useEffect(() => {
    void load();
  }, [load]);

  const headerRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
    flexWrap: 'wrap',
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

  if (unavailable) {
    return (
      <div style={ROOT}>
        <div style={{ position: 'fixed', top: 12, right: 16, zIndex: 100 }}>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
        <div style={headerRow}>
          <h1 style={title}>Labs — Evaluacion PE</h1>
        </div>
        <div style={{ fontSize: 13, color: isDark ? '#94a3b8' : '#64748b', ...PANEL }}>
          No disponible — <code style={{ color: '#f87171' }}>PREDICTION_INTERNAL_VIEW_ENABLED</code> no esta configurado.
        </div>
      </div>
    );
  }

  const activeData = engineMode === 'compare' ? null : data;

  return (
    <div style={ROOT}>
      <div style={headerRow}>
        <h1 style={title}>Labs — Evaluacion PE</h1>
        {activeData && (
          <span style={{ fontSize: 11, color: '#475569' }}>
            Calculado: {fmtDate(activeData.computed_at)} · {activeData.total_records} registros
          </span>
        )}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {(['v3', 'nexus', 'compare'] as const).map((opt) => (
            <button
              key={opt}
              style={engineToggleStyle(engineMode === opt)}
              onClick={() => setEngineMode(opt)}
            >
              {opt === 'v3' ? 'V3' : opt === 'nexus' ? 'NEXUS' : 'Comparar'}
            </button>
          ))}
        </div>
        <button style={refreshBtn} onClick={() => { void load(); }} disabled={loading}>
          {loading ? 'Cargando...' : 'Refresh'}
        </button>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </div>

      {error && (
        <div style={{ fontSize: 12, color: '#f87171', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '10px 14px', marginBottom: 16 }}>
          Error: {error}
        </div>
      )}

      {loading && !data && !compareData && (
        <div style={{ fontSize: 13, color: isDark ? '#64748b' : '#475569', ...PANEL }}>Cargando...</div>
      )}

      {engineMode === 'compare' && compareData && (
        <OverlapPanel overlap={compareData.overlap} isDark={isDark} />
      )}

      {activeData && (
        <>
          <div style={PANEL}>
            <CoverageFunnelPanel funnel={activeData.coverage_funnel} isDark={isDark} />
          </div>
          <div style={PANEL}>
            <PerformancePanel perf={activeData.performance} isDark={isDark} />
          </div>
          <div style={PANEL}>
            <OperationalPanel op={activeData.operational} isDark={isDark} />
          </div>
          <div style={SECTION_TITLE}>Registros por partido ({activeData.records.length})</div>
          <div style={PANEL}>
            <RecordsTable records={activeData.records} isDark={isDark} />
          </div>
        </>
      )}
    </div>
  );
}
