/**
 * raw-response-cache — caché genérico de respuestas API en disco.
 *
 * Almacena respuestas raw (JSON) en `cache/raw/{key}.json` con TTL configurable.
 * Escritura atómica (.tmp → rename) para evitar archivos corruptos.
 * Aplica a TODOS los data sources: torneos (football-data), ligas (TheSportsDB, OpenLigaDB).
 *
 * Beneficio principal: sobrevivir reinicios del servidor sin hacer nuevas llamadas API.
 * Para torneos previene el error 429 (rate limit) en el ciclo de refresh.
 */
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CACHE_DIR = join(__dirname, '../cache/raw');

interface RawCacheEntry<T> {
  fetchedAt: string;
  data: T;
}

/**
 * Lee la caché de disco para la clave dada.
 * @returns los datos cacheados si existen y están dentro del TTL, null si no.
 */
export async function readRawCache<T>(key: string, ttlMs: number): Promise<T | null> {
  const filePath = join(CACHE_DIR, `${key}.json`);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const entry = JSON.parse(raw) as RawCacheEntry<T>;
    const age = Date.now() - new Date(entry.fetchedAt).getTime();
    if (age > ttlMs) return null; // expirado
    return entry.data;
  } catch {
    return null; // archivo no encontrado o JSON inválido
  }
}

/**
 * Escribe datos en la caché de disco de forma atómica (.tmp → rename).
 */
export async function writeRawCache<T>(key: string, data: T): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const filePath = join(CACHE_DIR, `${key}.json`);
  const tmp = `${filePath}.tmp`;
  const entry: RawCacheEntry<T> = {
    fetchedAt: new Date().toISOString(),
    data,
  };
  try {
    await fs.writeFile(tmp, JSON.stringify(entry), 'utf-8');
    await fs.rename(tmp, filePath);
  } catch (err) {
    console.error(`[rawResponseCache] Write error for key=${key}:`, err);
    // No relanzar — fallo de caché no es fatal
    try { await fs.unlink(tmp); } catch { /* ignore */ }
  }
}
