/**
 * RSS-based news source — reemplazo de SerpAPI para todas las ligas.
 * Sin API key, sin límite de uso.
 */
import Parser from 'rss-parser';
import { isBlockedByPolitics, isBlockedByNonFootball } from './filter.js';
import type { LeagueKey, NewsHeadline } from './types.js';

// ── Config ────────────────────────────────────────────────────────────────────

interface FeedConfig {
  url: string;
  sourceName: string;
  /**
   * Si está definido, el título debe contener al menos una de estas palabras
   * (normalizado). Usado para feeds genéricos de fútbol.
   */
  keywords?: string[];
}

export const RSS_CONFIG: Record<
  Exclude<LeagueKey, 'URU'>,
  { competitionLabel: string; competitionId: string; afCompetitionId?: string; feeds: FeedConfig[] }
> = {
  AR: {
    competitionLabel: 'Liga Profesional Argentina',
    competitionId: 'comp:sportsdb-ar:4406',
    afCompetitionId: 'comp:apifootball:128',
    feeds: [
      {
        url: 'https://www.infobae.com/arc/outboundfeeds/rss/category/deportes/',
        sourceName: 'Infobae',
        keywords: [
          'liga profesional', 'primera division', 'superliga', 'afa',
          'boca', 'river', 'racing', 'independiente', 'san lorenzo',
          'huracan', 'estudiantes', 'lanus', 'talleres', 'belgrano',
          'velez', 'atletico tucuman', 'rosario central', 'newells',
          'argentinos', 'tigre', 'godoy cruz', 'banfield',
        ],
      },
      {
        url: 'https://www.ambito.com/rss/deportes.xml',
        sourceName: 'Ámbito',
        keywords: [
          'liga profesional', 'primera division', 'afa',
          'boca', 'river', 'racing', 'independiente', 'san lorenzo',
          'huracan', 'estudiantes', 'lanus', 'talleres', 'belgrano',
          'velez', 'atletico tucuman', 'rosario central', 'newells',
          'argentinos', 'tigre', 'godoy cruz', 'banfield',
        ],
      },
    ],
  },
  LL: {
    competitionLabel: 'LaLiga',
    competitionId: 'comp:football-data:PD',
    afCompetitionId: 'comp:apifootball:140',
    feeds: [
      { url: 'https://www.marca.com/rss/futbol/primera-division.xml', sourceName: 'Marca' },
      { url: 'https://www.mundodeportivo.com/rss/futbol.xml', sourceName: 'Mundo Deportivo' },
    ],
  },
  EPL: {
    competitionLabel: 'Premier League',
    competitionId: 'comp:football-data:PL',
    afCompetitionId: 'comp:apifootball:39',
    feeds: [
      { url: 'https://www.skysports.com/rss/12040', sourceName: 'Sky Sports' },
      {
        url: 'https://feeds.bbci.co.uk/sport/football/rss.xml',
        sourceName: 'BBC Sport',
        keywords: ['premier league', 'premier'],
      },
    ],
  },
  BUN: {
    competitionLabel: 'Bundesliga',
    competitionId: 'comp:football-data:BL1',
    afCompetitionId: 'comp:apifootball:78',
    feeds: [
      { url: 'https://newsfeed.kicker.de/news/bundesliga', sourceName: 'Kicker' },
    ],
  },
  WC: {
    competitionLabel: 'Mundial 2026',
    competitionId: 'comp:football-data-wc:WC',
    feeds: [
      {
        url: 'https://www.espn.com/espn/rss/soccer/news',
        sourceName: 'ESPN',
        keywords: ['world cup', 'mundial', 'fifa 2026', 'copa del mundo'],
      },
      {
        url: 'https://feeds.bbci.co.uk/sport/football/rss.xml',
        sourceName: 'BBC Sport',
        keywords: ['world cup', 'mundial', 'fifa'],
      },
    ],
  },
  CA: {
    competitionLabel: 'Copa América 2027',
    competitionId: 'comp:football-data-ca:CA',
    feeds: [
      {
        url: 'https://www.espn.com/espn/rss/soccer/news',
        sourceName: 'ESPN',
        keywords: ['copa america', 'copa america', 'conmebol'],
      },
      {
        url: 'https://www.infobae.com/arc/outboundfeeds/rss/category/america/deportes/',
        sourceName: 'Infobae',
        keywords: ['copa america', 'copa america', 'conmebol', 'seleccion'],
      },
    ],
  },
  CLI: {
    competitionLabel: 'Copa Libertadores',
    competitionId: 'comp:football-data-cli:CLI',
    feeds: [
      {
        url: 'https://www.espn.com/espn/rss/soccer/news',
        sourceName: 'ESPN',
        keywords: ['libertadores', 'copa libertadores'],
      },
      {
        url: 'https://www.infobae.com/arc/outboundfeeds/rss/category/america/deportes/',
        sourceName: 'Infobae',
        keywords: ['libertadores', 'copa libertadores'],
      },
    ],
  },
};

// Ventana máxima de antigüedad de noticias (horas)
const MAX_AGE_HOURS = 48;

// ── Helpers ───────────────────────────────────────────────────────────────────

type RssItem = {
  title?: string;
  link?: string;
  isoDate?: string;
  pubDate?: string;
  contentSnippet?: string;
  content?: string;
  enclosure?: { url?: string; type?: string };
  'media:content'?: Record<string, unknown>;
  'media:thumbnail'?: Record<string, unknown>;
  [key: string]: unknown;
};

function simpleHash(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) {
    h = (Math.imul(31, h) + url.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function extractImage(item: RssItem): string | null {
  const mc = item['media:content'] as Record<string, unknown> | undefined;
  if (mc) {
    const url = (mc['$'] as Record<string, string> | undefined)?.url ?? (mc['url'] as string | undefined);
    if (url) return url;
  }
  const mt = item['media:thumbnail'] as Record<string, unknown> | undefined;
  if (mt) {
    const url = (mt['$'] as Record<string, string> | undefined)?.url ?? (mt['url'] as string | undefined);
    if (url) return url;
  }
  const enc = item.enclosure;
  if (enc?.url && /\.(jpg|jpeg|png|webp|gif)/i.test(enc.url)) return enc.url;
  const desc = (item['content:encoded'] ?? item.content ?? '') as string;
  const match = desc.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match?.[1] ?? null;
}

function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesKeywords(title: string, snippet: string, keywords: string[]): boolean {
  const text = norm(title + ' ' + snippet);
  return keywords.some((k) => text.includes(norm(k)));
}

function isRecent(publishedAtUtc: string): boolean {
  const pub = new Date(publishedAtUtc);
  if (isNaN(pub.getTime())) return false;
  const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000);
  return pub >= cutoff && pub <= new Date();
}

// ── Per-feed fetcher ──────────────────────────────────────────────────────────

async function fetchOneFeed(
  feed: FeedConfig,
  leagueKey: Exclude<LeagueKey, 'URU'>,
): Promise<NewsHeadline[]> {
  const config = RSS_CONFIG[leagueKey];
  const parser = new Parser({
    customFields: {
      item: [
        ['media:content', 'media:content', { keepArray: false }],
        ['media:thumbnail', 'media:thumbnail', { keepArray: false }],
        ['content:encoded', 'content:encoded'],
      ],
    },
    timeout: 8000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; SportsPulse/1.0; +https://sportspulse.app)',
    },
  });

  const parsed = await parser.parseURL(feed.url);
  const results: NewsHeadline[] = [];

  for (const raw of parsed.items) {
    const item = raw as RssItem;
    const title = item.title?.trim() ?? '';
    const url = item.link?.trim() ?? '';
    if (!title || !url) continue;

    const pubRaw = item.isoDate ?? item.pubDate ?? '';
    const publishedAtUtc = pubRaw ? new Date(pubRaw).toISOString() : '';
    if (!publishedAtUtc || !isRecent(publishedAtUtc)) continue;

    const snippet = item.contentSnippet ?? '';

    // Keyword filter (solo para feeds generales)
    if (feed.keywords && !matchesKeywords(title, snippet, feed.keywords)) continue;

    if (isBlockedByPolitics(title, snippet)) continue;
    if (isBlockedByNonFootball(title, snippet)) continue;

    results.push({
      id: simpleHash(url),
      leagueKey,
      title,
      url,
      imageUrl: extractImage(item),
      sourceName: feed.sourceName,
      publishedAtUtc,
      competitionLabel: config.competitionLabel,
    });
  }

  return results;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function fetchRssLeague(
  leagueKey: Exclude<LeagueKey, 'URU'>,
): Promise<NewsHeadline[]> {
  const config = RSS_CONFIG[leagueKey];
  const results = await Promise.allSettled(
    config.feeds.map((f) => fetchOneFeed(f, leagueKey)),
  );

  const all: NewsHeadline[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      all.push(...r.value);
    } else {
      console.warn(`[NewsService] RSS feed error for ${leagueKey}:`, r.reason?.message ?? r.reason);
    }
  }

  console.log(`[NewsService] RSS ${leagueKey}: ${all.length} noticias`);
  return all;
}
