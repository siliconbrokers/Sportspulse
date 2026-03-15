\# SportPulse — Data Normalization Spec (Sport-Agnostic)  
Version: 1.0  
Scope: Core normalization model that supports multiple sports and competition formats  
Status: Final (core contract)

\#\# 1\. Purpose  
This spec defines a provider-agnostic, sport-agnostic canonical data model and normalization rules so SportPulse can ingest data from different providers and support different sports without rewriting the UI or core logic.

The model must support:  
\- team sports (football, basketball, hockey)  
\- individual sports (tennis, MMA)  
\- competitions with different formats (league, cup, tournament, tour)  
\- extensible metrics (form, next event proximity, rank delta, etc.)

\#\# 2\. Non-goals  
\- Solve every sport’s unique semantics at the core level  
\- Define betting markets or odds  
\- Implement provider-specific parsing details (that belongs to adapters)

\#\# 3\. Core Principles  
\- The canonical model must not assume "team" as the default unit. Use Participant.  
\- All times are stored in UTC, converted only at snapshot/build time.  
\- Never use names as identifiers. Use internal IDs \+ provider mapping keys.  
\- Core entities should be stable; sport-specific details should live in extensible fields (typed unions \+ metadata).

\#\# 4\. Canonical Entities  
The canonical model consists of these entities:

\- Sport  
\- Competition  
\- Season  
\- Stage (optional)  
\- Participant  
\- Event  
\- EventParticipant (bridge)  
\- Result (typed union)  
\- Standing (optional)  
\- MetricSnapshot (derived)  
\- Snapshot (materialized UI payload)

\#\#\# 4.1 Sport  
Represents a sport category.  
\- sport\_id (enum or UUID)  
\- code (e.g., FOOTBALL, BASKETBALL, TENNIS)  
\- name

\#\#\# 4.2 Competition  
A competition belongs to a Sport and has a format type.  
\- competition\_id  
\- sport\_id  
\- name  
\- format\_type (LEAGUE | CUP | TOURNAMENT | TOUR)  
\- region (optional)  
\- provider\_mappings (list)

\#\#\# 4.3 Season  
Time-bounded context for a competition.  
\- season\_id  
\- competition\_id  
\- label (e.g., "2025/26")  
\- start\_date  
\- end\_date  
\- metadata (json)

\#\#\# 4.4 Stage (optional but recommended)  
Represents sub-structures: groups, rounds, playoffs, matchdays.  
\- stage\_id  
\- season\_id  
\- stage\_type (REGULAR | GROUP | KNOCKOUT | PLAYOFF | ROUND | MATCHDAY | WEEK)  
\- name (e.g., "Group A", "Quarterfinals", "Matchday 12")  
\- order\_index (number)  
\- parent\_stage\_id (nullable)

Stage exists to avoid hardcoding league vs cup logic. The MVP can ignore it, but the model must not block it.

\#\#\# 4.5 Participant  
A participant can be a team, player, pair, club, country, etc.  
\- participant\_id  
\- sport\_id  
\- participant\_type (TEAM | PLAYER | PAIR | CLUB | COUNTRY)  
\- name  
\- short\_name (optional)  
\- metadata (json)

\#\#\# 4.6 Event  
A generic contest: match, game, encounter, fight.  
\- event\_id  
\- season\_id  
\- stage\_id (nullable)  
\- start\_time\_utc (timestamp)  
\- status (SCHEDULED | IN\_PROGRESS | FINISHED | POSTPONED | CANCELED | TBD)  
\- venue (optional)  
\- provider\_event\_key  
\- last\_seen\_utc

\#\#\# 4.7 EventParticipant (bridge)  
Participants in an event with roles.  
\- event\_id  
\- participant\_id  
\- role (HOME | AWAY | P1 | P2 | SIDE\_A | SIDE\_B | TEAM\_A | TEAM\_B)  
\- seed (optional)  
\- is\_winner (nullable)

This bridge avoids assumptions like only "home" and "away".

\#\#\# 4.8 Result (typed union)  
Results vary by sport; use a discriminated union.

Base:  
\- event\_id  
\- result\_type (TEAM\_SCORE | SETS | ROUNDS | TIME\_DISTANCE | POINTS\_ONLY)  
\- winner\_participant\_id (nullable)  
\- payload (json)

Recommended payloads:

TEAM\_SCORE:  
\- score: { sideA: number, sideB: number }  
\- period\_scores (optional): \[{ period: 1, sideA: number, sideB: number }, ...\]

SETS (tennis):  
\- sets: \[{ set: 1, p1: number, p2: number }, ...\]  
\- tiebreaks (optional)

ROUNDS (MMA/boxing):  
\- rounds: \[{ round: 1, judgeA: number, judgeB: number }, ...\]  
\- method (optional)

TIME\_DISTANCE (racing):  
\- value: number  
\- unit: "seconds" | "meters" | ...  
\- rank\_positions

POINTS\_ONLY:  
\- points: { sideA: number, sideB: number }

\#\# 5\. Provider Mapping Model  
All canonical entities can store provider mappings so we can ingest from multiple sources.

ProviderMapping:  
\- provider\_key (e.g., "football-data", "sportradar")  
\- provider\_id (string)  
\- entity\_type (COMPETITION | SEASON | PARTICIPANT | EVENT)  
\- entity\_id (internal id)  
\- last\_verified\_utc

Rules:  
\- provider\_id must be unique per provider \+ entity\_type  
\- names are not used for identity

\#\# 6\. Status Normalization  
All providers have different statuses; map into the canonical set:

Canonical statuses:  
\- SCHEDULED  
\- IN\_PROGRESS  
\- FINISHED  
\- POSTPONED  
\- CANCELED  
\- TBD

Rules:  
\- "TIMED" or "NOT\_STARTED" \-\> SCHEDULED  
\- "LIVE", "IN\_PLAY" \-\> IN\_PROGRESS  
\- "FINAL", "FT" \-\> FINISHED  
\- unknown \-\> TBD

\#\# 7\. Time Normalization  
\- Store all event times in UTC.  
\- When building UI snapshots, convert to user timezone.  
\- The date used in the dashboard is a "local day" concept derived during snapshot build.

\#\# 8\. Competition Format Abstraction  
\#\#\# 8.1 Format types  
\- LEAGUE: round-robin season, possible matchdays  
\- CUP: knockout structure (may include group stage)  
\- TOURNAMENT: umbrella type for mixed formats (e.g., World Cup)  
\- TOUR: repeated events over time with ranking points (tennis tour)

\#\#\# 8.2 How the model supports it  
\- Stage handles groups, matchdays, rounds, playoffs without special-case logic.  
\- EventParticipant roles support different participant structures.  
\- Result union supports scoring differences.

The UI can initially ignore Stage and still work for a single league.

\#\# 9\. Canonical Metrics (Sport-Agnostic)  
Metrics must be defined as keys with parameters, not hardcoded rules.

MetricSnapshot:  
\- snapshot\_id  
\- season\_id  
\- participant\_id  
\- metric\_key (string)  
\- metric\_value (number)  
\- params (json)  
\- computed\_at\_utc

Examples:  
\- FORM\_POINTS\_N (params: { window\_n: 5 })  
\- WINRATE\_N (params: { window\_n: 10 })  
\- NEXT\_EVENT\_HOURS (params: {})  
\- RANK\_DELTA (params: { window\_days: 7 })  
\- ACTIVITY\_COUNT (params: { window\_days: 30 })

Rules:  
\- metric\_key is stable  
\- meaning is defined by this spec or a metrics registry  
\- UI uses metric\_key \+ params to label and explain

\#\# 10\. Sport-specific Metric Implementation Guidance  
The core model does not define how every metric is computed per sport. Instead, define per-sport metric policies.

MetricPolicy:  
\- sport\_id  
\- metric\_key  
\- computation\_rules (text)  
\- constraints (params allowed, min/max)

Example policies:

FOOTBALL:  
\- FORM\_POINTS\_N uses 3/1/0 from last N finished events in season

TENNIS:  
\- FORM\_POINTS\_N may represent "wins in last N matches" (1 per win)  
\- or use WINRATE\_N as primary

BASKETBALL:  
\- FORM\_POINTS\_N could map win=1, loss=0, but UI label should adapt

Key rule:  
\- UI must not assume football semantics. It consumes metric\_key \+ explanation bullets.

\#\# 11\. Snapshot DTO Strategy (UI-agnostic inputs)  
Frontends should not query canonical tables directly. Instead, build snapshots that map canonical data to UI DTOs.

Snapshot types:  
\- DashboardSnapshot (competition \+ date)  
\- ParticipantDetailSnapshot  
\- AgendaSnapshot (optional)

Each snapshot includes:  
\- lastUpdatedUtc  
\- warnings (stale, partial)  
\- deterministic explanation strings

Snapshots are the stable contract between backend and frontend.

\#\# 12\. Normalization Pipeline Responsibilities  
\#\#\# 12.1 Provider adapter responsibilities  
\- Fetch provider data  
\- Map provider IDs to canonical IDs using ProviderMapping  
\- Output canonical entities and relationships  
\- Never output UI DTOs

\#\#\# 12.2 Core normalization responsibilities  
\- Enforce canonical constraints  
\- Upsert entities idempotently  
\- Validate required fields  
\- Normalize times and statuses  
\- Store results in canonical tables

\#\#\# 12.3 Snapshot builder responsibilities  
\- Join canonical tables  
\- Compute metrics (or read metric snapshots)  
\- Produce UI DTOs  
\- Set warnings

\#\# 13\. Validation Rules  
\- Every Event must have:  
  \- season\_id  
  \- start\_time\_utc  
  \- status  
  \- at least 2 EventParticipants  
\- Every Participant must have:  
  \- participant\_type  
  \- name  
  \- provider mapping  
\- Every Result must:  
  \- match a known result\_type  
  \- be consistent with participants roles

If validation fails:  
\- event is stored with status TBD and partial data is flagged  
\- snapshots must suppress fields that depend on missing data

\#\# 14\. Idempotency Rules  
\- Upserts are keyed by provider\_id \+ entity\_type.  
\- Re-ingesting the same provider data must not create duplicates.  
\- Updates must only occur when fields change (diff-based update recommended).

\#\# 15\. Extensibility Rules  
\- New sports:  
  \- add Sport code  
  \- add MetricPolicy for metric keys used by UI  
  \- implement provider adapter mapping into canonical entities  
  \- optionally add result payload schema variant  
\- New competition structures:  
  \- add Stage graph data and mapping  
  \- UI can continue to function if it does not require Stage

\#\# 16\. Acceptance Criteria  
\- A new provider can be added without changing frontend DTOs.  
\- A new sport can be added without changing canonical entities.  
\- A tournament with groups and knockout can be represented using Stage \+ EventParticipant roles.  
\- Metrics can be added and used by UI without changing the canonical schema.

