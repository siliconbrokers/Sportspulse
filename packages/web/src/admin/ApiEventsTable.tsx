/**
 * ApiEventsTable — filterable table of recent API usage events.
 * Styles: CSS-in-JS with sp-* variables (no Tailwind).
 */
import { useState, useEffect } from 'react';
import { fetchApiUsageEvents } from '../hooks/use-api-usage.js';
import type { ApiUsageEventLite, EventsFilters } from '../hooks/use-api-usage.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(utc: string): string {
  const diff = Date.now() - new Date(utc).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `hace ${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  return `hace ${hrs}h`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function is2xx(code: number | null): boolean {
  return code !== null && code >= 200 && code < 300;
}

// ─── Shared table styles ──────────────────────────────────────────────────────

const TH: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--sp-text-40)',
  padding: '7px 8px',
  textAlign: 'left',
  borderBottom: '1px solid var(--sp-border-8)',
  whiteSpace: 'nowrap',
};

const TD: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--sp-text)',
  padding: '6px 8px',
  borderBottom: '1px solid var(--sp-border-5)',
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
};

// ─── Filter controls ─────────────────────────────────────────────────────────

const INPUT_BASE: React.CSSProperties = {
  padding: '7px 10px',
  borderRadius: 6,
  border: '1px solid var(--sp-border-8)',
  background: 'var(--sp-surface)',
  color: 'var(--sp-text)',
  fontSize: 12,
  outline: 'none',
  minHeight: 34,
};

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  token: string;
  knownProviders: string[];
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ApiEventsTable({ token, knownProviders }: Props) {
  // Filter state (uncommitted while editing, committed on Apply)
  const [draftProvider, setDraftProvider] = useState('');
  const [draftConsumerType, setDraftConsumerType] = useState('');
  const [draftSuccess, setDraftSuccess] = useState(''); // '' | 'true' | 'false'
  const [draftRateLimited, setDraftRateLimited] = useState(false);
  const [draftLimit, setDraftLimit] = useState(50);

  // Committed filters — drive the actual fetch
  const [filters, setFilters] = useState<EventsFilters>({ limit: 50 });

  const [events, setEvents] = useState<ApiUsageEventLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-fetch whenever committed filters change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchApiUsageEvents(token, filters)
      .then((r) => { if (!cancelled) { setEvents(r.events); setLoading(false); } })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Error');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [token, filters]);

  function applyFilters() {
    const f: EventsFilters = { limit: draftLimit };
    if (draftProvider) f.provider = draftProvider;
    if (draftConsumerType) f.consumerType = draftConsumerType;
    if (draftSuccess !== '') f.success = draftSuccess === 'true';
    if (draftRateLimited) f.rateLimited = true;
    setFilters(f);
  }

  // Determine if screen is narrow for hiding columns (>= 640 shows all)
  const isMobileView = typeof window !== 'undefined' && window.innerWidth < 640;

  return (
    <div>
      {/* ── Filter bar ── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'flex-end',
          marginBottom: 12,
        }}
      >
        {/* Provider select */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={{ fontSize: 10, color: 'var(--sp-text-40)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Provider
          </label>
          <select
            value={draftProvider}
            onChange={(e) => setDraftProvider(e.target.value)}
            style={INPUT_BASE}
          >
            <option value="">Todos</option>
            {knownProviders.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        {/* ConsumerType text */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={{ fontSize: 10, color: 'var(--sp-text-40)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            ConsumerType
          </label>
          <input
            type="text"
            placeholder="Todos"
            value={draftConsumerType}
            onChange={(e) => setDraftConsumerType(e.target.value)}
            style={{ ...INPUT_BASE, width: 130 }}
          />
        </div>

        {/* Success select */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={{ fontSize: 10, color: 'var(--sp-text-40)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Resultado
          </label>
          <select
            value={draftSuccess}
            onChange={(e) => setDraftSuccess(e.target.value)}
            style={INPUT_BASE}
          >
            <option value="">Todos</option>
            <option value="true">Solo exitosos</option>
            <option value="false">Solo errores</option>
          </select>
        </div>

        {/* Rate-limited checkbox */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            color: 'var(--sp-text)',
            cursor: 'pointer',
            minHeight: 34,
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={draftRateLimited}
            onChange={(e) => setDraftRateLimited(e.target.checked)}
            style={{ width: 14, height: 14, cursor: 'pointer' }}
          />
          Solo rate-limited
        </label>

        {/* Limit select */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={{ fontSize: 10, color: 'var(--sp-text-40)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Límite
          </label>
          <select
            value={draftLimit}
            onChange={(e) => setDraftLimit(Number(e.target.value))}
            style={INPUT_BASE}
          >
            {[10, 25, 50, 100, 200].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>

        {/* Apply button */}
        <button
          onClick={applyFilters}
          disabled={loading}
          style={{
            padding: '7px 18px',
            borderRadius: 6,
            border: 'none',
            background: 'var(--sp-primary)',
            color: '#fff',
            fontWeight: 700,
            fontSize: 13,
            cursor: loading ? 'not-allowed' : 'pointer',
            minHeight: 34,
            opacity: loading ? 0.7 : 1,
          }}
        >
          Aplicar
        </button>
      </div>

      {/* ── Status line ── */}
      {loading && (
        <div style={{ fontSize: 12, color: 'var(--sp-text-40)', marginBottom: 8 }}>Cargando eventos…</div>
      )}
      {error && (
        <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>Error: {error}</div>
      )}
      {!loading && events.length === 0 && !error && (
        <div style={{ fontSize: 12, color: 'var(--sp-text-40)', marginBottom: 8 }}>Sin eventos para los filtros aplicados.</div>
      )}

      {/* ── Table ── */}
      {events.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: isMobileView ? 380 : 700 }}>
            <thead>
              <tr>
                <th style={TH}>Timestamp</th>
                <th style={TH}>Provider</th>
                {!isMobileView && <th style={TH}>ConsumerType</th>}
                <th style={TH}>OperationKey</th>
                <th style={TH}>Status</th>
                <th style={TH}>Latencia</th>
                <th style={TH}>Units</th>
                {!isMobileView && <th style={TH}>Cache</th>}
                <th style={TH}>RL</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id} style={{ opacity: ev.rateLimited ? 0.9 : 1 }}>
                  <td style={TD}>{relativeTime(ev.startedAtUtc)}</td>
                  <td style={{ ...TD, fontSize: 11 }}>{ev.providerKey}</td>
                  {!isMobileView && <td style={{ ...TD, fontSize: 11 }}>{ev.consumerType}</td>}
                  <td style={{ ...TD, fontFamily: 'monospace', fontSize: 11 }}>
                    {truncate(ev.operationKey, 40)}
                  </td>
                  <td
                    style={{
                      ...TD,
                      fontWeight: 600,
                      color: is2xx(ev.statusCode) ? '#22c55e' : '#ef4444',
                    }}
                  >
                    {ev.statusCode ?? '—'}
                  </td>
                  <td style={TD}>{ev.latencyMs}ms</td>
                  <td style={TD}>{ev.usageUnits}</td>
                  {!isMobileView && (
                    <td style={{ ...TD, color: ev.cacheHit ? '#22c55e' : 'var(--sp-text-40)' }}>
                      {ev.cacheHit ? '✓' : '—'}
                    </td>
                  )}
                  <td style={TD}>
                    {ev.rateLimited ? (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '1px 5px',
                          borderRadius: 3,
                          background: '#ef444422',
                          color: '#ef4444',
                        }}
                      >
                        RL
                      </span>
                    ) : (
                      <span style={{ color: 'var(--sp-text-40)' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
