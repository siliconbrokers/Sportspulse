/**
 * StreamEmbedService — fetcha la página fuente de un canal en futbollibretv.su,
 * extrae las URLs de embed del player, y las valida server-side antes de devolverlas.
 *
 * El probing es server-side para evitar que el browser loguee ERR_SSL / ERR_NAME_NOT_RESOLVED
 * en la consola del cliente (el browser siempre los muestra aunque el código los catchee).
 *
 * Cache: solo almacena resultados con al menos 1 URL viva. URLs muertas → no se cachean.
 */

const BLOCKED_DOMAIN_FRAGMENTS = [
  'futbollibretv.su',
  'google', 'facebook', 'instagram', 'twitter', 'tiktok',
  'gstatic', 'googleapis', 'fonts.',
  'wp-content', 'wp-includes', 'wp-json', 'wp-admin',
  'gravatar', 'youtube', 'youtu.be',
  'analytics', 'jquery', 'cloudflare', 'jsdelivr',
  'dmca', 'amazon', 'whatsapp', 'telegram',
  // SSL cert roto — ERR_SSL_UNRECOGNIZED_NAME_ALERT siempre
  'moupa.goluh.credit',
];

const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutos (solo para URLs vivas)

interface CacheEntry {
  urls: string[];
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Extrae URLs https:// del HTML que parezcan embeds de player */
function extractEmbedUrls(html: string): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  const pattern = /https?:\/\/[^\s"'<>\\]+/g;
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(html)) !== null) {
    let url = m[0].replace(/[),;'"]+$/, '');
    if (seen.has(url)) continue;
    seen.add(url);

    if (BLOCKED_DOMAIN_FRAGMENTS.some((f) => url.toLowerCase().includes(f))) continue;

    const isLikelyEmbed =
      url.includes('.php') ||
      (url.includes('.html') && url.includes('?')) ||
      /\/(?:embed|player|live|stream|watch|canal)\b/i.test(url);

    if (isLikelyEmbed) results.push(url);
  }

  return results;
}

/** Prueba server-side si una URL está viva (responde a HEAD en < 4s) */
async function probeUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(4000),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

export interface StreamSourceResult {
  embedUrls: string[];   // solo URLs validadas (vivas)
  cachedAt: number;
  fromCache: boolean;
}

export async function fetchStreamEmbedUrls(sourcePageUrl: string): Promise<StreamSourceResult> {
  const now = Date.now();
  const cached = cache.get(sourcePageUrl);

  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return { embedUrls: cached.urls, cachedAt: cached.fetchedAt, fromCache: true };
  }

  // 1. Fetch de la página fuente
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

  // 2. Extraer candidatos
  const candidates = extractEmbedUrls(html);
  console.log(`[StreamEmbed] ${sourcePageUrl} → ${candidates.length} candidate(s) extracted`);

  // 3. Probar cada URL server-side — solo devolver las que responden
  const alive: string[] = [];
  for (const url of candidates) {
    const ok = await probeUrl(url);
    console.log(`[StreamEmbed] probe ${ok ? '✓' : '✗'} ${url}`);
    if (ok) alive.push(url);
  }

  console.log(`[StreamEmbed] ${alive.length}/${candidates.length} URL(s) alive`);

  // 4. Solo cachear si hay resultados vivos (URLs muertas no se cachean)
  if (alive.length > 0) {
    cache.set(sourcePageUrl, { urls: alive, fetchedAt: now });
  }

  return { embedUrls: alive, cachedAt: now, fromCache: false };
}
