---
artifact_id: SPEC-SPORTPULSE-PORTAL-MATCH-DETAIL-CARD-UPDATE
title: "Match Detail Card Update Specification"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: portal
slug: match-detail-card-update
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/specs/spec.sportpulse.portal.match-detail-card-update.md
---
\# Match Detail Card Update Spec

\*\*Document ID:\*\* \`match-detail-card-update-spec-v1\`   
\*\*Status:\*\* Ready for implementation   
\*\*Audience:\*\* Frontend, Backend, QA   
\*\*Primary consumer:\*\* Claude (implementation assistant)

\---

\# 1\. Objective

Update the \*\*match detail card\*\* so that it changes its main purpose depending on whether the match is \*\*not finished\*\* or \*\*finished\*\*.

The current issue is that the card keeps showing pre-match context as primary content even after the match has ended. That creates a poor reading experience.

The card must become:

\- a \*\*pre-match context card\*\* when the match is not finished  
\- a \*\*post-match closure/evaluation card\*\* when the match is finished

This spec applies only to the \*\*match detail view\*\*.

\---

\# 2\. Scope

\#\# Included  
\- match detail card structure  
\- conditional rendering by match status  
\- post-match event block  
\- prediction evaluation block  
\- visibility rules for pre-match vs post-match content  
\- acceptance criteria

\#\# Excluded  
\- list cards  
\- map cards  
\- standings pages  
\- tournament brackets  
\- live commentary  
\- rich live match tracking  
\- world cup structure logic

\---

\# 3\. Product rule

The detail card must answer different questions depending on state.

\#\# If the match is not finished  
The card must answer:

\- what is expected to happen  
\- who comes in stronger  
\- what the prediction says

\#\# If the match is finished  
The card must answer:

\- what actually happened  
\- who scored and when  
\- whether the prediction was correct  
\- whether the prediction was close or far from reality

\---

\# 4\. Supported UI states

The card must normalize raw API status into one of these UI states:

\- \`PRE\_MATCH\`  
\- \`IN\_PLAY\`  
\- \`FINISHED\`  
\- \`UNKNOWN\`

\#\# Mapping rule  
Any non-finished state should behave as \*\*pre-match mode\*\*, except \`IN\_PLAY\`, which only needs minimal technical treatment.

\#\#\# Important  
This product is \*\*not\*\* trying to behave like SofaScore.

\`IN\_PLAY\` must not introduce advanced live analysis, live commentary, or a special rich experience.

\---

\# 5\. Card structure

The card must be built from:

1\. \*\*Fixed header\*\*  
2\. \*\*Conditional main body\*\*  
3\. \*\*Optional secondary blocks\*\*

\---

\# 6\. Fixed header

The header must always be visible.

\#\# Required fields  
\- competition name  
\- matchday / round if available  
\- date and time  
\- venue / stadium if available  
\- home team name  
\- home team crest  
\- away team name  
\- away team crest  
\- match score  
\- match status badge

\#\# Rules  
\- The header layout must remain stable across all states.  
\- If score is not available yet, render empty or placeholder-safe values.  
\- If status is unknown, show a neutral badge and do not infer match progression.

\---

\# 7\. Pre-match mode

\#\# Activation  
Use this mode when UI state is:  
\- \`PRE\_MATCH\`  
\- \`IN\_PLAY\`  
\- \`UNKNOWN\` with no finished data

\#\# Goal  
Show expectation and context before final result.

\#\# Required visible blocks

\#\#\# 7.1 Prediction block  
Must show:  
\- main prediction  
\- expected winner  
\- home probability  
\- draw probability if supported  
\- away probability

\#\#\# 7.2 Team form block  
Must show:  
\- recent form for home team  
\- recent form for away team

\#\#\# 7.3 Short pre-match reading  
A short summary line explaining the general expectation.

\#\# Notes  
\- This summary must be short.  
\- Do not add live tactical narrative.  
\- Do not try to interpret the match in real time.

\---

\# 8\. Finished mode

\#\# Activation  
Use this mode when UI state is:  
\- \`FINISHED\`

\#\# Goal  
Turn the detail card into a post-match closure and evaluation view.

\#\# Required visible blocks

\#\#\# 8.1 Final result block  
Must show:  
\- final score  
\- actual winner  
\- prediction result badge

\#\#\# 8.2 Match events block  
Must show, at minimum:  
\- goals  
\- minute of each goal  
\- team side for each goal  
\- chronological order

\#\#\# 8.3 Prediction evaluation block  
Must show:  
\- whether expected winner matched actual winner  
\- whether prediction was close or far  
\- short expectation vs reality reading

\#\#\# 8.4 Short final reading  
One short closing sentence or tag that summarizes the post-match interpretation.

\---

\# 9\. Finished mode content priority

In \`FINISHED\`, the main reading order should be:

1\. final score  
2\. who won  
3\. who scored and when  
4\. whether prediction was correct  
5\. whether result was logical or surprising

The card must not force the user to inspect pre-match comparative tables to understand a finished match.

\---

\# 10\. Match events block

\#\# Minimum supported event type in v1  
\- \`GOAL\`

\#\# Optional event types for v1.1+  
\- \`PENALTY\_GOAL\`  
\- \`OWN\_GOAL\`  
\- \`RED\_CARD\`  
\- \`MISSED\_PENALTY\`

\#\# Required normalized event shape

\`\`\`ts  
type MatchEvent \= {  
 id: string  
 teamSide: 'HOME' | 'AWAY'  
 type: 'GOAL' | 'PENALTY\_GOAL' | 'OWN\_GOAL' | 'RED\_CARD' | 'MISSED\_PENALTY'  
 minute: number  
 extraMinute?: number  
 playerName?: string  
}

## **Sorting rules**

Sort events by:

1. `minute`

2. `extraMinute` if present

3. original order as fallback

## **Rendering options**

Either of these is acceptable:

### **Option A — two-column layout**

* home events on one side

* away events on the other side

### **Option B — single chronological timeline**

* all events ordered by time

* clear visual identification of team side

## **Fallback rule**

If no events are available:

* hide the events block entirely

* do not render fake placeholders

* keep final result and prediction evaluation visible

---

# **11\. Prediction evaluation block**

## **Required normalized input**

type PredictionData \= {  
 expectedWinner?: 'HOME' | 'DRAW' | 'AWAY'  
 homeProbability?: number  
 drawProbability?: number  
 awayProbability?: number  
 actualWinner?: 'HOME' | 'DRAW' | 'AWAY'  
 result?: 'HIT' | 'MISS' | 'PARTIAL'  
 deviation?: 'LOW' | 'MEDIUM' | 'HIGH'  
 narrativeTag?: string  
 shortSummary?: string  
}

## **Required minimum behavior in v1**

### **`HIT`**

Use when expected winner matches actual winner.

### **`MISS`**

Use when expected winner does not match actual winner.

### **`PARTIAL`**

Do **not** use unless there is a formal backend rule for it.

## **Recommendation for v1**

Implement only:

* `HIT`

* `MISS`

Add `PARTIAL` later only if there is a precise product definition.

## **Deviation**

The UI may display:

* `LOW`

* `MEDIUM`

* `HIGH`

But this must come from normalized logic, not arbitrary frontend guessing.

## **Expectation vs reality tag**

The UI may render one normalized interpretation tag, for example:

* `LOGICAL_RESULT`

* `SURPRISE`

* `MORE_BALANCED_THAN_EXPECTED`

* `MORE_OPEN_THAN_EXPECTED`

This must be produced upstream or by a deterministic mapper, not hand-written ad hoc in the component.

---

# **12\. Content to remove from the main focus in finished mode**

When the match is `FINISHED`, these blocks must **not** remain primary:

* home/away performance tables

* points earned at home / away

* total tournament points

* total tournament goals

* pre-match comparative stats intended for forecasting

## **Rule**

If a block explains **how the teams were coming into the match** rather than **how the match ended**, it must not be a main post-match block.

## **Recommended v1 behavior**

Hide these blocks completely in `FINISHED`.

Optional later behavior:

* move them into a collapsed section called something like `Previous context`

---

# **13\. IN\_PLAY treatment**

## **Goal**

Minimal technical rendering only.

## **Allowed content**

* header

* status badge

* partial score if available

* minute if available

## **Not allowed**

* live commentary

* special live tactical analysis

* evolving narrative layer

* rich live center behavior

---

# **14\. Normalized view model**

The detail card must consume a normalized view model.  
 The component must **not** depend directly on raw third-party API responses.

type MatchDetailViewModel \= {  
 matchId: string  
 uiState: 'PRE\_MATCH' | 'IN\_PLAY' | 'FINISHED' | 'UNKNOWN'

 competitionName: string  
 matchday?: number  
 utcDate: string  
 venue?: string

 homeTeam: {  
   id: string  
   name: string  
   crest?: string  
 }

 awayTeam: {  
   id: string  
   name: string  
   crest?: string  
 }

 score: {  
   home?: number  
   away?: number  
 }

 prediction?: {  
   expectedWinner?: 'HOME' | 'DRAW' | 'AWAY'  
   homeProbability?: number  
   drawProbability?: number  
   awayProbability?: number  
   actualWinner?: 'HOME' | 'DRAW' | 'AWAY'  
   result?: 'HIT' | 'MISS' | 'PARTIAL'  
   deviation?: 'LOW' | 'MEDIUM' | 'HIGH'  
   narrativeTag?: string  
   shortSummary?: string  
 }

 form?: {  
   home: string\[\]  
   away: string\[\]  
 }

 events?: Array\<{  
   id: string  
   teamSide: 'HOME' | 'AWAY'  
   type: 'GOAL' | 'PENALTY\_GOAL' | 'OWN\_GOAL' | 'RED\_CARD' | 'MISSED\_PENALTY'  
   minute: number  
   extraMinute?: number  
   playerName?: string  
 }\>  
}  
---

# **15\. Rendering rules**

## **15.1 If `uiState !== FINISHED`**

Render:

* fixed header

* prediction block

* probabilities

* form block

* short pre-match reading

Do **not** render:

* final evaluation block

* post-match events block

## **15.2 If `uiState === FINISHED`**

Render:

* fixed header

* final result block

* match events block if events exist

* prediction evaluation block

* short final reading

Do **not** render as primary:

* form block

* home/away performance tables

* tournament points/goals blocks

* forecast-oriented comparison blocks

## **15.3 If `uiState === IN_PLAY`**

Render:

* fixed header

* minimal technical state content only

Do not create separate complex live UX.

## **15.4 If `uiState === UNKNOWN`**

Render:

* fixed header

* safe fallback values only

Do not infer final result or event-based interpretation.

---

# **16\. UX constraints**

## **General**

* Keep the card readable at a glance.

* Do not overload post-match mode with pre-match stats.

* Do not add long explanatory paragraphs.

## **Pre-match mode**

The user should immediately understand:

* expected winner

* probability split

* who comes in with better form

## **Finished mode**

The user should immediately understand:

* final result

* scorers and minutes

* whether the system got it right

* whether the outcome was logical or surprising

---

# **17\. Acceptance criteria**

## **AC-01 — pre-match rendering**

**Given** a match in non-finished state  
 **When** the user opens match detail  
 **Then** the card shows:

* fixed header

* prediction block

* probability split

* team form

* short pre-match reading

**And** the card does not show:

* final result evaluation

* post-match goal timeline

---

## **AC-02 — finished rendering with events**

**Given** a match in finished state and events are available  
 **When** the user opens match detail  
 **Then** the card shows:

* fixed header

* final score

* actual winner

* prediction result (`HIT` or `MISS`)

* events ordered chronologically

* short post-match reading

**And** the card does not show as primary:

* home/away performance tables

* tournament points/goals summary

* form as a main content block

---

## **AC-03 — finished rendering without events**

**Given** a match in finished state and no normalized events are available  
 **When** the user opens match detail  
 **Then** the card shows:

* fixed header

* final score

* actual winner

* prediction evaluation block

**And** the events block is hidden cleanly without breaking layout.

---

## **AC-04 — in-play minimal behavior**

**Given** a match in `IN_PLAY`  
 **When** the user opens match detail  
 **Then** the card shows:

* fixed header

* partial score if available

* live minute if available

**And** the card does not show:

* live commentary

* live tactical analysis

* dynamic live narrative

---

## **AC-05 — unknown state fallback**

**Given** a match in `UNKNOWN` state  
 **When** the user opens match detail  
 **Then** the card renders safely with:

* fixed header

* neutral state treatment

**And** no finished-only interpretation is shown.

---

# **18\. Non-regression constraints**

This change must not:

* break current header layout

* require all providers to support rich event data

* introduce tight coupling to raw API schema

* create a SofaScore-like live experience

* mix pre-match and post-match primary blocks in the same finished layout

---

# **19\. Implementation guidance**

## **Recommended approach**

* create a normalized `MatchDetailViewModel`

* map raw provider data into that model

* use one detail component with conditional sections by `uiState`

* keep the header stable

* swap the main body by mode

## **Recommended delivery phases**

### **Phase 1**

* introduce `uiState`

* split pre-match vs finished rendering

* hide pre-match comparative blocks in finished mode

* render final result \+ prediction evaluation

### **Phase 2**

* add goal event block

* add chronological event sorting

* add optional event types

### **Phase 3**

* formalize `PARTIAL`

* improve narrative tags and deviation classification

---

# **20\. Summary**

The match detail card must stop being a static layout with fixed blocks.

It must become a conditional view with one clear rule:

* **before the match:** explain expectation

* **after the match:** explain result, events, and whether the prediction was right

Any block that helps forecast but does not help explain a finished match must leave the main focus in `FINISHED`.

