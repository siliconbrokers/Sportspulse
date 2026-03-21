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
              backgroundColor: isFocused ? 'var(--sp-surface-raised)' : 'var(--sp-surface-card)',
              border: isFocused ? '1px solid var(--sp-border-10)' : '1px solid var(--sp-border-8)',
              cursor: 'pointer',
            }}
          >
            {/* Rank */}
            <div
              style={{
                minWidth: 22,
                fontSize: 12,
                color: 'var(--sp-text-40)',
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
                  backgroundColor: 'var(--sp-border-8)',
                  flexShrink: 0,
                }}
              />
            )}

            {/* Name + chips + match info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--sp-text)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {team.teamName}
              </div>
              {/* Display hint chips */}
              {(team.displayHints?.formChip || team.displayHints?.nextMatchChip) && (
                <div style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                  {team.displayHints.formChip && (
                    <span style={{
                      fontSize: 10,
                      color: 'var(--sp-text-70)',
                      backgroundColor: 'var(--sp-border-8)',
                      borderRadius: 4,
                      padding: '1px 5px',
                      whiteSpace: 'nowrap',
                    }}>
                      {team.displayHints.formChip.icon} {team.displayHints.formChip.label}
                    </span>
                  )}
                  {team.displayHints.nextMatchChip && (
                    <span style={{
                      fontSize: 10,
                      color: 'var(--sp-text-70)',
                      backgroundColor: 'var(--sp-border-8)',
                      borderRadius: 4,
                      padding: '1px 5px',
                      whiteSpace: 'nowrap',
                    }}>
                      {team.displayHints.nextMatchChip.icon} {team.displayHints.nextMatchChip.label}
                    </span>
                  )}
                </div>
              )}
              {nm && (
                <div style={{ fontSize: 11, color: 'var(--sp-text-40)', marginTop: 3 }}>
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
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--sp-text)' }}>{scoreBar}</div>
              <div
                style={{
                  width: 48,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: 'var(--sp-border-8)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${scoreBar}%`,
                    height: '100%',
                    borderRadius: 2,
                    backgroundColor: scoreBar >= 70 ? 'var(--sp-status-error)' : scoreBar >= 40 ? 'var(--sp-status-warning)' : 'var(--sp-status-info)',
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
