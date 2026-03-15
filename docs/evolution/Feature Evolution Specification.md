\# SportPulse — Feature Evolution Specification  
Version: 1.0  
Status: Final  
Scope: Rules governing how the system evolves without breaking determinism, compatibility, or stability  
Audience: Backend, Frontend, Data, QA, Product

\#\# 1\. Purpose

SportPulse is designed as a long-lived attention engine.

This specification defines how the system evolves safely when introducing:

\- new signals  
\- new scoring policies  
\- new sports  
\- new DTO fields  
\- new UI behaviors

The goal is to ensure \*\*forward progress without breaking past snapshots or current clients\*\*.

\---

\#\# 2\. Evolution Principles

1\. Determinism must be preserved.  
2\. Existing snapshots must remain renderable.  
3\. New features must be additive whenever possible.  
4\. Breaking changes require explicit version transitions.  
5\. Data models evolve via extension, not mutation.

\---

\#\# 3\. Version Domains

SportPulse contains several independently versioned domains.

\#\#\# 3.1 Signal Registry Version

Defined in:

signals-spec.md

Changes allowed:

Minor version:  
\- add new signal  
\- add explain template  
\- add optional parameter

Major version:  
\- remove signal  
\- change normalization semantics  
\- change signal meaning

\---

\#\#\# 3.2 Metrics Specification Version

Defined in:

metrics-spec.md

Minor:  
\- add new metric  
\- extend metric parameters

Major:  
\- change computation logic  
\- change metric output semantics

\---

\#\#\# 3.3 Scoring Policy Version

Defined in:

scoring-policy-spec.md

Minor:  
\- weight adjustments  
\- threshold adjustments

Major:  
\- remove signal from policy  
\- change normalization method  
\- change aggregation method

\---

\#\#\# 3.4 Layout Algorithm Version

Defined in:

treemap-algorithm-spec.md  
 layout-stability-spec.md

Minor:  
\- padding changes  
\- animation hints

Major:  
\- algorithm replacement  
\- geometry rounding changes

\---

\#\#\# 3.5 Snapshot Format Version

Defined in:

dashboard-snapshot-dto.md  
 api-contract.md

Minor:  
\- add new optional fields

Major:  
\- remove fields  
\- rename fields  
\- change data types

\---

\#\# 4\. Additive Evolution Rule

Preferred evolution path:

add → observe → stabilize → deprecate old

Never:

replace → break

Example:

Bad:

rename SIZE\_SCORE → ATTENTION\_SCORE

Correct:

add ATTENTION\_SCORE  
 mark SIZE\_SCORE deprecated  
 remove in next major

\---

\#\# 5\. Signal Evolution Rules

\#\#\# 5.1 Adding a Signal

Steps:

1\. Add to signal registry.  
2\. Implement computation.  
3\. Do NOT add to active scoring policies yet.  
4\. Observe metrics and quality.  
5\. Introduce in new policy version.

This prevents silent scoring shifts.

\---

\#\#\# 5.2 Removing a Signal

Allowed only if:

\- no active policy references it  
\- deprecated for at least one release cycle

Removal requires:

signalRegistry major version

\---

\#\#\# 5.3 Signal Deprecation

Signals may be marked:

deprecated \= true

Rules:

\- deprecated signals may still appear in historical snapshots  
\- must not appear in new policies

\---

\#\# 6\. Policy Evolution Rules

Policies must follow:

policyKey  
 version

Policy lifecycle:

draft → active → deprecated

Rules:

Active policy must remain immutable.

New behavior requires:

new version

Example:

TEAM\_ATTENTION\_FOOTBALL\_V1  
 TEAM\_ATTENTION\_FOOTBALL\_V2

Snapshots always store:

policyKey  
 policyVersion

\---

\#\# 7\. Multi-Sport Extension Rules

The system must support additional sports without structural changes.

Allowed extensions:

new sportId  
 new metric policy  
 new scoring policy

Forbidden:

sport-specific DTO forks

Example:

Bad:

FootballTeamTile  
 BasketballTeamTile

Correct:

TreemapTileDTO  
 entityKind \+ sport metadata

\---

\#\# 8\. EntityKind Expansion

New entity kinds may be introduced:

PLAYER  
 MATCH  
 TOPIC  
 ASSET

Rules:

\- must define signals  
\- must define scoring policy  
\- must define UI renderer

Snapshots must support mixed entity kinds.

\---

\#\# 9\. DTO Evolution Rules

DTOs evolve using additive strategy.

Allowed:

add optional field  
 add nested structure

Forbidden in minor version:

remove field  
 rename field  
 change type

Frontend rule:

ignore unknown fields

\---

\#\# 10\. Snapshot Compatibility

Snapshots are immutable artifacts.

Snapshots must include version metadata:

signalRegistryVersion  
 metricsSpecVersion  
 scorePolicyKey  
 scorePolicyVersion  
 layoutAlgorithmVersion  
 snapshotFormatVersion

A snapshot must always be renderable using its stored metadata.

\---

\#\# 11\. Migration Strategy

When major changes occur:

1\. Deploy new policies and registry versions.  
2\. Allow system to produce new snapshots.  
3\. Old snapshots remain accessible.  
4\. After retention period, old snapshots may be archived.

\---

\#\# 12\. Feature Flags

Experimental features must be gated.

Feature flag fields:

featureKey  
 enabled  
 scope

Scopes:

global  
 competition  
 user

Example:

enableHotMatchSignal  
 enableLiveMode

\---

\#\# 13\. Observability Requirements

Every feature rollout must track metrics:

scoreDistribution  
 signalCoverage  
 layoutMovement  
 snapshotBuildDuration

If anomaly detected:

rollback to previous policy

\---

\#\# 14\. Deprecation Policy

Deprecation lifecycle:

active → deprecated → removed

Minimum lifetime before removal:

1 major version

Deprecated elements must emit warnings in logs.

\---

\#\# 15\. Acceptance Criteria

The system must support:

\- adding new signals without breaking snapshots  
\- introducing new scoring policies without breaking UI  
\- adding new sports without modifying DTOs  
\- rendering snapshots built under previous policy versions  
\- rolling back policy versions safely

