---
artifact_id: SPEC-SPORTPULSE-SERVER-MATCHDAY-CACHE
title: "Matchday Cache Technical Specification"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: server
slug: matchday-cache
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/specs/pipeline/spec.sportpulse.server.matchday-cache.md
---
# **Matchday Local File Cache Specification**

**Version:** 1.0  
 **Status:** Final  
 **Scope:** Persistencia local en archivo para datos de jornadas consumidos desde APIs externas  
 **Audience:** Backend, Frontend, QA, Ops  
 **Type:** Closed technical specification

---

# **1\. Purpose**

This specification defines the mandatory behavior for caching and reusing **matchday data** retrieved from external football APIs in order to:

* reduce unnecessary API calls  
* improve response time for historical matchdays  
* avoid re-fetching data that is already known and sufficiently fresh  
* preserve deterministic behavior for already finalized matchdays

This specification is **implementation-binding**.  
 The implementing agent or programmer **must not reinterpret the rules** defined here.

---

# **2\. Core Requirement**

For every request of a matchday, the system **must** execute the following sequence:

```
check cache -> validate -> reuse if valid -> otherwise call API -> normalize -> persist atomically -> return
This sequence is mandatory.

3. Scope
Included
This specification covers:

local file-based cache

cache lookup by provider + competition + season + matchday

freshness rules by matchday state

validation rules for stored cache files

atomic persistence

cache hit / miss / stale behavior

logging requirements

acceptance criteria

Excluded
This specification does not cover:

database persistence

distributed cache

cache invalidation UI

CDN or edge cache

caching at frontend/browser level

player/team/statistics caches outside the matchday unit

background refresh workers

multi-node cache synchronization

4. Design Decision
The cache storage mechanism for this phase is file-based JSON persistence.

This is an explicit design decision for the current implementation phase.

The implementation must not replace this with a database unless a later specification explicitly authorizes it.

5. Cache Unit
The cache unit is one matchday.

The system must persist matchday data independently for each unique combination of:

provider

competitionId

season

matchday

The cache must not store all matchdays in one giant file.

6. Cache Identity
6.1 Required cache key
A unique cache key must be derived from:

{provider}_{competitionId}_{season}_matchday_{matchday}
6.2 Example
footballData_PD_2025-26_matchday_18
footballDb_UY1_2025_matchday_4
6.3 Mandatory uniqueness rule
Different providers, competitions, seasons, or matchdays must never reuse the same cache file.

7. Directory Structure
The cache must be stored using the following directory structure:

/cache
  /{provider}
    /{competitionId}
      /{season}
        matchday-{NN}.json
Examples
/cache/footballData/PD/2025-26/matchday-18.json
/cache/footballDb/UY1/2025/matchday-04.json
Rules
provider, competitionId, and season are directory segments

matchday is the file unit

matchday file naming must be deterministic

zero-padding for matchday is allowed but must be consistent across the implementation

8. File Format
Every cache file must be valid JSON and must contain exactly two top-level keys:

meta

data

8.1 Required file shape
{
  "meta": {},
  "data": {}
}
9. Meta Schema
The meta object must contain the following fields:

Field	Type	Required	Description
cacheVersion	number	yes	Cache schema version
provider	string	yes	Source API identifier
competitionId	string	yes	Competition identifier
season	string	yes	Season identifier
matchday	number	yes	Matchday number
retrievedAt	string (ISO UTC)	yes	Timestamp when data was fetched from API
status	string	yes	Global matchday state
ttlSeconds	number	yes	Time-to-live applied at persistence time
matchesCount	number	yes	Number of matches stored
isComplete	boolean	yes	Whether the response is considered complete
sourceChecksum	string/null	no	Optional checksum/fingerprint
lastValidationAt	string/null	no	Optional internal validation timestamp
9.1 Allowed values for status
status must be one of:

scheduled

live

finished

mixed

unknown

No other value is allowed.

10. Data Schema
The data object must contain the normalized matchday payload used by the application.

Minimum required shape:

{
  "matches": []
}
Rules
data must already be normalized to the application’s canonical structure

raw provider response may be preserved only if explicitly needed, but canonical normalized data is mandatory

the application must consume normalized data, not ad hoc raw provider fields

11. Global Matchday Status Resolution
The system must determine a global matchday status from the statuses of the matches contained in the normalized payload.

11.1 Status rules
finished
Use finished only if all matches in the matchday are finalized.

live
Use live if at least one match is currently in play.

scheduled
Use scheduled only if no match has started yet.

mixed
Use mixed when the matchday contains a combination of states that is neither purely scheduled, purely live, nor purely finished.

Examples:

some matches finished, some scheduled

some live, some finished

some postponed, some finished

unknown
Use unknown only if the system cannot reliably infer the global state from the provider response.

11.2 Precedence rule
If multiple statuses are present, resolve using this priority:

live -> mixed -> scheduled -> finished -> unknown
This priority applies only when needed to resolve ambiguity from inconsistent provider data.

12. TTL Policy
TTL is mandatory and depends on the global matchday status.

12.1 Required TTL values
Global status	TTL
finished	31536000 seconds
scheduled	21600 seconds
live	60 seconds
mixed	300 seconds
unknown	120 seconds
12.2 Interpretation
finished: effectively long-lived cache for finalized historical data

scheduled: refresh occasionally because kickoff time or metadata may still change

live: refresh very frequently

mixed: moderate refresh because data is still evolving

unknown: treat conservatively

12.3 Mandatory rule
The TTL value must be persisted inside the file that was written.

13. Completeness Rules
A cache file must not be trusted only because it exists.

The file is valid for reuse only if isComplete = true and validation passes.

13.1 A response is complete only if all of the following are true
JSON can be parsed successfully

meta exists

data exists

meta.provider matches requested provider

meta.competitionId matches requested competition

meta.season matches requested season

meta.matchday matches requested matchday

data.matches exists and is an array

matchesCount equals data.matches.length

normalized match objects contain the minimum required fields defined by the application

no fatal normalization error occurred during persistence

If any of the above fails, isComplete must be treated as false.

14. Freshness Rules
A cache file is considered fresh if:

currentTimeUtc < retrievedAt + ttlSeconds
If the file is not fresh, it is considered stale.

Important rule
Even if a file is stale, it may still be used only as a temporary fallback on API failure if the implementation supports degraded fallback mode.

However:

stale cache must not be treated as fresh

stale cache must not prevent the API call attempt

If degraded fallback mode is not implemented, stale data must not be returned.

15. Mandatory Read Flow
For every matchday request, the backend must follow this exact flow.

15.1 Read flow
Build cache identity from:

provider

competitionId

season

matchday

Resolve cache file path

Check whether the file exists

If the file exists:

parse JSON

validate structure

validate identity

validate completeness

validate freshness

If the file is valid, complete, and fresh:

return cached normalized data

log CACHE_HIT

If the file does not exist:

log CACHE_MISS

call external API

If the file exists but is invalid or incomplete:

log CACHE_INVALID

call external API

If the file exists but is stale:

log CACHE_STALE

call external API

After API success:

normalize data

resolve global matchday status

compute TTL

compute matchesCount

determine isComplete

persist atomically

return normalized data

After API failure:

if degraded fallback mode is enabled and stale cache exists and is structurally valid:

return stale cache

log CACHE_STALE_FALLBACK

otherwise:

return error to caller

16. Mandatory Write Flow
The write flow must be atomic.

16.1 Atomic write procedure
The system must:

serialize the final JSON payload

write it to a temporary file in the same directory:

example: matchday-18.tmp

flush and close the file

rename/move the temporary file to the target file:

example: matchday-18.json

16.2 Mandatory rule
The system must not write directly into the final file path without a temporary file step.

This prevents partial/corrupted cache files from being observed by readers.

17. Logging Requirements
The backend must emit structured logs for cache decisions.

17.1 Required log events
CACHE_HIT

CACHE_MISS

CACHE_INVALID

CACHE_STALE

CACHE_WRITE_SUCCESS

CACHE_WRITE_ERROR

CACHE_API_FETCH

CACHE_API_ERROR

CACHE_STALE_FALLBACK (only if fallback mode exists)

17.2 Required log context
Each log entry must include at minimum:

provider

competitionId

season

matchday

cachePath

status if known

retrievedAt if known

18. Error Handling Rules
18.1 Invalid cache file
If the file exists but:

cannot be parsed

has missing required keys

has mismatched identity

has invalid field types

then the file must be treated as invalid and ignored for normal reuse.

18.2 API failure after stale cache
If the API call fails and a stale but structurally valid cache file exists, the system may return it only if degraded fallback mode is explicitly enabled.

If degraded fallback mode is not enabled, the request must fail.

18.3 Corrupt temp file
If temporary file creation or rename fails:

final cache file must remain untouched

log CACHE_WRITE_ERROR

return normalized API data if already available in memory

19. Non-Functional Requirements
19.1 Determinism
For a given cache file, repeated reads must return the same normalized data until the file is replaced.

19.2 Performance
A valid cache hit must not require any external API call.

19.3 Isolation
A cache file for one matchday must not affect another matchday.

19.4 Safety
Cache persistence must not corrupt existing valid cache files.

20. Pseudocode Contract
The implementation must conform to the following logic:

function getMatchdayData(provider, competitionId, season, matchday):
    cachePath = buildCachePath(provider, competitionId, season, matchday)

    if fileExists(cachePath):
        cached = tryReadJson(cachePath)

        if isStructurallyValid(cached) and
           matchesIdentity(cached.meta, provider, competitionId, season, matchday) and
           cached.meta.isComplete == true:

            if isFresh(cached.meta.retrievedAt, cached.meta.ttlSeconds):
                log(CACHE_HIT)
                return cached.data
            else:
                log(CACHE_STALE)
        else:
            log(CACHE_INVALID)
    else:
        log(CACHE_MISS)

    log(CACHE_API_FETCH)
    apiPayload = fetchFromProvider(provider, competitionId, season, matchday)

    normalized = normalizeMatchdayPayload(apiPayload)
    globalStatus = resolveGlobalMatchdayStatus(normalized.matches)
    ttl = resolveTTL(globalStatus)
    matchesCount = count(normalized.matches)
    isComplete = validateCompleteness(normalized, provider, competitionId, season, matchday)

    cacheDocument = {
        meta: {
            cacheVersion: 1,
            provider: provider,
            competitionId: competitionId,
            season: season,
            matchday: matchday,
            retrievedAt: nowUtcIso(),
            status: globalStatus,
            ttlSeconds: ttl,
            matchesCount: matchesCount,
            isComplete: isComplete
        },
        data: normalized
    }

    atomicWrite(cachePath, cacheDocument)
    log(CACHE_WRITE_SUCCESS)

    return normalized
21. Acceptance Criteria
The implementation is accepted only if all conditions below are satisfied.

AC-01
When a requested matchday has no cache file, the system calls the API, normalizes the data, writes the cache file atomically, and returns the normalized payload.

AC-02
When a requested matchday has a valid, complete, and fresh cache file, the system returns cached data without calling the API.

AC-03
When a requested matchday has an invalid cache file, the system ignores that file and calls the API.

AC-04
When a requested matchday has a stale cache file, the system attempts an API refresh.

AC-05
When a matchday is fully finalized, the resulting cache file is persisted with status = finished.

AC-06
When at least one match is live, the resulting cache file is persisted with status = live or mixed, according to the status resolution rules.

AC-07
The final cache file is never partially written.

AC-08
The cache file path is deterministic and reproducible from the request identity.

AC-09
The implementation emits required cache logs.

AC-10
The system never reuses a cache file belonging to a different provider, competition, season, or matchday.

22. QA Test Matrix
Test ID	Scenario	Expected Result
QA-01	File does not exist	API call occurs, file is created, response returned
QA-02	File exists and is fresh	No API call, cached data returned
QA-03	File exists but JSON is broken	File ignored, API call occurs
QA-04	File exists but provider mismatches	File ignored, API call occurs
QA-05	File exists but matchday mismatches	File ignored, API call occurs
QA-06	File exists, complete, stale	API call occurs
QA-07	API returns finalized matchday	Cache written with finished
QA-08	API returns in-progress matchday	Cache written with live or mixed
QA-09	Atomic write interrupted before rename	Old final file remains valid
QA-10	matchesCount differs from actual array length	File treated as invalid/incomplete
23. Implementation Constraints
The implementing agent/programmer must respect these constraints:

must use file-based JSON persistence

must not introduce database storage in this task

must not bypass validation

must not bypass atomic write

must not use frontend cache as the source of truth

must not call the API when valid fresh cache exists

must not trust cache existence alone

must not persist raw provider payload without normalized data

24. Future Extensions (Not in Current Scope)
The following items are explicitly out of scope for this version but may be added later:

manual cache invalidation endpoint

SQLite migration

scheduled warm-up/preload

background refresh jobs

per-match cache granularity

ETag/Last-Modified revalidation

checksum-based duplicate avoidance

distributed/shared cache

These must not be implemented under this specification unless separately approved.

25. Final Implementation Directive
The implementation must be treated as cache-first with validation, not as API-first.

The mandatory behavior is:

1. identify cache file
2. read cache if present
3. validate identity + completeness + freshness
4. return cache if valid
5. otherwise fetch API
6. normalize result
7. compute matchday global status
8. compute TTL
9. write cache atomically
10. return normalized result
```

