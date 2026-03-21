/**
 * ProviderSummaryGrid — grid of provider quota cards.
 * Styles: CSS-in-JS with sp-* variables (no Tailwind).
 */
import type { ProviderSummaryItem } from '../hooks/use-api-usage.js';

// ─── Warning level palette ────────────────────────────────────────────────────

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
  PROVIDER_REPORTED: 'var(--sp-status-success)',
  LEDGER_OBSERVED: 'var(--sp-status-warning)',
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

  // Monthly-quota providers (e.g. The Odds API: 20000 req/month)
  const isMonthly = (item.monthlyLimit ?? 0) > 0;

  // Use effectiveUsedUnits (provider-reported truth) when available; fall back to ledger observation.
  const displayUsed = isMonthly
    ? (item.monthlyUsed ?? item.usedUnitsObserved)
    : (item.effectiveUsedUnits ?? item.usedUnitsObserved);
  const activeLimit = isMonthly ? item.monthlyLimit : item.dailyLimit;
  const pct =
    activeLimit && activeLimit > 0
      ? Math.min(100, (displayUsed / activeLimit) * 100)
      : null;

  // Remaining: when exhausted, always show 0 — last_remote_remaining can be stale
  // (e.g. 7499 from the first call of the day, even though quota was later depleted).
  // Fix 4: isExhausted overrides any provider-reported or estimated value.
  const hasProviderRemaining = item.providerReportedRemaining !== null;
  const remainingValue = item.isExhausted
    ? 0
    : hasProviderRemaining
      ? item.providerReportedRemaining
      : (isMonthly && item.monthlyLimit
          ? Math.max(0, item.monthlyLimit - displayUsed)
          : item.estimatedRemaining);
  const remainingLabel = item.isExhausted
    ? 'restantes'
    : hasProviderRemaining ? 'restantes (provider)' : 'restantes (est.)';

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
      {activeLimit !== null ? (
        <>
          {/* Used / limit */}
          <div style={{ fontSize: 13, color: 'var(--sp-text-40)' }}>
            <span style={{ fontWeight: 600, color: 'var(--sp-text)' }}>
              {fmtNum(displayUsed)}
            </span>
            {' / '}
            {fmtNum(activeLimit)}
            {item.quotaWindowType === 'monthly'
              ? ' usadas este mes'
              : item.quotaWindowType === 'daily'
                ? ' usadas hoy'
                : isMonthly ? ' usadas este mes' : ' usadas'}
            {pct !== null && (
              <span style={{ marginLeft: 6, color, fontWeight: 600 }}>
                {pct.toFixed(0)}%
              </span>
            )}
            {/* "(parcial)" hint when data comes from ledger only — suppressed when exhausted
                because Fix A/B already reconcile rollup to dailyLimit in that case */}
            {dsKey === 'LEDGER_OBSERVED' && !item.isExhausted && (
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
      {/* Quota window footer — shows active window and timezone per provider */}
      {item.quotaWindowType === 'monthly' && (
        <div style={{ fontSize: 11, color: 'var(--sp-text-40)' }}>
          {(() => {
            const tz = item.quotaTimezone ?? 'UTC';
            const windowDate = item.currentWindowDate ?? '—';
            const now = new Date();
            // Compute next reset: first day of next month at 00:00 in the provider's timezone.
            // We approximate by computing in UTC and noting the timezone for the user.
            const nextReset = new Date(Date.UTC(
              now.getUTCMonth() === 11 ? now.getUTCFullYear() + 1 : now.getUTCFullYear(),
              now.getUTCMonth() === 11 ? 0 : now.getUTCMonth() + 1,
              1, 0, 0, 0,
            ));
            const daysLeft = Math.ceil((nextReset.getTime() - now.getTime()) / 86400000);
            const resetLabel = nextReset.toLocaleDateString('es-UY', {
              day: 'numeric', month: 'long', timeZone: tz,
            });
            return `Cuota mensual · ventana: ${windowDate} (${tz}) · reset el ${resetLabel} (en ${daysLeft}d)`;
          })()}
        </div>
      )}
      {item.quotaWindowType === 'daily' && (
        <div style={{ fontSize: 11, color: 'var(--sp-text-40)' }}>
          {`Cuota diaria · ${item.currentWindowDate ?? '—'} (${item.quotaTimezone ?? 'UTC'})`}
        </div>
      )}
      {/* Fallback for items without quotaWindowType (older API responses) */}
      {!item.quotaWindowType && isMonthly && (
        <div style={{ fontSize: 11, color: 'var(--sp-text-40)' }}>
          {(() => {
            const now = new Date();
            const nextReset = new Date(Date.UTC(
              now.getUTCMonth() === 11 ? now.getUTCFullYear() + 1 : now.getUTCFullYear(),
              now.getUTCMonth() === 11 ? 0 : now.getUTCMonth() + 1,
              1, 0, 0, 0,
            ));
            const daysLeft = Math.ceil((nextReset.getTime() - now.getTime()) / 86400000);
            const resetLabel = nextReset.toLocaleDateString('es-UY', {
              day: 'numeric', month: 'long', timeZone: 'UTC',
            });
            return `Cuota mensual · reset el ${resetLabel} (en ${daysLeft}d)`;
          })()}
        </div>
      )}

      {/* Blocked calls */}
      {(item.blockedToday ?? 0) > 0 && (
        <div style={{ fontSize: 12, color: 'var(--sp-status-live)', display: 'flex', gap: 5, alignItems: 'center' }}>
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
            padding: '1px 5px', borderRadius: 3,
            background: 'var(--sp-status-live-soft)', color: 'var(--sp-status-live)',
          }}>
            BLOQUEADAS
          </span>
          <span style={{ fontWeight: 600 }}>{fmtNum(item.blockedToday!)}</span>
          <span style={{ color: 'var(--sp-text-40)' }}>llamadas no llegaron a la API hoy</span>
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
