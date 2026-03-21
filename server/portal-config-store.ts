/**
 * Portal Config Store
 * Persists competition enable/disable state and menu feature toggles.
 * File: cache/portal-config.json (atomic write, same pattern as matchday-cache)
 * Audit log: cache/portal-config-audit.jsonl (append-only)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { COMPETITION_REGISTRY } from './competition-registry.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Three-state competition mode.
 *
 * portal   — visible in the portal, data fetched, predictions active
 * shadow   — NOT visible in portal, data fetched, predictions active (internal / NEXUS accumulation)
 * disabled — completely off: no portal display, no data fetching, no predictions
 */
export type CompetitionMode = 'portal' | 'shadow' | 'disabled';

export interface CompetitionConfig {
  id: string;
  slug: string;
  displayName: string;
  mode: CompetitionMode;
  /** @deprecated Transitional backward-compat field — do NOT rely on this in new code.
   *  Kept until AdminPage (Fase 3) is migrated to the 3-state selector. */
  enabled?: boolean;
  updatedAt: string;   // ISO UTC
  updatedBy: string;
}

export interface PortalFeatureConfig {
  tv: boolean;
  predictions: boolean;
  updatedAt: string;
  updatedBy: string;
}

export interface PortalConfig {
  competitions: CompetitionConfig[];
  features: PortalFeatureConfig;
  schedulerEnabled: boolean;  // default: true
}

interface AuditEntry {
  at: string;
  by: string;
  field: string;
  from: unknown;
  to: unknown;
}

// ── Catalog ───────────────────────────────────────────────────────────────────
// Derived from COMPETITION_REGISTRY — single source of truth.
// Adding a new competition only requires adding it to competition-registry.ts.

const CATALOG_DEFAULTS: Omit<CompetitionConfig, 'updatedAt' | 'updatedBy'>[] =
  COMPETITION_REGISTRY.map((e) => ({
    id:          e.id,
    slug:        e.slug,
    displayName: e.displayName,
    mode:        'portal' as CompetitionMode,
  }));

const FEATURE_DEFAULTS: Omit<PortalFeatureConfig, 'updatedAt' | 'updatedBy'> = {
  tv: true,
  predictions: true,
};

// ── Paths ─────────────────────────────────────────────────────────────────────

const CACHE_DIR  = (process.env.CACHE_DIR ?? (process.env.RENDER === 'true' ? '/opt/render/project/src/cache' : path.join(process.cwd(), 'cache')));
const CONFIG_FILE = path.join(CACHE_DIR, 'portal-config.json');
const AUDIT_FILE  = path.join(CACHE_DIR, 'portal-config-audit.jsonl');

// ── Default config (all portal) ───────────────────────────────────────────────

function buildDefault(): PortalConfig {
  const now = new Date().toISOString();
  return {
    competitions: CATALOG_DEFAULTS.map((c) => ({ ...c, updatedAt: now, updatedBy: 'system' })),
    features: { ...FEATURE_DEFAULTS, updatedAt: now, updatedBy: 'system' },
    schedulerEnabled: true,
  };
}

// ── Migration helpers ─────────────────────────────────────────────────────────

/**
 * Migration-on-read: convert old format { enabled: boolean } to { mode: CompetitionMode }.
 * First read converts; first write persists the new format.
 */
function migrateCompEntry(comp: Record<string, unknown>): void {
  if ('enabled' in comp && !('mode' in comp)) {
    comp['mode'] = comp['enabled'] ? 'portal' : 'disabled';
    delete comp['enabled'];
  }
}

// ── Read / Write ──────────────────────────────────────────────────────────────

function readConfig(): PortalConfig {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return buildDefault();
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw) as PortalConfig;

    // Migration-on-read: detect old boolean `enabled` format and convert to `mode`
    for (const comp of parsed.competitions as unknown as Record<string, unknown>[]) {
      migrateCompEntry(comp);
    }

    // Migration: schedulerEnabled introduced later — default true if absent
    if (parsed.schedulerEnabled === undefined) {
      parsed.schedulerEnabled = true;
    }

    // Merge catalog: if a new competition was added to code, inject it as portal
    const storedIds = new Set(parsed.competitions.map((c) => c.id));
    const now = new Date().toISOString();
    for (const def of CATALOG_DEFAULTS) {
      if (!storedIds.has(def.id)) {
        parsed.competitions.push({ ...def, updatedAt: now, updatedBy: 'system' });
      }
    }
    return parsed;
  } catch {
    return buildDefault();
  }
}

function writeConfig(config: PortalConfig): void {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  const tmp = `${CONFIG_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
  fs.renameSync(tmp, CONFIG_FILE);
}

function appendAudit(entries: AuditEntry[]): void {
  if (entries.length === 0) return;
  const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.appendFileSync(AUDIT_FILE, lines, 'utf8');
}

// ── In-memory cache (avoids re-reading file on every request) ─────────────────

let _cached: PortalConfig | null = null;

function getConfig(): PortalConfig {
  if (!_cached) _cached = readConfig();
  return _cached;
}

function invalidateCache(): void {
  _cached = null;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getFullConfig(): PortalConfig {
  return getConfig();
}

/**
 * Returns competitions with mode !== 'disabled' (portal + shadow).
 * Use this for data fetching, predictions, polling — anything that is not portal display.
 */
export function getActiveCompetitions(): CompetitionConfig[] {
  return getConfig().competitions.filter((c) => c.mode !== 'disabled');
}

/**
 * @deprecated Use getActiveCompetitions() instead.
 * Kept for backward compatibility during transition.
 */
export function getEnabledCompetitions(): CompetitionConfig[] {
  return getActiveCompetitions();
}

/**
 * Returns the mode for a given competition ID.
 * Unknown competitions (not in catalog) default to 'portal' for backward compat.
 */
export function getCompetitionMode(competitionId: string): CompetitionMode {
  const comp = getConfig().competitions.find((c) => c.id === competitionId);
  return comp ? comp.mode : 'portal';
}

/**
 * Returns true if the competition is active (portal or shadow).
 * Use for data fetching, predictions, and all non-display concerns.
 * Unknown competitions default to true for backward compat.
 */
export function isCompetitionActive(competitionId: string): boolean {
  return getCompetitionMode(competitionId) !== 'disabled';
}

/**
 * Returns true only if the competition is in portal mode (visible to users).
 * Use for portal display filtering.
 */
export function isCompetitionPortal(competitionId: string): boolean {
  return getCompetitionMode(competitionId) === 'portal';
}

/**
 * @deprecated Use isCompetitionActive() instead.
 * Kept for backward compatibility during transition (server/index.ts will migrate in Fase 1).
 */
export function isCompetitionEnabled(competitionId: string): boolean {
  return isCompetitionActive(competitionId);
}

export function isFeatureEnabled(key: 'tv' | 'predictions'): boolean {
  return getConfig().features[key];
}

export interface PortalConfigPatch {
  competitions?: { id: string; mode?: CompetitionMode; enabled?: boolean }[];
  features?: { tv?: boolean; predictions?: boolean };
  schedulerEnabled?: boolean;
}

export function updateConfig(patch: PortalConfigPatch, updatedBy: string): void {
  const config = getConfig();
  const now = new Date().toISOString();
  const audit: AuditEntry[] = [];

  if (patch.competitions) {
    for (const entry of patch.competitions) {
      const { id } = entry;

      // Backward compat: if patch arrives with { id, enabled } without mode, convert
      let newMode: CompetitionMode | undefined = entry.mode;
      if (newMode === undefined && entry.enabled !== undefined) {
        newMode = entry.enabled ? 'portal' : 'disabled';
      }

      if (newMode === undefined) continue;

      const comp = config.competitions.find((c) => c.id === id);
      if (comp && comp.mode !== newMode) {
        audit.push({ at: now, by: updatedBy, field: `competition.${id}.mode`, from: comp.mode, to: newMode });
        comp.mode = newMode;
        comp.updatedAt = now;
        comp.updatedBy = updatedBy;
      }
    }
  }

  if (patch.features) {
    for (const key of ['tv', 'predictions'] as const) {
      if (patch.features[key] !== undefined && config.features[key] !== patch.features[key]) {
        audit.push({ at: now, by: updatedBy, field: `feature.${key}`, from: config.features[key], to: patch.features[key] });
        config.features[key] = patch.features[key]!;
        config.features.updatedAt = now;
        config.features.updatedBy = updatedBy;
      }
    }
  }

  if (patch.schedulerEnabled !== undefined && config.schedulerEnabled !== patch.schedulerEnabled) {
    audit.push({ at: now, by: updatedBy, field: 'schedulerEnabled', from: config.schedulerEnabled, to: patch.schedulerEnabled });
    config.schedulerEnabled = patch.schedulerEnabled;
  }

  writeConfig(config);
  appendAudit(audit);
  invalidateCache();
}

export function isSchedulerEnabled(): boolean {
  return getConfig().schedulerEnabled !== false; // default true
}

/**
 * Returns an enriched config suitable for the client (portal-config-route).
 * Includes `mode` for new consumers and `enabled` as a derived field for backward compat.
 */
export function getEnrichedPortalConfig(): {
  competitions: (CompetitionConfig & { enabled: boolean })[];
  features: PortalFeatureConfig;
} {
  const config = getConfig();
  return {
    competitions: config.competitions.map((c) => ({
      ...c,
      enabled: c.mode === 'portal',  // derived backward-compat field
    })),
    features: config.features,
  };
}
