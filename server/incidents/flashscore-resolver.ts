/**
 * flashscore-resolver — resuelve nuestro matchId al ID interno de Flashscore.
 *
 * Estrategia (spec §7.1 — automatizable):
 *   1. Buscar en id-map (caché permanente) → devolver si existe
 *   2. Fetch de la página de resultados de Flashscore para esa competición
 *   3. Parsear todos los partidos con cheerio → fuzzy match por nombres de equipo
 *   4. Guardar TODOS los IDs encontrados en id-map (batch por jornada)
 *   5. Devolver el ID del partido pedido
 *
 * Los selectores CSS de Flashscore pueden necesitar ajuste si cambian su HTML.
 */
import { load as cheerioLoad } from 'cheerio';
import { getFlashscoreId, setFlashscoreIds } from './flashscore-id-map.js';
import type { MatchCoreInput } from './types.js';

// ── Mapa de competición → slug de Flashscore ──────────────────────────────────

const FS_COMPETITION_SLUGS: Record<string, string> = {
  'comp:football-data:PD':      'football/spain/laliga',
  'comp:football-data:PL':      'football/england/premier-league',
  'comp:openligadb:bl1':        'football/germany/bundesliga',
  'comp:thesportsdb:4432':      'football/uruguay/primera-division',
  'comp:football-data-wc:WC':   'football/world/world-cup-2026',
};

// ── Normalización de nombres para fuzzy match ─────────────────────────────────

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // quitar tildes
    .replace(/\b(fc|cf|sc|ac|as|if|bv|sv|fk|rc|rcd|cd|ud|sd|ue|afc|fk)\b/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  // Distancia de Levenshtein simple para nombres cortos
  if (Math.abs(na.length - nb.length) <= 3 && levenshtein(na, nb) <= 3) return true;
  return false;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// ── Fetch con headers de browser realistas ────────────────────────────────────

const FS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://www.flashscore.com/',
  'DNT': '1',
};

// ── Parsed match from Flashscore HTML ────────────────────────────────────────

interface FsParsedMatch {
  fsId: string;
  homeTeam: string;
  awayTeam: string;
  dateText?: string;
}

/**
 * Parsea la página de resultados de Flashscore y extrae pares (fsId, homeTeam, awayTeam).
 * Los elementos tienen id="g_1_{fsId}" con clases .event__participant para equipos.
 *
 * NOTA: Los selectores CSS deben verificarse contra el HTML real de Flashscore.
 * Si cambian el markup, actualizar aquí.
 */
function parseFlashscorePage(html: string): FsParsedMatch[] {
  const $ = cheerioLoad(html);
  const results: FsParsedMatch[] = [];

  // Flashscore renders matches as: <div id="g_1_{fsId}" class="event__match ...">
  $('[id^="g_1_"]').each((_, el) => {
    const id = $(el).attr('id') ?? '';
    const fsId = id.replace('g_1_', '');
    if (!fsId || fsId.length < 4) return;

    // Team names in .event__participant (first = home, second = away)
    const participants = $(el).find('.event__participant');
    const homeTeam = participants.eq(0).text().trim();
    const awayTeam = participants.eq(1).text().trim();

    if (homeTeam && awayTeam) {
      results.push({ fsId, homeTeam, awayTeam });
    }
  });

  return results;
}

// ── Resolver principal ────────────────────────────────────────────────────────

/**
 * Resuelve el Flashscore match ID para un partido.
 * Busca en caché primero; si no está, hace discovery por jornada completa.
 * Retorna null si no se puede resolver (sin romper el flujo — spec AC-7).
 */
export async function resolveFlashscoreId(
  matchCore: MatchCoreInput,
  /** Todos los partidos de la misma jornada/competición (para batch resolution) */
  siblingMatches: MatchCoreInput[],
): Promise<string | null> {
  // 1. Check caché permanente
  const cached = await getFlashscoreId(matchCore.matchId);
  if (cached) return cached;

  // 2. Determinar slug de la competición
  const slug = FS_COMPETITION_SLUGS[matchCore.competitionId];
  if (!slug) {
    console.warn(`[FlashscoreResolver] No slug for competitionId=${matchCore.competitionId}`);
    return null;
  }

  // 3. Fetch de la página de la competición (resultados recientes)
  let html: string;
  try {
    const url = `https://www.flashscore.com/${slug}/results/`;
    console.log(`[FlashscoreResolver] Fetching ${url}`);
    const res = await fetch(url, { headers: FS_HEADERS });
    if (!res.ok) {
      console.warn(`[FlashscoreResolver] HTTP ${res.status} for ${url}`);
      return null;
    }
    html = await res.text();
  } catch (err) {
    console.warn(`[FlashscoreResolver] Fetch failed:`, err);
    return null;
  }

  // 4. Parsear matches de Flashscore
  const fsMatches = parseFlashscorePage(html);
  if (fsMatches.length === 0) {
    console.warn(`[FlashscoreResolver] No matches parsed from Flashscore page (HTML structure may have changed)`);
    return null;
  }

  // 5. Fuzzy match contra todos los partidos de la jornada → batch save
  const allMatches = [matchCore, ...siblingMatches.filter(s => s.matchId !== matchCore.matchId)];
  const newEntries: Record<string, string> = {};

  for (const ourMatch of allMatches) {
    for (const fsMatch of fsMatches) {
      if (
        namesMatch(ourMatch.homeTeamName, fsMatch.homeTeam) &&
        namesMatch(ourMatch.awayTeamName, fsMatch.awayTeam)
      ) {
        newEntries[ourMatch.matchId] = fsMatch.fsId;
        console.log(
          `[FlashscoreResolver] Resolved ${ourMatch.homeTeamName} vs ${ourMatch.awayTeamName} → ${fsMatch.fsId}`,
        );
        break;
      }
    }
  }

  if (Object.keys(newEntries).length > 0) {
    await setFlashscoreIds(newEntries);
  }

  return newEntries[matchCore.matchId] ?? null;
}
