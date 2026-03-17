import Parser from 'rss-parser';
import { isBlockedByPolitics, isBlockedByNonFootball, isTodayInMontevideo } from './filter.js';
import type { NewsHeadline } from './types.js';

// Fuente: Tenfield.com — feed 100% fútbol uruguayo (El Observador no tiene RSS público)
const RSS_URL = 'https://www.tenfield.com.uy/feed/';

type RssItem = {
  title?: string;
  link?: string;
  isoDate?: string;
  pubDate?: string;
  contentSnippet?: string;
  content?: string;
  enclosure?: { url?: string; type?: string };
  'media:content'?: { $?: { url?: string } } | { url?: string };
  'media:thumbnail'?: { $?: { url?: string } } | { url?: string };
  [key: string]: unknown;
};

function extractImage(item: RssItem): string | null {
  // media:content
  const mc = item['media:content'] as Record<string, unknown> | undefined;
  if (mc) {
    const url = (mc['$'] as Record<string, string> | undefined)?.url ?? (mc['url'] as string | undefined);
    if (url) return url;
  }
  // media:thumbnail
  const mt = item['media:thumbnail'] as Record<string, unknown> | undefined;
  if (mt) {
    const url = (mt['$'] as Record<string, string> | undefined)?.url ?? (mt['url'] as string | undefined);
    if (url) return url;
  }
  // enclosure
  const enc = item.enclosure;
  if (enc?.url && /\.(jpg|jpeg|png|webp|gif)/i.test(enc.url)) return enc.url;
  // img tag in description HTML
  const desc = (item['content:encoded'] ?? item.content ?? '') as string;
  const match = desc.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match?.[1] ?? null;
}

function simpleHash(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) {
    h = (Math.imul(31, h) + url.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

export async function fetchObservadorNews(): Promise<NewsHeadline[]> {
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

  const feed = await parser.parseURL(RSS_URL);
  const results: NewsHeadline[] = [];

  for (const raw of feed.items) {
    const item = raw as unknown as RssItem;
    const title = item.title?.trim() ?? '';
    const url = item.link?.trim() ?? '';
    if (!title || !url) continue;

    const pubRaw = item.isoDate ?? item.pubDate ?? '';
    const publishedAtUtc = pubRaw ? new Date(pubRaw).toISOString() : '';
    if (!publishedAtUtc) continue;
    if (!isTodayInMontevideo(publishedAtUtc)) continue;

    const snippet = item.contentSnippet ?? '';
    if (isBlockedByPolitics(title, snippet)) continue;
    if (isBlockedByNonFootball(title, snippet)) continue;

    results.push({
      id: simpleHash(url),
      leagueKey: 'URU',
      title,
      url,
      imageUrl: extractImage(item),
      sourceName: 'Tenfield',
      publishedAtUtc,
      competitionLabel: 'Fútbol uruguayo',
    });
  }

  console.log(`[NewsService] Tenfield RSS: ${results.length} noticias válidas hoy`);
  return results;
}
