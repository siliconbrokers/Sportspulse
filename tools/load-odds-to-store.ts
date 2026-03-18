/**
 * load-odds-to-store.ts — Carga el dataset histórico de odds al NEXUS raw odds store.
 *
 * Fuente: cache/odds-data/{LEAGUE}/{SEASON}.json
 *   (producido por tools/build-odds-dataset.ts desde football-data.co.uk)
 *
 * Destino: cache/odds-raw/{match_id}/{provider}/{snapshot_utc_safe}.json
 *   (raw-odds-store.ts — append-only, idempotente)
 *
 * Providers que se extraen por registro:
 *   - pinnacle   : psh / psd / psa
 *   - bet365     : b365h / b365d / b365a
 *   - market_max : maxh / maxd / maxa
 *   - market_avg : avgh / avgd / avga
 *
 * match_id se deriva como: "{league}:{date}:{normalizedHome}:{normalizedAway}"
 *   Ejemplo: "PD:2024-08-15:ath-bilbao:getafe"
 *
 * snapshot_utc: fecha del partido a las 12:00 UTC (aproximación para datos históricos).
 *   Las odds de football-data.co.uk son pre-kickoff, capturadas el día del partido.
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.server.json tools/load-odds-to-store.ts
 *   npx tsx --tsconfig tsconfig.server.json tools/load-odds-to-store.ts --dry-run
 *   npx tsx --tsconfig tsconfig.server.json tools/load-odds-to-store.ts --league=PD
 *   npx tsx --tsconfig tsconfig.server.json tools/load-odds-to-store.ts --league=PD --verbose
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { appendOddsRecord } from '../packages/prediction/src/nexus/odds/raw-odds-store.js';
import type { OddsRecord, OddsProvider } from '../packages/prediction/src/nexus/odds/types.js';

// ── CLI args ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN  = args.includes('--dry-run');
const VERBOSE  = args.includes('--verbose');
const leagueArg = args.find(a => a.startsWith('--league='))?.split('=')[1];

const CACHE_DIR    = path.join(process.cwd(), 'cache');
const ODDS_DATA_DIR = path.join(CACHE_DIR, 'odds-data');

// ── Types ─────────────────────────────────────────────────────────────────────

interface OddsDataMatch {
  date:     string;
  homeTeam: string;
  awayTeam: string;
  ftr?:     string;
  // Pinnacle
  psh?:   number;
  psd?:   number;
  psa?:   number;
  // Bet365
  b365h?: number;
  b365d?: number;
  b365a?: number;
  // Market Max
  maxh?:  number;
  maxd?:  number;
  maxa?:  number;
  // Market Avg
  avgh?:  number;
  avgd?:  number;
  avga?:  number;
}

interface OddsDataFile {
  league:   string;
  season:   string;
  matches:  OddsDataMatch[];
}

interface ProviderOdds {
  provider: OddsProvider;
  home:     number;
  draw:     number;
  away:     number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Normalizes a team name to a URL-safe slug for use in match_id.
 * Strips accents, lowercases, replaces spaces/special chars with hyphens.
 *
 * Examples:
 *   "Ath Bilbao"  → "ath-bilbao"
 *   "Real Madrid" → "real-madrid"
 *   "Málaga"      → "malaga"
 */
function normalizeTeamName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')       // non-alnum → hyphen
    .replace(/^-+|-+$/g, '');          // trim leading/trailing hyphens
}

/**
 * Derive the canonical match_id from league + date + team names.
 *
 * Format: "{league}:{date}:{normalizedHome}:{normalizedAway}"
 * Example: "PD:2024-08-15:ath-bilbao:getafe"
 *
 * This derivation must be stable and deterministic. The same combination
 * of inputs always produces the same match_id, which enables the raw odds
 * store's idempotency invariant to work correctly across multiple loads.
 */
function deriveMatchId(league: string, date: string, homeTeam: string, awayTeam: string): string {
  return `${league}:${date}:${normalizeTeamName(homeTeam)}:${normalizeTeamName(awayTeam)}`;
}

/**
 * Returns the snapshot_utc for a historical record.
 * We approximate to 12:00 UTC on the match date (pre-kickoff window).
 * Football-data.co.uk odds are captured before the match begins.
 */
function deriveSnapshotUtc(date: string): string {
  return `${date}T12:00:00Z`;
}

/**
 * Extracts all available provider odds from a match row.
 * Returns only providers where all three legs (home/draw/away) are present
 * and positive (guard against zero/null from malformed rows).
 */
function extractProviderOdds(match: OddsDataMatch): ProviderOdds[] {
  const results: ProviderOdds[] = [];

  const candidates: Array<{ provider: OddsProvider; h: number | undefined; d: number | undefined; a: number | undefined }> = [
    { provider: 'pinnacle',   h: match.psh,   d: match.psd,   a: match.psa   },
    { provider: 'bet365',     h: match.b365h, d: match.b365d, a: match.b365a },
    { provider: 'market_max', h: match.maxh,  d: match.maxd,  a: match.maxa  },
    { provider: 'market_avg', h: match.avgh,  d: match.avgd,  a: match.avga  },
  ];

  for (const c of candidates) {
    if (
      c.h != null && c.d != null && c.a != null &&
      c.h > 0    && c.d > 0    && c.a > 0
    ) {
      results.push({ provider: c.provider, home: c.h, draw: c.d, away: c.a });
    }
  }

  return results;
}

// ── Core loader ───────────────────────────────────────────────────────────────

interface LoadStats {
  filesProcessed:  number;
  matchesRead:     number;
  recordsWritten:  number;
  recordsSkipped:  number;   // idempotent no-ops (existing files)
  recordsNoOdds:   number;   // rows with no usable odds
  errors:          number;
}

async function loadLeagueSeason(
  league: string,
  filePath: string,
  stats: LoadStats,
  retrievedAtUtc: string,
): Promise<void> {
  const raw = await fs.readFile(filePath, 'utf8');
  const data: OddsDataFile = JSON.parse(raw);
  stats.filesProcessed++;

  for (const match of data.matches) {
    stats.matchesRead++;

    const providerOdds = extractProviderOdds(match);

    if (providerOdds.length === 0) {
      stats.recordsNoOdds++;
      if (VERBOSE) {
        console.log(`  [skip-no-odds] ${match.date} ${match.homeTeam} vs ${match.awayTeam}`);
      }
      continue;
    }

    const matchId      = deriveMatchId(league, match.date, match.homeTeam, match.awayTeam);
    const snapshotUtc  = deriveSnapshotUtc(match.date);

    for (const po of providerOdds) {
      const record: OddsRecord = {
        match_id:         matchId,
        provider:         po.provider,
        market:           '1x2',
        odds_home:        po.home,
        odds_draw:        po.draw,
        odds_away:        po.away,
        snapshot_utc:     snapshotUtc,
        retrieved_at_utc: retrievedAtUtc,
      };

      if (VERBOSE) {
        console.log(
          `  [record] ${matchId} | ${po.provider} | H:${po.home} D:${po.draw} A:${po.away}`,
        );
      }

      if (DRY_RUN) {
        stats.recordsWritten++;
        continue;
      }

      try {
        // Check if the file already exists before calling appendOddsRecord
        // so we can distinguish written vs skipped in stats.
        // appendOddsRecord is idempotent and will no-op on existing files,
        // but we can't observe that from the outside without pre-checking.
        const targetDir = path.join(
          CACHE_DIR,
          'odds-raw',
          matchId,
          po.provider,
        );
        const safeSnapshot = snapshotUtc.replace(/:/g, '-');
        const targetFile   = path.join(targetDir, `${safeSnapshot}.json`);

        let alreadyExists = false;
        try {
          await fs.access(targetFile);
          alreadyExists = true;
        } catch {
          // does not exist
        }

        await appendOddsRecord(record, CACHE_DIR);

        if (alreadyExists) {
          stats.recordsSkipped++;
        } else {
          stats.recordsWritten++;
        }
      } catch (err) {
        stats.errors++;
        console.error(
          `  [error] ${matchId} | ${po.provider}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const retrievedAtUtc = new Date().toISOString();

  console.log('NEXUS Odds Loader — Historical Dataset → Raw Odds Store');
  console.log(`  Mode     : ${DRY_RUN ? 'DRY RUN (no writes)' : 'WRITE'}`);
  console.log(`  League   : ${leagueArg ?? 'ALL'}`);
  console.log(`  Verbose  : ${VERBOSE}`);
  console.log(`  Source   : ${ODDS_DATA_DIR}`);
  console.log(`  Dest     : ${path.join(CACHE_DIR, 'odds-raw')}`);
  console.log('');

  // Discover leagues
  let leagues: string[];
  try {
    const entries = await fs.readdir(ODDS_DATA_DIR, { withFileTypes: true });
    leagues = entries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort();
  } catch {
    console.error(`ERROR: could not read odds-data directory: ${ODDS_DATA_DIR}`);
    process.exit(1);
  }

  if (leagueArg) {
    if (!leagues.includes(leagueArg)) {
      console.error(`ERROR: league '${leagueArg}' not found in ${ODDS_DATA_DIR}`);
      console.error(`Available leagues: ${leagues.join(', ')}`);
      process.exit(1);
    }
    leagues = [leagueArg];
  }

  const stats: LoadStats = {
    filesProcessed: 0,
    matchesRead:    0,
    recordsWritten: 0,
    recordsSkipped: 0,
    recordsNoOdds:  0,
    errors:         0,
  };

  for (const league of leagues) {
    const leagueDir = path.join(ODDS_DATA_DIR, league);
    let files: string[];
    try {
      files = (await fs.readdir(leagueDir))
        .filter(f => f.endsWith('.json'))
        .sort();
    } catch {
      console.error(`  [warn] could not read directory: ${leagueDir}`);
      continue;
    }

    console.log(`League: ${league} (${files.length} season files)`);

    for (const file of files) {
      const filePath = path.join(leagueDir, file);
      console.log(`  Processing: ${file}`);
      await loadLeagueSeason(league, filePath, stats, retrievedAtUtc);
    }
  }

  // Summary
  console.log('');
  console.log('── Summary ──────────────────────────────────────────────');
  console.log(`  Files processed  : ${stats.filesProcessed}`);
  console.log(`  Matches read     : ${stats.matchesRead}`);
  console.log(`  Records written  : ${stats.recordsWritten}${DRY_RUN ? ' (dry-run, not persisted)' : ''}`);
  console.log(`  Records skipped  : ${stats.recordsSkipped} (already existed — idempotent)`);
  console.log(`  No-odds rows     : ${stats.recordsNoOdds} (no usable odds found)`);
  console.log(`  Errors           : ${stats.errors}`);

  if (stats.errors > 0) {
    console.log('');
    console.log('COMPLETED WITH ERRORS — check output above for details.');
    process.exit(1);
  } else {
    console.log('');
    console.log('Done.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
