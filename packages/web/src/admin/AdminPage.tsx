/**
 * AdminPage — Back Office simple para SportPulse.
 * Ruta: /admin
 * Auth: token ADMIN_SECRET via POST /api/admin/auth
 */
import { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../hooks/use-theme.js';
import { ThemeToggle } from '../components/ThemeToggle.js';

interface CompetitionConfig {
  id: string;
  slug: string;
  displayName: string;
  enabled: boolean;
  updatedAt: string;
  updatedBy: string;
}

interface PortalConfig {
  competitions: CompetitionConfig[];
  features: {
    tv: boolean;
    predictions: boolean;
    updatedAt: string;
    updatedBy: string;
  };
}

type SaveState = 'idle' | 'saving' | 'ok' | 'error';

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  page: {
    minHeight: '100vh',
    background: 'var(--sp-bg)',
    color: 'var(--sp-text)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    padding: '40px 24px',
  } as React.CSSProperties,
  card: {
    maxWidth: 640,
    margin: '0 auto',
    background: 'var(--sp-surface)',
    border: '1px solid var(--sp-border-8)',
    borderRadius: 12,
    padding: 28,
  } as React.CSSProperties,
  title: {
    fontSize: 20,
    fontWeight: 700,
    marginBottom: 4,
    color: 'var(--sp-text)',
  } as React.CSSProperties,
  subtitle: {
    fontSize: 13,
    color: 'var(--sp-text-40)',
    marginBottom: 24,
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: 'var(--sp-text-40)',
    marginBottom: 12,
    marginTop: 8,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 0',
    borderBottom: '1px solid var(--sp-border-5)',
  } as React.CSSProperties,
  label: {
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--sp-text)',
  } as React.CSSProperties,
  slug: {
    fontSize: 11,
    color: 'var(--sp-text-40)',
    marginTop: 2,
  } as React.CSSProperties,
  input: {
    width: '100%',
    padding: '10px 14px',
    borderRadius: 8,
    border: '1px solid var(--sp-border-8)',
    background: 'var(--sp-surface)',
    color: 'var(--sp-text)',
    fontSize: 14,
    outline: 'none',
    marginBottom: 12,
  } as React.CSSProperties,
  btn: {
    padding: '10px 20px',
    borderRadius: 8,
    border: 'none',
    background: 'var(--sp-primary)',
    color: '#fff',
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
    width: '100%',
  } as React.CSSProperties,
  errMsg: {
    color: '#ef4444',
    fontSize: 13,
    marginTop: 8,
  } as React.CSSProperties,
  feedback: (state: SaveState) => ({
    fontSize: 12,
    marginLeft: 8,
    color: state === 'ok' ? '#22c55e' : state === 'error' ? '#ef4444' : 'var(--sp-text-40)',
  }) as React.CSSProperties,
};

// ─── Toggle switch ────────────────────────────────────────────────────────────

function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => !disabled && onChange(!value)}
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        border: 'none',
        background: value ? 'var(--sp-primary)' : 'var(--sp-border-8)',
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        flexShrink: 0,
        transition: 'background 0.2s ease',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: value ? 23 : 3,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.2s ease',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }}
      />
    </button>
  );
}

// ─── Login screen ─────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: (token: string) => void }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        sessionStorage.setItem('admin_token', token);
        onLogin(token);
      } else {
        setError('Token incorrecto.');
      }
    } catch {
      setError('Error de conexión.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.title}>Back Office</div>
        <div style={S.subtitle}>SportPulse — Acceso administrativo</div>
        <form onSubmit={handleSubmit}>
          <input
            style={S.input}
            type="password"
            placeholder="Token de acceso"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoFocus
          />
          <button style={S.btn} type="submit" disabled={loading || !token}>
            {loading ? 'Verificando…' : 'Ingresar'}
          </button>
          {error && <div style={S.errMsg}>{error}</div>}
        </form>
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

function AdminPanel({ token }: { token: string }) {
  const { theme, toggleTheme } = useTheme();
  const [config, setConfig] = useState<PortalConfig | null>(null);
  const [loadError, setLoadError] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  const loadConfig = useCallback(async () => {
    setLoadError('');
    try {
      const res = await fetch('/api/admin/config', { headers });
      if (res.status === 401) { setLoadError('Token incorrecto.'); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConfig(await res.json());
    } catch {
      setLoadError('El servidor está arrancando. Reintentando en 5 segundos…');
      setTimeout(() => void loadConfig(), 5000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { void loadConfig(); }, [loadConfig]);

  async function patch(update: { competitions?: { id: string; enabled: boolean }[]; features?: { tv?: boolean; predictions?: boolean } }) {
    setSaveState('saving');
    try {
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers,
        body: JSON.stringify(update),
      });
      if (!res.ok) throw new Error('Save failed');
      const { config: newConfig } = await res.json();
      setConfig(newConfig);
      setSaveState('ok');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch {
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 3000);
    }
  }

  function toggleCompetition(id: string, enabled: boolean) {
    void patch({ competitions: [{ id, enabled }] });
  }

  function toggleFeature(key: 'tv' | 'predictions', value: boolean) {
    void patch({ features: { [key]: value } });
  }

  if (loadError) {
    return (
      <div style={S.page}>
        <div style={S.card}>
          <div style={{ color: '#ef4444', fontSize: 14 }}>{loadError}</div>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div style={S.page}>
        <div style={S.card}>
          <div style={{ color: 'var(--sp-text-40)', fontSize: 14 }}>Cargando configuración…</div>
        </div>
      </div>
    );
  }

  const isSaving = saveState === 'saving';

  return (
    <div style={S.page}>
      <div style={{ ...S.card, maxWidth: 680 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={S.title}>SportPulse</div>
            <div style={S.subtitle}>Configuración del portal</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 }}>
              <a href="/admin/ops" style={{ fontSize: 12, color: 'var(--sp-primary)', textDecoration: 'none' }}>
                → Ver consumo de APIs (Ops)
              </a>
              <a href="/labs" style={{ fontSize: 12, color: 'var(--sp-primary)', textDecoration: 'none' }}>
                → Labs · Pronósticos
              </a>
              <a href="/labs/evaluacion" style={{ fontSize: 12, color: 'var(--sp-primary)', textDecoration: 'none' }}>
                → Labs · Evaluación
              </a>
              <a href="/labs/evaluacion-historica" style={{ fontSize: 12, color: 'var(--sp-primary)', textDecoration: 'none' }}>
                → Labs · Evaluación histórica
              </a>
              <a href="/labs/entrenamiento" style={{ fontSize: 12, color: 'var(--sp-primary)', textDecoration: 'none' }}>
                → Labs · Entrenamiento
              </a>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {saveState === 'saving' && <span style={S.feedback('saving')}>Guardando…</span>}
            {saveState === 'ok' && <span style={S.feedback('ok')}>✓ Guardado</span>}
            {saveState === 'error' && <span style={S.feedback('error')}>✗ Error al guardar</span>}
            <a
              href="/"
              style={{ fontSize: 12, color: 'var(--sp-primary)', textDecoration: 'none', fontWeight: 600 }}
            >
              ← Portal
            </a>
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
        </div>

        {/* ── Sección A — Competiciones ── */}
        <div style={S.sectionTitle}>Competiciones</div>
        {config.competitions.map((comp) => (
          <div key={comp.id} style={S.row}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={S.label}>{comp.displayName}</span>
              <span style={{ ...S.slug, marginTop: 0 }}>{comp.slug} · {comp.id}</span>
            </div>
            <Toggle
              value={comp.enabled}
              onChange={(v) => toggleCompetition(comp.id, v)}
              disabled={isSaving}
            />
          </div>
        ))}

        {/* ── Sección B — Features de menú ── */}
        <div style={S.sectionTitle}>Opciones del menú</div>
        <div style={S.row}>
          <div>
            <div style={S.label}>TV</div>
            <div style={S.slug}>Muestra la sección de streaming en el menú</div>
          </div>
          <Toggle
            value={config.features.tv}
            onChange={(v) => toggleFeature('tv', v)}
            disabled={isSaving}
          />
        </div>
        <div style={{ ...S.row, borderBottom: 'none' }}>
          <div>
            <div style={S.label}>Pronósticos</div>
            <div style={S.slug}>Muestra la sección de predicciones en el menú</div>
          </div>
          <Toggle
            value={config.features.predictions}
            onChange={(v) => toggleFeature('predictions', v)}
            disabled={isSaving}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export function AdminPage() {
  const [token, setToken] = useState<string | null>(
    () => sessionStorage.getItem('admin_token'),
  );

  if (!token) {
    return <LoginScreen onLogin={setToken} />;
  }
  return <AdminPanel token={token} />;
}
