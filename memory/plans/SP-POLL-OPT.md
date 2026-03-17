# SP-POLL-OPT: API-Football Polling Optimization

**Status:** DESIGN PROPOSAL (Stage 2)
**Date:** 2026-03-17
**Author:** Architect (Opus)

---

## 1. Scope Statement

Reduce API-Football request consumption from a worst-case ~2,200 req/day to under 800 req/day by eliminating redundant polling between the Scheduler and LiveOverlay, introducing competition-aware scheduling, and deferring standings refresh.

---

## 2. Authoritative Spec References

- `docs/specs/api/spec.sportpulse.api.refresh-optimization.md` -- refresh strategy
- `docs/specs/pipeline/spec.sportpulse.server.matchday-cache.md` v1.0 -- matchday caching
- `docs/core/spec.sportpulse.core.constitution.md` -- determinism, explainability
- `docs/core/spec.sportpulse.core.mvp-execution-scope.md` -- live data freshness requirements

---

## 3. Diagnosis: Current Request Budget Breakdown

### 3.1 Budget Parameters

- **Paid tier:** 7,500 req/day
- **HARD_LIMIT in af-budget.ts:** 7,500
- **BRAKE_LIVE:** 6,500 (LiveOverlay throttles to 20min intervals)

### 3.2 Three Independent Consumers (all sharing one API key)

| Consumer | Trigger | Endpoint | Requests/cycle | When |
|----------|---------|----------|---------------|------|
| **Scheduler** (`runRefreshInner`) | Timer: 2min LIVE, 10min POST_MATCH, sleep IDLE | `/fixtures?league=X&season=Y&from=..&to=..` per comp + `/standings?league=X&season=Y` conditionally | 1-2 per comp x 7 comps = 7-14 | Every cycle |
| **LiveOverlay** (`ApifootballLiveOverlay`) | Timer: 2min LIVE, 15min IDLE | `/fixtures?live=all` | 1 | Every cycle |
| **Incidents** (`ApifootballIncidentSource`) | On-demand (user opens DetailPanel) | `/fixtures?live=all&league=X` then `/fixtures/events?fixture=X` | 1-2 per request | User-triggered |

### 3.3 Worst-Case Calculation: Full Matchday (All 7 Leagues Playing)

**Scenario:** 9-hour matchday window (14:00-23:00 UTC), all leagues have live matches.

**Scheduler:**
- 270 cycles (9h / 2min) x 7 comps x 1 req = **1,890 requests**
- Plus standings: if finishedCount changes, +1 req per comp per detection = ~7-21 more
- **Total scheduler: ~1,900 requests**

**LiveOverlay:**
- 270 cycles x 1 req = **270 requests**

**Incidents:**
- User-triggered, assume 20-50 match detail views per day = **20-50 requests**

**Total worst case: ~2,200 requests/day**

This is within budget (7,500) but wasteful. On a day with 2 matchday windows (e.g. afternoon + evening), it could reach ~3,500+.

### 3.4 Identified Redundancies

**Redundancy 1: Scheduler + LiveOverlay both poll for live scores**

The LiveOverlay calls `/fixtures?live=all` every 2 min during live matches. This endpoint returns scores, status, and elapsed time for ALL live matches globally. The Scheduler ALSO calls `/fixtures?league=X&season=Y&from=..&to=..` for EACH competition every 2 min during live matches. Both are fetching live score data.

**What the Scheduler provides that LiveOverlay does not:**
- Full match metadata (matchday, round name, venue, referee)
- Non-live matches in the window (SCHEDULED, FINISHED from last 2 days)
- Status transitions (SCHEDULED -> LIVE -> FINISHED) for the canonical data model
- Score updates for recently finished matches (post-match corrections)

**What the LiveOverlay provides that the Scheduler does not:**
- Faster score updates (single endpoint, 1 req vs 7)
- Cross-league live detection (knows which leagues have live matches)
- Lower latency (no 1.5s inter-competition delay)

**Conclusion:** The LiveOverlay is a "fast path" overlay for real-time scores. The Scheduler is the "canonical path" that builds the full data model. They serve different purposes but overlap significantly during live matches. The key insight: **during a live match window, only the competitions WITH live matches need the fast canonical refresh.**

**Redundancy 2: Scheduler polls all 7 competitions even when only 1 has a live match**

A Saturday 15:00 UTC kickoff is Premier League only. Yet the Scheduler fetches window data for URU, AR, PD, PL, BL1, CLI, WC -- 7 API calls -- even though only PL has live matches. The other 6 return identical data to the cached version (their matches are SCHEDULED or FINISHED with no changes).

**Redundancy 3: Standings refresh is coupled to the fixture refresh cycle**

Standings are re-fetched when `finishedCount` increases. During a live match, the finishedCount can increase mid-cycle (match goes FT), triggering a standings call. But standings don't change until all matches in a round finish. Fetching standings after each individual match finish is wasteful -- better to batch.

---

## 4. Proposed Architecture

### 4.1 Core Idea: LiveOverlay as the Router

Use the LiveOverlay's `/fixtures?live=all` response to determine WHICH competitions have live matches. Only those competitions get the fast 2-min canonical refresh. All others drop to an "idle" schedule.

### 4.2 New Polling Tiers

| Tier | Condition | Refresh Interval | Req/cycle |
|------|-----------|-------------------|-----------|
| **LIVE_FAST** | Competition has matches in LiveOverlay response | 2 min | 1 (window fetch) |
| **IMMINENT** | Competition has SCHEDULED match with kickoff < 30 min from now | 5 min | 1 (window fetch) |
| **ACTIVE_DAY** | Competition has matches today (kickoff within +/- 12h) but not yet started | 15 min | 1 (window fetch) |
| **IDLE** | No matches today | 2 hours | 0 (use matchday cache) |
| **STANDINGS_BATCH** | All matches in a matchday finished | 1x after last match ends | 1 (standings fetch) |

### 4.3 Request Budget Estimate (Same Scenario: 9h Window, Only PL Live)

**LiveOverlay:** 270 cycles x 1 = 270 req (unchanged, this is correct)

**Scheduler with per-competition tiers:**
- PL (LIVE_FAST): 270 cycles x 1 = 270 req
- PD (ACTIVE_DAY, has evening matches): 36 cycles (9h / 15min) x 1 = 36 req
- BL1 (ACTIVE_DAY): 36 req
- URU (IDLE, no matches today): 4.5 cycles (9h / 2h) x 1 = ~5 req
- AR (IDLE): ~5 req
- CLI (IDLE): ~5 req
- WC (IDLE): ~5 req
- Standings: 1 req per comp that finished matches = ~3 req

**Total: 270 + 270 + 36 + 36 + 5 + 5 + 5 + 5 + 3 = ~635 req/day**

**Savings: 2,200 -> 635 = 71% reduction**

### 4.4 Worst Case: All 7 Leagues Live Simultaneously

- LiveOverlay: 270 req
- Scheduler: 7 x 270 = 1,890 req
- Standings: ~14 req

Total: ~2,174 req -- same as before (unavoidable when everything is live).

But this scenario is rare (European + South American leagues rarely overlap in live windows). Typical savings are 50-70%.

### 4.5 Stretch Optimization: Merge LiveOverlay Into Scheduler

Instead of two independent polling loops, have the Scheduler call `/fixtures?live=all` as its FIRST step, use the response to:
1. Update the live score overlay cache immediately (replaces LiveOverlay's job)
2. Determine which competitions have live matches
3. Only fetch canonical window data for live competitions

This eliminates the LiveOverlay's 270 req/day entirely.

**New total for the PL-only scenario:** 270 + 36 + 36 + 5x4 + 3 = ~365 req/day

**Risk:** Tighter coupling. If the Scheduler is slow (API latency), live score freshness degrades. Mitigation: the Scheduler already runs every 2 min during live, so the practical impact is minimal.

---

## 5. Implementation Plan

### Phase 1: Competition-Aware Scheduling (Low Risk, High Impact)

**Goal:** Scheduler only polls competitions that need updating.

**Files to modify:**
- `server/index.ts` (lines 768-936): `runRefreshInner()` -- add per-competition tier logic
- `server/apifootball-live-overlay.ts`: expose `getLiveLeagueIds(): Set<number>` method that returns the AF league IDs currently in the live cache

**Changes:**
1. Add `getLiveLeagueIds()` to `ApifootballLiveOverlay` -- iterates `rawList`, extracts unique league IDs from the cached response (requires storing league ID in the raw entry).
2. Add `getMatchesForToday(compId): boolean` helper to `AfCanonicalSource` -- checks if any match in the cached data has a kickoff within the current UTC day.
3. In `runRefreshInner()`, before the `for` loop over `enabledAfIds`, classify each competition into a tier using LiveOverlay live data + cached match schedules.
4. Only fetch competitions in LIVE_FAST tier on every cycle. Others get a per-competition timer check (last-fetched timestamp vs tier interval).

**Estimated savings:** 50-60% on typical matchdays.

### Phase 2: Deferred Standings Refresh (Low Risk, Medium Impact)

**Goal:** Fetch standings at most once per matchday completion, not on every cycle.

**Files to modify:**
- `server/api-football-canonical-source.ts` (lines 522-552): standings section of `fetchCompetition()`
- Add a `standingsDeferred` flag per competition

**Changes:**
1. During LIVE_FAST cycles, skip standings entirely (standings don't change while matches are in progress).
2. After all matches in a matchday are FINISHED (detected by finishedCount == expectedMatchesInMatchday), do ONE standings fetch.
3. On IDLE/ACTIVE_DAY cycles, standings are already correct from the last batch fetch.

**Estimated savings:** 7-21 req/day (minor but clean).

### Phase 3: LiveOverlay Merger (Medium Risk, Medium Impact) -- OPTIONAL

**Goal:** Eliminate LiveOverlay as a separate polling loop.

**Files to modify:**
- `server/index.ts`: merge LiveOverlay logic into `runRefreshInner()`
- `server/apifootball-live-overlay.ts`: convert from autonomous poller to a passive cache updated by the Scheduler

**Changes:**
1. At the start of each scheduler cycle, call `/fixtures?live=all` (1 req).
2. Feed the response into the LiveOverlay cache (same normalization).
3. Use the response to determine competition tiers (Phase 1).
4. Remove the LiveOverlay's independent `poll()` timer.

**Estimated additional savings:** 270 req/day.
**Risk:** If the Scheduler crashes or hangs, live scores stop updating. Mitigation: keep a watchdog timer that falls back to independent LiveOverlay polling if no Scheduler cycle completes within 5 min.

---

## 6. Acceptance Test Mapping

| Change | Acceptance Test |
|--------|----------------|
| Competition-aware scheduling | AT: live scores update within 2 min for active leagues (verify via `/api/ui/status`) |
| Idle leagues not polled | AT: `af-budget.json` shows reduced request count on non-universal matchday |
| Standings batch | AT: standings table updates within 15 min of all matches finishing |
| LiveOverlay merger (if done) | AT: live score overlay still shows correct data, verified via LiveCarousel |

---

## 7. Version Impact Analysis

- No DTO shape changes -- `snapshotSchemaVersion` stays at 2
- No scoring/layout changes -- no `policyVersion` or `layoutAlgorithmVersion` bumps
- No golden fixture impact (this is a server-side optimization only)

---

## 8. Top 3 Risks

1. **Race between LiveOverlay tier detection and Scheduler execution.** If LiveOverlay detects a match going live between Scheduler cycles, the Scheduler might skip that competition on the current cycle. Mitigation: the IMMINENT tier (5 min for matches starting within 30 min) provides a safety net. Worst case: 5 min delay before the first canonical update.

2. **Edge case: match goes live in a competition classified as IDLE.** If a competition has no matches scheduled for today but a postponed match is rescheduled and starts, the Scheduler won't know until the next IDLE cycle (2 hours). Mitigation: LiveOverlay detects it via `/fixtures?live=all` and scores update immediately. The canonical data (match cards, metadata) updates on the next IDLE cycle. This is acceptable -- the live score is correct, only the canonical metadata lags.

3. **Phase 3 tight coupling.** Merging LiveOverlay into the Scheduler creates a single point of failure. If the Scheduler hangs on a slow API call, live scores freeze. Mitigation: implement a watchdog or keep Phase 3 as optional.

---

## 9. Assumptions

1. The `/fixtures?live=all` response includes the `league.id` field for each fixture, allowing competition identification. (Confirmed: `AfFixture.league.id` exists in the response type.)
2. The matchday cache on disk is reliable enough that IDLE competitions don't need network refresh more than once every 2 hours.
3. The paid tier budget (7,500/day) is confirmed and stable.

---

## 10. Answers to Specific Questions

### Q1: Does it make sense to have LiveOverlay AND the Scheduler polling separately?

**Partially.** They serve different roles: LiveOverlay provides low-latency score overlay (1 req for all leagues), while the Scheduler builds the full canonical data model per competition. However, the Scheduler's 2-min-per-competition polling during live matches is excessive because most of the data it fetches doesn't change that frequently. The fix is not to eliminate either, but to make the Scheduler smarter about WHICH competitions to poll and HOW often.

### Q2: Does it make sense to window-fetch URU if only European teams are playing?

**No.** This is the biggest waste. URU/AR/CLI/WC in IDLE mode consume 4 req/cycle x 270 cycles = 1,080 wasted requests on a European-only matchday. Phase 1 fixes this by classifying them as IDLE (2h interval).

### Q3: Does `/fixtures?live=all` already bring the scores for all matches?

**Yes, but only for LIVE matches.** It returns goals, status, and elapsed time for every currently in-progress match globally. It does NOT return:
- Scheduled matches (upcoming)
- Finished matches (recently completed)
- Match metadata beyond score (matchday, round, venue)
- Non-live status transitions

The Scheduler's window fetch provides the full picture. The LiveOverlay is a real-time score overlay that patches the canonical data with the latest score.

### Q4: When are standings updated vs fixtures? Can they be deferred?

**Currently:** Standings re-fetch when `finishedCount` increases (a new match finishes). This means during a matchday with 10 matches, standings are fetched up to 10 times as each match finishes.

**Can be deferred:** Yes. Standings only meaningfully change AFTER all matches in a matchday are complete. Fetching once at the end of the matchday is sufficient. Phase 2 handles this.

### Q5: What does the Scheduler's window fetch provide that LiveOverlay does not?

- Status transitions for non-live matches (SCHEDULED, FINISHED, POSTPONED)
- Post-match score corrections (the 150-min grace period)
- Match metadata (matchday number, round name, sub-tournament classification)
- Recently finished matches that dropped off the `/fixtures?live=all` response
- Scheduled matches for the next 7 days (for the match card list)

---

## 11. Recommendation

**Implement Phase 1 + Phase 2.** These are low-risk, high-impact changes that can reduce daily requests by 50-70% on typical matchdays. Phase 3 (LiveOverlay merger) is optional and should only be considered if budget pressure demands it.

**Implementation agent:** `backend-engineer` (Sonnet) -- all changes are in `server/`.

**Estimated effort:** Phase 1 = 2-3 hours. Phase 2 = 1 hour. Phase 3 = 3-4 hours.
