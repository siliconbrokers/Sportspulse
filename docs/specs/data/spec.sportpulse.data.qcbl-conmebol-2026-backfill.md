---
artifact_id: SPEC-SPORTPULSE-DATA-QCBL-CONMEBOL-2026-BACKFILL
title: "QCBL CONMEBOL 2026 Backfill Specification"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: data
slug: qcbl-conmebol-2026-backfill
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/specs/data/spec.sportpulse.data.qcbl-conmebol-2026-backfill.md
---
\# SPEC\_QCBL\_CONMEBOL\_2026\_BACKFILL.md

Version: 1.0  
Status: Ready for implementation  
Scope: Retroactive import of CONMEBOL World Cup 2026 qualifiers into the tournament catalog  
Audience: Backend, Data Ingestion, QA

\---

\# 1\. Purpose

This specification defines how the system must import and persist the full historical tournament data for the CONMEBOL qualifiers to the 2026 FIFA World Cup.

The goal is to add this competition to the tournament list as a completed historical competition, including:

\- tournament metadata  
\- season metadata  
\- teams  
\- matchdays  
\- matches  
\- final results  
\- optional final standings if the current architecture supports them cleanly

This is a \*\*retroactive backfill\*\*, not a live sync experiment.

\---

\# 2\. Competition Target

The target competition is:

\- Provider: \`football-data.org\`  
\- API version: \`v4\`  
\- Competition name: \`WC Qualification CONMEBOL\`  
\- Competition code: \`QCBL\`

The implementation must use this provider/competition as the canonical source for this backfill.

\---

\# 3\. Goals

\#\# In scope

\- Add the CONMEBOL qualifiers tournament to the internal tournament catalog  
\- Resolve the correct season from provider data  
\- Persist all participating teams  
\- Persist all matchdays  
\- Persist all matches for all matchdays  
\- Persist final scores for completed matches  
\- Make the import idempotent  
\- Integrate into the existing project architecture without breaking other competitions

\#\# Out of scope

\- Scraping  
\- Manual spreadsheet imports  
\- UI redesign  
\- New live polling flows  
\- New generalized multi-provider abstraction unless strictly required  
\- New standings architecture if the project does not already support standings persistence

\---

\# 4\. Non-Negotiable Constraints

1\. Do not break existing competitions.  
2\. Do not create duplicates.  
3\. Do not hardcode an assumed season blindly.  
4\. Do not infer matchdays from dates if provider \`matchday\` exists.  
5\. Do not create a parallel “special case” architecture unless strictly necessary.  
6\. Reuse the current ingestion pipeline, repositories, mappers, and canonical models wherever possible.  
7\. The final result must be deterministic and idempotent.

\---

\# 5\. Required Source Endpoints

The implementation must use the existing HTTP/API client conventions in the project and consume the equivalent football-data.org endpoints:

\- \`GET /v4/competitions/QCBL\`  
\- \`GET /v4/competitions/QCBL/teams?season={season}\`  
\- \`GET /v4/competitions/QCBL/matches?season={season}\`  
\- \`GET /v4/competitions/QCBL/standings?season={season}\` (optional, only if supported cleanly)

The code must not assume raw URLs inline if the project already centralizes endpoint construction.

\---

\# 6\. Data to Persist

\#\# 6.1 Tournament / Competition

Persist or upsert the internal competition/tournament entity with, at minimum:

\- \`provider \= football-data\`  
\- \`externalCompetitionId\`  
\- \`competitionCode \= QCBL\`  
\- \`name\`  
\- \`shortName\` if available  
\- \`type\` if supported  
\- \`area / region / confederation\` if supported  
\- \`emblem / logo URL\`  
\- source trace metadata if the current architecture supports it

\#\#\# Rules  
\- Use provider external identity as canonical lookup key.  
\- Do not create a second internal tournament if one already exists for the same provider competition.

\---

\#\# 6.2 Season

Resolve and persist the correct season for this competition from provider payload.

Persist or upsert, at minimum:

\- \`externalSeasonId\` if exposed by the provider mapping layer  
\- \`competitionId\`  
\- \`startDate\`  
\- \`endDate\`  
\- \`currentMatchday\` if present and meaningful  
\- \`winner\` only if the model already supports it and the provider returns it  
\- source trace metadata if supported

\#\#\# Rules  
\- The season must be selected from provider \`seasons\`.  
\- Do not rely on \`currentSeason\` implicitly.  
\- Do not hardcode a year string without first inspecting provider season data.  
\- The chosen season must be the season that corresponds to the CONMEBOL qualifiers cycle for the 2026 World Cup.

\---

\#\# 6.3 Teams

Persist or upsert all participating teams.

At minimum:

\- \`externalTeamId\`  
\- \`name\`  
\- \`shortName\`  
\- \`tla\`  
\- \`crest / logo URL\`  
\- \`area / country\` if supported by the current model

\#\#\# Rules  
\- Team identity must be keyed by provider \+ externalTeamId.  
\- Do not create duplicate teams because of naming differences.  
\- If a team already exists, update missing metadata conservatively.

\---

\#\# 6.4 Matchdays

Create or upsert all real matchdays returned by the provider.

At minimum:

\- \`competitionId\`  
\- \`seasonId\`  
\- \`matchdayNumber\`

Optional if supported:  
\- label / display name  
\- start/end timestamps derived from included matches

\#\#\# Rules  
\- Matchdays must be based on provider \`matchday\`.  
\- Do not derive matchdays by grouping dates heuristically.  
\- One internal matchday per unique \`matchdayNumber\` for the selected season.

\---

\#\# 6.5 Matches

Persist or upsert every match for the selected season.

At minimum per match:

\- \`externalMatchId\`  
\- \`competitionId\`  
\- \`seasonId\`  
\- \`matchdayId\`  
\- \`utcDate\`  
\- \`status\`  
\- \`stage\`  
\- \`group\` if present  
\- \`homeTeamId\`  
\- \`awayTeamId\`  
\- score payload mapped into canonical fields  
\- \`winner\` if exposed  
\- \`venue\` if supported  
\- \`lastUpdated\` from provider if available  
\- raw source trace metadata if the project supports it

\#\#\# Score fields  
Map whatever the current canonical model already supports, but preserve final score at minimum:

\- full time home goals  
\- full time away goals

Also map additional score breakdowns if the project already handles them, for example:  
\- half time  
\- extra time  
\- penalties

\#\#\# Rules  
\- Completed matches must retain final score.  
\- Team associations must be resolved before match upsert.  
\- Match must reference the correct matchday.  
\- Re-import must update changed metadata without duplicating the match.

\---

\#\# 6.6 Standings (Optional)

Persist final standings only if the current architecture already supports standings or standings snapshots in a clean way.

\#\#\# Rules  
\- Do not invent a parallel standings subsystem just for this backfill.  
\- If the system already persists standings, load the final standings for the selected season.  
\- If the project does not support standings persistence, skip standings and log that they were intentionally omitted.

\---

\# 7\. Canonical Mapping Rules

The implementation must respect the project’s canonical domain model.

Provider payload must be mapped through the existing normalization layer if one exists.

Required separation:

\- provider payload  
\- provider-to-canonical mapper  
\- persistence logic  
\- orchestration / sync flow

The implementation must not:  
\- spread provider field names across repositories  
\- mix HTTP fetching with database writes inside low-level mapping code  
\- duplicate provider parsing logic across files

\---

\# 8\. Identity and Upsert Rules

\#\# Competition identity  
Use one of these, depending on the existing architecture:

\- \`provider \+ externalCompetitionId\`  
\- or \`provider \+ competitionCode\`

\#\# Season identity  
Prefer:

\- \`competition \+ externalSeasonId\`

Fallback only if necessary:  
\- \`competition \+ startDate \+ endDate\`

\#\# Team identity  
Use:

\- \`provider \+ externalTeamId\`

\#\# Match identity  
Use:

\- \`provider \+ externalMatchId\`

\#\# Matchday identity  
Use:

\- \`competition \+ season \+ matchdayNumber\`

\#\#\# Mandatory behavior  
\- Every insert path must behave as upsert / sync.  
\- Re-running the backfill must converge to the same final state.

\---

\# 9\. Import Workflow

The backfill must run in this logical order:

1\. Resolve competition \`QCBL\`  
2\. Resolve the correct season from competition payload  
3\. Upsert competition  
4\. Upsert season  
5\. Fetch and upsert teams  
6\. Fetch matches for the selected season  
7\. Build the unique matchday set from provider \`matchday\`  
8\. Upsert matchdays  
9\. Upsert matches  
10\. Optionally fetch and persist final standings if supported  
11\. Emit summary/log/metrics

\#\#\# Notes  
\- Team upsert must happen before match upsert.  
\- Matchday creation must happen before match linking.  
\- Missing non-critical optional fields must not abort the entire import.

\---

\# 10\. Error Handling

The implementation must fail loudly and specifically on structural failures.

\#\# Fatal errors  
Abort the import with explicit error message if:  
\- competition \`QCBL\` cannot be resolved  
\- provider payload is malformed for required fields  
\- no valid season can be selected  
\- persistence invariants fail in a way that risks corruption

\#\# Non-fatal errors  
Continue with structured logging when:  
\- optional logo/emblem is missing  
\- optional venue is missing  
\- optional standings are unavailable  
\- a recoverable single-record issue occurs and the architecture already supports per-record error collection

\#\#\# Rules  
\- Do not swallow exceptions.  
\- Do not log vague messages like “import failed”.  
\- Include enough context to debug: provider, competition, season, match id, matchday number, operation stage.

\---

\# 11\. Observability

The import must produce a clear summary at the end.

Minimum summary fields:

\- selected competition  
\- selected season  
\- competition inserted/updated  
\- season inserted/updated  
\- teams inserted/updated/skipped  
\- matchdays inserted/updated/skipped  
\- matches inserted/updated/skipped  
\- standings inserted/updated/skipped if applicable  
\- error count  
\- duration

If the project already has structured logging or metrics, use it.

\---

\# 12\. Execution Interface

Expose the backfill through the project’s existing operational pattern, for example one of:

\- CLI command  
\- script entrypoint  
\- admin task  
\- job runner command

\#\#\# Rules  
\- Reuse existing execution style  
\- Do not create an ad hoc path if the project already has one  
\- The command must clearly target this competition backfill

Recommended shape:

\- \`backfill:competition:qcb1-conmebol-2026\`  
or equivalent according to project conventions

Actual command naming must follow the project style.

\---

\# 13\. Acceptance Criteria

The implementation is accepted only if all of the following are true:

1\. Exactly one internal tournament exists for provider competition \`QCBL\`.  
2\. The correct provider season is resolved from provider season data, not guessed.  
3\. All participating teams for the selected season are persisted and linked correctly.  
4\. All matchdays returned by provider matches are created exactly once.  
5\. All matches for the selected season are persisted exactly once.  
6\. Completed matches contain final score.  
7\. Every persisted match is linked to:  
   \- the correct competition  
   \- the correct season  
   \- the correct matchday  
   \- the correct home team  
   \- the correct away team  
8\. Re-running the import does not create duplicates.  
9\. Missing optional fields do not break the import.  
10\. The implementation does not alter or regress existing competition imports.

\---

\# 14\. QA Validation Checklist

\#\# Functional  
\- Confirm competition is visible in the tournament list data source  
\- Confirm all teams exist  
\- Confirm all matchdays exist  
\- Confirm all matches exist  
\- Confirm completed match scores exist  
\- Confirm logos/emblems are persisted where available

\#\# Idempotency  
\- Run import twice  
\- Verify no duplicate competition, season, teams, matchdays, or matches are created

\#\# Regression  
\- Run an existing competition import smoke test if available  
\- Verify no unrelated provider mapping broke

\#\# Data integrity  
\- Randomly sample matches and verify:  
  \- teams are correct  
  \- matchday is correct  
  \- score is correct  
  \- status is correct

\---

\# 15\. Implementation Guidance

Before writing code:

1\. Inspect the current project architecture.  
2\. Locate existing ingestion/sync pipeline(s).  
3\. Identify current provider clients, mappers, repositories, and canonical models.  
4\. Extend the existing path with the minimum necessary change set.  
5\. Avoid speculative abstractions.

This work is complete only when the backfill is actually integrated into the real codebase, executable, and validated.  
