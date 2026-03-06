import type { TeamScoreDTO } from '../types/snapshot.js';
import { formatDateTime } from '../utils/format-date.js';

interface MobileTeamListProps {
  teams: TeamScoreDTO[];
  focusedTeamId: string | null;
  onSelectTeam: (teamId: string) => void;
  timezone: string;
}

export function MobileTeamList({ teams, focusedTeamId, onSelectTeam, timezone }: MobileTeamListProps) {
  const sorted = [...teams].sort((a, b) => b.displayScore - a.displayScore);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 12px',
        overflowY: 'auto',
      }}
    >
      {sorted.map((team, idx) => {
        const nm = team.nextMatch;
        const played = nm?.scoreHome !== undefined;
        const scoreBar = Math.round(team.displayScore * 100);
        const isFocused = team.teamId === focusedTeamId;

        return (
          <div
            key={team.teamId}
            onClick={() => onSelectTeam(team.teamId)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 12px',
              borderRadius: 10,
              backgroundColor: isFocused ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)',
              border: isFocused ? '1px solid rgba(255,255,255,0.3)' : '1px solid rgba(255,255,255,0.08)',
              cursor: 'pointer',
            }}
          >
            {/* Rank */}
            <div
              style={{
                minWidth: 22,
                fontSize: 12,
                color: 'rgba(255,255,255,0.4)',
                textAlign: 'center',
              }}
            >
              {idx + 1}
            </div>

            {/* Crest */}
            {team.crestUrl ? (
              <img
                src={team.crestUrl}
                alt={team.teamName}
                style={{ width: 32, height: 32, objectFit: 'contain', flexShrink: 0 }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  flexShrink: 0,
                }}
              />
            )}

            {/* Name + match info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#fff',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {team.teamName}
              </div>
              {nm && (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
                  {played
                    ? `${nm.scoreHome} - ${nm.scoreAway} vs ${nm.opponentName ?? '?'}`
                    : nm.opponentName
                      ? `vs ${nm.opponentName} · ${formatDateTime(nm.kickoffUtc, timezone)}`
                      : formatDateTime(nm.kickoffUtc, timezone)
                  }
                </div>
              )}
            </div>

            {/* Score bar + value */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{scoreBar}</div>
              <div
                style={{
                  width: 48,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: 'rgba(255,255,255,0.15)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${scoreBar}%`,
                    height: '100%',
                    borderRadius: 2,
                    backgroundColor: scoreBar >= 70 ? '#f87171' : scoreBar >= 40 ? '#fb923c' : '#60a5fa',
                  }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
