import type { StandingEntry } from '../hooks/use-standings.js';

type ZoneType = 'ucl' | 'uel' | 'uecl' | 'playoff' | 'relegation' | null;

interface Zone {
  from: number;
  to: number;
  type: ZoneType;
  label: string;
  color: string;
}

const ZONE_CONFIGS: Record<string, Zone[]> = {
  // La Liga (20 equipos)
  'comp:football-data:PD': [
    { from: 1, to: 4, type: 'ucl',       label: 'Champions League', color: '#3b82f6' },
    { from: 5, to: 6, type: 'uel',       label: 'Europa League',    color: '#f97316' },
    { from: 7, to: 7, type: 'uecl',      label: 'Conference League',color: '#14b8a6' },
    { from: 18, to: 20, type: 'relegation', label: 'Descenso',      color: '#ef4444' },
  ],
  // Premier League (20 equipos)
  'comp:football-data:PL': [
    { from: 1, to: 4, type: 'ucl',       label: 'Champions League', color: '#3b82f6' },
    { from: 5, to: 5, type: 'uel',       label: 'Europa League',    color: '#f97316' },
    { from: 6, to: 6, type: 'uecl',      label: 'Conference League',color: '#14b8a6' },
    { from: 18, to: 20, type: 'relegation', label: 'Descenso',      color: '#ef4444' },
  ],
  // Bundesliga (18 equipos)
  'comp:football-data:BL1': [
    { from: 1, to: 4, type: 'ucl',       label: 'Champions League', color: '#3b82f6' },
    { from: 5, to: 5, type: 'uel',       label: 'Europa League',    color: '#f97316' },
    { from: 6, to: 6, type: 'uecl',      label: 'Conference League',color: '#14b8a6' },
    { from: 16, to: 16, type: 'playoff', label: 'Playoff descenso', color: '#eab308' },
    { from: 17, to: 18, type: 'relegation', label: 'Descenso',      color: '#ef4444' },
  ],
  // Serie A (20 equipos)
  'comp:football-data:SA': [
    { from: 1, to: 4, type: 'ucl',       label: 'Champions League', color: '#3b82f6' },
    { from: 5, to: 6, type: 'uel',       label: 'Europa League',    color: '#f97316' },
    { from: 7, to: 7, type: 'uecl',      label: 'Conference League',color: '#14b8a6' },
    { from: 18, to: 20, type: 'relegation', label: 'Descenso',      color: '#ef4444' },
  ],
  // Ligue 1 (18 equipos)
  'comp:football-data:FL1': [
    { from: 1, to: 3, type: 'ucl',       label: 'Champions League', color: '#3b82f6' },
    { from: 4, to: 5, type: 'uel',       label: 'Europa League',    color: '#f97316' },
    { from: 6, to: 6, type: 'uecl',      label: 'Conference League',color: '#14b8a6' },
    { from: 16, to: 16, type: 'playoff', label: 'Playoff descenso', color: '#eab308' },
    { from: 17, to: 18, type: 'relegation', label: 'Descenso',      color: '#ef4444' },
  ],
};

function getZone(competitionId: string, position: number): Zone | null {
  const zones = ZONE_CONFIGS[competitionId] ?? [];
  return zones.find((z) => position >= z.from && position <= z.to) ?? null;
}

function getActiveLegend(competitionId: string): Zone[] {
  return ZONE_CONFIGS[competitionId] ?? [];
}

interface StandingsTableProps {
  standings: StandingEntry[];
  onTeamClick: (teamId: string) => void;
  competitionId: string;
}

export function StandingsTable({ standings, onTeamClick, competitionId }: StandingsTableProps) {
  const legend = getActiveLegend(competitionId);

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table
          data-testid="standings-table"
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 13,
            color: '#fff',
          }}
        >
          <thead>
            <tr style={{ borderBottom: '2px solid rgba(255,255,255,0.15)' }}>
              <th style={thStyle}>#</th>
              <th style={{ ...thStyle, textAlign: 'left', paddingLeft: 8 }}>Equipo</th>
              <th style={thStyle}>PJ</th>
              <th style={thStyle}>G</th>
              <th style={thStyle}>E</th>
              <th style={thStyle}>P</th>
              <th style={thStyle}>GF</th>
              <th style={thStyle}>GC</th>
              <th style={thStyle}>DG</th>
              <th style={{ ...thStyle, fontWeight: 700 }}>Pts</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row, i) => {
              const zone = getZone(competitionId, row.position);
              return (
                <tr
                  key={row.teamId}
                  onClick={() => onTeamClick(row.teamId)}
                  style={{
                    cursor: 'pointer',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    borderLeft: zone ? `4px solid ${zone.color}` : '4px solid transparent',
                    backgroundColor: i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent'; }}
                >
                  <td style={{ ...tdStyle, fontWeight: 700, opacity: 0.6 }}>{row.position}</td>
                  <td style={{ ...tdStyle, textAlign: 'left', paddingLeft: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {row.crestUrl && (
                        <img
                          src={row.crestUrl}
                          alt=""
                          style={{ width: 20, height: 20, objectFit: 'contain' }}
                        />
                      )}
                      <span style={{ fontWeight: 500 }}>{row.teamName}</span>
                    </div>
                  </td>
                  <td style={tdStyle}>{row.playedGames}</td>
                  <td style={tdStyle}>{row.won}</td>
                  <td style={tdStyle}>{row.draw}</td>
                  <td style={tdStyle}>{row.lost}</td>
                  <td style={tdStyle}>{row.goalsFor}</td>
                  <td style={tdStyle}>{row.goalsAgainst}</td>
                  <td style={{
                    ...tdStyle,
                    fontWeight: 600,
                    color: row.goalDifference > 0 ? '#22c55e' : row.goalDifference < 0 ? '#ef4444' : '#6b7280',
                  }}>
                    {row.goalDifference > 0 ? '+' : ''}{row.goalDifference}
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{row.points}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      {legend.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginTop: 12, paddingLeft: 4 }}>
          {legend.map((z) => (
            <div key={z.type} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: z.color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>{z.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '8px 6px',
  textAlign: 'center',
  fontSize: 11,
  opacity: 0.6,
  fontWeight: 400,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const tdStyle: React.CSSProperties = {
  padding: '8px 6px',
  textAlign: 'center',
};
