export { ApiUsageLedger } from './ledger.js';
export { runRetentionPruner } from './pruner.js';
export type { QuotaConfigStore } from './quota-config.js';
export { InstrumentedProviderClient, QuotaExhaustedError } from './provider-client.js';
export type { ProviderCallContext } from './provider-client.js';

// ── Standalone compatibility functions (af-budget.ts surface) ────────────────
// These allow callers to import named functions instead of using the ledger instance.
// The real singleton is created in server/index.ts and injected via setGlobalLedger().
// Scripts/tools that run outside the server process will get safe no-op behaviour.

import type { ProviderKey } from '@sportpulse/shared';
import { ApiUsageLedger } from './ledger.js';
import { InstrumentedProviderClient } from './provider-client.js';

let _globalLedger: ApiUsageLedger | null = null;

export function setGlobalLedger(ledger: ApiUsageLedger): void {
  _globalLedger = ledger;
}

function getOrWarnLedger(): ApiUsageLedger | null {
  if (!_globalLedger) {
    console.warn('[ApiUsageLedger] Global ledger not initialized — using no-op');
  }
  return _globalLedger;
}

export function isQuotaExhausted(providerKey: ProviderKey = 'api-football'): boolean {
  return _globalLedger?.isQuotaExhausted(providerKey) ?? false;
}

export function consumeRequest(): void {
  getOrWarnLedger()?.consumeRequest();
}

export function markQuotaExhausted(providerKey: ProviderKey = 'api-football'): void {
  getOrWarnLedger()?.markQuotaExhausted(providerKey);
}

export function markBlocked(providerKey: ProviderKey = 'api-football'): void {
  getOrWarnLedger()?.markBlocked(providerKey);
}

export function isLiveBrakeActive(providerKey: ProviderKey = 'api-football'): boolean {
  return _globalLedger?.isLiveBrakeActive(providerKey) ?? false;
}

export function getBudgetStats(): {
  requestsToday: number;
  limit: number;
  exhausted: boolean;
  brakeActive: boolean;
  quotaExhaustedUntil: number;
} {
  return (
    _globalLedger?.getBudgetStats() ?? {
      requestsToday: 0,
      limit: 7500,
      exhausted: false,
      brakeActive: false,
      quotaExhaustedUntil: 0,
    }
  );
}

// ── Global InstrumentedProviderClient singleton ───────────────────────────────

let _globalClient: InstrumentedProviderClient | null = null;

export function setGlobalProviderClient(client: InstrumentedProviderClient): void {
  _globalClient = client;
}

export function getGlobalProviderClient(): InstrumentedProviderClient | null {
  return _globalClient;
}
