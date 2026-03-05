import type { LayoutMetadata } from '@sportpulse/layout';
import type { SnapshotHeaderDTO, WarningDTO } from './snapshot-header.js';
import type { TeamScoreDTO } from './team-score.js';

export interface DashboardSnapshotDTO {
  header: SnapshotHeaderDTO;
  layout: LayoutMetadata;
  warnings: WarningDTO[];
  teams: TeamScoreDTO[];
}
