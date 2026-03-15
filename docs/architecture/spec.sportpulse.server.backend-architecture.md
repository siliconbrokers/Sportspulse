---
artifact_id: SPEC-SPORTPULSE-SERVER-BACKEND-ARCHITECTURE
title: "Backend Architecture (MVP)"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: server
slug: backend-architecture
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/architecture/spec.sportpulse.server.backend-architecture.md
---
\# SportPulse Backend Architecture (MVP) — football-data.org Ingestion  
Version: 1.0  
Scope: MVP (La Liga only)  
Mode: B (Form \+ Schedule)  
Primary outputs: snapshot DTOs for frontend

\#\# 1\. Goals  
\- Ingest football-data.org reliably and normalize into internal, provider-agnostic models.  
\- Produce deterministic snapshots for the UI (treemap \+ agenda \+ team detail).  
\- Make provider outages non-fatal (serve last good snapshot with stale warnings).  
\- Minimize provider calls and comply with rate limits.  
\- Keep the design extensible to other competitions and sports without rebuilding the core.

\#\# 2\. Non-goals (MVP)  
\- Live minute-by-minute data and push streaming.  
\- Multi-provider reconciliation and conflict resolution.  
\- Full historical ingestion for many seasons (only what is needed for UI).  
\- Complex analytics beyond last-5 form and next match proximity.

\#\# 3\. System Overview  
The backend is a pipeline with four stages:  
\- Fetch: call football-data.org endpoints  
\- Normalize: convert provider schema to internal canonical schema  
\- Store: persist canonical entities and computed metrics  
\- Serve: expose internal snapshot endpoints to frontend

Provider API must never be called by the frontend.

\#\# 4\. Components  
\- Ingestion Worker  
\- Normalization Layer  
\- Persistence Layer (DB)  
\- Snapshot Builder  
\- Internal API (UI endpoints)  
\- Scheduler (cron)

Recommended runtime options:  
\- Node.js (TypeScript) or Python  
\- Postgres for storage  
\- Redis optional for locks and caching

\#\# 5\. Data Contracts (Canonical Model)  
All provider data is normalized into the canonical model.

\#\#\# 5.1 Core entities  
\- Sport  
\- Competition  
\- Season  
\- Participant  
\- Event

\#\#\# 5.2 Canonical types (MVP)  
Competition:  
\- competition\_id (internal UUID)  
\- sport\_id (FOOTBALL)  
\- provider\_key ("football-data")  
\- provider\_competition\_code (e.g., "PD" for La Liga)  
\- name  
\- format\_type (LEAGUE)  
\- is\_enabled

Season:  
\- season\_id  
\- competition\_id  
\- label (e.g., "2025/26")  
\- start\_date  
\- end\_date

Participant (TEAM for MVP):  
\- participant\_id  
\- sport\_id  
\- participant\_type (TEAM)  
\- name  
\- short\_name  
\- provider\_participant\_id  
\- metadata (json, optional)

Event (match):  
\- event\_id  
\- season\_id  
\- start\_time\_utc  
\- status (SCHEDULED | IN\_PROGRESS | FINISHED | POSTPONED | CANCELED | TBD)  
\- home\_participant\_id  
\- away\_participant\_id  
\- score\_home (nullable)  
\- score\_away (nullable)  
\- provider\_event\_id  
\- last\_seen\_utc

\#\# 6\. Derived Entities (Metrics and Snapshots)  
\#\#\# 6.1 Metric snapshots  
MetricSnapshot:  
\- snapshot\_id  
\- season\_id  
\- participant\_id  
\- metric\_key (FORM\_POINTS\_N | NEXT\_EVENT\_HOURS)  
\- metric\_value (number)  
\- params (json; window\_n \= 5\)  
\- computed\_at\_utc

\#\#\# 6.2 UI snapshots (materialized views)  
DashboardSnapshot:  
\- snapshot\_id  
\- competition\_id  
\- date\_local (YYYY-MM-DD)  
\- timezone  
\- last\_updated\_utc  
\- payload\_json (DashboardDTO)  
\- status (OK | STALE | ERROR)  
\- source\_snapshot\_id (nullable reference to prior snapshot)

TeamDetailSnapshot:  
\- snapshot\_id  
\- competition\_id  
\- participant\_id  
\- last\_updated\_utc  
\- payload\_json (TeamDetailDTO)  
\- status (OK | STALE | ERROR)

\#\# 7\. Provider Endpoints to Use (football-data.org v4)  
This is the minimal set for MVP:  
\- Competition details and season context  
\- Teams list  
\- Matches list for season filtered by date range

Typical calls (conceptual):  
\- GET competition (to confirm code and season)  
\- GET teams for competition  
\- GET matches for competition (dateFrom/dateTo)  
\- Optionally GET match by id for backfill if needed

The exact URLs should be stored in configuration and not hardcoded in business logic.

\#\# 8\. Ingestion Strategy  
\#\#\# 8.1 Bootstrapping (first run)  
\- Ensure Competition exists (La Liga, provider code set)  
\- Resolve current Season (from provider competition metadata)  
\- Fetch all teams once and store participants  
\- Fetch matches for a rolling window:  
  \- Past: last 14 days (to compute form and recent results)  
  \- Future: next 14 days (for schedule and proximity)  
\- Build initial snapshots for:  
  \- today  
  \- tomorrow  
  \- weekend preset (optional)  
  \- current team detail snapshots for all teams (optional; can be computed on demand)

\#\#\# 8.2 Incremental ingestion (recurring job)  
Run every 2–4 hours:  
\- Fetch matches for rolling window (past 14 days, next 14 days)  
\- Upsert events by provider\_event\_id  
\- Update statuses and scores  
\- Update last\_seen\_utc  
\- Recompute metrics for impacted teams  
\- Rebuild dashboard snapshots for affected dates

\#\# 9\. Rate Limiting and Provider Protection  
\- All provider calls go through a single client with:  
  \- retry with exponential backoff (max 3 retries)  
  \- circuit breaker behavior (stop after repeated failures)  
  \- request throttling (token bucket)  
\- Use conditional requests if supported (ETag/If-Modified-Since), otherwise rely on caching windows.  
\- Store provider response hashes to avoid reprocessing identical payloads.

\#\# 10\. Idempotency and Concurrency  
\#\#\# 10.1 Idempotent upserts  
\- Uniqueness constraints:  
  \- competitions(provider\_key, provider\_competition\_code)  
  \- participants(provider\_key, provider\_participant\_id)  
  \- events(provider\_key, provider\_event\_id)  
\- Upsert logic ensures repeated ingestion produces identical DB state.

\#\#\# 10.2 Distributed locking (optional)  
If multiple workers can run:  
\- Use a lock per (competition\_id, job\_type) to avoid overlap.  
\- Redis is recommended for lock TTL.

\#\# 11\. Normalization Rules (MVP)  
\#\#\# 11.1 Team mapping  
\- provider team id is canonical mapping key  
\- shortName rules:  
  \- use provider shortName if present  
  \- else generate from name (truncate or acronym)  
\- never use names as identifiers

\#\#\# 11.2 Event status mapping  
Map provider statuses to internal:  
\- SCHEDULED \-\> SCHEDULED  
\- FINISHED \-\> FINISHED  
\- IN\_PLAY/LIVE \-\> IN\_PROGRESS  
\- POSTPONED \-\> POSTPONED  
\- CANCELED \-\> CANCELED  
\- TIMED/UNKNOWN \-\> TBD

\#\#\# 11.3 Timezone handling  
\- Store all event times in UTC  
\- Convert to user timezone only when building snapshots  
\- Snapshots must include timezone used for conversion

\#\# 12\. Metric Computation (MVP)  
\#\#\# 12.1 FORM\_POINTS\_5  
For each team:  
\- select last 5 FINISHED events in the season ordered by start\_time\_utc desc  
\- for each event determine result:  
  \- win: 3  
  \- draw: 1  
  \- loss: 0  
\- sum to form\_points\_5  
\- windowN \= min(5, count\_finished\_matches)

\#\#\# 12.2 NEXT\_EVENT\_HOURS  
\- find next event with status SCHEDULED or TBD and start\_time\_utc \> now  
\- compute hours difference  
\- null if no next event exists in the future window

\#\#\# 12.3 Proximity bonus (for UI)  
Compute:  
\- bonus \= 5 if next\_event\_hours \< 48  
\- bonus \= 2 if next\_event\_hours \< 96  
\- else 0

Store bonus in snapshot DTO rather than as a metric key.

\#\# 13\. Snapshot Building  
\#\#\# 13.1 DashboardSnapshot build  
Inputs:  
\- teams \+ metrics \+ upcoming matches for selected date  
Outputs:  
\- DashboardDTO with:  
  \- treemap tiles (sizeScore, color bucket via formPoints)  
  \- agenda list (matches for date)  
  \- lastUpdatedUtc  
  \- warnings if stale or partial

\#\#\# 13.2 TeamDetailSnapshot build  
Inputs:  
\- last 5 finished events for team  
\- next match  
Outputs:  
\- TeamDetailDTO with:  
  \- results list W/D/L with score  
  \- deterministic explanation bullets:  
    \- "Form last 5: X/15"  
    \- "Next match in Nh (bonus \+Y)" or "No upcoming match in window"  
    \- "Date context: YYYY-MM-DD" (if relevant)

\#\#\# 13.3 Staleness rules  
Mark snapshot as STALE when:  
\- last provider fetch failure occurred within the last job run  
\- no successful ingestion has occurred within a configured threshold (e.g., 8 hours)

When STALE:  
\- serve last good payload\_json  
\- include warnings.staleData \= true

\#\# 14\. Internal API (Frontend-facing)  
\- GET /api/ui/dashboard?competitionId=...\&date=YYYY-MM-DD  
  \- returns DashboardDTO  
  \- from DashboardSnapshot if available  
  \- else builds on demand from DB and stores snapshot

\- GET /api/ui/team?competitionId=...\&participantId=...  
  \- returns TeamDetailDTO  
  \- from TeamDetailSnapshot if available  
  \- else builds on demand

\- GET/POST /api/ui/favorites  
  \- requires auth  
  \- not part of ingestion pipeline

\#\# 15\. Observability and Operations  
\#\#\# 15.1 Logs  
\- provider request count  
\- provider response status distribution  
\- ingestion duration  
\- number of events upserted  
\- snapshot build counts  
\- errors with correlation id

\#\#\# 15.2 Metrics  
\- ingestion\_success\_rate  
\- snapshot\_build\_success\_rate  
\- last\_successful\_ingestion\_utc  
\- provider\_failure\_streak

\#\#\# 15.3 Health endpoints  
\- /api/health/provider  
\- /api/health/ingestion  
\- /api/health/snapshots

\#\# 16\. Failure Modes and Handling  
\- Provider rate limit: throttle, backoff, stop job early, keep last snapshot  
\- Provider outage: circuit breaker, mark snapshots stale, serve cached  
\- Partial payload: accept partial, suppress fields that require missing data  
\- DB failure: fail closed, return error state to UI, no partial writes (transaction)

\#\# 17\. Security  
\- Store provider API key securely (env secret manager)  
\- Never expose provider key to client  
\- Admin endpoints require privileged role (not in MVP UI)

\#\# 18\. Configuration (MVP)  
\- ENABLED\_COMPETITIONS \= \["PD"\]  
\- TIMEZONE\_DEFAULT \= "America/Montevideo" (or detect per user)  
\- INGEST\_PAST\_DAYS \= 14  
\- INGEST\_FUTURE\_DAYS \= 14  
\- JOB\_INTERVAL\_MINUTES \= 180  
\- SNAPSHOT\_STALE\_THRESHOLD\_HOURS \= 8

\#\# 19\. Acceptance Criteria (Backend)  
\- Re-running ingestion produces identical DB state (idempotent).  
\- A provider failure does not break dashboard: returns last snapshot with stale warning.  
\- Form points are correct for last 5 finished matches and match UI DTO.  
\- Next match hours is correct and produces correct proximity bonus.  
\- Snapshots are reproducible and keyed by competition and date.

