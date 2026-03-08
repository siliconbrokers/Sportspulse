import { buildApp } from '@sportpulse/api';
import { FootballDataSource } from './football-data-source.js';
import { TheSportsDbSource, SPORTSDB_PROVIDER_KEY } from './the-sports-db-source.js';
import { RoutingDataSource } from './routing-data-source.js';
import { NewsService } from './news/index.js';
import { VideoService } from './video/index.js';
import { RadarApiAdapter } from './radar/index.js';
import { EventosService, buildEventSource } from './eventos/index.js';
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
const PORT = Number(process.env.PORT ?? 3000);

// TheSportsDB — Liga Uruguaya
const SPORTSDB_API_KEY = process.env.SPORTSDB_API_KEY ?? '123';
const UY_LEAGUE_ID = '4432';
const UY_LEAGUE_NAME = 'Uruguayan Primera Division';
const UY_COMPETITION_ID = `comp:${SPORTSDB_PROVIDER_KEY}:${UY_LEAGUE_ID}`;

const DEFAULT_CONTAINER = {
  width: 1200,
  height: 700,
  outerPadding: 8,
  innerGutter: 6,
};

async function main() {
  const fdSource = new FootballDataSource(API_TOKEN);

  console.log(`Fetching competitions: ${COMPETITION_CODES.join(', ')}...`);
  for (let i = 0; i < COMPETITION_CODES.length; i++) {
    const code = COMPETITION_CODES[i];
    try {
      await fdSource.fetchCompetition(code);
    } catch (err) {
      console.error(`Failed to fetch ${code}:`, err);
    }
    // Respect football-data.org rate limit (10 req/min): wait between fetches
    if (i < COMPETITION_CODES.length - 1) {
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

  // Routing: Liga Uruguaya → TheSportsDB, everything else → football-data.org
  const dataSource = new RoutingDataSource(fdSource, [
    { competitionId: UY_COMPETITION_ID, providerKey: SPORTSDB_PROVIDER_KEY, source: sportsDbSource },
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

  // Crest resolver: busca el escudo en el DataSource canónico por nombre de equipo (lazy)
  const FD_COMP_IDS = COMPETITION_CODES.map((c) => `comp:football-data:${c}`);
  const ALL_COMP_IDS = [...FD_COMP_IDS, UY_COMPETITION_ID];
  function normTeamName(s: string) {
    return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }
  let crestMap: Map<string, string> | null = null;
  function resolveCrest(teamName: string): string | null {
    if (!crestMap) {
      crestMap = new Map();
      for (const compId of ALL_COMP_IDS) {
        for (const team of dataSource.getTeams(compId)) {
          if (team.crestUrl) {
            crestMap.set(normTeamName(team.name), team.crestUrl);
            if (team.shortName) crestMap.set(normTeamName(team.shortName), team.crestUrl);
          }
        }
      }
    }
    return crestMap.get(normTeamName(teamName)) ?? null;
  }

  const eventosService = new EventosService(
    buildEventSource(EVENTOS_SOURCE_URL), // sin arg → usa streamtp10.com por defecto
    { debugMode: EVENTOS_DEBUG },
    resolveCrest,
  );

  const app = buildApp({ snapshotService, dataSource, newsService, videoService, radarService, eventosService });

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
    for (const code of COMPETITION_CODES) {
      const seasonId = dataSource.getSeasonId(`comp:football-data:${code}`);
      if (seasonId) all.push(...dataSource.getMatches(seasonId));
    }
    const uySeasonId = dataSource.getSeasonId(UY_COMPETITION_ID);
    if (uySeasonId) all.push(...dataSource.getMatches(uySeasonId));
    return all;
  }

  function fmtDelay(ms: number): string {
    if (ms < MIN_MS)  return `${Math.round(ms / 1000)}s`;
    if (ms < HR_MS)   return `${Math.round(ms / MIN_MS)}min`;
    return `${(ms / HR_MS).toFixed(1)}h`;
  }

  async function runRefresh(): Promise<void> {
    for (let i = 0; i < COMPETITION_CODES.length; i++) {
      const code = COMPETITION_CODES[i];
      try {
        await fdSource.fetchCompetition(code);
      } catch (err) {
        console.error(`Refresh failed for ${code}:`, err);
      }
      if (i < COMPETITION_CODES.length - 1) {
        await new Promise<void>((r) => setTimeout(r, 7000));
      }
    }
    try {
      await sportsDbSource.fetchSeason();
    } catch (err) {
      console.error('Refresh failed for Liga Uruguaya:', err);
    }
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

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`SportsPulse API running at http://localhost:${PORT}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
