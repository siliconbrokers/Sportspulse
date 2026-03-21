/**
 * flashscore-id-map — mapeo persistente de nuestro matchId → Flashscore match ID.
 * Una vez resuelto un ID, se guarda para siempre en /cache/flashscore/id-map.json.
 *
 * El archivo se carga en memoria al iniciar y se escribe de forma atómica en cada actualización.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CACHE_BASE } from '../cache-dir.js';

const MAP_PATH = path.join(CACHE_BASE, 'flashscore', 'id-map.json');

type IdMap = Record<string, string>; // ourMatchId → flashscoreId

// Cache in-memory de la sesión
let memMap: IdMap | null = null;

async function load(): Promise<IdMap> {
  if (memMap) return memMap;
  try {
    const raw = await fs.readFile(MAP_PATH, 'utf-8');
    memMap = JSON.parse(raw) as IdMap;
    return memMap;
  } catch {
    memMap = {};
    return memMap;
  }
}

async function persist(map: IdMap): Promise<void> {
  const dir = path.dirname(MAP_PATH);
  const tmp = MAP_PATH + '.tmp';
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(map, null, 2), 'utf-8');
  await fs.rename(tmp, MAP_PATH);
}

export async function getFlashscoreId(matchId: string): Promise<string | null> {
  const map = await load();
  return map[matchId] ?? null;
}

export async function setFlashscoreIds(entries: Record<string, string>): Promise<void> {
  const map = await load();
  Object.assign(map, entries);
  await persist(map);
}
