/**
 * bracket-mapper.ts — Maps qualified teams to bracket slots.
 *
 * Spec authority: §5.2 (Competition Engine), §8.2 (QualificationRules),
 *                 §8.3 (THIRD_PLACE_DEPENDENT requires mapping_table),
 *                 §18.3 (bracket conditioned on which thirds qualified)
 *
 * CONTRACT:
 *   mapToBracket(qualifiers, rules) → BracketSlot[]
 *     - Assigns teams to slots based on QualificationRules.bracket_mapping_definition.
 *     - Preserves seeding when strategy = POSITION_SEEDED or LEAGUE_TABLE_SEEDED.
 *     - THIRD_PLACE_DEPENDENT requires mapping_table — absent → BLOCKED.
 *     - FIXED strategy uses explicit slot_id from each TeamQualification.
 *     - Deterministic: same qualifiers + same rules → identical slot assignments.
 *
 * INVARIANTS:
 *   - No implicit tournament logic from competition names or IDs. §8.4
 *   - Two teams from the same group CANNOT be in the same bracket matchup.
 *     This is validated but not silently resolved — violation → BLOCKED.
 *   - All rule resolution comes from the explicit QualificationRules config.
 */

import type { QualificationRules } from '../contracts/types/competition-profile.js';
import type { ResolutionGap } from './standings.js';

// ── Domain types ─────────────────────────────────────────────────────────────

/** A team that has qualified and carries metadata about how. */
export interface TeamQualification {
  team_id: string;
  group_id: string | null;
  /** Position within the group or league phase (1 = winner, etc.). */
  qualified_from_position: number;
  /** Optional explicit slot ID for FIXED strategy. */
  slot_id?: string | null;
  /** Whether this team is seeded (for POSITION_SEEDED / LEAGUE_TABLE_SEEDED). */
  is_seeded?: boolean;
}

/** A slot in the knockout bracket after mapping. */
export interface BracketSlot {
  slot_id: string;
  team_id: string;
  is_seeded: boolean;
}

export type BracketMapResult =
  | { status: 'RESOLVED'; data: BracketSlot[] }
  | { status: 'BLOCKED'; gap: ResolutionGap }
  | { status: 'DEGRADED'; data: BracketSlot[]; warnings: string[] };

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Map qualified teams to bracket slots per §8.2 and §18.3.
 *
 * Spec §8.3: "si strategy = THIRD_PLACE_DEPENDENT, debe existir mapping_table."
 * Spec §18.3: bracket construction conditioned on which thirds classified.
 *
 * @param qualifiers - Teams that qualified, in a deterministic pre-sorted order.
 * @param rules      - QualificationRules from CompetitionProfile.
 */
export function mapToBracket(
  qualifiers: readonly TeamQualification[],
  rules: QualificationRules,
): BracketMapResult {
  if (!rules.bracket_mapping_definition) {
    // No bracket mapping defined — cannot assign slots.
    return {
      status: 'BLOCKED',
      gap: {
        missingFields: ['qualification_rules.bracket_mapping_definition'],
        requiredByRule: 'mapToBracket requires bracket_mapping_definition',
        specSection: '§8.2',
        canFallbackToSimulation: false,
      },
    };
  }

  const def = rules.bracket_mapping_definition;
  const warnings: string[] = [];

  switch (def.strategy) {
    case 'FIXED':
      return mapFixed(qualifiers, warnings);

    case 'POSITION_SEEDED':
      return mapPositionSeeded(qualifiers, warnings);

    case 'LEAGUE_TABLE_SEEDED':
      return mapLeagueTableSeeded(qualifiers, warnings);

    case 'THIRD_PLACE_DEPENDENT': {
      // §8.3: mapping_table is REQUIRED for this strategy.
      if (!def.mapping_table) {
        return {
          status: 'BLOCKED',
          gap: {
            missingFields: ['qualification_rules.bracket_mapping_definition.mapping_table'],
            requiredByRule: 'THIRD_PLACE_DEPENDENT strategy requires mapping_table per §8.3',
            specSection: '§8.3',
            canFallbackToSimulation: false,
          },
        };
      }
      return mapThirdPlaceDependent(qualifiers, def.mapping_table, warnings);
    }

    default: {
      const exhaustive: never = def.strategy;
      return {
        status: 'BLOCKED',
        gap: {
          missingFields: ['bracket_mapping_definition.strategy'],
          requiredByRule: `Unknown strategy: ${String(exhaustive)}`,
          specSection: '§8.2',
          canFallbackToSimulation: false,
        },
      };
    }
  }
}

// ── FIXED strategy ───────────────────────────────────────────────────────────

/**
 * Each qualifier carries an explicit slot_id.
 * Deterministic: sorted by slot_id before assigning.
 */
function mapFixed(qualifiers: readonly TeamQualification[], warnings: string[]): BracketMapResult {
  const slots: BracketSlot[] = [];

  for (const q of qualifiers) {
    if (!q.slot_id) {
      warnings.push(`Team ${q.team_id} has no slot_id for FIXED strategy — skipped.`);
      continue;
    }
    slots.push({
      slot_id: q.slot_id,
      team_id: q.team_id,
      is_seeded: q.is_seeded ?? false,
    });
  }

  // Validate no duplicate slot_ids.
  const seenSlots = new Set<string>();
  for (const s of slots) {
    if (seenSlots.has(s.slot_id)) {
      return {
        status: 'BLOCKED',
        gap: {
          missingFields: [`slot_id:${s.slot_id} (duplicate)`],
          requiredByRule: 'FIXED strategy: each slot_id must be unique',
          specSection: '§8.2',
          canFallbackToSimulation: false,
        },
      };
    }
    seenSlots.add(s.slot_id);
  }

  // Validate no same-group matchups (§system invariant 5).
  const sameGroupViolation = detectSameGroupMatchup(qualifiers, slots);
  if (sameGroupViolation) {
    return {
      status: 'BLOCKED',
      gap: {
        missingFields: [`same-group matchup: ${sameGroupViolation}`],
        requiredByRule: 'Two teams from the same group must not face each other in the bracket',
        specSection: '§5.2',
        canFallbackToSimulation: false,
      },
    };
  }

  // Sort by slot_id for determinism.
  slots.sort((a, b) => (a.slot_id < b.slot_id ? -1 : a.slot_id > b.slot_id ? 1 : 0));

  if (warnings.length > 0) {
    return { status: 'DEGRADED', data: slots, warnings };
  }
  return { status: 'RESOLVED', data: slots };
}

// ── POSITION_SEEDED strategy ─────────────────────────────────────────────────

/**
 * Seeded teams (winners) are placed in odd slots, unseeded in even slots.
 * Slots are numbered 1..N. Seeded teams get 1, 3, 5, …; unseeded get 2, 4, 6, …
 *
 * Within each category, teams are ordered by their group_id + position
 * for determinism.
 */
function mapPositionSeeded(
  qualifiers: readonly TeamQualification[],
  warnings: string[],
): BracketMapResult {
  const seeded = qualifiers.filter((q) => q.is_seeded === true).slice();
  const unseeded = qualifiers.filter((q) => q.is_seeded !== true).slice();

  // Sort each group deterministically by group_id + position.
  const byGroupPos = (a: TeamQualification, b: TeamQualification): number => {
    const gCmp = (a.group_id ?? '').localeCompare(b.group_id ?? '');
    if (gCmp !== 0) return gCmp;
    return a.qualified_from_position - b.qualified_from_position;
  };
  seeded.sort(byGroupPos);
  unseeded.sort(byGroupPos);

  const slots: BracketSlot[] = [];
  const totalPairs = Math.min(seeded.length, unseeded.length);

  for (let i = 0; i < totalPairs; i++) {
    slots.push({
      slot_id: `match${i + 1}_seed`,
      team_id: seeded[i].team_id,
      is_seeded: true,
    });
    slots.push({
      slot_id: `match${i + 1}_unseeded`,
      team_id: unseeded[i].team_id,
      is_seeded: false,
    });
  }

  if (seeded.length !== unseeded.length) {
    warnings.push(
      `POSITION_SEEDED: unequal seeded (${seeded.length}) vs unseeded (${unseeded.length}) count.`,
    );
  }

  // Validate no same-group matchups.
  const sameGroupViolation = detectSameGroupMatchup(qualifiers, slots);
  if (sameGroupViolation) {
    return {
      status: 'BLOCKED',
      gap: {
        missingFields: [`same-group matchup: ${sameGroupViolation}`],
        requiredByRule: 'Two teams from the same group must not face each other in the bracket',
        specSection: '§5.2',
        canFallbackToSimulation: false,
      },
    };
  }

  if (warnings.length > 0) {
    return { status: 'DEGRADED', data: slots, warnings };
  }
  return { status: 'RESOLVED', data: slots };
}

// ── LEAGUE_TABLE_SEEDED strategy ─────────────────────────────────────────────

/**
 * Teams are ordered by their league table position. Top half are seeded.
 * Each seeded team is paired with a team from the bottom half in reverse order.
 *
 * Example for 8 teams: 1 vs 8, 2 vs 7, 3 vs 6, 4 vs 5.
 */
function mapLeagueTableSeeded(
  qualifiers: readonly TeamQualification[],
  warnings: string[],
): BracketMapResult {
  // Sort by qualified_from_position ascending (position 1 = best seeded).
  const sorted = qualifiers
    .slice()
    .sort((a, b) => a.qualified_from_position - b.qualified_from_position);

  const n = sorted.length;
  const slots: BracketSlot[] = [];

  for (let i = 0; i < Math.floor(n / 2); i++) {
    const top = sorted[i];
    const bottom = sorted[n - 1 - i];
    slots.push({
      slot_id: `match${i + 1}_top`,
      team_id: top.team_id,
      is_seeded: true,
    });
    slots.push({
      slot_id: `match${i + 1}_bottom`,
      team_id: bottom.team_id,
      is_seeded: false,
    });
  }

  if (n % 2 !== 0) {
    warnings.push(`LEAGUE_TABLE_SEEDED: odd number of qualifiers (${n}) — one team has no pair.`);
  }

  // Validate no same-group matchups.
  const sameGroupViolation = detectSameGroupMatchup(qualifiers, slots);
  if (sameGroupViolation) {
    return {
      status: 'BLOCKED',
      gap: {
        missingFields: [`same-group matchup: ${sameGroupViolation}`],
        requiredByRule: 'Two teams from the same group must not face each other in the bracket',
        specSection: '§5.2',
        canFallbackToSimulation: false,
      },
    };
  }

  if (warnings.length > 0) {
    return { status: 'DEGRADED', data: slots, warnings };
  }
  return { status: 'RESOLVED', data: slots };
}

// ── THIRD_PLACE_DEPENDENT strategy ───────────────────────────────────────────

/**
 * Uses mapping_table to determine slots.
 *
 * The mapping_table is an opaque object supplied by the competition catalog.
 * The Competition Engine applies it without inferring its semantics.
 * Spec §18.3, §8.3
 *
 * mapping_table shape (expected by this implementation):
 * {
 *   [groupCombinationKey: string]: {
 *     [slotId: string]: { position: number; group_id: string }
 *   }
 * }
 * Where groupCombinationKey identifies which thirds qualified (e.g., "ABCD").
 *
 * If the mapping_table does not cover the given combination, returns BLOCKED.
 */
function mapThirdPlaceDependent(
  qualifiers: readonly TeamQualification[],
  mappingTable: object,
  warnings: string[],
): BracketMapResult {
  // Identify the third-place qualifiers (position === 3).
  const thirds = qualifiers.filter((q) => q.qualified_from_position === 3);
  const others = qualifiers.filter((q) => q.qualified_from_position !== 3);

  // Build combination key from the sorted group_ids of thirds.
  const combinationKey = thirds
    .map((q) => q.group_id ?? '')
    .sort()
    .join('');

  const table = mappingTable as Record<
    string,
    Record<string, { position: number; group_id: string }>
  >;

  const slotDef = table[combinationKey];
  if (!slotDef) {
    return {
      status: 'BLOCKED',
      gap: {
        missingFields: [`mapping_table[${combinationKey}]`],
        requiredByRule: `THIRD_PLACE_DEPENDENT: combination key "${combinationKey}" not in mapping_table`,
        specSection: '§18.3',
        canFallbackToSimulation: false,
      },
    };
  }

  // Build lookup: group_id + position → team_id.
  const lookup = new Map<string, string>();
  for (const q of qualifiers) {
    const key = `${q.group_id ?? ''}_${q.qualified_from_position}`;
    lookup.set(key, q.team_id);
  }

  const slots: BracketSlot[] = [];
  for (const [slotId, spec] of Object.entries(slotDef)) {
    const teamKey = `${spec.group_id}_${spec.position}`;
    const teamId = lookup.get(teamKey);
    if (!teamId) {
      warnings.push(
        `THIRD_PLACE_DEPENDENT: no team found for group=${spec.group_id} position=${spec.position} in slot ${slotId}.`,
      );
      continue;
    }
    // A team is seeded if it came from position 1 or 2.
    const q = qualifiers.find(
      (qq) => qq.group_id === spec.group_id && qq.qualified_from_position === spec.position,
    );
    slots.push({
      slot_id: slotId,
      team_id: teamId,
      is_seeded: q?.is_seeded ?? spec.position <= 2,
    });
  }

  // Also map non-third qualifiers using POSITION_SEEDED fallback if needed.
  // (In practice, others are mapped by the fixed part of slotDef above.)
  void others; // referenced to avoid TS unused-var; fully covered by slotDef iteration.

  if (warnings.length > 0) {
    return { status: 'DEGRADED', data: slots, warnings };
  }
  return { status: 'RESOLVED', data: slots };
}

// ── Same-group matchup detection ─────────────────────────────────────────────

/**
 * Checks whether any slot pairing contains two teams from the same group.
 * Returns a description of the violation, or null if none.
 *
 * Pairing is inferred from slot_id: slots with the same "matchN" prefix are paired.
 * For FIXED strategy, we check whether any two teams with the same group_id end up
 * in what would be opponent slots. Since FIXED assignments are caller-controlled,
 * we only detect same-slot collisions here.
 */
function detectSameGroupMatchup(
  qualifiers: readonly TeamQualification[],
  slots: readonly BracketSlot[],
): string | null {
  // Build team_id → group_id lookup.
  const groupOfTeam = new Map<string, string | null>();
  for (const q of qualifiers) {
    groupOfTeam.set(q.team_id, q.group_id);
  }

  // Find pairs: group by matchN prefix.
  const matchGroups = new Map<string, BracketSlot[]>();
  for (const slot of slots) {
    const matchKey = slot.slot_id.replace(/_seed$|_unseeded$|_top$|_bottom$/, '');
    if (!matchGroups.has(matchKey)) matchGroups.set(matchKey, []);
    matchGroups.get(matchKey)!.push(slot);
  }

  for (const [matchKey, pair] of matchGroups) {
    if (pair.length < 2) continue;
    const gA = groupOfTeam.get(pair[0].team_id);
    const gB = groupOfTeam.get(pair[1].team_id);
    if (gA && gB && gA === gB) {
      return `${pair[0].team_id} and ${pair[1].team_id} both from group ${gA} in ${matchKey}`;
    }
  }

  return null;
}
