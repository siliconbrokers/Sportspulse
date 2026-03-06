import type { Team, Match } from '@sportpulse/canonical';
import type { PolicyDefinition } from '@sportpulse/scoring';
import type { TreemapContainer, TreemapInput } from '@sportpulse/layout';
import {
  squarify,
  isAllZeroWeights,
  LAYOUT_ALGORITHM_KEY,
  LAYOUT_ALGORITHM_VERSION,
} from '@sportpulse/layout';
import type { DashboardSnapshotDTO } from '../dto/dashboard-snapshot.js';
import type { TeamScoreDTO } from '../dto/team-score.js';
import { assembleHeader } from '../identity/assemble-header.js';
import { WarningCollector } from '../warnings/warning-collector.js';
import { buildTeamTile } from './team-tile-builder.js';
import { sortTeamsByWeight } from './sort-teams.js';
import { DISPLAY_RULES, mapDisplayHints } from '../display-hints/display-hints-mapper.js';
import { buildMatchCards } from '../display-hints/match-card-builder.js';

export interface BuildSnapshotInput {
  competitionId: string;
  seasonId: string;
  buildNowUtc: string;
  timezone: string;
  teams: readonly Team[];
  matches: readonly Match[];
  policy: PolicyDefinition;
  container: TreemapContainer;
  freshnessUtc?: string;
  matchday?: number;
}

export function buildSnapshot(input: BuildSnapshotInput): DashboardSnapshotDTO {
  const warnings = new WarningCollector();

  // Step 1: Build tiles for each team (signals + scoring)
  const tilesWithoutRect = input.teams.map((team) =>
    buildTeamTile(
      team,
      input.teams,
      input.matches,
      input.buildNowUtc,
      input.policy,
      warnings,
      input.matchday,
    ),
  );

  // Step 2: Sort by layoutWeight desc, teamId asc
  const sorted = [...tilesWithoutRect].sort((a, b) => {
    if (b.layoutWeight !== a.layoutWeight) return b.layoutWeight - a.layoutWeight;
    return a.teamId.localeCompare(b.teamId);
  });

  // Step 3: Build treemap inputs with minimum weight floor for visual readability.
  // No tile should receive less than MIN_FLOOR_FACTOR * avgWeight so low-score
  // teams still render as legible tiles. The original layoutWeight in TeamScoreDTO
  // is preserved — only the geometry calculation uses the floored value.
  const MIN_FLOOR_FACTOR = 0.35;
  const totalWeight = sorted.reduce((sum, t) => sum + t.layoutWeight, 0);
  const avgWeight = totalWeight / (sorted.length || 1);
  const minFloorWeight = avgWeight * MIN_FLOOR_FACTOR;

  const treemapInputs: TreemapInput[] = sorted.map((t) => ({
    entityId: t.teamId,
    layoutWeight: Math.max(t.layoutWeight, minFloorWeight),
  }));

  // Step 4: Detect all-zero weights
  if (isAllZeroWeights(treemapInputs)) {
    warnings.layoutDegraded();
  }

  // Step 5: Generate geometry
  const tiles = squarify(treemapInputs, input.container);
  const rectMap = new Map(tiles.map((t) => [t.entityId, t.rect]));

  // Step 6: Merge scoring + geometry + display hints into TeamScoreDTOs
  const teamScores: TeamScoreDTO[] = sorted.map((t) => ({
    ...t,
    rect: rectMap.get(t.teamId) ?? { x: 0, y: 0, w: 0, h: 0 },
    displayHints: mapDisplayHints(t.signals ?? []),
  }));

  // Step 7: Build match cards (§8 display-hints-spec-v1.1)
  const matchCards = buildMatchCards(
    input.matches,
    input.teams,
    teamScores,
    input.buildNowUtc,
    input.matchday,
  );

  // Step 8: Assemble header
  const header = assembleHeader({
    competitionId: input.competitionId,
    seasonId: input.seasonId,
    buildNowUtc: input.buildNowUtc,
    timezone: input.timezone,
    policyKey: input.policy.policyKey,
    policyVersion: input.policy.policyVersion,
    freshnessUtc: input.freshnessUtc,
    matchday: input.matchday,
  });

  return {
    header,
    layout: {
      algorithmKey: LAYOUT_ALGORITHM_KEY,
      algorithmVersion: LAYOUT_ALGORITHM_VERSION,
      container: input.container,
    },
    warnings: warnings.toArray(),
    displayRules: DISPLAY_RULES,
    teams: teamScores,
    matchCards,
  };
}
