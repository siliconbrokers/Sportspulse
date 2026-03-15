# SportPulse — Snapshot Engine Specification

Version: 1.1  
Status: Draft for review  
Scope: Deterministic snapshot generation pipeline for SportPulse (MVP and forward-compatible)  
Audience: Backend, Frontend, Data, QA, Ops

---

## 1. Purpose

This document specifies the **Snapshot Engine**: the deterministic mechanism that produces frontend-facing **materialized snapshots** for SportPulse.

The Snapshot Engine is responsible for:

- selecting the correct **canonical data** for a given request context
- computing **signals** per entity (per Signals Specification)
- computing **scores** per entity (per Scoring Policy Specification)
- producing **treemap geometry** (per treemap-algorithm-spec.md)
- materializing immutable snapshot payloads
- serving snapshots via UI API with caching + staleness behavior

**Hard rule:** the frontend renders snapshots and must **not** compute signals, scoring, or layout.

---

## 2. Definitions

- **Snapshot**: immutable materialized payload for a given context and policy identity.
- **SnapshotKey**: stable identifier used for cache lookup and retrieval.
- **SnapshotId**: unique identifier for one built snapshot instance.
- **BuildNowUtc**: logical “now” used to compute time-relative signals; an explicit input to scoring (not just metadata).
- **Context**: request inputs used to select canonical data.
- **Canonical data**: provider-agnostic events, participants, stages, results; no provider IDs leaked.
- **Signal**: atomic feature per entity per context; normalized to `[0..1]`.
- **Policy**: versioned immutable mapping: `signals -> attentionScore -> displayScore -> layoutWeight`.

---

## 3. Design principles

- **Deterministic**: given the same canonical dataset snapshot, the same `buildNowUtc`, and the same `policyKey+policyVersion`, the output snapshot payload (except `computedAtUtc`) is identical.
- **Immutable**: snapshots are never modified in place. Rebuilds create a new `snapshotId`.
- **Provider-isolated**: no provider schema or IDs in snapshots.
- **Robust**: missing/partial data yields warnings, not broken payloads.
- **Cache-first**: serve last good snapshot if rebuild fails.
- **Extensible**: supports new sports/entity kinds via registries and versioned policies.

---

## 4. Snapshot types

### 4.1 MVP required snapshot

MVP requires exactly one snapshot type:

- **DashboardSnapshot** (competition + dateLocal + timezone)

All other UI views are projections of DashboardSnapshot and must not trigger recomputation.

### 4.2 Projection model

Secondary views must be projections of DashboardSnapshot, e.g.:

- team detail panel
- explanation panel
- agenda highlighting

These projections must not recompute signals/scoring/layout.

---

## 5. Snapshot identity (keying + versioning)

### 5.1 SnapshotKey

A SnapshotKey must include the policy identity to prevent serving the wrong scoring model after a policy upgrade.

**SnapshotKey =**
- `sport`
- `competitionId`
- `dateLocal`
- `timezone`
- `policyKey`
- `policyVersion`

### 5.2 SnapshotId

SnapshotId uniquely identifies one built snapshot instance.

- new build => new SnapshotId
- SnapshotId is opaque; it should not encode provider values

### 5.3 Snapshot metadata (mandatory)

Every materialized snapshot must embed:

- `snapshotFormatVersion` (integer)
- `policyKey`, `policyVersion`
- `buildNowUtc` (logical “now” used for signal computation)
- `computedAtUtc` (execution timestamp, metadata only)
- `dataFreshnessUtc` (freshness of canonical dataset used)
- `warnings[]` (may be empty, but must exist)

---

## 6. MVP scoring scope (explicit)

MVP treemap sizing is driven by **TEAM-level scoring only**.

- MATCH entity scoring is **out of scope** for v1.1 snapshot builds (reserved for future policies and UI views).

Signals used for MVP TEAM scoring (per signals-spec):

- `FORM_POINTS_LAST_5`
- `NEXT_MATCH_HOURS`

Derived helpers (not weighted signals):

- `PROXIMITY_BUCKET` (derived from next-match hours for explainability only)

**Removed from MVP contract:**
- `PROXIMITY_BONUS`
- `SIZE_SCORE`
- `HOT_MATCH_SCORE`
- `FORM_POINTS_N` (variable window)

If older terms appear in persisted historical snapshots, they are treated as legacy and must not be reintroduced into the active build pipeline.

---

## 7. Build pipeline (deterministic)

### 7.1 Inputs

Inputs required to build a snapshot:

- `sport` (MVP: football)
- `competitionId`
- `dateLocal` (date for UI context)
- `timezone` (IANA name)
- `buildNowUtc` (logical now)
- `policyKey`, `policyVersion` (active)

### 7.2 Canonical data selection

The engine must resolve a **canonical dataset view** sufficient to compute MVP signals:

- finished matches for each team (for form window)
- next scheduled match for each team (for agenda proximity)

Selection rules:

- “finished match” is determined by canonical match status and presence of a final score.
- “next match” is the earliest scheduled kickoff strictly after `buildNowUtc` (UTC comparison).

### 7.3 Signal computation (TEAM)

Compute MVP TEAM signals deterministically:

#### a) `FORM_POINTS_LAST_5`

- uses up to last 5 finished matches with kickoffUtc < `buildNowUtc`
- if fewer than 5 matches exist: compute with available N (N>0)
- if N==0: mark missing (`value=0`, `quality.missing=true`)

#### b) `NEXT_MATCH_HOURS`

- `hours = (nextKickoffUtc - buildNowUtc) in hours`
- MVP v1 horizon fixed: `minHours=0`, `maxHours=168`
- normalized inverse min-max clamp
- if no next match: mark missing (`value=0`, `quality.missing=true`, `params.reason=no_next_match`)

#### c) `PROXIMITY_BUCKET` (helper only)

Derived deterministically from `NEXT_MATCH_HOURS` into buckets:
- 0..24h => D1
- 24..72h => D3
- 72..168h => W1
- >168h => LATER
- missing => NONE

This must not be weighted as an independent signal.

### 7.4 Score computation (TEAM)

Apply policy (Scoring Policy Specification) to TEAM signals:

- produce `rawScore`, `attentionScore`, `displayScore`, `layoutWeight`
- produce `topContributions[]`

**Tie-breaker determinism:** `topContributions` sorted by:
1) absolute `contribution` desc
2) `signalKey` asc

### 7.5 Tile materialization

For each TEAM in snapshot scope, materialize a tile record that includes (at minimum):

- entity identity (teamId, display name, etc.)
- computed scoring outputs: `attentionScore`, `displayScore`, `layoutWeight`
- signals (or a reference set) required for explain panels
- agenda metadata required for UI rendering (next match time if present)
- warnings (entity-level if needed)

The exact payload shape is defined in **dashboard-snapshot-dto.md**.

### 7.6 Treemap layout generation

Treemap layout inputs:

- list of tiles with `layoutWeight`
- container width/height
- gutters/padding parameters (per treemap spec)

Deterministic ordering rule for layout input:

- primary sort: `layoutWeight` desc
- tie-break: `entityId` asc (canonical stable id)

No hashing-based “stableIndex” is permitted in the active MVP algorithm contract unless explicitly specified in treemap-algorithm-spec.md.

### 7.7 Snapshot assembly

Assemble snapshot payload:

- metadata
- tiles with geometry
- agenda summary (if present)
- warnings[] (must exist, may be empty)

Persist snapshot as immutable record keyed by SnapshotId.

---

## 8. Caching, staleness, rebuild behavior

### 8.1 Serve strategy (cache-first)

On request:

1) if a fresh snapshot exists for SnapshotKey and within TTL => serve it
2) else attempt rebuild
3) if rebuild succeeds => persist and serve new snapshot
4) if rebuild fails => serve last known good snapshot with a warning

### 8.2 Staleness

Staleness policy is defined by config (not hard-coded in this spec), but behavior must support:

- soft TTL: trigger background rebuild on access (implementation detail)
- hard TTL: if exceeded and rebuild fails, still serve last good snapshot with warning

### 8.3 Failure modes

Typical failure causes:

- provider outage (ingestion unavailable)
- canonical dataset missing partial entities
- compute error in signal or layout generation

Required behavior:

- never break UI rendering
- include warnings describing degraded quality
- keep determinism for a given materialized snapshot instance

---

## 9. Warnings contract (minimum)

Warnings are intended for UI display and Ops debugging.

Minimum warning shape:

- `code` (stable string)
- `severity` (`INFO|WARN|ERROR`)
- `message` (human-readable; may be null if code is enough)
- optional `entityId` reference

Warnings list must exist on all snapshot responses (may be empty).

---

## 10. Acceptance criteria

### 10.1 Determinism (functional)

Given the same:

- canonical dataset snapshot (same ingested + derived state)
- scoring context including identical `buildNowUtc`
- identical `policyKey + policyVersion`
- identical layout parameters

The engine produces identical:

- signals
- scores (`attentionScore`, `displayScore`, `layoutWeight`)
- treemap geometry
- serialized snapshot payload (excluding `computedAtUtc`)

If strict byte-level comparisons are required, the persistence layer must enforce canonical serialization rules (numeric formatting + stable key ordering).

### 10.2 No provider leakage

Snapshots must not expose provider IDs, provider schema, or raw provider payloads.

### 10.3 UI independence

Frontend can render dashboard tiles and treemap geometry without computing signals, scores, or layout.

### 10.4 Robustness

- provider outages do not break the UI (serve last good snapshot + warning)
- missing signals yield stable defaults (`value=0`, `missing=true`) and do not crash scoring

---

## 11. Open items (explicitly deferred)

- MATCH entity scoring policies
- additional signals (rank delta, xG, injuries, odds, sentiment)
- multi-provider reconciliation
- policy-specific non-linear display mappings

All of the above require new policy versions and (if DTO changes) new snapshotFormatVersion.
