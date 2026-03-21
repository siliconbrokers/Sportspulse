/**
 * LeagueTableV2 — Bento Inmersivo
 * bg-brand-dark · rounded-bento · sticky header · Forma 24px neon · Legend inline
 */
import type { StandingEntry } from '../hooks/use-standings.js';
import { useWindowWidth } from '../hooks/use-window-width.js';
import { resolveTeamName } from '../utils/resolve-team-name.js';

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

const PD_ZONES: Zone[] = [
  { from: 1,  to: 4,  type: 'ucl',        emoji: '🔵', label: 'Champions League',  color: 'var(--sp-zone-champions)' },
  { from: 5,  to: 6,  type: 'uel',        emoji: '🟠', label: 'Europa League',     color: 'var(--sp-zone-europa)' },
  { from: 7,  to: 7,  type: 'uecl',       emoji: '🟢', label: 'Conference League', color: 'var(--sp-zone-conference)' },
  { from: 18, to: 20, type: 'relegation', emoji: '🔴', label: 'Descenso',          color: 'var(--sp-zone-relegation)' },
];
const PL_ZONES: Zone[] = [
  { from: 1,  to: 4,  type: 'ucl',        emoji: '🔵', label: 'Champions League',  color: 'var(--sp-zone-champions)' },
  { from: 5,  to: 5,  type: 'uel',        emoji: '🟠', label: 'Europa League',     color: 'var(--sp-zone-europa)' },
  { from: 6,  to: 6,  type: 'uecl',       emoji: '🟢', label: 'Conference League', color: 'var(--sp-zone-conference)' },
  { from: 18, to: 20, type: 'relegation', emoji: '🔴', label: 'Descenso',          color: 'var(--sp-zone-relegation)' },
];
const BL1_ZONES: Zone[] = [
  { from: 1,  to: 4,  type: 'ucl',        emoji: '🔵', label: 'Champions League',  color: 'var(--sp-zone-champions)' },
  { from: 5,  to: 5,  type: 'uel',        emoji: '🟠', label: 'Europa League',     color: 'var(--sp-zone-europa)' },
  { from: 6,  to: 6,  type: 'uecl',       emoji: '🟢', label: 'Conference League', color: 'var(--sp-zone-conference)' },
  { from: 16, to: 16, type: 'playoff',    emoji: '🟡', label: 'Playoff descenso',  color: 'var(--sp-zone-playoff)' },
  { from: 17, to: 18, type: 'relegation', emoji: '🔴', label: 'Descenso',          color: 'var(--sp-zone-relegation)' },
];
const URU_ZONES: Zone[] = [
  { from: 1, to: 1, type: 'ucl', emoji: '🔵', label: 'Copa Libertadores', color: 'var(--sp-zone-champions)' },
  { from: 2, to: 5, type: 'uel', emoji: '🟠', label: 'Copa Sudamericana', color: 'var(--sp-zone-sudamericana)' },
];
// Argentina Liga Profesional — 28 equipos (Apertura 2025)
const AR_ZONES: Zone[] = [
  { from: 1,  to: 1,  type: 'ucl',        emoji: '🔵', label: 'Libertadores',  color: 'var(--sp-zone-champions)' },
  { from: 2,  to: 4,  type: 'uel',        emoji: '🟠', label: 'Sudamericana',  color: 'var(--sp-zone-sudamericana)' },
  { from: 25, to: 28, type: 'relegation', emoji: '🔴', label: 'Descenso',      color: 'var(--sp-zone-relegation)' },
];
// Liga MX — top 8 clasifican a Liguilla (playoffs). Sin descenso directo por puntos (sistema Promedios).
const MX_ZONES: Zone[] = [
  { from: 1, to: 8, type: 'playoff', emoji: '🟡', label: 'Liguilla', color: 'var(--sp-zone-liguilla)' },
];
// Chile Primera División — pos 1-2 Libertadores, 3 playoff Libertadores, 4-6 Sudamericana, 15-16 descenso
const CL_ZONES: Zone[] = [
  { from: 1,  to: 2,  type: 'ucl',        emoji: '🔵', label: 'Copa Libertadores',    color: 'var(--sp-zone-champions)' },
  { from: 3,  to: 3,  type: 'playoff',    emoji: '🟡', label: 'Playoff Libertadores', color: 'var(--sp-zone-playoff-alt)' },
  { from: 4,  to: 6,  type: 'uel',        emoji: '🟠', label: 'Copa Sudamericana',    color: 'var(--sp-zone-sudamericana)' },
  { from: 15, to: 16, type: 'relegation', emoji: '🔴', label: 'Descenso',             color: 'var(--sp-zone-relegation)' },
];
// Brasileirão Série A — pos 1-6 Libertadores, 7-12 Sudamericana, 17-20 descenso
const BR_ZONES: Zone[] = [
  { from: 1,  to: 6,  type: 'ucl',        emoji: '🔵', label: 'Copa Libertadores', color: 'var(--sp-zone-champions)' },
  { from: 7,  to: 12, type: 'uel',        emoji: '🟠', label: 'Copa Sudamericana', color: 'var(--sp-zone-sudamericana)' },
  { from: 17, to: 20, type: 'relegation', emoji: '🔴', label: 'Descenso',          color: 'var(--sp-zone-relegation)' },
];
// Primeira Liga (Portugal) — pos 1-2 Champions, 3 Europa, 4 Conference, 16 playoff, 17-18 descenso
const PT_ZONES: Zone[] = [
  { from: 1,  to: 2,  type: 'ucl',        emoji: '🔵', label: 'Champions League',  color: 'var(--sp-zone-champions)' },
  { from: 3,  to: 3,  type: 'uel',        emoji: '🟠', label: 'Europa League',     color: 'var(--sp-zone-europa)' },
  { from: 4,  to: 4,  type: 'uecl',       emoji: '🟢', label: 'Conference League', color: 'var(--sp-zone-conference)' },
  { from: 16, to: 16, type: 'playoff',    emoji: '🟡', label: 'Playoff descenso',  color: 'var(--sp-zone-playoff-alt)' },
  { from: 17, to: 18, type: 'relegation', emoji: '🔴', label: 'Descenso',          color: 'var(--sp-zone-relegation)' },
];
// Serie A (Italy) — pos 1-4 Champions, 5 Europa, 6 Conference, 18-20 descenso
const SA_ZONES: Zone[] = [
  { from: 1,  to: 4,  type: 'ucl',        emoji: '🔵', label: 'Champions League',  color: 'var(--sp-zone-champions)' },
  { from: 5,  to: 5,  type: 'uel',        emoji: '🟠', label: 'Europa League',     color: 'var(--sp-zone-europa)' },
  { from: 6,  to: 6,  type: 'uecl',       emoji: '🟢', label: 'Conference League', color: 'var(--sp-zone-conference)' },
  { from: 18, to: 20, type: 'relegation', emoji: '🔴', label: 'Descenso',          color: 'var(--sp-zone-relegation)' },
];

const ZONE_CONFIGS: Record<string, Zone[]> = {
  // API-Football canonical IDs
  'comp:apifootball:140': PD_ZONES,
  'comp:apifootball:39':  PL_ZONES,
  'comp:apifootball:78':  BL1_ZONES,
  'comp:apifootball:268': URU_ZONES,
  'comp:apifootball:128': AR_ZONES,
  'comp:apifootball:262': MX_ZONES,
  'comp:apifootball:71':  BR_ZONES,
  'comp:apifootball:135': SA_ZONES,
  'comp:apifootball:94':  PT_ZONES,
  'comp:apifootball:265': CL_ZONES,
  // Legacy IDs (kept for backward compat)
  'comp:football-data:PD':  PD_ZONES,
  'comp:football-data:PL':  PL_ZONES,
  'comp:openligadb:bl1':    BL1_ZONES,
  'comp:football-data:BL1': BL1_ZONES,
  'comp:thesportsdb:4432':  URU_ZONES,
  'comp:sportsdb-ar:4406':  AR_ZONES,
};

function getZone(competitionId: string, position: number): Zone | null {
  return (ZONE_CONFIGS[competitionId] ?? []).find(
    (z) => position >= z.from && position <= z.to,
  ) ?? null;
}

// ─── Forma reciente — mismo esquema visual que DetailPanel ───────────────────
const FORM_COLORS: Record<string, string> = {
  W: 'var(--sp-form-win)',
  D: 'var(--sp-form-draw)',
  L: 'var(--sp-form-loss)',
};
const FORM_LABELS: Record<string, string> = { W: 'G', D: 'E', L: 'P' };
const FORM_TITLES: Record<string, string> = { W: 'Victoria', D: 'Empate', L: 'Derrota' };

function FormCircle({ result, size = 20 }: { result: string; size?: number }) {
  const key = result.trim().toUpperCase();
  const color = FORM_COLORS[key];
  if (!color) return null;

  return (
    <div
      title={FORM_TITLES[key]}
      style={{
        width: size,
        height: size,
        borderRadius: 4,
        backgroundColor: color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size <= 18 ? 8 : 10,
        fontWeight: 800,
        color: '#fff',
        flexShrink: 0,
      }}
    >
      {FORM_LABELS[key]}
    </div>
  );
}

function FormBadges({ form, isMobile }: { form?: string[]; isMobile: boolean }) {
  if (!form || form.length === 0) {
    return (
      <span style={{ color: 'var(--sp-text-20)', fontSize: 11 }}>—</span>
    );
  }

  // Mobile: últimos 3 resultados. Desktop: todos (ya vienen ordenados oldest→newest).
  const results = isMobile ? form.slice(-3) : form;
  const size = isMobile ? 18 : 20;

  return (
    <div style={{ display: 'flex', gap: isMobile ? 2 : 3, justifyContent: 'center', alignItems: 'center' }}>
      {results.map((r, i) => (
        <FormCircle key={i} result={r} size={size} />
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
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              background: z.color,
              flexShrink: 0,
              boxShadow: `0 0 4px ${z.color}66`,
            }}
          />
          <span
            style={{
              fontSize: 10,
              color: z.color,
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
  teamsPlayingLive?: Set<string>;
}

export function StandingsTable({
  standings,
  onTeamClick,
  competitionId,
  teamsPlayingToday,
  teamsPlayingLive,
}: StandingsTableProps) {
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';
  const hasForm = standings.some((r) => !!r.recentForm?.length);
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
              const isLiveNow = teamsPlayingLive?.has(row.teamId) ?? false;
              const playsToday = (teamsPlayingToday?.has(row.teamId) ?? false) && !isLiveNow;
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
                          color: isLiveNow ? 'var(--sp-status-live)' : playsToday ? 'var(--sp-primary)' : 'var(--sp-text-88)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: isMobile ? 90 : 190,
                          fontSize: isMobile ? 12 : 13,
                        }}
                      >
                        {resolveTeamName(row.teamName, { tla: row.tla, compact: isMobile })}
                      </span>
                      {isLiveNow && (
                        <span
                          title="En juego ahora"
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: 'var(--sp-status-live)',
                            boxShadow: '0 0 6px var(--sp-status-live-soft)',
                            flexShrink: 0,
                            animation: 'pulse-live 2s cubic-bezier(0.4,0,0.6,1) infinite',
                          }}
                        />
                      )}
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
                            ? 'var(--sp-status-success)'
                            : row.goalDifference < 0
                              ? 'var(--sp-status-error)'
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
                              ? 'var(--sp-status-success)'
                              : row.goalDifference < 0
                                ? 'var(--sp-status-error)'
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
                      <FormBadges form={row.recentForm} isMobile={isMobile} />
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
