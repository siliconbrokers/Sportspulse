import { validateEnv } from './env-validator.js';
import { buildApp } from '@sportpulse/api';
import { resolveDisplayName } from '@sportpulse/canonical';
import { FootballDataSource } from './football-data-source.js';
import { FootballDataTournamentSource, WC_PROVIDER_KEY } from './football-data-tournament-source.js';
import { WC_CONFIG, CLI_CONFIG } from './tournament-config.js';
import { TheSportsDbSource, SPORTSDB_PROVIDER_KEY, type SubTournamentDef } from './the-sports-db-source.js';
import { OpenLigaDBSource, OPENLIGADB_PROVIDER_KEY } from './openligadb-source.js';
import { CrestCache } from './crest-cache.js';
import { ApiFootballSource } from './api-football-source.js';
import { RoutingDataSource } from './routing-data-source.js';
import { ApifootballLiveOverlay } from './apifootball-live-overlay.js';
import { LiveOverlayDataSource } from './live-overlay-data-source.js';
import { NewsService } from './news/index.js';
import { ApiFootballCLIOverlay } from './api-football-cli-overlay.js';
import { VideoService } from './video/index.js';
import { RadarApiAdapter } from './radar/index.js';
import { RadarV2ApiAdapter } from './radar-v2/index.js';
import { EventosService, buildEventSource } from './eventos/index.js';
import { MatchEventsService } from './match-events-service.js';
import { IncidentService } from './incidents/incident-service.js';
import { isApiFootballQuotaExhausted } from './incidents/apifootball-incident-source.js';
import { usesNativeGoals } from './incidents/incident-service.js';
import { PredictionService } from './prediction/prediction-service.js';
import { getBestCalibrationRegistry } from './prediction/global-calibrator-store.js';
import { PredictionStore } from './prediction/prediction-store.js';
import { runShadow } from './prediction/shadow-runner.js';
import { registerCompareRoute } from './prediction/compare-route.js';
import { registerInspectionRoute } from './prediction/inspection-route.js';
import { registerExperimentalPredictionRoute } from './prediction/experimental-route.js';
import { EvaluationStore } from './prediction/evaluation-store.js';
import { captureResults } from './prediction/result-capture.js';
import { registerEvaluationRoute } from './prediction/evaluation-route.js';
import { HistoricalBacktestStore } from './prediction/historical-backtest-store.js';
import { registerHistoricalEvaluationRoute } from './prediction/historical-evaluation-route.js';
import { ForwardValidationStore } from './prediction/forward-validation-store.js';
import { ForwardValidationRunner } from './prediction/forward-validation-runner.js';
import { ForwardValidationEvaluator } from './prediction/forward-validation-evaluator.js';
import { HistoricalStateService } from './prediction/historical-state-service.js';
import { runV2Shadow } from './prediction/v2-runner.js';
import { V2PredictionStore } from './prediction/v2-prediction-store.js';
import { runV3Shadow, type NonFdCompDescriptor } from './prediction/v3-shadow-runner.js';
import { isV3ShadowEnabled } from './prediction/prediction-flags.js';
import { OddsService } from './odds/odds-service.js';
import { InjurySource } from './prediction/injury-source.js';
import { XgSource } from './prediction/xg-source.js';
import { LineupSource } from './prediction/lineup-source.js';
import { runAfShadowValidation } from './prediction/af-shadow-runner.js';
import { ApiFootballCanonicalSource, AF_COMPETITION_CONFIGS, AF_PROVIDER_KEY } from './api-football-canonical-source.js';
import { getBudgetStats as getAfBudgetStats, isQuotaExhausted as isAfQuotaExhausted } from './af-budget.js';
import { COMPETITION_REGISTRY, REGISTRY_BY_ID } from './competition-registry.js';
import type { MatchCoreInput } from './incidents/types.js';
import { isCompetitionEnabled, getEnabledCompetitions, getFullConfig, isFeatureEnabled } from './portal-config-store.js';
import { registerAdminRoutes } from './admin-router.js';
import { fetchStreamEmbedUrls } from './stream-embed/stream-embed-service.js';
import type { IUpcomingService, UpcomingMatchDTO } from '@sportpulse/api';
import {
  SnapshotService,
  InMemorySnapshotStore,
} from '@sportpulse/snapshot';
import { MVP_POLICY } from '@sportpulse/scoring';

const API_TOKEN = process.env.FOOTBALL_DATA_TOKEN;
if (!API_TOKEN) {
  console.error('Missing FOOTBALL_DATA_TOKEN env var. Get a free key at https://www.football-data.org/');
  process.exit(1);
}

const COMPETITION_CODES = (process.env.COMPETITIONS ?? 'PD').split(',');
// BL1 is served by OpenLigaDB — exclude it from football-data.org competition list
const FD_COMPETITION_CODES = COMPETITION_CODES.filter((c) => c !== 'BL1');
const PORT = Number(process.env.PORT ?? 3000);

// TheSportsDB — Liga Uruguaya
const SPORTSDB_API_KEY = process.env.SPORTSDB_API_KEY ?? '123';
const UY_LEAGUE_ID = '4432';
const UY_LEAGUE_NAME = 'Uruguayan Primera Division';
const UY_COMPETITION_ID = `comp:${SPORTSDB_PROVIDER_KEY}:${UY_LEAGUE_ID}`;

// TheSportsDB — Liga Argentina
const AR_PROVIDER_KEY = 'sportsdb-ar';
const AR_LEAGUE_ID = '4406';
const AR_LEAGUE_NAME = 'Argentinian Primera Division';
const AR_COMPETITION_ID = `comp:${AR_PROVIDER_KEY}:${AR_LEAGUE_ID}`;

// OpenLigaDB — Bundesliga
const OLG_LEAGUE = 'bl1';
const OLG_COMPETITION_ID = `comp:${OPENLIGADB_PROVIDER_KEY}:${OLG_LEAGUE}`;

const DEFAULT_CONTAINER = {
  width: 1200,
  height: 700,
  outerPadding: 8,
  innerGutter: 6,
};

async function main() {
  validateEnv();

  // Detect AF canonical mode early so we can skip legacy startup fetches.
  const AF_CANONICAL_ENABLED = !!process.env.APIFOOTBALL_KEY &&
    process.env.AF_CANONICAL_ENABLED !== 'false';

  const fdSource = new FootballDataSource(API_TOKEN!);

  if (!AF_CANONICAL_ENABLED) {
  console.log(`Fetching competitions from football-data.org: ${FD_COMPETITION_CODES.join(', ')}...`);
  for (let i = 0; i < FD_COMPETITION_CODES.length; i++) {
    const code = FD_COMPETITION_CODES[i];
    const competitionId = `comp:football-data:${code}`;
    if (!isCompetitionEnabled(competitionId)) {
      console.log(`[FDSource] ${code} deshabilitado — startup fetch omitido`);
      continue;
    }
    try {
      await fdSource.fetchCompetition(code);
    } catch (err) {
      console.error(`Failed to fetch ${code}:`, err);
    }
    // Respect football-data.org rate limit (10 req/min): wait between fetches
    if (i < FD_COMPETITION_CODES.length - 1) {
      await new Promise((r) => setTimeout(r, 7000));
    }
  }
  } // end if (!AF_CANONICAL_ENABLED) — FD startup fetch

  // Liga Uruguaya: Apertura (Feb-Jun, H1) + Clausura (Aug-Nov, H2)
  const UY_SUB_TOURNAMENTS: SubTournamentDef[] = [
    { key: 'APERTURA', label: 'Apertura', isH1: true },
    { key: 'CLAUSURA', label: 'Clausura', isH1: false },
  ];

  // TheSportsDB — Liga Uruguaya
  const sportsDbSource = new TheSportsDbSource(
    SPORTSDB_API_KEY, UY_LEAGUE_ID, UY_LEAGUE_NAME,
    'https://www.thesportsdb.com/api/v1/json', SPORTSDB_PROVIDER_KEY,
    UY_SUB_TOURNAMENTS,
  );
  if (!AF_CANONICAL_ENABLED && isCompetitionEnabled(UY_COMPETITION_ID)) {
    try {
      await sportsDbSource.fetchSeason();
    } catch (err) {
      console.error(`Failed to fetch Liga Uruguaya from TheSportsDB:`, err);
    }
  } else if (!AF_CANONICAL_ENABLED) {
    console.log('[PortalConfig] Liga Uruguaya deshabilitada — startup fetch omitido');
  }

  // TheSportsDB — Liga Argentina
  // Delay para evitar rate limit del free tier después del fetch de Uruguay (~26 requests)
  const sportsDbArSource = new TheSportsDbSource(
    SPORTSDB_API_KEY, AR_LEAGUE_ID, AR_LEAGUE_NAME,
    'https://www.thesportsdb.com/api/v1/json', AR_PROVIDER_KEY,
  );
  if (!AF_CANONICAL_ENABLED && isCompetitionEnabled(AR_COMPETITION_ID)) {
    try {
      await new Promise<void>((r) => setTimeout(r, 5000));
      await sportsDbArSource.fetchSeason();
    } catch (err) {
      console.error(`Failed to fetch Liga Argentina from TheSportsDB:`, err);
    }
  } else if (!AF_CANONICAL_ENABLED) {
    console.log('[PortalConfig] Liga Argentina deshabilitada — startup fetch omitido');
  }

  // OpenLigaDB — Bundesliga (no auth required)
  const openLigaDbSource = new OpenLigaDBSource(OLG_LEAGUE, '1. Bundesliga');
  if (!AF_CANONICAL_ENABLED && isCompetitionEnabled(OLG_COMPETITION_ID)) {
    try {
      await openLigaDbSource.fetchSeason();
    } catch (err) {
      console.error('Failed to fetch Bundesliga from OpenLigaDB:', err);
    }
  } else if (!AF_CANONICAL_ENABLED) {
    console.log('[PortalConfig] Bundesliga deshabilitada — startup fetch omitido');
  }

  // Football-data.org — Copa del Mundo 2026 (torneo con grupos + eliminatorias)
  const wcSource = new FootballDataTournamentSource(API_TOKEN!, WC_CONFIG);
  const WC_COMPETITION_ID = wcSource.competitionId; // 'comp:football-data-wc:WC'
  if (!AF_CANONICAL_ENABLED && isCompetitionEnabled(WC_COMPETITION_ID)) {
    try {
      await new Promise<void>((r) => setTimeout(r, 7000));
      await wcSource.fetchTournament();
    } catch (err) {
      console.error('Failed to fetch Copa del Mundo 2026 from football-data.org:', err);
    }
  } else if (AF_CANONICAL_ENABLED) {
    console.log('[AF mode] WC data served from API-Football (comp:apifootball:1) — skipping FD fetch');
  } else {
    console.log('[PortalConfig] Copa del Mundo deshabilitada — startup fetch omitido');
  }

  // Football-data.org — Copa Libertadores 2026 (grupos + eliminatorias CONMEBOL)
  // Delay mayor que WC para evitar 429: football-data free tier permite ~10 req/min.
  // WC fetch consume varias requests; 20s garantiza ventana suficiente antes de CLI.
  const cliSource = new FootballDataTournamentSource(API_TOKEN!, CLI_CONFIG);
  const CLI_COMPETITION_ID = cliSource.competitionId; // 'comp:football-data-cli:CLI'

  // Score overlay: API-Football v3 provee scores correctos para Copa Libertadores.
  // football-data.org free tier no actualiza scores de CLI en tiempo real.
  // Usa APIFOOTBALL_KEY (misma key que el live overlay y incidents).
  const AF_CLI_KEY = process.env.APIFOOTBALL_KEY ?? '';
  if (AF_CLI_KEY) {
    cliSource.setScoreOverlay(new ApiFootballCLIOverlay(AF_CLI_KEY));
    console.log('[Startup] API-Football CLI overlay activado (scores Copa Libertadores, league 13)');
  } else {
    console.warn('[Startup] APIFOOTBALL_KEY no configurada — scores CLI desde football-data.org (puede ser incorrecto)');
  }

  if (!AF_CANONICAL_ENABLED && isCompetitionEnabled(CLI_COMPETITION_ID)) {
    try {
      await new Promise<void>((r) => setTimeout(r, 20000));
      await cliSource.fetchTournament();
    } catch (err) {
      const cliErr = err instanceof Error ? err.message : String(err);
      console.error(`[Startup] ERROR cargando Copa Libertadores: ${cliErr}`);
      console.error('[Startup] Verificá que FOOTBALL_DATA_TOKEN tenga acceso a CLI. Visitá /api/ui/status para diagnóstico.');
    }
  } else if (AF_CANONICAL_ENABLED) {
    console.log('[AF mode] CLI data served from API-Football (comp:apifootball:13) — skipping FD fetch');
  } else {
    console.log('[PortalConfig] Copa Libertadores deshabilitada — startup fetch omitido');
  }

  // ── API-Football Canonical Migration (Track C) ─────────────────────────────
  // AF_CANONICAL_ENABLED is defined early in main() to guard legacy startup fetches.
  // Here we just set up the AF canonical source and competition IDs.
  const AF_KEY = process.env.APIFOOTBALL_KEY ?? '';
  let afCanonicalSource: ApiFootballCanonicalSource | null = null;
  let AF_COMP_IDS: string[] = [];

  if (AF_CANONICAL_ENABLED) {
    if (!AF_KEY) {
      console.warn('[AfCanonical] AF_CANONICAL_ENABLED=true but APIFOOTBALL_KEY not set — falling back to legacy sources');
    } else {
      console.log('[AfCanonical] AF_CANONICAL_ENABLED=true — using API-Football as primary source for leagues');
      afCanonicalSource = new ApiFootballCanonicalSource(AF_KEY, new CrestCache());
      AF_COMP_IDS = Object.keys(AF_COMPETITION_CONFIGS);

      // Preload disk cache into memory BEFORE the first API fetch cycle.
      // This ensures that even if the API-Football quota is exhausted, the server
      // can still serve stale-but-valid data from matchday JSON files on disk.
      // preloadAllCompetitions() is a read-only operation — it never calls the API.
      await afCanonicalSource.preloadAllCompetitions();
      console.log('[AfCanonical] disk preload complete — starting API refresh cycle');

      // Fetch all AF competitions sequentially (small delays to avoid quota bursts)
      for (let i = 0; i < AF_COMP_IDS.length; i++) {
        const compId = AF_COMP_IDS[i];
        if (!isCompetitionEnabled(compId)) {
          console.log(`[AfCanonical] ${compId} deshabilitado — startup fetch omitido`);
          continue;
        }
        try {
          await afCanonicalSource.fetchCompetition(compId);
        } catch (err) {
          console.error(`[AfCanonical] Error fetching ${compId}:`, err);
        }
        if (i < AF_COMP_IDS.length - 1) {
          await new Promise((r) => setTimeout(r, 2000)); // 2s between fetches
        }
      }
    }
  }

  // Routing: conditionally use AF canonical source for leagues, always keep WC/CLI
  const routingDataSource = AF_CANONICAL_ENABLED && afCanonicalSource
    ? new RoutingDataSource(fdSource, [
        ...AF_COMP_IDS.map((compId) => ({
          competitionId: compId,
          providerKey:   AF_PROVIDER_KEY,
          source:        afCanonicalSource!,
        })),
        { competitionId: WC_COMPETITION_ID, providerKey: WC_PROVIDER_KEY, source: wcSource },
        { competitionId: CLI_COMPETITION_ID, providerKey: CLI_CONFIG.providerKey, source: cliSource },
      ])
    : new RoutingDataSource(fdSource, [
        { competitionId: UY_COMPETITION_ID, providerKey: SPORTSDB_PROVIDER_KEY, source: sportsDbSource },
        { competitionId: AR_COMPETITION_ID, providerKey: AR_PROVIDER_KEY, source: sportsDbArSource },
        { competitionId: OLG_COMPETITION_ID, providerKey: OPENLIGADB_PROVIDER_KEY, source: openLigaDbSource },
        { competitionId: WC_COMPETITION_ID, providerKey: WC_PROVIDER_KEY, source: wcSource },
        { competitionId: CLI_COMPETITION_ID, providerKey: CLI_CONFIG.providerKey, source: cliSource },
      ]);

  // Live score overlay: API-Football v3 — refresh cada 2 min durante partidos,
  // 15 min en idle. Score en fuente = 15s (vs ~5 min de football-data.org free tier).
  const AF_LIVE_KEY = process.env.APIFOOTBALL_KEY ?? '';
  const liveOverlay = new ApifootballLiveOverlay(AF_LIVE_KEY, AF_COMP_IDS);
  liveOverlay.start();

  // Wraps routingDataSource: getMatches() parchea scores en vivo desde el overlay.
  // Todos los demás métodos (standings, matchday, teams…) delegan sin cambios.
  const dataSource = new LiveOverlayDataSource(routingDataSource, liveOverlay);

  // ── Startup parity check ───────────────────────────────────────────────────
  // Validates that every enabled competition in portal-config has a registered
  // route in the RoutingDataSource.
  //
  // When AF_CANONICAL_ENABLED is false (no APIFOOTBALL_KEY), the portal-config
  // catalog still contains comp:apifootball:* IDs (from COMPETITION_REGISTRY).
  // Those IDs are intentionally not routable in non-AF mode — they degrade to
  // empty data via the FD fallback. This is acceptable degraded behavior and
  // must NOT crash the server. Only non-AF IDs that are unroutable indicate a
  // real misconfiguration worth aborting.
  (function assertRoutingParity(): void {
    const portalCfg = getFullConfig();
    const enabledIds = portalCfg.competitions
      .filter((c) => c.enabled)
      .map((c) => c.id);

    const afPrefix = `comp:${AF_PROVIDER_KEY}:`;

    const unroutable = enabledIds.filter((id) => {
      // In non-AF mode: AF IDs are expected to be unroutable — skip them.
      if (!AF_CANONICAL_ENABLED && id.startsWith(afPrefix)) return false;
      try {
        return routingDataSource.getSeasonId(id) === undefined;
      } catch {
        return true;
      }
    });

    const afDegraded = !AF_CANONICAL_ENABLED
      ? enabledIds.filter((id) => id.startsWith(afPrefix))
      : [];

    if (afDegraded.length > 0) {
      console.warn(
        `[StartupCheck] AF mode disabled (APIFOOTBALL_KEY not set) — ` +
        `${afDegraded.length} AF competition(s) will return empty data. ` +
        `Set APIFOOTBALL_KEY in Render environment to enable full data.`,
      );
    }

    if (unroutable.length === 0) {
      console.log(`[StartupCheck] Routing parity OK — all ${enabledIds.length - afDegraded.length} non-AF competition(s) routable`);
      return;
    }

    console.error('[StartupCheck] ROUTING PARITY FAILURE — the following competition IDs are enabled in portal-config but have no registered route:');
    for (const id of unroutable) {
      console.error(`  x ${id}`);
    }
    console.error('[StartupCheck] Remediation: ensure the data source for these IDs is initialized and registered in RoutingDataSource.');
    throw new Error(`[StartupCheck] ${unroutable.length} competition(s) unroutable — aborting startup to prevent silent 404s`);
  })();

  // News service — demand-pull, cached per league (30-60 min TTL). Uses RSS feeds (no API key required).

  // Video service — YouTube Data API v3, cached 45 min
  const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY ?? '';
  if (!YOUTUBE_API_KEY) {
    console.warn('[VideoService] YOUTUBE_API_KEY not set — video highlights will be disabled');
  }
  const videoService = new VideoService(YOUTUBE_API_KEY);

  const standingsProvider = {
    getTop5TeamNames(competitionId: string): string[] {
      return (dataSource.getStandings?.(competitionId) ?? [])
        .slice(0, 5)
        .map((s) => s.teamName);
    },
    getLastPlayedMatchday(competitionId: string): number | undefined {
      return dataSource.getLastPlayedMatchday?.(competitionId);
    },
  };
  const newsService = new NewsService(standingsProvider);

  const snapshotStore = new InMemorySnapshotStore();
  const snapshotService = new SnapshotService({
    store: snapshotStore,
    defaultPolicy: MVP_POLICY,
    defaultContainer: DEFAULT_CONTAINER,
  });

  // Eventos — fuente: streamtp10.com/eventos.json (default) o EVENTOS_SOURCE_URL env
  const EVENTOS_SOURCE_URL = process.env.EVENTOS_SOURCE_URL;
  const EVENTOS_DEBUG = process.env.EVENTOS_DEBUG === 'true';

  // Crest resolver: busca el escudo en el DataSource canónico por nombre de equipo (lazy, league-aware)
  const FD_COMP_IDS = FD_COMPETITION_CODES.map((c) => `comp:football-data:${c}`).filter((id) => isCompetitionEnabled(id));
  const ALL_COMP_IDS = (AF_CANONICAL_ENABLED && afCanonicalSource
    ? [
        ...AF_COMP_IDS,
        WC_COMPETITION_ID,
        CLI_COMPETITION_ID,
      ]
    : [
        ...FD_COMP_IDS,
        UY_COMPETITION_ID,
        AR_COMPETITION_ID,
        OLG_COMPETITION_ID,
        WC_COMPETITION_ID,
        CLI_COMPETITION_ID,
      ]
  ).filter((id) => isCompetitionEnabled(id));
  // V2 only supports football-data.org competitions (historical loader only covers FD)
  const fdCompetitionCodeMap = new Map(FD_COMPETITION_CODES.map((c) => [`comp:football-data:${c}`, c]));
  // In AF mode: map AF competition IDs → FD codes so V3 shadow can still query HistoricalStateService
  // (historical data is stored by FD code; team IDs differ but the runner falls back gracefully)
  if (AF_CANONICAL_ENABLED) {
    // Derive AF→FD code mapping from COMPETITION_REGISTRY instead of hardcoding.
    // Entries whose slug matches a known FD competition code are the only ones
    // that have a direct football-data.org counterpart for historical state lookup.
    const FD_CODE_SET = new Set(FD_COMPETITION_CODES);
    for (const entry of COMPETITION_REGISTRY) {
      if (FD_CODE_SET.has(entry.slug)) {
        fdCompetitionCodeMap.set(entry.id, entry.slug);
      }
    }
  }
  function normTeamName(s: string) {
    return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }
  // Mapas por liga para evitar confusión entre equipos homónimos (ej. Liverpool EPL vs Liverpool URU)
  let leagueCrestMaps: Map<string, Map<string, string>> | null = null;
  let globalCrestMap: Map<string, string> | null = null;
  function initCrestMaps() {
    // Sin memoización: el warmup de escudos actualiza this.cache de forma asíncrona,
    // por lo que reconstruimos los mapas en cada llamada para reflejar las URLs locales.
    // El costo es mínimo (~100 equipos en memoria, O(n) iteración).
    leagueCrestMaps = new Map();
    globalCrestMap = new Map();
    const leagueToCompIds: Record<string, string[]> = AF_CANONICAL_ENABLED && afCanonicalSource
      ? Object.fromEntries(COMPETITION_REGISTRY.map((e) => [e.normalizedLeague, [e.id]]))
      : {
          URUGUAY_PRIMERA:   [UY_COMPETITION_ID],
          ARGENTINA_PRIMERA: [AR_COMPETITION_ID],
          PREMIER_LEAGUE:    FD_COMPETITION_CODES.includes('PL') ? ['comp:football-data:PL'] : [],
          LALIGA:            FD_COMPETITION_CODES.includes('PD') ? ['comp:football-data:PD'] : [],
          BUNDESLIGA:        [OLG_COMPETITION_ID],
        };
    for (const [league, compIds] of Object.entries(leagueToCompIds)) {
      const map = new Map<string, string>();
      for (const compId of compIds) {
        for (const team of dataSource.getTeams(compId)) {
          if (team.crestUrl) {
            map.set(normTeamName(team.name), team.crestUrl);
            if (team.shortName) map.set(normTeamName(team.shortName), team.crestUrl);
          }
        }
      }
      leagueCrestMaps.set(league, map);
    }
    for (const compId of ALL_COMP_IDS) {
      for (const team of dataSource.getTeams(compId)) {
        if (team.crestUrl) {
          globalCrestMap.set(normTeamName(team.name), team.crestUrl);
          if (team.shortName) globalCrestMap.set(normTeamName(team.shortName), team.crestUrl);
        }
      }
    }
  }
  function resolveCrest(teamName: string, league?: string): string | null {
    initCrestMaps();
    const normed = normTeamName(teamName);
    // Liga específica primero → evita que "Liverpool" de URU resuelva al escudo del EPL
    if (league && leagueCrestMaps?.has(league)) {
      const result = leagueCrestMaps.get(league)!.get(normed);
      if (result) return result;
    }
    // Fallback global
    return globalCrestMap?.get(normed) ?? null;
  }

  const eventosService = new EventosService(
    buildEventSource(EVENTOS_SOURCE_URL), // sin arg → usa streamtp10.com por defecto
    { debugMode: EVENTOS_DEBUG },
    resolveCrest,
  );

  const AF_KEY_FOR_INCIDENTS = process.env.APIFOOTBALL_KEY ?? '';

  // Build matchEventsService first — used as goals fallback for IncidentService.
  const matchEventsService = new MatchEventsService(SPORTSDB_API_KEY, dataSource);
  // OpenLigaDB handles its own goal events natively (BL1) — only in legacy mode
  if (!AF_CANONICAL_ENABLED) {
    matchEventsService.registerProvider(OPENLIGADB_PROVIDER_KEY, openLigaDbSource);
  }
  // API-Football handles post-match goal events for PD, PL, URU (disk-cached, 1 req/match)
  if (AF_KEY_FOR_INCIDENTS) {
    const apiFootballSource = new ApiFootballSource(AF_KEY_FOR_INCIDENTS, dataSource);
    matchEventsService.registerProvider('football-data', apiFootballSource);
    matchEventsService.registerProvider('thesportsdb', apiFootballSource);
    matchEventsService.registerProvider(AR_PROVIDER_KEY, apiFootballSource);
    // When AF is the canonical source, all matches use provider key 'apifootball'
    if (AF_CANONICAL_ENABLED) {
      matchEventsService.registerProvider(AF_PROVIDER_KEY, apiFootballSource);
    }
    console.log('[ApiFootballSource] registered for football-data + thesportsdb + sportsdb-ar' + (AF_CANONICAL_ENABLED ? ' + apifootball' : ''));
  } else {
    console.warn('[ApiFootballSource] APIFOOTBALL_KEY not set — PD/PL/URU goal events disabled');
  }

  // IncidentService: API-Football as primary, matchEventsService as goals-only fallback.
  // Pass homeTeamIdResolver to avoid a redundant /fixtures?id= call when AF canonical source
  // already has the match in memory (saves 1 API-Football quota unit per first DetailPanel open).
  const incidentService = new IncidentService(
    AF_KEY_FOR_INCIDENTS,
    matchEventsService,
    afCanonicalSource ? (matchId: string) => afCanonicalSource.getHomeAfTeamId(matchId) : undefined,
  );

  // ── UpcomingService — partidos de hoy / próximas 24h desde fuentes canónicas ──
  const PORTAL_TZ = 'America/Montevideo';

  const COMP_LEAGUE_KEY: Record<string, string> = {
    // Legacy IDs
    [UY_COMPETITION_ID]:  'URUGUAY_PRIMERA',
    [AR_COMPETITION_ID]:  'ARGENTINA_PRIMERA',
    [OLG_COMPETITION_ID]: 'BUNDESLIGA',
    [WC_COMPETITION_ID]:  'MUNDIAL',
    [CLI_COMPETITION_ID]: 'COPA_LIBERTADORES',
  };
  // API-Football canonical IDs — derived from registry (single source of truth)
  for (const entry of COMPETITION_REGISTRY) {
    COMP_LEAGUE_KEY[entry.id] = entry.normalizedLeague;
  }
  for (const code of FD_COMPETITION_CODES) {
    const id = `comp:football-data:${code}`;
    COMP_LEAGUE_KEY[id] =
      code === 'PD' ? 'LALIGA'
      : code === 'PL' ? 'PREMIER_LEAGUE'
      : code === 'BL1' ? 'BUNDESLIGA'
      : 'OTRA';
  }

  function isToday(isoStr: string, tz: string): boolean {
    const now = new Date();
    const todayInTz = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now); // YYYY-MM-DD
    const dateInTz  = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(isoStr));
    return dateInTz === todayInTz;
  }

  function toPortalTime(isoStr: string, tz: string): string {
    return new Date(isoStr).toLocaleString('sv-SE', { timeZone: tz }).replace(' ', 'T');
  }

  const upcomingService: IUpcomingService = {
    getUpcoming(windowHours = 24): UpcomingMatchDTO[] {
      const now    = Date.now();
      const cutoff = now + windowHours * 60 * 60 * 1000;
      const results: UpcomingMatchDTO[] = [];

      for (const compId of ALL_COMP_IDS) {
        const seasonId = dataSource.getSeasonId(compId);
        if (!seasonId) continue;

        const matches = dataSource.getMatches(seasonId);
        const teams   = dataSource.getTeams(compId);
        const teamMap = new Map(teams.map((t) => [t.teamId, t]));
        const leagueKey = COMP_LEAGUE_KEY[compId] ?? 'OTRA';

        for (const m of matches) {
          if (!m.startTimeUtc) continue;
          const kickoffMs = new Date(m.startTimeUtc).getTime();

          // Heurística universal: IN_PROGRESS explícito O kickoff pasado < 180 min
          // (football-data.org free tier mantiene TIMED/SCHEDULED durante el partido)
          const minsElapsed = (now - kickoffMs) / 60_000;
          const isLive = m.status === 'IN_PROGRESS' ||
            (['SCHEDULED', 'TIMED', 'IN_PLAY', 'PAUSED'].includes(m.status) &&
              minsElapsed >= 0 && minsElapsed < 180);
          const isUpcoming = !isLive &&
            ['SCHEDULED', 'TIMED'].includes(m.status) &&
            kickoffMs > now && kickoffMs <= cutoff;

          if (!isLive && !isUpcoming) continue;

          const home = teamMap.get(m.homeTeamId);
          const away = teamMap.get(m.awayTeamId);
          const portalTime = toPortalTime(m.startTimeUtc, PORTAL_TZ);

          results.push({
            id:               m.matchId,
            homeTeam:         home ? resolveDisplayName(home.name, home.shortName) : m.homeTeamId,
            awayTeam:         away ? resolveDisplayName(away.name, away.shortName) : m.awayTeamId,
            homeTla:          home?.tla,
            awayTla:          away?.tla,
            homeCrestUrl:     home?.crestUrl ?? null,
            awayCrestUrl:     away?.crestUrl ?? null,
            homeTeamId:       m.homeTeamId,
            awayTeamId:       m.awayTeamId,
            competitionId:    compId,
            currentMatchday:  dataSource.getCurrentMatchday?.(compId) ?? null,
            normalizedLeague: leagueKey,
            normalizedStatus: isLive ? 'EN_VIVO' : 'PROXIMO',
            kickoffUtc:       m.startTimeUtc,
            startsAtPortalTz: portalTime,
            isTodayInPortalTz: isToday(m.startTimeUtc, PORTAL_TZ),
            scoreHome:        isLive ? (m.scoreHome ?? null) : null,
            scoreAway:        isLive ? (m.scoreAway ?? null) : null,
            matchPeriod:      isLive ? m.matchPeriod : undefined,
            elapsedMinutes:   isLive ? (m.elapsedMinutes ?? undefined) : undefined,
          });
        }
      }

      // Sort: live first (by time), then upcoming (by time)
      return results.sort((a, b) => {
        if (a.normalizedStatus !== b.normalizedStatus) {
          return a.normalizedStatus === 'EN_VIVO' ? -1 : 1;
        }
        return a.kickoffUtc.localeCompare(b.kickoffUtc);
      });
    },
  };

  const predictionService = new PredictionService({ calibrationRegistry: getBestCalibrationRegistry() });
  const predictionStore = new PredictionStore();
  // MKT-T3-02: Market odds service for edge tracking (evaluation only, never affects predictions)
  const oddsService = new OddsService();
  // MKT-T3-01: Injury source — API-Football v3 /injuries endpoint, budget-aware, in-memory cache 6h
  const injurySource = new InjurySource();
  // MKT-T3-03: xG source — API-Football v3 /fixtures/statistics, incremental disk cache per fixture
  const xgSource = new XgSource();
  // MKT-T3-04: Lineup source — API-Football v3 /fixtures/lineups, in-memory cache (fixtures 1h, lineups 2h)
  const lineupSource = new LineupSource();
  // RadarApiAdapter usa predictionStore como fuente primaria de probabilidades V3
  const radarService = new RadarApiAdapter(dataSource, predictionStore);
  // Radar v2: integrado con predictionStore para predictionContext en cards
  const radarV2Enabled = process.env.RADAR_V2_ENABLED === 'true';
  const radarV2Service = radarV2Enabled ? new RadarV2ApiAdapter(dataSource, predictionStore) : undefined;
  const evaluationStore = new EvaluationStore();
  const v2PredictionStore = new V2PredictionStore();

  // H11 — Forward Validation pipeline (feature-flagged)
  const forwardValStore = new ForwardValidationStore();
  const historicalStateServiceFV = new HistoricalStateService({ apiToken: API_TOKEN! });
  // AF canonical competition IDs — use DataSource-derived Elo instead of FD historical loader.
  // All five AF leagues (EU + URU + ARG) use team:apifootball:* IDs incompatible with FD loader.
  const AF_FV_COMP_IDS = COMPETITION_REGISTRY
    .filter((e) => !e.isTournament)
    .map((e) => e.id);
  const forwardValRunner = new ForwardValidationRunner(
    dataSource, predictionService, historicalStateServiceFV, forwardValStore,
    AF_FV_COMP_IDS,
  );
  const forwardValEvaluator = new ForwardValidationEvaluator(forwardValStore, dataSource);

  // Composite tournament source — delega a WC, CA o CLI según competitionId
  const tournamentSources = new Map([
    [WC_COMPETITION_ID,  wcSource],
    [CLI_COMPETITION_ID, cliSource],
  ]);
  const compositeTournamentSource = {
    getGroupView:         (id: string) => tournamentSources.get(id)?.getGroupView(id)         ?? null,
    getBracketView:       (id: string) => tournamentSources.get(id)?.getBracketView(id)       ?? null,
    getTournamentMatches: (id: string) => tournamentSources.get(id)?.getTournamentMatches(id) ?? null,
  };

  // Enrich portal-config with visual metadata from COMPETITION_REGISTRY
  // so the frontend receives all it needs and doesn't hardcode any provider-specific IDs.
  function getEnrichedPortalConfig() {
    const raw = getFullConfig();
    return {
      competitions: raw.competitions.map((c) => {
        const meta = REGISTRY_BY_ID.get(c.id);
        return {
          id:               c.id,
          slug:             c.slug,
          displayName:      c.displayName,
          enabled:          c.enabled,
          normalizedLeague: meta?.normalizedLeague ?? 'OTRA',
          newsKey:          meta?.newsKey ?? null,
          accentColor:      meta?.accentColor ?? '#6b7280',
          isTournament:     meta?.isTournament ?? false,
          logoUrl:          meta?.logoUrl ?? null,
          seasonLabel:      meta?.seasonLabel ?? null,
          phases:           meta?.phases ?? null,
          startDate:        meta?.startDate ?? null,
        };
      }),
      features: { tv: raw.features.tv, predictions: raw.features.predictions },
    };
  }

  const app = buildApp({ snapshotService, dataSource, newsService, videoService, radarService, radarV2Service, eventosService, matchEventsService, tournamentSource: compositeTournamentSource, upcomingService, predictionService, getPortalConfig: getEnrichedPortalConfig, competitionIds: COMPETITION_REGISTRY.map(e => e.id).filter(id => isCompetitionEnabled(id)), getBudgetStats: getAfBudgetStats });
  registerAdminRoutes(app, snapshotStore);

  // ── Smart scheduler ────────────────────────────────────────────────────────
  // Refresh interval adapts to match state. Only polls when data can change.
  //
  // State machine (evaluated after every refresh):
  //   LIVE            any IN_PROGRESS match             → 2 min
  //   EXPECTED_LIVE   kickoff passed, not FINISHED yet:
  //     < 100 min       normal match window             → 2 min
  //     100–135 min     stoppage time / late end        → 5 min
  //     135–200 min     VAR, injury, serious delay      → 10 min
  //     200–380 min     likely suspended mid-game       → 30 min
  //     > 380 min       pending official resolution     → 12 h
  //   POST_MATCH      all FINISHED, kickoff < 150 min   → 10 min (score confirmation)
  //   IDLE            no active match, next known       → sleep until kickoff − 30 min (max 12 h)
  //   NO_MATCHES      no future matches in dataset      → 24 h

  const MIN_MS = 60_000;
  const HR_MS  = 60 * MIN_MS;

  interface MatchSnapshot { status: string; startTimeUtc: string | null }

  function computeRefreshDelayMs(matches: readonly MatchSnapshot[], nowMs: number): number {
    // 1. API-confirmed live match
    if (matches.some((m) => m.status === 'IN_PROGRESS')) return 2 * MIN_MS;

    // 2. Kickoff has passed but match not yet finished (might be live with API lag,
    //    in extra time, suspended, or heavily delayed)
    const pastNotDone = matches.filter(
      (m) => m.status !== 'FINISHED' && m.startTimeUtc &&
             new Date(m.startTimeUtc).getTime() < nowMs,
    );
    if (pastNotDone.length > 0) {
      const maxAgeMin = Math.max(
        ...pastNotDone.map((m) => (nowMs - new Date(m.startTimeUtc!).getTime()) / MIN_MS),
      );
      if (maxAgeMin < 100) return 2  * MIN_MS;
      if (maxAgeMin < 135) return 5  * MIN_MS;
      if (maxAgeMin < 200) return 10 * MIN_MS;
      if (maxAgeMin < 380) return 30 * MIN_MS;
      return 12 * HR_MS; // suspended, pending official resolution
    }

    // 3. Post-match grace: at least one FINISHED match whose kickoff was < 150 min ago.
    //    Gives time for the API to publish late score corrections.
    const inGrace = matches.some(
      (m) => m.status === 'FINISHED' && m.startTimeUtc &&
             nowMs < new Date(m.startTimeUtc).getTime() + 150 * MIN_MS,
    );
    if (inGrace) return 10 * MIN_MS;

    // 4. Sleep until 30 min before the next scheduled kickoff
    const nextKickoffMs = matches
      .filter((m) => m.status !== 'FINISHED' && m.startTimeUtc &&
                     new Date(m.startTimeUtc).getTime() > nowMs)
      .map((m) => new Date(m.startTimeUtc!).getTime())
      .sort((a, b) => a - b)[0];
    if (nextKickoffMs !== undefined) {
      const delay = Math.max(nextKickoffMs - nowMs - 30 * MIN_MS, 5 * MIN_MS);
      return Math.min(delay, 12 * HR_MS); // cap at 12 h in case of data anomaly
    }

    // 5. No future matches in dataset — re-check hourly so the server recovers
    //    quickly after a quota reset or cold start with empty disk cache.
    return 1 * HR_MS;
  }

  function getAllMatchSnapshots(): MatchSnapshot[] {
    const all: MatchSnapshot[] = [];
    for (const compId of ALL_COMP_IDS) {
      const seasonId = dataSource.getSeasonId(compId);
      if (seasonId) all.push(...dataSource.getMatches(seasonId));
    }
    return all;
  }

  function fmtDelay(ms: number): string {
    if (ms < MIN_MS)  return `${Math.round(ms / 1000)}s`;
    if (ms < HR_MS)   return `${Math.round(ms / MIN_MS)}min`;
    return `${(ms / HR_MS).toFixed(1)}h`;
  }

  // Fix C1: guard prevents two concurrent refresh cycles from running in parallel.
  // During LIVE mode the scheduler fires every 2 min; if API calls are slow the
  // previous cycle may still be running. Without this guard both cycles would write
  // to the same cache files concurrently (last-rename-wins, no corruption, but
  // non-deterministic state visible in the UI during live matches).
  let refreshInProgress = false;

  /** Timestamp of last successful fetch per compId — used for tier-based scheduling. */
  const compLastFetchedMs = new Map<string, number>();

  async function runRefresh(): Promise<void> {
    if (refreshInProgress) {
      console.warn('[Scheduler] Refresh already in progress — skipping cycle');
      return;
    }
    refreshInProgress = true;
    try {
      await runRefreshInner();
    } finally {
      refreshInProgress = false;
    }
  }

  async function runRefreshInner(): Promise<void> {
    if (AF_CANONICAL_ENABLED && afCanonicalSource) {
      // Skip entire AF refresh cycle when quota is exhausted — avoids 7 noisy error logs per cycle
      if (isAfQuotaExhausted()) {
        console.log('[Scheduler] AF quota exhausted — refresh cycle skipped until midnight UTC');
        return;
      }

      const nowMs = Date.now();
      const liveLeagueIds = liveOverlay.getLiveLeagueIds();

      // Tier intervals (ms)
      const TIER_LIVE_FAST  =  2 * 60_000;   // 2 min — partido en vivo ahora
      const TIER_IMMINENT   =  5 * 60_000;   // 5 min — kickoff en < 30 min
      const TIER_ACTIVE_DAY = 60 * 60_000;   // 1h — cache disk cubre 6h de todos modos
      const TIER_IDLE       =  6 * 3600_000; // 6h — alineado con TTL SCHEDULED del disk cache

      const todayUtc = new Date(nowMs).toISOString().slice(0, 10); // YYYY-MM-DD UTC

      const enabledAfIds = AF_COMP_IDS.filter((id) => isCompetitionEnabled(id));
      const toFetch: string[] = [];

      for (const compId of enabledAfIds) {
        const regEntry = REGISTRY_BY_ID.get(compId);
        const afLeagueId = regEntry?.leagueId ?? -1;

        // Classify tier
        let tierMs: number;
        if (liveLeagueIds.has(afLeagueId)) {
          tierMs = TIER_LIVE_FAST;
        } else {
          // Check in-memory cache for today's / imminent matches without API calls
          const matches = afCanonicalSource.getMatchesCached(compId);

          const hasImminent = matches.some((m) => {
            if (m.status !== 'SCHEDULED') return false;
            const kickoff = m.startTimeUtc ? new Date(m.startTimeUtc).getTime() : 0;
            return kickoff > nowMs && kickoff - nowMs < 30 * 60_000;
          });

          const hasToday = matches.some((m) => {
            if (!m.startTimeUtc) return false;
            return m.startTimeUtc.slice(0, 10) === todayUtc;
          });

          if (hasImminent) tierMs = TIER_IMMINENT;
          else if (hasToday) tierMs = TIER_ACTIVE_DAY;
          else tierMs = TIER_IDLE;
        }

        const lastFetched = compLastFetchedMs.get(compId) ?? 0;
        if (nowMs - lastFetched >= tierMs) {
          toFetch.push(compId);
        }
      }

      if (toFetch.length === 0) {
        console.log('[Scheduler] No competitions due for refresh — all within tier intervals');
        return;
      }

      console.log(`[Scheduler] Refreshing ${toFetch.length}/${enabledAfIds.length} competitions (tier-based)`);

      let invalidated = false;
      for (let i = 0; i < toFetch.length; i++) {
        const compId = toFetch[i];
        try {
          await afCanonicalSource.fetchCompetition(compId);
          compLastFetchedMs.set(compId, Date.now());
          if (!invalidated) { snapshotService.invalidateAll(); invalidated = true; }
        } catch (err) {
          console.error(`[AfCanonical] Refresh failed for ${compId}:`, err);
        }
        if (i < toFetch.length - 1) {
          await new Promise<void>((r) => setTimeout(r, 1500));
        }
      }
    } else {
      // Legacy mode: refresh FD, TheSportsDB, OpenLigaDB
      const enabledFdCodes = FD_COMPETITION_CODES.filter((c) =>
        isCompetitionEnabled(`comp:football-data:${c}`),
      );
      for (let i = 0; i < enabledFdCodes.length; i++) {
        const code = enabledFdCodes[i];
        try {
          await fdSource.fetchCompetition(code);
          snapshotService.invalidateAll();
        } catch (err) {
          console.error(`Refresh failed for ${code}:`, err);
        }
        if (i < enabledFdCodes.length - 1) {
          await new Promise<void>((r) => setTimeout(r, 7000));
        }
      }
      if (isCompetitionEnabled(UY_COMPETITION_ID)) {
        try {
          await sportsDbSource.fetchSeason();
          snapshotService.invalidateAll();
        } catch (err) {
          console.error('Refresh failed for Liga Uruguaya:', err);
        }
      }
      if (isCompetitionEnabled(AR_COMPETITION_ID)) {
        try {
          await sportsDbArSource.fetchSeason();
          snapshotService.invalidateAll();
        } catch (err) {
          console.error('Refresh failed for Liga Argentina:', err);
        }
      }
      if (isCompetitionEnabled(OLG_COMPETITION_ID)) {
        try {
          await openLigaDbSource.fetchSeason();
          snapshotService.invalidateAll();
        } catch (err) {
          console.error('Refresh failed for Bundesliga (OpenLigaDB):', err);
        }
      }
    }
    if (!AF_CANONICAL_ENABLED && isCompetitionEnabled(WC_COMPETITION_ID)) {
      await new Promise<void>((r) => setTimeout(r, 7000));
      try {
        await wcSource.fetchTournament();
        snapshotService.invalidateAll();
      } catch (err) {
        console.error('Refresh failed for Copa del Mundo 2026:', err);
      }
    }
    if (!AF_CANONICAL_ENABLED && isCompetitionEnabled(CLI_COMPETITION_ID)) {
      await new Promise<void>((r) => setTimeout(r, 7000));
      try {
        await cliSource.fetchTournament();
        snapshotService.invalidateAll();
      } catch (err) {
        console.error('Refresh failed for Copa Libertadores 2026:', err);
      }
    }
    // Shadow prediction pipeline — fire-and-forget, fault-isolated
    // Runs out-of-band: errors never propagate to the refresh cycle
    // evaluationStore NOT passed: V3 runner is the authoritative source for evaluation.
    // Passing it here would let spec (prior_rating=false → league baseline) overwrite V3 records.
    void runShadow(dataSource, ALL_COMP_IDS, predictionService, predictionStore);

    const shadowSeasonYear = new Date().getFullYear() - (new Date().getMonth() < 6 ? 1 : 0);

    if (AF_CANONICAL_ENABLED && afCanonicalSource) {
      // V3 shadow runner desactivado en AF mode.
      // HistoricalStateService carga datos de football-data.org con FD team IDs (fd_xxx),
      // pero en AF mode el datasource usa AF team IDs (af_xxx) — mismatch total.
      // Resultado: 9 requests inútiles a FD + Elo history nunca se aplica (0 matches).
      // TODO: adaptar HistoricalLoader para cargar desde AF API con AF team IDs.
      console.log('[AF mode] V3 shadow runner desactivado (HistoricalStateService usa FD IDs incompatibles con AF)');
    } else {
      // Legacy mode: V2 + V3 shadow for FD and non-FD competitions
      void runV2Shadow(dataSource, FD_COMP_IDS, historicalStateServiceFV, v2PredictionStore, fdCompetitionCodeMap, shadowSeasonYear);
      const v3FdCompIds = FD_COMP_IDS.filter((id) => isCompetitionEnabled(id) && isV3ShadowEnabled(id));
      const v3NonFdDescriptors: NonFdCompDescriptor[] = [
        {
          competitionId: OLG_COMPETITION_ID,
          provider: 'openligadb' as const,
          providerLeagueId: OLG_LEAGUE,
          providerKey: OPENLIGADB_PROVIDER_KEY,
          expectedSeasonGames: 34,
        },
        {
          competitionId: UY_COMPETITION_ID,
          provider: 'thesportsdb' as const,
          providerLeagueId: UY_LEAGUE_ID,
          providerKey: SPORTSDB_PROVIDER_KEY,
          sdbApiKey: SPORTSDB_API_KEY,
          expectedSeasonGames: 15,
        },
        {
          competitionId: AR_COMPETITION_ID,
          provider: 'thesportsdb' as const,
          providerLeagueId: AR_LEAGUE_ID,
          providerKey: AR_PROVIDER_KEY,
          sdbApiKey: SPORTSDB_API_KEY,
          expectedSeasonGames: 19,
        },
      ].filter((d) => isCompetitionEnabled(d.competitionId) && isV3ShadowEnabled(d.competitionId));
      if (v3FdCompIds.length > 0 || v3NonFdDescriptors.length > 0) {
        void runV3Shadow(dataSource, v3FdCompIds, v3NonFdDescriptors, historicalStateServiceFV, predictionStore, fdCompetitionCodeMap, shadowSeasonYear, evaluationStore, oddsService, injurySource, xgSource, lineupSource);
      }
    }

    // AF vs FD historical shadow validation — desactivado en AF mode.
    // En AF mode no tiene sentido comparar AF vs FD — toda la data ya viene de AF.
    // En legacy mode sigue activo si SHADOW_AF_VALIDATION_ENABLED=true.
    if (!AF_CANONICAL_ENABLED && process.env.SHADOW_AF_VALIDATION_ENABLED === 'true') {
      const afShadowKey = process.env.APIFOOTBALL_KEY ?? '';
      void runAfShadowValidation(dataSource, FD_COMP_IDS, historicalStateServiceFV, shadowSeasonYear, afShadowKey);
    }

    // OE-3: capture ground truth for completed matches
    captureResults(dataSource, evaluationStore, ALL_COMP_IDS);

    // Forward validation — feature-flagged, fault-isolated
    // Desactivado en AF mode: usa HistoricalStateService que carga FD team IDs — incompatible con AF.
    const fvEnabled = !AF_CANONICAL_ENABLED && process.env.FORWARD_VALIDATION_ENABLED === 'true';
    if (fvEnabled) {
      // In AF mode: use AF competition IDs; in legacy mode: build from FD codes
      const fvCompetitions = AF_CANONICAL_ENABLED && afCanonicalSource
        ? COMPETITION_REGISTRY.filter((e) => !e.isTournament).map((e) => e.id).filter((id) => isCompetitionEnabled(id))
        : (process.env.FORWARD_VALIDATION_COMPETITIONS ?? 'PD,PL,BL1')
            .split(',').map(c => `comp:football-data:${c.trim()}`);
      const seasonStartYear = new Date().getFullYear() - (new Date().getMonth() < 6 ? 1 : 0);
      void forwardValRunner.run(fvCompetitions, seasonStartYear).then(result => {
        if (result.frozen > 0 || result.errors > 0) {
          console.log(`[ForwardVal] Frozen: ${result.frozen}, skipped: ${result.skipped}, errors: ${result.errors}`);
        }
      }).catch(err => console.error('[ForwardVal] runner error:', err));
      void forwardValEvaluator.closeCompleted(fvCompetitions).then(result => {
        if (result.closed > 0) {
          console.log(`[ForwardVal] Closed: ${result.closed} records, still pending: ${result.stillPending}`);
        }
      }).catch(err => console.error('[ForwardVal] evaluator error:', err));
    }

    // Invalidate snapshot cache after every data source refresh.
    // This ensures MatchCardList (snapshot) and PronosticoCard/Radar (reads DataSource live)
    // always reflect the same canonical data — no inconsistency between sections.
    snapshotService.invalidateAll();
    console.log('[Scheduler] Snapshot cache invalidated after data refresh');
  } // end runRefreshInner

  function scheduleNextRefresh(): void {
    const matches = getAllMatchSnapshots();
    const delayMs = computeRefreshDelayMs(matches, Date.now());
    const live     = matches.filter((m) => m.status === 'IN_PROGRESS').length;
    const pending  = matches.filter(
      (m) => m.status !== 'FINISHED' && m.startTimeUtc &&
             new Date(m.startTimeUtc).getTime() < Date.now(),
    ).length;
    console.log(
      `[Scheduler] Next refresh in ${fmtDelay(delayMs)}` +
      ` (live=${live}, pending=${pending})`,
    );
    setTimeout(async () => {
      await runRefresh();
      scheduleNextRefresh();
    }, delayMs);
  }

  // Run an initial refresh immediately at startup so the evaluation store
  // and snapshot cache are populated before the first scheduled timer fires.
  // Fire-and-forget: errors are caught inside runRefresh().
  void runRefresh().then(() => scheduleNextRefresh());

  // ── GET /api/ui/match/:matchId/incidents ────────────────────────────────────
  // Devuelve snapshot de incidentes (goles, tarjetas, sustituciones) para un partido.
  // El frontend pasa los datos del match core como query params.
  // Nunca rompe la UI: en caso de fallo retorna { events: [] } (AC-7).
  app.get('/api/ui/match/:matchId/incidents', async (req, reply) => {
    const { matchId: rawMatchId } = req.params as { matchId: string };
    const matchId = decodeURIComponent(rawMatchId);
    const q = req.query as Record<string, string>;

    // Normalize canonical EventStatus → IncidentMatchStatus.
    // The frontend sends canonical values (IN_PROGRESS, FINISHED, SCHEDULED, TBD, etc.)
    // but shouldScrapeIncidents expects LIVE | HT | FINISHED | SCHEDULED.
    const rawStatus = q.status ?? 'SCHEDULED';
    const status: MatchCoreInput['status'] =
      rawStatus === 'FINISHED' ? 'FINISHED'
      : rawStatus === 'IN_PROGRESS' || rawStatus === 'LIVE' || rawStatus === 'PAUSED' ? 'LIVE'
      : 'SCHEDULED';
    const homeScore  = parseInt(q.homeScore  ?? '0', 10);
    const awayScore  = parseInt(q.awayScore  ?? '0', 10);
    const matchday   = q.matchday ? parseInt(q.matchday, 10) : undefined;

    const matchCore: MatchCoreInput = {
      matchId,
      status,
      homeScore:     isNaN(homeScore) ? 0 : homeScore,
      awayScore:     isNaN(awayScore) ? 0 : awayScore,
      competitionId: q.competitionId ?? '',
      kickoffUtc:    q.kickoffUtc    ?? '',
      homeTeamName:  q.homeTeamName  ?? '',
      awayTeamName:  q.awayTeamName  ?? '',
      matchday,
    };

    // Partido no empezado → no hay incidentes
    if (status === 'SCHEDULED') {
      return reply.code(204).send();
    }

    // Para competiciones con proveedor nativo (BL1 → OpenLigaDB), nunca aplica quota de API-Football.
    const quotaExhausted = !usesNativeGoals(matchCore.competitionId) && isApiFootballQuotaExhausted();
    try {
      const snapshot = await incidentService.get(matchCore);
      if (!snapshot) {
        return reply
          .header('Cache-Control', 'no-store')
          .send({ matchId, events: [], snapshotType: null, quotaExhausted });
      }
      return reply
        .header('Cache-Control', snapshot.isFinal ? 'public, max-age=3600' : 'no-store')
        .send({ ...snapshot, quotaExhausted });
    } catch (err) {
      console.error('[incidents endpoint] Unexpected error:', err);
      return reply.send({ matchId, events: [], snapshotType: null, quotaExhausted });
    }
  });

  // Serve cached crest images at /api/crests/:filename
  app.get('/api/crests/:filename', async (req, reply) => {
    const { filename } = req.params as { filename: string };
    // Basic safety: only allow simple filenames, no path traversal
    if (!/^[\w.-]+$/.test(filename)) {
      return reply.code(400).send({ error: 'Invalid filename' });
    }
    const { promises: fs } = await import('node:fs');
    const path = await import('node:path');
    const filePath = path.join(CrestCache.cacheDir, filename);
    try {
      const buf = await fs.readFile(filePath);
      const ext = filename.split('.').pop()?.toLowerCase();
      const ct = ext === 'svg' ? 'image/svg+xml' : ext === 'png' ? 'image/png' : 'image/jpeg';
      return reply
        .header('Content-Type', ct)
        .header('Cache-Control', 'public, max-age=604800') // 7 days
        .send(buf);
    } catch {
      return reply.code(404).send({ error: 'Not found' });
    }
  });

  // ── Internal predictions inspection endpoint (PE-75) ──────────────────────
  registerInspectionRoute(app, predictionStore);

  // ── Experimental prediction endpoint (PE-78) ───────────────────────────────
  registerExperimentalPredictionRoute(app, predictionStore, evaluationStore);

  // ── V1 vs V2 comparison endpoint (SP-PRED-V2 §7) ──────────────────────────
  registerCompareRoute(
    app,
    predictionStore,
    v2PredictionStore,
    () => isFeatureEnabled('predictions'),
  );

  // ── Evaluation endpoint (OE-5) ─────────────────────────────────────────────
  registerEvaluationRoute(app, evaluationStore);

  // ── Historical evaluation endpoint (H5) ────────────────────────────────────
  const historicalBacktestStore = new HistoricalBacktestStore();
  registerHistoricalEvaluationRoute(app, historicalBacktestStore);

  // ── GET /api/ui/stream-source ───────────────────────────────────────────────
  // Fetcha la página de canal en futbollibretv.su y devuelve las URLs del embed activo.
  // El embed rota por partido — no se puede hardcodear en el frontend.
  // Params: sourcePageUrl (URL completa de la página del canal)
  const ALLOWED_FLTV_HOSTS = ['futbollibretv.su'];
  app.get('/api/ui/stream-source', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const sourcePageUrl = q.sourcePageUrl;

    if (!sourcePageUrl) {
      return reply.code(400).send({ error: 'Missing sourcePageUrl' });
    }

    try {
      const parsed = new URL(sourcePageUrl);
      if (!ALLOWED_FLTV_HOSTS.includes(parsed.hostname)) {
        return reply.code(403).send({ error: 'Host not allowed' });
      }
    } catch {
      return reply.code(400).send({ error: 'Invalid sourcePageUrl' });
    }

    const result = await fetchStreamEmbedUrls(sourcePageUrl);
    return reply
      .header('Cache-Control', 'no-store')
      .send({ embedUrls: result.embedUrls, fromCache: result.fromCache });
  });

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`SportsPulse API running at http://localhost:${PORT}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
