\# SportPulse — Incremental Rollout Plan Update for Predictive Engine  
Version: 1.0  
Status: Approved for planning  
Audience: Backend, Integration, QA, Internal UI/Admin  
Depends on:  
\- \`SportPulse\_Predictive\_Engine\_Spec\_v1.3\_Final.md\`  
\- auditoría final \`CONFORMANT\`  
\- paquete \`packages/prediction\` en estado frozen

\---

\# 1\. Purpose

This document updates the implementation plan after the predictive engine reached final conformant status.

The objective is \*\*not\*\* to expose the engine across the full portal immediately.

The objective is to integrate it \*\*incrementally\*\*, with:  
\- zero disruption to the current portal behavior  
\- isolated persistence  
\- internal inspection first  
\- public exposure only after controlled validation

This rollout is explicitly designed to avoid:  
\- breaking existing UI flows  
\- mixing experimental outputs with production data  
\- losing observability during early validation  
\- creating uncontrolled scope expansion

\---

\# 2\. Current Decision

\#\# 2.1 Facts  
\- The predictive engine package is frozen and conformant.  
\- The missing degradation coverage for \`tailMassExceeded \= true\` is closed.  
\- The current portal must remain stable.  
\- There is no plan to integrate this immediately across all frontend surfaces.

\#\# 2.2 Decision  
The rollout will follow a \*\*shadow-first, backend-first, opt-in exposure\*\* strategy.

The engine will be:  
1\. executed in shadow mode  
2\. persisted separately  
3\. inspected internally  
4\. validated on limited competition scope  
5\. optionally exposed through an isolated experimental view  
6\. expanded only after explicit acceptance gates

\---

\# 3\. Non-Goals

The following are out of scope for the first rollout stages:

\- replacing existing public portal match cards  
\- replacing existing map behavior  
\- replacing existing list views  
\- integrating predictions in all competitions at once  
\- adding cosmetic or decorative UI layers  
\- building live-mode complexity in phase 1  
\- post-match enrichment beyond debug/inspection  
\- speculative product redesign triggered by the new engine

If any of these are proposed during implementation, they must be rejected unless explicitly approved in a later phase.

\---

\# 4\. Rollout Principles

\#\# 4.1 No disruption  
Existing portal screens must continue to work exactly as they do now unless a later phase explicitly enables a controlled experimental surface.

\#\# 4.2 Separate storage  
Predictive engine outputs must not overwrite or mutate the existing production structures currently used by the portal.

\#\# 4.3 Internal observability before public exposure  
No public-facing UI integration is allowed before the system can be inspected internally with enough detail to diagnose mode, degradation, reasons, timestamps and payloads.

\#\# 4.4 Minimal surface first  
The first useful deliverable is not a global UI rollout. The first useful deliverable is a stable shadow pipeline plus internal inspection.

\#\# 4.5 Controlled scope  
Rollout expands:  
\- from one competition to more competitions  
\- from internal visibility to optional experimental visibility  
\- from core outputs to secondary outputs  
\- from pre-match only to broader states

\---

\# 5\. Implementation Strategy

\#\# 5.1 High-level sequence

\#\#\# Phase 0 — Freeze baseline  
Lock the predictive engine baseline and planning inputs.

\#\#\# Phase 1 — Shadow execution  
Run the engine on real portal matches without affecting current frontend behavior.

\#\#\# Phase 2 — Separate persistence  
Store normalized inputs and prediction outputs in dedicated storage.

\#\#\# Phase 3 — Internal inspection surface  
Create an internal-only inspection endpoint or page.

\#\#\# Phase 4 — Limited validation  
Validate behavior on one competition and a restricted match subset.

\#\#\# Phase 5 — Experimental exposure  
Optionally expose a minimal prediction section behind feature flags in one isolated view only.

\#\#\# Phase 6 — Controlled expansion  
Expand only after objective acceptance criteria are met.

\---

\# 6\. Scope by Priority

\#\# 6.1 Priority P0 — Mandatory  
These items are required before any UI exposure:

\- input adapter from portal match domain into engine request  
\- shadow execution pipeline  
\- separate prediction persistence  
\- version tracking  
\- mode/reasons/degradation storage  
\- internal inspection endpoint or page  
\- one-competition rollout support  
\- feature flag infrastructure for future exposure

\#\# 6.2 Priority P1 — High-value outputs  
These should be visible in internal inspection first:

\- \`mode\`  
\- \`reasons\`  
\- \`calibration\_mode\`  
\- \`p\_home\_win\`  
\- \`p\_draw\`  
\- \`p\_away\_win\`  
\- \`predicted\_result\`  
\- \`expected\_goals\_home\`  
\- \`expected\_goals\_away\`

\#\# 6.3 Priority P2 — Useful context  
Expose internally after P1 is stable:

\- \`favorite\_margin\`  
\- \`draw\_risk\`  
\- degradation indicators  
\- selected internals or debug panels  
\- timestamps and version metadata

\#\# 6.4 Priority P3 — Secondary outputs  
Do not prioritize early unless explicitly useful:

\- secondary predictions  
\- advanced explanation layers  
\- summary badges for non-debug surfaces

\#\# 6.5 Priority P4 — Deferred  
Explicitly defer:

\- map-level rollout  
\- match card rollout  
\- full-list rollout  
\- live-mode aggressive updates  
\- broad public user exposure

\---

\# 7\. Phase-by-Phase Requirements

\# 7.1 Phase 0 — Freeze Baseline

\#\# Objective  
Prevent semantic drift while integration starts.

\#\# Requirements  
\- Reference the frozen engine spec and final audit result in planning metadata.  
\- Record package version / commit / tag used for rollout.  
\- Block arbitrary semantic changes during rollout unless fixing an objective implementation bug.

\#\# Exit criteria  
\- frozen reference identified  
\- implementation plan updated to use shadow-first strategy  
\- no open semantic redesign tasks attached to initial rollout

\---

\# 7.2 Phase 1 — Shadow Execution

\#\# Objective  
Execute the predictive engine on real match data without changing public portal behavior.

\#\# Requirements  
\- Select match candidates from the existing portal domain.  
\- Build a deterministic adapter from portal match data to engine input.  
\- Execute predictions out of band from the public rendering path.  
\- Do not block or alter existing portal responses if the prediction flow fails.

\#\# Constraints  
\- Shadow execution must be fault-isolated.  
\- Prediction errors must not break current match pages or existing APIs.

\#\# Exit criteria  
\- predictions are generated for selected real matches  
\- no public behavior changes  
\- failures are logged and inspectable

\---

\# 7.3 Phase 2 — Separate Persistence

\#\# Objective  
Store predictive outputs and metadata independently from existing portal data.

\#\# Required storage model  
At minimum, persist:

\- \`match\_id\`  
\- \`competition\_id\`  
\- \`generated\_at\`  
\- \`engine\_version\`  
\- \`spec\_version\`  
\- normalized input snapshot  
\- response payload snapshot  
\- \`mode\`  
\- \`reasons\`  
\- degradation indicators  
\- generation status  
\- error details when generation fails

\#\# Rules  
\- Existing portal match tables must not be overwritten by prediction payloads.  
\- Prediction storage must support multiple runs over time if needed.  
\- Each stored payload must be traceable to the source match and generation timestamp.

\#\# Exit criteria  
\- prediction result retrieval is possible by match id  
\- multiple records can be distinguished by timestamp/version  
\- no collision with existing production schemas

\---

\# 7.4 Phase 3 — Internal Inspection Surface

\#\# Objective  
Allow fast inspection of predictive outputs without exposing them publicly.

\#\# Acceptable forms  
Either of these is acceptable:  
\- internal endpoint(s)  
\- admin/labs page  
\- protected diagnostic page

\#\# Minimum display/inspection data  
\- match id  
\- competition  
\- teams  
\- match datetime  
\- generation status  
\- generated\_at  
\- engine/spec version  
\- \`mode\`  
\- \`reasons\`  
\- \`calibration\_mode\`  
\- main 1X2 probabilities  
\- predicted result  
\- expected goals  
\- degradation notes  
\- raw payload / internals in collapsible form

\#\# Rules  
\- this surface must be isolated from public navigation  
\- access should be restricted to admin/internal users if auth exists  
\- this surface is diagnostic, not product-polished

\#\# Exit criteria  
\- any shadow-generated match can be inspected quickly  
\- degraded responses can be diagnosed without reading logs only  
\- engineers can compare match source data to prediction output

\---

\# 7.5 Phase 4 — Limited Validation

\#\# Objective  
Validate the predictive engine behavior under controlled scope before any public exposure.

\#\# Initial validation scope  
\- one competition only  
\- pre-match only  
\- controlled subset of matches  
\- no dependency on live refresh behavior

\#\# Validation dimensions  
\#\#\# Technical  
\- no silent failures  
\- no malformed outputs  
\- valid mode/reasons combinations  
\- correct degradation behavior

\#\#\# Integration  
\- correct match association  
\- correct timestamping  
\- correct persistence  
\- stable adapter behavior

\#\#\# Product usefulness  
\- output is interpretable  
\- main probabilities look plausible  
\- degraded responses are understandable and not misleading

\#\# Exit criteria  
\- internal validation completed on the selected competition  
\- major adapter or mapping issues resolved  
\- no blocker preventing isolated exposure

\---

\# 7.6 Phase 5 — Experimental Exposure

\#\# Objective  
Expose the prediction output in one minimal, controlled surface only.

\#\# Allowed first exposure  
Only one of the following:  
\- internal-only detail view  
\- admin-only detail view  
\- feature-flagged experimental section in match detail

\#\# Disallowed in first exposure  
\- map cards  
\- general match list cards  
\- radar/global ranking views  
\- broad rollout across all views

\#\# Minimum visible fields  
\- predicted result  
\- 1X2 probabilities  
\- expected goals  
\- state/mode notice if degraded  
\- concise reason/fallback note when relevant

\#\# Rules  
\- feature flag must allow instant disable  
\- existing public detail page must remain stable if experimental section is off  
\- degraded states must not be displayed as if they were normal calibrated outputs

\#\# Exit criteria  
\- minimal experimental section works without breaking existing detail page  
\- can be toggled on/off cleanly  
\- degraded cases are represented honestly

\---

\# 7.7 Phase 6 — Controlled Expansion

\#\# Objective  
Increase coverage only after earlier phases are stable.

\#\# Expansion order  
1\. one competition → more competitions  
2\. internal inspection → experimental detail exposure  
3\. pre-match only → broader state support  
4\. core outputs → secondary outputs  
5\. isolated view → additional surfaces

\#\# Hard rule  
No phase may expand to a broader surface until the previous phase has explicit acceptance.

\#\# Exit criteria  
\- rollout decisions documented  
\- each expansion tied to explicit acceptance, not intuition

\---

\# 8\. Suggested Data Structures

\#\# 8.1 Suggested tables / collections

\#\#\# \`prediction\_snapshot\`  
Stores one generated output per match/version/time.

Suggested fields:  
\- id  
\- match\_id  
\- competition\_id  
\- generated\_at  
\- engine\_version  
\- spec\_version  
\- request\_payload\_json  
\- response\_payload\_json  
\- mode  
\- calibration\_mode  
\- reasons\_json  
\- degradation\_flags\_json  
\- generation\_status

\#\#\# \`prediction\_error\_log\`  
Stores failed generation attempts.

Suggested fields:  
\- id  
\- match\_id  
\- competition\_id  
\- generated\_at  
\- engine\_version  
\- error\_code  
\- error\_message  
\- stack\_or\_context\_json

\#\#\# \`prediction\_feature\_flags\`  
Optional if not already covered by platform flags.

Suggested fields:  
\- competition\_id  
\- enabled\_for\_shadow  
\- enabled\_for\_internal\_view  
\- enabled\_for\_experimental\_detail  
\- enabled\_for\_public\_surface

\#\# 8.2 Notes  
Exact schema can differ, but the separation principle is mandatory.

\---

\# 9\. Feature Flag Strategy

\#\# Required granularity  
Flags should be configurable at least by:

\- environment  
\- competition  
\- surface  
\- visibility level

\#\# Recommended surfaces  
\- shadow execution  
\- internal inspection  
\- experimental detail section  
\- future public exposure

\#\# Rule  
No experimental UI should depend on code removal for deactivation. It must be switchable by flag.

\---

\# 10\. Acceptance Criteria by Milestone

\#\# Milestone A — Shadow Ready  
\- engine runs on real selected matches  
\- outputs are stored separately  
\- no impact on existing portal UX  
\- failures do not break existing flows

\#\# Milestone B — Internally Inspectable  
\- outputs can be inspected by match  
\- modes, reasons and degradations are visible  
\- main probabilities and expected goals are visible

\#\# Milestone C — Validated on One Competition  
\- selected competition behaves consistently  
\- degraded cases are diagnosable  
\- no unresolved blocker in adapter or persistence

\#\# Milestone D — Experimental Detail Exposure  
\- feature-flagged section is available in isolated detail context  
\- honest degraded-state representation  
\- public portal remains unchanged when flag is off

\#\# Milestone E — Expansion Eligible  
\- documented evidence that earlier milestones are stable  
\- explicit approval for wider rollout

\---

\# 11\. Risks and Controls

\#\# Risk 1 — breaking current portal behavior  
\#\#\# Control  
Shadow-only execution and separate persistence before any exposure.

\#\# Risk 2 — confusion between experimental and production data  
\#\#\# Control  
Dedicated prediction storage and isolated inspection surfaces.

\#\# Risk 3 — inability to diagnose degraded or null-heavy outputs  
\#\#\# Control  
Expose \`mode\`, \`reasons\`, \`calibration\_mode\`, degradations and timestamps in internal view.

\#\# Risk 4 — rollout scope explosion  
\#\#\# Control  
Strict phase gates and deferred surfaces.

\#\# Risk 5 — adapter silently corrupts inputs  
\#\#\# Control  
Store normalized input snapshots and validate against known fixtures where possible.

\---

\# 12\. Explicit Do/Do-Not List

\#\# Do  
\- implement the adapter  
\- run in shadow mode  
\- store outputs separately  
\- build internal inspection first  
\- validate on one competition  
\- expose later through a minimal flagged surface

\#\# Do not  
\- push predictions into all portal views  
\- overwrite existing match presentation logic  
\- start with map/list/radar integration  
\- mix experimental outputs with current production payloads  
\- hide degraded states as if they were normal full outputs  
\- reopen predictive engine semantics during integration

\---

\# 13\. Immediate Next Tasks

\#\# Task 1  
Update the implementation plan to reflect this rollout model.

\#\# Task 2  
Define the first target competition for shadow execution.

\#\# Task 3  
Implement the prediction input adapter.

\#\# Task 4  
Implement separate persistence for prediction snapshots.

\#\# Task 5  
Create internal inspection endpoint/page for one match and recent generated matches.

\#\# Task 6  
Run controlled validation and document findings before any UI exposure.

\---

\# 14\. Final Decision

The predictive engine is frozen and must now move to \*\*incremental operational integration\*\*.

The correct next step is \*\*not\*\* global portal rollout.

The correct next step is:  
\- shadow execution  
\- separate persistence  
\- internal inspection  
\- single-competition validation  
\- isolated flagged exposure later  
