/**
 * PredictionExperimentalSection — Experimental prediction block for DetailPanel.
 *
 * Rendered ONLY when:
 *   - uiState === 'PRE_MATCH' (enforced by parent DetailPanel)
 *   - matchId and competitionId are defined
 *   - GET /api/ui/predictions/experimental returns 200
 *
 * Auto-hides silently on 404 or any fetch error (flag off, or no prediction available).
 * Implements AbortController cleanup to prevent race conditions on remount.
 */
import { useState, useEffect } from 'react';
import { MarketsPanel } from './MarketsPanel.js';
import type { MarketsData } from './MarketsPanel.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SignalsData {
  xg_used: boolean;
  xg_coverage: string | null;
  absence_applied: boolean;
  absence_count_home: number;
  absence_count_away: number;
  lineup_used_home: boolean;
  lineup_used_away: boolean;
  market_blend_applied: boolean;
  warnings: string[];
}

interface ExperimentalPrediction {
  match_id: string;
  competition_id: string;
  mode: string;
  calibration_mode: string | null;
  reasons: string[];
  p_home_win: number | null;
  p_draw: number | null;
  p_away_win: number | null;
  predicted_result: string | null;
  expected_goals_home: number | null;
  expected_goals_away: number | null;
  markets: MarketsData | null;
  generated_at: string;
  engine_version: string;
  signals: SignalsData | null;
}

interface PredictionExperimentalSectionProps {
  matchId: string | null | undefined;
  competitionId: string | undefined;
  homeTeamName: string;
  awayTeamName: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatGeneratedAt(iso: string): string {
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    return `${hh}:${mm} ${dd}/${mo}`;
  } catch {
    return iso;
  }
}

function formatPct(v: number | null): string {
  if (v == null) return '—';
  return `${Math.round(v * 100)}%`;
}

function formatXg(v: number | null): string {
  if (v == null) return '—';
  return v.toFixed(2);
}

function resolvePredictedResultLabel(
  predicted_result: string | null,
  homeTeamName: string,
  awayTeamName: string,
): string | null {
  if (!predicted_result) return null;
  if (predicted_result === 'HOME') return homeTeamName;
  if (predicted_result === 'AWAY') return awayTeamName;
  if (predicted_result === 'DRAW') return 'Empate';
  if (predicted_result === 'TOO_CLOSE') return 'Muy parejo';
  return null;
}

// ── Styles (inline — experimental section, not using Tailwind) ────────────────

const cardStyle: React.CSSProperties = {
  backgroundColor: 'var(--sp-surface-card)',
  borderRadius: 12,
  padding: '12px 14px',
  marginBottom: 12,
  border: '1px solid var(--sp-border-8)',
};

const headerRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 10,
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.07em',
  color: 'var(--sp-text-50)',
};

const experimentalBadgeStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: '#fff',
  backgroundColor: 'var(--sp-status-live)',
  borderRadius: 4,
  padding: '2px 6px',
  lineHeight: 1.4,
};

const warningBoxStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--sp-text-55)',
  backgroundColor: 'var(--sp-status-warning-soft)',
  border: '1px solid rgba(245,158,11,0.22)', /* warning border alpha — no exact token */
  borderRadius: 8,
  padding: '8px 10px',
  marginBottom: 8,
};

const reasonsStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--sp-text-40)',
  marginTop: 4,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '4px 0',
  borderBottom: '1px solid var(--sp-border-5)',
};

const rowLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--sp-text-50)',
  flex: '0 0 auto',
};

const rowValueStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--sp-text-88)',
  textAlign: 'right' as const,
};

const footerStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 11,
  color: 'var(--sp-text-40)',
};

// ── SignalsPanel ───────────────────────────────────────────────────────────────

interface SignalChipProps {
  label: string;
  active: boolean;
  detail?: string | null;
}

function SignalChip({ label, active, detail }: SignalChipProps) {
  const chipStyle: React.CSSProperties = {
    borderRadius: 6,
    padding: '4px 8px',
    fontSize: 11,
    fontWeight: 600,
    backgroundColor: active ? 'var(--sp-status-success-soft)' : 'var(--sp-surface-raised)',
    color: active ? 'var(--sp-text-88)' : 'var(--sp-text-50)',
    whiteSpace: 'nowrap' as const,
  };

  const text = active
    ? `${label} ✓${detail ? ` (${detail})` : ''}`
    : `${label} — sin datos`;

  return <span style={chipStyle}>{text}</span>;
}

function SignalsPanel({ signals }: { signals: SignalsData }) {
  const absenceDetail =
    signals.absence_applied &&
    (signals.absence_count_home > 0 || signals.absence_count_away > 0)
      ? `${signals.absence_count_home}+${signals.absence_count_away}`
      : null;

  const lineupActive = signals.lineup_used_home || signals.lineup_used_away;

  const hasPartialCoverage = signals.warnings.includes('XG_PARTIAL_COVERAGE');
  const hasLimitedData =
    signals.warnings.includes('NO_PRIOR') || signals.warnings.includes('FALLBACK_BASELINE');

  const panelStyle: React.CSSProperties = {
    marginTop: 10,
    marginBottom: 4,
  };

  const gridStyle: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  };

  const partialNoteStyle: React.CSSProperties = {
    fontSize: 10,
    color: 'var(--sp-text-40)',
    marginTop: 4,
  };

  const limitedNoteStyle: React.CSSProperties = {
    fontSize: 10,
    color: 'var(--sp-status-warning)',
    marginTop: 6,
  };

  return (
    <div style={panelStyle}>
      <span style={sectionLabelStyle}>Señales activas</span>
      <div style={gridStyle}>
        <SignalChip
          label="xG histórico"
          active={signals.xg_used}
          detail={signals.xg_coverage}
        />
        {hasPartialCoverage && (
          <div style={{ ...partialNoteStyle, flexBasis: '100%' }}>Cobertura parcial</div>
        )}
        <SignalChip
          label="Lesionados/Bajas"
          active={signals.absence_applied}
          detail={absenceDetail}
        />
        <SignalChip label="Alineación" active={lineupActive} />
        <SignalChip label="Cuotas" active={signals.market_blend_applied} />
      </div>
      {hasLimitedData && (
        <div style={limitedNoteStyle}>Motor usando datos limitados</div>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PredictionExperimentalSection({
  matchId,
  competitionId,
  homeTeamName,
  awayTeamName,
}: PredictionExperimentalSectionProps) {
  const [data, setData] = useState<ExperimentalPrediction | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!matchId || !competitionId) return;

    const controller = new AbortController();

    fetch(
      `/api/ui/predictions/experimental?matchId=${encodeURIComponent(matchId)}&competitionId=${encodeURIComponent(competitionId)}`,
      { signal: controller.signal },
    )
      .then((res) => {
        if (res.status === 404) return null; // Feature not enabled for this competition — expected, no noise
        if (!res.ok) return null;
        return res.json() as Promise<ExperimentalPrediction>;
      })
      .then((json) => {
        if (controller.signal.aborted) return;
        if (json) {
          setData(json);
          setVisible(true);
        }
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        // Any error → silent hide
      });

    return () => {
      controller.abort();
    };
  }, [matchId, competitionId]);

  if (!visible || !data) return null;

  const isNotEligible = data.mode === 'NOT_ELIGIBLE';
  const isLimited = data.mode === 'LIMITED_MODE';

  const predictedLabel = resolvePredictedResultLabel(
    data.predicted_result,
    homeTeamName,
    awayTeamName,
  );

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div style={headerRowStyle}>
        <span style={sectionLabelStyle}>Pronostico del motor</span>
        <span style={experimentalBadgeStyle}>experimental</span>
      </div>

      {/* NOT_ELIGIBLE — no outputs */}
      {isNotEligible && (
        <div style={warningBoxStyle}>
          <div>Sin datos suficientes para este partido</div>
          {data.reasons.length > 0 && (
            <div style={reasonsStyle}>{data.reasons.join(' · ')}</div>
          )}
        </div>
      )}

      {/* LIMITED_MODE — degraded warning, but show available fields */}
      {isLimited && (
        <div style={warningBoxStyle}>
          Modo limitado — datos historicos insuficientes
        </div>
      )}

      {/* Markets panel — incluye 1X2, resultado esperado, xG y mercados */}
      {!isNotEligible && data.markets && (
        <MarketsPanel
          markets={data.markets}
          homeTeamName={homeTeamName}
          awayTeamName={awayTeamName}
        />
      )}

      {/* Signals panel (V3 only) */}
      {!isNotEligible && data.signals && (
        <SignalsPanel signals={data.signals} />
      )}

      {/* Footer */}
      <div style={footerStyle}>
        Motor v{data.engine_version} · {formatGeneratedAt(data.generated_at)}
      </div>
    </div>
  );
}
