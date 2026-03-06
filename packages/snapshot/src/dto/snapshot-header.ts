export const SNAPSHOT_SCHEMA_VERSION = 2;

export interface SnapshotHeaderDTO {
  snapshotSchemaVersion: number;
  competitionId: string;
  seasonId: string;
  buildNowUtc: string;
  timezone: string;
  policyKey: string;
  policyVersion: number;
  computedAtUtc: string;
  freshnessUtc?: string;
  snapshotKey?: string;
}

export interface WarningDTO {
  code: string;
  severity: 'INFO' | 'WARN' | 'ERROR';
  message?: string | null;
  entityId?: string;
}
