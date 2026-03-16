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
  backgroundColor: 'var(--sp-surface-2, rgba(255,255,255,0.04))',
  borderRadius: 12,
  padding: '12px 14px',
  marginBottom: 12,
  border: '1px solid rgba(255,255,255,0.08)',
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
  color: 'var(--sp-text-35, #9ca3af)',
};

const experimentalBadgeStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: '#fff',
  backgroundColor: '#f97316',
  borderRadius: 4,
  padding: '2px 6px',
  lineHeight: 1.4,
};

const warningBoxStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--sp-text-50, #6b7280)',
  backgroundColor: 'rgba(245,158,11,0.08)',
  border: '1px solid rgba(245,158,11,0.18)',
  borderRadius: 8,
  padding: '8px 10px',
  marginBottom: 8,
};

const reasonsStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--sp-text-35, #9ca3af)',
  marginTop: 4,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '4px 0',
  borderBottom: '1px solid rgba(255,255,255,0.05)',
};

const rowLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--sp-text-35, #9ca3af)',
  flex: '0 0 auto',
};

const rowValueStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--sp-text-primary, #f9fafb)',
  textAlign: 'right' as const,
};

const footerStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 11,
  color: 'var(--sp-text-35, #9ca3af)',
};

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

  const hasProbs =
    data.p_home_win != null && data.p_draw != null && data.p_away_win != null;
  const hasXg = data.expected_goals_home != null && data.expected_goals_away != null;

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

      {/* Outputs — only when not NOT_ELIGIBLE */}
      {!isNotEligible && (
        <div>
          {/* Resultado esperado */}
          {predictedLabel && (
            <div style={rowStyle}>
              <span style={rowLabelStyle}>Resultado esperado</span>
              <span style={rowValueStyle}>{predictedLabel}</span>
            </div>
          )}

          {/* 1X2 probabilities */}
          {hasProbs && (
            <div style={rowStyle}>
              <span style={rowLabelStyle}>1X2</span>
              <span style={rowValueStyle}>
                Local {formatPct(data.p_home_win)} — Empate {formatPct(data.p_draw)} — Visita {formatPct(data.p_away_win)}
              </span>
            </div>
          )}

          {/* Expected goals */}
          {hasXg && (
            <div style={{ ...rowStyle, borderBottom: 'none' }}>
              <span style={rowLabelStyle}>xG</span>
              <span style={rowValueStyle}>
                xG Local: {formatXg(data.expected_goals_home)} — xG Visita: {formatXg(data.expected_goals_away)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Markets panel (V3 only — null when not available) */}
      {!isNotEligible && data.markets && (
        <MarketsPanel
          markets={data.markets}
          homeTeamName={homeTeamName}
          awayTeamName={awayTeamName}
        />
      )}

      {/* Footer */}
      <div style={footerStyle}>
        Motor v{data.engine_version} · {formatGeneratedAt(data.generated_at)}
      </div>
    </div>
  );
}
