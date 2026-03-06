import type { StandingEntry } from '../hooks/use-standings.js';

interface StandingsTableProps {
  standings: StandingEntry[];
  onTeamClick: (teamId: string) => void;
}

export function StandingsTable({ standings, onTeamClick }: StandingsTableProps) {
  return (
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
          {standings.map((row, i) => (
            <tr
              key={row.teamId}
              onClick={() => onTeamClick(row.teamId)}
              style={{
                cursor: 'pointer',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
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
          ))}
        </tbody>
      </table>
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
