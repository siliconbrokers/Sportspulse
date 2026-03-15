\# SportPulse — Predictive Engine Runtime Observation & Model Evaluation Plan  
Version: 1.0  
Status: Approved for implementation planning  
Audience: Backend, QA, Product, Internal Ops  
Depends on:  
\- \`SportPulse\_Predictive\_Engine\_Spec\_v1.3\_Final.md\`  
\- final audit \= CONFORMANT  
\- Phase 0–4 completed  
\- PE-78 technically stabilized

\---

\# 1\. Purpose

This document defines the next phase after Phase 4 closeout.

The objective is no longer technical integration only.

The objective is to determine, with real evidence:

1\. whether the experimental prediction feature behaves correctly in real runtime conditions  
2\. whether the predictive model produces useful signal against real match outcomes

This phase must separate:  
\- \*\*feature/runtime validation\*\*  
\- \*\*model performance validation\*\*

Both are required before any controlled expansion decision.

\---

\# 2\. Current State

\#\# Completed  
\- engine spec frozen  
\- engine audit conformant  
\- shadow execution implemented  
\- separate prediction persistence implemented  
\- inspection surface implemented  
\- PD validation completed  
\- PE-78 implemented and technically stabilized  
\- API/integration coverage complete  
\- UI rendering coverage complete

\#\# Not yet proven  
\- runtime behavior on real matches through actual visual inspection  
\- operational coverage in real match flow  
\- predictive usefulness against actual results  
\- whether FULL\_MODE meaningfully outperforms LIMITED\_MODE  
\- whether the feature deserves expansion

\---

\# 3\. Core Principle

The next phase must not confuse these two questions:

\#\# Question A — Runtime/feature  
Does the experimental surface behave correctly on real matches?

\#\# Question B — Model value  
Does the model predict anything useful versus actual outcomes?

A "yes" to A does not imply a "yes" to B.

A failure in B does not necessarily mean A is broken.

They must be tracked separately.

\---

\# 4\. Scope

\#\# In scope  
\- pre-match only  
\- approved competition scope only  
\- experimental detail surface only  
\- observation of real matches  
\- comparison between frozen pre-kickoff prediction snapshot and final result  
\- aggregated evaluation metrics  
\- decision gate for expansion or hold

\#\# Out of scope  
\- map rollout  
\- card rollout  
\- list rollout  
\- radar/global rollout  
\- live-mode expansion  
\- post-match productization  
\- additional competitions  
\- semantic redesign of the predictive engine

\---

\# 5\. Evaluation Tracks

\# 5.1 Track A — Runtime Observation

\#\# Goal  
Validate that the experimental section behaves correctly in real runtime conditions.

\#\# What this track answers  
\- does the section appear when it should?  
\- does it stay absent when it should?  
\- are degraded modes represented honestly?  
\- does the detail page remain stable?  
\- are there snapshot misses, scope issues or fetch failures?

\#\# Minimum evidence required  
\- actual visual inspection on real matches  
\- screenshots or recordings  
\- runtime logs  
\- per-match observation records

\---

\# 5.2 Track B — Model Performance Evaluation

\#\# Goal  
Determine whether predictions provide useful signal against actual match results.

\#\# What this track answers  
\- how often is predicted\_result correct?  
\- how good are the 1X2 probabilities?  
\- how often is the engine usable?  
\- does FULL\_MODE outperform LIMITED\_MODE?  
\- is the model useful enough to justify broader rollout?

\---

\# 6\. Official Evaluation Snapshot Rule

\#\# Requirement  
Every evaluated match must be tied to exactly one official prediction snapshot.

\#\# Official rule  
The evaluation snapshot must be:  
\- the latest valid snapshot generated \*\*before kickoff\*\*  
\- never regenerated after kickoff for evaluation purposes

\#\# Optional stricter variant  
If needed later, use:  
\- latest valid snapshot in a fixed pre-kickoff window (example: 60 to 15 minutes before kickoff)

\#\# Hard rule  
No post-kickoff snapshot may be used for model evaluation.

\---

\# 7\. Data to Record Per Match

\#\# 7.1 Match identification  
\- \`match\_id\`  
\- \`competition\_id\`  
\- \`competition\_key\`  
\- \`home\_team\`  
\- \`away\_team\`  
\- \`scheduled\_kickoff\_utc\`  
\- \`match\_state\_at\_snapshot\`

\#\# 7.2 Prediction snapshot metadata  
\- \`snapshot\_id\`  
\- \`generated\_at\`  
\- \`engine\_version\`  
\- \`spec\_version\`  
\- \`feature\_flag\_state\`  
\- \`prediction\_available\` (boolean)

\#\# 7.3 Prediction content  
\- \`mode\`  
\- \`calibration\_mode\`  
\- \`predicted\_result\`  
\- \`p\_home\_win\`  
\- \`p\_draw\`  
\- \`p\_away\_win\`  
\- \`expected\_goals\_home\`  
\- \`expected\_goals\_away\`  
\- \`favorite\_margin\`  
\- \`draw\_risk\`  
\- \`reasons\`  
\- degradation indicators if any

\#\# 7.4 Runtime observation fields  
\- \`ui\_render\_result\`:  
  \- \`NO\_RENDER\`  
  \- \`NOT\_ELIGIBLE\_RENDER\`  
  \- \`LIMITED\_MODE\_RENDER\`  
  \- \`FULL\_MODE\_RENDER\`  
\- \`ui\_clear\_or\_confusing\`:  
  \- \`CLEAR\`  
  \- \`CONFUSING\`  
\- \`runtime\_issue\`:  
  \- \`NONE\`  
  \- \`FETCH\_ERROR\`  
  \- \`SNAPSHOT\_MISS\`  
  \- \`SCOPE\_MISMATCH\`  
  \- \`OTHER\`  
\- \`runtime\_notes\`  
\- evidence link / screenshot path

\#\# 7.5 Final ground truth  
\- \`final\_match\_state\`  
\- \`final\_home\_goals\`  
\- \`final\_away\_goals\`  
\- \`actual\_result\`:  
  \- \`HOME\_WIN\`  
  \- \`DRAW\`  
  \- \`AWAY\_WIN\`

\---

\# 8\. Runtime Observation Plan (Track A)

\#\# 8.1 Objective  
Confirm that PE-78 behaves correctly on real approved pre-match matches.

\#\# 8.2 Entry condition  
\- feature flag active in the intended environment  
\- at least one approved PD pre-match match available  
\- at least one generated snapshot available

\#\# 8.3 Minimum runtime sample  
\- minimum 8 observed matches to start  
\- target 20–30 observed matches for operational confidence

\#\# 8.4 Mandatory observed cases  
The observation set must include, if naturally available:  
\- at least one FULL\_MODE render  
\- at least one LIMITED\_MODE render  
\- at least one NOT\_ELIGIBLE render  
\- at least one no-render case due to snapshot absence or valid 404

\#\# 8.5 Runtime acceptance checks  
For each observed match, verify:  
\- detail page remains stable  
\- experimental section appears only when appropriate  
\- no residual garbage text or broken layout  
\- LIMITED\_MODE shows degradation honestly  
\- FULL\_MODE shows probabilities without false degradation notice  
\- NOT\_ELIGIBLE does not masquerade as normal prediction  
\- no impact on other portal surfaces

\#\# 8.6 Runtime outputs  
Produce:  
\- per-match observation table  
\- screenshots / evidence  
\- summary counts by render result  
\- summary of runtime issues

\---

\# 9\. Model Evaluation Plan (Track B)

\#\# 9.1 Objective  
Measure predictive usefulness against actual outcomes using the official pre-kickoff snapshot.

\#\# 9.2 Minimum initial sample  
\- exploratory minimum: 30 matches  
\- preferable early evaluation: 50 matches  
\- stronger signal: 100+ matches

\#\# 9.3 Evaluation set rules  
Include only matches that:  
\- belong to approved competition scope  
\- have final result confirmed  
\- have one official valid pre-kickoff snapshot

Matches without official evaluation snapshot must be counted for coverage, but excluded from pure predictive scoring.

\---

\# 10\. Baselines

\#\# 10.1 Purpose  
Raw performance must not be interpreted in isolation.

\#\# 10.2 Minimum required baselines

\#\#\# Baseline A — Max-probability class baseline  
Use the model's own highest class as categorical prediction.  
This is effectively the direct categorical baseline.

\#\#\# Baseline B — Simple historical/class frequency baseline  
Use a naive competition-level baseline based on class frequency or a simple always-most-common-class strategy.

\#\# 10.3 Optional later baseline  
\- bookmaker / external market baseline  
\- external model baseline

These are optional for later comparison, not required now.

\---

\# 11\. Required Metrics

\#\# 11.1 Coverage metrics  
Mandatory:  
\- total matches observed  
\- matches with official evaluation snapshot  
\- snapshot availability rate  
\- no-render rate  
\- distribution of:  
  \- FULL\_MODE  
  \- LIMITED\_MODE  
  \- NOT\_ELIGIBLE  
  \- missing snapshot

\#\# 11.2 Categorical performance  
Mandatory:  
\- accuracy of \`predicted\_result\`  
\- confusion matrix for HOME\_WIN / DRAW / AWAY\_WIN

\#\# 11.3 Probability quality  
At least one of these is mandatory; both recommended:  
\- Brier score for 1X2  
\- multiclass log loss

\#\# 11.4 Segment performance  
Mandatory:  
\- accuracy by \`mode\`  
\- Brier/log loss by \`mode\`

This is required to verify whether FULL\_MODE is actually superior to LIMITED\_MODE.

\#\# 11.5 xG coherence  
Exploratory, not primary:  
\- compare expected goals vs final goals  
\- aggregate mean absolute error for home and away if useful

\#\# 11.6 Operational quality  
Mandatory:  
\- runtime error count  
\- endpoint miss count  
\- snapshot miss count  
\- scope mismatch count

\---

\# 12\. Recommended Output Tables

\#\# 12.1 Per-match evaluation table  
Columns:  
\- match\_id  
\- kickoff  
\- home\_team  
\- away\_team  
\- snapshot\_generated\_at  
\- mode  
\- predicted\_result  
\- p\_home\_win  
\- p\_draw  
\- p\_away\_win  
\- expected\_goals\_home  
\- expected\_goals\_away  
\- actual\_result  
\- final\_score  
\- categorical\_hit  
\- ui\_render\_result  
\- runtime\_issue  
\- notes

\#\# 12.2 Aggregated summary table  
Columns:  
\- total\_matches  
\- evaluated\_matches  
\- snapshot\_rate  
\- full\_mode\_count  
\- limited\_mode\_count  
\- not\_eligible\_count  
\- no\_render\_count  
\- accuracy\_total  
\- accuracy\_full\_mode  
\- accuracy\_limited\_mode  
\- brier\_total  
\- brier\_full\_mode  
\- brier\_limited\_mode  
\- runtime\_error\_rate

\---

\# 13\. Backfill / Replay (Optional Acceleration Track)

\#\# Purpose  
Speed up learning without waiting only for future matches.

\#\# Allowed only if  
\- match inputs can be reconstructed honestly  
\- no post-match contamination is introduced  
\- reconstructed snapshots are clearly marked as replay/backfill, not live-forward evaluation

\#\# Rule  
Replay/backfill results must never be mixed invisibly with forward live evaluation.  
They must be tagged separately.

\#\# Recommendation  
Prefer forward live evaluation as the primary decision source.  
Use replay/backfill only to accelerate diagnosis.

\---

\# 14\. Decision Gate After Initial Sample

After the first serious sample (recommended: 30–50 matches), classify into one of three outcomes.

\#\# Outcome A — Expansion candidate  
Conditions:  
\- runtime stable  
\- honest rendering confirmed  
\- snapshot coverage acceptable  
\- FULL\_MODE materially useful  
\- predictive metrics show signal above naive baseline  
\- no blocker found

Allowed next step:  
\- propose narrowly scoped expansion

\#\# Outcome B — Keep experimental, do not expand yet  
Conditions:  
\- runtime stable  
\- predictive signal unclear or mediocre  
\- coverage insufficient  
\- too many LIMITED\_MODE / NOT\_ELIGIBLE / snapshot misses

Allowed next step:  
\- continue observation  
\- improve coverage/pipeline  
\- do not expand surfaces

\#\# Outcome C — Stop expansion and reassess model  
Conditions:  
\- runtime stable enough but predictive value poor  
\- little or no advantage over baseline  
\- outputs confuse more than help

Allowed next step:  
\- retain internal usage only or pause feature growth  
\- review calibration / model / eligibility logic

\---

\# 15\. Immediate Execution Plan

\#\# Step 1 — Activate minimal real runtime inspection  
Create or enable one internal visual surface to inspect real PD pre-match matches.

\#\# Step 2 — Start match observation log  
Record runtime evidence for the first 8–10 real matches.

\#\# Step 3 — Freeze official evaluation snapshot per match  
Persist the last valid pre-kickoff snapshot as evaluation source.

\#\# Step 4 — Capture final results automatically  
Write the final actual result back to the evaluation dataset.

\#\# Step 5 — Compute initial metrics  
Generate the first aggregated evaluation report after enough completed matches.

\#\# Step 6 — Hold expansion decision  
Do not move to Phase 5 before reviewing runtime \+ model evidence together.

\---

\# 16\. Explicit Do / Do Not

\#\# Do  
\- observe real matches  
\- freeze pre-kickoff evaluation snapshots  
\- compare against actual final results  
\- measure coverage and performance separately  
\- segment results by mode  
\- compare against naive baseline  
\- document decision outcome

\#\# Do not  
\- use post-kickoff snapshots for evaluation  
\- treat UI correctness as proof of model quality  
\- treat a few anecdotal matches as proof  
\- expand to other surfaces before decision gate  
\- hide coverage problems behind accuracy only

\---

\# 17\. Final Decision Rule

The next meaningful product decision must be based on both:

1\. runtime/feature evidence  
2\. model performance evidence

No expansion proposal is valid if it uses only one of these two.

