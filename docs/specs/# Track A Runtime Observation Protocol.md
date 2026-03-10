\# Track A Runtime Observation Protocol

Version: 1.0    
Status: Closed    
Scope: Runtime observation and formal evidence collection for real-match behavior under the active freeze protocol    
Audience: Ops, QA, Product, Backend, Frontend

\---

\# 1\. Purpose

This protocol defines how \*\*Track A — Runtime Observation\*\* must be executed and documented.

Track A exists to verify that the system behaves correctly \*\*in real runtime conditions\*\* after code-level freeze integrity checks have passed.

It is not a coding phase.  
It is not an informal visual review.  
It is a \*\*controlled observation protocol\*\* with mandatory evidence.

\---

\# 2\. What Track A validates

Track A validates the following in real operation:

\- runtime eligibility behavior  
\- expected UI render mode selection  
\- visibility or non-visibility of prediction-related elements  
\- presence or absence of freeze records when expected  
\- presence or absence of diagnostics when expected  
\- consistency between backend freeze state and visible product behavior  
\- absence of obvious duplication, incomplete pairing, or invalid rendering

\---

\# 3\. What Track A does NOT validate

Track A does \*\*not\*\* replace:

\- CP0 freeze integrity sanity  
\- deeper aggregate analysis from CP1 / CP2  
\- long-run statistical confidence  
\- performance testing  
\- load testing  
\- exhaustive edge-case simulation

Passing Track A only means that \*\*real observed runtime behavior is formally documented and compatible with expected logic\*\*.

\---

\# 4\. Preconditions

Track A may begin only if all of the following are true:

\- active freeze policy is \`v2\_window\_based\`  
\- legacy invalid records have been cleared  
\- server is running corrected code  
\- store schema is confirmed valid  
\- runner guards are confirmed valid  
\- observation team has access to the product UI and the necessary backend inspection outputs

\---

\# 5\. Mandatory observation table

Every observed match must produce exactly one row in the observation table.

\#\# 5.1 Required columns

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
| \`match\_status\_at\_observation\` | enum | API/runtime status seen at observation time |  
| \`render\_mode\_expected\` | enum | Expected render mode |  
| \`render\_mode\_actual\` | enum | Actual render mode seen in product |  
| \`freeze\_record\_present\` | enum | \`yes\` / \`no\` |  
| \`diagnostic\_present\` | enum | \`none\` / \`MISSED\_FREEZE\_WINDOW\` / \`NO\_START\_TIME\` / \`other\` |  
| \`variant\_pair\_complete\` | enum | \`yes\` / \`no\` / \`n.a.\` |  
| \`snapshot\_frozen\_at\` | datetime/null | Freeze snapshot time if present |  
| \`freeze\_lead\_hours\` | number/null | Lead time at freeze if present |  
| \`prediction\_visible\` | enum | \`yes\` / \`no\` |  
| \`post\_match\_result\_visible\` | enum | \`yes\` / \`no\` |  
| \`ui\_state\_correct\` | enum | \`yes\` / \`no\` |  
| \`notes\` | text | Short factual notes only |  
| \`evidence\_ref\` | string | Screenshot/log reference |  
| \`row\_verdict\` | enum | \`PASS\` / \`FAIL\` / \`NEEDS\_REVIEW\` |  
| \`covered\_case\_ids\` | string | One or more case IDs from Section 7 |

\#\# 5.2 Allowed values for render mode

\`render\_mode\_expected\` and \`render\_mode\_actual\` must use only:

\- \`FULL\_MODE\`  
\- \`LIMITED\_MODE\`  
\- \`NOT\_ELIGIBLE\`  
\- \`NO\_RENDER\`

\---

\# 6\. Evidence rules

A row is not valid unless it includes supporting evidence.

Each observed row must have at least one of:

\- screenshot of the UI state  
\- backend/store inspection output  
\- diagnostic/log output  
\- paired evidence showing both UI and backend state when relevant

\#\# 6.1 Evidence requirements

\- screenshots must be timestamped or traceable to the observation window  
\- backend outputs must clearly identify \`match\_id\`  
\- notes must be factual and concise  
\- no row may rely on memory alone

\#\# 6.2 Invalid evidence patterns

The following do \*\*not\*\* count as valid evidence:

\- “I saw it looked right”  
\- uncaptured manual inspection  
\- no \`match\_id\`  
\- ambiguous screenshots without context  
\- inference without store or UI confirmation

\---

\# 7\. Mandatory runtime cases

Track A is not complete until all mandatory cases below have been covered with valid evidence.

\#\# Case A1 — FULL\_MODE pre-match correct

A match that should render in \`FULL\_MODE\` must visibly do so.

\#\#\# Minimum expectations  
\- expected mode \= actual mode \= \`FULL\_MODE\`  
\- prediction visibility is correct  
\- UI state is correct  
\- no invalid diagnostic attached

\---

\#\# Case A2 — LIMITED\_MODE correct

A match that should render in \`LIMITED\_MODE\` must visibly do so.

\#\#\# Minimum expectations  
\- expected mode \= actual mode \= \`LIMITED\_MODE\`  
\- limited presentation is consistent with product rules  
\- no invalid escalation to \`FULL\_MODE\`

\---

\#\# Case A3 — NOT\_ELIGIBLE handled correctly

A match that is not eligible must be presented as such, without false prediction behavior.

\#\#\# Minimum expectations  
\- expected mode \= actual mode \= \`NOT\_ELIGIBLE\`  
\- prediction is not incorrectly shown as if eligible  
\- no freeze assumption is made without evidence

\---

\#\# Case A4 — NO\_RENDER handled correctly

A match that should not render at all must not render.

\#\#\# Minimum expectations  
\- expected mode \= actual mode \= \`NO\_RENDER\`  
\- absence is intentional and verified  
\- no false UI artifact appears

\---

\#\# Case A5 — Frozen match reaches post-match visibility correctly

A match frozen within the valid window must later reach post-match state without contradiction.

\#\#\# Minimum expectations  
\- freeze record present \= \`yes\`  
\- \`snapshot\_frozen\_at\` populated  
\- \`freeze\_lead\_hours\` within valid range  
\- post-match result visible when applicable  
\- UI remains logically consistent before and after completion

\---

\#\# Case A6 — Valid diagnostic case observed

At least one real case with a legitimate diagnostic must be observed.

\#\#\# Acceptable examples  
\- \`MISSED\_FREEZE\_WINDOW\`  
\- \`NO\_START\_TIME\`

\#\#\# Minimum expectations  
\- diagnostic is valid and evidenced  
\- diagnostic is not duplicated absurdly  
\- diagnostic does not masquerade as a valid freeze record

\---

\#\# Case A7 — TIMED eligibility handled correctly

At least one match in \`TIMED\` status must be observed if it appears in real data.

\#\#\# Minimum expectations  
\- match is treated according to eligibility rules  
\- no false exclusion occurs if \`TIMED\` is supposed to be eligible  
\- no false inclusion occurs outside rules

If no \`TIMED\` case appears during the Track A observation window, mark as \`temporarily unavailable\` and keep Track A open unless explicitly waived.

\---

\#\# Case A8 — Re-observation / idempotence visible behavior

The same match must be re-observed after additional runner activity or later runtime state without invalid duplication or contradictory UI behavior.

\#\#\# Minimum expectations  
\- no duplicated freeze record for the same logical variant  
\- no spurious change in render mode without cause  
\- no contradictory visible state across repeated observation

\---

\# 8\. Observation procedure

\#\# Step 1 — Select candidate matches

Select real matches from supported competitions and statuses relevant to current runtime.

Preference should be given to matches likely to cover uncovered mandatory cases.

\#\# Step 2 — Inspect expected state

For each selected match, determine the expected state from:

\- active product rules  
\- current backend/store state  
\- current match timing and status  
\- eligibility logic

\#\# Step 3 — Inspect actual state

Open the product/UI and record:

\- whether the match renders  
\- how it renders  
\- whether prediction or result elements appear  
\- whether the visible state is coherent

\#\# Step 4 — Inspect backend evidence

Inspect backend/store/log evidence for the same \`match\_id\` when relevant:

\- freeze record presence  
\- diagnostics  
\- snapshot timestamps  
\- pairing completeness

\#\# Step 5 — Fill one observation row

Complete one table row with evidence references.

\#\# Step 6 — Assign row verdict

Use Section 9 to assign:

\- \`PASS\`  
\- \`FAIL\`  
\- \`NEEDS\_REVIEW\`

\#\# Step 7 — Update coverage tracker

Mark which mandatory case IDs are now covered.

\---

\# 9\. Row verdict rules

\#\# PASS

A row is \`PASS\` only if:

\- expected runtime behavior is clearly defined  
\- actual behavior matches expected behavior  
\- evidence is sufficient  
\- no contradiction exists between UI and backend state

\#\# FAIL

A row is \`FAIL\` if any of the following occurs:

\- actual render mode contradicts expected render mode  
\- prediction visibility is wrong  
\- post-match visibility is wrong  
\- freeze record is missing where clearly required  
\- invalid diagnostic appears  
\- duplicated or incomplete pairing is observed  
\- UI state is clearly inconsistent with backend evidence

\#\# NEEDS\_REVIEW

A row is \`NEEDS\_REVIEW\` only if:

\- evidence is incomplete but not contradictory  
\- expected state could not be established with confidence  
\- ambiguous external/runtime conditions prevented hard judgment

\`NEEDS\_REVIEW\` must not be abused to hide failures.

\---

\# 10\. Coverage requirements

Track A does not close based on volume alone.

Two conditions must be satisfied:

\#\# 10.1 Minimum volume

At least \*\*8 observed matches\*\* must be recorded.

\#\# 10.2 Mandatory case coverage

All mandatory cases \`A1\` through \`A8\` must be covered with valid evidence.

If more than 8 matches are needed to cover all 8 cases, Track A remains open until coverage is complete.

\---

\# 11\. Closure criteria for Track A

Track A is \`PASS\` only if all of the following are true:

\- minimum 8 observation rows completed  
\- all mandatory cases \`A1–A8\` covered  
\- every covered case has valid evidence  
\- no unresolved \`FAIL\` remains open  
\- no ambiguous “memory-based” observation is used as evidence  
\- repeated observation does not reveal obvious duplication or contradiction

Track A is \`FAIL\` if:

\- any critical runtime contradiction is observed  
\- evidence shows invalid render behavior in a mandatory case  
\- freeze/diagnostic/runtime behavior is materially inconsistent

Track A is \`OPEN\` if:

\- volume is insufficient  
\- coverage is incomplete  
\- mandatory evidence is missing

\---

\# 12\. Relationship to CP1 and CP2

Track A is an observation protocol.  
It does not replace CP1 or CP2.

\#\# Track A → CP1

Track A provides the first formal runtime evidence that the system behaves coherently in real matches.

CP1 should not be interpreted confidently if Track A is still informal or incomplete.

\#\# Track A → CP2

CP2 depends on a broader completed-match base, but Track A helps prevent false confidence from aggregate counts without runtime inspection.

\---

\# 13\. Decision gate implication

The decision gate for broader controlled expansion must not depend on raw counts alone.

It should require:

\- Track A closed with valid evidence  
\- CP1 passed  
\- CP2 passed  
\- no critical unresolved runtime contradiction

\---

\# 14\. Anti-patterns

The following do \*\*not\*\* count as valid Track A completion:

\- observing matches casually without filling the table  
\- relying on screenshots without match identification  
\- using volume only and ignoring case coverage  
\- declaring success after “everything looked fine”  
\- counting duplicate observations as new coverage when they add nothing  
\- using \`NEEDS\_REVIEW\` to avoid calling a real failure

\---

\# 15\. Recommended minimal observation sheet schema

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
render\_mode\_expected,  
render\_mode\_actual,  
freeze\_record\_present,  
diagnostic\_present,  
variant\_pair\_complete,  
snapshot\_frozen\_at,  
freeze\_lead\_hours,  
prediction\_visible,  
post\_match\_result\_visible,  
ui\_state\_correct,  
covered\_case\_ids,  
evidence\_ref,  
notes,  
row\_verdict  
