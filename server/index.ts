import { buildApp } from '@sportpulse/api';
import { FootballDataSource } from './football-data-source.js';
import { FootballDataTournamentSource, WC_PROVIDER_KEY } from './football-data-tournament-source.js';
import { TheSportsDbSource, SPORTSDB_PROVIDER_KEY } from './the-sports-db-source.js';
import { OpenLigaDBSource, OPENLIGADB_PROVIDER_KEY } from './openligadb-source.js';
import { CrestCache } from './crest-cache.js';
import { ApiFootballSource } from './api-football-source.js';
import { RoutingDataSource } from './routing-data-source.js';
import { NewsService } from './news/index.js';
import { VideoService } from './video/index.js';
import { RadarApiAdapter } from './radar/index.js';
import { EventosService, buildEventSource } from './eventos/index.js';
import { MatchEventsService } from './match-events-service.js';
import { IncidentService } from './incidents/incident-service.js';
import { PredictionService } from './prediction/prediction-service.js';
import { PredictionStore } from './prediction/prediction-store.js';
import { runShadow } from './prediction/shadow-runner.js';
import { registerInspectionRoute } from './prediction/inspection-route.js';
import type { MatchCoreInput } from './incidents/types.js';
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
  const fdSource = new FootballDataSource(API_TOKEN);

  console.log(`Fetching competitions from football-data.org: ${FD_COMPETITION_CODES.join(', ')}...`);
  for (let i = 0; i < FD_COMPETITION_CODES.length; i++) {
    const code = FD_COMPETITION_CODES[i];
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

  // TheSportsDB — Liga Uruguaya
  const sportsDbSource = new TheSportsDbSource(SPORTSDB_API_KEY, UY_LEAGUE_ID, UY_LEAGUE_NAME);
  try {
    await sportsDbSource.fetchSeason();
  } catch (err) {
    console.error(`Failed to fetch Liga Uruguaya from TheSportsDB:`, err);
  }

  // OpenLigaDB — Bundesliga (no auth required)
  const openLigaDbSource = new OpenLigaDBSource(OLG_LEAGUE, '1. Bundesliga');
  try {
    await openLigaDbSource.fetchSeason();
  } catch (err) {
    console.error('Failed to fetch Bundesliga from OpenLigaDB:', err);
  }

  // Football-data.org — Copa del Mundo 2026 (torneo con grupos + eliminatorias)
  const wcSource = new FootballDataTournamentSource(API_TOKEN, 'WC');
  const WC_COMPETITION_ID = wcSource.competitionId; // 'comp:football-data-wc:WC'
  try {
    // Rate limit: esperar antes de hacer las 3 llamadas del torneo
    await new Promise<void>((r) => setTimeout(r, 7000));
    await wcSource.fetchTournament();
  } catch (err) {
    console.error('Failed to fetch Copa del Mundo 2026 from football-data.org:', err);
  }

  // Routing: Liga Uruguaya → TheSportsDB, BL1 → OpenLigaDB, WC → wcSource, resto → football-data.org
  const dataSource = new RoutingDataSource(fdSource, [
    { competitionId: UY_COMPETITION_ID, providerKey: SPORTSDB_PROVIDER_KEY, source: sportsDbSource },
    { competitionId: OLG_COMPETITION_ID, providerKey: OPENLIGADB_PROVIDER_KEY, source: openLigaDbSource },
    { competitionId: WC_COMPETITION_ID, providerKey: WC_PROVIDER_KEY, source: wcSource },
  ]);

  // News service — demand-pull, cached per league (30-60 min TTL)
  const GNEWS_API_KEY = process.env.SERPAPI_KEY ?? process.env.GNEWS_API_KEY ?? '';
  if (!GNEWS_API_KEY) {
    console.warn('[NewsService] SERPAPI_KEY not set — league news will return empty blocks');
  }

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
  const newsService = new NewsService(GNEWS_API_KEY, standingsProvider);

  const snapshotService = new SnapshotService({
    store: new InMemorySnapshotStore(),
    defaultPolicy: MVP_POLICY,
    defaultContainer: DEFAULT_CONTAINER,
  });

  const radarService = new RadarApiAdapter(dataSource);

  // Eventos — fuente: streamtp10.com/eventos.json (default) o EVENTOS_SOURCE_URL env
  const EVENTOS_SOURCE_URL = process.env.EVENTOS_SOURCE_URL;
  const EVENTOS_DEBUG = process.env.EVENTOS_DEBUG === 'true';

  // Crest resolver: busca el escudo en el DataSource canónico por nombre de equipo (lazy, league-aware)
  const FD_COMP_IDS = FD_COMPETITION_CODES.map((c) => `comp:football-data:${c}`);
  const ALL_COMP_IDS = [...FD_COMP_IDS, UY_COMPETITION_ID, OLG_COMPETITION_ID];
  function normTeamName(s: string) {
    return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }
  // Mapas por liga para evitar confusión entre equipos homónimos (ej. Liverpool EPL vs Liverpool URU)
  let leagueCrestMaps: Map<string, Map<string, string>> | null = null;
  let globalCrestMap: Map<string, string> | null = null;
  function initCrestMaps() {
    if (leagueCrestMaps) return;
    leagueCrestMaps = new Map();
    globalCrestMap = new Map();
    const leagueToCompIds: Record<string, string[]> = {
      URUGUAY_PRIMERA: [UY_COMPETITION_ID],
      PREMIER_LEAGUE:  FD_COMPETITION_CODES.includes('PL') ? ['comp:football-data:PL'] : [],
      LALIGA:          FD_COMPETITION_CODES.includes('PD') ? ['comp:football-data:PD'] : [],
      BUNDESLIGA:      [OLG_COMPETITION_ID],
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
  const incidentService = new IncidentService(AF_KEY_FOR_INCIDENTS);

  const matchEventsService = new MatchEventsService(SPORTSDB_API_KEY, dataSource);
  // OpenLigaDB handles its own goal events natively (BL1)
  matchEventsService.registerProvider(OPENLIGADB_PROVIDER_KEY, openLigaDbSource);
  // API-Football handles post-match goal events for PD, PL, URU (disk-cached, 1 req/match)
  if (AF_KEY_FOR_INCIDENTS) {
    const apiFootballSource = new ApiFootballSource(AF_KEY_FOR_INCIDENTS, dataSource);
    matchEventsService.registerProvider('football-data', apiFootballSource);
    matchEventsService.registerProvider('thesportsdb', apiFootballSource);
    console.log('[ApiFootballSource] registered for football-data + thesportsdb');
  } else {
    console.warn('[ApiFootballSource] APIFOOTBALL_KEY not set — PD/PL/URU goal events disabled');
  }

  // ── UpcomingService — partidos de hoy / próximas 24h desde fuentes canónicas ──
  const PORTAL_TZ = 'America/Montevideo';

  const COMP_LEAGUE_KEY: Record<string, string> = {
    [UY_COMPETITION_ID]:  'URUGUAY_PRIMERA',
    [OLG_COMPETITION_ID]: 'BUNDESLIGA',
  };
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

          const isLive = m.status === 'IN_PROGRESS';
          const isUpcoming = m.status === 'SCHEDULED' && kickoffMs > now && kickoffMs <= cutoff;

          if (!isLive && !isUpcoming) continue;

          const home = teamMap.get(m.homeTeamId);
          const away = teamMap.get(m.awayTeamId);
          const portalTime = toPortalTime(m.startTimeUtc, PORTAL_TZ);

          results.push({
            id:               m.matchId,
            homeTeam:         home?.name ?? home?.shortName ?? m.homeTeamId,
            awayTeam:         away?.name ?? away?.shortName ?? m.awayTeamId,
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

  const predictionService = new PredictionService();
  const predictionStore = new PredictionStore();

  const app = buildApp({ snapshotService, dataSource, newsService, videoService, radarService, eventosService, matchEventsService, tournamentSource: wcSource, upcomingService, predictionService });

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

    // 5. No future matches in dataset — re-check once per day for fixture updates
    return 24 * HR_MS;
  }

  function getAllMatchSnapshots(): MatchSnapshot[] {
    const all: MatchSnapshot[] = [];
    for (const code of FD_COMPETITION_CODES) {
      const seasonId = dataSource.getSeasonId(`comp:football-data:${code}`);
      if (seasonId) all.push(...dataSource.getMatches(seasonId));
    }
    const uySeasonId = dataSource.getSeasonId(UY_COMPETITION_ID);
    if (uySeasonId) all.push(...dataSource.getMatches(uySeasonId));
    const olgSeasonId = dataSource.getSeasonId(OLG_COMPETITION_ID);
    if (olgSeasonId) all.push(...dataSource.getMatches(olgSeasonId));
    const wcSeasonId = wcSource.getSeasonId(WC_COMPETITION_ID);
    if (wcSeasonId) all.push(...wcSource.getMatches(wcSeasonId));
    return all;
  }

  function fmtDelay(ms: number): string {
    if (ms < MIN_MS)  return `${Math.round(ms / 1000)}s`;
    if (ms < HR_MS)   return `${Math.round(ms / MIN_MS)}min`;
    return `${(ms / HR_MS).toFixed(1)}h`;
  }

  async function runRefresh(): Promise<void> {
    for (let i = 0; i < FD_COMPETITION_CODES.length; i++) {
      const code = FD_COMPETITION_CODES[i];
      try {
        await fdSource.fetchCompetition(code);
      } catch (err) {
        console.error(`Refresh failed for ${code}:`, err);
      }
      if (i < FD_COMPETITION_CODES.length - 1) {
        await new Promise<void>((r) => setTimeout(r, 7000));
      }
    }
    try {
      await sportsDbSource.fetchSeason();
    } catch (err) {
      console.error('Refresh failed for Liga Uruguaya:', err);
    }
    try {
      await openLigaDbSource.fetchSeason();
    } catch (err) {
      console.error('Refresh failed for Bundesliga (OpenLigaDB):', err);
    }
    try {
      await wcSource.fetchTournament();
    } catch (err) {
      console.error('Refresh failed for Copa del Mundo 2026:', err);
    }
    // Shadow prediction pipeline — fire-and-forget, fault-isolated
    // Runs out-of-band: errors never propagate to the refresh cycle
    void runShadow(dataSource, ALL_COMP_IDS, predictionService, predictionStore);

    // Invalidate snapshot cache after every data source refresh.
    // This ensures MatchCardList (snapshot) and PronosticoCard/Radar (reads DataSource live)
    // always reflect the same canonical data — no inconsistency between sections.
    snapshotService.invalidateAll();
    console.log('[Scheduler] Snapshot cache invalidated after data refresh');
  }

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

  scheduleNextRefresh();

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

    try {
      const snapshot = await incidentService.get(matchCore);
      if (!snapshot) {
        return reply
          .header('Cache-Control', 'no-store')
          .send({ matchId, events: [], snapshotType: null });
      }
      return reply
        .header('Cache-Control', snapshot.isFinal ? 'public, max-age=3600' : 'no-store')
        .send(snapshot);
    } catch (err) {
      console.error('[incidents endpoint] Unexpected error:', err);
      return reply.send({ matchId, events: [], snapshotType: null });
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

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`SportsPulse API running at http://localhost:${PORT}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
