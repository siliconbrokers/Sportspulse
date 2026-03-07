import { useState } from 'react';
import type { MatchCardDTO } from '../types/snapshot.js';
import { computeLiveTimeChip } from '../utils/time-chip.js';
import './match-map.css';

interface MatchCardListProps {
  matchCards: MatchCardDTO[];
  onSelectTeam?: (teamId: string) => void;
  focusedTeamId?: string | null;
  showForm?: boolean;
}

function chipStyle(level: string): React.CSSProperties {
  const colors: Record<string, string> = {
    HOT: 'rgba(239,68,68,0.25)',
    OK: 'rgba(34,197,94,0.2)',
    WARN: 'rgba(249,115,22,0.2)',
    INFO: 'rgba(255,255,255,0.08)',
    UNKNOWN: 'rgba(255,255,255,0.06)',
    ERROR: 'rgba(239,68,68,0.15)',
  };
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    fontSize: 11,
    padding: '2px 7px',
    borderRadius: 5,
    backgroundColor: colors[level] ?? colors.INFO,
    color: 'rgba(255,255,255,0.85)',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
  };
}

function TeamSide({
  name,
  crestUrl,
  formChip,
  align,
  isSelected,
}: {
  teamId: string;
  name: string;
  crestUrl?: string;
  formChip?: MatchCardDTO['home']['formChip'];
  align: 'left' | 'right';
}) {
  const isRight = align === 'right';
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: isRight ? 'flex-end' : 'flex-start',
        gap: 5,
        minWidth: 0,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexDirection: isRight ? 'row-reverse' : 'row',
        }}
      >
        {crestUrl ? (
          <img
            src={crestUrl}
            alt={name}
            style={{ width: 28, height: 28, objectFit: 'contain', flexShrink: 0 }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              backgroundColor: 'rgba(255,255,255,0.08)',
              flexShrink: 0,
            }}
          />
        )}
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: '#fff',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </span>
      </div>
      {formChip && (
        <span style={chipStyle(formChip.level)}>
          {formChip.icon} {formChip.label}
        </span>
      )}
    </div>
  );
}

export function MatchCardList({ matchCards, onSelectTeam, focusedTeamId, showForm = false }: MatchCardListProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (matchCards.length === 0) {
    return (
      <div
        style={{
          color: 'rgba(255,255,255,0.4)',
          textAlign: 'center',
          padding: '48px 16px',
          fontSize: 14,
        }}
      >
        No hay partidos próximos
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '16px 16px',
        maxWidth: 680,
        margin: '0 auto',
      }}
    >
      {matchCards.map((card) => {
        const isToday = (() => {
          if (card.status === 'LIVE' || card.status === 'FINISHED') return false;
          if (!card.kickoffUtc) return false;
          const hours = (new Date(card.kickoffUtc).getTime() - Date.now()) / (1000 * 60 * 60);
          return hours >= 0 && hours < 24;
        })();

        const isEffectivelyLive = card.status === 'LIVE' || (
          card.status === 'SCHEDULED' && !!card.kickoffUtc &&
          (() => {
            const mins = (Date.now() - new Date(card.kickoffUtc!).getTime()) / 60000;
            return mins >= 0 && mins <= 110;
          })()
        );

        return (
        <div
          key={card.matchId}
          className={isToday ? 'mm-tile--today' : undefined}
          onMouseEnter={() => setHoveredId(card.matchId)}
          onMouseLeave={() => setHoveredId(null)}
          onClick={onSelectTeam ? (e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const teamId = (e.clientX - rect.left) < rect.width / 2
              ? card.home.teamId
              : card.away.teamId;
            onSelectTeam(teamId);
          } : undefined}
          style={{
            backgroundColor: hoveredId === card.matchId
              ? 'rgba(255,255,255,0.09)'
              : 'rgba(255,255,255,0.05)',
            border: hoveredId === card.matchId
              ? '1px solid rgba(255,255,255,0.2)'
              : '1px solid rgba(255,255,255,0.09)',
            borderRadius: 12,
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            cursor: onSelectTeam ? 'pointer' : undefined,
            transition: 'background-color 0.18s ease, border-color 0.18s ease',
          }}
        >
          {/* Time chip — calculado en cliente para no depender del cache del backend */}
          {(() => {
            const tc = computeLiveTimeChip(card.status, card.kickoffUtc);
            return (
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <span style={chipStyle(tc.level)}>
                  {tc.icon} {tc.label}
                </span>
              </div>
            );
          })()}

          {/* Teams row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <TeamSide
              teamId={card.home.teamId}
              name={card.home.name}
              crestUrl={card.home.crestUrl}
              formChip={showForm ? card.home.formChip : undefined}
              align="left"
            />
            <div
              style={{
                flexShrink: 0,
                textAlign: 'center',
                minWidth: 48,
              }}
            >
              {(card.status === 'FINISHED' || isEffectivelyLive) && card.scoreHome != null && card.scoreAway != null ? (
                <span style={{ fontSize: 20, fontWeight: 800, color: '#fff', letterSpacing: 2 }}>
                  {card.scoreHome} - {card.scoreAway}
                </span>
              ) : (
                <span style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.35)' }}>
                  vs
                </span>
              )}
            </div>
            <TeamSide
              teamId={card.away.teamId}
              name={card.away.name}
              crestUrl={card.away.crestUrl}
              formChip={showForm ? card.away.formChip : undefined}
              align="right"
            />
          </div>

        </div>
        );
      })}
    </div>
  );
}
