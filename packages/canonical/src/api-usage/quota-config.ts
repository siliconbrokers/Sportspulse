/**
 * quota-config.ts — Provider quota definitions stored in SQLite.
 * Spec: SPEC-SPORTPULSE-OPS-API-USAGE-GOVERNANCE §11.1
 */

import type Database from 'better-sqlite3';
import type { ProviderKey, ProviderQuotaDefinition } from '@sportpulse/shared';

// Default quota configs seeded on first startup
const DEFAULTS: ProviderQuotaDefinition[] = [
  {
    providerKey: 'api-football',
    displayName: 'API-Football v3',
    unitType: 'REQUEST',
    dailyLimit: 7500,
    timezone: 'UTC',
    warningThresholdPct: 75,
    criticalThresholdPct: 90,
    hardStopThresholdPct: 95,
    allowNoncriticalWhenLowQuota: true,
    brakeLiveThreshold: 6500,
    isActive: true,
    notes: 'Plan Pro: 7500 req/day. Brake at 6500 for LiveOverlay throttle.',
  },
  {
    providerKey: 'football-data',
    displayName: 'football-data.org',
    unitType: 'REQUEST',
    dailyLimit: 250,
    timezone: 'UTC',
    warningThresholdPct: 75,
    criticalThresholdPct: 90,
    hardStopThresholdPct: 95,
    allowNoncriticalWhenLowQuota: true,
    brakeLiveThreshold: 0,
    isActive: true,
    notes: 'Free tier: 250 req/day.',
  },
  {
    providerKey: 'youtube',
    displayName: 'YouTube Data API v3',
    unitType: 'CREDIT',
    dailyLimit: 10000,
    timezone: 'UTC',
    warningThresholdPct: 75,
    criticalThresholdPct: 90,
    hardStopThresholdPct: 95,
    allowNoncriticalWhenLowQuota: true,
    brakeLiveThreshold: 0,
    isActive: true,
    notes: 'Default quota: 10000 units/day. Search=100 units, list=1 unit.',
  },
  {
    providerKey: 'the-odds-api',
    displayName: 'The Odds API',
    unitType: 'REQUEST',
    dailyLimit: 0,
    timezone: 'UTC',
    warningThresholdPct: 75,
    criticalThresholdPct: 90,
    hardStopThresholdPct: 95,
    allowNoncriticalWhenLowQuota: true,
    brakeLiveThreshold: 0,
    isActive: true,
    notes: 'Free tier: 500 req/month. Daily limit not enforced (monthly).',
  },
  {
    providerKey: 'thesportsdb',
    displayName: 'TheSportsDB',
    unitType: 'REQUEST',
    dailyLimit: 0,
    timezone: 'UTC',
    warningThresholdPct: 75,
    criticalThresholdPct: 90,
    hardStopThresholdPct: 95,
    allowNoncriticalWhenLowQuota: true,
    brakeLiveThreshold: 0,
    isActive: true,
    notes: 'Free tier. No enforced daily limit.',
  },
  {
    providerKey: 'eventos',
    displayName: 'Eventos Source',
    unitType: 'REQUEST',
    dailyLimit: 0,
    timezone: 'UTC',
    warningThresholdPct: 75,
    criticalThresholdPct: 90,
    hardStopThresholdPct: 95,
    allowNoncriticalWhenLowQuota: true,
    brakeLiveThreshold: 0,
    isActive: true,
    notes: 'No quota. Tracked for visibility only.',
  },
];

interface QuotaRow {
  provider_key: string;
  display_name: string;
  unit_type: string;
  daily_limit: number;
  timezone: string;
  warning_threshold_pct: number;
  critical_threshold_pct: number;
  hard_stop_threshold_pct: number;
  allow_noncritical_when_low: number;
  brake_live_threshold: number;
  is_active: number;
  notes: string | null;
  created_at_utc: string;
  updated_at_utc: string;
}

function rowToDefinition(row: QuotaRow): ProviderQuotaDefinition {
  return {
    providerKey: row.provider_key as ProviderKey,
    displayName: row.display_name,
    unitType: row.unit_type as ProviderQuotaDefinition['unitType'],
    dailyLimit: row.daily_limit,
    timezone: row.timezone,
    warningThresholdPct: row.warning_threshold_pct,
    criticalThresholdPct: row.critical_threshold_pct,
    hardStopThresholdPct: row.hard_stop_threshold_pct,
    allowNoncriticalWhenLowQuota: row.allow_noncritical_when_low === 1,
    brakeLiveThreshold: row.brake_live_threshold,
    isActive: row.is_active === 1,
    notes: row.notes,
  };
}

export class QuotaConfigStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.seedDefaults();
  }

  private seedDefaults(): void {
    const exists = this.db
      .prepare('SELECT COUNT(*) as cnt FROM provider_quota_config')
      .get() as { cnt: number };

    if (exists.cnt > 0) return;

    const now = new Date().toISOString();
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO provider_quota_config (
        provider_key, display_name, unit_type, daily_limit, timezone,
        warning_threshold_pct, critical_threshold_pct, hard_stop_threshold_pct,
        allow_noncritical_when_low, brake_live_threshold, is_active, notes,
        created_at_utc, updated_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const seedAll = this.db.transaction(() => {
      for (const d of DEFAULTS) {
        insert.run(
          d.providerKey, d.displayName, d.unitType, d.dailyLimit, d.timezone,
          d.warningThresholdPct, d.criticalThresholdPct, d.hardStopThresholdPct,
          d.allowNoncriticalWhenLowQuota ? 1 : 0, d.brakeLiveThreshold,
          d.isActive ? 1 : 0, d.notes, now, now,
        );
      }
    });

    seedAll();
    console.log('[ApiUsageLedger] Quota config seeded with defaults');
  }

  get(providerKey: ProviderKey): ProviderQuotaDefinition | null {
    const row = this.db
      .prepare('SELECT * FROM provider_quota_config WHERE provider_key = ?')
      .get(providerKey) as QuotaRow | undefined;
    return row ? rowToDefinition(row) : null;
  }

  getAll(): ProviderQuotaDefinition[] {
    const rows = this.db
      .prepare('SELECT * FROM provider_quota_config WHERE is_active = 1')
      .all() as QuotaRow[];
    return rows.map(rowToDefinition);
  }
}
