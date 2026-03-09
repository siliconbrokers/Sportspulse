/**
 * TournamentView — vista principal de torneos con fase de grupos + eliminatorias.
 *
 * Tabs:
 *   - Grupos: tabla de posiciones por grupo + mejores terceros
 *   - Eliminatorias: bracket de rondas eliminatorias
 *
 * Responsive: mobile y desktop.
 */
import { useState } from 'react';
import { useGroupStandings } from '../hooks/use-group-standings.js';
import { useKnockoutBracket } from '../hooks/use-knockout-bracket.js';
import { GroupStandingsView } from './GroupStandingsView.js';
import { KnockoutBracket } from './KnockoutBracket.js';
import { useWindowWidth } from '../hooks/use-window-width.js';
import { computeBestThirds } from '../utils/best-thirds.js';

interface TournamentViewProps {
  competitionId: string;
}

type TournamentTab = 'grupos' | 'eliminatorias';

export function TournamentView({ competitionId }: TournamentViewProps) {
  const [tab, setTab] = useState<TournamentTab>('grupos');
  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';

  const {
    data: groupData,
    loading: groupLoading,
    error: groupError,
  } = useGroupStandings(competitionId, tab === 'grupos');

  const {
    data: bracketData,
    loading: bracketLoading,
    error: bracketError,
  } = useKnockoutBracket(competitionId, tab === 'eliminatorias');

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: isMobile ? '8px 16px' : '8px 20px',
    fontSize: 13,
    fontWeight: active ? 700 : 400,
    cursor: 'pointer',
    border: 'none',
    borderBottom: active ? '2px solid #f97316' : '2px solid transparent',
    backgroundColor: 'transparent',
    color: active ? '#f97316' : 'rgba(255,255,255,0.55)',
    transition: 'color 0.15s',
    minHeight: 44,
  });

  return (
    <div>
      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          marginBottom: 16,
        }}
      >
        <button style={tabStyle(tab === 'grupos')} onClick={() => setTab('grupos')}>
          🏟 Grupos
        </button>
        <button style={tabStyle(tab === 'eliminatorias')} onClick={() => setTab('eliminatorias')}>
          🏆 Eliminatorias
        </button>
      </div>

      {/* Tab content */}
      {tab === 'grupos' ? (
        groupLoading ? (
          <LoadingState />
        ) : groupError ? (
          <ErrorState message={groupError} />
        ) : groupData ? (
          <GroupStandingsView
            groups={groupData.groups}
            bestThirds={
              groupData.bestThirdsCount > 0
                ? computeBestThirds(
                    groupData.groups.flatMap((g) => g.standings),
                    groupData.bestThirdsCount,
                  )
                : undefined
            }
          />
        ) : (
          <EmptyState label="datos de grupos" />
        )
      ) : (
        bracketLoading ? (
          <LoadingState />
        ) : bracketError ? (
          <ErrorState message={bracketError} />
        ) : bracketData ? (
          <KnockoutBracket rounds={bracketData} />
        ) : (
          <EmptyState label="cuadro eliminatorio" />
        )
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, padding: '24px 0' }}>
      Cargando...
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div style={{ color: '#ef4444', fontSize: 13, padding: '24px 0' }}>
      Error: {message}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, padding: '24px 0' }}>
      Sin {label} disponibles.
    </div>
  );
}
