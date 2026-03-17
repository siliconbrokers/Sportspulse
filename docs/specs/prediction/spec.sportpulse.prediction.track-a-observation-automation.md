---
artifact_id: SPEC-SPORTPULSE-PREDICTION-TRACK-A-OBSERVATION-AUTOMATION
title: "Track A Backend Observation Automation Specification"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: prediction
slug: track-a-observation-automation
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/specs/prediction/spec.sportpulse.prediction.track-a-observation-automation.md
---
Track A Backend Observation Automation Specification

Version: 1.0  
 Status: Implementable  
 Scope: Automated backend runtime observation, evidence registration, coverage evaluation, and reporting for Track A  
 Audience: Backend, Ops, QA  
 Depends on: existing freeze runner, forward-validation store, runtime logs, source/cache access

---

1\. Purpose

This specification defines the automation layer required to validate **Track A Backend Runtime Observation** without manual intervention.

The automation must:

* collect **real backend evidence** from runtime sources  
* register only **real observations** into an auditable CSV  
* compute formal coverage for Track A cases `B1..B8`  
* generate a markdown report with current status  
* avoid noise, fake coverage, and redundant rows  
* keep Track A status updated as `OPEN`, `PASS`, or `FAIL`

This automation does **not** modify prediction business logic.

---

2\. Non-goals

This system must **not**:

* modify freeze engine business rules  
* modify prediction logic  
* infer UI behavior  
* create synthetic GAP rows in the CSV  
* fabricate observations to satisfy minimum volume  
* close cases without real evidence  
* treat BL1 as operationally valid if runtime source resolution still fails

---

3\. High-level architecture

The solution must be split into **3 modules**.

3.1 Observation Collector

Reads runtime evidence, identifies real candidate observations, and appends valid rows to the CSV.

3.2 Evaluator

Reads the CSV, computes formal Track A coverage, detects blocking issues, and writes a markdown report.

3.3 Orchestrator

Runs collector \+ evaluator as a single scheduled automation entrypoint.

---

4\. Required files  
4.1 Observation CSV

Path: `./ops/track_a_backend_runtime_observation.csv`

Purpose:

* auditable append-only record of real backend observations

4.2 Observation report

Path: `./ops/track_a_backend_runtime_observation_report.md`

Purpose:

* current Track A status  
* case coverage  
* blocking issues  
* summary of latest run

4.3 Internal automation state

Path: `./ops/track_a_backend_runtime_state.json`

Purpose:

* last processed runner cycle marker  
* last processed savedAt marker  
* deduplication hashes  
* last seen observable state per match  
* last generated report metadata

This file is internal only and not an audit artifact.

---

5\. Runtime sources to inspect

The collector must discover and use actual runtime-accessible sources, including where available:

* forward-validation store  
* runner logs  
* match source/cache  
* diagnostics store/logs  
* pending-record inspection path  
* settlement/post-match linkage evidence

The implementation must tolerate missing optional sources, but if a missing source blocks real validation, the evaluator must report it as a blocking issue.

---

6\. Effective scope rules  
6.1 Competitions

Nominal supported scope:

* `PD`  
* `PL`  
* `BL1`

6.2 Runtime scope reduction

If a competition is broken operationally at runtime, it must be excluded from formal coverage until fixed.

Example:

* if `BL1 getSeasonId() = undefined`  
* then effective scope becomes `PD + PL`  
* BL1 must be reported under blocking scope issues  
* BL1 observations must not be used to claim formal coverage

---

7\. Observation CSV schema

The CSV must use **exactly** this column order:

```
observation_id,
observed_at_utc,
observer,
match_id,
competition_code,
home_team,
away_team,
kickoff_utc,
match_status_at_observation,
within_freeze_window,
expected_backend_outcome,
actual_backend_outcome,
freeze_record_present,
diagnostic_present,
diagnostic_type,
variant_pair_complete,
snapshot_frozen_at,
freeze_lead_hours,
duplicate_record_detected,
pending_visible_correctly,
settlement_state,
post_match_link_ok,
evidence_ref,
notes,
covered_case_ids,
row_verdict
No extra columns.
No reordered columns.
No renamed columns.

8. Allowed values
8.1 within_freeze_window
yes

no

unknown

8.2 expected_backend_outcome
FREEZE_EXPECTED

NO_FREEZE_EXPECTED

DIAGNOSTIC_EXPECTED

SETTLEMENT_EXPECTED

8.3 actual_backend_outcome
FREEZE_CREATED

NO_FREEZE

DIAGNOSTIC_CREATED

SETTLED

INCONSISTENT

8.4 freeze_record_present
yes

no

8.5 diagnostic_present
yes

no

8.6 diagnostic_type
none

MISSED_FREEZE_WINDOW

NO_START_TIME

other

8.7 variant_pair_complete
yes

no

n.a.

8.8 duplicate_record_detected
yes

no

8.9 pending_visible_correctly
yes

no

n.a.

8.10 settlement_state
n.a.

pending

eligible_for_settlement

settled

failed

8.11 post_match_link_ok
yes

no

n.a.

8.12 row_verdict
PASS

FAIL

NEEDS_REVIEW

9. Evidence rules
9.1 Real observation only
Every CSV row must correspond to a real observable entity, typically:

a real match_id

or a real diagnostic entity directly tied to a real match_id

Synthetic rows are forbidden.

9.2 Prohibited rows
The collector must never write:

GAP rows

placeholder rows

narrative rows

rows with competition_code = n.a. to represent missing evidence

rows whose sole purpose is to fill coverage

9.3 Evidence traceability
Every row must include an evidence_ref pointing to something concrete, for example:

store://forward-validation/<match_id>

log://runner/<cycle-id>

diagnostic://<type>/<match_id>

settlement://<match_id>

10. Mandatory case model
Formal Track A coverage must be computed against these cases:

B1
Eligible match enters freeze window and freezes correctly

B2
Match outside freeze window does not freeze

B3
Re-run idempotence after real freeze creation

B4
Variant pairing integrity, only if pairing actually applies

B5
Legitimate diagnostic generation

B6
Diagnostic isolation from pending logic

B7
TIMED handling

B8
Post-match completion linkage

11. Coverage rules
11.1 B1
Covered only if at least one real observed match satisfies:

within_freeze_window = yes

expected_backend_outcome = FREEZE_EXPECTED

actual_backend_outcome = FREEZE_CREATED

freeze_record_present = yes

snapshot_frozen_at populated

freeze_lead_hours within configured bounds

row_verdict = PASS

11.2 B2
Covered if at least one or more real matches outside window consistently show:

within_freeze_window = no

expected_backend_outcome = NO_FREEZE_EXPECTED

actual_backend_outcome = NO_FREEZE

freeze_record_present = no

row_verdict = PASS

11.3 B3
Covered only after a real freeze already exists, and a later observation proves:

same real match re-observed after a later runner cycle

no duplicate freeze for same logical match_id + variant

duplicate_record_detected = no

row_verdict = PASS

Pre-window “no mutation” evidence may be mentioned in report notes but must not count as formal B3 coverage.

11.4 B4
Covered only if pairing applies in the real system and the row proves:

expected variants exist

no orphan variant

variant_pair_complete = yes

row_verdict = PASS

If pairing does not apply, B4 remains open or marked not applicable in notes, but not falsely covered.

11.5 B5
Covered only with a real diagnostic case:

expected_backend_outcome = DIAGNOSTIC_EXPECTED

actual_backend_outcome = DIAGNOSTIC_CREATED

diagnostic_present = yes

real diagnostic type present

row_verdict = PASS

11.6 B6
Covered only when a real diagnostic case also proves:

diagnostic does not contaminate valid pending logic

pending_visible_correctly = yes

row_verdict = PASS

11.7 B7
Covered only when a real observed match with status = TIMED proves correct handling.

11.8 B8
Covered only when a previously frozen real match later proves:

completed match linkage remains intact

settlement becomes coherent

post_match_link_ok = yes

row_verdict = PASS

12. Observation collector behavior
12.1 Core responsibilities
The collector must:

inspect runtime sources

discover candidate matches

determine expected backend outcome

inspect actual backend outcome

register only real observations with new evidence

skip redundant observations

12.2 Candidate classes
The collector should look for:

outside-window future matches

inside-window eligible matches

already frozen matches

diagnostic cases

TIMED cases

completed matches eligible for settlement verification

same real frozen match after an additional runner cycle for B3

12.3 No redundancy rule
The collector must not append a new row when all of the following are unchanged:

same match

same status

same within-window result

same store outcome

same evidence state

no new cycle relevance

Example: observing the same outside-window match 20 minutes later in identical state must not create a new row.

12.4 Valid reasons to append a new row
A new row is allowed when:

a match enters window

a freeze appears

a diagnostic appears

settlement state changes

post-match linkage becomes testable

same frozen match is re-observed after a later runner cycle to test B3

materially different evidence exists

13. Expected outcome determination
The collector must compute expected outcome from real state, not from guesses.

Inputs:

kickoff time

current status

effective freeze policy

min/max lead window

source/cache data

existing store data

Rule:

if a confident expected outcome cannot be determined, the collector may write within_freeze_window = unknown and row_verdict = NEEDS_REVIEW

it must not write PASS in that case

14. Duplicate detection
Duplicate detection must be based on logical uniqueness, not row text.

Minimum uniqueness dimension:

match_id

logical variant identity, if variants exist

The collector must inspect whether a new freeze record created after prior freeze constitutes:

valid pair member

duplicate

orphan

inconsistent state

15. Internal state model
track_a_backend_runtime_state.json should store at minimum:

last_run_at_utc

last_runner_cycle_marker

last_store_saved_at

effective_scope

excluded_competitions

last_observable_hash_by_entity

coverage_snapshot

blocking_issues_snapshot

Purpose:

avoid rescanning identical evidence as new

avoid duplicate row creation

support stable report generation

16. Evaluator behavior
16.1 Responsibilities
The evaluator must:

load the CSV

validate rows structurally and semantically

compute current real coverage for B1..B8

detect blocking scope issues

compute Track A status

generate markdown report

16.2 Invalid row handling
If an invalid row is found, the evaluator must:

flag it in report

exclude it from coverage

not silently reinterpret it as valid

16.3 Blocking issues
Blocking issues must be reported explicitly, for example:

BL1 runtime source broken

diagnostics source unavailable

settlement evidence unavailable

match cache missing expected competition scope

17. Track A status rules
17.1 PASS
Track A is PASS only if:

at least 8 real valid observations exist

all mandatory cases B1..B8 are covered with real evidence

no unresolved critical FAIL exists

17.2 FAIL
Track A is FAIL if any critical contradiction is confirmed, including:

freeze missing when clearly expected

freeze created when clearly forbidden

duplicate freeze confirmed

pairing broken where required

diagnostic behavior materially inconsistent

settlement linkage broken

17.3 OPEN
Track A is OPEN in all other situations, including:

insufficient volume

incomplete case coverage

waiting on real runtime events

blocking issues not yet resolved

18. Report format
The evaluator must overwrite the markdown report on every run using exactly these sections:

Runtime Sources Found
Actual runtime sources used

Controls Executed
Checks executed in this run

CSV Cleanup Performed
Only if cleanup occurred in this run; otherwise state no cleanup required

Observations Registered
total valid rows currently in CSV

new rows added in current run

rows ignored due to redundancy

markdown table of rows added or materially updated in current run

Case Coverage
B1: covered / not covered

B2: covered / not covered

B3: covered / not covered

B4: covered / not covered

B5: covered / not covered

B6: covered / not covered

B7: covered / not covered

B8: covered / not covered

Open Coverage Gaps
What is still missing to close open cases

Blocking Scope Issues
Operational blockers affecting valid coverage

Track A Status
OPEN / PASS / FAIL

19. Orchestrator behavior
The orchestrator must:

run collector

run evaluator

print concise execution summary to stdout/log

Required summary:

new rows added

rows skipped as redundant

current coverage count

current blocking issues count

Track A status

20. Scheduling
20.1 Default cadence
Recommended:

freeze runner: every 5 minutes

track A orchestrator: every 10 minutes

20.2 Anti-noise requirement
Even if scheduled every 10 minutes, the orchestrator must avoid redundant rows.

20.3 Critical timing emphasis
The orchestrator must behave correctly around:

first entry into freeze window

first post-freeze rerun

first post-match settlement opportunity

No special manual trigger should be required.

21. Logging
The automation must log at minimum:

run start time

sources loaded

matches inspected

new rows written

rows skipped as redundant

blocking issues found

final Track A status

22. Acceptance criteria
AC-1
If no match is inside freeze window and store remains unchanged, no synthetic rows are created.

AC-2
A real match entering window and freezing successfully produces at least one valid B1 observation row.

AC-3
A later rerun over the same frozen match does not create a duplicate row unless evidence materially changed, and B3 can be evaluated from real evidence.

AC-4
If pairing applies, the system can evaluate B4 from real records without hardcoded assumptions.

AC-5
No GAP or placeholder row ever appears in the CSV.

AC-6
If BL1 runtime source remains broken, it is excluded from coverage and reported as blocking scope issue.

AC-7
The markdown report always reflects real current coverage and never counts preliminary support as formal coverage.

AC-8
Track A remains OPEN until real evidence actually closes cases.

23. Recommended file structure
ops/
  track_a_backend_runtime_observation.csv
  track_a_backend_runtime_observation_report.md
  track_a_backend_runtime_state.json

server/
  ops/
    track-a-observation-collector.ts
    track-a-evaluator.ts
    run-track-a-observation.ts
This exact location may vary, but responsibilities must remain split.

24. Implementation notes
24.1 Cleanup path
If the CSV contains legacy synthetic rows from older runs, the implementation may include a one-time cleanup routine, but it must not become a recurring destructive rewrite.

24.2 Pairing discovery
Do not hardcode variant names into coverage unless the source code or records prove they are authoritative.

24.3 Diagnostics
If B5/B6 cannot be observed organically for a long period, the report must keep them open rather than fabricate evidence.

25. Final statement
This automation exists to replace manual backend observation with an auditable, low-noise, evidence-based validation loop.

It must prefer:

fewer real rows
over

many synthetic or redundant rows.

Track A must progress only when runtime reality produces real evidence.
```

