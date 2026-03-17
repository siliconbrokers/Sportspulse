/**
 * fetch-prev-season.ts — Descarga y cachea la temporada anterior (2024-25)
 * desde football-data.org para usarla como prevSeasonMatches en backtest-v3.
 *
 * Genera: cache/football-data/{code}/2024-25/prev-season.json
 * Formato: { matches: V3MatchRecord[] }
 *
 * Uso: npx tsx --tsconfig tsconfig.server.json tools/fetch-prev-season.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';
import type { V3MatchRecord } from '../packages/prediction/src/engine/v3/types.js';

config();

const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
if (!TOKEN) {
  console.error('FOOTBALL_DATA_TOKEN no encontrado en .env');
  process.exit(1);
}

const CACHE_BASE = path.join(process.cwd(), 'cache', 'football-data');

const LEAGUES = [
  { code: 'PD',  name: 'LaLiga',         season: 2024 },
  { code: 'PL',  name: 'Premier League', season: 2024 },
  { code: 'BL1', name: 'Bundesliga',     season: 2024 },
];

interface FDMatch {
  id: number;
  utcDate: string;
  status: string;
  matchday: number;
  homeTeam: { id: number; name: string };
  awayTeam: { id: number; name: string };
  score: {
    fullTime: { home: number | null; away: number | null };
  };
}

interface FDMatchesResponse {
  matches: FDMatch[];
}

function toTeamId(numericId: number): string {
  return `team:football-data:${numericId}`;
}

async function fetchLeaguePrevSeason(code: string, name: string, season: number): Promise<V3MatchRecord[]> {
  const url = `https://api.football-data.org/v4/competitions/${code}/matches?season=${season}`;
  console.log(`  Fetching ${name} (${season})...`);

  const res = await fetch(url, {
    headers: { 'X-Auth-Token': TOKEN! },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as FDMatchesResponse;
  const matches = data.matches ?? [];

  const finished = matches.filter(
    m => m.status === 'FINISHED' &&
         m.score.fullTime.home !== null &&
         m.score.fullTime.away !== null
  );

  return finished.map(m => ({
    homeTeamId: toTeamId(m.homeTeam.id),
    awayTeamId: toTeamId(m.awayTeam.id),
    utcDate: m.utcDate,
    homeGoals: m.score.fullTime.home!,
    awayGoals: m.score.fullTime.away!,
  }));
}

function savePrevSeason(code: string, season: number, matches: V3MatchRecord[]): string {
  const dir = path.join(CACHE_BASE, code, `${season}-${String(season + 1).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'prev-season.json');
  fs.writeFileSync(file, JSON.stringify({ matches, fetchedAt: new Date().toISOString() }, null, 2));
  return file;
}

async function main() {
  console.log('\n📥 Fetching previous season (2024-25) from football-data.org\n');

  for (const { code, name, season } of LEAGUES) {
    try {
      const matches = await fetchLeaguePrevSeason(code, name, season);
      const file = savePrevSeason(code, season, matches);
      console.log(`  ✅ ${name}: ${matches.length} partidos FINISHED → ${file}`);
    } catch (err) {
      console.error(`  ❌ ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Pequeña pausa para respetar rate limit de football-data.org (10 req/min free tier)
    await new Promise(r => setTimeout(r, 700));
  }

  console.log('\n✅ Listo. Re-ejecuta backtest-v3.ts para ver el impacto.\n');
}

void main();
