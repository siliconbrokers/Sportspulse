/**
 * TrainingLabPage — /labs/entrenamiento
 *
 * Muestra el estado del pipeline de entrenamiento del modelo logístico:
 * - Última vez entrenado + N ejemplos + regularización
 * - Botón "Reentrenar" con logs en tiempo real (polling)
 * - Pesos por feature y clase (importancia de features)
 *
 * Gateado por PREDICTION_INTERNAL_VIEW_ENABLED en el servidor.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

type JobStatus = 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED';

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

function loadCoefficients(): Coefficients | null {
  // Los coeficientes se exponen via la respuesta del status como metadata básica.
  // Para los pesos completos, los cargamos desde el mismo endpoint de status
  // una vez que el entrenamiento termina — aquí los pedimos en paralelo.
  return null; // placeholder — se piden en fetchFullCoefficients
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
  textTransform: 'uppercase' as const,
  letterSpacing: '0.1em',
  marginBottom: 8,
};

const TH: React.CSSProperties = {
  padding: '5px 8px',
  fontSize: 10,
  fontWeight: 600,
  color: '#64748b',
  textAlign: 'left' as const,
  whiteSpace: 'nowrap' as const,
  borderBottom: '1px solid #2a2a2a',
  background: '#0f0f0f',
};

function TD(i: number, right = false, mono = false): React.CSSProperties {
  return {
    padding: '4px 8px',
    fontSize: 11,
    background: i % 2 === 0 ? '#141414' : '#111',
    borderBottom: '1px solid #1c1c1c',
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

function fmtMs(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function statusColor(s: JobStatus): string {
  return { IDLE: '#64748b', RUNNING: '#f59e0b', COMPLETED: '#22c55e', FAILED: '#ef4444' }[s];
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

function FeatureTable({ coeff }: { coeff: Coefficients }) {
  const keys = Object.keys(coeff.home.weights);

  // Para cada feature, el "peso neto" es la diferencia max - min entre clases
  const rows = keys.map(k => ({
    key: k,
    label: FEATURE_LABELS[k] ?? k,
    home:  coeff.home.weights[k] ?? 0,
    draw:  coeff.draw.weights[k] ?? 0,
    away:  coeff.away.weights[k] ?? 0,
  }));

  // Ordenar por magnitud máxima (importancia)
  rows.sort((a, b) => {
    const maxA = Math.max(Math.abs(a.home), Math.abs(a.draw), Math.abs(a.away));
    const maxB = Math.max(Math.abs(b.home), Math.abs(b.draw), Math.abs(b.away));
    return maxB - maxA;
  });

  function bar(v: number, max = 0.5): React.ReactNode {
    const pct = Math.min(Math.abs(v) / max * 100, 100);
    const color = v > 0 ? '#22c55e' : v < 0 ? '#ef4444' : '#334155';
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
        <span style={{ color: v > 0 ? '#86efac' : v < 0 ? '#fca5a5' : '#64748b', minWidth: 48, textAlign: 'right' }}>
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
            <td style={{ ...TD(0), color: '#64748b', fontStyle: 'italic' }}>bias</td>
            <td style={TD(0)}>{bar(coeff.home.bias)}</td>
            <td style={TD(0)}>{bar(coeff.draw.bias)}</td>
            <td style={TD(0)}>{bar(coeff.away.bias)}</td>
          </tr>
          {rows.map((r, i) => (
            <tr key={r.key}>
              <td style={{ ...TD(i + 1), color: r.key.startsWith('market') ? '#f59e0b' : '#cbd5e1' }}>
                {r.label}
                {r.key.startsWith('market') && <span style={{ color: '#f59e0b', marginLeft: 4 }}>★</span>}
              </td>
              <td style={TD(i + 1)}>{bar(r.home)}</td>
              <td style={TD(i + 1)}>{bar(r.draw)}</td>
              <td style={TD(i + 1)}>{bar(r.away)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 10, color: '#475569', marginTop: 6 }}>
        ★ Market features — implied probs de Pinnacle/Bet365. Valor 1/3 en producción (sin acceso a odds en vivo).
      </div>
    </div>
  );
}

// ── Log viewer ────────────────────────────────────────────────────────────────

function LogViewer({ lines, status }: { lines: string[]; status: JobStatus }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);

  if (lines.length === 0 && status === 'IDLE') return null;

  return (
    <div ref={ref} style={{
      background: '#0a0a0a',
      border: '1px solid #2a2a2a',
      borderRadius: 6,
      padding: '8px 10px',
      maxHeight: 280,
      overflowY: 'auto',
      fontFamily: 'monospace',
      fontSize: 11,
      lineHeight: 1.5,
      color: '#94a3b8',
      marginTop: 8,
    }}>
      {lines.map((l, i) => {
        const color = l.startsWith('[runner]') ? '#64748b'
          : l.includes('iter') ? '#7dd3fc'
          : l.includes('accuracy') || l.includes('Accuracy') ? '#86efac'
          : l.includes('ERROR') || l.includes('error') || l.startsWith('[stderr]') ? '#fca5a5'
          : '#94a3b8';
        return <div key={i} style={{ color }}>{l}</div>;
      })}
      {status === 'RUNNING' && (
        <div style={{ color: '#f59e0b', marginTop: 4 }}>▌</div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TrainingLabPage() {
  const [status, setStatus]           = useState<StatusResponse | null>(null);
  const [coeff, setCoeff]             = useState<Coefficients | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [triggering, setTriggering]   = useState(false);
  const [skipDownload, setSkipDownload] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      // Load full coefficients once (not on every poll)
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
      // Reload coefficients after training completes
      if (status?.job.status === 'COMPLETED') void loadCoeff();
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [status?.job.status, load, loadCoeff]);

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

  if (loading) {
    return <div style={ROOT}><div style={{ color: '#64748b', padding: 24 }}>Cargando...</div></div>;
  }

  if (unavailable) {
    return (
      <div style={ROOT}>
        <div style={{ ...PANEL, borderColor: '#451a03', background: '#1a0a00' }}>
          <div style={{ color: '#f97316', fontWeight: 600, marginBottom: 6 }}>Lab no disponible</div>
          <div style={{ color: '#94a3b8' }}>Activar con <code style={{ color: '#f59e0b' }}>PREDICTION_INTERNAL_VIEW_ENABLED=true</code> en el servidor.</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={ROOT}>
        <div style={{ ...PANEL, borderColor: '#450a0a', background: '#1a0000' }}>
          <div style={{ color: '#ef4444', marginBottom: 4 }}>Error al cargar</div>
          <div style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 11 }}>{error}</div>
          <button onClick={() => void load()} style={{ marginTop: 10, background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 11 }}>
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
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9', marginBottom: 2 }}>
          Entrenamiento — Modelo Logístico PE
        </div>
        <div style={{ fontSize: 11, color: '#475569' }}>
          Pipeline: odds (football-data.co.uk) → walk-forward → multinomial logistic + class weights
        </div>
      </div>

      {/* Panel A — Estado */}
      <div style={PANEL}>
        <div style={SECTION_TITLE}>Estado del pipeline</div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
          <Stat label="Job actual" value={job.status} valueColor={statusColor(job.status)} />
          <Stat label="Último inicio" value={fmtDate(job.startedAt)} />
          <Stat label="Duración" value={fmtMs(job.durationMs)} />
          {meta && <Stat label="Último entrenamiento" value={fmtDate(meta.trainedAt)} />}
          {meta && <Stat label="Ejemplos entrenados" value={meta.trainedOnMatches.toLocaleString()} />}
          {meta && <Stat label="Regularización λ" value={meta.regularizationLambda.toFixed(3)} />}
        </div>

        {/* Botón trigger */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={() => void handleRun()}
            disabled={isRunning || triggering}
            style={{
              background: isRunning ? '#1e293b' : '#1d4ed8',
              color: isRunning ? '#475569' : '#fff',
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

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}>
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
            <button onClick={() => void load()} style={{ background: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 11 }}>
              Actualizar
            </button>
          )}
        </div>

        <LogViewer lines={job.lastLines} status={job.status} />
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
          <div style={{ fontSize: 10, color: '#475569', marginBottom: 8 }}>
            Ordenado por magnitud máxima entre clases. Verde = favorece la clase. Rojo = penaliza.
          </div>
          <FeatureTable coeff={coeff} />
        </div>
      )}

      {!coeff && meta && (
        <div style={{ ...PANEL, borderColor: '#1e293b' }}>
          <div style={{ color: '#475569', fontSize: 11 }}>
            Pesos del modelo no disponibles. Activar <code style={{ color: '#f59e0b' }}>GET /api/internal/training/coefficients</code>.
          </div>
        </div>
      )}

    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function Stat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#475569', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: valueColor ?? '#e2e8f0' }}>{value}</div>
    </div>
  );
}
