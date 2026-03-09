/**
 * LeagueTableV2 — Bento Inmersivo
 * bg-brand-dark · rounded-bento · sticky header · Forma 24px neon · Legend inline
 */
import type { StandingEntry } from '../hooks/use-standings.js';
import { useWindowWidth } from '../hooks/use-window-width.js';

// ─── Zonas de clasificación ───────────────────────────────────────────────────
type ZoneType = 'ucl' | 'uel' | 'uecl' | 'playoff' | 'relegation' | null;

interface Zone {
  from: number;
  to: number;
  type: ZoneType;
  emoji: string;
  label: string;
  color: string;
}

const ZONE_CONFIGS: Record<string, Zone[]> = {
  'comp:football-data:PD': [
    { from: 1,  to: 4,  type: 'ucl',        emoji: '🔵', label: 'Champions League',  color: '#00E0FF' },
    { from: 5,  to: 6,  type: 'uel',        emoji: '🟠', label: 'Europa League',     color: '#F97316' },
    { from: 7,  to: 7,  type: 'uecl',       emoji: '🟢', label: 'Conference League', color: '#14b8a6' },
    { from: 18, to: 20, type: 'relegation', emoji: '🔴', label: 'Descenso',          color: '#EF4444' },
  ],
  'comp:football-data:PL': [
    { from: 1,  to: 4,  type: 'ucl',        emoji: '🔵', label: 'Champions League',  color: '#00E0FF' },
    { from: 5,  to: 5,  type: 'uel',        emoji: '🟠', label: 'Europa League',     color: '#F97316' },
    { from: 6,  to: 6,  type: 'uecl',       emoji: '🟢', label: 'Conference League', color: '#14b8a6' },
    { from: 18, to: 20, type: 'relegation', emoji: '🔴', label: 'Descenso',          color: '#EF4444' },
  ],
  'comp:openligadb:bl1': [
    { from: 1,  to: 4,  type: 'ucl',        emoji: '🔵', label: 'Champions League',  color: '#00E0FF' },
    { from: 5,  to: 5,  type: 'uel',        emoji: '🟠', label: 'Europa League',     color: '#F97316' },
    { from: 6,  to: 6,  type: 'uecl',       emoji: '🟢', label: 'Conference League', color: '#14b8a6' },
    { from: 16, to: 16, type: 'playoff',    emoji: '🟡', label: 'Playoff descenso',  color: '#eab308' },
    { from: 17, to: 18, type: 'relegation', emoji: '🔴', label: 'Descenso',          color: '#EF4444' },
  ],
  'comp:football-data:BL1': [
    { from: 1,  to: 4,  type: 'ucl',        emoji: '🔵', label: 'Champions League',  color: '#00E0FF' },
    { from: 5,  to: 5,  type: 'uel',        emoji: '🟠', label: 'Europa League',     color: '#F97316' },
    { from: 6,  to: 6,  type: 'uecl',       emoji: '🟢', label: 'Conference League', color: '#14b8a6' },
    { from: 16, to: 16, type: 'playoff',    emoji: '🟡', label: 'Playoff descenso',  color: '#eab308' },
    { from: 17, to: 18, type: 'relegation', emoji: '🔴', label: 'Descenso',          color: '#EF4444' },
  ],
  'comp:thesportsdb:4432': [
    { from: 1, to: 1, type: 'ucl', emoji: '🔵', label: 'Copa Libertadores', color: '#00E0FF' },
    { from: 2, to: 5, type: 'uel', emoji: '🟠', label: 'Copa Sudamericana', color: '#F97316' },
  ],
};

function getZone(competitionId: string, position: number): Zone | null {
  return (ZONE_CONFIGS[competitionId] ?? []).find(
    (z) => position >= z.from && position <= z.to,
  ) ?? null;
}

// ─── Forma reciente — círculos 24px ───────────────────────────────────────────
function FormCircle({ result, size = 24 }: { result: string; size?: number }) {
  const key = result.trim().toUpperCase();
  const fontSize = size <= 18 ? 8 : 10;
  const base: React.CSSProperties = { width: size, height: size, fontSize, fontWeight: 700, flexShrink: 0, letterSpacing: 0 };

  if (key === 'W') {
    return (
      <div
        title="Victoria"
        className="flex items-center justify-center rounded-full border border-emerald-500/50 bg-emerald-500/20 text-emerald-400"
        style={{ ...base, boxShadow: '0 0 8px rgba(16,185,129,0.35)' }}
      >
        G
      </div>
    );
  }

  if (key === 'D') {
    return (
      <div
        title="Empate"
        className="flex items-center justify-center rounded-full border border-white/10 bg-slate-500/20 text-slate-400"
        style={base}
      >
        E
      </div>
    );
  }

  if (key === 'L') {
    return (
      <div
        title="Derrota"
        className="flex items-center justify-center rounded-full border border-rose-500/50 bg-rose-500/20 text-rose-400"
        style={{ ...base, boxShadow: '0 0 8px rgba(239,68,68,0.3)' }}
      >
        P
      </div>
    );
  }

  return null;
}

function FormBadges({ form, isMobile }: { form?: string | null; isMobile: boolean }) {
  if (!form) {
    return (
      <span style={{ color: 'var(--sp-text-20)', fontSize: 11 }}>—</span>
    );
  }

  // Mobile: últimos 3 resultados con círculos de 18px para ahorrar espacio
  // Desktop: últimos 5 resultados con círculos de 24px
  const results = form.split(',').slice(isMobile ? -3 : -5);
  const circleSize = isMobile ? 18 : 24;

  return (
    <div style={{ display: 'flex', gap: isMobile ? 2 : 4, justifyContent: 'center', alignItems: 'center' }}>
      {results.map((r, i) => (
        <FormCircle key={i} result={r} size={circleSize} />
      ))}
    </div>
  );
}

// ─── Leyenda inline ──────────────────────────────────────────────────────────
function Legend({ competitionId }: { competitionId: string }) {
  const zones = ZONE_CONFIGS[competitionId] ?? [];
  if (zones.length === 0) return null;

  return (
    <div
      style={{
        borderTop: '1px solid var(--sp-border-5)',
        padding: '12px 20px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px 20px',
        alignItems: 'center',
      }}
    >
      {zones.map((z, i) => (
        <span key={z.type} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          {i > 0 && (
            <span style={{ color: 'var(--sp-text-20)', marginRight: 4, fontSize: 10 }}>|</span>
          )}
          <span style={{ fontSize: 13 }}>{z.emoji}</span>
          <span
            style={{
              fontSize: 10,
              color: 'var(--sp-secondary)',
              letterSpacing: '0.03em',
              lineHeight: 1.6,
            }}
          >
            {z.label}
          </span>
        </span>
      ))}
    </div>
  );
}

// ─── Columna Pts — header especial ───────────────────────────────────────────
function PtsHeader({ mobile }: { mobile: boolean }) {
  return (
    <th
      style={{
        padding: mobile ? '10px 3px' : '12px 10px',
        textAlign: 'center',
        fontSize: 10,
        fontWeight: 800,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'var(--sp-primary)',
        whiteSpace: 'nowrap',
        minWidth: mobile ? 36 : 48,
        textShadow: '0 0 10px var(--sp-primary-40)',
      }}
    >
      PTS
    </th>
  );
}

function ColHeader({
  children,
  left,
  narrow,
  mobile,
}: {
  children: React.ReactNode;
  left?: boolean;
  narrow?: boolean;
  mobile?: boolean;
}) {
  return (
    <th
      style={{
        padding: mobile ? '10px 3px' : '12px 6px',
        textAlign: left ? 'left' : 'center',
        paddingLeft: left ? (mobile ? 6 : 12) : (mobile ? 3 : 6),
        fontSize: 10,
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: 'var(--sp-text-35)',
        width: narrow ? (mobile ? 26 : 36) : undefined,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </th>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
interface StandingsTableProps {
  standings: StandingEntry[];
  onTeamClick: (teamId: string) => void;
  competitionId: string;
  teamsPlayingToday?: Set<string>;
}

export function StandingsTable({
  standings,
  onTeamClick,
  competitionId,
  teamsPlayingToday,
}: StandingsTableProps) {
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';
  const hasForm = standings.some((r) => !!r.form);
  const showForm = hasForm; // visible en mobile (compacto 3 círculos) y desktop (5 círculos)

  return (
    // Contenedor Bento: fondo brand-dark, bordes 1.5rem, borde sutil
    // overflow: clip (no hidden) para preservar borderRadius sin cortar el scroll interno
    <div
      data-testid="standings-table"
      style={{
        background: 'var(--sp-bg)',
        borderRadius: '1.5rem',
        border: '1px solid var(--sp-border)',
        overflow: 'clip',
        transition: 'background 0.2s ease',
      }}
    >
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' as never }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: isMobile ? 12 : 13,
            color: 'var(--sp-text)',
            // Mobile: columnas reducidas caben sin scroll — no forzar max-content
            minWidth: isMobile ? undefined : 600,
          }}
        >
          {/* ── Sticky header con backdrop-blur ──────────────────────────── */}
          <thead>
            <tr
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 10,
                background: 'var(--sp-header)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                borderBottom: '1px solid var(--sp-border-8)',
              }}
            >
              <ColHeader narrow mobile={isMobile}>#</ColHeader>
              <ColHeader left mobile={isMobile}>EQUIPO</ColHeader>
              <ColHeader mobile={isMobile}>PJ</ColHeader>
              {/* Mobile: solo DG. Desktop: G, E, P, GF, GC, DG */}
              {isMobile ? (
                <ColHeader mobile>DG</ColHeader>
              ) : (
                <>
                  <ColHeader>G</ColHeader>
                  <ColHeader>E</ColHeader>
                  <ColHeader>P</ColHeader>
                  <ColHeader>GF</ColHeader>
                  <ColHeader>GC</ColHeader>
                  <ColHeader>DG</ColHeader>
                </>
              )}
              {showForm && (
                <th
                  style={{
                    padding: isMobile ? '10px 4px' : '12px 8px',
                    textAlign: 'center',
                    fontSize: 10,
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--sp-text-35)',
                    // Mobile: 3 círculos × 18px + 2×2px gaps = 58px → 64px
                    // Desktop: 5 círculos × 24px + 4×4px gaps = 136px → 145px
                    minWidth: isMobile ? 64 : 145,
                    whiteSpace: 'nowrap',
                  }}
                >
                  FORMA
                </th>
              )}
              <PtsHeader mobile={isMobile} />
            </tr>
          </thead>

          {/* ── Filas ───────────────────────────────────────────────────── */}
          <tbody>
            {standings.map((row, i) => {
              const zone = getZone(competitionId, row.position);
              const playsToday = teamsPlayingToday?.has(row.teamId) ?? false;
              const isEven = i % 2 === 0;

              return (
                <tr
                  key={row.teamId}
                  onClick={() => onTeamClick(row.teamId)}
                  style={{
                    cursor: 'pointer',
                    borderBottom: '1px solid var(--sp-border-4)',
                    borderLeft: zone ? `4px solid ${zone.color}` : '4px solid transparent',
                    background: isEven ? 'var(--sp-row-even)' : 'transparent',
                    transition: 'background 0.12s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--sp-row-hover)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = isEven
                      ? 'var(--sp-row-even)'
                      : 'transparent';
                  }}
                >
                  {/* # */}
                  <td style={{ ...cellStyle(isMobile), width: isMobile ? 26 : 36, fontSize: 11, color: 'var(--sp-text-40)', fontWeight: 600 }}>
                    {row.position}
                  </td>

                  {/* Equipo */}
                  <td style={{ ...cellStyle(isMobile), textAlign: 'left', paddingLeft: isMobile ? 6 : 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 5 : 8, minWidth: 0 }}>
                      {row.crestUrl && (
                        <img
                          src={row.crestUrl}
                          alt=""
                          style={{ width: isMobile ? 18 : 22, height: isMobile ? 18 : 22, objectFit: 'contain', flexShrink: 0 }}
                        />
                      )}
                      <span
                        style={{
                          fontWeight: 500,
                          color: playsToday ? 'var(--sp-primary)' : 'var(--sp-text-88)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: isMobile ? 90 : 190,
                          fontSize: isMobile ? 12 : 13,
                        }}
                      >
                        {row.teamName}
                      </span>
                      {playsToday && (
                        <span
                          title="Juega hoy"
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: 'var(--sp-primary)',
                            boxShadow: '0 0 6px var(--sp-primary)',
                            flexShrink: 0,
                            animation: 'pulse-live 2s cubic-bezier(0.4,0,0.6,1) infinite',
                          }}
                        />
                      )}
                    </div>
                  </td>

                  {/* PJ */}
                  <td style={cellStyle(isMobile)}>{row.playedGames}</td>

                  {/* Stats: mobile → solo DG | desktop → G E P GF GC DG */}
                  {isMobile ? (
                    <td
                      style={{
                        ...cellStyle(isMobile),
                        fontWeight: 600,
                        fontSize: 12,
                        color:
                          row.goalDifference > 0
                            ? '#4ade80'
                            : row.goalDifference < 0
                              ? '#f87171'
                              : 'var(--sp-text-35)',
                      }}
                    >
                      {row.goalDifference > 0 ? '+' : ''}
                      {row.goalDifference}
                    </td>
                  ) : (
                    <>
                      <td style={cell}>{row.won}</td>
                      <td style={cell}>{row.draw}</td>
                      <td style={cell}>{row.lost}</td>
                      <td style={cell}>{row.goalsFor}</td>
                      <td style={cell}>{row.goalsAgainst}</td>
                      <td
                        style={{
                          ...cell,
                          fontWeight: 600,
                          color:
                            row.goalDifference > 0
                              ? '#4ade80'
                              : row.goalDifference < 0
                                ? '#f87171'
                                : 'var(--sp-text-35)',
                        }}
                      >
                        {row.goalDifference > 0 ? '+' : ''}
                        {row.goalDifference}
                      </td>
                    </>
                  )}

                  {/* FORMA */}
                  {showForm && (
                    <td style={{ ...cellStyle(isMobile), paddingLeft: isMobile ? 2 : 4, paddingRight: isMobile ? 2 : 4 }}>
                      <FormBadges form={row.form} isMobile={isMobile} />
                    </td>
                  )}

                  {/* PTS — protagonista visual */}
                  <td
                    style={{
                      ...cellStyle(isMobile),
                      fontWeight: 900,
                      fontSize: isMobile ? 13 : 15,
                      color: 'var(--sp-primary)',
                      letterSpacing: '-0.02em',
                      textShadow: '0 0 12px var(--sp-primary-40)',
                      minWidth: isMobile ? 36 : 48,
                    }}
                  >
                    {row.points}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Leyenda al pie */}
      <Legend competitionId={competitionId} />
    </div>
  );
}

function cellStyle(mobile: boolean): React.CSSProperties {
  return {
    padding: mobile ? '9px 3px' : '10px 6px',
    textAlign: 'center',
    verticalAlign: 'middle',
  };
}
// Alias para desktop — mantener compatibilidad con usos existentes que pasan isMobile
const cell: React.CSSProperties = cellStyle(false);
