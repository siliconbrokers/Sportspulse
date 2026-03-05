// DTOs
export { SNAPSHOT_SCHEMA_VERSION } from './dto/snapshot-header.js';
export type { SnapshotHeaderDTO, WarningDTO } from './dto/snapshot-header.js';
export type { TeamScoreDTO, NextMatchDTO } from './dto/team-score.js';
export type { DashboardSnapshotDTO } from './dto/dashboard-snapshot.js';

// Warnings
export { WarningCollector } from './warnings/warning-collector.js';

// Identity
export { buildSnapshotKey, buildNowUtcFromDate } from './identity/snapshot-key.js';
export { assembleHeader } from './identity/assemble-header.js';
export type { AssembleHeaderInput } from './identity/assemble-header.js';

// Build pipeline
export { buildSnapshot } from './build/build-snapshot.js';
export type { BuildSnapshotInput } from './build/build-snapshot.js';
export { sortTeamsByWeight } from './build/sort-teams.js';

// Store
export type { SnapshotStore } from './store/snapshot-store.js';
export { InMemorySnapshotStore } from './store/snapshot-store.js';

// Service
export { SnapshotService, SnapshotBuildFailed } from './service/snapshot-service.js';
export type { SnapshotServiceConfig, ServeSnapshotInput, ServeResult } from './service/snapshot-service.js';

// Team detail projection
export type { TeamDetailDTO } from './dto/team-detail.js';
export { projectTeamDetail } from './project/team-detail.js';

// Data source interface
export type { DataSource } from './data/data-source.js';
