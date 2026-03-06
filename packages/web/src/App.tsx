import { useState, useEffect } from 'react';
import { DashboardLayout } from './components/DashboardLayout.js';
import { StandingsTable } from './components/StandingsTable.js';
import { DetailPanel } from './components/DetailPanel.js';
import { useStandings } from './hooks/use-standings.js';
import { useCompetitionInfo } from './hooks/use-competition-info.js';
import { useTeamDetail } from './hooks/use-team-detail.js';
import { useWindowWidth } from './hooks/use-window-width.js';
import { useTeamsPlayingToday } from './hooks/use-teams-playing-today.js';
import { competitionDisplayName } from './utils/labels.js';

type ViewMode = 'treemap' | 'partidos' | 'standings';

const COMPETITIONS = [
  { id: 'comp:football-data:PD', code: 'PD' },
  { id: 'comp:football-data:PL', code: 'PL' },
  { id: 'comp:football-data:BL1', code: 'BL1' },
];

export function App() {
  const [competitionId, setCompetitionId] = useState(COMPETITIONS[0].id);
  const [matchday, setMatchday] = useState<number | null>(null);
  const [view, setView] = useState<ViewMode>('treemap');
  const [standingsFocusId, setStandingsFocusId] = useState<string | null>(null);
  const { data: compInfo, loading: compInfoLoading } = useCompetitionInfo(competitionId);
  const { data: standings, loading: standingsLoading } = useStandings(competitionId, view === 'standings');
  const teamsPlayingToday = useTeamsPlayingToday(
    competitionId,
    view === 'standings' ? (compInfo?.currentMatchday ?? null) : null,
    'America/Montevideo',
  );
  const { data: standingsTeamDetail } = useTeamDetail(
    competitionId,
    view === 'standings' ? standingsFocusId : null,
    compInfo?.currentMatchday ?? null,
    'America/Montevideo',
  );

  // When competition changes: reset matchday and standings focus
  useEffect(() => {
    setMatchday(null);
    setStandingsFocusId(null);
  }, [competitionId]);

  // When compInfo loads: set default matchday for the current competition
  useEffect(() => {
    if (!compInfo) return;
    const defaultMatchday = compInfo.currentMatchday ?? compInfo.lastPlayedMatchday;
    if (defaultMatchday) setMatchday(defaultMatchday);
  }, [compInfo]);

  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';
  const totalMatchdays = compInfo?.totalMatchdays ?? 38;
  const matchdayOptions = Array.from({ length: totalMatchdays }, (_, i) => i + 1);

  const selectStyle: React.CSSProperties = {
    backgroundColor: '#1e293b',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: 6,
    padding: isMobile ? '5px 8px' : '6px 10px',
    fontSize: isMobile ? 12 : 13,
    cursor: 'pointer',
    flex: isMobile ? 1 : undefined,
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#0f172a',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: isMobile ? 8 : 12,
          padding: isMobile ? '6px 12px' : '8px 16px',
          alignItems: 'center',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        {/* Fila 1: logo + botones vista */}
        <img
          src="/logo.png"
          alt="SportsPulse"
          onClick={() => setView('treemap')}
          style={{ height: isMobile ? 36 : 56, width: 'auto', cursor: 'pointer' }}
        />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {(['treemap', 'partidos', 'standings'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                backgroundColor: view === v ? 'rgba(255,255,255,0.15)' : 'transparent',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 6,
                padding: isMobile ? '5px 10px' : '6px 12px',
                fontSize: isMobile ? 12 : 12,
                cursor: 'pointer',
                fontWeight: view === v ? 700 : 400,
              }}
            >
              {v === 'treemap' ? 'Mapa' : v === 'partidos' ? 'Partidos' : 'Tabla'}
            </button>
          ))}
        </div>

        {/* Fila 2 en mobile: selects a ancho completo */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            width: isMobile ? '100%' : undefined,
          }}
        >
          <select
            value={competitionId}
            onChange={(e) => setCompetitionId(e.target.value)}
            style={selectStyle}
          >
            {COMPETITIONS.map((c) => (
              <option key={c.id} value={c.id}>
                {competitionDisplayName(c.id)}
              </option>
            ))}
          </select>
          <select
            value={matchday ?? ''}
            onChange={(e) => {
              setMatchday(Number(e.target.value));
              if (view === 'standings') setView('treemap');
            }}
            disabled={compInfoLoading || !compInfo}
            style={{ ...selectStyle, opacity: compInfoLoading ? 0.5 : 1 }}
          >
            {compInfoLoading ? (
              <option value="">Cargando...</option>
            ) : (
              matchdayOptions.map((md) => (
                <option key={md} value={md}>
                  Jornada {md}{md === compInfo?.currentMatchday ? ' ✓' : ''}
                </option>
              ))
            )}
          </select>
        </div>
      </div>
      {view === 'treemap' || view === 'partidos' ? (
        <DashboardLayout
          competitionId={competitionId}
          matchday={matchday}
          currentMatchday={compInfo?.currentMatchday ?? null}
          timezone="America/Montevideo"
          viewMode={view}
        />
      ) : (
        <div style={{ padding: 16 }}>
          {standingsLoading && <div style={{ color: '#fff', opacity: 0.5 }}>Cargando tabla...</div>}
          {standings && (
            <StandingsTable
              standings={standings}
              onTeamClick={(id) => setStandingsFocusId((prev) => (prev === id ? null : id))}
              competitionId={competitionId}
              teamsPlayingToday={teamsPlayingToday}
            />
          )}
          {standingsFocusId && standingsTeamDetail && (
            <DetailPanel detail={standingsTeamDetail} onClose={() => setStandingsFocusId(null)} />
          )}
        </div>
      )}
    </div>
  );
}
