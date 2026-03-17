/**
 * build-odds-dataset.ts — Descarga y parsea odds históricas de football-data.co.uk
 *
 * Fuente: https://www.football-data.co.uk/mmz4281/{SEASON}/{DIV}.csv
 * Ligas:  PD (SP1) · PL (E0) · BL1 (D1)
 * Temporadas: 2016-17 → 2024-25 + parcial 2025-26
 *
 * Salida: cache/odds-data/{COMP}/{SEASON}.json
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.server.json tools/build-odds-dataset.ts
 *   npx tsx --tsconfig tsconfig.server.json tools/build-odds-dataset.ts --comp PD
 */

import * as fs   from 'fs';
import * as path from 'path';
import * as https from 'https';

// ── Config ────────────────────────────────────────────────────────────────────

const OUT_BASE = path.join(process.cwd(), 'cache', 'odds-data');

interface LeagueDef {
  code:    string;  // nuestro código (PD, PL, BL1)
  csvCode: string;  // código en football-data.co.uk
  name:    string;
}

const LEAGUES: LeagueDef[] = [
  { code: 'PD',  csvCode: 'SP1', name: 'LaLiga'       },
  { code: 'PL',  csvCode: 'E0',  name: 'Premier League' },
  { code: 'BL1', csvCode: 'D1',  name: 'Bundesliga'   },
];

// Temporadas disponibles en football-data.co.uk (formato XXYY)
const SEASONS = ['2526','2425','2324','2223','2122','2021','1920','1819','1718','1617'];

// ── CLI args ─────────────────────────────────────────────────────────────────

const args   = process.argv.slice(2);
const compArg = args.find((_, i) => args[i - 1] === '--comp');
const targetLeagues = compArg
  ? LEAGUES.filter(l => l.code === compArg)
  : LEAGUES;

// ── Types ─────────────────────────────────────────────────────────────────────

interface OddsRecord {
  date:        string;   // ISO date YYYY-MM-DD
  homeTeam:    string;   // nombre original del CSV
  awayTeam:    string;
  ftr:         'H' | 'D' | 'A';
  fthg:        number;
  ftag:        number;
  // Bet365 (más disponibles históricamente)
  b365h:       number | null;
  b365d:       number | null;
  b365a:       number | null;
  // Pinnacle (más eficiente cuando disponible)
  psh:         number | null;
  psd:         number | null;
  psa:         number | null;
  // Max / Avg (consensus)
  maxh:        number | null;
  maxd:        number | null;
  maxa:        number | null;
  avgh:        number | null;
  avgd:        number | null;
  avga:        number | null;
  // Implied probs normalizadas (Pinnacle si disponible, sino Bet365, sino Max/Avg)
  impliedProbHome: number;
  impliedProbDraw: number;
  impliedProbAway: number;
  oddsSource:  'pinnacle' | 'bet365' | 'avg' | 'unknown';
}

interface OddsFile {
  league:  string;
  season:  string;   // e.g. "2023-24"
  source:  string;
  builtAt: string;
  matches: OddsRecord[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fetch(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode} for ${url}`)); return; }
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    }).on('error', reject);
  });
}

/** Convierte season code "2324" → "2023-24" */
function formatSeason(code: string): string {
  const y1 = parseInt('20' + code.slice(0, 2), 10);
  const y2 = parseInt('20' + code.slice(2),    10);
  return `${y1}-${String(y2).slice(-2)}`;
}

/** Parsea fecha DD/MM/YY o DD/MM/YYYY → ISO YYYY-MM-DD */
function parseDate(raw: string): string | null {
  if (!raw || !raw.includes('/')) return null;
  const parts = raw.split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts;
  const year = y.length === 2 ? (parseInt(y, 10) >= 90 ? '19' + y : '20' + y) : y;
  return `${year}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

function parseFloat2(v: string): number | null {
  const n = parseFloat(v);
  return isNaN(n) || n <= 0 ? null : n;
}

/** Normaliza odds 1X2 → implied probs (elimina overround). */
function normalizeOdds(h: number, d: number, a: number): { ph: number; pd: number; pa: number } {
  const rh = 1 / h, rd = 1 / d, ra = 1 / a;
  const sum = rh + rd + ra;
  return { ph: rh / sum, pd: rd / sum, pa: ra / sum };
}

// ── CSV Parser ────────────────────────────────────────────────────────────────

function parseCSV(csv: string): OddsRecord[] {
  const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim());
  const col = (name: string): number => headers.indexOf(name);

  const iDate  = col('Date');
  const iHT    = col('HomeTeam');
  const iAT    = col('AwayTeam');
  const iFTR   = col('FTR');
  const iFTHG  = col('FTHG');
  const iFTAG  = col('FTAG');
  const iB365H = col('B365H'); const iB365D = col('B365D'); const iB365A = col('B365A');
  const iPSH   = col('PSH');   const iPSD   = col('PSD');   const iPSA   = col('PSA');
  const iMaxH  = col('MaxH');  const iMaxD  = col('MaxD');  const iMaxA  = col('MaxA');
  const iAvgH  = col('AvgH');  const iAvgD  = col('AvgD');  const iAvgA  = col('AvgA');

  const records: OddsRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 8) continue;

    const date = parseDate(cols[iDate] ?? '');
    if (!date) continue;

    const homeTeam = cols[iHT]?.trim();
    const awayTeam = cols[iAT]?.trim();
    if (!homeTeam || !awayTeam) continue;

    const ftr = cols[iFTR]?.trim() as 'H' | 'D' | 'A';
    if (!['H','D','A'].includes(ftr)) continue;

    const fthg = parseInt(cols[iFTHG] ?? '', 10);
    const ftag = parseInt(cols[iFTAG] ?? '', 10);
    if (isNaN(fthg) || isNaN(ftag)) continue;

    const b365h = iB365H >= 0 ? parseFloat2(cols[iB365H] ?? '') : null;
    const b365d = iB365D >= 0 ? parseFloat2(cols[iB365D] ?? '') : null;
    const b365a = iB365A >= 0 ? parseFloat2(cols[iB365A] ?? '') : null;

    const psh = iPSH >= 0 ? parseFloat2(cols[iPSH] ?? '') : null;
    const psd = iPSD >= 0 ? parseFloat2(cols[iPSD] ?? '') : null;
    const psa = iPSA >= 0 ? parseFloat2(cols[iPSA] ?? '') : null;

    const maxh = iMaxH >= 0 ? parseFloat2(cols[iMaxH] ?? '') : null;
    const maxd = iMaxD >= 0 ? parseFloat2(cols[iMaxD] ?? '') : null;
    const maxa = iMaxA >= 0 ? parseFloat2(cols[iMaxA] ?? '') : null;

    const avgh = iAvgH >= 0 ? parseFloat2(cols[iAvgH] ?? '') : null;
    const avgd = iAvgD >= 0 ? parseFloat2(cols[iAvgD] ?? '') : null;
    const avga = iAvgA >= 0 ? parseFloat2(cols[iAvgA] ?? '') : null;

    // Elegir fuente de odds para implied probs (preferencia: Pinnacle > Bet365 > Avg)
    let impliedProbHome = 1/3, impliedProbDraw = 1/3, impliedProbAway = 1/3;
    let oddsSource: OddsRecord['oddsSource'] = 'unknown';

    if (psh && psd && psa) {
      const n = normalizeOdds(psh, psd, psa);
      impliedProbHome = n.ph; impliedProbDraw = n.pd; impliedProbAway = n.pa;
      oddsSource = 'pinnacle';
    } else if (b365h && b365d && b365a) {
      const n = normalizeOdds(b365h, b365d, b365a);
      impliedProbHome = n.ph; impliedProbDraw = n.pd; impliedProbAway = n.pa;
      oddsSource = 'bet365';
    } else if (avgh && avgd && avga) {
      const n = normalizeOdds(avgh, avgd, avga);
      impliedProbHome = n.ph; impliedProbDraw = n.pd; impliedProbAway = n.pa;
      oddsSource = 'avg';
    }

    records.push({
      date, homeTeam, awayTeam, ftr, fthg, ftag,
      b365h, b365d, b365a,
      psh, psd, psa,
      maxh, maxd, maxa,
      avgh, avgd, avga,
      impliedProbHome: Math.round(impliedProbHome * 10000) / 10000,
      impliedProbDraw: Math.round(impliedProbDraw * 10000) / 10000,
      impliedProbAway: Math.round(impliedProbAway * 10000) / 10000,
      oddsSource,
    });
  }

  return records;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== build-odds-dataset: football-data.co.uk → cache/odds-data/ ===\n');

  let totalMatches  = 0;
  let totalWithOdds = 0;

  for (const league of targetLeagues) {
    console.log(`\n── ${league.name} (${league.code}) ──`);
    const outDir = path.join(OUT_BASE, league.code);
    fs.mkdirSync(outDir, { recursive: true });

    for (const seasonCode of SEASONS) {
      const url    = `https://www.football-data.co.uk/mmz4281/${seasonCode}/${league.csvCode}.csv`;
      const season = formatSeason(seasonCode);
      const outFile = path.join(outDir, `${season}.json`);

      process.stdout.write(`  ${season} — `);

      let csv: string;
      try {
        csv = await fetch(url);
      } catch (e: any) {
        console.log(`skip (${e.message})`);
        continue;
      }

      const matches = parseCSV(csv);
      if (matches.length === 0) {
        console.log('skip (0 records)');
        continue;
      }

      const withOdds = matches.filter(m => m.oddsSource !== 'unknown').length;
      const pinnaclePct = Math.round(100 * matches.filter(m => m.oddsSource === 'pinnacle').length / matches.length);

      const out: OddsFile = {
        league:  league.code,
        season,
        source:  url,
        builtAt: new Date().toISOString(),
        matches,
      };

      const tmp = outFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf-8');
      fs.renameSync(tmp, outFile);

      console.log(`${matches.length} partidos · odds: ${withOdds}/${matches.length} · Pinnacle: ${pinnaclePct}%`);
      totalMatches  += matches.length;
      totalWithOdds += withOdds;
    }
  }

  console.log('\n══════════════════════════════════════════');
  console.log(`Total: ${totalMatches} partidos · con odds: ${totalWithOdds} (${Math.round(100*totalWithOdds/Math.max(totalMatches,1))}%)`);
  console.log(`Salida: ${OUT_BASE}`);
  console.log('\nSiguiente paso:');
  console.log('  Integrar implied probs como feature en train-logistic.ts usando fecha + nombre de equipo normalizado.');
}

main().catch(err => {
  console.error('build-odds-dataset failed:', err);
  process.exit(1);
});
