/**
 * Portal Config Store
 * Persists competition enable/disable state and menu feature toggles.
 * File: cache/portal-config.json (atomic write, same pattern as matchday-cache)
 * Audit log: cache/portal-config-audit.jsonl (append-only)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CompetitionConfig {
  id: string;
  slug: string;
  displayName: string;
  enabled: boolean;
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
}

interface AuditEntry {
  at: string;
  by: string;
  field: string;
  from: unknown;
  to: unknown;
}

// ── Catalog ───────────────────────────────────────────────────────────────────
// Fixed catalog of all known competitions. Adding new ones requires code change
// (by design — spec §15 defers dynamic catalog to future feature).

const CATALOG_DEFAULTS: Omit<CompetitionConfig, 'updatedAt' | 'updatedBy'>[] = [
  { id: 'comp:thesportsdb:4432',      slug: 'URU',  displayName: 'Fútbol Uruguayo',    enabled: true },
  { id: 'comp:sportsdb-ar:4406',      slug: 'AR',   displayName: 'Liga Argentina',      enabled: true },
  { id: 'comp:football-data:PD',      slug: 'PD',   displayName: 'La Liga',             enabled: true },
  { id: 'comp:football-data:PL',      slug: 'PL',   displayName: 'Premier League',      enabled: true },
  { id: 'comp:openligadb:bl1',        slug: 'BL1',  displayName: 'Bundesliga',          enabled: true },
  { id: 'comp:football-data-cli:CLI', slug: 'CLI',  displayName: 'Copa Libertadores',   enabled: true },
  { id: 'comp:football-data-wc:WC',   slug: 'WC',   displayName: 'Copa del Mundo 2026', enabled: true },
];

const FEATURE_DEFAULTS: Omit<PortalFeatureConfig, 'updatedAt' | 'updatedBy'> = {
  tv: true,
  predictions: true,
};

// ── Paths ─────────────────────────────────────────────────────────────────────

const CACHE_DIR  = path.join(process.cwd(), 'cache');
const CONFIG_FILE = path.join(CACHE_DIR, 'portal-config.json');
const AUDIT_FILE  = path.join(CACHE_DIR, 'portal-config-audit.jsonl');

// ── Default config (all enabled) ─────────────────────────────────────────────

function buildDefault(): PortalConfig {
  const now = new Date().toISOString();
  return {
    competitions: CATALOG_DEFAULTS.map((c) => ({ ...c, updatedAt: now, updatedBy: 'system' })),
    features: { ...FEATURE_DEFAULTS, updatedAt: now, updatedBy: 'system' },
  };
}

// ── Read / Write ──────────────────────────────────────────────────────────────

function readConfig(): PortalConfig {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return buildDefault();
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw) as PortalConfig;
    // Merge catalog: if a new competition was added to code, inject it as enabled
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
  const tmp = CONFIG_FILE + '.tmp';
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

export function getEnabledCompetitions(): CompetitionConfig[] {
  return getConfig().competitions.filter((c) => c.enabled);
}

export function isCompetitionEnabled(competitionId: string): boolean {
  const comp = getConfig().competitions.find((c) => c.id === competitionId);
  // Unknown competitions (not in catalog) are allowed by default
  return comp ? comp.enabled : true;
}

export function isFeatureEnabled(key: 'tv' | 'predictions'): boolean {
  return getConfig().features[key];
}

export interface PortalConfigPatch {
  competitions?: { id: string; enabled: boolean }[];
  features?: { tv?: boolean; predictions?: boolean };
}

export function updateConfig(patch: PortalConfigPatch, updatedBy: string): void {
  const config = getConfig();
  const now = new Date().toISOString();
  const audit: AuditEntry[] = [];

  if (patch.competitions) {
    for (const { id, enabled } of patch.competitions) {
      const comp = config.competitions.find((c) => c.id === id);
      if (comp && comp.enabled !== enabled) {
        audit.push({ at: now, by: updatedBy, field: `competition.${id}.enabled`, from: comp.enabled, to: enabled });
        comp.enabled = enabled;
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

  writeConfig(config);
  appendAudit(audit);
  invalidateCache();
}
