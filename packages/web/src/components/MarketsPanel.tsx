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
  probHome?: number | null;
  probDraw?: number | null;
  probAway?: number | null;
  predictedResult?: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function xg(v: number): string {
  return v.toFixed(2);
}

// ── Sub-components ─────────────────────────────────────────────────────────────

/** Fila de par de mercados: etiqueta izq · % izq · barra dual · % der · etiqueta der */
function MarketPairRow({
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
}: {
  leftLabel: string;
  leftValue: number;
  rightLabel: string;
  rightValue: number;
}) {
  const leftPct  = Math.round(leftValue * 100);
  const rightPct = Math.round(rightValue * 100);
  const leftWins = leftValue >= rightValue;
  // Color: el lado ganador es verde, el perdedor rojo
  const leftColor  = leftWins  ? '#16a34a' : '#dc2626';
  const rightColor = !leftWins ? '#16a34a' : '#dc2626';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
      {/* Etiqueta izquierda */}
      <span style={{
        fontSize: 11, flexShrink: 0, whiteSpace: 'nowrap' as const,
        color: 'var(--sp-text-88)', fontWeight: 600,
      }}>
        {leftLabel}
      </span>
      {/* % izquierdo */}
      <span style={{
        fontSize: 11, flexShrink: 0, width: 28, textAlign: 'right' as const,
        fontVariantNumeric: 'tabular-nums',
        color: leftWins ? 'var(--sp-text-88)' : 'var(--sp-text-50)',
        fontWeight: 400,
      }}>
        {leftPct}%
      </span>
      {/* Barra dual */}
      <div style={{
        flex: 1, minWidth: 0, height: 6, borderRadius: 3,
        backgroundColor: rightColor,
        overflow: 'hidden', position: 'relative',
      }}>
        <div style={{
          position: 'absolute', left: 0, top: 0,
          height: '100%', width: `${leftPct}%`,
          backgroundColor: leftColor,
          transition: 'width 0.3s ease',
        }} />
      </div>
      {/* % derecho */}
      <span style={{
        fontSize: 11, flexShrink: 0, width: 28, textAlign: 'left' as const,
        fontVariantNumeric: 'tabular-nums',
        color: !leftWins ? 'var(--sp-text-88)' : 'var(--sp-text-50)',
        fontWeight: 400,
      }}>
        {rightPct}%
      </span>
      {/* Etiqueta derecha */}
      <span style={{
        fontSize: 11, flexShrink: 0, whiteSpace: 'nowrap' as const,
        color: 'var(--sp-text-88)', fontWeight: 600,
      }}>
        {rightLabel}
      </span>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function MarketsPanel({ markets, homeTeamName, awayTeamName, probHome, probDraw, probAway, predictedResult }: MarketsPanelProps) {
  const { over_under: ou, btts, double_chance: dc, dnb, expected_goals: xgData, top_scorelines: scorelines } = markets;

  return (
    <div style={{
      backgroundColor: 'var(--sp-surface-card)',
      borderRadius: 12,
      padding: '12px 14px',
      marginBottom: 12,
      border: '1px solid var(--sp-border-8)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.07em',
          color: 'var(--sp-text-50)',
        }}>
          Mercados
        </span>
      </div>

      {/* ── 1X2 ─────────────────────────────────────────── */}
      {probHome != null && probDraw != null && probAway != null && (
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          padding: '4px 0 8px',
          borderBottom: '1px solid var(--sp-border-6)',
          marginBottom: 8,
        }}>
          {[
            { label: 'Local (1)', value: probHome },
            { label: 'Empate (X)', value: probDraw },
            { label: 'Visita (2)', value: probAway },
          ].map(({ label, value }) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
              <span style={{ fontSize: 10, color: 'var(--sp-text-50)', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em' }}>
                {label}
              </span>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--sp-text-88)', fontVariantNumeric: 'tabular-nums' }}>
                {Math.round(value * 100)}%
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── O/U 2.5, BTTS, Double Chance ───────────────── */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sp-text-50)', marginBottom: 2, textAlign: 'center' as const }}>Over / Under 2.5</div>
        <MarketPairRow leftLabel="Over"   leftValue={ou.over_2_5}      rightLabel="Under" rightValue={ou.under_2_5} />
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sp-text-50)', marginBottom: 2, textAlign: 'center' as const }}>Anotan ambos equipos</div>
        <MarketPairRow leftLabel="Sí" leftValue={btts.yes} rightLabel="No" rightValue={btts.no} />
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sp-text-50)', marginBottom: 2, textAlign: 'center' as const }}>Sin Empate (DNB)</div>
        <MarketPairRow leftLabel="Local" leftValue={dnb.home} rightLabel="Visita" rightValue={dnb.away} />
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sp-text-50)', marginBottom: 2, textAlign: 'center' as const }}>Ganador o Empate</div>
        {/* Double Chance — sin barra, dos columnas */}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--sp-text-88)', whiteSpace: 'nowrap' as const }}>
            1X <span style={{ fontWeight: 400, color: 'var(--sp-text-70)', fontVariantNumeric: 'tabular-nums' }}>{Math.round(dc.home_or_draw * 100)}%</span>
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--sp-text-88)', whiteSpace: 'nowrap' as const }}>
            X2 <span style={{ fontWeight: 400, color: 'var(--sp-text-70)', fontVariantNumeric: 'tabular-nums' }}>{Math.round(dc.draw_or_away * 100)}%</span>
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--sp-text-88)', whiteSpace: 'nowrap' as const }}>
            12 <span style={{ fontWeight: 400, color: 'var(--sp-text-70)', fontVariantNumeric: 'tabular-nums' }}>{Math.round(dc.home_or_away * 100)}%</span>
          </span>
        </div>
      </div>

      {/* ── Expected Goals ──────────────────────────────── */}
      <div style={{ borderTop: '1px solid var(--sp-border-6)', padding: '6px 0', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: 'var(--sp-text-50)', display: 'block', marginBottom: 4 }}>
          Goles esperados
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--sp-text-70)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0, marginRight: 8 }}>
              {homeTeamName}
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sp-text-88)', flexShrink: 0 }}>
              {xg(xgData.home)}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--sp-text-70)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0, marginRight: 8 }}>
              {awayTeamName}
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sp-text-88)', flexShrink: 0 }}>
              {xg(xgData.away)}
            </span>
          </div>
        </div>
      </div>

      {/* ── Top Scorelines ──────────────────────────────── */}
      {scorelines.length > 0 && (
        <div style={{ borderTop: '1px solid var(--sp-border-6)', paddingTop: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--sp-text-50)', marginBottom: 6 }}>
            Marcadores más probables
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '3px 8px' }}>
            {scorelines.slice(0, 6).map((s, i) => (
              <div
                key={i}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <span style={{
                  fontSize: 13,
                  fontWeight: i === 0 ? 700 : 500,
                  color: i === 0 ? 'var(--sp-text-88)' : 'var(--sp-text-70)',
                  fontVariantNumeric: 'tabular-nums',
                  flexShrink: 0,
                }}>
                  {s.home} – {s.away}
                </span>
                <span style={{
                  fontSize: 12,
                  fontWeight: i === 0 ? 600 : 400,
                  color: i === 0 ? 'var(--sp-text-70)' : 'var(--sp-text-50)',
                }}>
                  {pct(s.probability)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
