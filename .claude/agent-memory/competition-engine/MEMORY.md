# Competition Engine Agent Memory

## Spec → Implementation Map

| Spec Section | Function | File |
|---|---|---|
| §5.2, §8.2 | `computeStandings()` | `competition/standings.ts` |
| §8.2 rank_by | `rankEntries()`, `applyH2HSort()` | `competition/standings.ts` |
| §5.2, §18.3 | `rankGroup()` | `competition/group-ranking.ts` |
| §18.3 | `computeBestThirds()` | `competition/group-ranking.ts` |
| §8.4, §18.2 | `resolveKnockout()` | `competition/knockout-resolver.ts` |
| §7.3 | SECOND_LEG guard in `resolveTwoLeg()` | `competition/knockout-resolver.ts` |
| §8.2, §8.3 | `mapToBracket()` | `competition/bracket-mapper.ts` |

## Key Architectural Decisions

### standings.ts
- `computeStandings(matches, teamIds, rules, drawOfLotsSeed?)` → `StandingsResult`
- teamIds must be passed explicitly to include teams with 0 matches played.
- H2H criteria require a pre-built h2hMap (pairwise) — multi-team H2H needs full match list.
- `computeH2HSubtable()` is exported for external multi-team H2H use.
- DRAW_LOT without seed → BLOCKED (status). With seed → deterministic hash of teamId+seed.
- Unplayed matches (null scores) are silently excluded — DEGRADED is signalled by rankGroup, not computeStandings itself.

### group-ranking.ts
- `rankGroup(group, rules, drawOfLotsSeed?)` delegates to `computeStandings`.
- `computeBestThirds` with unequal played matches → DEGRADED (not BLOCKED). §18.3 does not require BLOCKED for partial groups.
- Best-thirds sort: points → GD → GF → team_id lexicographic (deterministic fallback, no DRAW_LOT step in §18.3).

### knockout-resolver.ts
- `resolveKnockout(match, rules)` — `match` and `rules` are passed separately to allow reuse.
- FIRST_LEG always returns UNDECIDED (tie not complete).
- ET, PENALTIES, REPLAY, ORGANIZER_DEFINED all yield UNDECIDED (ORGANIZER_DEFINED_REQUIRED) — the engine does not model these outcomes; callers re-invoke after external results.
- The aggregate convention: `aggregate_state_before_match.home_aggregate_goals` = goals scored by the team playing AT HOME in leg 2 during leg 1 (they were away in leg 1).
- Away goals for home-in-leg2 team = `agg.home_aggregate_goals` (scored as away in leg 1).
- Away goals for away-in-leg2 team = `leg2.away_score` (scored as away in leg 2).

### bracket-mapper.ts
- Same-group matchup detection checks pairs by `matchN` slot_id prefix pattern.
- POSITION_SEEDED: seeded sorted by group_id+position, unseeded sorted by group_id+position. Index-matched pairs. If seeded[i] and unseeded[i] share group_id → BLOCKED.
- Real-world POSITION_SEEDED typically ensures cross-group pairing at competition level — this engine validates but does not re-arrange.
- THIRD_PLACE_DEPENDENT combination key = sorted group_ids of third-place qualifiers joined.

## Edge Cases Discovered

- **POSITION_SEEDED same-group pairing**: Natural group-alphabetical sort puts same-group winner + runner in pair 0. This is correctly BLOCKED. Tests must use cross-group qualifiers for RESOLVED path.
- **H2H multi-team**: 3+ team H2H sub-table requires the full match list. The current `applyH2HSort` handles 2-team pairs from pre-built h2hMap; 3+ teams are left in team_id order.
- **FAIR_PLAY criterion**: Cannot be computed from MatchResult alone (needs disciplinary data). Returns 0 (no differentiation). Not a runtime error — a ResolutionGap for callers who rely on it.
- **DRAW_LOT with seed**: Different seeds (1 vs 999999) may or may not produce different orders depending on hash collisions. Tests verify determinism per seed, not cross-seed uniqueness.

## ResolutionGap Patterns (frequent)

| Scenario | missingFields | specSection |
|---|---|---|
| DRAW_LOT, no seed | `['drawOfLotsSeed']` | `§8.2` |
| SECOND_LEG, no aggregate | `['aggregate_state_before_match']` | `§7.3` |
| THIRD_PLACE_DEPENDENT, no mapping_table | `['...bracket_mapping_definition.mapping_table']` | `§8.3` |
| THIRD_PLACE_DEPENDENT, key not in table | `['mapping_table[{key}]']` | `§18.3` |
| No bracket_mapping_definition | `['qualification_rules.bracket_mapping_definition']` | `§8.2` |
| Same-group matchup | `['same-group matchup: ...']` | `§5.2` |

## Package Info

- Package: `@sportpulse/prediction`
- Module type: ESM (`"type": "module"`)
- Competition module location: `packages/prediction/src/competition/`
- Tests: `packages/prediction/test/competition/`
- Phase 3 build: `pnpm --filter @sportpulse/prediction build` ✓
- Phase 3 tests: 248 passing ✓ (15 test files)
