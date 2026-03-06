import type { MatchCardDTO } from '../types/snapshot.js';

interface MatchCardListProps {
  matchCards: MatchCardDTO[];
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
  teamId,
  name,
  crestUrl,
  formChip,
  align,
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

export function MatchCardList({ matchCards }: MatchCardListProps) {
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
      {matchCards.map((card) => (
        <div
          key={card.matchId}
          style={{
            backgroundColor: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.09)',
            borderRadius: 12,
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {/* Time chip */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <span style={chipStyle(card.timeChip.level)}>
              {card.timeChip.icon} {card.timeChip.label}
            </span>
          </div>

          {/* Teams row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <TeamSide
              teamId={card.home.teamId}
              name={card.home.name}
              crestUrl={card.home.crestUrl}
              formChip={card.home.formChip}
              align="left"
            />
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: 'rgba(255,255,255,0.35)',
                flexShrink: 0,
              }}
            >
              vs
            </span>
            <TeamSide
              teamId={card.away.teamId}
              name={card.away.name}
              crestUrl={card.away.crestUrl}
              formChip={card.away.formChip}
              align="right"
            />
          </div>

          {/* Explain line */}
          {card.explainLine && (
            <div
              style={{
                fontSize: 11,
                color: 'rgba(255,255,255,0.3)',
                textAlign: 'center',
                borderTop: '1px solid rgba(255,255,255,0.06)',
                paddingTop: 8,
              }}
            >
              {card.explainLine.text}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
