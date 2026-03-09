/**
 * GroupStandingsView — tablas de posiciones por grupo.
 *
 * Desktop  (≥1024px): 3 columnas
 * Tablet   (640-1024): 2 columnas
 * Mobile   (<640):    1 columna
 *
 * Cada grupo: card con borde sutil + header + filas compactas.
 * Columnas: # | equipo | J | G | E | P | DG | Pts
 */
import { useWindowWidth } from '../hooks/use-window-width.js';
import type { GroupStandingsDTO } from '../types/tournament.js';
import type { StandingEntry } from '../hooks/use-standings.js';

interface GroupStandingsViewProps {
  groups: GroupStandingsDTO[];
  onTeamClick?: (teamId: string) => void;
  teamsPlayingToday?: Set<string>;
  bestThirds?: StandingEntry[];
}

// ── Colores por badge ─────────────────────────────────────────────────────────

const BADGE_COLORS: Record<string, string> = {
  CHAMPION:   '#f59e0b',
  QUALIFIED:  '#22c55e',
  UCL:        '#3b82f6',
  PLAYOFF:    '#eab308',
  ELIMINATED: '#6b7280',
  RELEGATED:  '#ef4444',
};

function badgeColor(badge: string | null | undefined): string {
  if (!badge) return 'rgba(255,255,255,0.07)';
  return BADGE_COLORS[badge.toUpperCase()] ?? '#6b7280';
}

// ── Fila de equipo ────────────────────────────────────────────────────────────

function TeamRow({
  entry,
  onClick,
  isPlaying,
}: {
  entry: StandingEntry;
  onClick?: () => void;
  isPlaying: boolean;
}) {
  const indicator = badgeColor(entry.statusBadge);
  const qualified = entry.statusBadge && entry.statusBadge.toUpperCase() !== 'ELIMINATED' && entry.statusBadge.toUpperCase() !== 'RELEGATED';

  return (
    <div
      onClick={onClick}
      style={{
        display: 'grid',
        // # | nombre | J | G | E | P | DG | Pts
        gridTemplateColumns: '22px 1fr 22px 22px 22px 22px 28px 30px',
        alignItems: 'center',
        padding: '5px 12px 5px 0',
        marginLeft: 0,
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        cursor: onClick ? 'pointer' : 'default',
        backgroundColor: isPlaying ? 'rgba(249,115,22,0.06)' : 'transparent',
        transition: 'background-color 0.12s',
        position: 'relative',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.backgroundColor = isPlaying
          ? 'rgba(249,115,22,0.10)'
          : 'rgba(255,255,255,0.04)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.backgroundColor = isPlaying
          ? 'rgba(249,115,22,0.06)'
          : 'transparent';
      }}
    >
      {/* Posición + indicador de clasificación */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        paddingLeft: 10,
      }}>
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
          color: qualified ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.3)',
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
          <div style={{ width: 15, height: 15, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />
        )}
        <span style={{
          fontSize: 12,
          fontWeight: isPlaying ? 600 : 400,
          color: isPlaying ? '#f97316' : 'rgba(255,255,255,0.88)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {entry.teamName}
        </span>
      </div>

      {/* J */}
      <Stat value={entry.playedGames} />
      {/* G */}
      <Stat value={entry.won} />
      {/* E */}
      <Stat value={entry.draw} />
      {/* P */}
      <Stat value={entry.lost} muted />
      {/* DG */}
      <Stat
        value={entry.goalDifference >= 0 ? `+${entry.goalDifference}` : String(entry.goalDifference)}
        color={entry.goalDifference > 0 ? 'rgba(34,197,94,0.7)' : entry.goalDifference < 0 ? 'rgba(239,68,68,0.6)' : undefined}
      />
      {/* Pts */}
      <span style={{
        fontSize: 12,
        fontWeight: 700,
        textAlign: 'right',
        color: '#fff',
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
      color: color ?? (muted ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.5)'),
      fontVariantNumeric: 'tabular-nums',
    }}>
      {value}
    </span>
  );
}

// ── Cabecera de columnas ──────────────────────────────────────────────────────

function ColHeaders() {
  const hStyle: React.CSSProperties = {
    fontSize: 9,
    fontWeight: 700,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.22)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  };

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '22px 1fr 22px 22px 22px 22px 28px 30px',
      alignItems: 'center',
      padding: '0 12px 5px 0',
      borderBottom: '1px solid rgba(255,255,255,0.07)',
      marginBottom: 2,
    }}>
      <span />
      <span style={{ ...hStyle, textAlign: 'left', paddingLeft: 10, fontSize: 9 }}>Equipo</span>
      <span style={hStyle}>J</span>
      <span style={hStyle}>G</span>
      <span style={hStyle}>E</span>
      <span style={hStyle}>P</span>
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
}: {
  group: GroupStandingsDTO['group'];
  standings: StandingEntry[];
  onTeamClick?: (teamId: string) => void;
  teamsPlayingToday?: Set<string>;
}) {
  return (
    <div style={{
      backgroundColor: 'rgba(255,255,255,0.025)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 12px',
        background: 'rgba(255,255,255,0.04)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <span style={{
          fontSize: 11,
          fontWeight: 800,
          color: 'rgba(255,255,255,0.75)',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
        }}>
          {group.name}
        </span>
      </div>

      {/* Tabla */}
      <div style={{ padding: '8px 0 4px' }}>
        <ColHeaders />
        {standings.map(entry => (
          <TeamRow
            key={entry.teamId}
            entry={entry}
            onClick={onTeamClick ? () => onTeamClick(entry.teamId) : undefined}
            isPlaying={teamsPlayingToday?.has(entry.teamId) ?? false}
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
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.04em' }}>
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
}: GroupStandingsViewProps) {
  const { breakpoint } = useWindowWidth();

  if (groups.length === 0) {
    return (
      <div style={{ fontSize: 13, opacity: 0.4, textAlign: 'center', padding: '24px 0' }}>
        Sin datos de grupos disponibles.
      </div>
    );
  }

  const cols = breakpoint === 'desktop' ? 4 : breakpoint === 'tablet' ? 2 : 1;
  const sorted = [...groups].sort((a, b) => a.group.orderIndex - b.group.orderIndex);

  return (
    <div>
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
          />
        ))}
      </div>

      <Legend />
    </div>
  );
}
