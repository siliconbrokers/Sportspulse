import { buildApp } from '@sportpulse/api';
import { FootballDataSource } from './football-data-source.js';
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

const DEFAULT_CONTAINER = {
  width: 1200,
  height: 700,
  outerPadding: 8,
  innerGutter: 6,
};

async function main() {
  const dataSource = new FootballDataSource(API_TOKEN);

  console.log(`Fetching competitions: ${COMPETITION_CODES.join(', ')}...`);
  for (const code of COMPETITION_CODES) {
    try {
      await dataSource.fetchCompetition(code);
    } catch (err) {
      console.error(`Failed to fetch ${code}:`, err);
    }
  }

  const snapshotService = new SnapshotService({
    store: new InMemorySnapshotStore(),
    defaultPolicy: MVP_POLICY,
    defaultContainer: DEFAULT_CONTAINER,
  });

  const app = buildApp({ snapshotService, dataSource });

  // Periodic refresh every 5 minutes
  setInterval(async () => {
    for (const code of COMPETITION_CODES) {
      try {
        await dataSource.fetchCompetition(code);
      } catch (err) {
        console.error(`Refresh failed for ${code}:`, err);
      }
    }
  }, 5 * 60 * 1000);

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`SportsPulse API running at http://localhost:${PORT}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
