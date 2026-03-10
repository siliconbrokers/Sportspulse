# Track A — Backend Runtime Observation Report

**Protocol:** v2_window_based freeze policy
**Observer:** ClaudeCode
**Observation run:** 2026-03-10T19:57:44Z
**CSV:** `ops/track_a_backend_runtime_observation.csv`

---

## Runtime Sources Found

| Source | Path / Location | Accessible |
|--------|----------------|-----------|
| Forward validation store | `cache/predictions/forward-validation.json` | Yes |
| API runtime log | `/tmp/sp-api.log` | Yes |
| Matchday cache (PD) | `cache/football-data/PD/2025-26/matchday-*.json` (38 files) | Yes |
| Matchday cache (PL) | `cache/football-data/PL/2025-26/matchday-*.json` (38 files) | Yes |
| Matchday cache (BL1) | `cache/football-data/BL1/2025-26/matchday-*.json` (34 files) | Yes |
| Runner source | `server/prediction/forward-validation-runner.ts` | Yes |
| Store source | `server/prediction/forward-validation-store.ts` | Yes |
| Evaluator source | `server/prediction/forward-validation-evaluator.ts` | Yes |
| EvaluationStore | `cache/predictions/evaluations.json` (110 records) | Yes |
| Runner log lines (forward) | `sp-api.log` lines 2311–3256 | Yes |
| Settlement records (forward) | n.a. — no completed forward records exist yet | N/A |

---

## Controls Executed

- Confirmed `freeze_policy: v2_window_based` in store file
- Confirmed `savedAt: 2026-03-10T13:44:43.202Z` — store unchanged since FULL_RESET
- Confirmed `records: []` — 0 frozen and 0 diagnostic records in store
- Counted 5 distinct post-reset runner cycles from `sp-api.log` (`Loaded 0 records` pattern at lines 2639, 2758, 2926, 3051, 3206)
- Sampled 85 unique upcoming kickoffs from PD/PL/BL1 matchday cache
- Confirmed all upcoming matches outside 48h window (nearest: 544481 at 72.1h lead)
- Confirmed 0 TIMED matches in PD/PL/BL1 cache at observation time
- Verified `FREEZE_WINDOW_MAX_LEAD_H = 48` and `FREEZE_WINDOW_MIN_LEAD_H = 0.5` match codebase constants
- Confirmed `ELIGIBLE_PRE_MATCH_STATUSES = ['SCHEDULED', 'TIMED']` in runner source
- Identified persistent BL1 `No seasonId` skip pattern (8 occurrences total, every cycle)
- Verified `getSeasonId()` delegates to in-memory `getCached()` — returns undefined when BL1 not yet fetched

---

## Observations Registered

**8 new rows added. 0 updated.**

| observation_id | match_id | comp | kickoff | lead_h | window | expected | actual | verdict | cases |
|----------------|----------|------|---------|--------|--------|----------|--------|---------|-------|
| OBS-20260310-195744-544481-1 | 544481 | PD | 2026-03-13T20:00Z | 72.1h | no | NO_FREEZE_EXPECTED | NO_FREEZE | **PASS** | B2 |
| OBS-20260310-195744-538075 | 538075 | PL | 2026-03-14T15:00Z | 91.1h | no | NO_FREEZE_EXPECTED | NO_FREEZE | **PASS** | B2 |
| OBS-20260310-195744-544481-2 | 544481 | PD | 2026-03-13T20:00Z | 72.1h | no | NO_FREEZE_EXPECTED | NO_FREEZE | **PASS** | B2\|B3 |
| OBS-20260310-195744-538084 | 538084 | PL | 2026-03-14T20:00Z | 96.1h | no | NO_FREEZE_EXPECTED | NO_FREEZE | **PASS** | B2 |
| OBS-20260310-195744-BL1-NOSEASONID | n.a. | BL1 | n.a. | n.a. | unknown | NO_FREEZE_EXPECTED | INCONSISTENT | **NEEDS_REVIEW** | B2 |
| OBS-20260310-195744-B1-GAP | 544481 | PD | 2026-03-13T20:00Z | 72.1h | no | FREEZE_EXPECTED | (window not open) | **NEEDS_REVIEW** | B1 |
| OBS-20260310-195744-B5B7-GAP | n.a. | n.a. | n.a. | n.a. | unknown | DIAGNOSTIC_EXPECTED | (no cases) | **NEEDS_REVIEW** | B5\|B7 |
| OBS-20260310-195744-B4B8-GAP | n.a. | n.a. | n.a. | n.a. | unknown | SETTLEMENT_EXPECTED | (no records) | **NEEDS_REVIEW** | B4\|B6\|B8 |

---

## Case Coverage

| Case | Description | Status | Evidence |
|------|-------------|--------|---------|
| B1 | Eligible match enters freeze window and freezes correctly | **not covered** | Window hasn't opened. First eligible window: 2026-03-11T20:00Z |
| B2 | Match outside freeze window does not freeze | **covered** | 4 matches confirmed (PD/PL), 5 runner cycles, store=0 |
| B3 | Re-run idempotence | **covered** | match:544481 observed across 5 cycles. No duplicate. No spurious freeze. |
| B4 | Variant pairing integrity | **not covered** | No frozen records exist to verify pairing |
| B5 | Legitimate diagnostic generation | **not covered** | No match within 0.5h of kickoff at observation time |
| B6 | Diagnostic isolation | **not covered** | No diagnostics in store; no contamination observable |
| B7 | TIMED match handling | **not covered** | 0 TIMED matches in PD/PL/BL1 cache |
| B8 | Post-match completion linkage | **not covered** | No completed forward records under v2_window_based |

---

## Track A Status

**OPEN**

4 PASS rows, 4 NEEDS_REVIEW rows, 0 FAIL rows.
Cases B1, B4, B5, B6, B7, B8 require additional runtime time to cover.
Track A cannot reach PASS until all 8 cases have valid evidence.

---

## Blocking Gaps

### GAP-1: B1 (Freeze eligible match)
- **Missing:** A match currently inside the [0.5h, 48h] window
- **Why blocking:** No evidence that the runner correctly freezes when it should. Only seen zero-freeze behavior so far.
- **Resolves at:** 2026-03-11T20:00Z (when match 544481 enters 48h window, next runner cycle should produce 2 records)
- **Minimum instrumentation required:** None — runner already logs `[ForwardVal] Frozen: N` when frozen > 0

### GAP-2: B4 (Variant pairing)
- **Missing:** Frozen records to verify BASELINE_REFERENCE + CTI_ALPHA_0_4 both exist per match_id
- **Resolves at:** Same as GAP-1 — after first valid freeze

### GAP-3: B5 (Diagnostic — MISSED_FREEZE_WINDOW)
- **Missing:** A match that was inside the window during a runner gap (i.e., kickoff approached but runner didn't fire in time)
- **Why blocking:** Cannot force this synthetically without violating the no-modification constraint
- **Resolves at:** Organically if any match ever reaches kickoff without being frozen (runner downtime scenario)

### GAP-4: B6 (Diagnostic isolation)
- **Missing:** A diagnostic record to verify it does not appear in `findPending()` results
- **Resolves at:** Same as GAP-3

### GAP-5: B7 (TIMED match handling)
- **Missing:** A match with `status = TIMED` in PD/PL/BL1
- **Why blocking:** `TIMED` status is set by football-data.org when kickoff time is confirmed; typically appears 1–7 days before kickoff
- **Resolves at:** When football-data.org sets upcoming matches to TIMED (typically mid-week before a matchday)

### GAP-6: B8 (Post-match completion linkage)
- **Missing:** A completed match that was frozen under v2_window_based and settled
- **Why blocking:** No completed forward records exist under the new protocol
- **Resolves at:** After the first frozen match completes (earliest: 2026-03-13T20:00Z + match duration)

### GAP-7: BL1 scope integrity (NEEDS_REVIEW)
- **Observation:** `getSeasonId('comp:football-data:BL1')` returns undefined on every runner cycle
- **Root cause:** Runner fires before BL1 in-memory cache is populated in the DataSource
- **Impact:** BL1 matches are never evaluated for freezing — scope is effectively PD+PL only, not PD+PL+BL1 as configured
- **Not a blocking gap for Track A PASS** — but is a material observability finding that must be resolved before interpreting BL1 absence as expected behavior
- **Minimum action:** Verify whether the refresh cycle order guarantees BL1 data is loaded before the runner fires, or adjust runner to handle this gracefully with retry

---

*Report generated: 2026-03-10T19:57:44Z*
*Next scheduled check: after 2026-03-11T20:00Z (B1 window opens)*
