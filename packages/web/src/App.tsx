import { useState, useEffect } from 'react';
import { DashboardLayout } from './components/DashboardLayout.js';
import { StandingsTable } from './components/StandingsTable.js';
import { DetailPanel } from './components/DetailPanel.js';
import { useStandings } from './hooks/use-standings.js';
import { useCompetitionInfo } from './hooks/use-competition-info.js';
import { useTeamDetail } from './hooks/use-team-detail.js';
import { useWindowWidth } from './hooks/use-window-width.js';
import { useTeamsPlayingToday } from './hooks/use-teams-playing-today.js';
import { useVideos } from './hooks/use-videos.js';
import { VideoSection } from './components/VideoSection.js';
import { useEvents } from './hooks/use-events.js';
import { EventsSection } from './components/eventos/EventsSection.js';
import { EventPlayerTest } from './components/eventos/EventPlayerTest.js';
import { competitionDisplayName } from './utils/labels.js';

type ViewMode = 'radar' | 'partidos' | 'standings' | 'noticias' | 'eventos';

// spec §16 — detectar si la ruta actual es el player de reproducción
function isPlayerTestRoute(): boolean {
  const p = window.location.pathname;
  return p.startsWith('/eventos/player-test') || p.startsWith('/eventos/ver');
}

const COMPETITIONS = [
  { id: 'comp:thesportsdb:4432', code: '4432' },
  { id: 'comp:football-data:PD', code: 'PD' },
  { id: 'comp:football-data:PL', code: 'PL' },
  { id: 'comp:football-data:BL1', code: 'BL1' },
];

// spec §16 — página de prueba renderizada si la ruta lo indica
export function AppRoot() {
  if (isPlayerTestRoute()) {
    return <EventPlayerTest />;
  }
  return <App />;
}

function App() {
  const [competitionId, setCompetitionId] = useState(COMPETITIONS[0].id);
  const [matchday, setMatchday] = useState<number | null>(null);
  const [view, setView] = useState<ViewMode>('radar');
  const [standingsFocusId, setStandingsFocusId] = useState<string | null>(null);
  const { data: compInfo, loading: compInfoLoading } = useCompetitionInfo(competitionId);
  const { data: standings, loading: standingsLoading } = useStandings(competitionId, view === 'standings');
  const teamsPlayingToday = useTeamsPlayingToday(
    competitionId,
    view === 'standings' ? (compInfo?.currentMatchday ?? null) : null,
    'America/Montevideo',
  );
  const { data: videoFeed, loading: videoLoading, error: videoError } = useVideos(view === 'noticias');
  const { data: eventosFeed, loading: eventosLoading, error: eventosError } = useEvents(view === 'eventos');
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
          onClick={() => setView('radar')}
          style={{ height: isMobile ? 36 : 56, width: 'auto', cursor: 'pointer' }}
        />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {([
            { id: 'radar', label: '📡 Radar' },
            { id: 'partidos', label: '⚽ Partidos' },
            { id: 'standings', label: '📊 Tabla' },
            { id: 'noticias', label: '📹 Videos' },
            { id: 'eventos', label: '🎯 Eventos' },
          ] as { id: ViewMode; label: string }[]).map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              style={{
                backgroundColor: view === v.id ? 'rgba(255,255,255,0.15)' : 'transparent',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 6,
                padding: isMobile ? '5px 10px' : '6px 12px',
                fontSize: 12,
                cursor: 'pointer',
                fontWeight: view === v.id ? 700 : 400,
              }}
            >
              {v.label}
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
              if (view === 'standings') setView('radar');
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
      {view === 'radar' || view === 'partidos' ? (
        <DashboardLayout
          competitionId={competitionId}
          matchday={matchday}
          currentMatchday={compInfo?.currentMatchday ?? null}
          timezone="America/Montevideo"
          viewMode={view}
        />
      ) : view === 'noticias' ? (
        <div style={{ padding: 16 }}>
          <VideoSection feed={videoFeed} loading={videoLoading} error={videoError} />
        </div>
      ) : view === 'eventos' ? (
        <div style={{ padding: isMobile ? '16px 12px' : 24 }}>
          <EventsSection feed={eventosFeed} loading={eventosLoading} error={eventosError} />
        </div>
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
