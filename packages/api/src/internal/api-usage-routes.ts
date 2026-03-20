/**
 * api-usage-routes.ts — Internal ops endpoints for API Usage Governance.
 * Spec: SPEC-SPORTPULSE-OPS-API-USAGE-GOVERNANCE §14
 *
 * Routes (admin-only, not exposed to public frontend):
 *   GET /api/internal/ops/api-usage/today
 *   GET /api/internal/ops/api-usage/providers/:providerKey
 *   GET /api/internal/ops/api-usage/events
 *
 * Boundary note: this module defines IApiUsageLedger as a structural interface
 * over the shared types (DailyRollup, ApiUsageEvent, ProviderQuotaDefinition)
 * so that packages/api never imports from @sportpulse/canonical directly.
 */

import type { FastifyInstance } from 'fastify';
import type {
  ApiUsageEvent,
  DailyRollup,
  ProviderKey,
  ProviderQuotaDefinition,
  QuotaWarningLevel,
} from '@sportpulse/shared';

// ── Interface surface (structural, not concrete import) ────────────────────

export interface IQuotaConfigStore {
  getAll(): ProviderQuotaDefinition[];
}

export interface IApiUsageLedger {
  getAllTodayRollups(): DailyRollup[];
  getQuotaConfig(): IQuotaConfigStore;
  getProviderSummary(providerKey: ProviderKey): {
    rollup: DailyRollup | null;
    quota: ProviderQuotaDefinition | null;
    percentUsed: number;
    warningLevel: QuotaWarningLevel;
  };
  getMonthTotal(providerKey: ProviderKey, yearMonth: string): number;
  getRecentEvents(providerKey: ProviderKey, limit?: number): ApiUsageEvent[];
  getProviderTopOps(
    providerKey: ProviderKey,
    limit: number,
  ): { operationKey: string; count: number; totalUnits: number }[];
  getProviderTopConsumers(
    providerKey: ProviderKey,
    limit: number,
  ): { consumerId: string; count: number; totalUnits: number }[];
  getTodayBlockedCount(providerKey: ProviderKey): number;
}

// ── Private helpers ────────────────────────────────────────────────────────

function calcDiscrepancy(
  estimatedRemaining: number | null,
  providerReportedRemaining: number | null,
  dailyLimit: number,
): 'NONE' | 'MINOR' | 'MAJOR' | 'UNKNOWN' {
  if (estimatedRemaining !== null && providerReportedRemaining !== null) {
    const diff = Math.abs(estimatedRemaining - providerReportedRemaining);
    const pct = dailyLimit > 0 ? (diff / dailyLimit) * 100 : 0;
    return pct < 5 ? 'NONE' : pct < 15 ? 'MINOR' : 'MAJOR';
  }
  if (estimatedRemaining !== null) {
    return 'NONE'; // no provider report to compare against
  }
  return 'UNKNOWN';
}

// ── Route registration ─────────────────────────────────────────────────────

export function registerApiUsageRoutes(fastify: FastifyInstance, ledger: IApiUsageLedger): void {
  // GET /api/internal/ops/api-usage/today
  // Returns daily summary for all providers
  fastify.get('/api/internal/ops/api-usage/today', async (_req, reply) => {
    const rollups = ledger.getAllTodayRollups();
    const configs = ledger.getQuotaConfig().getAll();
    const nowUtc = new Date().toISOString();
    const yearMonth = nowUtc.slice(0, 7); // 'YYYY-MM'

    const providers = configs.map((quota) => {
      const providerRollups = rollups.filter((r) => r.providerKey === quota.providerKey);
      const usedUnits = providerRollups.reduce((sum, r) => sum + r.usedUnits, 0);
      const byConsumerType = providerRollups.map((r) => ({
        consumerType: r.consumerType,
        usedUnits: r.usedUnits,
      }));

      const dailyLimit = quota.dailyLimit;
      const monthlyLimit = quota.monthlyLimit ?? 0;
      const estimatedRemaining = dailyLimit > 0 ? Math.max(0, dailyLimit - usedUnits) : null;

      // Get latest provider-reported remaining from rollups (most recent lastSeenAtUtc)
      const latestRollup = providerRollups
        .slice()
        .sort((a, b) => b.lastSeenAtUtc.localeCompare(a.lastSeenAtUtc))[0];

      const providerReportedRemaining = latestRollup?.lastRemoteRemaining ?? null;
      const providerReportedLimit = latestRollup?.lastRemoteLimit ?? null;

      // Discrepancy detection between ledger-estimated and provider-reported remaining
      const discrepancyStatus = calcDiscrepancy(
        estimatedRemaining,
        providerReportedRemaining,
        dailyLimit,
      );

      // Preferir provider-reported data cuando está disponible — el ledger local
      // puede ser incompleto (solo cubre requests desde que esta instancia arrancó)
      const providerLimit = providerReportedLimit ?? dailyLimit;
      const effectiveUsedUnits =
        providerReportedRemaining !== null && providerLimit > 0
          ? providerLimit - providerReportedRemaining
          : usedUnits;
      const effectivePctUsed = dailyLimit > 0 ? (effectiveUsedUnits / dailyLimit) * 100 : 0;
      const dataSource: 'PROVIDER_REPORTED' | 'LEDGER_OBSERVED' =
        providerReportedRemaining !== null ? 'PROVIDER_REPORTED' : 'LEDGER_OBSERVED';

      // Monthly quota tracking (for providers like The Odds API with monthly limits)
      let monthlyUsed: number | null = null;
      let monthlyWarningLevel: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'EXHAUSTED' | null = null;
      if (monthlyLimit > 0) {
        const ledgerMonthly = ledger.getMonthTotal(quota.providerKey, yearMonth);
        // Prefer provider-reported remaining when available (most accurate)
        monthlyUsed =
          providerReportedRemaining !== null
            ? Math.max(monthlyLimit - providerReportedRemaining, ledgerMonthly)
            : ledgerMonthly;
        const monthlyPct = (monthlyUsed / monthlyLimit) * 100;
        if (providerReportedRemaining !== null && providerReportedRemaining <= 0) {
          monthlyWarningLevel = 'EXHAUSTED';
        } else if (monthlyPct >= quota.hardStopThresholdPct) {
          monthlyWarningLevel = 'EXHAUSTED';
        } else if (monthlyPct >= quota.criticalThresholdPct) {
          monthlyWarningLevel = 'CRITICAL';
        } else if (monthlyPct >= quota.warningThresholdPct) {
          monthlyWarningLevel = 'WARNING';
        } else {
          monthlyWarningLevel = 'NORMAL';
        }
      }

      let warningLevel: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'EXHAUSTED' = 'NORMAL';
      if (monthlyWarningLevel !== null) {
        // Monthly-quota providers: use monthly warning level
        warningLevel = monthlyWarningLevel;
      } else if (dailyLimit > 0) {
        if (effectivePctUsed >= quota.hardStopThresholdPct) warningLevel = 'EXHAUSTED';
        else if (effectivePctUsed >= quota.criticalThresholdPct) warningLevel = 'CRITICAL';
        else if (effectivePctUsed >= quota.warningThresholdPct) warningLevel = 'WARNING';
      }

      return {
        providerKey: quota.providerKey,
        displayName: quota.displayName,
        dailyLimit: dailyLimit > 0 ? dailyLimit : null,
        monthlyLimit: monthlyLimit > 0 ? monthlyLimit : null,
        monthlyUsed,
        usedUnitsObserved: usedUnits, // lo que el ledger local registró (puede ser parcial)
        effectiveUsedUnits, // basado en provider-reported cuando disponible
        estimatedRemaining,
        providerReportedRemaining,
        providerReportedLimit,
        discrepancyStatus,
        warningLevel, // calculado desde monthly o daily según corresponda
        lastSeenAtUtc: latestRollup?.lastSeenAtUtc ?? null,
        byConsumerType,
        dataSource, // 'PROVIDER_REPORTED' | 'LEDGER_OBSERVED'
        blockedToday: ledger.getTodayBlockedCount(quota.providerKey),
      };
    });

    return reply.send({
      date: new Date().toISOString().slice(0, 10),
      generatedAtUtc: new Date().toISOString(),
      providers,
    });
  });

  // GET /api/internal/ops/api-usage/providers/:providerKey
  // Returns detailed view for one provider including recent events
  fastify.get<{ Params: { providerKey: string } }>(
    '/api/internal/ops/api-usage/providers/:providerKey',
    async (req, reply) => {
      const { providerKey } = req.params;

      // Validate providerKey is known
      const configs = ledger.getQuotaConfig().getAll();
      const quota = configs.find((c) => c.providerKey === providerKey);
      if (!quota) {
        return reply.status(404).send({ error: 'Provider not found', providerKey });
      }

      const summary = ledger.getProviderSummary(providerKey as ProviderKey);
      const recentEvents = ledger.getRecentEvents(providerKey as ProviderKey, 20);
      const topOperations = ledger.getProviderTopOps(providerKey as ProviderKey, 10);
      const topConsumers = ledger.getProviderTopConsumers(providerKey as ProviderKey, 10);
      const rateLimitIncidents = recentEvents.filter((e) => e.rateLimited).slice(0, 20);

      const rollup = summary.rollup;
      const dailyLimit = summary.quota?.dailyLimit ?? 0;
      const usedUnitsObserved = rollup?.usedUnits ?? 0;
      const estimatedRemaining =
        dailyLimit > 0 ? Math.max(0, dailyLimit - usedUnitsObserved) : null;
      const providerReportedRemaining = rollup?.lastRemoteRemaining ?? null;
      const providerReportedLimit = rollup?.lastRemoteLimit ?? null;
      const discrepancyStatus = calcDiscrepancy(
        estimatedRemaining,
        providerReportedRemaining,
        dailyLimit,
      );

      // Override warningLevel with provider-reported data when available (same logic as /today)
      const providerLimit = providerReportedLimit ?? dailyLimit;
      const effectiveUsedUnits =
        providerReportedRemaining !== null && providerLimit > 0
          ? providerLimit - providerReportedRemaining
          : usedUnitsObserved;
      const effectivePctUsed = dailyLimit > 0 ? (effectiveUsedUnits / dailyLimit) * 100 : 0;
      const dataSource: 'PROVIDER_REPORTED' | 'LEDGER_OBSERVED' =
        providerReportedRemaining !== null ? 'PROVIDER_REPORTED' : 'LEDGER_OBSERVED';

      let warningLevel: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'EXHAUSTED' = 'NORMAL';
      if (summary.quota && dailyLimit > 0) {
        if (effectivePctUsed >= summary.quota.hardStopThresholdPct) warningLevel = 'EXHAUSTED';
        else if (effectivePctUsed >= summary.quota.criticalThresholdPct) warningLevel = 'CRITICAL';
        else if (effectivePctUsed >= summary.quota.warningThresholdPct) warningLevel = 'WARNING';
      }

      return reply.send({
        providerKey,
        rollup,
        quota: summary.quota,
        percentUsed: Math.round(effectivePctUsed * 10) / 10,
        warningLevel,
        usedUnitsObserved,
        effectiveUsedUnits,
        dataSource,
        recentEvents,
        topOperations,
        topConsumers,
        rateLimitIncidents,
        discrepancyStatus,
      });
    },
  );

  // GET /api/internal/ops/api-usage/events?provider=X&limit=50&consumerType=Y&rateLimited=true&success=false
  // Returns recent filtered events. provider is optional — omit to fetch from all known providers.
  fastify.get<{
    Querystring: {
      provider?: string;
      limit?: string;
      consumerType?: string;
      rateLimited?: string;
      success?: string;
    };
  }>('/api/internal/ops/api-usage/events', async (req, reply) => {
    const {
      provider,
      limit: limitStr,
      consumerType,
      rateLimited: rateLimitedStr,
      success: successStr,
    } = req.query;
    const limit = Math.min(parseInt(limitStr ?? '50', 10) || 50, 200);

    const configs = ledger.getQuotaConfig().getAll();

    let events: ApiUsageEvent[];

    if (provider) {
      // Validate provider is known
      const knownProvider = configs.find((c) => c.providerKey === provider);
      if (!knownProvider) {
        return reply.status(404).send({ error: 'Provider not found', provider });
      }
      events = ledger.getRecentEvents(provider as ProviderKey, limit);
    } else {
      // Aggregate across all known providers
      const allEvents = configs.flatMap((c) => ledger.getRecentEvents(c.providerKey, limit));
      // Sort by startedAtUtc descending and take top `limit`
      allEvents.sort((a, b) => b.startedAtUtc.localeCompare(a.startedAtUtc));
      events = allEvents.slice(0, limit);
    }

    // Apply in-memory filters
    if (consumerType) {
      events = events.filter((e) => e.consumerType === consumerType);
    }
    if (rateLimitedStr !== undefined) {
      const filterVal = rateLimitedStr === 'true';
      events = events.filter((e) => e.rateLimited === filterVal);
    }
    if (successStr !== undefined) {
      const filterVal = successStr === 'true';
      events = events.filter((e) => e.success === filterVal);
    }

    return reply.send({ events, count: events.length });
  });
}
