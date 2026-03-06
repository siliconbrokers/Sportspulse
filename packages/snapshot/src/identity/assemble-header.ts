import type { SnapshotHeaderDTO } from '../dto/snapshot-header.js';
import { SNAPSHOT_SCHEMA_VERSION } from '../dto/snapshot-header.js';
import { buildSnapshotKey } from './snapshot-key.js';

export interface AssembleHeaderInput {
  competitionId: string;
  seasonId: string;
  buildNowUtc: string;
  timezone: string;
  policyKey: string;
  policyVersion: number;
  freshnessUtc?: string;
  matchday?: number;
}

export function assembleHeader(input: AssembleHeaderInput): SnapshotHeaderDTO {
  const snapshotKey = buildSnapshotKey(
    input.competitionId,
    input.seasonId,
    input.buildNowUtc,
    input.policyKey,
    input.policyVersion,
    input.matchday,
  );

  return {
    snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
    competitionId: input.competitionId,
    seasonId: input.seasonId,
    buildNowUtc: input.buildNowUtc,
    timezone: input.timezone,
    policyKey: input.policyKey,
    policyVersion: input.policyVersion,
    computedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    freshnessUtc: input.freshnessUtc,
    snapshotKey,
  };
}
