/**
 * ProbabilityBars — componente compartido para mostrar probabilidades de resultado.
 * Mismo layout que RadarCard: width:X% para números Y barras, alineación perfecta.
 */

import { useTheme } from '../../hooks/use-theme.js';

interface ProbabilityBarsProps {
  probHomeWin: number;   // 0..1
  probDraw: number;      // 0..1
  probAwayWin: number;   // 0..1
  homeTeamName?: string;
  awayTeamName?: string;
  label?: string;
  showTeamNames?: boolean;
}

export function ProbabilityBars({
  probHomeWin,
  probDraw,
  probAwayWin,
  homeTeamName,
  awayTeamName,
  label = 'Pronóstico',
  showTeamNames = false,
}: ProbabilityBarsProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const pH = Math.round(probHomeWin * 100);
  const pD = Math.round(probDraw * 100);
  const pA = Math.round(probAwayWin * 100);

  return (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 600, color: 'var(--sp-text-30)',
        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6,
      }}>
        {label}
      </div>

      {/* Números: 3 columnas fijas — siempre visibles independiente del valor (incluye 0%) */}
      <div style={{ display: 'flex', marginBottom: 5 }}>
        <div style={{ flex: 1, textAlign: 'left', minWidth: 0, overflow: 'hidden' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--sp-text-88)' }}>{pH}%</div>
          {showTeamNames && homeTeamName && (
            <div style={{ fontSize: 10, color: 'var(--sp-text-35)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {homeTeamName}
            </div>
          )}
        </div>
        <div style={{ flex: 1, textAlign: 'center', minWidth: 0, overflow: 'hidden' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--sp-text-50)' }}>{pD}%</div>
          <div style={{ fontSize: 10, color: 'var(--sp-text-35)', marginTop: 1 }}>Empate</div>
        </div>
        <div style={{ flex: 1, textAlign: 'right', minWidth: 0, overflow: 'hidden' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--sp-text-88)' }}>{pA}%</div>
          {showTeamNames && awayTeamName && (
            <div style={{ fontSize: 10, color: 'var(--sp-text-35)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {awayTeamName}
            </div>
          )}
        </div>
      </div>

      {/* Barras proporcionales */}
      <div style={{ display: 'flex', gap: 2, borderRadius: 3, overflow: 'hidden', height: 4 }}>
        <div style={{ width: `${pH}%`, backgroundColor: '#22c55e' }} />
        <div style={{ width: `${pD}%`, backgroundColor: isDark ? '#374151' : '#94a3b8' }} />
        <div style={{ width: `${pA}%`, backgroundColor: '#ef4444' }} />
      </div>
    </div>
  );
}
