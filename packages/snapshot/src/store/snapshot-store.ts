import type { DashboardSnapshotDTO } from '../dto/dashboard-snapshot.js';

export interface SnapshotStore {
  get(key: string): DashboardSnapshotDTO | undefined;
  set(key: string, snapshot: DashboardSnapshotDTO): void;
  has(key: string): boolean;
}

export class InMemorySnapshotStore implements SnapshotStore {
  private readonly cache = new Map<string, DashboardSnapshotDTO>();

  get(key: string): DashboardSnapshotDTO | undefined {
    return this.cache.get(key);
  }

  set(key: string, snapshot: DashboardSnapshotDTO): void {
    this.cache.set(key, snapshot);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }
}
