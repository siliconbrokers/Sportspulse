/**
 * ProviderDetailPanel — detail drawer for a selected provider.
 * Styles: CSS-in-JS with sp-* variables (no Tailwind).
 */
import type { ProviderSummaryItem, ProviderDetailResponse, ApiUsageEventLite } from '../hooks/use-api-usage.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const LEVEL_COLOR: Record<string, string> = {
  NORMAL: '#22c55e',
  WARNING: '#eab308',
  CRITICAL: '#f97316',
  EXHAUSTED: '#ef4444',
};

const DISCREPANCY_COLOR: Record<string, string> = {
  NONE: '#22c55e',
  MINOR: '#eab308',
  MAJOR: '#ef4444',
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
              <td style={{ ...TD, color: ev.success ? '#22c55e' : '#ef4444' }}>
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
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export function ProviderDetailPanel({ displayName, summaryItem, detail, loading, onClose }: Props) {
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
    </div>
  );
}
