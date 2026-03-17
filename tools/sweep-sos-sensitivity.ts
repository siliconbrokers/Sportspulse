/**
 * sweep-sos-sensitivity.ts — SP-V4-05: SoS Sensitivity sweep.
 *
 * Evalúa composite score (acc + 0.6×DR + 0.4×DP) para
 * SOS_SENSITIVITY ∈ [0.0, 0.1, 0.15, 0.2, 0.3] via walk-forward backtest.
 *
 * Uso: npx tsx --tsconfig tsconfig.server.json tools/sweep-sos-sensitivity.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { runV3Engine } from '../packages/prediction/src/engine/v3/v3-engine.js';
import type { V3MatchRecord, V3EngineInput } from '../packages/prediction/src/engine/v3/types.js';

const CACHE_BASE = path.join(process.cwd(), 'cache', 'football-data');
const HIST_BASE  = path.join(process.cwd(), 'cache', 'historical', 'football-data');

const LEAGUES = [
  { code: 'PD',  name: 'LaLiga',    expectedSeasonGames: 38 },
  { code: 'PL',  name: 'EPL',       expectedSeasonGames: 38 },
  { code: 'BL1', name: 'Bundesliga', expectedSeasonGames: 34 },
];

interface CachedMatch {
  matchId: string;
  matchday: number;
  startTimeUtc: string;
  status: string;
  homeTeamId: string;
  awayTeamId: string;
  scoreHome: number | null;
  scoreAway: number | null;
}

function loadMatchdays(dir: string): Map<number, CachedMatch[]> {
  const result = new Map<number, CachedMatch[]>();
  if (!fs.existsSync(dir)) return result;
  fs.readdirSync(dir)
    .filter(f => /^matchday-\d+\.json$/.test(f))
    .sort()
    .forEach(f => {
      const num = parseInt(f.match(/(\d+)/)?.[1] ?? '0', 10);
      if (!num) return;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
        result.set(num, raw?.data?.matches ?? raw?.matches ?? []);
      } catch {}
    });
  return result;
}

function buildPrevSeason(code: string): V3MatchRecord[] {
  const r: V3MatchRecord[] = [];
  for (const y of [2023, 2024]) {
    const f = path.join(HIST_BASE, code, `${y}.json`);
    if (fs.existsSync(f)) {
      try {
        const raw = JSON.parse(fs.readFileSync(f, 'utf-8'));
        r.push(...(raw?.matches ?? []));
      } catch {}
    }
  }
  return r;
}

function toV3(m: CachedMatch): V3MatchRecord | null {
  if (m.scoreHome === null || m.scoreAway === null || !m.startTimeUtc) return null;
  return { homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId, utcDate: m.startTimeUtc, homeGoals: m.scoreHome, awayGoals: m.scoreAway };
}

function actualOutcome(m: CachedMatch): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' {
  if (m.scoreHome! > m.scoreAway!) return 'HOME_WIN';
  if (m.scoreAway! > m.scoreHome!) return 'AWAY_WIN';
  return 'DRAW';
}

function runBacktest(sosSens: number): { sosSens: number; acc: number; dr: number; dp: number; composite: number; ev: number } {
  let totalEv = 0, totalHits = 0, totalDrawReal = 0, totalPredDraw = 0, totalHitDraw = 0;

  for (const lg of LEAGUES) {
    const mds = loadMatchdays(path.join(CACHE_BASE, lg.code, '2025-26'));
    const prev = buildPrevSeason(lg.code);
    if (mds.size === 0) continue;
    const sorted = [...mds.keys()].sort((a, b) => a - b);

    for (const md of sorted) {
      const test = (mds.get(md) ?? [])
        .filter(m => m.status === 'FINISHED' && m.scoreHome !== null && m.startTimeUtc);
      if (test.length === 0) continue;

      const training: V3MatchRecord[] = [];
      for (const p of sorted) {
        if (p >= md) break;
        for (const m of (mds.get(p) ?? [])) {
          const r = toV3(m);
          if (r) training.push(r);
        }
      }

      for (const match of test) {
        const actual = actualOutcome(match);
        try {
          const input: V3EngineInput = {
            homeTeamId: match.homeTeamId,
            awayTeamId: match.awayTeamId,
            kickoffUtc: match.startTimeUtc,
            buildNowUtc: match.startTimeUtc,
            currentSeasonMatches: training,
            prevSeasonMatches: prev,
            expectedSeasonGames: lg.expectedSeasonGames,
            _overrideConstants: { SOS_SENSITIVITY: sosSens },
          };
          const out = runV3Engine(input);
          if (out.eligibility === 'NOT_ELIGIBLE' || out.predicted_result == null) continue;
          totalEv++;
          totalDrawReal += (actual === 'DRAW' ? 1 : 0);
          if (out.predicted_result === actual) totalHits++;
          if (out.predicted_result === 'DRAW') {
            totalPredDraw++;
            if (actual === 'DRAW') totalHitDraw++;
          }
        } catch {
          // skip errors
        }
      }
    }
  }

  const acc = totalEv > 0 ? totalHits / totalEv : 0;
  const dr  = totalDrawReal > 0 ? totalHitDraw / totalDrawReal : 0;
  const dp  = totalPredDraw > 0 ? totalHitDraw / totalPredDraw : 0;
  const composite = acc + 0.6 * dr + 0.4 * dp;
  return { sosSens, acc, dr, dp, composite, ev: totalEv };
}

const SOS_VALUES = [0.0, 0.1, 0.15, 0.2, 0.3];

console.log('\nSP-V4-05 — SoS Sensitivity Sweep (walk-forward, PD+PL+BL1 2025-26)');
console.log('composite = acc + 0.6×DR + 0.4×DP');
console.log('');
console.log('SoS    | acc%   | DR%    | DP%    | composite | n_eval');
console.log('-------|--------|--------|--------|-----------|-------');

let bestComposite = -Infinity;
let bestSoS = 0.0;

for (const sos of SOS_VALUES) {
  process.stdout.write(`  ${sos.toFixed(2)}...`);
  const r = runBacktest(sos);
  const line = `${String(sos.toFixed(2)).padEnd(6)} | ${(r.acc * 100).toFixed(2).padStart(6)} | ${(r.dr * 100).toFixed(2).padStart(6)} | ${(r.dp * 100).toFixed(2).padStart(6)} | ${r.composite.toFixed(4).padStart(9)} | ${r.ev}`;
  process.stdout.write('\r' + line + '\n');
  if (r.composite > bestComposite) {
    bestComposite = r.composite;
    bestSoS = sos;
  }
}

console.log('');
console.log(`Optimal SOS_SENSITIVITY: ${bestSoS} (composite = ${bestComposite.toFixed(4)})`);
