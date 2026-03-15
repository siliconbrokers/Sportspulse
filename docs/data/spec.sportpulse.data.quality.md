---
artifact_id: SPEC-SPORTPULSE-DATA-QUALITY
title: "Data Quality Specification"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: data
slug: quality
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/data/spec.sportpulse.data.quality.md
---
\# SportPulse — Data Quality Specification  
Version: 1.0  
Status: Final  
Scope: Data validation, deduplication, and resilience for provider ingestion  
Audience: Backend, Data, QA, Ops

\#\# 1\. Purpose

External sports data providers frequently produce inconsistent or incomplete data.

This specification defines how SportPulse ensures:

\- canonical consistency  
\- deterministic ingestion  
\- resilience against provider errors  
\- reproducible snapshot builds

The goal is that \*\*bad provider data never breaks the system\*\*.

\---

\#\# 2\. Data Quality Principles

1\. Canonical data must be provider-agnostic.  
2\. Provider inconsistencies must be normalized or rejected.  
3\. Missing data must degrade gracefully.  
4\. Snapshot generation must never fail due to incomplete provider data.  
5\. All corrections must be auditable.

\---

\#\# 3\. Provider Isolation

Provider fields must never leak into canonical models.

Provider records must be mapped into:

ProviderEvent  
 ProviderParticipant  
 ProviderCompetition

These are internal ingestion objects.

Canonical tables must only contain:

Competition  
 Stage  
 Participant  
 Event  
 Result

Provider IDs are stored only in a mapping table:

ProviderEntityMap

Fields:

\- providerKey  
\- providerEntityId  
\- canonicalEntityId  
\- entityKind

\---

\#\# 4\. Duplicate Event Detection

Duplicate matches are common across provider updates.

Two events are considered duplicates if:

same competition  
 same participants  
 startTime difference \< 4 hours  
 same stage (if available)

If duplicates detected:

\- select the record with the most complete data  
\- mark the other as merged

Merged events produce:

EventChange type \= MERGE  
 severity \= high

Merged provider IDs remain mapped to the canonical event.

\---

\#\# 5\. Kickoff Time Corrections

Kickoff times may change frequently.

Classification:

\<= 15 minutes → minor change  
 15–120 minutes → moderate change

120 minutes → major change

Handling:

Minor:  
\- update canonical time  
\- no immediate rebuild required

Moderate:  
\- update canonical time  
\- invalidate dashboard snapshot

Major:  
\- update canonical time  
\- invalidate both affected date dashboards  
\- log audit event

\---

\#\# 6\. Missing Kickoff Time

If provider returns event without kickoff time:

status \= TBD  
 startTimeUtc \= null

UI behavior:

startTimeLocal \= "TBD"

Signal behavior:

NEXT\_EVENT\_HOURS → undefined  
 PROXIMITY\_BONUS → 0

\---

\#\# 7\. Participant Identity Resolution

Teams may appear under slightly different names.

Example:

"Barcelona"  
 "FC Barcelona"  
 "Barcelona FC"

Resolution strategy:

1\. Primary key: providerEntityId mapping  
2\. If mapping missing:  
  \- fuzzy name match  
  \- same competition constraint  
3\. If still ambiguous:  
  \- create new participant  
  \- mark mapping as low confidence

Confidence levels:

HIGH → direct mapping  
 MEDIUM → fuzzy match  
 LOW → created participant

Low confidence must be logged.

\---

\#\# 8\. Score Validation

Provider scores must satisfy:

score.home \>= 0  
 score.away \>= 0

If score negative or null in FINISHED event:

warnings.partialData \= true  
 score ignored

Score correction detection:

if score changes after FINISHED  
 emit EventChange SCORE

Severity:

high

\---

\#\# 9\. Event Timezone Consistency

Providers sometimes return local times without timezone.

Rule:

All canonical times stored in:

UTC

Conversion requires:

competition timezone

If timezone missing:

fallback to competition default  
 warnings.partialData \= true

\---

\#\# 10\. Incomplete Event Data

Minimum required fields for canonical event:

competitionId  
 participantA  
 participantB  
 status

Optional:

stage  
 venue  
 referee  
 attendance

If participants missing:

reject event  
 log ingestion error

\---

\#\# 11\. Provider Outage Handling

If provider ingestion fails:

providerError \= true

Snapshot engine must:

serve last successful snapshot

Warnings:

staleData \= true

Provider state must track:

lastSuccessfulIngest  
 lastAttempt  
 failureStreak

\---

\#\# 12\. Data Window Limits

Provider queries must use bounded windows.

Recommended:

pastWindowDays \= 30  
 futureWindowDays \= 14

This prevents runaway ingestion.

\---

\#\# 13\. Event Deduplication Index

Maintain index:

(eventDate, participantA, participantB)

Tolerance window:

4 hours

Used to detect duplicates before canonical insert.

\---

\#\# 14\. Data Quality Metrics

System must track:

eventsIngested  
 eventsMerged  
 eventsCorrected  
 duplicateRate  
 missingKickoffRate  
 providerFailureRate

Metrics used for monitoring.

\---

\#\# 15\. Manual Override Mechanism

Admin interface may override canonical data.

Overrides stored in:

CanonicalOverrides

Fields:

entityId  
 field  
 oldValue  
 newValue  
 reason  
 updatedBy  
 updatedAt

Overrides must survive provider updates.

\---

\#\# 16\. Acceptance Criteria

\- Duplicate matches are detected and merged.  
\- Kickoff time corrections update canonical data without breaking snapshots.  
\- Missing kickoff times produce valid TBD agenda entries.  
\- Provider outages do not break UI.  
\- Score corrections recompute form signals deterministically.  
\- Participant identity resolution avoids uncontrolled duplication.  
\- All corrections and merges produce audit records.

