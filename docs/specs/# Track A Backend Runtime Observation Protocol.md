\# Track A Backend Runtime Observation Protocol

Version: 1.0   
Status: Closed   
Scope: Runtime observation and formal evidence collection for backend behavior under the active freeze protocol, without any dependency on UI   
Audience: Ops, QA, Backend, Product

\---

\# 1\. Purpose

This protocol defines how \*\*Track A — Backend Runtime Observation\*\* must be executed and documented.

Track A exists to verify that the backend predict/freeze engine behaves correctly in \*\*real runtime conditions\*\* after code-level integrity checks have passed.

This is not a coding phase.   
This is not an informal review.   
This is not a UI validation protocol.

It is a \*\*controlled backend observation protocol\*\* with mandatory evidence.

\---

\# 2\. Why this protocol exists

The original Track A concept assumed the existence of a product UI capable of showing:

\- render mode  
\- prediction visibility  
\- post-match visibility  
\- UI consistency

That assumption is false in the current system state.

Therefore, Track A must be redefined strictly around \*\*backend-observable runtime behavior\*\*, using:

\- store records  
\- runner outputs  
\- logs  
\- match source data  
\- diagnostics  
\- pending records  
\- settlement linkage

Any attempt to validate UI behavior without an actual UI is invalid.

\---

\# 3\. What Track A validates

Track A validates the following in real backend operation:

\- eligible matches freeze when they should  
\- matches outside the valid window do not freeze  
\- multiple runner executions do not create duplicate records  
\- variant pairing remains complete and consistent when applicable  
\- diagnostics are created correctly when warranted  
\- diagnostics do not contaminate valid pending logic  
\- \`TIMED\` handling follows configured eligibility rules  
\- frozen records remain consistent through post-match completion and settlement linkage

\---

\# 4\. What Track A does NOT validate

Track A does \*\*not\*\* validate:

\- frontend render behavior  
\- visual mode selection  
\- prediction card visibility  
\- post-match visual presentation  
\- UX correctness  
\- performance under load  
\- statistical quality of predictions  
\- long-run business outcomes

Track A is strictly about \*\*runtime backend correctness\*\*.

\---

\# 5\. Preconditions

Track A may begin only if all of the following are true:

\- active freeze policy is \`v2\_window\_based\`  
\- legacy invalid records have been cleared  
\- server is running corrected code  
\- store schema is confirmed valid  
\- runner guards are confirmed valid  
\- backend evidence sources are accessible  
\- observed matches belong to the supported competition scope

\---

\# 6\. Required evidence sources

Each observation row must be supported by backend evidence traceable to a specific \`match\_id\`.

Accepted evidence sources include:

\- store inspection output  
\- runner logs  
\- diagnostic logs  
\- match source/cache inspection  
\- pending-record inspection  
\- settlement inspection  
\- any backend dump that clearly identifies the same match

A row without evidence is not valid.

\---

\# 7\. Mandatory observation table

Every observed match must produce exactly one row in the observation table.

\#\# 7.1 Required columns

| Column | Type | Description |  
|---|---|---|  
| \`observation\_id\` | string | Unique row identifier |  
| \`observed\_at\_utc\` | datetime | Time of observation in UTC |  
| \`observer\` | string | Person or role performing the observation |  
| \`match\_id\` | string | Stable match identifier |  
| \`competition\_code\` | string | Competition code |  
| \`home\_team\` | string | Home team display name |  
| \`away\_team\` | string | Away team display name |  
| \`kickoff\_utc\` | datetime | Kickoff time in UTC |  
| \`match\_status\_at\_observation\` | enum | Match status seen at observation time |  
| \`within\_freeze\_window\` | enum | \`yes\` / \`no\` / \`unknown\` |  
| \`expected\_backend\_outcome\` | enum | Expected backend outcome |  
| \`actual\_backend\_outcome\` | enum | Observed backend outcome |  
| \`freeze\_record\_present\` | enum | \`yes\` / \`no\` |  
| \`diagnostic\_present\` | enum | \`yes\` / \`no\` |  
| \`diagnostic\_type\` | enum | \`none\` / \`MISSED\_FREEZE\_WINDOW\` / \`NO\_START\_TIME\` / \`other\` |  
| \`variant\_pair\_complete\` | enum | \`yes\` / \`no\` / \`n.a.\` |  
| \`snapshot\_frozen\_at\` | datetime/null | Freeze snapshot time if present |  
| \`freeze\_lead\_hours\` | number/null | Lead time at freeze if present |  
| \`duplicate\_record\_detected\` | enum | \`yes\` / \`no\` |  
| \`pending\_visible\_correctly\` | enum | \`yes\` / \`no\` / \`n.a.\` |  
| \`settlement\_state\` | enum | Settlement state |  
| \`post\_match\_link\_ok\` | enum | \`yes\` / \`no\` / \`n.a.\` |  
| \`evidence\_ref\` | string | Log/store/query reference |  
| \`notes\` | text | Short factual notes only |  
| \`covered\_case\_ids\` | string | One or more case IDs from Section 10 |  
| \`row\_verdict\` | enum | \`PASS\` / \`FAIL\` / \`NEEDS\_REVIEW\` |

\---

\# 8\. Allowed values

\#\# 8.1 \`expected\_backend\_outcome\`

Allowed values:

\- \`FREEZE\_EXPECTED\`  
\- \`NO\_FREEZE\_EXPECTED\`  
\- \`DIAGNOSTIC\_EXPECTED\`  
\- \`SETTLEMENT\_EXPECTED\`

\#\# 8.2 \`actual\_backend\_outcome\`

Allowed values:

\- \`FREEZE\_CREATED\`  
\- \`NO\_FREEZE\`  
\- \`DIAGNOSTIC\_CREATED\`  
\- \`SETTLED\`  
\- \`INCONSISTENT\`

\#\# 8.3 \`settlement\_state\`

Allowed values:

\- \`n.a.\`  
\- \`pending\`  
\- \`eligible\_for\_settlement\`  
\- \`settled\`  
\- \`failed\`

\#\# 8.4 \`row\_verdict\`

Allowed values:

\- \`PASS\`  
\- \`FAIL\`  
\- \`NEEDS\_REVIEW\`

\`NEEDS\_REVIEW\` must be used sparingly. It is not a garbage bucket.

\---

\# 9\. Evidence rules

\#\# 9.1 Evidence is mandatory

A row is valid only if it includes traceable backend evidence.

At least one of the following must exist:

\- store record dump  
\- log output  
\- diagnostic output  
\- pending-record inspection  
\- settlement inspection  
\- backend trace output linked to the same \`match\_id\`

\#\# 9.2 Evidence must be unambiguous

Evidence must satisfy all of the following:

\- clearly identify the observed \`match\_id\`  
\- correspond to the same observed time window  
\- support the claimed backend outcome  
\- be reviewable by another person

\#\# 9.3 Invalid evidence patterns

The following do \*\*not\*\* count as evidence:

\- “it looked fine”  
\- memory-based observation  
\- notes without source output  
\- logs without \`match\_id\`  
\- inferred behavior without store/log confirmation  
\- screenshots of unrelated shells or tabs without traceability

\---

\# 10\. Mandatory backend runtime cases

Track A is not complete until all cases below have been covered with valid evidence.

\#\# Case B1 — Eligible match enters freeze window and freezes correctly

A match that becomes eligible within the configured freeze window must create the expected freeze record.

\#\#\# Minimum expectations  
\- \`within\_freeze\_window \= yes\`  
\- \`expected\_backend\_outcome \= FREEZE\_EXPECTED\`  
\- \`actual\_backend\_outcome \= FREEZE\_CREATED\`  
\- \`freeze\_record\_present \= yes\`  
\- \`snapshot\_frozen\_at\` populated  
\- \`freeze\_lead\_hours\` within valid range  
\- no invalid diagnostic attached

\---

\#\# Case B2 — Match outside freeze window does not freeze

A match clearly outside the valid freeze window must not create a freeze record.

\#\#\# Minimum expectations  
\- \`within\_freeze\_window \= no\`  
\- \`expected\_backend\_outcome \= NO\_FREEZE\_EXPECTED\`  
\- \`actual\_backend\_outcome \= NO\_FREEZE\`  
\- \`freeze\_record\_present \= no\`  
\- no false positive freeze created

\---

\#\# Case B3 — Re-run idempotence

Re-running the runner must not create duplicate freeze records for the same logical entity.

\#\#\# Minimum expectations  
\- same \`match\_id\` re-observed after additional runner activity  
\- \`duplicate\_record\_detected \= no\`  
\- no contradictory change in freeze state  
\- no second record created for the same logical \`match\_id \+ variant\`

\---

\#\# Case B4 — Variant pairing integrity

If the engine requires multiple related records or variants, the pairing must remain complete and coherent.

\#\#\# Minimum expectations  
\- \`variant\_pair\_complete \= yes\` when applicable  
\- no orphan variant  
\- no partial freeze state masquerading as complete

If pairing does not apply to the observed case, mark \`n.a.\` and do not count that row for this case.

\---

\#\# Case B5 — Legitimate diagnostic generation

A real case must be observed where a diagnostic is correctly created.

\#\#\# Acceptable examples  
\- \`MISSED\_FREEZE\_WINDOW\`  
\- \`NO\_START\_TIME\`

\#\#\# Minimum expectations  
\- \`expected\_backend\_outcome \= DIAGNOSTIC\_EXPECTED\`  
\- \`actual\_backend\_outcome \= DIAGNOSTIC\_CREATED\`  
\- \`diagnostic\_present \= yes\`  
\- \`diagnostic\_type\` valid and evidenced  
\- no fake freeze record substituted for the diagnostic

\---

\#\# Case B6 — Diagnostic isolation

A diagnostic must not contaminate valid pending logic or pretend to be a valid freeze record.

\#\#\# Minimum expectations  
\- diagnostic case observed in store/logs  
\- \`pending\_visible\_correctly \= yes\`  
\- diagnostic excluded from pending logic if system rules require exclusion  
\- no confusion between diagnostic records and pending valid records

\---

\#\# Case B7 — TIMED handling

At least one eligible \`TIMED\` case must be observed if such a case appears in real runtime.

\#\#\# Minimum expectations  
\- \`match\_status\_at\_observation \= TIMED\`  
\- behavior matches configured eligibility rules  
\- no false exclusion if \`TIMED\` is eligible  
\- no false inclusion if other conditions are not satisfied

If no \`TIMED\` case appears during the observation window, this case remains open unless explicitly waived.

\---

\#\# Case B8 — Post-match completion linkage

A frozen match must survive until completion and remain correctly linked to the post-match settlement path.

\#\#\# Minimum expectations  
\- valid freeze record exists before completion  
\- observed match later reaches terminal or settled state  
\- \`settlement\_state\` becomes coherent  
\- \`post\_match\_link\_ok \= yes\`  
\- no broken linkage between frozen record and completed match result

\---

\# 11\. Observation procedure

\#\# Step 1 — Select candidate matches

Select real matches from supported competitions and statuses relevant to current runtime.

Prioritize matches likely to cover still-uncovered mandatory cases.

\#\# Step 2 — Establish expected backend outcome

For each selected match, determine the expected outcome from:

\- active freeze policy  
\- runner guards  
\- kickoff timing  
\- status at observation  
\- source/cache data  
\- store state

Do not guess. If expected outcome cannot be determined, the row cannot be a confident \`PASS\`.

\#\# Step 3 — Inspect actual backend state

Inspect the available backend evidence for the same match:

\- freeze record existence  
\- diagnostic existence  
\- timestamps  
\- lead hours  
\- duplicates  
\- pending visibility  
\- settlement linkage

\#\# Step 4 — Record one row

Complete one row in the observation table with evidence references.

\#\# Step 5 — Assign covered case IDs

Attach one or more \`covered\_case\_ids\` from Section 10\.

\#\# Step 6 — Assign row verdict

Use Section 12 to assign:

\- \`PASS\`  
\- \`FAIL\`  
\- \`NEEDS\_REVIEW\`

\#\# Step 7 — Update coverage tracker

Mark which mandatory cases are already covered and which remain open.

\---

\# 12\. Row verdict rules

\#\# 12.1 PASS

A row is \`PASS\` only if all of the following are true:

\- expected backend outcome is known  
\- actual backend outcome matches expected backend outcome  
\- supporting evidence is sufficient  
\- no contradiction exists in store/log/runner evidence

\#\# 12.2 FAIL

A row is \`FAIL\` if any of the following occurs:

\- freeze created when no freeze should exist  
\- no freeze created when freeze was clearly expected  
\- duplicate records are detected  
\- variant pairing is incomplete where completeness is required  
\- invalid or misleading diagnostic appears  
\- pending logic includes records it should exclude  
\- settlement/post-match linkage is broken  
\- actual outcome is materially inconsistent with expected logic

\#\# 12.3 NEEDS\_REVIEW

A row is \`NEEDS\_REVIEW\` only if:

\- expected backend outcome cannot be established with enough confidence  
\- evidence exists but is incomplete  
\- evidence is not contradictory but not strong enough for a hard decision

\`NEEDS\_REVIEW\` must not be used to hide a probable failure.

\---

\# 13\. Coverage requirements

Track A does not close based on raw match volume alone.

Two conditions must be satisfied.

\#\# 13.1 Minimum volume

At least \*\*8 observation rows\*\* must exist.

\#\# 13.2 Mandatory case coverage

All mandatory cases \`B1\` through \`B8\` must be covered with valid evidence.

If more than 8 rows are required to cover all cases, Track A remains open.

\---

\# 14\. Closure criteria for Track A

Track A is \`PASS\` only if all of the following are true:

\- minimum observation volume satisfied  
\- all mandatory backend cases \`B1–B8\` covered  
\- every covered case includes valid evidence  
\- no unresolved \`FAIL\` remains open  
\- no obvious duplication contradiction remains unresolved  
\- no evidence-free anecdotal observation was counted

Track A is \`FAIL\` if any of the following occurs:

\- critical backend contradiction observed  
\- duplicate or inconsistent freeze behavior confirmed  
\- invalid diagnostic behavior confirmed  
\- broken post-match linkage confirmed  
\- mandatory case evidence reveals material logic failure

Track A is \`OPEN\` if:

\- volume is insufficient  
\- coverage is incomplete  
\- evidence is incomplete  
\- required case types have not yet occurred in runtime

\---

\# 15\. Relationship to CP1 and CP2

Track A does not replace CP1 or CP2.

\#\# Track A → CP1

Track A provides the first structured backend runtime evidence that the engine behaves coherently in real matches.

CP1 should not be interpreted confidently if Track A is incomplete or anecdotal.

\#\# Track A → CP2

CP2 depends on broader completed-match accumulation, but Track A protects against false confidence from aggregate counts without real runtime backend inspection.

\---

\# 16\. Decision gate implication

The decision gate for broader controlled expansion must not depend only on raw completed-match counts.

It should require:

\- Track A closed with valid backend evidence  
\- CP1 passed  
\- CP2 passed  
\- no critical unresolved backend contradiction

\---

\# 17\. Anti-patterns

The following do \*\*not\*\* count as valid Track A completion:

\- watching matches casually without filling the table  
\- relying on counts only  
\- using rows without evidence  
\- calling success because “nothing looked broken”  
\- counting repeated identical observations as new coverage when they add nothing  
\- using \`NEEDS\_REVIEW\` to avoid calling a real failure  
\- pretending UI validation was performed when no UI exists

\---

\# 18\. Recommended minimal observation sheet schema

The operational sheet should contain at least the following columns in this order:

\`\`\`text  
observation\_id,  
observed\_at\_utc,  
observer,  
match\_id,  
competition\_code,  
home\_team,  
away\_team,  
kickoff\_utc,  
match\_status\_at\_observation,  
within\_freeze\_window,  
expected\_backend\_outcome,  
actual\_backend\_outcome,  
freeze\_record\_present,  
diagnostic\_present,  
diagnostic\_type,  
variant\_pair\_complete,  
snapshot\_frozen\_at,  
freeze\_lead\_hours,  
duplicate\_record\_detected,  
pending\_visible\_correctly,  
settlement\_state,  
post\_match\_link\_ok,  
evidence\_ref,  
notes,  
covered\_case\_ids,  
row\_verdict  
---

19\. Recommended review cadence

The observation table should be reviewed at least at the following moments:

* after first real freeze creation

* after first completed eligible match

* after first diagnostic case

* after first `TIMED` case if one appears

* after enough rows exist to assess Track A closure

Do not postpone review until dozens of matches accumulate. That only delays detection of structural failure.

---

20\. Final statement

Track A is complete only when backend runtime behavior becomes **auditable evidence**, not when someone has “looked at several matches.”

This protocol exists to eliminate anecdotal backend validation and replace it with structured, reviewable runtime proof.

