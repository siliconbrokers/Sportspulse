/**
 * incident-cache — persistencia de snapshots de incidentes.
 * Un archivo JSON por partido en /cache/incidents/{safeMatchId}.json
 * Atomic write: .tmp → rename (igual que matchday-cache).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { IncidentSnapshot } from './types.js';

const CACHE_DIR = path.join(process.cwd(), 'cache', 'incidents');

/** Convierte un matchId con caracteres especiales en nombre de archivo seguro. */
function safeFilename(matchId: string): string {
  return matchId.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
}

function cachePath(matchId: string): string {
  return path.join(CACHE_DIR, safeFilename(matchId));
}

export async function loadIncidentSnapshot(matchId: string): Promise<IncidentSnapshot | null> {
  try {
    const raw = await fs.readFile(cachePath(matchId), 'utf-8');
    const doc = JSON.parse(raw) as IncidentSnapshot;
    // Validación mínima de campos críticos (spec §7.4)
    if (
      !doc.matchId ||
      !doc.matchStatusAtScrape ||
      doc.homeScoreAtScrape == null ||
      doc.awayScoreAtScrape == null ||
      !doc.scrapedAtUtc ||
      doc.isFinal == null
    ) {
      return null;
    }
    return doc;
  } catch {
    return null;
  }
}

export async function saveIncidentSnapshot(snapshot: IncidentSnapshot): Promise<void> {
  const filePath = cachePath(snapshot.matchId);
  const tmpPath  = filePath + '.tmp';
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const content = JSON.stringify(snapshot, null, 2);
  try {
    await fs.writeFile(tmpPath, content, 'utf-8');
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    try { await fs.unlink(tmpPath); } catch {}
    throw err;
  }
}
