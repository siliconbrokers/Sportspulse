/**
 * ProviderDetailPanel — detail drawer for a selected provider.
 * Styles: CSS-in-JS with sp-* variables (no Tailwind).
 */
import { useState } from 'react';
import type { ProviderSummaryItem, ProviderDetailResponse, ApiUsageEventLite } from '../hooks/use-api-usage.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const LEVEL_COLOR: Record<string, string> = {
  NORMAL: 'var(--sp-status-success)',
  WARNING: 'var(--sp-status-warning)',
  CRITICAL: 'var(--sp-status-live)',
  EXHAUSTED: 'var(--sp-status-error)',
};

const DISCREPANCY_COLOR: Record<string, string> = {
  NONE: 'var(--sp-status-success)',
  MINOR: 'var(--sp-status-warning)',
  MAJOR: 'var(--sp-status-error)',
  UNKNOWN: 'var(--sp-text-40)',
};

function fmtNum(n: number): string {
  return n.toLocaleString('es-UY');
}

function relativeTime(utc: string): string {
  const diff = Date.now() - new Date(utc).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ─── Shared table styles ──────────────────────────────────────────────────────

const TH: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--sp-text-40)',
  padding: '6px 8px',
  textAlign: 'left',
  borderBottom: '1px solid var(--sp-border-8)',
  whiteSpace: 'nowrap',
};

const TD: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--sp-text)',
  padding: '6px 8px',
  borderBottom: '1px solid var(--sp-border-5)',
  verticalAlign: 'top',
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--sp-text-40)',
        marginTop: 20,
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

// ─── Incidents table ─────────────────────────────────────────────────────────

function IncidentsTable({ events }: { events: ApiUsageEventLite[] }) {
  if (events.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--sp-text-40)', padding: '8px 0' }}>Sin incidentes rate-limit.</div>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 460 }}>
        <thead>
          <tr>
            <th style={TH}>Timestamp</th>
            <th style={TH}>Endpoint</th>
            <th style={TH}>Status</th>
            <th style={TH}>Latencia</th>
          </tr>
        </thead>
        <tbody>
          {events.slice(0, 20).map((ev) => (
            <tr key={ev.id}>
              <td style={TD}>{relativeTime(ev.startedAtUtc)}</td>
              <td style={{ ...TD, fontFamily: 'monospace', fontSize: 11 }}>{truncate(ev.operationKey, 40)}</td>
              <td style={{ ...TD, color: ev.success ? 'var(--sp-status-success)' : 'var(--sp-status-error)' }}>
                {ev.statusCode ?? '—'}
              </td>
              <td style={TD}>{ev.latencyMs}ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  providerKey: string;
  displayName: string;
  summaryItem: ProviderSummaryItem;
  detail: ProviderDetailResponse | null;
  loading: boolean;
  onClose: () => void;
  token: string;
  onRefresh: () => void;
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export function ProviderDetailPanel({ providerKey, displayName, summaryItem, detail, loading, onClose, token, onRefresh }: Props) {
  const [syncRemaining, setSyncRemaining] = useState('');
  const [syncLimit, setSyncLimit] = useState('');
  const [syncStatus, setSyncStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);

  async function handleSyncQuota() {
    const remaining = parseInt(syncRemaining, 10);
    const limit = parseInt(syncLimit, 10);
    if (isNaN(remaining) || isNaN(limit) || remaining < 0 || limit <= 0) {
      setSyncError('Valores inválidos — ingresa números positivos.');
      return;
    }
    setSyncStatus('loading');
    setSyncError(null);
    try {
      const res = await fetch('/api/internal/ops/api-usage/seed-quota', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ providerKey, remaining, limit }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `HTTP ${res.status}`);
      }
      setSyncStatus('ok');
      setSyncRemaining('');
      setSyncLimit('');
      onRefresh();
    } catch (e: unknown) {
      setSyncStatus('error');
      setSyncError(e instanceof Error ? e.message : 'Error desconocido');
    }
  }
  const color = LEVEL_COLOR[summaryItem.warningLevel] ?? '#22c55e';
  const discColor = DISCREPANCY_COLOR[summaryItem.discrepancyStatus] ?? 'var(--sp-text-40)';

  return (
    <div
      style={{
        background: 'var(--sp-surface)',
        border: '1px solid var(--sp-border-8)',
        borderRadius: 10,
        padding: '20px 22px',
        marginTop: 16,
        position: 'relative',
      }}
    >
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--sp-text)' }}>{displayName}</span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.06em',
              padding: '2px 7px',
              borderRadius: 4,
              background: color + '22',
              color,
            }}
          >
            {summaryItem.warningLevel}
          </span>
          {detail && (
            <span style={{ fontSize: 12, color: 'var(--sp-text-40)' }}>
              {detail.percentUsed.toFixed(1)}% consumido
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--sp-text-40)',
            fontSize: 18,
            cursor: 'pointer',
            lineHeight: 1,
            padding: '0 4px',
            minWidth: 32,
            minHeight: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          aria-label="Cerrar"
        >
          ✕
        </button>
      </div>

      {/* ── Discrepancy row ── */}
      <div style={{ fontSize: 12, color: 'var(--sp-text-40)', marginBottom: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
        Ledger vs Provider:
        <span style={{ color: discColor, fontWeight: 700 }}>{summaryItem.discrepancyStatus}</span>
        <span>
          (ledger: {summaryItem.estimatedRemaining !== null ? fmtNum(summaryItem.estimatedRemaining) : '—'},
          {' '}provider: {summaryItem.providerReportedRemaining !== null ? fmtNum(summaryItem.providerReportedRemaining) : '—'})
        </span>
      </div>

      {loading && !detail && (
        <div style={{ color: 'var(--sp-text-40)', fontSize: 13, padding: '16px 0' }}>Cargando detalle…</div>
      )}

      {/* ── By consumer type (from /today summary) ── */}
      {summaryItem.byConsumerType.length > 0 && (
        <>
          <SectionTitle>Por tipo de consumidor</SectionTitle>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 280 }}>
              <thead>
                <tr>
                  <th style={TH}>ConsumerType</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Unidades</th>
                </tr>
              </thead>
              <tbody>
                {summaryItem.byConsumerType.map((row) => (
                  <tr key={row.consumerType}>
                    <td style={TD}>
                      {row.consumerType === 'RECONCILIATION'
                        ? 'Uso previo (detectado desde headers del provider)'
                        : row.consumerType}
                    </td>
                    <td style={{ ...TD, textAlign: 'right' }}>{fmtNum(row.usedUnits)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {detail && (
        <>
          {/* ── Top operations ── */}
          {detail.topOperations.length > 0 && (
            <>
              <SectionTitle>Top 10 operaciones</SectionTitle>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 360 }}>
                  <thead>
                    <tr>
                      <th style={TH}>OperationKey</th>
                      <th style={{ ...TH, textAlign: 'right' }}>Count</th>
                      <th style={{ ...TH, textAlign: 'right' }}>Unidades</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.topOperations.slice(0, 10).map((op) => (
                      <tr key={op.operationKey}>
                        <td style={{ ...TD, fontFamily: 'monospace', fontSize: 11 }}>{truncate(op.operationKey, 48)}</td>
                        <td style={{ ...TD, textAlign: 'right' }}>{op.count}</td>
                        <td style={{ ...TD, textAlign: 'right' }}>{fmtNum(op.totalUnits)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── Top consumers ── */}
          {detail.topConsumers.length > 0 && (
            <>
              <SectionTitle>Top 10 consumidores</SectionTitle>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 360 }}>
                  <thead>
                    <tr>
                      <th style={TH}>ConsumerId</th>
                      <th style={{ ...TH, textAlign: 'right' }}>Count</th>
                      <th style={{ ...TH, textAlign: 'right' }}>Unidades</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.topConsumers.slice(0, 10).map((c) => (
                      <tr key={c.consumerId}>
                        <td style={{ ...TD, fontFamily: 'monospace', fontSize: 11 }}>{truncate(c.consumerId, 40)}</td>
                        <td style={{ ...TD, textAlign: 'right' }}>{c.count}</td>
                        <td style={{ ...TD, textAlign: 'right' }}>{fmtNum(c.totalUnits)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── Rate-limit incidents ── */}
          <SectionTitle>Incidentes rate-limit (últimos 20)</SectionTitle>
          <IncidentsTable events={detail.rateLimitIncidents} />
        </>
      )}

      {/* ── Sync Quota manual (LEDGER_OBSERVED only) ── */}
      {summaryItem.dataSource === 'LEDGER_OBSERVED' && (
        <>
          <SectionTitle>Sincronizar cuota</SectionTitle>
          <div
            style={{
              background: 'var(--sp-bg)',
              border: '1px solid var(--sp-border-8)',
              borderRadius: 8,
              padding: '12px 14px',
              fontSize: 12,
            }}
          >
            <div style={{ color: 'var(--sp-text-40)', marginBottom: 10, lineHeight: 1.5 }}>
              Este provider no reporta cuota diaria en sus headers — cada instancia
              (dev/prod) cuenta sus propias llamadas por separado. Ingresá los valores
              reales desde el dashboard del provider para sincronizar este servidor.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--sp-text-40)', textTransform: 'uppercase' }}>
                  Restantes
                </label>
                <input
                  type="number"
                  min={0}
                  value={syncRemaining}
                  onChange={(e) => { setSyncRemaining(e.target.value); setSyncStatus('idle'); }}
                  placeholder="ej: 7430"
                  style={{
                    width: 110,
                    padding: '6px 8px',
                    borderRadius: 5,
                    border: '1px solid var(--sp-border-8)',
                    background: 'var(--sp-surface)',
                    color: 'var(--sp-text)',
                    fontSize: 12,
                  }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--sp-text-40)', textTransform: 'uppercase' }}>
                  Límite total
                </label>
                <input
                  type="number"
                  min={1}
                  value={syncLimit}
                  onChange={(e) => { setSyncLimit(e.target.value); setSyncStatus('idle'); }}
                  placeholder="ej: 10000"
                  style={{
                    width: 110,
                    padding: '6px 8px',
                    borderRadius: 5,
                    border: '1px solid var(--sp-border-8)',
                    background: 'var(--sp-surface)',
                    color: 'var(--sp-text)',
                    fontSize: 12,
                  }}
                />
              </div>
              <button
                onClick={() => { void handleSyncQuota(); }}
                disabled={syncStatus === 'loading' || !syncRemaining || !syncLimit}
                style={{
                  padding: '6px 14px',
                  borderRadius: 5,
                  border: 'none',
                  background: syncStatus === 'loading' ? 'var(--sp-border-8)' : 'var(--sp-primary)',
                  color: syncStatus === 'loading' ? 'var(--sp-text-40)' : '#fff',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: syncStatus === 'loading' || !syncRemaining || !syncLimit ? 'not-allowed' : 'pointer',
                  opacity: !syncRemaining || !syncLimit ? 0.5 : 1,
                  alignSelf: 'flex-end',
                }}
              >
                {syncStatus === 'loading' ? 'Sincronizando…' : 'Sincronizar'}
              </button>
            </div>
            {syncStatus === 'ok' && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--sp-status-success)', fontWeight: 600 }}>
                Cuota sincronizada correctamente.
              </div>
            )}
            {(syncStatus === 'error' || syncError) && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--sp-status-error)' }}>
                Error: {syncError}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
