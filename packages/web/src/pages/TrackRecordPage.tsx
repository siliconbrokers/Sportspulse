// SPF-TR-001 + SPF-TR-002 — Public Track Record page.
// Acceptance: K-03
// Public route — no auth gate.
// Mobile-first with Tailwind CSS. CSS custom properties (var(--sp-*)) are allowed inline.

import { useState } from 'react';
import { useCompetitions } from '../contexts/CompetitionContext.js';
import { useTrackRecord } from '../hooks/use-track-record.js';
import { getCompMeta } from '../utils/competition-meta.js';

// ── Disclosure messages (SPF-TR-002) ─────────────────────────────────────────

const DISCLOSURE_MESSAGES: Record<string, string> = {
  historical_walk_forward_disclosure:
    'Los resultados mostrados provienen de una evaluación walk-forward histórica, no de predicciones operacionales en producción.',
};

function getDisclosureMessage(key: string): string {
  return DISCLOSURE_MESSAGES[key] ?? key;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div
      className="flex flex-col items-center gap-4 py-16"
      data-testid="track-record-loading"
    >
      <div
        className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: 'var(--sp-text-40)', borderTopColor: 'transparent' }}
      />
      <p className="text-sm" style={{ color: 'var(--sp-text-40)' }}>
        Cargando historial...
      </p>
    </div>
  );
}

function DisclosureNotice({ messageKey }: { messageKey: string }) {
  const message = getDisclosureMessage(messageKey);
  return (
    <div
      className="mt-6 rounded-lg px-4 py-3 text-sm leading-relaxed"
      style={{
        backgroundColor: 'rgba(251,191,36,0.08)',
        border: '1px solid rgba(251,191,36,0.25)',
        color: 'var(--sp-text-60)',
      }}
      data-testid="disclosure-notice"
    >
      <span className="font-medium mr-1" style={{ color: 'var(--sp-text-80)' }}>
        Nota:
      </span>
      {message}
    </div>
  );
}

function StateAvailable({
  accuracy,
  totalPredictions,
  evaluationType,
  disclosureMessageKey,
}: {
  accuracy: number;
  totalPredictions: number | null;
  evaluationType: string | null;
  disclosureMessageKey: string | null;
}) {
  const pct = (accuracy * 100).toFixed(1) + '%';
  return (
    <div className="flex flex-col items-center text-center" data-testid="state-available">
      <p
        className="text-sm font-medium uppercase tracking-widest mb-2"
        style={{ color: 'var(--sp-text-40)' }}
      >
        Precisión predictiva
      </p>
      <p
        className="text-6xl sm:text-7xl font-bold tabular-nums"
        style={{ color: 'var(--sp-text-80)' }}
        data-testid="accuracy-value"
      >
        {pct}
      </p>
      {totalPredictions !== null && (
        <p className="mt-4 text-sm" style={{ color: 'var(--sp-text-40)' }}>
          Basado en{' '}
          <span style={{ color: 'var(--sp-text-60)' }}>
            {totalPredictions.toLocaleString()}
          </span>{' '}
          predicciones resueltas
        </p>
      )}
      {disclosureMessageKey && (
        <DisclosureNotice messageKey={disclosureMessageKey} />
      )}
    </div>
  );
}

function StateBelowThreshold({
  totalPredictions,
  thresholdRequired,
}: {
  totalPredictions: number | null;
  thresholdRequired: number;
}) {
  return (
    <div className="flex flex-col items-center text-center" data-testid="state-below-threshold">
      <p
        className="text-xl font-semibold"
        style={{ color: 'var(--sp-text-80)' }}
      >
        Datos insuficientes
      </p>
      <p className="mt-3 text-sm leading-relaxed max-w-sm" style={{ color: 'var(--sp-text-40)' }}>
        Tenemos{' '}
        <span style={{ color: 'var(--sp-text-60)' }}>
          {totalPredictions ?? 0} / {thresholdRequired}
        </span>{' '}
        predicciones registradas.
        <br />
        El historial se publicará cuando se alcance el umbral mínimo.
      </p>
    </div>
  );
}

function StateUnavailable() {
  return (
    <div className="flex flex-col items-center text-center" data-testid="state-unavailable">
      <p
        className="text-xl font-semibold"
        style={{ color: 'var(--sp-text-80)' }}
      >
        Sin historial disponible
      </p>
      <p className="mt-3 text-sm" style={{ color: 'var(--sp-text-40)' }}>
        No hay datos de predicciones para esta competición.
      </p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function TrackRecordPage() {
  const { competitions, enabledIds } = useCompetitions();

  const enabledCompetitions = competitions.filter((c) => enabledIds.includes(c.id));
  const defaultId = enabledCompetitions.length > 0 ? enabledCompetitions[0].id : null;

  const [selectedId, setSelectedId] = useState<string | null>(defaultId);

  const activeId = selectedId ?? defaultId;
  const { data, loading, error } = useTrackRecord(activeId);

  const selectedMeta = activeId ? getCompMeta(activeId) : undefined;
  const displayName = selectedMeta?.name ?? activeId ?? 'Competición';

  return (
    <div
      className="min-h-screen w-full"
      style={{ backgroundColor: 'var(--sp-bg)' }}
      data-testid="track-record-page"
    >
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-16">

        {/* Page header */}
        <h1
          className="text-2xl sm:text-3xl font-bold tracking-tight mb-8"
          style={{ color: 'var(--sp-text-80)' }}
        >
          Historial de predicciones
        </h1>

        {/* Competition selector */}
        {enabledCompetitions.length > 1 && (
          <div className="mb-8">
            <label
              htmlFor="comp-selector"
              className="block text-xs font-medium uppercase tracking-wider mb-2"
              style={{ color: 'var(--sp-text-40)' }}
            >
              Competición
            </label>
            <select
              id="comp-selector"
              value={activeId ?? ''}
              onChange={(e) => setSelectedId(e.target.value || null)}
              className="w-full sm:w-auto rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{
                backgroundColor: 'var(--sp-surface)',
                color: 'var(--sp-text-80)',
                border: '1px solid var(--sp-border)',
                minHeight: 44,
              }}
              data-testid="competition-selector"
            >
              {enabledCompetitions.map((c) => {
                const meta = getCompMeta(c.id);
                return (
                  <option key={c.id} value={c.id}>
                    {meta?.name ?? c.id}
                  </option>
                );
              })}
            </select>
          </div>
        )}

        {/* Competition name heading */}
        <p
          className="text-base font-semibold mb-8"
          style={{ color: 'var(--sp-text-60)' }}
          data-testid="competition-name"
        >
          {displayName}
        </p>

        {/* Content area */}
        <div
          className="rounded-2xl p-8 sm:p-12"
          style={{
            backgroundColor: 'var(--sp-surface)',
            border: '1px solid var(--sp-border)',
          }}
        >
          {loading && <LoadingSpinner />}

          {!loading && error && (
            <div
              className="text-sm text-center py-8"
              style={{ color: 'var(--sp-text-40)' }}
              data-testid="track-record-error"
            >
              No se pudo cargar el historial. Intenta nuevamente más tarde.
            </div>
          )}

          {!loading && !error && data && (
            <>
              {data.state === 'available' && data.accuracy !== null && (
                <StateAvailable
                  accuracy={data.accuracy}
                  totalPredictions={data.totalPredictions}
                  evaluationType={data.evaluationType}
                  disclosureMessageKey={data.disclosureMessageKey}
                />
              )}
              {data.state === 'below_threshold' && (
                <StateBelowThreshold
                  totalPredictions={data.totalPredictions}
                  thresholdRequired={data.thresholdRequired}
                />
              )}
              {data.state === 'unavailable' && <StateUnavailable />}
            </>
          )}

          {!loading && !error && !data && activeId && (
            <StateUnavailable />
          )}

          {!activeId && (
            <p
              className="text-sm text-center py-8"
              style={{ color: 'var(--sp-text-40)' }}
            >
              No hay competiciones disponibles.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
