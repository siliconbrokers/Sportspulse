/**
 * StreamEmbedService — fetcha la página fuente de un canal en futbollibretv.su
 * y extrae las URLs de embed del player del partido en vivo.
 *
 * Las URLs de embed (moupa.goluh.credit, cdn30.youcando.rest, etc.) son efímeras:
 * solo existen durante partidos en vivo y el dominio rota por partido.
 * Por eso no se hardcodean — se extraen en caliente desde la página del canal.
 *
 * Cache: 3 min TTL (la URL de embed cambia por partido, no por minuto).
 */

const BLOCKED_DOMAIN_FRAGMENTS = [
  'futbollibretv.su',
  'google', 'facebook', 'instagram', 'twitter', 'tiktok',
  'gstatic', 'googleapis', 'fonts.',
  'wp-content', 'wp-includes', 'wp-json', 'wp-admin',
  'gravatar', 'youtube', 'youtu.be',
  'analytics', 'jquery', 'cloudflare', 'jsdelivr',
  'dmca', 'amazon', 'whatsapp', 'telegram',
];

const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutos

interface CacheEntry {
  urls: string[];
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Extrae todas las URLs https:// del HTML que parezcan embeds de player */
function extractEmbedUrls(html: string): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  // Busca todas las URLs https en el HTML (en atributos href, src, onclick, texto, etc.)
  const pattern = /https?:\/\/[^\s"'<>\\]+/g;
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(html)) !== null) {
    let url = m[0];
    // Limpiar trailing punctuation que no es parte de la URL
    url = url.replace(/[),;'"]+$/, '');

    if (seen.has(url)) continue;
    seen.add(url);

    // Excluir dominios conocidos que no son embeds de stream
    if (BLOCKED_DOMAIN_FRAGMENTS.some((frag) => url.toLowerCase().includes(frag))) continue;

    // Solo páginas que parecen embeds de player (.php, .html con parámetros, o rutas cortas de CDN)
    const isLikelyEmbed =
      url.includes('.php') ||
      (url.includes('.html') && url.includes('?')) ||
      /\/(?:embed|player|live|stream|watch|canal)\b/i.test(url);

    if (isLikelyEmbed) {
      results.push(url);
    }
  }

  return results;
}

export interface StreamSourceResult {
  embedUrls: string[];
  cachedAt: number;
  fromCache: boolean;
}

/**
 * Fetcha la página del canal en futbollibretv.su y devuelve las URLs del embed activo.
 * Si no hay partido en vivo, la página puede no tener embeds → devuelve lista vacía.
 */
export async function fetchStreamEmbedUrls(sourcePageUrl: string): Promise<StreamSourceResult> {
  const now = Date.now();
  const cached = cache.get(sourcePageUrl);

  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return { embedUrls: cached.urls, cachedAt: cached.fetchedAt, fromCache: true };
  }

  let html: string;
  try {
    const res = await fetch(sourcePageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-UY,es;q=0.9',
        'Referer': 'https://www.google.com/',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn(`[StreamEmbed] HTTP ${res.status} fetching ${sourcePageUrl}`);
      return { embedUrls: [], cachedAt: now, fromCache: false };
    }

    html = await res.text();
  } catch (err) {
    console.warn('[StreamEmbed] Fetch failed:', (err as Error).message);
    return { embedUrls: [], cachedAt: now, fromCache: false };
  }

  const urls = extractEmbedUrls(html);
  console.log(`[StreamEmbed] ${sourcePageUrl} → ${urls.length} embed URL(s) found`);

  cache.set(sourcePageUrl, { urls, fetchedAt: now });
  return { embedUrls: urls, cachedAt: now, fromCache: false };
}
