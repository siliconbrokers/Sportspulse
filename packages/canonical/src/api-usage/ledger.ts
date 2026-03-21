/**
 * ledger.ts — ApiUsageLedger: SQLite-backed quota accounting.
 * Spec: SPEC-SPORTPULSE-OPS-API-USAGE-GOVERNANCE §8, §11, §13
 *
 * - Append-only event log (api_usage_events)
 * - Incremental rollup upserts (api_usage_daily_rollups)
 * - af-budget.ts compatibility surface (same function signatures, providerKey='api-football')
 * - Startup migration from legacy cache/af-budget.json
 */

import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  ApiUsageEvent,
  DailyRollup,
  ProviderKey,
  ProviderQuotaDefinition,
  QuotaWarningLevel,
} from '@sportpulse/shared';
import { runMigrations } from './migrations.js';
import { QuotaConfigStore, quotaWindowType } from './quota-config.js';
import { currentDayInTimezone, currentMonthInTimezone } from './date-utils.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RollupRow {
  provider_key: string;
  usage_date_local: string;
  consumer_type: string;
  used_units: number;
  success_count: number;
  error_count: number;
  rate_limited_count: number;
  cache_hit_count: number;
  last_remote_limit: number | null;
  last_remote_remaining: number | null;
  last_remote_reset_at_utc: string | null;
  last_seen_at_utc: string;
}

interface LegacyBudgetDoc {
  date: string;
  requestsToday: number;
  quotaExhaustedUntil: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * currentDayUtc — kept ONLY for provider-agnostic internal uses (e.g. legacy migration
 * date comparisons, markBlocked, consumeRequest compat shim) where UTC is semantically
 * correct because these events are not tied to any specific provider's timezone.
 */
function currentDayUtc(): string {
  return currentDayInTimezone('UTC');
}

function rowToRollup(row: RollupRow): DailyRollup {
  return {
    providerKey: row.provider_key as ProviderKey,
    usageDateLocal: row.usage_date_local,
    consumerType: row.consumer_type as DailyRollup['consumerType'],
    usedUnits: row.used_units,
    successCount: row.success_count,
    errorCount: row.error_count,
    rateLimitedCount: row.rate_limited_count,
    cacheHitCount: row.cache_hit_count,
    lastRemoteLimit: row.last_remote_limit,
    lastRemoteRemaining: row.last_remote_remaining,
    lastRemoteResetAtUtc: row.last_remote_reset_at_utc,
    lastSeenAtUtc: row.last_seen_at_utc,
  };
}

// ── ApiUsageLedger ────────────────────────────────────────────────────────────

export class ApiUsageLedger {
  private readonly db: Database.Database;
  private readonly quotaConfig: QuotaConfigStore;

  // In-memory quota exhaustion cache (avoids per-request DB queries)
  private readonly exhaustedUntil = new Map<ProviderKey, number>();

  // Prepared statements
  private readonly stmtInsertEvent: Database.Statement;
  private readonly stmtUpsertRollup: Database.Statement;
  private readonly stmtGetTodayRollups: Database.Statement;
  private readonly stmtGetProviderRollup: Database.Statement;
  private readonly stmtGetRecentEvents: Database.Statement;
  private readonly stmtGetTodayTotal: Database.Statement;
  private readonly stmtGetProviderTopOps: Database.Statement;
  private readonly stmtGetProviderTopConsumers: Database.Statement;
  private readonly stmtGetTodayObservedUnits: Database.Statement;
  private readonly stmtUpsertReconciliation: Database.Statement;
  private readonly stmtGetTodayBlocked: Database.Statement;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    runMigrations(this.db);
    this.quotaConfig = new QuotaConfigStore(this.db);

    // Prepare statements
    this.stmtInsertEvent = this.db.prepare(`
      INSERT INTO api_usage_events (
        id, provider_key, usage_date_local, unit_type, usage_units,
        consumer_type, consumer_id, module_key, operation_key, request_method,
        endpoint_template, status_code, success, rate_limited, cache_hit,
        started_at_utc, finished_at_utc, latency_ms,
        remote_limit, remote_remaining, remote_reset_at_utc,
        error_code, error_class, request_id, metadata_json, created_at_utc
      ) VALUES (
        @id, @providerKey, @usageDateLocal, @unitType, @usageUnits,
        @consumerType, @consumerId, @moduleKey, @operationKey, @requestMethod,
        @endpointTemplate, @statusCode, @success, @rateLimited, @cacheHit,
        @startedAtUtc, @finishedAtUtc, @latencyMs,
        @remoteLimit, @remoteRemaining, @remoteResetAtUtc,
        @errorCode, @errorClass, @requestId, @metadataJson, @createdAtUtc
      )
    `);

    this.stmtUpsertRollup = this.db.prepare(`
      INSERT INTO api_usage_daily_rollups (
        provider_key, usage_date_local, consumer_type,
        used_units, success_count, error_count, rate_limited_count, cache_hit_count,
        last_remote_limit, last_remote_remaining, last_remote_reset_at_utc, last_seen_at_utc
      ) VALUES (
        @providerKey, @usageDateLocal, @consumerType,
        @usageUnits, @success, @error, @rateLimited, @cacheHit,
        @remoteLimit, @remoteRemaining, @remoteResetAtUtc, @now
      )
      ON CONFLICT(provider_key, usage_date_local, consumer_type) DO UPDATE SET
        used_units          = used_units + excluded.used_units,
        success_count       = success_count + excluded.success_count,
        error_count         = error_count + excluded.error_count,
        rate_limited_count  = rate_limited_count + excluded.rate_limited_count,
        cache_hit_count     = cache_hit_count + excluded.cache_hit_count,
        last_remote_limit   = COALESCE(excluded.last_remote_limit, last_remote_limit),
        last_remote_remaining = COALESCE(excluded.last_remote_remaining, last_remote_remaining),
        last_remote_reset_at_utc = COALESCE(excluded.last_remote_reset_at_utc, last_remote_reset_at_utc),
        last_seen_at_utc    = excluded.last_seen_at_utc
    `);

    this.stmtGetTodayRollups = this.db.prepare(`
      SELECT * FROM api_usage_daily_rollups WHERE usage_date_local = ?
    `);

    this.stmtGetProviderRollup = this.db.prepare(`
      SELECT * FROM api_usage_daily_rollups
      WHERE provider_key = ? AND usage_date_local = ?
    `);

    this.stmtGetRecentEvents = this.db.prepare(`
      SELECT * FROM api_usage_events
      WHERE provider_key = ?
      ORDER BY created_at_utc DESC
      LIMIT ?
    `);

    this.stmtGetTodayTotal = this.db.prepare(`
      SELECT COALESCE(SUM(used_units), 0) as total
      FROM api_usage_daily_rollups
      WHERE provider_key = ? AND usage_date_local = ?
    `);

    this.stmtGetProviderTopOps = this.db.prepare(`
      SELECT operation_key as operationKey,
             COUNT(*) as count,
             SUM(usage_units) as totalUnits
      FROM api_usage_events
      WHERE provider_key = ? AND usage_date_local = ?
      GROUP BY operation_key
      ORDER BY count DESC
      LIMIT ?
    `);

    this.stmtGetProviderTopConsumers = this.db.prepare(`
      SELECT consumer_id as consumerId,
             COUNT(*) as count,
             SUM(usage_units) as totalUnits
      FROM api_usage_events
      WHERE provider_key = ? AND usage_date_local = ? AND consumer_id IS NOT NULL
      GROUP BY consumer_id
      ORDER BY count DESC
      LIMIT ?
    `);

    this.stmtGetTodayObservedUnits = this.db.prepare(`
      SELECT COALESCE(SUM(used_units), 0) as total
      FROM api_usage_daily_rollups
      WHERE provider_key = ? AND usage_date_local = ? AND consumer_type != 'RECONCILIATION'
    `);

    this.stmtGetTodayBlocked = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM api_usage_events
      WHERE provider_key = ? AND usage_date_local = ? AND error_code = 'QUOTA_BLOCKED'
    `);

    this.stmtUpsertReconciliation = this.db.prepare(`
      INSERT INTO api_usage_daily_rollups (
        provider_key, usage_date_local, consumer_type,
        used_units, success_count, error_count, rate_limited_count, cache_hit_count,
        last_remote_limit, last_remote_remaining, last_remote_reset_at_utc, last_seen_at_utc
      ) VALUES (?, ?, 'RECONCILIATION', ?, 0, 0, 0, 0, NULL, NULL, NULL, ?)
      ON CONFLICT(provider_key, usage_date_local, consumer_type)
      DO UPDATE SET
        used_units       = excluded.used_units,
        last_seen_at_utc = excluded.last_seen_at_utc
    `);

    // Attempt legacy af-budget migration
    if (dbPath !== ':memory:') {
      this.migrateLegacyAfBudget(path.join(path.dirname(dbPath), '..', 'af-budget.json'));
    }
  }

  // ── Core API ──────────────────────────────────────────────────────────────

  recordEvent(event: ApiUsageEvent): void {
    const writeEvent = this.db.transaction(() => {
      this.stmtInsertEvent.run({
        id: event.id,
        providerKey: event.providerKey,
        usageDateLocal: event.usageDateLocal,
        unitType: event.unitType,
        usageUnits: event.usageUnits,
        consumerType: event.consumerType,
        consumerId: event.consumerId,
        moduleKey: event.moduleKey,
        operationKey: event.operationKey,
        requestMethod: event.requestMethod,
        endpointTemplate: event.endpointTemplate,
        statusCode: event.statusCode,
        success: event.success ? 1 : 0,
        rateLimited: event.rateLimited ? 1 : 0,
        cacheHit: event.cacheHit ? 1 : 0,
        startedAtUtc: event.startedAtUtc,
        finishedAtUtc: event.finishedAtUtc,
        latencyMs: event.latencyMs,
        remoteLimit: event.remoteLimit,
        remoteRemaining: event.remoteRemaining,
        remoteResetAtUtc: event.remoteResetAtUtc,
        errorCode: event.errorCode,
        errorClass: event.errorClass,
        requestId: event.requestId,
        metadataJson: event.metadataJson,
        createdAtUtc: event.createdAtUtc,
      });

      this.stmtUpsertRollup.run({
        providerKey: event.providerKey,
        usageDateLocal: event.usageDateLocal,
        consumerType: event.consumerType,
        usageUnits: event.usageUnits,
        success: event.success ? 1 : 0,
        error: event.success ? 0 : 1,
        rateLimited: event.rateLimited ? 1 : 0,
        cacheHit: event.cacheHit ? 1 : 0,
        remoteLimit: event.remoteLimit,
        remoteRemaining: event.remoteRemaining,
        remoteResetAtUtc: event.remoteResetAtUtc,
        now: event.createdAtUtc,
      });
    });

    try {
      writeEvent();
    } catch (err) {
      // Ledger failures must never block the actual API call
      console.warn(
        '[ApiUsageLedger] recordEvent failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  getTodayRollup(providerKey: ProviderKey): DailyRollup | null {
    const tz = this.quotaConfig.get(providerKey as ProviderKey)?.timezone ?? 'UTC';
    const today = currentDayInTimezone(tz);
    const rows = this.stmtGetTodayRollups.all(today) as RollupRow[];
    const providerRows = rows.filter((r) => r.provider_key === providerKey);
    if (providerRows.length === 0) return null;

    // Aggregate across all consumer types for a single provider summary
    const merged: DailyRollup = {
      providerKey,
      usageDateLocal: today,
      consumerType: 'UNKNOWN',
      usedUnits: 0,
      successCount: 0,
      errorCount: 0,
      rateLimitedCount: 0,
      cacheHitCount: 0,
      lastRemoteLimit: null,
      lastRemoteRemaining: null,
      lastRemoteResetAtUtc: null,
      lastSeenAtUtc: '',
    };

    for (const row of providerRows) {
      merged.usedUnits += row.used_units;
      merged.successCount += row.success_count;
      merged.errorCount += row.error_count;
      merged.rateLimitedCount += row.rate_limited_count;
      merged.cacheHitCount += row.cache_hit_count;
      if (row.last_remote_limit !== null) merged.lastRemoteLimit = row.last_remote_limit;
      if (row.last_remote_remaining !== null)
        merged.lastRemoteRemaining = row.last_remote_remaining;
      if (row.last_remote_reset_at_utc) merged.lastRemoteResetAtUtc = row.last_remote_reset_at_utc;
      if (!merged.lastSeenAtUtc || row.last_seen_at_utc > merged.lastSeenAtUtc) {
        merged.lastSeenAtUtc = row.last_seen_at_utc;
      }
    }

    return merged;
  }

  /**
   * Returns rollups for all providers, each queried against its own "current window"
   * (daily or monthly) in the provider's configured timezone.
   * Spec: SPEC-SPORTPULSE-OPS-QUOTA-LEDGER-TIMEZONE-AWARENESS §5.5
   */
  getAllCurrentWindowRollups(): DailyRollup[] {
    const quotas = this.quotaConfig.getAll();
    const results: DailyRollup[] = [];

    for (const quota of quotas) {
      const windowType = quotaWindowType(quota);
      if (windowType === 'none') continue;

      let rows: RollupRow[];
      if (windowType === 'monthly') {
        const yearMonth = currentMonthInTimezone(quota.timezone);
        rows = this.db
          .prepare(
            `SELECT * FROM api_usage_daily_rollups
             WHERE provider_key = ? AND usage_date_local LIKE ?`,
          )
          .all(quota.providerKey, `${yearMonth}-%`) as RollupRow[];
      } else {
        // daily
        const dateKey = currentDayInTimezone(quota.timezone);
        rows = this.db
          .prepare(
            `SELECT * FROM api_usage_daily_rollups
             WHERE provider_key = ? AND usage_date_local = ?`,
          )
          .all(quota.providerKey, dateKey) as RollupRow[];
      }

      results.push(...rows.map(rowToRollup));
    }

    return results;
  }

  /**
   * @deprecated Use getAllCurrentWindowRollups() which respects per-provider timezones.
   * Kept as alias for backward compatibility during transition.
   */
  getAllTodayRollups(): DailyRollup[] {
    return this.getAllCurrentWindowRollups();
  }

  getRecentEvents(providerKey: ProviderKey, limit = 50): ApiUsageEvent[] {
    const rows = this.stmtGetRecentEvents.all(providerKey, limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row['id'] as string,
      providerKey: row['provider_key'] as ProviderKey,
      usageDateLocal: row['usage_date_local'] as string,
      unitType: row['unit_type'] as ApiUsageEvent['unitType'],
      usageUnits: row['usage_units'] as number,
      consumerType: row['consumer_type'] as ApiUsageEvent['consumerType'],
      consumerId: row['consumer_id'] as string | null,
      moduleKey: row['module_key'] as string,
      operationKey: row['operation_key'] as string,
      requestMethod: row['request_method'] as ApiUsageEvent['requestMethod'],
      endpointTemplate: row['endpoint_template'] as string,
      statusCode: row['status_code'] as number | null,
      success: (row['success'] as number) === 1,
      rateLimited: (row['rate_limited'] as number) === 1,
      cacheHit: (row['cache_hit'] as number) === 1,
      startedAtUtc: row['started_at_utc'] as string,
      finishedAtUtc: row['finished_at_utc'] as string,
      latencyMs: row['latency_ms'] as number,
      remoteLimit: row['remote_limit'] as number | null,
      remoteRemaining: row['remote_remaining'] as number | null,
      remoteResetAtUtc: row['remote_reset_at_utc'] as string | null,
      errorCode: row['error_code'] as string | null,
      errorClass: row['error_class'] as string | null,
      requestId: row['request_id'] as string | null,
      metadataJson: row['metadata_json'] as string | null,
      createdAtUtc: row['created_at_utc'] as string,
    }));
  }

  getProviderSummary(providerKey: ProviderKey): {
    rollup: DailyRollup | null;
    quota: ProviderQuotaDefinition | null;
    percentUsed: number;
    warningLevel: QuotaWarningLevel;
  } {
    const rollup = this.getTodayRollup(providerKey);
    const quota = this.quotaConfig.get(providerKey);
    const usedUnits = rollup?.usedUnits ?? 0;
    const dailyLimit = quota?.dailyLimit ?? 0;
    const percentUsed = dailyLimit > 0 ? (usedUnits / dailyLimit) * 100 : 0;

    let warningLevel: QuotaWarningLevel = 'NORMAL';
    if (dailyLimit > 0) {
      if (percentUsed >= (quota?.hardStopThresholdPct ?? 95)) warningLevel = 'EXHAUSTED';
      else if (percentUsed >= (quota?.criticalThresholdPct ?? 90)) warningLevel = 'CRITICAL';
      else if (percentUsed >= (quota?.warningThresholdPct ?? 75)) warningLevel = 'WARNING';
    }

    return { rollup, quota, percentUsed, warningLevel };
  }

  /**
   * Returns total used units for a provider in a given calendar month.
   * Spec: SPEC-SPORTPULSE-OPS-QUOTA-LEDGER-TIMEZONE-AWARENESS §5.6
   *
   * @param providerKey Provider to query
   * @param yearMonth   Optional 'YYYY-MM' format. When omitted, derived from the
   *                    provider's configured timezone (correct current month for that provider).
   */
  getMonthTotal(providerKey: ProviderKey, yearMonth?: string): number {
    let resolvedYearMonth = yearMonth;
    if (!resolvedYearMonth) {
      const quota = this.quotaConfig.get(providerKey);
      const tz = quota?.timezone ?? 'UTC';
      resolvedYearMonth = currentMonthInTimezone(tz);
    }
    const result = this.db
      .prepare(
        `SELECT COALESCE(SUM(used_units), 0) as total
         FROM api_usage_daily_rollups
         WHERE provider_key = ? AND usage_date_local LIKE ?`,
      )
      .get(providerKey, `${resolvedYearMonth}-%`) as { total: number };
    return result.total;
  }

  getProviderTopOps(
    providerKey: ProviderKey,
    limit: number,
  ): { operationKey: string; count: number; totalUnits: number }[] {
    const tz = this.quotaConfig.get(providerKey as ProviderKey)?.timezone ?? 'UTC';
    return this.stmtGetProviderTopOps.all(providerKey, currentDayInTimezone(tz), limit) as {
      operationKey: string;
      count: number;
      totalUnits: number;
    }[];
  }

  getProviderTopConsumers(
    providerKey: ProviderKey,
    limit: number,
  ): { consumerId: string; count: number; totalUnits: number }[] {
    const tz = this.quotaConfig.get(providerKey as ProviderKey)?.timezone ?? 'UTC';
    return this.stmtGetProviderTopConsumers.all(providerKey, currentDayInTimezone(tz), limit) as {
      consumerId: string;
      count: number;
      totalUnits: number;
    }[];
  }

  // ── Quota checks ──────────────────────────────────────────────────────────

  isQuotaExhausted(providerKey: ProviderKey): boolean {
    // 1. Mem cache (fast path — avoids DB query on every call)
    const exhaustedUntil = this.exhaustedUntil.get(providerKey) ?? 0;
    if (Date.now() < exhaustedUntil) return true;

    // 2. DB fallback — survives server restarts (Fix 1)
    const persistedRow = this.db
      .prepare('SELECT exhausted_until_utc FROM provider_quota_config WHERE provider_key = ?')
      .get(providerKey) as { exhausted_until_utc: string | null } | undefined;
    if (persistedRow?.exhausted_until_utc) {
      const dbUntil = new Date(persistedRow.exhausted_until_utc).getTime();
      if (Date.now() < dbUntil) {
        this.exhaustedUntil.set(providerKey, dbUntil); // re-warm mem cache
        // Fix B: ensure rollup reflects full consumption after restart (partial rollup case)
        const qb = this.quotaConfig.get(providerKey);
        const limitB = qb?.dailyLimit ?? 0;
        if (limitB > 0) {
          this.reconcileFromProviderHeaders(providerKey, 0, limitB);
        }
        return true;
      }
      // Expired — clear the persisted flag
      this.db
        .prepare(
          'UPDATE provider_quota_config SET exhausted_until_utc = NULL WHERE provider_key = ?',
        )
        .run(providerKey);
    }

    // 3. Ledger-based check
    const quota = this.quotaConfig.get(providerKey);
    if (!quota) return false;

    if (quota.dailyLimit > 0) {
      // Daily provider
      const tz = quota.timezone ?? 'UTC';
      const result = this.stmtGetTodayTotal.get(providerKey, currentDayInTimezone(tz)) as {
        total: number;
      };
      return result.total >= quota.dailyLimit;
    }

    if ((quota.monthlyLimit ?? 0) > 0) {
      // Monthly provider — Fix 2: was always returning false due to dailyLimit === 0 short-circuit
      return this.getMonthTotal(providerKey) >= (quota.monthlyLimit ?? 0);
    }

    return false; // no limit configured
  }

  isLiveBrakeActive(providerKey: ProviderKey = 'api-football'): boolean {
    const quota = this.quotaConfig.get(providerKey);
    if (!quota || quota.brakeLiveThreshold === 0) return false;
    const tz = quota.timezone ?? 'UTC';
    const result = this.stmtGetTodayTotal.get(providerKey, currentDayInTimezone(tz)) as {
      total: number;
    };
    return result.total >= quota.brakeLiveThreshold;
  }

  markQuotaExhausted(providerKey: ProviderKey = 'api-football'): void {
    const quota = this.quotaConfig.get(providerKey as ProviderKey);
    const tz = quota?.timezone ?? 'UTC';
    const todayInTz = currentDayInTimezone(tz); // 'YYYY-MM-DD'
    const [year, month, day] = todayInTz.split('-').map(Number);

    let nextResetMs: number;
    if ((quota?.monthlyLimit ?? 0) > 0) {
      // Fix 3: monthly providers reset on the 1st of next month at 00:00 UTC —
      // not tomorrow. Using tomorrow was causing the system to retry after 1 day
      // instead of waiting until the actual monthly reset.
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      nextResetMs = Date.UTC(nextYear, nextMonth - 1, 1, 0, 0, 0);
    } else {
      // Daily providers: next UTC midnight of tomorrow's date in provider timezone.
      nextResetMs = Date.UTC(year, month - 1, day + 1, 0, 0, 0);
    }

    // Fix 1: persist to DB so exhaustion survives server restarts
    this.db
      .prepare('UPDATE provider_quota_config SET exhausted_until_utc = ? WHERE provider_key = ?')
      .run(new Date(nextResetMs).toISOString(), providerKey);

    this.exhaustedUntil.set(providerKey, nextResetMs);

    // Fix A: force-reconcile rollup to dailyLimit so the panel shows full consumption
    // (provider error responses don't include quota headers, so the rollup may be partial)
    const limit = quota?.dailyLimit ?? 0;
    if (limit > 0) {
      this.reconcileFromProviderHeaders(providerKey, 0, limit);
    }

    console.warn(
      `[ApiUsageLedger] Quota exhausted for ${providerKey} — suspended until ${new Date(nextResetMs).toISOString()}`,
    );
  }

  /**
   * Returns the sum of used_units for today EXCLUDING RECONCILIATION rows.
   * Used by reconcileFromProviderHeaders to compute the gap without double-counting.
   */
  getTodayObservedUnits(providerKey: ProviderKey): number {
    const tz = this.quotaConfig.get(providerKey as ProviderKey)?.timezone ?? 'UTC';
    const result = this.stmtGetTodayObservedUnits.get(providerKey, currentDayInTimezone(tz)) as {
      total: number;
    };
    return result.total;
  }

  /**
   * Closes the gap between ledger-observed usage and provider-reported usage.
   * Called each time a provider response carries quota headers (remoteRemaining + remoteLimit).
   * Idempotent: calling twice with the same provider values leaves the ledger unchanged.
   * Non-blocking: a single RECONCILIATION row per (providerKey, date) is upserted (replaced, not added).
   */
  reconcileFromProviderHeaders(
    providerKey: ProviderKey,
    remoteRemaining: number,
    remoteLimit: number,
  ): void {
    const providerUsed = remoteLimit - remoteRemaining;
    if (providerUsed < 0) return; // nonsensical header values — skip
    const ledgerObserved = this.getTodayObservedUnits(providerKey);
    const gap = providerUsed - ledgerObserved;
    if (gap <= 0) return; // ledger already accounts for equal or more — no reconciliation needed
    const tz = this.quotaConfig.get(providerKey as ProviderKey)?.timezone ?? 'UTC';
    this.stmtUpsertReconciliation.run(
      providerKey,
      currentDayInTimezone(tz),
      gap,
      new Date().toISOString(),
    );
  }

  getQuotaConfig(): QuotaConfigStore {
    return this.quotaConfig;
  }

  /** Exposes the underlying SQLite database for maintenance operations (e.g. runRetentionPruner). */
  getDb(): Database.Database {
    return this.db;
  }

  // ── af-budget.ts compatibility surface ────────────────────────────────────
  // These methods preserve the exact signatures of the deleted af-budget.ts
  // so callers can migrate with only an import path change.

  /** @deprecated Use recordEvent() with full context. Kept for af-budget compatibility. */
  consumeRequest(): void {
    const now = new Date().toISOString();
    this.recordEvent({
      id: `compat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      providerKey: 'api-football',
      usageDateLocal: currentDayUtc(),
      unitType: 'REQUEST',
      usageUnits: 1,
      consumerType: 'PORTAL_RUNTIME',
      consumerId: null,
      moduleKey: 'af-budget-compat',
      operationKey: 'unknown',
      requestMethod: 'GET',
      endpointTemplate: 'unknown',
      statusCode: 200,
      success: true,
      rateLimited: false,
      cacheHit: false,
      startedAtUtc: now,
      finishedAtUtc: now,
      latencyMs: 0,
      remoteLimit: null,
      remoteRemaining: null,
      remoteResetAtUtc: null,
      errorCode: null,
      errorClass: null,
      requestId: null,
      metadataJson: null,
      createdAtUtc: now,
    });
  }

  /** @deprecated Use getProviderSummary(). Kept for af-budget compatibility. */
  getBudgetStats(): {
    requestsToday: number;
    limit: number;
    exhausted: boolean;
    brakeActive: boolean;
    quotaExhaustedUntil: number;
  } {
    const result = this.stmtGetTodayTotal.get('api-football', currentDayUtc()) as {
      total: number;
    };
    const quota = this.quotaConfig.get('api-football');
    const exhaustedUntil = this.exhaustedUntil.get('api-football') ?? 0;
    return {
      requestsToday: result.total,
      limit: quota?.dailyLimit ?? 7500,
      exhausted: this.isQuotaExhausted('api-football'),
      brakeActive: this.isLiveBrakeActive('api-football'),
      quotaExhaustedUntil: exhaustedUntil,
    };
  }

  /**
   * Records a blocked API call — one that was skipped because quota was exhausted.
   * usageUnits=0 so it does not inflate quota counters.
   */
  markBlocked(providerKey: ProviderKey = 'api-football'): void {
    const now = new Date().toISOString();
    const tz = this.quotaConfig.get(providerKey as ProviderKey)?.timezone ?? 'UTC';
    this.recordEvent({
      id: `blocked-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      providerKey,
      usageDateLocal: currentDayInTimezone(tz),
      unitType: 'REQUEST',
      usageUnits: 0,
      consumerType: 'QUOTA_BLOCKED',
      consumerId: null,
      moduleKey: 'quota-guard',
      operationKey: 'blocked',
      requestMethod: 'GET',
      endpointTemplate: 'unknown',
      statusCode: null,
      success: false,
      rateLimited: false,
      cacheHit: false,
      startedAtUtc: now,
      finishedAtUtc: now,
      latencyMs: 0,
      remoteLimit: null,
      remoteRemaining: null,
      remoteResetAtUtc: null,
      errorCode: 'QUOTA_BLOCKED',
      errorClass: null,
      requestId: null,
      metadataJson: null,
      createdAtUtc: now,
    });
  }

  /**
   * Seeds the quota state for a provider from a known provider-reported remaining value.
   * Records a zero-cost sync event so the rollup carries the correct lastRemoteRemaining,
   * enabling the monthly used calculation: used = limit - remaining.
   * Idempotent — safe to call multiple times (each call just updates the rollup timestamp).
   */
  seedProviderQuota(providerKey: ProviderKey, remaining: number, limit: number): void {
    const now = new Date().toISOString();
    const tz = this.quotaConfig.get(providerKey)?.timezone ?? 'UTC';
    const dateLocal = currentDayInTimezone(tz);
    this.recordEvent({
      id: `quota-seed-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      providerKey,
      usageDateLocal: dateLocal,
      unitType: 'REQUEST',
      usageUnits: 0,
      consumerType: 'BACKFILL_JOB',
      consumerId: 'admin-seed',
      moduleKey: 'admin-quota-sync',
      operationKey: 'seed-quota',
      requestMethod: 'GET',
      endpointTemplate: 'admin-seed',
      statusCode: null,
      success: true,
      rateLimited: false,
      cacheHit: true,
      startedAtUtc: now,
      finishedAtUtc: now,
      latencyMs: 0,
      remoteLimit: limit,
      remoteRemaining: remaining,
      remoteResetAtUtc: null,
      errorCode: null,
      errorClass: null,
      requestId: null,
      metadataJson: JSON.stringify({ source: 'admin-seed', seededAt: now }),
      createdAtUtc: now,
    });
  }

  /** Returns the number of blocked calls (quota exhausted) recorded today for the given provider. */
  getTodayBlockedCount(providerKey: ProviderKey = 'api-football'): number {
    const tz = this.quotaConfig.get(providerKey as ProviderKey)?.timezone ?? 'UTC';
    const result = this.stmtGetTodayBlocked.get(providerKey, currentDayInTimezone(tz)) as {
      count: number;
    };
    return result.count;
  }

  // ── Legacy migration ──────────────────────────────────────────────────────

  private migrateLegacyAfBudget(legacyPath: string): void {
    const resolvedPath = path.resolve(legacyPath);
    if (!fs.existsSync(resolvedPath)) return;

    try {
      const raw = fs.readFileSync(resolvedPath, 'utf-8');
      const doc = JSON.parse(raw) as LegacyBudgetDoc;

      if (doc.date !== currentDayUtc()) {
        // Stale — rename and ignore
        fs.renameSync(resolvedPath, `${resolvedPath}.migrated`);
        return;
      }

      if (doc.requestsToday > 0) {
        const now = new Date().toISOString();
        this.stmtUpsertRollup.run({
          providerKey: 'api-football',
          usageDateLocal: doc.date,
          consumerType: 'PORTAL_RUNTIME',
          usageUnits: doc.requestsToday,
          success: doc.requestsToday,
          error: 0,
          rateLimited: 0,
          cacheHit: 0,
          remoteLimit: null,
          remoteRemaining: null,
          remoteResetAtUtc: null,
          now,
        });
        console.log(
          `[ApiUsageLedger] Migrated af-budget.json: ${doc.requestsToday} requests seeded`,
        );
      }

      if (doc.quotaExhaustedUntil > Date.now()) {
        this.exhaustedUntil.set('api-football', doc.quotaExhaustedUntil);
      }

      fs.renameSync(resolvedPath, `${resolvedPath}.migrated`);
    } catch (err) {
      console.warn(
        '[ApiUsageLedger] af-budget migration failed (non-fatal):',
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
