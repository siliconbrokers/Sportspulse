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
import { TrainingLabPage } from './labs/TrainingLabPage.js';
import { getCompMeta } from './utils/competition-meta.js';
import { SubTournamentSelector } from './components/SubTournamentSelector.js';
import { usePortalConfig } from './hooks/use-portal-config.js';
import type { PortalConfig } from './hooks/use-portal-config.js';
import { AdminPage } from './admin/AdminPage.js';
import { OpsApiUsagePage } from './admin/OpsApiUsagePage.js';
import { ServerBootScreen } from './components/ServerBootScreen.js';

function SubTournamentEmptyState() {
  return (
    <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--sp-text-40)', fontSize: 14 }}>
      Sin partidos para este torneo aún
    </div>
  );
}

function NoCompetitionsState() {
  return (
    <div style={{ padding: '60px 24px', textAlign: 'center', color: 'var(--sp-text-40)', fontSize: 14 }}>
      No hay ninguna liga ni torneo habilitado en el portal
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

function isOpsRoute(): boolean {
  return window.location.pathname.startsWith('/admin/ops');
}

function isAdminRoute(): boolean {
  return window.location.pathname.startsWith('/admin');
}

// COMP_META_STATIC eliminado — isTournament y code (slug) ahora vienen de portal-config.
// El backend enriquece CompetitionEntry con estos campos desde competition-registry.ts.

export function AppRoot() {
  if (isPlayerTestRoute()) {
    return <EventPlayerTest />;
  }
  if (isOpsRoute()) {
    return <OpsApiUsagePage />;
  }
  if (isAdminRoute()) {
    return <AdminPage />;
  }
  if (isLabsRoute()) {
    const path = window.location.pathname;
    if (path.startsWith('/labs/evaluacion-historica')) return <HistoricalEvaluationLabPage />;
    if (path.startsWith('/labs/evaluacion')) return <EvaluationLabPage />;
    if (path.startsWith('/labs/entrenamiento')) return <TrainingLabPage />;
    return <PredictionsLabPage />;
  }
  return <BootGate />;
}

// BootGate: espera que el servidor esté listo antes de montar App.
// Esto evita violar Rules of Hooks (early return dentro de App con hooks posteriores).
function BootGate() {
  const { config: portalConfig, serverReady } = usePortalConfig();
  if (!serverReady) return <ServerBootScreen />;
  return <App portalConfig={portalConfig} />;
}

const FALLBACK_COMP_ID = 'comp:apifootball:268';

function App({ portalConfig }: { portalConfig: PortalConfig }) {
  // Competitions in display order — all metadata comes from portal-config (server-driven)
  const COMPETITIONS = portalConfig.competitions
    .filter((c) => c.enabled)
    .map((c) => ({ id: c.id, code: c.slug, isTournament: c.isTournament ?? false, enabled: true }));

  const firstCompId = COMPETITIONS[0]?.id ?? FALLBACK_COMP_ID;
  const [competitionId, setCompetitionIdRaw] = useState(firstCompId);
  const [matchday, setMatchday] = useState<number | null>(null);
  const [view, setView] = useState<ViewMode>('home');
  const [standingsFocusId, setStandingsFocusId] = useState<string | null>(null);
  const [tournamentFocusId, setTournamentFocusId] = useState<string | null>(null);

  // If current competition was disabled, reset to first enabled
  const resolvedCompetitionId = COMPETITIONS.find((c) => c.id === competitionId)
    ? competitionId
    : firstCompId;

  const setCompetitionId = (id: string) => {
    setCompetitionIdRaw(id);
    setMatchday(null);
    setStandingsFocusId(null);
    setTournamentFocusId(null);
    setTournamentFocusDate(null);
    setSubTournamentKey(undefined);
  };
  const [tournamentFocusDate, setTournamentFocusDate] = useState<string | null>(null);
  const [hasLiveMatches, setHasLiveMatches] = useState(false);
  const [tvTab, setTvTab] = useState<'hoy' | 'manana'>('hoy');
  const [subTournamentKey, setSubTournamentKey] = useState<string | undefined>(undefined);

  const currentComp = COMPETITIONS.find((c) => c.id === resolvedCompetitionId) ?? COMPETITIONS[0];
  const noCompetitions = COMPETITIONS.length === 0;

  const isTournament = currentComp?.isTournament ?? false;

  const { data: compInfo, loading: compInfoLoading } = useCompetitionInfo(resolvedCompetitionId, subTournamentKey);
  const { data: standings, loading: standingsLoading } = useStandings(
    resolvedCompetitionId,
    view === 'standings' && !isTournament,
    subTournamentKey,
  );
  const { teamsPlayingToday, teamsPlayingLive } = useTeamsPlayingToday(
    resolvedCompetitionId,
    view === 'standings' ? (compInfo?.currentMatchday ?? null) : null,
    'America/Montevideo',
  );
  const { data: standingsTeamDetail } = useTeamDetail(
    resolvedCompetitionId,
    view === 'standings' ? standingsFocusId : null,
    compInfo?.currentMatchday ?? null,
    'America/Montevideo',
  );
  const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Montevideo' });
  const { data: tournamentTeamDetail } = useTeamDetail(
    resolvedCompetitionId,
    view === 'standings' && isTournament ? tournamentFocusId : null,
    null,
    'America/Montevideo',
    tournamentFocusDate ?? todayLocal,
  );
  const { data: scorers, loading: scorersLoading } = useScorers(
    resolvedCompetitionId,
    view === 'standings' && !isTournament,
  );

  // Cuando cambia la liga: resetear jornada, foco y sub-torneo
  useEffect(() => {
    setMatchday(null);
    setStandingsFocusId(null);
    setTournamentFocusId(null);
    setTournamentFocusDate(null);
    setSubTournamentKey(undefined); // se resolverá al activo según compInfo
  }, [resolvedCompetitionId]);

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
        competitionId={resolvedCompetitionId}
        onCompetitionChange={(id) => { setCompetitionId(id); }}
        competitions={COMPETITIONS}
        features={portalConfig.features}
        hasLiveMatches={hasLiveMatches}
        tvTab={tvTab}
        onTvTabChange={setTvTab}
        isTournament={isTournament}
      />

      {/* ── Contenido principal ─────────────────────────────────────────── */}
      {noCompetitions ? (
        view === 'home' ? (
          <>
            <NoCompetitionsState />
            <HomePortal enabledCompetitionIds={[]} />
          </>
        ) : (
          <NoCompetitionsState />
        )
      ) : view === 'home' ? (
        <HomePortal enabledCompetitionIds={COMPETITIONS.map((c) => c.id)} />
      ) : view === 'pronosticos' ? (
        <div style={{ padding: isMobile ? '12px 12px' : '16px 20px', maxWidth: 1400, margin: '0 auto' }}>
          {isTournament ? (
            <TournamentPronosticosView competitionId={resolvedCompetitionId} />
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
                    competitionId={resolvedCompetitionId}
                    matchday={matchday}
                    subTournamentKey={subTournamentKey}
                  />
                </>
              )}
            </>
          )}
        </div>
      ) : view === 'tv' ? (
        <EventsSection activeTab={tvTab} onTabChange={setTvTab} enabledCompetitionIds={COMPETITIONS.map((c) => c.id)} />
      ) : view === 'partidos' ? (
        isTournament ? (
          <div style={{ padding: isMobile ? '12px' : '16px 20px', maxWidth: 1100, margin: '0 auto' }}>
            <TournamentPartidosView
              competitionId={resolvedCompetitionId}
              accent={getCompMeta(resolvedCompetitionId)?.accent}
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
                  competitionId={resolvedCompetitionId}
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
                competitionId={resolvedCompetitionId}
                accent={getCompMeta(resolvedCompetitionId)?.accent}
                startDate={getCompMeta(resolvedCompetitionId)?.startDate}
                phases={getCompMeta(resolvedCompetitionId)?.phases ?? ['grupos', 'eliminatorias']}
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
                      competitionId={resolvedCompetitionId}
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
