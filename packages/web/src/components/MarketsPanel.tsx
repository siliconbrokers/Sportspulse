/**
 * MarketsPanel — Bloque de mercados derivados del Motor Predictivo V3.
 *
 * Muestra: O/U 2.5, BTTS, Double Chance (1X/X2), Expected Goals y Top Scorelines.
 * Diseño compacto, reutilizable en DetailPanel y PronosticoCard.
 * Mobile-first, sin Tailwind (inline styles para consistencia con PredictionExperimentalSection).
 */

// ── Types (espejo del endpoint) ────────────────────────────────────────────────

export interface OverUnderMarketsData {
  over_0_5: number; under_0_5: number;
  over_1_5: number; under_1_5: number;
  over_2_5: number; under_2_5: number;
  over_3_5: number; under_3_5: number;
  over_4_5: number; under_4_5: number;
}

export interface BTTSMarketData { yes: number; no: number; }

export interface DoubleChanceData {
  home_or_draw: number; draw_or_away: number; home_or_away: number;
}

export interface DNBData { home: number; away: number; }

export interface AsianHandicapData {
  home_minus_half: number; home_plus_half: number;
  away_minus_half: number; away_plus_half: number;
}

export interface ExpectedGoalsData {
  home: number; away: number; total: number; implied_goal_line: number;
}

export interface TopScorelineData { home: number; away: number; probability: number; }

export interface MarketsData {
  over_under: OverUnderMarketsData;
  btts: BTTSMarketData;
  double_chance: DoubleChanceData;
  dnb: DNBData;
  asian_handicap: AsianHandicapData;
  expected_goals: ExpectedGoalsData;
  top_scorelines: TopScorelineData[];
}

interface MarketsPanelProps {
  markets: MarketsData;
  homeTeamName: string;
  awayTeamName: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function xg(v: number): string {
  return v.toFixed(2);
}

// ── Sub-components ─────────────────────────────────────────────────────────────

/** Barra dual para un mercado binario (ej: Over / Under) */
function DualBar({
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
  highlight = 'left',
}: {
  leftLabel: string;
  leftValue: number;
  rightLabel: string;
  rightValue: number;
  highlight?: 'left' | 'right' | 'none';
}) {
  const leftPct = Math.round(leftValue * 100);
  const rightPct = Math.round(rightValue * 100);
  const isLeftHigher = leftValue >= rightValue;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
      {/* Left label */}
      <span style={{
        fontSize: 12,
        width: 56,
        textAlign: 'right' as const,
        color: highlight === 'left' && isLeftHigher
          ? 'var(--sp-text-primary, #f9fafb)'
          : 'var(--sp-text-35, #9ca3af)',
        fontWeight: isLeftHigher ? 600 : 400,
        flexShrink: 0,
      }}>
        {leftLabel}
      </span>

      {/* Bar */}
      <div style={{
        flex: 1,
        height: 4,
        borderRadius: 2,
        backgroundColor: 'rgba(255,255,255,0.08)',
        overflow: 'hidden',
        position: 'relative',
      }}>
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          height: '100%',
          width: `${leftPct}%`,
          backgroundColor: isLeftHigher ? '#3b82f6' : 'rgba(255,255,255,0.25)',
          borderRadius: 2,
          transition: 'width 0.3s ease',
        }} />
      </div>

      {/* Right label */}
      <span style={{
        fontSize: 12,
        width: 56,
        textAlign: 'left' as const,
        color: highlight === 'right' && !isLeftHigher
          ? 'var(--sp-text-primary, #f9fafb)'
          : 'var(--sp-text-35, #9ca3af)',
        fontWeight: !isLeftHigher ? 600 : 400,
        flexShrink: 0,
      }}>
        {rightLabel}
      </span>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function MarketsPanel({ markets, homeTeamName, awayTeamName }: MarketsPanelProps) {
  const { over_under: ou, btts, double_chance: dc, expected_goals: xgData, top_scorelines: scorelines } = markets;

  // Nombre corto para barras (máx ~10 chars)
  const homeShort = homeTeamName.length > 10 ? homeTeamName.slice(0, 9) + '…' : homeTeamName;
  const awayShort = awayTeamName.length > 10 ? awayTeamName.slice(0, 9) + '…' : awayTeamName;

  return (
    <div style={{
      backgroundColor: 'var(--sp-surface-2, rgba(255,255,255,0.04))',
      borderRadius: 12,
      padding: '12px 14px',
      marginBottom: 12,
      border: '1px solid rgba(255,255,255,0.08)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.07em',
          color: 'var(--sp-text-35, #9ca3af)',
        }}>
          Mercados
        </span>
      </div>

      {/* ── O/U 2.5 y BTTS ─────────────────────────────── */}
      <div style={{ marginBottom: 8 }}>
        <DualBar
          leftLabel={`Over ${pct(ou.over_2_5)}`}
          leftValue={ou.over_2_5}
          rightLabel={`Under ${pct(ou.under_2_5)}`}
          rightValue={ou.under_2_5}
          highlight="left"
        />
        <DualBar
          leftLabel={`BTTS ${pct(btts.yes)}`}
          leftValue={btts.yes}
          rightLabel={`No ${pct(btts.no)}`}
          rightValue={btts.no}
          highlight="left"
        />
        <DualBar
          leftLabel={`1X ${pct(dc.home_or_draw)}`}
          leftValue={dc.home_or_draw}
          rightLabel={`X2 ${pct(dc.draw_or_away)}`}
          rightValue={dc.draw_or_away}
          highlight="none"
        />
      </div>

      {/* ── Expected Goals ──────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 0',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        marginBottom: 8,
      }}>
        <span style={{ fontSize: 11, color: 'var(--sp-text-35, #9ca3af)' }}>Goles esperados</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sp-text-primary, #f9fafb)' }}>
          {homeShort} {xg(xgData.home)} · {xg(xgData.away)} {awayShort}
        </span>
      </div>

      {/* ── Top Scorelines ──────────────────────────────── */}
      {scorelines.length > 0 && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--sp-text-35, #9ca3af)', marginBottom: 5 }}>
            Marcadores más probables
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 8px' }}>
            {scorelines.slice(0, 5).map((s, i) => (
              <span
                key={i}
                style={{
                  fontSize: 12,
                  fontWeight: i === 0 ? 700 : 500,
                  color: i === 0
                    ? 'var(--sp-text-primary, #f9fafb)'
                    : 'var(--sp-text-50, #6b7280)',
                  whiteSpace: 'nowrap',
                }}
              >
                {s.home}-{s.away}
                <span style={{ fontSize: 10, color: 'var(--sp-text-35, #9ca3af)', marginLeft: 2 }}>
                  {pct(s.probability)}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
