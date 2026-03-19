/**
 * api-usage.ts — Domain types for API Usage Governance and Quota Ledger.
 * Spec: SPEC-SPORTPULSE-OPS-API-USAGE-GOVERNANCE v0.1
 */

// ── Provider keys ─────────────────────────────────────────────────────────────

export type ProviderKey =
  | 'api-football'
  | 'football-data'
  | 'thesportsdb'
  | 'youtube'
  | 'the-odds-api'
  | 'eventos';

// ── Consumer types ────────────────────────────────────────────────────────────

export type ConsumerType =
  | 'PORTAL_RUNTIME'
  | 'CANONICAL_INGESTION'
  | 'SNAPSHOT_BUILD'
  | 'PREDICTION_TRAINING'
  | 'PREDICTION_EVALUATION'
  | 'BACKFILL_JOB'
  | 'MANUAL_SCRIPT'
  | 'DEV_EXPERIMENT'
  | 'RECONCILIATION' // closes the gap between ledger-observed and provider-reported quota
  | 'UNKNOWN';

// ── Priority tiers ────────────────────────────────────────────────────────────

export type PriorityTier = 'product-critical' | 'deferrable' | 'non-critical';

// ── Usage event (§11.2) ───────────────────────────────────────────────────────

export interface ApiUsageEvent {
  id: string;
  providerKey: ProviderKey;
  usageDateLocal: string; // YYYY-MM-DD in provider timezone
  unitType: 'REQUEST' | 'CREDIT' | 'TOKEN' | 'OTHER';
  usageUnits: number; // default 1
  consumerType: ConsumerType;
  consumerId: string | null;
  moduleKey: string;
  operationKey: string;
  requestMethod: 'GET' | 'POST';
  endpointTemplate: string; // URL path, no secret query params
  statusCode: number | null;
  success: boolean;
  rateLimited: boolean;
  cacheHit: boolean;
  startedAtUtc: string;
  finishedAtUtc: string;
  latencyMs: number;
  remoteLimit: number | null;
  remoteRemaining: number | null;
  remoteResetAtUtc: string | null;
  errorCode: string | null;
  errorClass: string | null;
  requestId: string | null;
  metadataJson: string | null; // JSON, no secrets
  createdAtUtc: string;
}

// ── Daily rollup (§11.3) ──────────────────────────────────────────────────────

export interface DailyRollup {
  providerKey: ProviderKey;
  usageDateLocal: string;
  consumerType: ConsumerType;
  usedUnits: number;
  successCount: number;
  errorCount: number;
  rateLimitedCount: number;
  cacheHitCount: number;
  lastRemoteLimit: number | null;
  lastRemoteRemaining: number | null;
  lastRemoteResetAtUtc: string | null;
  lastSeenAtUtc: string;
}

// ── Quota config (§11.1) ──────────────────────────────────────────────────────

export interface ProviderQuotaDefinition {
  providerKey: ProviderKey;
  displayName: string;
  unitType: 'REQUEST' | 'CREDIT' | 'TOKEN' | 'OTHER';
  dailyLimit: number; // 0 = unlimited
  monthlyLimit?: number; // 0 / undefined = no monthly quota enforced
  timezone: string; // e.g. 'UTC'
  warningThresholdPct: number; // e.g. 75
  criticalThresholdPct: number; // e.g. 90
  hardStopThresholdPct: number; // e.g. 95
  allowNoncriticalWhenLowQuota: boolean;
  brakeLiveThreshold: number; // AF-specific: throttle threshold (0 = disabled)
  isActive: boolean;
  notes: string | null;
}

// ── Warning level ─────────────────────────────────────────────────────────────

export type QuotaWarningLevel = 'NORMAL' | 'WARNING' | 'CRITICAL' | 'EXHAUSTED';
