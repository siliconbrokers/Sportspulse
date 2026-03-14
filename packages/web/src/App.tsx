import { useState, useEffect } from 'react';
import { DashboardLayout } from './components/DashboardLayout.js';
import { StandingsTable } from './components/StandingsTable.js';
import { TopScorers } from './components/TopScorers.js';
import { MatchdayCarousel } from './components/MatchdayCarousel.js';
import { TournamentView } from './components/TournamentView.js';
import { TournamentPartidosView } from './components/TournamentPartidosView.js';
import { DetailPanel } from './components/DetailPanel.js';
import { HomePortal } from './components/HomePortal.js';
import { PronosticosView } from './components/pronosticos/PronosticosView.js';
import { TournamentPronosticosView } from './components/pronosticos/TournamentPronosticosView.js';
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
import { PredictionsLabPage } from './labs/PredictionsLabPage.js';
import { EvaluationLabPage } from './labs/EvaluationLabPage.js';
import { HistoricalEvaluationLabPage } from './labs/HistoricalEvaluationLabPage.js';
import { getCompMeta } from './utils/competition-meta.js';
import { SubTournamentSelector } from './components/SubTournamentSelector.js';

function SubTournamentEmptyState() {
  return (
    <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--sp-text-40)', fontSize: 14 }}>
      Sin partidos para este torneo aún
    </div>
  );
}

// spec §16 — detectar si la ruta actual es el player de reproducción
function isPlayerTestRoute(): boolean {
  const p = window.location.pathname;
  return p.startsWith('/eventos/player-test') || p.startsWith('/eventos/ver');
}

// PE-76 — ruta interna de diagnóstico (no expuesta en Navbar)
function isLabsRoute(): boolean {
  return window.location.pathname.startsWith('/labs/');
}

const COMPETITIONS = [
  { id: 'comp:thesportsdb:4432', code: '4432', isTournament: false },
  { id: 'comp:sportsdb-ar:4406', code: '4406-ar', isTournament: false },
  { id: 'comp:football-data:PD', code: 'PD', isTournament: false },
  { id: 'comp:football-data:PL', code: 'PL', isTournament: false },
  { id: 'comp:openligadb:bl1', code: 'BL1', isTournament: false },
  { id: 'comp:football-data-cli:CLI', code: 'CLI', isTournament: true },
  { id: 'comp:football-data-wc:WC', code: 'WC', isTournament: true },
];

export function AppRoot() {
  if (isPlayerTestRoute()) {
    return <EventPlayerTest />;
  }
  if (isLabsRoute()) {
    const path = window.location.pathname;
    if (path.startsWith('/labs/evaluacion-historica')) return <HistoricalEvaluationLabPage />;
    if (path.startsWith('/labs/evaluacion')) return <EvaluationLabPage />;
    return <PredictionsLabPage />;
  }
  return <App />;
}

function App() {
  const [competitionId, setCompetitionId] = useState(COMPETITIONS[0].id);
  const [matchday, setMatchday] = useState<number | null>(null);
  const [view, setView] = useState<ViewMode>('home');
  const [standingsFocusId, setStandingsFocusId] = useState<string | null>(null);
  const [tournamentFocusId, setTournamentFocusId] = useState<string | null>(null);
  const [tournamentFocusDate, setTournamentFocusDate] = useState<string | null>(null);
  const [hasLiveMatches, setHasLiveMatches] = useState(false);
  const [tvTab, setTvTab] = useState<'hoy' | 'manana'>('hoy');
  const [subTournamentKey, setSubTournamentKey] = useState<string | undefined>(undefined);

  const currentComp = COMPETITIONS.find((c) => c.id === competitionId) ?? COMPETITIONS[0];
  const isTournament = currentComp.isTournament;

  const { data: compInfo, loading: compInfoLoading } = useCompetitionInfo(competitionId, subTournamentKey);
  const { data: standings, loading: standingsLoading } = useStandings(
    competitionId,
    view === 'standings' && !isTournament,
    subTournamentKey,
  );
  const { teamsPlayingToday, teamsPlayingLive } = useTeamsPlayingToday(
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
  const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Montevideo' });
  const { data: tournamentTeamDetail } = useTeamDetail(
    competitionId,
    view === 'standings' && isTournament ? tournamentFocusId : null,
    null,
    'America/Montevideo',
    tournamentFocusDate ?? todayLocal,
  );
  const { data: scorers, loading: scorersLoading } = useScorers(
    competitionId,
    view === 'standings' && !isTournament,
  );

  // Cuando cambia la liga: resetear jornada, foco y sub-torneo
  useEffect(() => {
    setMatchday(null);
    setStandingsFocusId(null);
    setTournamentFocusId(null);
    setTournamentFocusDate(null);
    setSubTournamentKey(undefined); // se resolverá al activo según compInfo
  }, [competitionId]);

  // Cuando carga compInfo y hay sub-torneos: seleccionar el activo por defecto
  useEffect(() => {
    if (!compInfo?.subTournaments?.length) return;
    if (subTournamentKey) return; // ya hay selección explícita
    const active = compInfo.activeSubTournament;
    if (active) setSubTournamentKey(active);
  }, [compInfo, subTournamentKey]);

  // Cuando carga compInfo: setear jornada por defecto
  useEffect(() => {
    if (!compInfo) return;
    const defaultMatchday =
      compInfo.currentMatchday ?? compInfo.lastPlayedMatchday ?? compInfo.nextMatchday;
    if (defaultMatchday) setMatchday(defaultMatchday);
  }, [compInfo]);

  const { breakpoint } = useWindowWidth();
  const isMobile = breakpoint === 'mobile';
  const totalMatchdays = compInfo?.totalMatchdays ?? 38;
  const activeMatchday = compInfo
    ? (compInfo.currentMatchday ?? compInfo.nextMatchday ?? null)
    : null;

  function handleMatchdayChange(md: number) {
    setMatchday(md);
    if (view === 'standings') setView('tv');
  }

  // True cuando el sub-torneo seleccionado no tiene datos todavía
  const selectedSubTournamentEmpty =
    !!subTournamentKey &&
    compInfo?.subTournaments?.some((s) => s.key === subTournamentKey && !s.hasData) === true;

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
        competitions={COMPETITIONS.filter((c) => !c.hidden)}
        hasLiveMatches={hasLiveMatches}
        tvTab={tvTab}
        onTvTabChange={setTvTab}
        isTournament={isTournament}
      />

      {/* ── Contenido principal ─────────────────────────────────────────── */}
      {view === 'home' ? (
        <HomePortal />
      ) : view === 'pronosticos' ? (
        <div style={{ padding: isMobile ? '12px 12px' : '16px 20px', maxWidth: 1400, margin: '0 auto' }}>
          {isTournament ? (
            <TournamentPronosticosView competitionId={competitionId} />
          ) : (
            <>
              {/* Sub-torneo selector — solo en ligas con Clausura/Apertura/etc. */}
              {(compInfo?.subTournaments?.length ?? 0) > 1 && (
                <div style={{ marginBottom: isMobile ? 8 : 12 }}>
                  <SubTournamentSelector
                    subTournaments={compInfo!.subTournaments}
                    selected={subTournamentKey ?? null}
                    onChange={(key) => { setSubTournamentKey(key); setMatchday(null); }}
                  />
                </div>
              )}
              {selectedSubTournamentEmpty ? (
                <SubTournamentEmptyState />
              ) : (
                <>
                  {/* Carousel de jornada — solo en ligas */}
                  <div style={{ marginBottom: isMobile ? 12 : 16 }}>
                    <MatchdayCarousel
                      totalMatchdays={totalMatchdays}
                      selected={matchday}
                      currentMatchday={activeMatchday}
                      onChange={setMatchday}
                      isMobile={isMobile}
                    />
                  </div>
                  <PronosticosView
                    competitionId={competitionId}
                    matchday={matchday}
                  />
                </>
              )}
            </>
          )}
        </div>
      ) : view === 'tv' ? (
        <EventsSection activeTab={tvTab} onTabChange={setTvTab} />
      ) : view === 'partidos' ? (
        isTournament ? (
          <div style={{ padding: isMobile ? '12px' : '16px 20px', maxWidth: 1100, margin: '0 auto' }}>
            <TournamentPartidosView
              competitionId={competitionId}
              accent={getCompMeta(competitionId)?.accent}
            />
          </div>
        ) : (
          <>
            {/* Sub-torneo selector — solo en ligas con Clausura/Apertura/etc. */}
            {(compInfo?.subTournaments?.length ?? 0) > 1 && (
              <div style={{ padding: isMobile ? '8px 12px 0' : '12px 20px 0', maxWidth: 1100, margin: '0 auto' }}>
                <SubTournamentSelector
                  subTournaments={compInfo!.subTournaments}
                  selected={subTournamentKey ?? null}
                  onChange={(key) => { setSubTournamentKey(key); setMatchday(null); }}
                />
              </div>
            )}
            {selectedSubTournamentEmpty ? (
              <div style={{ padding: isMobile ? '16px 12px' : '24px 20px', maxWidth: 1100, margin: '0 auto' }}>
                <SubTournamentEmptyState />
              </div>
            ) : (
              <>
                {/* Carousel de jornada — solo en ligas */}
                <div style={{ padding: isMobile ? '8px 12px 0' : '12px 20px 0', maxWidth: 1100, margin: '0 auto' }}>
                  <MatchdayCarousel
                    totalMatchdays={totalMatchdays}
                    selected={matchday}
                    currentMatchday={activeMatchday}
                    onChange={setMatchday}
                    isMobile={isMobile}
                  />
                </div>
                <DashboardLayout
                  competitionId={competitionId}
                  matchday={matchday}
                  currentMatchday={activeMatchday}
                  timezone="America/Montevideo"
                  viewMode={view}
                  onLiveMatchesChange={setHasLiveMatches}
                  subTournamentKey={subTournamentKey}
                />
              </>
            )}
          </>
        )
      ) : (
        /* standings — sin carousel de jornada, la tabla refleja posiciones actuales */
        <div style={{ padding: isMobile ? '12px' : '16px 20px', maxWidth: 1100, margin: '0 auto' }}>
          {isTournament ? (
            <>
              <TournamentView
                competitionId={competitionId}
                accent={getCompMeta(competitionId)?.accent}
                startDate={getCompMeta(competitionId)?.startDate}
                phases={getCompMeta(competitionId)?.phases ?? ['grupos', 'eliminatorias']}
                onSelectTeam={(id, dateLocal) => {
                  setTournamentFocusId((prev) => (prev === id ? null : id));
                  setTournamentFocusDate(dateLocal ?? todayLocal);
                }}
              />
              {tournamentFocusId && tournamentTeamDetail && (
                <DetailPanel
                  detail={tournamentTeamDetail}
                  onClose={() => setTournamentFocusId(null)}
                />
              )}
            </>
          ) : (
            <>
              {/* Sub-torneo selector — solo en ligas con Clausura/Apertura/etc. */}
              {(compInfo?.subTournaments?.length ?? 0) > 1 && (
                <div style={{ marginBottom: isMobile ? 12 : 16 }}>
                  <SubTournamentSelector
                    subTournaments={compInfo!.subTournaments}
                    selected={subTournamentKey ?? null}
                    onChange={(key) => { setSubTournamentKey(key); }}
                  />
                </div>
              )}

              {selectedSubTournamentEmpty ? (
                <SubTournamentEmptyState />
              ) : (
              /* ── Bento: Tabla (2/3) + Goleadores (1/3) ──────────────── */
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
                      teamsPlayingLive={teamsPlayingLive}
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
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
