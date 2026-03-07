import { isBlockedByPolitics } from './filter.js';
import type { LeagueKey, NewsHeadline } from './types.js';

// SerpAPI Google News — para LaLiga, Premier League, Bundesliga

interface SerpNewsResult {
  title: string;
  link: string;
  snippet?: string;
  date?: string;
  source?: { name?: string; icon?: string };
  thumbnail?: string;
}

interface SerpResponse {
  news_results?: SerpNewsResult[];
  error?: string;
}

export const LEAGUE_CONFIG: Record<
  Exclude<LeagueKey, 'URU'>,
  { competitionLabel: string; competitionId: string; query: string }
> = {
  LL: {
    competitionLabel: 'LaLiga',
    competitionId: 'comp:football-data:PD',
    query: 'LaLiga fútbol',
  },
  EPL: {
    competitionLabel: 'Premier League',
    competitionId: 'comp:football-data:PL',
    query: 'Premier League fútbol',
  },
  BUN: {
    competitionLabel: 'Bundesliga',
    competitionId: 'comp:football-data:BL1',
    query: 'Bundesliga fútbol',
  },
};

function simpleHash(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) {
    h = (Math.imul(31, h) + url.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function parseRelativeDate(dateStr: string | undefined): string {
  if (!dateStr) return new Date().toISOString();
  // SerpAPI returns relative dates like "2 hours ago", "1 day ago"
  const now = Date.now();
  const m = dateStr.match(/(\d+)\s+(minute|hour|day|week)/i);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    const ms =
      unit.startsWith('minute') ? n * 60_000 :
      unit.startsWith('hour')   ? n * 3_600_000 :
      unit.startsWith('day')    ? n * 86_400_000 :
      unit.startsWith('week')   ? n * 604_800_000 : 0;
    return new Date(now - ms).toISOString();
  }
  // Try direct parse
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export async function fetchGNewsLeague(
  leagueKey: Exclude<LeagueKey, 'URU'>,
  teamNames: string[],
  apiKey: string,
): Promise<NewsHeadline[]> {
  if (!apiKey) {
    console.warn(`[NewsService] SERPAPI_KEY not set — skipping ${leagueKey}`);
    return [];
  }

  const config = LEAGUE_CONFIG[leagueKey];
  const teamsPart = teamNames.slice(0, 3).join(' OR ');
  const q = teamsPart ? `${config.query} (${teamsPart})` : config.query;

  const params = new URLSearchParams({
    engine: 'google_news',
    q,
    hl: 'es',
    gl: 'us',
    num: '10',
    tbs: 'qdr:d', // past 24 hours
    api_key: apiKey,
  });

  const url = `https://serpapi.com/search.json?${params.toString()}`;
  const t0 = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  const elapsed = Date.now() - t0;

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[NewsService] SerpAPI HTTP ${res.status} for ${leagueKey} (${elapsed}ms): ${body}`);
    throw new Error(`SerpAPI HTTP ${res.status} for ${leagueKey}`);
  }

  console.log(`[NewsService] SerpAPI ${leagueKey} → ${res.status} (${elapsed}ms)`);
  const data = (await res.json()) as SerpResponse;

  if (data.error) {
    throw new Error(`SerpAPI error: ${data.error}`);
  }

  const results: NewsHeadline[] = [];
  for (const item of data.news_results ?? []) {
    const title = item.title?.trim() ?? '';
    const articleUrl = item.link?.trim() ?? '';
    if (!title || !articleUrl) continue;
    if (isBlockedByPolitics(title, item.snippet ?? '')) continue;

    results.push({
      id: simpleHash(articleUrl),
      leagueKey,
      title,
      url: articleUrl,
      imageUrl: item.thumbnail || null,
      sourceName: item.source?.name ?? 'Desconocido',
      publishedAtUtc: parseRelativeDate(item.date),
      competitionLabel: config.competitionLabel,
    });
  }

  console.log(`[NewsService] SerpAPI ${leagueKey}: ${results.length} noticias`);
  return results;
}
