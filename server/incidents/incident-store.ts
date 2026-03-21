/**
 * IncidentStore — persistencia jerárquica de snapshots de incidentes.
 *
 * Estructura en disco:
 *   ./data/matches/{season}/{leagueSlug}/{safeMatchId}.json
 *
 * Niveles de almacenamiento (en orden de consulta):
 *   1. RAM hot cache  — solo partidos LIVE/HT (acceso O(1))
 *   2. Disco histórico — jerarquía season/league (inmutable para FINISHED)
 *   3. Legacy path     — /cache/incidents/{matchId}.json (backward compat + migración)
 *
 * Reglas de inmutabilidad:
 *   - isFinal=true  → archivo sellado. loadIncidentSnapshot nunca retorna null para él.
 *   - isFinal=false → puede actualizarse (LIVE/HT).
 *   - Nunca se borran archivos FINISHED del disco.
 *
 * Escritura atómica: .tmp → rename (evita archivos parciales en crash).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { IncidentSnapshot } from './types.js';
import { CACHE_BASE } from '../cache-dir.js';

// ── Directorios ───────────────────────────────────────────────────────────────

const DATA_DIR   = path.join(process.cwd(), 'data', 'matches');
const LEGACY_DIR = path.join(CACHE_BASE, 'incidents');

// ── League slug mapping ───────────────────────────────────────────────────────

const COMP_SLUG: Record<string, string> = {
  // Legacy IDs — kept for backward compatibility (AF_CANONICAL_ENABLED=false)
  'comp:football-data:PD':    'laliga',
  'comp:football-data:PL':    'premier',
  'comp:openligadb:bl1':      'bundesliga',
  'comp:thesportsdb:4432':    'uruguay',
  'comp:football-data-wc:WC': 'worldcup',
  // AF canonical IDs (AF_CANONICAL_ENABLED=true)
  'comp:apifootball:140':     'laliga',
  'comp:apifootball:39':      'premier',
  'comp:apifootball:78':      'bundesliga',
  'comp:apifootball:268':     'uruguay',
  'comp:apifootball:128':     'argentina',
};

function deriveLeagueSlug(competitionId: string): string {
  return COMP_SLUG[competitionId]
    ?? competitionId.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

/**
 * Deriva la temporada a partir de kickoffUtc.
 * - Ligas europeas: si mes < julio → "2024-25"; si mes ≥ julio → "2025-26"
 * - Liga Uruguaya (y WC): año calendario → "2025"
 */
function deriveSeason(kickoffUtc: string, competitionId: string): string {
  const d     = new Date(kickoffUtc);
  const year  = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1; // 1-based

  const calendarYear = competitionId === 'comp:thesportsdb:4432'
    || competitionId === 'comp:apifootball:268'  // Uruguay (AF canonical)
    || competitionId === 'comp:apifootball:128'  // Argentina (AF canonical)
    || competitionId.includes('wc');

  if (calendarYear) return String(year);

  // Liga europea: temporada que cruza dos años
  const startYear = month < 7 ? year - 1 : year;
  const endYear   = startYear + 1;
  return `${startYear}-${String(endYear).slice(2)}`;
}

// ── Paths ─────────────────────────────────────────────────────────────────────

function safeFilename(matchId: string): string {
  return matchId.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
}

export function resolveHistoricalPath(
  matchId: string,
  competitionId: string,
  kickoffUtc: string,
): string {
  const season = deriveSeason(kickoffUtc, competitionId);
  const league = deriveLeagueSlug(competitionId);
  return path.join(DATA_DIR, season, league, safeFilename(matchId));
}

function resolveLegacyPath(matchId: string): string {
  return path.join(LEGACY_DIR, safeFilename(matchId));
}

// ── Snapshot I/O ──────────────────────────────────────────────────────────────

function isValid(doc: unknown): doc is IncidentSnapshot {
  const d = doc as IncidentSnapshot;
  return (
    !!d &&
    typeof d.matchId === 'string' &&
    typeof d.matchStatusAtScrape === 'string' &&
    d.homeScoreAtScrape != null &&
    d.awayScoreAtScrape != null &&
    typeof d.scrapedAtUtc === 'string' &&
    d.isFinal != null &&
    Array.isArray(d.events)
  );
}

async function readSnapshot(filePath: string): Promise<IncidentSnapshot | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const doc = JSON.parse(raw);
    return isValid(doc) ? doc : null;
  } catch {
    return null;
  }
}

async function atomicWrite(filePath: string, snapshot: IncidentSnapshot): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const content = JSON.stringify(snapshot, null, 2);
  try {
    await fs.writeFile(tmpPath, content, 'utf-8');
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    try { await fs.unlink(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

// ── IncidentStore ─────────────────────────────────────────────────────────────

export class IncidentStore {
  /**
   * Hot cache en RAM: solo snapshots LIVE/HT.
   * Los FINISHED no se cachean en RAM — viven en disco (inmutables).
   */
  private hot = new Map<string, IncidentSnapshot>();

  /**
   * Carga un snapshot siguiendo la cadena: RAM → disco histórico → legacy.
   *
   * @param matchId        canonical match id
   * @param competitionId  para calcular la ruta jerárquica
   * @param kickoffUtc     para calcular la temporada
   */
  async load(
    matchId: string,
    competitionId?: string,
    kickoffUtc?: string,
  ): Promise<IncidentSnapshot | null> {
    // 1. RAM hot cache
    const hot = this.hot.get(matchId);
    if (hot) {
      return hot;
    }

    // 2. Disco histórico (jerarquía season/league)
    if (competitionId && kickoffUtc) {
      const hPath = resolveHistoricalPath(matchId, competitionId, kickoffUtc);
      const snap  = await readSnapshot(hPath);
      if (snap) {
        // Partidos LIVE/HT recién cargados desde disco vuelven al hot cache
        if (!snap.isFinal) this.hot.set(matchId, snap);
        return snap;
      }
    }

    // 3. Legacy path (/cache/incidents/ flat)
    const legacy = await readSnapshot(resolveLegacyPath(matchId));
    if (legacy) {
      // Migrar silenciosamente al nuevo path si tenemos los datos necesarios
      if (competitionId && kickoffUtc && legacy.isFinal) {
        this._migrate(legacy, competitionId, kickoffUtc);
      } else if (legacy && !legacy.isFinal) {
        this.hot.set(matchId, legacy);
      }
      return legacy;
    }

    return null;
  }

  /**
   * Persiste un snapshot.
   *
   * - FINISHED (isFinal=true): escribe a disco histórico, elimina de RAM.
   *   Una vez sellado, el archivo nunca se sobreescribe con eventos vacíos.
   * - LIVE/HT: escribe a disco histórico + actualiza RAM hot cache.
   */
  async save(
    snapshot: IncidentSnapshot,
    competitionId: string,
    kickoffUtc: string,
  ): Promise<void> {
    const filePath = resolveHistoricalPath(snapshot.matchId, competitionId, kickoffUtc);

    // Protección: nunca sobreescribir un snapshot final sellado con datos vacíos
    if (snapshot.isFinal && snapshot.events.length === 0) {
      const existing = await readSnapshot(filePath);
      if (existing?.isFinal && existing.events.length > 0) {
        console.log(
          `[IncidentStore] Skipping overwrite of sealed snapshot with events for ${snapshot.matchId}`,
        );
        return;
      }
    }

    await atomicWrite(filePath, snapshot);

    if (snapshot.isFinal) {
      // Sellado: sale del hot cache para siempre
      this.hot.delete(snapshot.matchId);
      console.log(
        `[IncidentStore] SEALED ${snapshot.matchId} → ${path.relative(process.cwd(), filePath)} (${snapshot.events.length} events)`,
      );
    } else {
      // LIVE/HT: actualizar hot cache
      this.hot.set(snapshot.matchId, snapshot);
    }
  }

  /** Expulsa un partido del hot cache (ej: cuando la UI cierra el drawer). */
  evict(matchId: string): void {
    this.hot.delete(matchId);
  }

  /** Tamaño actual del hot cache (para métricas/debug). */
  get hotCacheSize(): number {
    return this.hot.size;
  }

  /** Migración silenciosa del legacy path al histórico. */
  private _migrate(
    snapshot: IncidentSnapshot,
    competitionId: string,
    kickoffUtc: string,
  ): void {
    const dest = resolveHistoricalPath(snapshot.matchId, competitionId, kickoffUtc);
    atomicWrite(dest, snapshot)
      .then(() =>
        console.log(`[IncidentStore] Migrated legacy → ${path.relative(process.cwd(), dest)}`),
      )
      .catch((err) =>
        console.warn(`[IncidentStore] Migration failed for ${snapshot.matchId}:`, err),
      );
  }
}

/** Instancia singleton compartida por todo el proceso. */
export const incidentStore = new IncidentStore();
