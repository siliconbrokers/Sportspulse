/**
 * download-af-historical.ts — Descarga fixtures históricos (FT) de API-Football
 * y los guarda en cache/historical/apifootball/{leagueId}/{seasonLabel}.json
 *
 * Formato de salida (compatible con gen-calibration.ts y run-backtest-v3-historical.ts):
 *   { version: 1, leagueId, seasonLabel, savedAt, matches: V3MatchRecord[] }
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.server.json tools/download-af-historical.ts \
 *     --league 135 --season 2024 --season-label 2024-25
 *
 *   # SA (135): 2 temporadas
 *   npx tsx ... --league 135 --season 2024 --season-label 2024-25
 *   npx tsx ... --league 135 --season 2023 --season-label 2023-24
 *
 *   # PT (94): 2 temporadas
 *   npx tsx ... --league 94 --season 2024 --season-label 2024-25
 *   npx tsx ... --league 94 --season 2023 --season-label 2023-24
 *
 *   # BR (71): 2 temporadas (calendar)
 *   npx tsx ... --league 71 --season 2025 --season-label 2025
 *   npx tsx ... --league 71 --season 2024 --season-label 2024
 *
 * Flags:
 *   --league N          AF league ID (requerido)
 *   --season N          AF season year param (requerido)
 *   --season-label STR  Label para el filename (requerido, ej: "2024-25" o "2024")
 *   --dry-run           Muestra el plan sin descargar
 *   --force             Sobreescribir si ya existe
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { config } from 'dotenv';

config();

// ── CLI ────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(flag: string): string | null {
  const i = args.indexOf(flag);
  return i !== -1 ? (args[i + 1] ?? null) : null;
}
const LEAGUE_ID    = parseInt(getArg('--league') ?? '0', 10);
const SEASON_YEAR  = parseInt(getArg('--season') ?? '0', 10);
const SEASON_LABEL = getArg('--season-label') ?? '';
const DRY_RUN      = args.includes('--dry-run');
const FORCE        = args.includes('--force');

if (!LEAGUE_ID || !SEASON_YEAR || !SEASON_LABEL) {
  console.error('USO: download-af-historical.ts --league N --season N --season-label STR');
  process.exit(1);
}

const API_KEY  = process.env.APIFOOTBALL_KEY ?? '';
if (!API_KEY && !DRY_RUN) {
  console.error('ERROR: APIFOOTBALL_KEY no configurado');
  process.exit(1);
}

const OUT_DIR  = path.join(process.cwd(), 'cache', 'historical', 'apifootball', String(LEAGUE_ID));
const OUT_FILE = path.join(OUT_DIR, `${SEASON_LABEL}.json`);

// ── Types ─────────────────────────────────────────────────────────────────────

interface AfFixtureResponse {
  response?: AfFixture[];
  errors?: Record<string, string>;
}

interface AfFixture {
  fixture: { id: number; date: string; status: { short: string } };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals: { home: number | null; away: number | null };
}

interface V3MatchRecord {
  homeTeamId: string;
  awayTeamId: string;
  utcDate:    string;
  homeGoals:  number;
  awayGoals:  number;
}

interface HistoricalDoc {
  version:     1;
  leagueId:    number;
  seasonLabel: string;
  savedAt:     string;
  matches:     V3MatchRecord[];
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\nAF Historical Download`);
  console.log(`  leagueId    : ${LEAGUE_ID}`);
  console.log(`  season      : ${SEASON_YEAR}`);
  console.log(`  seasonLabel : ${SEASON_LABEL}`);
  console.log(`  output      : ${OUT_FILE}`);
  console.log(`  dry-run     : ${DRY_RUN}`);
  console.log('');

  if (!FORCE && fs.existsSync(OUT_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(OUT_FILE, 'utf-8')) as HistoricalDoc;
      const count = existing.matches?.length ?? 0;
      if (count > 0) {
        console.log(`✓ Ya existe: ${OUT_FILE} (${count} matches). Usar --force para sobreescribir.`);
        return;
      }
    } catch { /* file corrupt — proceed */ }
  }

  if (DRY_RUN) {
    console.log(`DRY RUN: GET /fixtures?league=${LEAGUE_ID}&season=${SEASON_YEAR}&status=FT`);
    console.log('Salida sería:', OUT_FILE);
    return;
  }

  const url = `https://v3.football.api-sports.io/fixtures?league=${LEAGUE_ID}&season=${SEASON_YEAR}&status=FT`;
  console.log(`Fetching: ${url}`);

  const res = await fetch(url, { headers: { 'x-apisports-key': API_KEY } });
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }

  const body = await res.json() as AfFixtureResponse;

  if (body.errors && Object.keys(body.errors).length > 0) {
    const vals = Object.values(body.errors);
    if (vals.some((v) => typeof v === 'string' && v.toLowerCase().includes('limit'))) {
      console.error('ERROR: cuota AF agotada');
      process.exit(1);
    }
    console.error('ERROR de API:', JSON.stringify(body.errors));
    process.exit(1);
  }

  const fixtures = body.response ?? [];
  console.log(`Fixtures FT recibidos: ${fixtures.length}`);

  const matches: V3MatchRecord[] = [];
  let skipped = 0;

  for (const f of fixtures) {
    const hGoals = f.goals?.home;
    const aGoals = f.goals?.away;
    if (hGoals === null || hGoals === undefined || aGoals === null || aGoals === undefined) {
      skipped++;
      continue;
    }
    matches.push({
      homeTeamId: `team:apifootball:${f.teams.home.id}`,
      awayTeamId: `team:apifootball:${f.teams.away.id}`,
      utcDate:    f.fixture.date,
      homeGoals:  hGoals,
      awayGoals:  aGoals,
    });
  }

  console.log(`Matches válidos : ${matches.length}  (${skipped} sin score — saltados)`);

  if (matches.length === 0) {
    console.log('Sin matches — nada que guardar.');
    return;
  }

  // Sort chronologically
  matches.sort((a, b) => a.utcDate.localeCompare(b.utcDate));

  const doc: HistoricalDoc = {
    version:     1,
    leagueId:    LEAGUE_ID,
    seasonLabel: SEASON_LABEL,
    savedAt:     new Date().toISOString(),
    matches,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tmp = `${OUT_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf-8');
  fs.renameSync(tmp, OUT_FILE);

  console.log(`✓ Guardado: ${OUT_FILE}`);
}

main().catch((err) => {
  console.error('ERROR:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
