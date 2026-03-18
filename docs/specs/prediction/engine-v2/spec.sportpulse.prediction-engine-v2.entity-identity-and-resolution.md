---
artifact_id: SPEC-SPORTPULSE-PREDICTION-ENGINE-V2-ENTITY-IDENTITY
title: "NEXUS Entity Identity and Resolution Specification"
artifact_class: spec
status: DRAFT
version: 0.1.0
project: sportpulse
domain: prediction
slug: engine-v2-entity-identity-and-resolution
owner: team
created_at: 2026-03-18
updated_at: 2026-03-18
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-PREDICTION-ENGINE-V2-MASTER
  - SPEC-SPORTPULSE-PREDICTION-ENGINE-V2-NEXUS-0
canonical_path: docs/specs/prediction/engine-v2/spec.sportpulse.prediction-engine-v2.entity-identity-and-resolution.md
---

# NEXUS Entity Identity and Resolution Specification

**Version:** 0.1-DRAFT
**Status:** DRAFT -- pending review
**Scope:** Canonical identity, multi-provider reconciliation, and confidence classification for sporting entities within the NEXUS predictive engine
**Audience:** Architect, Backend, Data/ML, QA
**Parent document:** `spec.sportpulse.prediction-engine-v2.master.md` (S6.2)

---

## Table of Contents

- S1. Purpose and Boundary
- S2. Entities in Scope
- S3. Canonical Identity Model
- S4. Provider ID Mapping
- S5. Transfers, Loans, and Club Changes
- S6. Coach and Staff Changes
- S7. Resolution Confidence States
- S8. Availability Representation
- S9. Impact of Identity Uncertainty on Feature Eligibility
- S10. Invariants
- S11. What This Document Is NOT

---

## S1. Purpose and Boundary

### S1.1 Purpose

This document defines how sporting entities are identified, reconciled across data providers, and classified by resolution confidence within the NEXUS predictive engine. It answers the question:

> **Who is this entity, how do we reconcile it across providers, and under what confidence?**

Multi-provider data ingestion creates a fundamental identity problem: API-Football calls a player `id: 874`, SofaScore calls the same person `id: 24629`, and football-data.org does not expose player-level IDs at all. Without a formal resolution layer, the feature store (NEXUS-0) cannot meaningfully associate features with entities across providers, and the model cannot track player careers, transfers, or absences over time.

### S1.2 Boundary with NEXUS-0

Entity identity and the temporal feature store are complementary but non-overlapping:

| Concern | Answering document |
|---------|-------------------|
| "Is this the same person across two providers?" | This document |
| "What did we know about this resolved person at time T?" | NEXUS-0 |
| "What is this player's injury status right now?" | NEXUS-0 |
| "Which provider IDs map to canonical player 42?" | This document |

**Rule:** NEXUS-0 operates on resolved entities. It assumes every entity referenced in the store has a canonical ID assigned by the entity resolution layer defined here. NEXUS-0 never performs entity matching or deduplication.

### S1.3 Why a Separate Subdocument

Entity identity is a transversal subdomian that affects:

- **Ingestion:** provider data must be tagged with canonical IDs before entering the feature store.
- **Features:** player-level features (xG contribution, minutes played, absence impact) require stable identity across time and providers.
- **Auditing:** reproducibility demands that the identity mapping used for a historical prediction can be reconstructed.
- **Career tracking:** transfers, loans, and coaching changes are identity lifecycle events, not feature store events.

Merging identity concerns into NEXUS-0 or into the model taxonomy would create a document with two distinct responsibilities. This separation follows the single-responsibility principle applied to specifications.

---

## S2. Entities in Scope

### S2.1 Player

A player is an individual who participates in competitive football matches as a field player or goalkeeper.

| Attribute | Type | Description |
|-----------|------|-------------|
| `canonicalPlayerId` | `string` | Unique canonical identifier. Format defined in S3.1. |
| `displayName` | `string` | Full display name as commonly used in match reports. |
| `normalizedName` | `string` | Lowercase, diacritic-free, abbreviation-free canonical form. Derivation defined in S4.3. |
| `dateOfBirth` | `string` (ISO-8601 date) or `null` | Date of birth. Null if unknown. |
| `primaryPosition` | `PositionEnum` | Primary playing position. One of: `GK`, `CB`, `LB`, `RB`, `CDM`, `CM`, `CAM`, `LM`, `RM`, `LW`, `RW`, `CF`, `ST`. |
| `secondaryPosition` | `PositionEnum` or `null` | Secondary position, if the player regularly operates in two roles. Null if not applicable. |
| `nationality` | `string` (ISO 3166-1 alpha-3) or `null` | Primary nationality. Null if unknown. |

### S2.2 Coach / Staff

A coach or staff member is an individual responsible for tactical and managerial decisions for a team.

| Attribute | Type | Description |
|-----------|------|-------------|
| `canonicalCoachId` | `string` | Unique canonical identifier. Format defined in S3.1. |
| `displayName` | `string` | Full display name. |
| `normalizedName` | `string` | Canonical normalized form. |
| `role` | `CoachRoleEnum` | One of: `HEAD_COACH`, `ASSISTANT_COACH`, `INTERIM_COACH`. |

### S2.3 Team

Teams already have a canonical identity in SportPulse through `canonicalTeamId` as defined in the domain glossary (`spec.sportpulse.core.domain-glossary-and-invariants.md`). This document does not redefine team identity. It references the existing `canonicalTeamId` when establishing relationships (e.g., a player's club affiliation).

The existing team identity system maps provider-specific team IDs to canonical team IDs. NEXUS inherits this mapping without modification.

### S2.4 Competition and Season

Competitions and seasons already have canonical identities in SportPulse (`competitionId`, `seasonId`). This document references them without redefinition. The competition registry in `server/competition-registry.ts` is the authoritative source.

### S2.5 Out of Scope

The following entity types are explicitly out of scope for this version:

- **Referees.** Match officials may influence outcomes (e.g., card propensity, penalty decisions), but structured referee identity data is not available from current providers in a form that supports reliable reconciliation. May be added in a future version.
- **Stadiums / Venues.** Venue metadata (capacity, altitude, location) is a feature in NEXUS-0, but venue identity is simple (each team has a known home venue; neutral venues are tagged per match). A formal reconciliation layer is not needed until venue-level features become more granular.

---

## S3. Canonical Identity Model

### S3.1 Canonical ID Format

Every entity in the resolution layer receives a canonical ID with the following format:

| Entity type | Unreconciled format | Reconciled format |
|-------------|--------------------|--------------------|
| Player | `player:{source}:{providerId}` | `player:canonical:{deterministicHash}` |
| Coach | `coach:{source}:{providerId}` | `coach:canonical:{deterministicHash}` |

Where:

- `{source}` is the provider identifier: `af` (API-Football), `sofascore`, `fd` (football-data.org).
- `{providerId}` is the provider's native numeric or string ID.
- `{deterministicHash}` is a deterministic hash derived from the reconciliation key (see S3.3).

Examples:
- Unreconciled player from API-Football: `player:af:874`
- Reconciled player: `player:canonical:a1b2c3d4`
- Unreconciled coach from SofaScore: `coach:sofascore:15221`

### S3.2 Resolution States

Every entity exists in exactly one of four resolution states at any point in time:

| State | Meaning |
|-------|---------|
| `RESOLVED` | Identity confirmed across two or more providers with high-confidence automatic matching. The entity has a `player:canonical:*` ID that aggregates all known provider IDs. |
| `PARTIAL` | Identified in exactly one provider. No contradictory information from other providers. The entity uses its provider-specific ID as canonical ID (e.g., `player:af:874`) with an explicit `resolutionState: PARTIAL` flag. |
| `UNRESOLVED` | Reconciliation was attempted but failed -- the matching algorithm could not produce a confident result. The entity retains its provider-specific ID with `resolutionState: UNRESOLVED`. |
| `CONFLICTED` | Two or more providers give contradictory information that could not be automatically resolved (e.g., same name but different dates of birth, or two distinct players with identical normalized names on the same team). Requires manual inspection. |

### S3.3 Reconciliation Key

The reconciliation key for automatic matching is the tuple:

```
(normalizedName, dateOfBirth, currentTeamCanonicalId, positionGroup)
```

Where `positionGroup` is a coarse grouping: `GK`, `DEF`, `MID`, `FWD`. This prevents matching a goalkeeper named "Carlos" in Team A from API-Football with a striker named "Carlos" in Team A from SofaScore, even if they share name and team.

The `deterministicHash` in a reconciled canonical ID is computed as:

```
SHA-256(normalizedName + "|" + dateOfBirth + "|" + firstTeamCanonicalId)
```

Truncated to 8 hex characters. The `firstTeamCanonicalId` is the team where the player was first observed, providing historical stability -- the hash does not change when a player transfers.

### S3.4 One Entity, One Canonical ID

A reconciled entity has exactly one `canonicalPlayerId` or `canonicalCoachId` that groups all its provider IDs. The mapping is stored as:

```
canonicalPlayerId → [
  { source: 'af', providerId: '874' },
  { source: 'sofascore', providerId: '24629' },
]
```

This mapping is append-only. Once a provider ID is associated with a canonical ID, it is never removed -- only superseded if the association is found to be incorrect (in which case a `RESOLUTION_CORRECTED` event is logged and the old association is marked `superseded: true` with a timestamp).

---

## S4. Provider ID Mapping

### S4.1 Provider Capabilities

| Provider | Player ID | Coach ID | Transfer history | Position data | Date of birth |
|----------|-----------|----------|-----------------|---------------|---------------|
| API-Football (AF) | Yes (`player.id`) | Yes (`coach.id`) | Yes (transfers endpoint) | Yes (primary + secondary) | Yes |
| SofaScore (MCP) | Yes (`player.id`) | Yes (`manager.id`) | Partial (via team page) | Yes (primary) | Partial (not always exposed) |
| football-data.org (FD) | No (no player-level endpoints) | No | No | No | No |

**Implication:** football-data.org cannot contribute to player or coach identity resolution. It provides match results and competition structure only. Player-level identity depends entirely on API-Football and SofaScore.

### S4.2 Primary Source

API-Football is the primary source for player and coach identity because it provides the most complete attribute set (ID, name, date of birth, position, nationality, transfers). SofaScore is the secondary source, used for cross-validation and for coverage gaps where API-Football data is unavailable.

When a player is observed only in API-Football, the canonical ID is `player:af:{id}` with `resolutionState: PARTIAL`. When the same player is confirmed in SofaScore, the canonical ID is promoted to `player:canonical:{hash}` with `resolutionState: RESOLVED`.

### S4.3 Name Normalization

The canonical normalized name is computed by the following deterministic procedure:

1. Take the full display name from the provider.
2. Convert to lowercase.
3. Remove all diacritical marks (Unicode NFD normalization, then strip combining characters). Example: "Gonzalez" and "Gonzalez" both become "gonzalez"; "Muller" and "Mueller" both become "muller".
4. Remove all punctuation except hyphens and spaces.
5. Collapse multiple spaces to a single space.
6. Trim leading and trailing whitespace.
7. Remove common suffixes that are not part of the name: "Jr.", "Sr.", "III", "II".
8. The result is the `normalizedName`.

Examples:

| Input | Normalized |
|-------|-----------|
| "Vinicius Junior" | "vinicius junior" |
| "Vinicius Jr." | "vinicius" |
| "Rodrygo Silva de Goes" | "rodrygo silva de goes" |
| "Rodrygo" | "rodrygo" |

**Known limitation:** Many players are commonly known by a single name (Rodrygo, Vinicius, Neymar) while providers may store either the short name or the full legal name. The matching algorithm must handle partial name overlap (see S4.4).

### S4.4 Matching Strategy

Automatic matching proceeds in three tiers, from most confident to least:

#### Tier 1: Exact Key Match (confidence: HIGH)

Two provider records are considered the same entity if:

- `normalizedName` is identical (or one is a substring of the other with length >= 5 characters), AND
- `dateOfBirth` is identical (both non-null), AND
- `currentTeamCanonicalId` is the same team (within a temporal window of +/- 60 days to accommodate transfers between ingestion cycles).

Tier 1 matches produce `resolutionState: RESOLVED` automatically.

#### Tier 2: Fuzzy Name + Exact Birth Date (confidence: MEDIUM)

Two provider records are considered the same entity if:

- `normalizedName` has Levenshtein distance <= 3, or one is a known alias of the other (alias table maintained manually), AND
- `dateOfBirth` is identical (both non-null), AND
- `positionGroup` is the same.

Tier 2 matches produce `resolutionState: RESOLVED` but are logged as `MATCH_TIER_2` for periodic review.

#### Tier 3: Name + Team + Position (confidence: LOW)

Two provider records are considered the same entity if:

- `normalizedName` is identical or has Levenshtein distance <= 2, AND
- `currentTeamCanonicalId` is the same, AND
- `positionGroup` is the same, AND
- `dateOfBirth` is null for at least one record.

Tier 3 matches produce `resolutionState: RESOLVED` with `matchTier: 3` annotation. These are flagged for manual confirmation and are treated as `confidence: LOW` until confirmed.

#### No Match

If no tier produces a match, the entity remains at `resolutionState: PARTIAL` (single-provider) or `resolutionState: UNRESOLVED` (multi-provider attempt failed).

### S4.5 Special Cases

#### S4.5.1 Same Name, Different Player

When two distinct players have the same `normalizedName` and play for the same team (rare but possible -- e.g., father and son in lower leagues), `dateOfBirth` is the primary disambiguation key. If both dates of birth are known and different, they are distinct entities. If one or both dates are unknown, the situation is `CONFLICTED`.

#### S4.5.2 Name Changes

Some players change their registered name (legal name change, adoption of sporting name). When a provider updates a player's name, the `normalizedName` changes but the `providerId` remains the same. The canonical ID is unaffected because it is tied to the provider ID, not to the name. The name change is recorded as a `NAME_UPDATED` event in the entity's history.

#### S4.5.3 Dual Nationality / Nationality Change

Nationality changes (e.g., naturalization) do not affect identity. The `nationality` field is updated, and the change is logged, but the canonical ID is stable.

---

## S5. Transfers, Loans, and Club Changes

### S5.1 Affiliation History

Each player has an ordered history of club affiliations:

```
affiliations: [
  { teamId: 'team:fd:86', from: '2023-07-01T00:00:00Z', to: '2024-06-30T23:59:59Z', type: 'permanent' },
  { teamId: 'team:fd:65', from: '2024-01-15T00:00:00Z', to: '2024-06-30T23:59:59Z', type: 'loan' },
  { teamId: 'team:fd:86', from: '2024-07-01T00:00:00Z', to: null, type: 'permanent' },
]
```

Where:

- `teamId` is the `canonicalTeamId` of the club.
- `from` is the UTC timestamp when the affiliation began (typically the official registration date).
- `to` is the UTC timestamp when the affiliation ended. `null` means the affiliation is current (no known end date).
- `type` is one of: `'permanent'`, `'loan'`, `'free_agent'`.

### S5.2 Temporal Belonging Rule

A player belongs to a team at `buildNowUtc = T` if there exists an affiliation record where:

```
affiliation.from <= T AND (affiliation.to === null OR affiliation.to > T)
```

This is a closed-open interval `[from, to)`. At the exact instant of `to`, the player no longer belongs to the team.

### S5.3 Loan Semantics

During a loan period, the player belongs to the **destination club** (the club where the player is actively playing), not the owning club. This is consistent with how providers report squad membership and with the predictive model's needs: what matters is who plays for the team, not who owns the contract.

The owning club's affiliation record shows `to` = loan start date. A new record with `type: 'loan'` and the destination club covers the loan period. When the loan ends, a new record for the owning club begins.

### S5.4 Free Agent

A player with no active affiliation at `buildNowUtc` is a free agent. The entity remains valid in the resolution layer (canonical ID is preserved), but the player is not eligible for any team-level features. A free agent's individual historical features (career xG, career minutes) remain in the feature store and can be used if the player signs with a new team.

### S5.5 Mid-Season Transfer

When a player transfers between teams during a season, the affiliation history allows the model to determine the correct team at any historical `buildNowUtc`. This is essential for:

- Historical reconstruction: when evaluating a prediction from November, the model must know which team the player belonged to in November, not which team the player belongs to now.
- Feature attribution: a player's xG contribution in October belongs to the team the player played for in October.

---

## S6. Coach and Staff Changes

### S6.1 Coach Identity

Coaches follow the same canonical ID model as players (see S3.1), with `coach:` prefix instead of `player:`. The matching strategy is identical (S4.4) but with a relaxed `positionGroup` criterion -- coaches do not have playing positions.

### S6.2 Coaching History

Each coach has an ordered history of appointments:

```
appointments: [
  { teamId: 'team:fd:86', from: '2022-11-01T00:00:00Z', to: '2024-05-15T00:00:00Z', role: 'HEAD_COACH' },
  { teamId: 'team:fd:81', from: '2024-06-01T00:00:00Z', to: null, role: 'HEAD_COACH' },
]
```

The temporal belonging rule (S5.2) applies identically.

### S6.3 Interim Coaches

An interim coach is tagged with `role: 'INTERIM_COACH'`. Interim status matters for feature confidence:

- A head coach with tenure >= 3 competitive matches has established tactical patterns. Features derived from those patterns (formation tendencies, pressing intensity, rotation frequency) have reasonable confidence.
- An interim coach with tenure < 3 competitive matches has not established patterns. Features derived from the interim coach's tactical profile are marked `confidence: LOW`.

The 3-match threshold is a configurable constant: `INTERIM_TACTICAL_CONFIDENCE_THRESHOLD = 3`.

### S6.4 Coaching Vacancy

If a team has no coach record at `buildNowUtc` (vacancy between sacking and appointment), the model treats coaching features as absent. This does not prevent prediction -- it degrades the data quality tier (see NEXUS-0 S7.3).

---

## S7. Resolution Confidence States

### S7.1 State Definitions

The four resolution states are defined formally:

| State | Definition | Canonical ID form | Feature eligibility |
|-------|-----------|-------------------|-------------------|
| `RESOLVED` | Identity confirmed across >= 2 providers via automatic matching (Tier 1 or Tier 2) or manual confirmation. | `player:canonical:{hash}` | Full eligibility. Features from all associated providers are unified under this ID. |
| `PARTIAL` | Identified in exactly 1 provider. No contradictory signal from other providers. | `player:{source}:{id}` | Eligible, but features come from a single source. Cross-validation is not possible. |
| `UNRESOLVED` | Reconciliation attempted across >= 2 providers but no confident match was produced. | `player:{primarySource}:{id}` | Features from this entity are **excluded** from the prediction input vector. The entity exists in the store for auditing but does not feed models. |
| `CONFLICTED` | >= 2 providers give contradictory information that cannot be automatically resolved. | `player:{primarySource}:{id}` | Features from this entity are **excluded** from the prediction input vector. A `RESOLUTION_CONFLICT` event is logged. Requires manual resolution. |

### S7.2 State Transitions

Resolution state transitions are constrained:

```
PARTIAL  --> RESOLVED    (second provider confirms identity)
PARTIAL  --> UNRESOLVED  (reconciliation attempt fails)
PARTIAL  --> CONFLICTED  (contradictory data discovered)

UNRESOLVED --> RESOLVED  (manual resolution or new data enables matching)
UNRESOLVED --> CONFLICTED (additional contradictory data discovered)

CONFLICTED --> RESOLVED  (manual resolution with explicit decision logged)

RESOLVED --> CONFLICTED  (new provider data contradicts established identity -- rare)
```

All transitions are logged as `RESOLUTION_STATE_CHANGE` events with: entity ID, old state, new state, trigger (automatic matching, manual override, new data arrival), and timestamp.

### S7.3 No Silent Resolution

The state `CONFLICTED` is never resolved automatically. Every transition out of `CONFLICTED` requires an explicit decision -- either manual review or a deterministic rule that is documented and logged. The system prefers a conservative `CONFLICTED` state over an incorrect `RESOLVED` state.

---

## S8. Availability Representation

### S8.1 Availability States

Each player, for a given match at a given `buildNowUtc`, has an availability state:

| State | Definition |
|-------|-----------|
| `CONFIRMED_AVAILABLE` | Player is explicitly declared available by an official source or included in the confirmed lineup. |
| `CONFIRMED_ABSENT` | Player is confirmed absent due to injury, suspension, or other official reason. Source data includes reason and expected return date when available. |
| `DOUBT` | Player's availability is uncertain. Reported by a structured provider source but not officially confirmed. Typically corresponds to API-Football `status: 'Doubtful'`. |
| `UNKNOWN` | No availability information exists in the feature store for this player at `buildNowUtc`. |

### S8.2 Relationship to Feature Store

Availability is a feature in NEXUS-0, not an identity attribute. This document defines the states; NEXUS-0 governs the temporal semantics (as-of constraint, provenance, freshness).

### S8.3 Model Treatment

The model's treatment of availability states is defined here to ensure consistency between the identity layer and downstream consumers:

| State | Model treatment |
|-------|----------------|
| `CONFIRMED_AVAILABLE` | Player included in baseline squad with full weight. If a confirmed lineup is available, player is included in it. |
| `CONFIRMED_ABSENT` | Player excluded from baseline squad. Absence adjustment applied to team strength (Track 1). |
| `DOUBT` | Player included with reduced weight (`DOUBT_WEIGHT`, default: 0.5). This represents the probability that the player will be available. |
| `UNKNOWN` | No signal. The model does not assume the player is available or absent. Features that depend on player availability are excluded for this player. This is distinct from `CONFIRMED_AVAILABLE` -- "we don't know" is not "they are available." |

### S8.4 DOUBT and UNKNOWN in Confidence Degradation

When a significant proportion of a team's key players have availability state `DOUBT` or `UNKNOWN`, the prediction's data quality tier (NEXUS-0 S7.3) may be degraded:

- If >= 3 players with `importanceWeight >= 0.15` have state `DOUBT` or `UNKNOWN`, the absence model's confidence is `LOW`.
- This condition is logged as `ABSENCE_DATA_INCOMPLETE` and factored into the data quality tier determination.

---

## S9. Impact of Identity Uncertainty on Feature Eligibility

### S9.1 Resolution State Effects

| Resolution state | Effect on features |
|-----------------|-------------------|
| `RESOLVED` | All features from all associated providers are eligible. The unified canonical ID is used throughout the pipeline. |
| `PARTIAL` | Features from the single known provider are eligible. The provider-specific canonical ID is used. |
| `UNRESOLVED` | Features for this entity are **excluded** from the prediction input vector. The entity exists in the store for auditing only. |
| `CONFLICTED` | Features for this entity are **excluded** from the prediction input vector. A `RESOLUTION_CONFLICT` event is logged and counted toward the prediction's data quality assessment. |

### S9.2 Temporal Belonging Effects

| Situation | Effect |
|-----------|--------|
| Player outside any active affiliation range at `buildNowUtc` | Player's features are excluded from the team's feature vector. The player is treated as not belonging to any team. |
| Player transferred mid-season, prediction for a past date | The affiliation at the past `buildNowUtc` determines team assignment. Features are attributed to the team the player belonged to at that time. |

### S9.3 Interim Coach Effects

| Situation | Effect |
|-----------|--------|
| Coach with `role: INTERIM_COACH` and tenure < `INTERIM_TACTICAL_CONFIDENCE_THRESHOLD` matches | Tactical features derived from this coach's profile are marked `confidence: LOW`. The model may exclude them based on NEXUS-0 S7.1 rules. |
| Coach with `role: INTERIM_COACH` and tenure >= threshold | Treated identically to `HEAD_COACH` for feature confidence purposes. |

---

## S10. Invariants

The following invariants must hold at all times. Violation of any invariant is a severity-CRITICAL bug.

1. **Unique canonical ID.** Every entity has exactly one canonical ID in the system at any point in time. Two distinct entities never share the same canonical ID.

2. **No simultaneous dual-club affiliation.** A player cannot have two active affiliation records (with overlapping `[from, to)` intervals) for two different teams simultaneously. If provider data suggests dual affiliation (data error), the most recent affiliation takes precedence and the conflict is logged.

3. **Non-overlapping affiliation intervals.** For the same player and the same team, affiliation intervals do not overlap. For the same player across different teams, intervals do not overlap (enforced by invariant 2).

4. **CONFLICTED requires explicit resolution.** The state `CONFLICTED` is never resolved by the automatic matching pipeline. Every transition from `CONFLICTED` to any other state requires a logged explicit decision.

5. **Append-only identity history.** Changes to canonical identity (provider ID associations, resolution state transitions, name updates, affiliation changes) are append-only. Previous records are never deleted or overwritten -- they are superseded with a timestamp and a reason.

6. **Name normalization is deterministic.** The same input string always produces the same `normalizedName`. The normalization function has no external dependencies, no locale-sensitive behavior, and no randomness.

7. **Hash stability.** The `deterministicHash` in a reconciled canonical ID does not change when the player transfers to a new team. The hash is derived from the first-observed team, ensuring lifetime stability.

8. **Provider ID immutability.** A provider ID, once associated with a canonical ID, is never reassigned to a different canonical ID -- it can only be marked `superseded: true` if the original association was incorrect.

---

## S11. What This Document Is NOT

1. **Not a temporal feature specification.** This document resolves entity identity. What the system knows about that entity at a given time is governed by NEXUS-0 (`spec.sportpulse.prediction-engine-v2.nexus-0-temporal-feature-store.md`).

2. **Not a model specification.** How features are weighted, combined, or used in predictions is governed by the model-taxonomy-and-ensemble subdocument (master S6.3).

3. **Not a market signal specification.** How market odds are treated is governed by the market-signal-policy subdocument (master S6.5).

4. **Not a data pipeline implementation guide.** This document defines identity semantics. The implementation of entity resolution (batch jobs, matching pipelines, storage schema) is determined at Stage 3 by the implementing agent.

5. **Not a squad prediction system.** This document defines confirmed states of player availability and club affiliation. It does not predict lineups, estimate probability of a player starting, or infer squad composition from historical patterns. Lineup prediction is explicitly out of scope.

---

*End of NEXUS Entity Identity and Resolution specification.*
