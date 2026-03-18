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
  getRecentEvents(providerKey: ProviderKey, limit?: number): ApiUsageEvent[];
}

// ── Route registration ─────────────────────────────────────────────────────

export function registerApiUsageRoutes(
  fastify: FastifyInstance,
  ledger: IApiUsageLedger,
): void {
  // GET /api/internal/ops/api-usage/today
  // Returns daily summary for all providers
  fastify.get('/api/internal/ops/api-usage/today', async (_req, reply) => {
    const rollups = ledger.getAllTodayRollups();
    const configs = ledger.getQuotaConfig().getAll();

    const providers = configs.map((quota) => {
      const providerRollups = rollups.filter((r) => r.providerKey === quota.providerKey);
      const usedUnits = providerRollups.reduce((sum, r) => sum + r.usedUnits, 0);
      const byConsumerType = providerRollups.map((r) => ({
        consumerType: r.consumerType,
        usedUnits: r.usedUnits,
      }));

      const dailyLimit = quota.dailyLimit;
      const estimatedRemaining = dailyLimit > 0 ? Math.max(0, dailyLimit - usedUnits) : null;

      // Get latest provider-reported remaining from rollups (most recent lastSeenAtUtc)
      const latestRollup = providerRollups
        .slice()
        .sort((a, b) => b.lastSeenAtUtc.localeCompare(a.lastSeenAtUtc))[0];

      const providerReportedRemaining = latestRollup?.lastRemoteRemaining ?? null;
      const providerReportedLimit = latestRollup?.lastRemoteLimit ?? null;

      // Discrepancy detection between ledger-estimated and provider-reported remaining
      let discrepancyStatus: 'NONE' | 'MINOR' | 'MAJOR' | 'UNKNOWN' = 'UNKNOWN';
      if (estimatedRemaining !== null && providerReportedRemaining !== null) {
        const diff = Math.abs(estimatedRemaining - providerReportedRemaining);
        const pct = dailyLimit > 0 ? (diff / dailyLimit) * 100 : 0;
        discrepancyStatus = pct < 5 ? 'NONE' : pct < 15 ? 'MINOR' : 'MAJOR';
      } else if (estimatedRemaining !== null) {
        discrepancyStatus = 'NONE'; // no provider report to compare against
      }

      // Warning level based on % of daily limit consumed
      const pctUsed = dailyLimit > 0 ? (usedUnits / dailyLimit) * 100 : 0;
      let warningLevel: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'EXHAUSTED' = 'NORMAL';
      if (dailyLimit > 0) {
        if (pctUsed >= quota.hardStopThresholdPct) warningLevel = 'EXHAUSTED';
        else if (pctUsed >= quota.criticalThresholdPct) warningLevel = 'CRITICAL';
        else if (pctUsed >= quota.warningThresholdPct) warningLevel = 'WARNING';
      }

      return {
        providerKey: quota.providerKey,
        displayName: quota.displayName,
        dailyLimit: dailyLimit > 0 ? dailyLimit : null,
        usedUnitsObserved: usedUnits,
        estimatedRemaining,
        providerReportedRemaining,
        providerReportedLimit,
        discrepancyStatus,
        warningLevel,
        lastSeenAtUtc: latestRollup?.lastSeenAtUtc ?? null,
        byConsumerType,
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

      return reply.send({
        providerKey,
        rollup: summary.rollup,
        quota: summary.quota,
        percentUsed: Math.round(summary.percentUsed * 10) / 10,
        warningLevel: summary.warningLevel,
        recentEvents,
      });
    },
  );

  // GET /api/internal/ops/api-usage/events?provider=X&limit=50&consumerType=Y
  // Returns recent filtered events for a provider
  fastify.get<{
    Querystring: { provider?: string; limit?: string; consumerType?: string };
  }>('/api/internal/ops/api-usage/events', async (req, reply) => {
    const { provider, limit: limitStr, consumerType } = req.query;
    const limit = Math.min(parseInt(limitStr ?? '50', 10) || 50, 200);

    if (!provider) {
      return reply.status(400).send({ error: 'provider query param required' });
    }

    // Validate provider is known
    const configs = ledger.getQuotaConfig().getAll();
    const knownProvider = configs.find((c) => c.providerKey === provider);
    if (!knownProvider) {
      return reply.status(404).send({ error: 'Provider not found', provider });
    }

    let events = ledger.getRecentEvents(provider as ProviderKey, limit);

    if (consumerType) {
      events = events.filter((e) => e.consumerType === consumerType);
    }

    return reply.send({ events, count: events.length });
  });
}
