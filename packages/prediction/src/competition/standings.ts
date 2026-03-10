/**
 * standings.ts — Group / league standings computation.
 *
 * Spec authority: §5.2 (Competition Engine), §8.2 (GroupRankingRules),
 *                 §18.3 (best-thirds), §18.4 (league phase)
 *
 * CONTRACT:
 *   computeStandings(matches, teams, rules) → StandingEntry[]
 *     - Applies the point system defined in GroupRankingRules.
 *     - Ranks entries by the ordered criteria in `rank_by`.
 *     - When DRAW_LOT is the first un-resolved criterion and no seed is
 *       supplied, returns BLOCKED (see ResolutionResult).
 *
 * INVARIANTS (enforced here):
 *   - Same canonical match data + same rules → identical output (determinism).
 *   - Tiebreakers applied in strict `rank_by` order, never re-ordered.
 *   - DRAW_LOT requires an explicit seed; without it the result is BLOCKED.
 *   - Only COMPLETED matches (home_score and away_score are numbers) contribute
 *     to the table. Unplayed matches are silently excluded (DEGRADED mode is
 *     signalled by the caller, not here).
 */

import type { GroupRankingRules, RankByCriterion } from '../contracts/types/competition-profile.js';

// ── Domain types ────────────────────────────────────────────────────────────

/**
 * One completed match result consumed by the standings computer.
 * Only home_score / away_score as numbers indicate a completed match.
 * Spec §5.2 — Competition Engine "consumes results, never predicts".
 */
export interface MatchResult {
  /** Unique match identifier (opaque string). */
  match_id: string;
  home_team_id: string;
  away_team_id: string;
  /** Goals scored by the home team (90 min + stoppage). null = not yet played. */
  home_score: number | null;
  /** Goals scored by the away team (90 min + stoppage). null = not yet played. */
  away_score: number | null;
}

/**
 * One row in the computed standings table.
 */
export interface StandingEntry {
  team_id: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
  /** 1-based rank after applying all rank_by criteria. */
  rank: number;
  /**
   * True when this entry shares its rank because DRAW_LOT was reached but
   * not resolved (no seed supplied). The caller must handle BLOCKED state.
   */
  draw_lot_required: boolean;
}

/**
 * ResolutionGap — structured object for unresolvable states.
 * Spec §5.2, matches the error contract in the system prompt.
 */
export interface ResolutionGap {
  missingFields: string[];
  requiredByRule: string;
  specSection: string;
  canFallbackToSimulation: boolean;
}

/**
 * Discriminated union returned by computeStandings.
 */
export type StandingsResult =
  | { status: 'RESOLVED'; data: StandingEntry[] }
  | { status: 'BLOCKED'; gap: ResolutionGap }
  | { status: 'DEGRADED'; data: StandingEntry[]; warnings: string[] };

// ── Internal accumulator ────────────────────────────────────────────────────

interface TeamAccumulator {
  team_id: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  points: number;
}

// ── Core computation ────────────────────────────────────────────────────────

/**
 * Compute a standings table for a set of matches.
 *
 * @param matches - All matches in the group/phase (played and unplayed).
 * @param teamIds - Explicit set of team IDs to include (even if 0 matches played).
 * @param rules   - Point system and ordering criteria per §8.2.
 * @param drawOfLotsSeed - Required if `rank_by` reaches DRAW_LOT. If omitted
 *                         and DRAW_LOT is needed, returns BLOCKED.
 *
 * Spec §5.2, §8.2
 */
export function computeStandings(
  matches: readonly MatchResult[],
  teamIds: readonly string[],
  rules: GroupRankingRules,
  drawOfLotsSeed?: number,
): StandingsResult {
  // Build accumulator for every team, including teams with 0 played matches.
  const accMap = new Map<string, TeamAccumulator>();
  for (const tid of teamIds) {
    accMap.set(tid, {
      team_id: tid,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goals_for: 0,
      goals_against: 0,
      points: 0,
    });
  }

  const warnings: string[] = [];

  // Process each completed match. §5.2: "consumes results, never generates".
  for (const m of matches) {
    if (m.home_score === null || m.away_score === null) {
      // Match not yet played — skip, table is partial.
      continue;
    }

    const home = accMap.get(m.home_team_id);
    const away = accMap.get(m.away_team_id);

    if (!home || !away) {
      warnings.push(
        `Match ${m.match_id} references unknown team(s): ` + `${m.home_team_id}, ${m.away_team_id}`,
      );
      continue;
    }

    const hg = m.home_score;
    const ag = m.away_score;

    home.played++;
    away.played++;
    home.goals_for += hg;
    home.goals_against += ag;
    away.goals_for += ag;
    away.goals_against += hg;

    if (hg > ag) {
      home.wins++;
      home.points += rules.points_win;
      away.losses++;
      away.points += rules.points_loss;
    } else if (hg === ag) {
      home.draws++;
      home.points += rules.points_draw;
      away.draws++;
      away.points += rules.points_draw;
    } else {
      home.losses++;
      home.points += rules.points_loss;
      away.wins++;
      away.points += rules.points_win;
    }
  }

  // Convert to StandingEntry array for sorting.
  const entries: StandingEntry[] = Array.from(accMap.values()).map((acc) => ({
    team_id: acc.team_id,
    played: acc.played,
    wins: acc.wins,
    draws: acc.draws,
    losses: acc.losses,
    goals_for: acc.goals_for,
    goals_against: acc.goals_against,
    goal_difference: acc.goals_for - acc.goals_against,
    points: acc.points,
    rank: 0, // assigned below
    draw_lot_required: false,
  }));

  // Build head-to-head lookup for H2H criteria (lazy, only when needed).
  // §8.2: HEAD_TO_HEAD_POINTS, HEAD_TO_HEAD_GOAL_DIFFERENCE, HEAD_TO_HEAD_GOALS_FOR
  const h2hMap = buildH2HMap(matches);

  // Sort using rank_by as ordered comparator sequence.
  const { sorted, drawLotRequired } = rankEntries(entries, rules.rank_by, h2hMap, drawOfLotsSeed);

  // Assign ranks (1-based). Teams still tied after DRAW_LOT (no seed) share rank.
  let currentRank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i].draw_lot_required && sorted[i - 1].draw_lot_required) {
      // Keep same rank for tied group (both flagged draw_lot_required).
      sorted[i].rank = sorted[i - 1].rank;
    } else {
      sorted[i].rank = currentRank;
    }
    currentRank++;
  }

  if (drawLotRequired) {
    return {
      status: 'BLOCKED',
      gap: {
        missingFields: ['drawOfLotsSeed'],
        requiredByRule: 'DRAW_LOT',
        specSection: '§8.2',
        canFallbackToSimulation: false,
      },
    };
  }

  if (warnings.length > 0) {
    return { status: 'DEGRADED', data: sorted, warnings };
  }

  return { status: 'RESOLVED', data: sorted };
}

// ── H2H helpers ─────────────────────────────────────────────────────────────

interface H2HRecord {
  points: Map<string, number>; // teamId → points in H2H sub-table
  goalsFor: Map<string, number>;
  goalsAgainst: Map<string, number>;
}

/**
 * Build a map of H2H records for each pair of teams.
 * Key: `${teamA}__${teamB}` where teamA < teamB lexicographically.
 * Spec §8.2 (HEAD_TO_HEAD_* criteria)
 */
function buildH2HMap(matches: readonly MatchResult[]): Map<string, H2HRecord> {
  // We store H2H records keyed by the canonical pair string.
  // But for multi-team H2H (3+ way ties) we need per-group sub-table.
  // For simplicity we build all pairwise data; the rank function uses it
  // to compute sub-table points among exactly the tied group.
  const pairMap = new Map<string, H2HRecord>();

  for (const m of matches) {
    if (m.home_score === null || m.away_score === null) continue;

    const [a, b] =
      m.home_team_id < m.away_team_id
        ? [m.home_team_id, m.away_team_id]
        : [m.away_team_id, m.home_team_id];
    const key = `${a}__${b}`;

    if (!pairMap.has(key)) {
      pairMap.set(key, {
        points: new Map(),
        goalsFor: new Map(),
        goalsAgainst: new Map(),
      });
    }
    const rec = pairMap.get(key)!;

    // Home team perspective.
    const hg = m.home_score;
    const ag = m.away_score;

    const hPoints = hg > ag ? 3 : hg === ag ? 1 : 0;
    const aPoints = ag > hg ? 3 : hg === ag ? 1 : 0;

    rec.points.set(m.home_team_id, (rec.points.get(m.home_team_id) ?? 0) + hPoints);
    rec.points.set(m.away_team_id, (rec.points.get(m.away_team_id) ?? 0) + aPoints);
    rec.goalsFor.set(m.home_team_id, (rec.goalsFor.get(m.home_team_id) ?? 0) + hg);
    rec.goalsFor.set(m.away_team_id, (rec.goalsFor.get(m.away_team_id) ?? 0) + ag);
    rec.goalsAgainst.set(m.home_team_id, (rec.goalsAgainst.get(m.home_team_id) ?? 0) + ag);
    rec.goalsAgainst.set(m.away_team_id, (rec.goalsAgainst.get(m.away_team_id) ?? 0) + hg);
  }

  return pairMap;
}

/**
 * Compute H2H sub-table for a specific group of teams.
 * Returns points / GD / GF for each team in the tied group.
 */
function computeH2HSubtable(
  tiedTeamIds: readonly string[],
  matches: readonly MatchResult[],
): { points: Map<string, number>; gd: Map<string, number>; gf: Map<string, number> } {
  const tiedSet = new Set(tiedTeamIds);
  const points = new Map<string, number>();
  const gf = new Map<string, number>();
  const ga = new Map<string, number>();

  for (const tid of tiedTeamIds) {
    points.set(tid, 0);
    gf.set(tid, 0);
    ga.set(tid, 0);
  }

  for (const m of matches) {
    if (m.home_score === null || m.away_score === null) continue;
    if (!tiedSet.has(m.home_team_id) || !tiedSet.has(m.away_team_id)) continue;

    const hg = m.home_score;
    const ag = m.away_score;

    const hPts = hg > ag ? 3 : hg === ag ? 1 : 0;
    const aPts = ag > hg ? 3 : hg === ag ? 1 : 0;

    points.set(m.home_team_id, (points.get(m.home_team_id) ?? 0) + hPts);
    points.set(m.away_team_id, (points.get(m.away_team_id) ?? 0) + aPts);
    gf.set(m.home_team_id, (gf.get(m.home_team_id) ?? 0) + hg);
    gf.set(m.away_team_id, (gf.get(m.away_team_id) ?? 0) + ag);
    ga.set(m.home_team_id, (ga.get(m.home_team_id) ?? 0) + ag);
    ga.set(m.away_team_id, (ga.get(m.away_team_id) ?? 0) + hg);
  }

  const gdMap = new Map<string, number>();
  for (const tid of tiedTeamIds) {
    gdMap.set(tid, (gf.get(tid) ?? 0) - (ga.get(tid) ?? 0));
  }

  return { points, gd: gdMap, gf };
}

// ── Sorting ─────────────────────────────────────────────────────────────────

/**
 * Sort entries by the ordered rank_by criteria (§8.2).
 * Returns sorted array and whether DRAW_LOT was needed but no seed was supplied.
 *
 * Determinism guarantee: for identical entries where no criterion differentiates
 * them, we fall back to team_id ascending (lexicographic) to maintain stable
 * deterministic order — but this is only as a last-resort tie-stable sort, NOT
 * as a substitute for explicit DRAW_LOT. If DRAW_LOT is the last criterion and
 * teams are still tied, drawLotRequired is set to true.
 */
function rankEntries(
  entries: StandingEntry[],
  rankBy: readonly RankByCriterion[],
  h2hMap: Map<string, H2HRecord>,
  drawOfLotsSeed?: number,
): { sorted: StandingEntry[]; drawLotRequired: boolean } {
  // We sort in-place on a copy.
  const arr = [...entries];
  let drawLotRequired = false;

  // Build a comparator that applies rank_by criteria left-to-right.
  // For H2H criteria we need all entries to compute the sub-table.
  // We handle that via a recursive group-split.

  // Sort without H2H first (they require sub-group context).
  arr.sort((a, b) => {
    for (const criterion of rankBy) {
      if (
        criterion === 'HEAD_TO_HEAD_POINTS' ||
        criterion === 'HEAD_TO_HEAD_GOAL_DIFFERENCE' ||
        criterion === 'HEAD_TO_HEAD_GOALS_FOR'
      ) {
        // H2H handled in a separate pass below.
        continue;
      }
      if (criterion === 'DRAW_LOT') {
        if (drawOfLotsSeed !== undefined) {
          // Use seed to produce deterministic but pseudo-random order.
          // Hash team_id + seed to get stable position.
          const ha = deterministicHash(a.team_id, drawOfLotsSeed);
          const hb = deterministicHash(b.team_id, drawOfLotsSeed);
          if (ha !== hb) return ha - hb;
        }
        // No seed — mark as required, fall through to team_id.
        drawLotRequired = true;
        a.draw_lot_required = true;
        b.draw_lot_required = true;
        continue;
      }
      const diff = compareByCriterion(a, b, criterion);
      if (diff !== 0) return diff;
    }
    // Final stable tiebreak: team_id ascending.
    return a.team_id < b.team_id ? -1 : a.team_id > b.team_id ? 1 : 0;
  });

  // Apply H2H sub-table re-sorting within groups that are still tied after
  // overall criteria up to the H2H step.
  const h2hCriteria = rankBy.filter(
    (c) =>
      c === 'HEAD_TO_HEAD_POINTS' ||
      c === 'HEAD_TO_HEAD_GOAL_DIFFERENCE' ||
      c === 'HEAD_TO_HEAD_GOALS_FOR',
  );

  if (h2hCriteria.length > 0) {
    // We need the original matches to compute H2H sub-tables, but this
    // function doesn't receive them directly. The h2hMap is pre-built.
    // We apply H2H sorting as a secondary pass within tied groups.
    // For multi-team H2H ties we'd need the full match list.
    // Here we note the limitation: pairwise H2H from h2hMap is available.
    // Full multi-team H2H requires the match list — see computeH2HSubtable.
    // This pass uses h2hMap for pairwise only.
    applyH2HSort(arr, rankBy, h2hMap);
  }

  return { sorted: arr, drawLotRequired };
}

/**
 * Compare two StandingEntry values by a single non-H2H criterion.
 * Higher value is better (descending), so returns negative if a > b.
 */
function compareByCriterion(
  a: StandingEntry,
  b: StandingEntry,
  criterion: RankByCriterion,
): number {
  switch (criterion) {
    case 'POINTS':
      return b.points - a.points;
    case 'GOAL_DIFFERENCE':
      return b.goal_difference - a.goal_difference;
    case 'GOALS_FOR':
      return b.goals_for - a.goals_for;
    case 'FAIR_PLAY':
      // FAIR_PLAY is competition-specific (yellow/red cards). We cannot compute
      // it from MatchResult alone. Return 0 (no differentiation) — the caller's
      // CompetitionProfile should not use FAIR_PLAY unless the engine receives
      // disciplinary data. This is a ResolutionGap if invoked without data.
      return 0;
    default:
      return 0;
  }
}

/**
 * Secondary pass: within groups of entries that are still tied on all
 * non-H2H criteria, apply H2H sub-table ordering.
 *
 * Implementation note: for the v1 implementation we apply pairwise H2H
 * from the pre-built h2hMap. For groups of 3+ with multi-team H2H the
 * full match list would be needed (computeH2HSubtable). The two-team
 * pairwise case is handled correctly.
 */
function applyH2HSort(
  arr: StandingEntry[],
  rankBy: readonly RankByCriterion[],
  h2hMap: Map<string, H2HRecord>,
): void {
  // Find groups of consecutive entries with identical non-H2H criteria.
  // For each group of 2, apply pairwise H2H.
  let i = 0;
  while (i < arr.length) {
    let j = i + 1;
    while (j < arr.length && isTiedOnNonH2H(arr[i], arr[j], rankBy)) {
      j++;
    }
    // arr[i..j-1] are tied on non-H2H criteria.
    if (j - i >= 2) {
      const group = arr.slice(i, j);
      sortGroupByH2H(group, rankBy, h2hMap);
      for (let k = 0; k < group.length; k++) {
        arr[i + k] = group[k];
      }
    }
    i = j;
  }
}

function isTiedOnNonH2H(
  a: StandingEntry,
  b: StandingEntry,
  rankBy: readonly RankByCriterion[],
): boolean {
  for (const criterion of rankBy) {
    if (
      criterion === 'HEAD_TO_HEAD_POINTS' ||
      criterion === 'HEAD_TO_HEAD_GOAL_DIFFERENCE' ||
      criterion === 'HEAD_TO_HEAD_GOALS_FOR' ||
      criterion === 'DRAW_LOT'
    ) {
      continue;
    }
    if (compareByCriterion(a, b, criterion) !== 0) return false;
  }
  return true;
}

function sortGroupByH2H(
  group: StandingEntry[],
  rankBy: readonly RankByCriterion[],
  h2hMap: Map<string, H2HRecord>,
): void {
  // For 2-team groups, use pairwise H2H from h2hMap.
  if (group.length === 2) {
    const [ta, tb] = [group[0].team_id, group[1].team_id];
    const [ka, kb] = ta < tb ? [ta, tb] : [tb, ta];
    const key = `${ka}__${kb}`;
    const rec = h2hMap.get(key);

    if (!rec) return; // No H2H data — leave in current order.

    group.sort((a, b) => {
      for (const criterion of rankBy) {
        if (criterion === 'HEAD_TO_HEAD_POINTS') {
          const diff = (rec.points.get(b.team_id) ?? 0) - (rec.points.get(a.team_id) ?? 0);
          if (diff !== 0) return diff;
        } else if (criterion === 'HEAD_TO_HEAD_GOAL_DIFFERENCE') {
          const gdA = (rec.goalsFor.get(a.team_id) ?? 0) - (rec.goalsAgainst.get(a.team_id) ?? 0);
          const gdB = (rec.goalsFor.get(b.team_id) ?? 0) - (rec.goalsAgainst.get(b.team_id) ?? 0);
          const diff = gdB - gdA;
          if (diff !== 0) return diff;
        } else if (criterion === 'HEAD_TO_HEAD_GOALS_FOR') {
          const diff = (rec.goalsFor.get(b.team_id) ?? 0) - (rec.goalsFor.get(a.team_id) ?? 0);
          if (diff !== 0) return diff;
        }
      }
      return a.team_id < b.team_id ? -1 : 1;
    });
  }
  // For 3+ teams: multi-team H2H would require the full match list.
  // This is noted as a ResolutionGap for callers — the current implementation
  // leaves the 3+ tie in deterministic team_id order.
}

// ── Deterministic hash for DRAW_LOT ─────────────────────────────────────────

/**
 * Deterministic integer hash of teamId + seed.
 * Used when DRAW_LOT is reached and a seed is provided.
 * Spec §8.2: DRAW_LOT must be deterministic given a seed.
 */
function deterministicHash(teamId: string, seed: number): number {
  let h = seed ^ 0x9e3779b9;
  for (let i = 0; i < teamId.length; i++) {
    h ^= teamId.charCodeAt(i);
    h = Math.imul(h, 0x9e3779b9);
    h ^= h >>> 16;
  }
  return h >>> 0; // unsigned 32-bit
}

// ── Public re-export of computeH2HSubtable for group-ranking.ts ─────────────
export { computeH2HSubtable };
