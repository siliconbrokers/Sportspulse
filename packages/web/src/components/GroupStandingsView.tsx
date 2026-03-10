/**
 * GroupStandingsView — tablas de posiciones por grupo.
 *
 * Desktop  (≥1024px): 4 columnas
 * Tablet   (640-1024): 2 columnas
 * Mobile   (<640):    1 columna
 *
 * Cada grupo: card con borde sutil + header + filas compactas.
 * Mobile: muestra solo columnas esenciales (#, Equipo, PJ, DG, Pts).
 * Desktop: muestra todas las columnas (J, G, E, P, DG, Pts).
 */
import { useWindowWidth } from '../hooks/use-window-width.js';
import type { GroupStandingsDTO } from '../types/tournament.js';
import type { StandingEntry } from '../hooks/use-standings.js';

interface GroupStandingsViewProps {
  groups: GroupStandingsDTO[];
  onTeamClick?: (teamId: string) => void;
  teamsPlayingToday?: Set<string>;
  bestThirds?: StandingEntry[];
  /** Fecha ISO de inicio del torneo. Si se provee y el torneo no ha comenzado, muestra banner. */
  startDate?: string;
}

// ── Colores por badge (semánticos — sin fondo, solo el indicador) ─────────────

const BADGE_COLORS: Record<string, string> = {
  CHAMPION:   '#f59e0b',
  QUALIFIED:  '#22c55e',
  UCL:        '#3b82f6',
  PLAYOFF:    '#eab308',
  ELIMINATED: '#6b7280',
  RELEGATED:  '#ef4444',
};

function badgeColor(badge: string | null | undefined): string {
  if (!badge) return 'var(--sp-border-8)';
  return BADGE_COLORS[badge.toUpperCase()] ?? '#6b7280';
}

// ── Fila de equipo ────────────────────────────────────────────────────────────

function TeamRow({
  entry,
  onClick,
  isPlaying,
  isMobile,
}: {
  entry: StandingEntry;
  onClick?: () => void;
  isPlaying: boolean;
  isMobile: boolean;
}) {
  const indicator = badgeColor(entry.statusBadge);
  const qualified = entry.statusBadge && entry.statusBadge.toUpperCase() !== 'ELIMINATED' && entry.statusBadge.toUpperCase() !== 'RELEGATED';

  const gridCols = isMobile
    ? '22px 1fr 22px 28px 30px'          // #, equipo, J, DG, Pts
    : '22px 1fr 22px 22px 22px 22px 28px 30px'; // #, equipo, J, G, E, P, DG, Pts

  return (
    <div
      onClick={onClick}
      style={{
        display: 'grid',
        gridTemplateColumns: gridCols,
        alignItems: 'center',
        padding: isMobile ? '8px 12px 8px 0' : '5px 12px 5px 0',
        marginLeft: 0,
        borderBottom: '1px solid var(--sp-border-4)',
        cursor: onClick ? 'pointer' : 'default',
        backgroundColor: isPlaying ? 'rgba(249,115,22,0.08)' : 'transparent',
        transition: 'background-color 0.12s',
        position: 'relative',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.backgroundColor = isPlaying
          ? 'rgba(249,115,22,0.12)'
          : 'var(--sp-border-4)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.backgroundColor = isPlaying
          ? 'rgba(249,115,22,0.08)'
          : 'transparent';
      }}
    >
      {/* Posición + indicador de clasificación */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: 10 }}>
        <span style={{
          display: 'inline-block',
          width: 3,
          height: 16,
          borderRadius: 2,
          backgroundColor: indicator,
          flexShrink: 0,
        }} />
        <span style={{
          fontSize: 11,
          color: qualified ? 'var(--sp-text-55)' : 'var(--sp-text-30)',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}>
          {entry.position}
        </span>
      </div>

      {/* Escudo + nombre */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        {entry.crestUrl ? (
          <img
            src={entry.crestUrl}
            alt=""
            style={{ width: 15, height: 15, objectFit: 'contain', flexShrink: 0 }}
          />
        ) : (
          <div style={{ width: 15, height: 15, borderRadius: '50%', background: 'var(--sp-border-8)', flexShrink: 0 }} />
        )}
        <span style={{
          fontSize: 12,
          fontWeight: isPlaying ? 600 : 400,
          color: isPlaying ? '#f97316' : 'var(--sp-text-88)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {entry.teamName}
        </span>
      </div>

      {/* J */}
      <Stat value={entry.playedGames} />
      {/* G, E, P — solo desktop */}
      {!isMobile && <Stat value={entry.won} />}
      {!isMobile && <Stat value={entry.draw} />}
      {!isMobile && <Stat value={entry.lost} muted />}
      {/* DG */}
      <Stat
        value={entry.goalDifference >= 0 ? `+${entry.goalDifference}` : String(entry.goalDifference)}
        color={entry.goalDifference > 0 ? 'rgba(34,197,94,0.75)' : entry.goalDifference < 0 ? 'rgba(239,68,68,0.7)' : undefined}
      />
      {/* Pts */}
      <span style={{
        fontSize: 12,
        fontWeight: 700,
        textAlign: 'right',
        color: 'var(--sp-text)',
        fontVariantNumeric: 'tabular-nums',
        paddingRight: 2,
      }}>
        {entry.points}
      </span>
    </div>
  );
}

function Stat({ value, muted, color }: { value: string | number; muted?: boolean; color?: string }) {
  return (
    <span style={{
      fontSize: 11,
      textAlign: 'center',
      color: color ?? (muted ? 'var(--sp-text-30)' : 'var(--sp-text-50)'),
      fontVariantNumeric: 'tabular-nums',
    }}>
      {value}
    </span>
  );
}

// ── Cabecera de columnas ──────────────────────────────────────────────────────

function ColHeaders({ isMobile }: { isMobile: boolean }) {
  const hStyle: React.CSSProperties = {
    fontSize: 9,
    fontWeight: 700,
    textAlign: 'center',
    color: 'var(--sp-text-20)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  };

  const gridCols = isMobile
    ? '22px 1fr 22px 28px 30px'
    : '22px 1fr 22px 22px 22px 22px 28px 30px';

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: gridCols,
      alignItems: 'center',
      padding: '0 12px 5px 0',
      borderBottom: '1px solid var(--sp-border-8)',
      marginBottom: 2,
    }}>
      <span />
      <span style={{ ...hStyle, textAlign: 'left', paddingLeft: 10, fontSize: 9 }}>Equipo</span>
      <span style={hStyle}>J</span>
      {!isMobile && <span style={hStyle}>G</span>}
      {!isMobile && <span style={hStyle}>E</span>}
      {!isMobile && <span style={hStyle}>P</span>}
      <span style={hStyle}>DG</span>
      <span style={{ ...hStyle, textAlign: 'right', paddingRight: 2 }}>Pts</span>
    </div>
  );
}

// ── Grupo card ────────────────────────────────────────────────────────────────

function GroupCard({
  group,
  standings,
  onTeamClick,
  teamsPlayingToday,
  isMobile,
}: {
  group: GroupStandingsDTO['group'];
  standings: StandingEntry[];
  onTeamClick?: (teamId: string) => void;
  teamsPlayingToday?: Set<string>;
  isMobile: boolean;
}) {
  return (
    <div style={{
      backgroundColor: 'var(--sp-surface-card)',
      border: '1px solid var(--sp-border-8)',
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 12px',
        background: 'var(--sp-border-4)',
        borderBottom: '1px solid var(--sp-border-6)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <span style={{
          fontSize: 11,
          fontWeight: 800,
          color: 'var(--sp-text-75)',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
        }}>
          {group.name}
        </span>
      </div>

      {/* Tabla */}
      <div style={{ padding: '8px 0 4px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <ColHeaders isMobile={isMobile} />
        {standings.map(entry => (
          <TeamRow
            key={entry.teamId}
            entry={entry}
            onClick={onTeamClick ? () => onTeamClick(entry.teamId) : undefined}
            isPlaying={teamsPlayingToday?.has(entry.teamId) ?? false}
            isMobile={isMobile}
          />
        ))}
      </div>
    </div>
  );
}

// ── Leyenda ───────────────────────────────────────────────────────────────────

function Legend() {
  const items = [
    { color: '#22c55e', label: 'Clasificado' },
    { color: '#f59e0b', label: 'Campeón' },
    { color: '#6b7280', label: 'Eliminado' },
  ];

  return (
    <div style={{
      display: 'flex',
      gap: 16,
      flexWrap: 'wrap',
      marginTop: 12,
      marginBottom: 4,
      paddingLeft: 2,
    }}>
      {items.map(item => (
        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ display: 'inline-block', width: 3, height: 12, borderRadius: 2, backgroundColor: item.color }} />
          <span style={{ fontSize: 10, color: 'var(--sp-text-35)', letterSpacing: '0.04em' }}>
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}


// ── Vista principal ───────────────────────────────────────────────────────────

export function GroupStandingsView({
  groups,
  onTeamClick,
  teamsPlayingToday,
  bestThirds,
  startDate,
}: GroupStandingsViewProps) {
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';

  if (groups.length === 0) {
    return (
      <div style={{ fontSize: 13, color: 'var(--sp-text-40)', textAlign: 'center', padding: '24px 0' }}>
        Sin datos de grupos disponibles.
      </div>
    );
  }

  const cols = breakpoint === 'desktop' ? 4 : breakpoint === 'tablet' ? 2 : 1;
  const sorted = [...groups].sort((a, b) => a.group.orderIndex - b.group.orderIndex);

  // Pre-tournament banner: todos los equipos con 0 partidos jugados y startDate provisto
  const isPreTournament = !!startDate &&
    groups.length > 0 &&
    groups.every((g) => g.standings.every((s) => s.playedGames === 0));

  return (
    <div>
      {isPreTournament && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: isMobile ? '10px 14px' : '12px 16px',
          marginBottom: 16,
          backgroundColor: 'var(--sp-surface-card)',
          border: '1px solid var(--sp-border-8)',
          borderLeft: '3px solid #22c55e',
          borderRadius: 8,
          fontSize: 13,
          color: 'var(--sp-text-55)',
        }}>
          <span style={{ fontSize: 16 }}>⏳</span>
          <span>
            El torneo aún no comenzó —{' '}
            <span style={{ color: 'var(--sp-text-88)', fontWeight: 600 }}>
              {startDate ? new Date(startDate + 'T12:00:00').toLocaleDateString('es-UY', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}
            </span>
          </span>
        </div>
      )}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: 12,
      }}>
        {sorted.map(({ group, standings }) => (
          <GroupCard
            key={group.groupId}
            group={group}
            standings={standings}
            onTeamClick={onTeamClick}
            teamsPlayingToday={teamsPlayingToday}
            isMobile={isMobile}
          />
        ))}
      </div>

      <Legend />

      {/* Mejores Terceros */}
      {bestThirds && bestThirds.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--sp-text-40)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 8,
          }}>
            Mejores Terceros Clasificados
          </div>
          <div style={{
            backgroundColor: 'var(--sp-surface-card)',
            border: '1px solid var(--sp-border-8)',
            borderRadius: 10,
            overflow: 'hidden',
          }}>
            <div style={{ padding: '8px 0 4px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <ColHeaders isMobile={isMobile} />
              {bestThirds.map((entry) => (
                <TeamRow
                  key={entry.teamId}
                  entry={entry}
                  onClick={onTeamClick ? () => onTeamClick(entry.teamId) : undefined}
                  isPlaying={teamsPlayingToday?.has(entry.teamId) ?? false}
                  isMobile={isMobile}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
