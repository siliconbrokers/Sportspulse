# Plan: SP-0902 — Golden Fixture Runner

## Spec refs
- Golden_Snapshot_Fixtures_v1.0.md §9 (comparison rules), §5 (comparison layers)
- Acceptance_Test_Matrix §I-01 (golden snapshot e2e)

## Design decisions

### Runner approach
A vitest test file that:
1. Reads each fixture directory
2. Loads input.canonical.json + context.json
3. Runs buildSnapshot with those inputs
4. Compares output against expected.snapshot.json
5. Reports differences at semantic, contract, and geometry layers

### Comparison strategy (per spec §9)

**Semantic comparison:**
- Team ordering matches expected
- Signal values match (key, normalized, missing, params)
- Score fields match (rawScore, attentionScore, displayScore, layoutWeight)
- Warning codes and severity match
- Policy identity fields match

**Contract comparison:**
- All required DTO fields present
- Field types correct
- No unexpected nulls in required fields

**Geometry comparison:**
- All rect values match expected
- Container metadata matches
- No overlap / bounds validation

### Excluded from comparison
- `computedAtUtc` (varies per run)
- `freshnessUtc` (optional)
- Warning message text (only code + severity required)

### Runner implementation
```ts
function runGoldenFixture(fixturePath: string) {
  const input = JSON.parse(readFileSync(join(fixturePath, 'input.canonical.json')));
  const context = JSON.parse(readFileSync(join(fixturePath, 'context.json')));

  const snapshot = buildSnapshot({
    competitionId: context.competitionId,
    seasonId: context.seasonId,
    buildNowUtc: context.buildNowUtc,
    timezone: context.timezone,
    teams: input.teams,
    matches: input.matches,
    policy: MVP_POLICY,
    container: context.layout.container,
  });

  const expected = JSON.parse(readFileSync(join(fixturePath, 'expected.snapshot.json')));

  // Compare (excluding computedAtUtc)
  assertSemanticMatch(snapshot, expected);
  assertContractMatch(snapshot, expected);
  assertGeometryMatch(snapshot, expected);
}
```

### Generate mode
Add a `--update-golden` flag or separate script that regenerates expected outputs:
```
tools/scripts/update-golden-fixtures.ts
```
This script runs buildSnapshot for each fixture and writes expected.snapshot.json + expected.signals.json. Used ONLY when intentionally updating fixtures per spec §10 update discipline.

## Files to create
1. `tools/fixtures/golden-runner.test.ts` — Main runner test (runs all 6 fixtures)
2. `tools/fixtures/lib/compare.ts` — Comparison helper functions
3. `tools/scripts/update-golden-fixtures.ts` — Expected output generator

## Tests (mapped to acceptance)
- I-01: Golden snapshot end-to-end for each fixture
- Diff is empty unless explicitly versioned

## Implementation notes for Sonnet
- Use `readdirSync` to discover fixture directories
- Skip F5 (stale fallback) in the standard runner — it needs special setup
- For F5: separate test that pre-populates cache, simulates failure, verifies stale serve
- Comparison functions: use deep equality with specific exclusion paths
- On failure: log which layer failed (semantic/contract/geometry) and show diff
- Place runner test in tools/fixtures/ not in packages/ (cross-cutting concern)
- Add vitest include for tools/ in root vitest.config.ts
