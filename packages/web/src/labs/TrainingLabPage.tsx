/**
 * TrainingLabPage — /labs/entrenamiento
 *
 * Muestra el estado del pipeline de entrenamiento del modelo logístico:
 * - Última vez entrenado + N ejemplos + regularización
 * - Botón "Reentrenar" con logs en tiempo real (polling)
 * - Pesos por feature y clase (importancia de features)
 *
 * Engine selector: V3 (Logístico) | NEXUS (Ensemble)
 *
 * Gateado por PREDICTION_INTERNAL_VIEW_ENABLED en el servidor.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTheme } from '../hooks/use-theme.js';
import { ThemeToggle } from '../components/ThemeToggle.js';
import { usePredictionLeagues } from './use-prediction-leagues.js';

// ── Types ─────────────────────────────────────────────────────────────────────

type JobStatus = 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED';

type TrainingEngineMode = 'v3' | 'nexus';

type JobInfo = {
  status:     JobStatus;
  startedAt:  string | null;
  finishedAt: string | null;
  durationMs: number | null;
  exitCode:   number | null;
  lastLines:  string[];
};

type CoeffMeta = {
  trainedAt:            string;
  trainedOnMatches:     number;
  regularizationLambda: number;
};

type StatusResponse = {
  job:              JobInfo;
  lastCoefficients: CoeffMeta | null;
};

type CoeffWeights = Record<string, number>;

type Coefficients = {
  home: { bias: number; weights: CoeffWeights };
  draw: { bias: number; weights: CoeffWeights };
  away: { bias: number; weights: CoeffWeights };
  trained_on_matches: number;
  trained_at: string;
  regularization_lambda: number;
};

interface NexusInfo {
  available: boolean;
  snapshotCount: number;
  mostRecentAt?: string;
  competitionIds?: string[];
  modelVersion?: string;
  calibrationVersion?: string;
  calibrationSource?: string;
  featureSchemaVersion?: string;
  datasetWindow?: Record<string, unknown>;
  ensembleWeights?: Record<string, number>;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch('/api/internal/training/status');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<StatusResponse>;
}

async function triggerRun(skipDownload: boolean): Promise<{ started: boolean; reason?: string }> {
  const res = await fetch('/api/internal/training/run', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ skipDownload }),
  });
  if (res.status === 409) return { started: false, reason: 'already running' };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<{ started: boolean }>;
}

async function fetchFullCoefficients(): Promise<Coefficients | null> {
  try {
    const res = await fetch('/api/internal/training/coefficients');
    if (!res.ok) return null;
    return res.json() as Promise<Coefficients>;
  } catch {
    return null;
  }
}

// ── Styles ────────────────────────────────────────────────────────────────────

function makeRoot(_isDark: boolean): React.CSSProperties {
  return {
    minHeight: '100vh',
    backgroundColor: 'var(--sp-bg)',
    color: 'var(--sp-text)',
    fontFamily: 'var(--sp-font-family-base)',
    fontSize: 12,
    padding: '12px 16px',
  };
}

function makePanel(_isDark: boolean): React.CSSProperties {
  return {
    background: 'var(--sp-surface)',
    border: '1px solid var(--sp-border-8)',
    borderRadius: 8,
    padding: '12px 14px',
    marginBottom: 12,
  };
}

const SECTION_TITLE: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--sp-text-40)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.1em',
  marginBottom: 8,
};

function makeTH(_isDark: boolean): React.CSSProperties {
  return {
    padding: '5px 8px',
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--sp-text-40)',
    textAlign: 'left' as const,
    whiteSpace: 'nowrap' as const,
    borderBottom: '1px solid var(--sp-border-8)',
    background: 'var(--sp-surface)',
  };
}

function makeTD(_isDark: boolean, i: number, right = false, mono = false): React.CSSProperties {
  return {
    padding: '4px 8px',
    fontSize: 11,
    background: i % 2 === 0 ? 'var(--sp-surface)' : 'var(--sp-bg)',
    borderBottom: '1px solid var(--sp-border-5)',
    whiteSpace: 'nowrap' as const,
    textAlign: right ? 'right' as const : 'left' as const,
    fontFamily: mono ? 'monospace' : 'inherit',
  };
}

// ── Format helpers ────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-UY', { timeZone: 'America/Montevideo' });
}

function fmtDateLocal(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-UY', {
      timeZone: 'America/Montevideo',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function fmtMs(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function statusColor(s: JobStatus): string {
  return ({
    IDLE: 'var(--sp-status-neutral)',
    RUNNING: 'var(--sp-status-zombie)',
    COMPLETED: 'var(--sp-status-success)',
    FAILED: 'var(--sp-status-error)',
  } as Record<string, string>)[s] ?? 'var(--sp-text-40)';
}

// ── Competition ID humanizer ──────────────────────────────────────────────────

// Static fallback map for comp IDs not covered by portal-config (e.g. football-data prefixed IDs).
const COMP_ID_NAMES_FALLBACK: Record<string, string> = {
  'comp:football-data:PD':  'LaLiga',
  'comp:football-data:PL':  'Premier League',
  'comp:football-data:BL1': 'Bundesliga',
};

function humanizeCompId(id: string, extraNames: Record<string, string> = {}): string {
  return extraNames[id] ?? COMP_ID_NAMES_FALLBACK[id] ?? id;
}

// ── Feature importance table ──────────────────────────────────────────────────

const FEATURE_LABELS: Record<string, string> = {
  lambda_home:          'λ local',
  lambda_away:          'λ visitante',
  balance_ratio:        'Balance ratio',
  lambda_diff:          'Diferencia λ',
  rest_days_home:       'Días descanso local',
  rest_days_away:       'Días descanso visit.',
  h2h_mult_home:        'H2H mult. local',
  h2h_mult_away:        'H2H mult. visit.',
  absence_score_home:   'Ausencias local',
  absence_score_away:   'Ausencias visit.',
  xg_coverage:          'Cobertura xG',
  league_pd:            'Liga: LaLiga',
  league_pl:            'Liga: Premier',
  league_bl1:           'Liga: Bundesliga',
  total_goals_expected: 'Goles totales esp.',
  home_dominance:       'Dominancia local',
  market_imp_home:      'Mercado: local',
  market_imp_draw:      'Mercado: empate',
  market_imp_away:      'Mercado: visitante',
};

function FeatureTable({ coeff, isDark }: { coeff: Coefficients; isDark: boolean }) {
  const TH = makeTH(isDark);
  const keys = Object.keys(coeff.home.weights);

  const rows = keys.map(k => ({
    key: k,
    label: FEATURE_LABELS[k] ?? k,
    home:  coeff.home.weights[k] ?? 0,
    draw:  coeff.draw.weights[k] ?? 0,
    away:  coeff.away.weights[k] ?? 0,
  }));

  rows.sort((a, b) => {
    const maxA = Math.max(Math.abs(a.home), Math.abs(a.draw), Math.abs(a.away));
    const maxB = Math.max(Math.abs(b.home), Math.abs(b.draw), Math.abs(b.away));
    return maxB - maxA;
  });

  function bar(v: number, max = 0.5): React.ReactNode {
    const pct = Math.min(Math.abs(v) / max * 100, 100);
    const color = v > 0 ? 'var(--sp-status-success)' : v < 0 ? 'var(--sp-status-error)' : 'var(--sp-border-8)';
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <div style={{
          width: `${pct}%`,
          maxWidth: 80,
          minWidth: pct > 0 ? 2 : 0,
          height: 8,
          background: color,
          borderRadius: 2,
          transition: 'width 0.3s',
        }} />
        <span style={{ color: v > 0 ? 'var(--sp-status-success)' : v < 0 ? 'var(--sp-status-error)' : 'var(--sp-text-40)', minWidth: 48, textAlign: 'right' }}>
          {v > 0 ? '+' : ''}{v.toFixed(4)}
        </span>
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
        <thead>
          <tr>
            <th style={TH}>Feature</th>
            <th style={{ ...TH, minWidth: 140 }}>Local (HOME)</th>
            <th style={{ ...TH, minWidth: 140 }}>Empate (DRAW)</th>
            <th style={{ ...TH, minWidth: 140 }}>Visitante (AWAY)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ ...makeTD(isDark, 0), color: 'var(--sp-text-40)', fontStyle: 'italic' }}>bias</td>
            <td style={makeTD(isDark, 0)}>{bar(coeff.home.bias)}</td>
            <td style={makeTD(isDark, 0)}>{bar(coeff.draw.bias)}</td>
            <td style={makeTD(isDark, 0)}>{bar(coeff.away.bias)}</td>
          </tr>
          {rows.map((r, i) => (
            <tr key={r.key}>
              <td style={{ ...makeTD(isDark, i + 1), color: r.key.startsWith('market') ? 'var(--sp-status-zombie)' : 'var(--sp-text)' }}>
                {r.label}
                {r.key.startsWith('market') && <span style={{ color: 'var(--sp-status-zombie)', marginLeft: 4 }}>★</span>}
              </td>
              <td style={makeTD(isDark, i + 1)}>{bar(r.home)}</td>
              <td style={makeTD(isDark, i + 1)}>{bar(r.draw)}</td>
              <td style={makeTD(isDark, i + 1)}>{bar(r.away)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 10, color: 'var(--sp-text-40)', marginTop: 6 }}>
        ★ Market features — implied probs de Pinnacle/Bet365. Valor 1/3 en producción (sin acceso a odds en vivo).
      </div>
    </div>
  );
}

// ── Log viewer ────────────────────────────────────────────────────────────────

function LogViewer({ lines, status, isDark }: { lines: string[]; status: JobStatus; isDark: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);

  if (lines.length === 0 && status === 'IDLE') return null;

  return (
    <div ref={ref} style={{
      background: 'var(--sp-surface)',
      border: '1px solid var(--sp-border-8)',
      borderRadius: 6,
      padding: '8px 10px',
      maxHeight: 280,
      overflowY: 'auto',
      fontFamily: 'monospace',
      fontSize: 11,
      lineHeight: 1.5,
      color: 'var(--sp-text-40)',
      marginTop: 8,
    }}>
      {lines.map((l, i) => {
        const color = l.startsWith('[runner]') ? 'var(--sp-text-40)'
          : l.includes('iter') ? '#7dd3fc'
          : l.includes('accuracy') || l.includes('Accuracy') ? 'var(--sp-status-success)'
          : l.includes('ERROR') || l.includes('error') || l.startsWith('[stderr]') ? 'var(--sp-status-error)'
          : 'var(--sp-text-40)';
        return <div key={i} style={{ color }}>{l}</div>;
      })}
      {status === 'RUNNING' && (
        <div style={{ color: 'var(--sp-status-zombie)', marginTop: 4 }}>▌</div>
      )}
    </div>
  );
}

// ── NEXUS info panel ──────────────────────────────────────────────────────────

function NexusInfoPanel({ nexusInfo, isDark, compDisplayNames = {} }: { nexusInfo: NexusInfo; isDark: boolean; compDisplayNames?: Record<string, string> }) {
  const PANEL = makePanel(isDark);
  const ensembleWeights = nexusInfo.ensembleWeights;

  if (!nexusInfo.available) {
    return (
      <div style={{ ...PANEL, borderColor: '#4a1d96' }}>
        <div style={{ color: '#a78bfa', fontWeight: 600, marginBottom: 6 }}>No hay snapshots NEXUS disponibles</div>
        <div style={{ color: 'var(--sp-text-40)', fontSize: 11 }}>
          El motor NEXUS aun no tiene snapshots generados para esta competición. Activar con{' '}
          <code style={{ color: '#c4b5fd' }}>PREDICTION_NEXUS_SHADOW_ENABLED</code> en el servidor.
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Metadata grid */}
      <div style={PANEL}>
        <div style={SECTION_TITLE}>Información del modelo NEXUS</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            ['Snapshots en cache', String(nexusInfo.snapshotCount)],
            ['Ultima generación', nexusInfo.mostRecentAt ? fmtDateLocal(nexusInfo.mostRecentAt) : '—'],
            ['Model version', nexusInfo.modelVersion ?? '—'],
            ['Calibration source', nexusInfo.calibrationSource ?? '—'],
            ['Feature schema', nexusInfo.featureSchemaVersion ?? '—'],
            ['Competiciones', nexusInfo.competitionIds?.map((id) => humanizeCompId(id, compDisplayNames)).join(', ') ?? '—'],
          ].map(([label, value]) => (
            <div key={label} style={{ background: 'var(--sp-surface)', border: '1px solid var(--sp-border-8)', borderRadius: 6, padding: '8px 10px' }}>
              <div style={{ fontSize: 10, color: '#a78bfa', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 3 }}>{label}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--sp-text)', wordBreak: 'break-all' as const }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Ensemble weights */}
      {ensembleWeights && Object.keys(ensembleWeights).length > 0 && (
        <div style={PANEL}>
          <h4 style={{ ...SECTION_TITLE, color: '#a78bfa' }}>Pesos del ensemble</h4>
          {Object.entries(ensembleWeights).map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 mb-1">
              <span style={{ fontSize: 11, color: 'var(--sp-text-40)', width: 80, flexShrink: 0 }}>{k}</span>
              <div style={{ flex: 1, background: 'var(--sp-border-8)', borderRadius: 4, height: 12, overflow: 'hidden' }}>
                <div
                  style={{ background: '#7c3aed', height: '100%', borderRadius: 4, width: `${(v * 100).toFixed(1)}%` }}
                />
              </div>
              <span style={{ fontSize: 11, color: '#c4b5fd', width: 48, textAlign: 'right' as const, flexShrink: 0 }}>
                {(v * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Read-only note */}
      <div style={{ ...PANEL, borderColor: '#4a1d96', background: 'rgba(74,29,150,0.06)' }}>
        <div style={{ color: '#a78bfa', fontSize: 11 }}>
          NEXUS no requiere entrenamiento manual. Los pesos del ensemble se actualizan automáticamente mediante calibración bootstrap.
        </div>
      </div>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TrainingLabPage() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const predictionLeagues = usePredictionLeagues();
  const compDisplayNames = Object.fromEntries(
    predictionLeagues.map((l) => [l.id, l.displayName]),
  );
  const [status, setStatus]           = useState<StatusResponse | null>(null);
  const [coeff, setCoeff]             = useState<Coefficients | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [triggering, setTriggering]   = useState(false);
  const [skipDownload, setSkipDownload] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Engine mode state
  const [trainingEngineMode, setTrainingEngineMode] = useState<TrainingEngineMode>('v3');
  const [nexusInfo, setNexusInfo] = useState<NexusInfo | null>(null);
  const [nexusLoading, setNexusLoading] = useState(false);
  const [nexusError, setNexusError] = useState<string | null>(null);

  const loadCoeff = useCallback(async () => {
    try {
      const res = await fetch('/api/internal/training/coefficients');
      if (res.ok) setCoeff(await res.json() as Coefficients);
    } catch { /* silently ignore */ }
  }, []);

  const load = useCallback(async () => {
    try {
      const s = await fetchStatus();
      setStatus(s);
      setError(null);
      setUnavailable(false);
      if (coeff === null) void loadCoeff();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('404')) setUnavailable(true);
      else setError(msg);
    } finally {
      setLoading(false);
    }
  }, [coeff, loadCoeff]);

  // Initial load
  useEffect(() => { void load(); }, [load]);

  // Polling while RUNNING
  useEffect(() => {
    if (status?.job.status === 'RUNNING') {
      pollRef.current = setInterval(() => { void load(); }, 2000);
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (status?.job.status === 'COMPLETED') void loadCoeff();
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [status?.job.status, load, loadCoeff]);

  // NEXUS info fetch
  useEffect(() => {
    if (trainingEngineMode !== 'nexus') return;
    setNexusLoading(true);
    setNexusError(null);
    fetch('/api/internal/training/nexus-info')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: NexusInfo) => setNexusInfo(data))
      .catch(err => setNexusError(String(err)))
      .finally(() => setNexusLoading(false));
  }, [trainingEngineMode]);

  const handleRun = async () => {
    setTriggering(true);
    try {
      const r = await triggerRun(skipDownload);
      if (r.started) void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTriggering(false);
    }
  };

  // ── Render states ──────────────────────────────────────────────────────────

  const ROOT = makeRoot(isDark);
  const PANEL = makePanel(isDark);

  if (loading) {
    return (
      <div style={ROOT}>
        <div style={{ position: 'fixed', top: 12, right: 16, zIndex: 100 }}>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
        <div style={{ color: 'var(--sp-text-40)', padding: 24 }}>Cargando...</div>
      </div>
    );
  }

  if (unavailable) {
    return (
      <div style={ROOT}>
        <div style={{ position: 'fixed', top: 12, right: 16, zIndex: 100 }}>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
        <div style={{ ...PANEL, borderColor: 'rgba(249,115,22,0.4)', background: 'var(--sp-status-live-soft)' }}>
          <div style={{ color: 'var(--sp-status-live)', fontWeight: 600, marginBottom: 6 }}>Lab no disponible</div>
          <div style={{ color: 'var(--sp-text-40)' }}>Activar con <code style={{ color: 'var(--sp-status-zombie)' }}>PREDICTION_INTERNAL_VIEW_ENABLED=true</code> en el servidor.</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={ROOT}>
        <div style={{ position: 'fixed', top: 12, right: 16, zIndex: 100 }}>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
        <div style={{ ...PANEL, borderColor: 'rgba(239,68,68,0.3)', background: 'var(--sp-status-error-soft)' }}>
          <div style={{ color: 'var(--sp-status-error)', marginBottom: 4 }}>Error al cargar</div>
          <div style={{ color: 'var(--sp-text-40)', fontFamily: 'monospace', fontSize: 11 }}>{error}</div>
          <button onClick={() => void load()} style={{ marginTop: 10, background: 'var(--sp-surface)', color: 'var(--sp-text)', border: '1px solid var(--sp-border-8)', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 11 }}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const job = status!.job;
  const meta = status!.lastCoefficients;
  const isRunning = job.status === 'RUNNING';

  return (
    <div style={ROOT}>

      {/* Header */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sp-text)', marginBottom: 2 }}>
            {trainingEngineMode === 'nexus'
              ? 'NEXUS — Ensemble Predictivo PE'
              : 'Entrenamiento — Modelo Logístico PE'
            }
          </div>
          <div style={{ fontSize: 11, color: 'var(--sp-text-40)' }}>
            {trainingEngineMode === 'nexus'
              ? 'Pipeline: NEXUS ensemble · calibración bootstrap · multi-motor'
              : 'Pipeline: odds (football-data.co.uk) → walk-forward → multinomial logistic + class weights'
            }
          </div>

          {/* Engine mode selector */}
          <div className="flex gap-2 flex-wrap mt-2">
            {(['v3', 'nexus'] as TrainingEngineMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setTrainingEngineMode(mode)}
                className={`px-3 py-1 rounded text-xs font-semibold border transition-colors ${
                  trainingEngineMode === mode
                    ? (mode === 'nexus' ? 'bg-purple-700 text-white border-purple-700' : 'bg-indigo-600 text-white border-indigo-600')
                    : (mode === 'nexus' ? 'bg-transparent text-purple-400 border-purple-600 hover:bg-purple-900' : 'bg-transparent text-indigo-400 border-indigo-600 hover:bg-indigo-900')
                }`}
              >
                {mode === 'v3' ? 'V3 (Logístico)' : 'NEXUS (Ensemble)'}
              </button>
            ))}
          </div>
        </div>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </div>

      {/* NEXUS view */}
      {trainingEngineMode === 'nexus' && (
        <>
          {nexusLoading && (
            <div style={{ color: 'var(--sp-text-40)', padding: '20px 0' }}>
              Cargando información NEXUS…
            </div>
          )}
          {nexusError && (
            <div style={{ ...PANEL, borderColor: 'rgba(239,68,68,0.3)', background: 'var(--sp-status-error-soft)' }}>
              <div style={{ color: 'var(--sp-status-error)', marginBottom: 4 }}>Error al cargar info NEXUS</div>
              <div style={{ color: 'var(--sp-text-40)', fontFamily: 'monospace', fontSize: 11 }}>{nexusError}</div>
              <div style={{ marginTop: 6, color: 'var(--sp-text-40)', fontSize: 10 }}>
                Verifica que <code>PREDICTION_NEXUS_SHADOW_ENABLED</code> este configurado en el servidor.
              </div>
            </div>
          )}
          {!nexusLoading && !nexusError && nexusInfo && (
            <NexusInfoPanel nexusInfo={nexusInfo} isDark={isDark} compDisplayNames={compDisplayNames} />
          )}
        </>
      )}

      {/* V3 view */}
      {trainingEngineMode === 'v3' && (
        <>
          {/* Panel A — Estado */}
          <div style={PANEL}>
            <div style={SECTION_TITLE}>Estado del pipeline</div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
              <Stat label="Job actual" value={job.status} valueColor={statusColor(job.status)} isDark={isDark} />
              <Stat label="Último inicio" value={fmtDate(job.startedAt)} isDark={isDark} />
              <Stat label="Duración" value={fmtMs(job.durationMs)} isDark={isDark} />
              {meta && <Stat label="Último entrenamiento" value={fmtDate(meta.trainedAt)} isDark={isDark} />}
              {meta && <Stat label="Ejemplos entrenados" value={meta.trainedOnMatches.toLocaleString()} isDark={isDark} />}
              {meta && <Stat label="Regularización λ" value={meta.regularizationLambda.toFixed(3)} isDark={isDark} />}
            </div>

            {/* Botón trigger */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button
                onClick={() => void handleRun()}
                disabled={isRunning || triggering}
                style={{
                  background: isRunning ? 'var(--sp-surface)' : 'var(--sp-status-info)',
                  color: isRunning ? 'var(--sp-text-40)' : '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '7px 16px',
                  cursor: isRunning || triggering ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                  fontSize: 12,
                }}
              >
                {isRunning ? '⏳ Entrenando...' : triggering ? 'Iniciando...' : '▶ Reentrenar'}
              </button>

              <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--sp-text-40)', fontSize: 11, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={skipDownload}
                  onChange={e => setSkipDownload(e.target.checked)}
                  disabled={isRunning}
                  style={{ accentColor: '#3b82f6' }}
                />
                Saltar descarga de odds (usar cache)
              </label>

              {!isRunning && (
                <button onClick={() => void load()} style={{ background: 'var(--sp-surface)', color: 'var(--sp-text-40)', border: '1px solid var(--sp-border-8)', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 11 }}>
                  Actualizar
                </button>
              )}
            </div>

            <LogViewer lines={job.lastLines} status={job.status} isDark={isDark} />
          </div>

          {/* Panel B — Comandos rápidos */}
          <div style={PANEL}>
            <div style={SECTION_TITLE}>CLI equivalente</div>
            <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#7dd3fc', lineHeight: 2 }}>
              <div># Pipeline completo</div>
              <div style={{ color: '#86efac' }}>pnpm train</div>
              <div style={{ marginTop: 4 }}># Solo reentrenar (odds ya descargadas)</div>
              <div style={{ color: '#86efac' }}>pnpm train -- --skip-download</div>
              <div style={{ marginTop: 4 }}># Backtest baseline vs ensemble</div>
              <div style={{ color: '#86efac' }}>pnpm backtest && pnpm backtest:ensemble</div>
            </div>
          </div>

          {/* Panel C — Feature importance */}
          {coeff && (
            <div style={PANEL}>
              <div style={SECTION_TITLE}>
                Pesos del modelo — {coeff.trained_on_matches.toLocaleString()} ejemplos · {new Date(coeff.trained_at).toLocaleDateString('es-UY', { timeZone: 'America/Montevideo' })}
              </div>
              <div style={{ fontSize: 10, color: 'var(--sp-text-40)', marginBottom: 8 }}>
                Ordenado por magnitud máxima entre clases. Verde = favorece la clase. Rojo = penaliza.
              </div>
              <FeatureTable coeff={coeff} isDark={isDark} />
            </div>
          )}

          {!coeff && meta && (
            <div style={{ ...PANEL, borderColor: 'var(--sp-border-8)' }}>
              <div style={{ color: 'var(--sp-text-40)', fontSize: 11 }}>
                Pesos del modelo no disponibles. Activar <code style={{ color: 'var(--sp-status-zombie)' }}>GET /api/internal/training/coefficients</code>.
              </div>
            </div>
          )}
        </>
      )}

    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function Stat({ label, value, valueColor }: { label: string; value: string; valueColor?: string; isDark: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--sp-text-40)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: valueColor ?? 'var(--sp-text)' }}>{value}</div>
    </div>
  );
}
