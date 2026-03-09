import { useState, useEffect } from 'react';
import { DashboardLayout } from './components/DashboardLayout.js';
import { StandingsTable } from './components/StandingsTable.js';
import { TopScorers } from './components/TopScorers.js';
import { MatchdayCarousel } from './components/MatchdayCarousel.js';
import { TournamentView } from './components/TournamentView.js';
import { DetailPanel } from './components/DetailPanel.js';
import { HomePortal } from './components/HomePortal.js';
import { PronosticosView } from './components/pronosticos/PronosticosView.js';
import { Navbar } from './components/Navbar.js';
import type { ViewMode } from './components/Navbar.js';
import { useStandings } from './hooks/use-standings.js';
import { useCompetitionInfo } from './hooks/use-competition-info.js';
import { useTeamDetail } from './hooks/use-team-detail.js';
import { useWindowWidth } from './hooks/use-window-width.js';
import { useTeamsPlayingToday } from './hooks/use-teams-playing-today.js';
import { useScorers } from './hooks/use-scorers.js';
import { EventPlayerTest } from './components/eventos/EventPlayerTest.js';
import { EventsSection } from './components/eventos/EventsSection.js';

// spec §16 — detectar si la ruta actual es el player de reproducción
function isPlayerTestRoute(): boolean {
  const p = window.location.pathname;
  return p.startsWith('/eventos/player-test') || p.startsWith('/eventos/ver');
}

const COMPETITIONS = [
  { id: 'comp:thesportsdb:4432', code: '4432', isTournament: false },
  { id: 'comp:football-data:PD', code: 'PD', isTournament: false },
  { id: 'comp:football-data:PL', code: 'PL', isTournament: false },
  { id: 'comp:openligadb:bl1', code: 'BL1', isTournament: false },
  { id: 'comp:football-data-wc:WC', code: 'WC', isTournament: true },
];

export function AppRoot() {
  if (isPlayerTestRoute()) {
    return <EventPlayerTest />;
  }
  return <App />;
}

function App() {
  const [competitionId, setCompetitionId] = useState(COMPETITIONS[0].id);
  const [matchday, setMatchday] = useState<number | null>(null);
  const [view, setView] = useState<ViewMode>('home');
  const [standingsFocusId, setStandingsFocusId] = useState<string | null>(null);
  const [hasLiveMatches, setHasLiveMatches] = useState(false);
  const [tvTab, setTvTab] = useState<'hoy' | 'manana'>('hoy');

  const currentComp = COMPETITIONS.find((c) => c.id === competitionId) ?? COMPETITIONS[0];
  const isTournament = currentComp.isTournament;

  const { data: compInfo, loading: compInfoLoading } = useCompetitionInfo(competitionId);
  const { data: standings, loading: standingsLoading } = useStandings(
    competitionId,
    view === 'standings' && !isTournament,
  );
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
  const { data: scorers, loading: scorersLoading } = useScorers(
    competitionId,
    view === 'standings' && !isTournament,
  );

  // Cuando cambia la liga: resetear jornada y foco
  useEffect(() => {
    setMatchday(null);
    setStandingsFocusId(null);
  }, [competitionId]);

  // Cuando carga compInfo: setear jornada por defecto
  useEffect(() => {
    if (!compInfo) return;
    const defaultMatchday = compInfo.currentMatchday ?? compInfo.lastPlayedMatchday;
    if (defaultMatchday) setMatchday(defaultMatchday);
  }, [compInfo]);

  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';
  const totalMatchdays = compInfo?.totalMatchdays ?? 38;

  function handleMatchdayChange(md: number) {
    setMatchday(md);
    if (view === 'standings') setView('tv');
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        overflowX: 'hidden',
        backgroundColor: 'var(--sp-bg)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        transition: 'background-color 0.2s ease',
      }}
    >
      <Navbar
        view={view}
        onViewChange={setView}
        competitionId={competitionId}
        onCompetitionChange={(id) => { setCompetitionId(id); }}
        competitions={COMPETITIONS}
        hasLiveMatches={hasLiveMatches}
        tvTab={tvTab}
        onTvTabChange={setTvTab}
      />

      {/* ── Contenido principal ─────────────────────────────────────────── */}
      {view === 'home' ? (
        <HomePortal />
      ) : view === 'pronosticos' ? (
        <div style={{ padding: isMobile ? '12px 12px' : '16px 20px', maxWidth: 1400, margin: '0 auto' }}>
          {/* Carousel de jornada */}
          <div style={{ marginBottom: isMobile ? 12 : 16 }}>
            <MatchdayCarousel
              totalMatchdays={totalMatchdays}
              selected={matchday}
              currentMatchday={compInfo?.currentMatchday ?? null}
              onChange={setMatchday}
              isMobile={isMobile}
            />
          </div>
          <PronosticosView
            competitionId={competitionId}
            matchday={matchday}
          />
        </div>
      ) : view === 'tv' ? (
        <EventsSection activeTab={tvTab} onTabChange={setTvTab} />
      ) : view === 'partidos' ? (
        isTournament ? (
          <div style={{ padding: isMobile ? 12 : 24, color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
            Seleccioná la pestaña{' '}
            <strong style={{ color: '#f97316' }}>📊 Tabla</strong>{' '}
            para ver grupos y eliminatorias del torneo.
          </div>
        ) : (
          <>
            {/* Carousel de jornada — solo en vista Partidos */}
            {view === 'partidos' && (
              <div style={{ padding: isMobile ? '8px 12px 0' : '12px 20px 0', maxWidth: 1100, margin: '0 auto' }}>
                <MatchdayCarousel
                  totalMatchdays={totalMatchdays}
                  selected={matchday}
                  currentMatchday={compInfo?.currentMatchday ?? null}
                  onChange={setMatchday}
                  isMobile={isMobile}
                />
              </div>
            )}
            <DashboardLayout
              competitionId={competitionId}
              matchday={matchday}
              currentMatchday={compInfo?.currentMatchday ?? null}
              timezone="America/Montevideo"
              viewMode={view}
              onLiveMatchesChange={setHasLiveMatches}
            />
          </>
        )
      ) : (
        /* standings — sin carousel de jornada, la tabla refleja posiciones actuales */
        <div style={{ padding: isMobile ? '12px' : '16px 20px', maxWidth: 1100, margin: '0 auto' }}>
          {isTournament ? (
            <TournamentView competitionId={competitionId} />
          ) : (
            <>

              {/* ── Bento: Tabla (2/3) + Goleadores (1/3) ──────────────── */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile ? '1fr' : '1fr minmax(0, 340px)',
                  gap: isMobile ? 16 : 20,
                  alignItems: 'start',
                }}
              >
                {/* Tabla de posiciones */}
                <div>
                  {standingsLoading && (
                    <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, padding: '24px 0' }}>
                      Cargando tabla...
                    </div>
                  )}
                  {standings && (
                    <StandingsTable
                      standings={standings}
                      onTeamClick={(id) => setStandingsFocusId((prev) => (prev === id ? null : id))}
                      competitionId={competitionId}
                      teamsPlayingToday={teamsPlayingToday}
                    />
                  )}
                  {standingsFocusId && standingsTeamDetail && (
                    <DetailPanel
                      detail={standingsTeamDetail}
                      onClose={() => setStandingsFocusId(null)}
                    />
                  )}
                </div>

                {/* Widget Goleadores */}
                <TopScorers scorers={scorers} loading={scorersLoading} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
