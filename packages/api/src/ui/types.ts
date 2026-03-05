import type { SnapshotService, DataSource } from '@sportpulse/snapshot';

export interface AppDependencies {
  snapshotService: SnapshotService;
  dataSource: DataSource;
}
