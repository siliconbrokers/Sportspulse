import { buildApp } from '@sportpulse/api';
import { FootballDataSource } from './football-data-source.js';
import { TheSportsDbSource, SPORTSDB_PROVIDER_KEY } from './the-sports-db-source.js';
import { RoutingDataSource } from './routing-data-source.js';
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

  const snapshotService = new SnapshotService({
    store: new InMemorySnapshotStore(),
    defaultPolicy: MVP_POLICY,
    defaultContainer: DEFAULT_CONTAINER,
  });

  const app = buildApp({ snapshotService, dataSource });

  // Periodic refresh every 10 minutes
  setInterval(async () => {
    // football-data.org (with rate limit delay between competitions)
    for (let i = 0; i < COMPETITION_CODES.length; i++) {
      const code = COMPETITION_CODES[i];
      try {
        await fdSource.fetchCompetition(code);
      } catch (err) {
        console.error(`Refresh failed for ${code}:`, err);
      }
      if (i < COMPETITION_CODES.length - 1) {
        await new Promise((r) => setTimeout(r, 7000));
      }
    }
    // TheSportsDB — Liga Uruguaya
    try {
      await sportsDbSource.fetchSeason();
    } catch (err) {
      console.error(`Refresh failed for Liga Uruguaya:`, err);
    }
  }, 10 * 60 * 1000);

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`SportsPulse API running at http://localhost:${PORT}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
