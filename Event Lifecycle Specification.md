\# SportPulse — Event Lifecycle Specification  
Version: 1.0  
Status: Final  
Scope: Canonical event state machine, transitions, and snapshot recompute triggers  
Audience: Backend, Frontend, Data, QA, Ops

\#\# 1\. Purpose  
This document defines the canonical lifecycle of an Event (match/game) in SportPulse and how lifecycle changes affect:  
\- canonical storage  
\- signal computation  
\- scoring  
\- snapshot invalidation and rebuild scheduling  
\- UI semantics (agenda, badges, warnings)

This prevents inconsistent behavior when providers change kickoff times, postpone matches, or backfill results.

\#\# 2\. Canonical Event Statuses  
Canonical statuses (from normalization spec):  
\- SCHEDULED  
\- IN\_PROGRESS  
\- FINISHED  
\- POSTPONED  
\- CANCELED  
\- TBD

Notes:  
\- TBD means time or state is not reliably known.  
\- POSTPONED means the event is expected to occur later but the time may be unknown.  
\- CANCELED means event will not occur.

\#\# 3\. Canonical Event Timeline Fields  
Each canonical Event must track these fields:  
\- startTimeUtc (nullable only if status=TBD)  
\- status  
\- lastSeenUtc (when provider last returned this event)  
\- lastChangedUtc (when we last observed a relevant change)  
\- score (nullable unless status=FINISHED)  
\- metadata (json; optional)

Required invariants:  
\- If status \= FINISHED \-\> score must be present (or partialData warning set if missing)  
\- If status \= SCHEDULED \-\> startTimeUtc should be present, otherwise status should be TBD  
\- If status \= POSTPONED \-\> startTimeUtc may be null

\#\# 4\. State Machine (Allowed Transitions)  
Allowed transitions define how the system accepts provider changes.

\#\#\# 4.1 Standard transitions  
\- TBD \-\> SCHEDULED  
\- SCHEDULED \-\> IN\_PROGRESS  
\- IN\_PROGRESS \-\> FINISHED

\#\#\# 4.2 Exceptional transitions  
\- SCHEDULED \-\> POSTPONED  
\- SCHEDULED \-\> CANCELED  
\- POSTPONED \-\> SCHEDULED  
\- POSTPONED \-\> CANCELED  
\- IN\_PROGRESS \-\> POSTPONED (rare; suspended)  
\- IN\_PROGRESS \-\> CANCELED (rare)

\#\#\# 4.3 Backfill and corrections  
Providers may correct historical data:  
\- FINISHED \-\> FINISHED (score correction)  
\- FINISHED \-\> CANCELED (extremely rare, treat as correction)  
\- FINISHED \-\> POSTPONED (treat as correction)

Correction rules:  
\- Changes involving FINISHED require auditing and snapshot invalidation.  
\- Score corrections must be accepted if provider is authoritative.

Forbidden transitions (should be rejected or flagged):  
\- CANCELED \-\> IN\_PROGRESS  
\- CANCELED \-\> FINISHED (unless explicitly supported as correction with audit)  
\- FINISHED \-\> IN\_PROGRESS (reject)

\#\# 5\. Change Detection and Canonical Update Rules  
A canonical event update occurs when any of these fields change:  
\- status  
\- startTimeUtc  
\- score  
\- participants  
\- stage assignment

Define a deterministic “event change hash”:  
\- hash(status, startTimeUtc, score, participants, stageId)

If hash differs from last stored:  
\- update event  
\- set lastChangedUtc \= buildNowUtc  
\- emit an EventChange record

\#\# 6\. EventChange Record (Audit)  
Every relevant change emits an audit record.

EventChange:  
\- eventId  
\- observedAtUtc  
\- changeType: "STATUS" | "TIME" | "SCORE" | "PARTICIPANTS" | "STAGE" | "OTHER"  
\- before: json  
\- after: json  
\- providerKey  
\- providerEventId (stored internally only)  
\- severity: "low" | "medium" | "high"

Severity rules:  
\- SCORE change \-\> high  
\- status transition to/from FINISHED \-\> high  
\- kickoff time change \> 2 hours \-\> medium  
\- postponement/cancel \-\> high

\#\# 7\. Impact on Signals (Rules)  
Signals affected by lifecycle changes must be recomputed deterministically.

\#\#\# 7.1 FORM\_POINTS\_N impact  
FORM\_POINTS\_N uses last N FINISHED events.  
Recompute for participants when:  
\- an event becomes FINISHED  
\- a FINISHED event score is corrected  
\- a FINISHED event becomes non-finished (correction)  
\- participants in an event change (rare)

\#\#\# 7.2 NEXT\_EVENT\_HOURS impact  
NEXT\_EVENT\_HOURS uses next SCHEDULED/TBD event after buildNowUtc.  
Recompute for participants when:  
\- startTimeUtc changes  
\- status changes among {TBD, SCHEDULED, POSTPONED, CANCELED}  
\- an event is added/removed from the future window

\#\#\# 7.3 PROXIMITY\_BONUS impact  
Recompute whenever NEXT\_EVENT\_HOURS changes.

\#\#\# 7.4 HOT\_MATCH\_SCORE impact  
Recompute when either participant SIZE\_SCORE changes or match time/status changes.

\#\# 8\. Snapshot Invalidation Rules  
Snapshots are keyed by (competitionId, dateLocal, timezone).

An EventChange invalidates snapshots based on:

\#\#\# 8.1 Dashboard snapshot invalidation  
A dashboard snapshot for dateLocal D is invalidated when:  
\- an event with local date D changes status/time/participants/score  
\- a team’s FORM\_POINTS\_N changes (because that changes treemap sizing and topForm)  
\- a team’s NEXT\_EVENT\_HOURS changes and affects its badge/preview

Practical invalidation set:  
\- dateLocal(event before change)  
\- dateLocal(event after change) (if kickoff moved across days)  
\- "today" and "tomorrow" dashboards are always candidates due to proximity effects

\#\#\# 8.2 Team detail snapshot invalidation  
Team detail snapshot invalidated when:  
\- any of the participant’s last-N FINISHED events changed (status/score)  
\- the participant’s next scheduled event changed  
\- computed metrics changed

\#\# 9\. Rebuild Trigger Matrix (Operational)  
This defines what rebuild jobs must run after an EventChange.

\#\#\# 9.1 Status changes  
\- SCHEDULED \-\> IN\_PROGRESS:  
  \- invalidate agenda dateLocal  
  \- rebuild dashboard for that dateLocal (priority high)  
\- IN\_PROGRESS \-\> FINISHED:  
  \- recompute form for both teams  
  \- invalidate dashboards for:  
    \- event dateLocal  
    \- today (if different)  
  \- rebuild team detail snapshots for both teams (priority high)  
\- SCHEDULED \-\> POSTPONED:  
  \- invalidate agenda dateLocal  
  \- rebuild dashboard for that dateLocal (priority high)  
  \- recompute nextEventHours for both teams (priority medium)  
\- POSTPONED \-\> SCHEDULED:  
  \- same as above, includes kickoff time set

\#\#\# 9.2 Time changes (kickoff moved)  
If startTimeUtc changes:  
\- compute oldLocalDate and newLocalDate  
\- invalidate dashboards for both dates  
\- recompute nextEventHours for affected participants  
\- rebuild affected dashboards (priority high)

Time-change severity:  
\- delta \<= 15 minutes: normal  
\- delta \> 2 hours: set warnings.partialData risk and rebuild immediately

\#\#\# 9.3 Score corrections  
If FINISHED score changes:  
\- recompute form for both participants  
\- invalidate dashboards for:  
  \- event dateLocal  
  \- today (if topForm impacted)  
\- rebuild team details  
\- record audit severity high

\#\# 10\. UI Semantics (Badges and Display)  
Badges are derived from canonical status/time.

\#\#\# 10.1 Badge rules (MVP)  
\- If next match exists and hoursUntil \< 48 \-\> CLOCK with label "{Nh}"  
\- If match is POSTPONED \-\> POSTPONED badge  
\- If match is FINISHED and ended within last 24h (optional) \-\> FT badge  
\- Otherwise NONE

\#\#\# 10.2 Agenda display rules  
\- If status is TBD:  
  \- startTimeLocal \= "TBD"  
  \- startDateTimeLocalIso may be null  
\- If status is POSTPONED:  
  \- show "Postponed" indicator  
\- If status is CANCELED:  
  \- either hide from agenda or show struck-through based on UI config (MVP: hide)

\#\# 11\. Data Window and Backfills  
Provider backfills can update older matches outside the default window.

Policy:  
\- If provider returns a correction for a FINISHED match outside window:  
  \- accept canonical update  
  \- recompute only if it intersects the last-N set for any team  
  \- otherwise do not force global rebuild

Recommended mechanism:  
\- For each team, maintain a small index of last K finished events (K \>= N \+ buffer)  
\- Score corrections for those event IDs trigger recompute

\#\# 12\. Handling Duplicates and Merge Events  
Sometimes providers create duplicate event IDs or split/merge events.

Rule:  
\- canonical event identity is providerEventId mapping, but canonical dedupe may merge by:  
  \- same participants  
  \- same startTimeUtc within tolerance  
  \- same competition/stage

If a merge happens:  
\- emit EventChange type OTHER, severity high  
\- invalidate affected snapshots as if time/participants changed

\#\# 13\. Determinism and Clock Handling  
All computations that use "now" must reference:  
\- buildNowUtc captured at snapshot build start (or ingestion job start for recompute planning)

Never call system clock multiple times inside a deterministic computation.

\#\# 14\. Acceptance Criteria  
\- All provider statuses map to canonical statuses consistently.  
\- Allowed transitions are enforced; forbidden transitions are flagged.  
\- Event changes trigger the correct recompute and snapshot rebuild actions.  
\- Kickoff changes across local days invalidate both old and new dashboard snapshots.  
\- Score corrections update FORM\_POINTS\_N deterministically.  
\- UI can display TBD and POSTPONED without breaking.

