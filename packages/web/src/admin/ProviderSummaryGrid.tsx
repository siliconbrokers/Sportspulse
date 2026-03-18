/**
 * ProviderSummaryGrid — grid of provider quota cards.
 * Styles: CSS-in-JS with sp-* variables (no Tailwind).
 */
import type { ProviderSummaryItem } from '../hooks/use-api-usage.js';

// ─── Warning level palette ────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(utc: string | null): string {
  if (!utc) return '—';
  const diff = Date.now() - new Date(utc).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `hace ${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  return `hace ${hrs}h`;
}

function fmtNum(n: number): string {
  return n.toLocaleString('es-UY');
}

// ─── Single card ─────────────────────────────────────────────────────────────

// ─── dataSource badge config ──────────────────────────────────────────────────

const DATA_SOURCE_DOT: Record<string, string> = {
  PROVIDER_REPORTED: '#22c55e',
  LEDGER_OBSERVED: '#eab308',
};

const DATA_SOURCE_LABEL: Record<string, string> = {
  PROVIDER_REPORTED: 'provider',
  LEDGER_OBSERVED: 'ledger',
};

// ─── Single card ─────────────────────────────────────────────────────────────

function ProviderCard({
  item,
  selected,
  onSelect,
}: {
  item: ProviderSummaryItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const color = LEVEL_COLOR[item.warningLevel] ?? '#22c55e';

  // Use effectiveUsedUnits (provider-reported truth) when available; fall back to ledger observation.
  const displayUsed = item.effectiveUsedUnits ?? item.usedUnitsObserved;
  const pct =
    item.dailyLimit && item.dailyLimit > 0
      ? Math.min(100, (displayUsed / item.dailyLimit) * 100)
      : null;

  // Remaining: prefer provider-reported value when available.
  const hasProviderRemaining = item.providerReportedRemaining !== null;
  const remainingValue = hasProviderRemaining
    ? item.providerReportedRemaining
    : item.estimatedRemaining;
  const remainingLabel = hasProviderRemaining ? 'restantes (provider)' : 'restantes (est.)';

  const dsKey = item.dataSource ?? null;

  return (
    <div
      onClick={onSelect}
      style={{
        background: 'var(--sp-surface)',
        border: selected
          ? '2px solid var(--sp-primary)'
          : '1px solid var(--sp-border-8)',
        borderRadius: 10,
        padding: '16px 18px',
        cursor: 'pointer',
        transition: 'border-color 0.15s ease',
        minHeight: 140,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--sp-text)' }}>
            {item.displayName}
          </span>
          {/* dataSource badge */}
          {dsKey && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: DATA_SOURCE_DOT[dsKey] ?? 'var(--sp-text-40)',
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 10, color: 'var(--sp-text-40)' }}>
                {DATA_SOURCE_LABEL[dsKey] ?? dsKey}
              </span>
            </span>
          )}
        </div>
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
          {item.warningLevel}
        </span>
      </div>

      {/* Usage figures */}
      {item.dailyLimit !== null ? (
        <>
          {/* Used / limit */}
          <div style={{ fontSize: 13, color: 'var(--sp-text-40)' }}>
            <span style={{ fontWeight: 600, color: 'var(--sp-text)' }}>
              {fmtNum(displayUsed)}
            </span>
            {' / '}
            {fmtNum(item.dailyLimit)}
            {' usadas'}
            {pct !== null && (
              <span style={{ marginLeft: 6, color, fontWeight: 600 }}>
                {pct.toFixed(0)}%
              </span>
            )}
            {/* "(parcial)" hint when data comes from ledger only */}
            {dsKey === 'LEDGER_OBSERVED' && (
              <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--sp-text-40)' }}>
                (parcial)
              </span>
            )}
          </div>

          {/* Progress bar */}
          {pct !== null && (
            <div
              style={{
                height: 6,
                borderRadius: 3,
                background: 'var(--sp-border-8)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${pct}%`,
                  background: color,
                  borderRadius: 3,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          )}

          {/* Remaining — provider-reported preferred */}
          <div style={{ fontSize: 12, color: 'var(--sp-text-40)' }}>
            <span style={{ color: 'var(--sp-text)' }}>
              {remainingValue !== null ? fmtNum(remainingValue) : '—'}
            </span>
            {' '}
            {remainingLabel}
          </div>

          {/* Discrepancy badge (shown alongside provider-reported) */}
          <div style={{ fontSize: 12, color: 'var(--sp-text-40)', display: 'flex', gap: 6, alignItems: 'center' }}>
            Discrepancia:
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '1px 5px',
                borderRadius: 3,
                background: (DISCREPANCY_COLOR[item.discrepancyStatus] ?? 'var(--sp-text-40)') + '22',
                color: DISCREPANCY_COLOR[item.discrepancyStatus] ?? 'var(--sp-text-40)',
              }}
            >
              {item.discrepancyStatus}
            </span>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--sp-text-40)', fontStyle: 'italic' }}>
          Sin límite configurado — {fmtNum(displayUsed)} unidades usadas
        </div>
      )}

      {/* Last seen */}
      <div style={{ fontSize: 11, color: 'var(--sp-text-40)', marginTop: 'auto' }}>
        Último evento: {relativeTime(item.lastSeenAtUtc)}
      </div>
    </div>
  );
}

// ─── Grid ─────────────────────────────────────────────────────────────────────

interface Props {
  providers: ProviderSummaryItem[];
  selectedProvider: string | null;
  onSelectProvider: (key: string) => void;
  loading: boolean;
}

export function ProviderSummaryGrid({ providers, selectedProvider, onSelectProvider, loading }: Props) {
  if (loading && providers.length === 0) {
    return (
      <div style={{ color: 'var(--sp-text-40)', fontSize: 13, padding: '24px 0' }}>
        Cargando resumen de providers…
      </div>
    );
  }

  if (!loading && providers.length === 0) {
    return (
      <div style={{ color: 'var(--sp-text-40)', fontSize: 13, padding: '24px 0' }}>
        Sin datos de providers para hoy.
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 14,
      }}
    >
      {providers.map((p) => (
        <ProviderCard
          key={p.providerKey}
          item={p}
          selected={selectedProvider === p.providerKey}
          onSelect={() => onSelectProvider(p.providerKey)}
        />
      ))}
    </div>
  );
}
