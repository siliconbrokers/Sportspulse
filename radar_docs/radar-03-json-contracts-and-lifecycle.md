# Radar SportPulse — JSON Contracts and Lifecycle

Version: 1.0  
Status: Consolidated  
Scope: MVP  
Audience: Backend, Frontend, QA

---

## 1. Technical principle

Radar does not need a database for MVP, but it does require stable persisted editorial snapshots.

### Layer split

#### Live API layer
Source of truth for:

- match status
- live/final score
- kickoff
- teams
- standings
- current match detail data

#### Radar snapshot layer
Source of truth for:

- Radar section existence
- selected cards
- editorial rank
- label
- pre-match text
- reasons
- editorial state
- verdict
- historical frozen output

### Critical rule

The frontend must not recalculate editorial logic.

---

## 2. Canonical persistence unit

Radar snapshots are keyed by:

`competitionKey + seasonKey + matchday`

Example logical key:

`radar:la_liga:2025_2026:26`

---

## 3. Directory structure

```text
/data/radar/
  /{competitionKey}/
    /{seasonKey}/
      /matchday_{n}/
        index.json
        match_{canonicalMatchId}.json
```

Example:

```text
/data/radar/
  /la_liga/
    /2025_2026/
      /matchday_26/
        index.json
        match_ll_2025_2026_26_001.json
        match_ll_2025_2026_26_004.json
        match_ll_2025_2026_26_007.json
```

---

## 4. Source of truth rules

### Live APIs own

- score
- live status
- final status
- kickoff
- standings
- raw team and match data

### Radar snapshots own

- card selection
- editorial order
- label
- signal subtype
- pre-match text
- reasons
- verdict
- historical persistence

### Frontend rule

The frontend may combine live and editorial data for rendering, but it must never reassign labels, recalculate reasons, or generate verdicts.

---

## 5. Snapshot files

Radar uses two file types:

- `index.json`
- `match_<id>.json`

### Roles

#### `index.json`
Entry point for the Radar section in a given league+season+matchday.

#### `match_<id>.json`
Detailed editorial snapshot for an individual Radar card.

---

## 6. `radar-index.json` contract

### Required fields

```json
{
  "schemaVersion": 1,
  "module": "radar_sportpulse",
  "competitionKey": "la_liga",
  "seasonKey": "2025_2026",
  "matchday": 26,
  "radarKey": "radar:la_liga:2025_2026:26",
  "sectionTitle": "Radar SportPulse",
  "sectionSubtitle": "Lo que está en la mira hoy",
  "moduleState": "READY_PRE_MATCH",
  "evidenceTier": "STABLE",
  "generatedAt": "2026-03-07T14:05:00Z",
  "updatedAt": "2026-03-07T14:05:00Z",
  "cardsCount": 3,
  "cards": []
}
```

### Recommended optional fields

```json
{
  "dataQuality": "OK",
  "policyVersion": 1,
  "isHistoricalSnapshot": true,
  "isHistoricalRebuild": false,
  "lastResolvedAt": null,
  "buildReason": "AUTO_PRE_MATCH_GENERATION"
}
```

---

## 7. `cards[]` inside `radar-index.json`

Each card entry in `index.json` must contain only the fields needed to render the Radar section quickly.

```json
{
  "matchId": "ll_2025_2026_26_001",
  "editorialRank": 1,
  "editorialState": "PRE_MATCH",
  "labelKey": "PARTIDO_ENGANOSO",
  "labelText": "Partido engañoso",
  "preMatchText": "La tabla sugiere un cruce más simple de lo que muestran las señales previas.",
  "hasVerdict": false,
  "verdict": null,
  "verdictTitle": null,
  "verdictText": null,
  "detailFile": "match_ll_2025_2026_26_001.json"
}
```

---

## 8. `radar-match-<id>.json` contract

### Required fields

```json
{
  "schemaVersion": 1,
  "module": "radar_sportpulse",
  "competitionKey": "la_liga",
  "seasonKey": "2025_2026",
  "matchday": 26,
  "radarKey": "radar:la_liga:2025_2026:26",
  "matchId": "ll_2025_2026_26_001",
  "editorialRank": 1,
  "editorialState": "PRE_MATCH",
  "evidenceTier": "STABLE",
  "dataQuality": "OK",
  "generatedAt": "2026-03-07T14:05:00Z",
  "updatedAt": "2026-03-07T14:05:00Z",
  "resolvedAt": null,
  "labelKey": "PARTIDO_ENGANOSO",
  "labelText": "Partido engañoso",
  "signalKey": "SURFACE_CONTRADICTION",
  "signalSubtype": "TABLE_FORM_CONTRADICTION",
  "radarScore": 74,
  "preMatchText": "La tabla sugiere un cruce más simple de lo que muestran las señales previas.",
  "reasons": [
    "La tabla marca una diferencia que la forma reciente no acompaña del todo.",
    "El split reciente reduce parte de la comodidad que la previa insinuaba.",
    "La distancia visible existe, pero el partido llega menos lineal de lo esperado."
  ],
  "favoriteSide": "HOME",
  "underdogSide": "AWAY",
  "verdict": null,
  "verdictTitle": null,
  "verdictText": null,
  "postMatchNote": null
}
```

### Recommended optional fields

```json
{
  "policyVersion": 1,
  "isHistoricalSnapshot": true,
  "isHistoricalRebuild": false,
  "buildReason": "AUTO_PRE_MATCH_GENERATION",
  "lastLiveStatusSeen": "SCHEDULED",
  "selectionContext": {
    "cardsPoolSize": 8,
    "selectedBy": "radarScore",
    "contextBoostApplied": 3
  },
  "signalScores": {
    "attentionScore": 41,
    "hiddenValueScore": 58,
    "favoriteVulnerabilityScore": 62,
    "surfaceContradictionScore": 74,
    "openGameScore": 39,
    "tightGameScore": 22
  },
  "evidenceSources": {
    "seasonCurrentUsed": true,
    "seasonPreviousUsed": false,
    "bootstrapMode": false
  },
  "resolutionState": "UNRESOLVED"
}
```

---

## 9. Closed enums

### `moduleState`
- `READY_PRE_MATCH`
- `READY_MIXED`
- `READY_POST_MATCH`
- `EMPTY`
- `UNAVAILABLE`

### `editorialState`
- `PRE_MATCH`
- `IN_PLAY`
- `POST_MATCH`

### `evidenceTier`
- `BOOTSTRAP`
- `EARLY`
- `STABLE`

### `dataQuality`
- `OK`
- `PARTIAL_SAMPLE`
- `FALLBACK_USED`
- `INCONSISTENT_SOURCE`
- `UNRESOLVED`

### `verdict`
- `CONFIRMED`
- `PARTIAL`
- `REJECTED`
- `null`

### `resolutionState`
- `UNRESOLVED`
- `RESOLVED`
- `NOT_APPLICABLE`
- `CANCELLED`
- `FAILED`

---

## 10. Lifecycle phases

### Phase 1 — initial Radar build

#### Trigger
- the selected matchday exists
- the league is supported
- base data is available
- the snapshot does not exist yet, or a controlled regeneration is requested

#### Actions
1. load all matches for league + season + matchday
2. build eligible candidate pool
3. calculate signal scores
4. assign label, subtype, radar score
5. select up to 3 cards
6. write all `radar-match-*.json` files
7. write `radar-index.json`

#### Result
The editorial reading is frozen.

---

### Phase 2 — live editorial-state refresh

#### Trigger
The match status changes in live provider data before resolution.

#### Allowed updates
- `editorialState`
- `updatedAt`
- `moduleState` in `radar-index.json`
- `lastLiveStatusSeen`

#### Forbidden updates
Do **not** change:
- label
- pre-match text
- reasons
- signal subtype
- favorite side
- radar score

---

### Phase 3 — post-match resolution

#### Trigger
The live match state becomes equivalent to a final, finished state.

#### Actions
1. read the persisted match snapshot
2. read final live result from provider layer
3. compute verdict if the label supports one
4. update the match snapshot with:
   - `editorialState = POST_MATCH`
   - `verdict`
   - `verdictTitle`
   - `verdictText`
   - `resolvedAt`
   - `updatedAt`
   - `resolutionState = RESOLVED`
5. update the corresponding card in `radar-index.json`

---

### Phase 4 — final matchday closure

#### Trigger
All Radar cards for the matchday are resolved or no longer resolvable.

#### Actions
Update `radar-index.json` with final module state:

- `READY_POST_MATCH` if everything resolved successfully
- `READY_MIXED` if there is a mixture of resolved and unresolved cards

---

## 11. Write-order rules

### Build order
1. write all `radar-match-*.json`
2. write `radar-index.json` last

### Resolve order
1. update `radar-match-*.json`
2. update `radar-index.json` last

This ensures `index.json` always summarizes an already-persisted detailed state.

---

## 12. Atomic writes

Never write directly to the final file.

### Required procedure
1. write temporary `.tmp` file
2. validate JSON integrity
3. atomically rename to final target

This avoids partial corruption.

---

## 13. Single-writer rule

There must be one effective writer per `competitionKey + seasonKey + matchday` snapshot scope.

No concurrent writers should mutate the same Radar snapshot set.

---

## 14. Frontend read model

### Recommended flow
1. resolve selected league and matchday
2. attempt to load `radar-index.json`
3. if valid, render Radar
4. merge live score/status/hour from the existing live data layer
5. if more editorial detail is required, read `radar-match-<id>.json`

### Critical rule
Frontend must not block the entire page if Radar is unavailable.

If Radar fails, only the Radar section degrades.

---

## 15. Fallback rules

### Snapshot missing

#### Current or future matchday
- backend may attempt controlled build
- if build fails, return `UNAVAILABLE`

#### Historical matchday
- do not silently rebuild and pretend it is original
- return fallback or explicit reconstruction label

### `index.json` exists but detail file missing
- render minimal card from `index.json` if safe
- do not invent detail fields
- mark internal degradation

### Corrupt JSON
- discard the snapshot
- log error
- do not render inconsistent Radar output

### Cancelled or suspended match
- preserve snapshot
- set `resolutionState = CANCELLED`
- no verdict

---

## 16. Historical policy

### Original history
A past matchday should show the Radar snapshot that actually existed for that league+season+matchday.

### Rebuilds
If an exceptional reconstruction is needed:

```json
{
  "isHistoricalRebuild": true
}
```

A rebuild must never be presented as the original historical editorial output.

---

## 17. Versioning

### `schemaVersion`
Versions the JSON structure.

### `policyVersion`
Versions Radar behavior rules, including:

- selection logic
- thresholds
- label assignment
- pre-match text policy
- verdict logic

`policyVersion` must be persisted in both `radar-index.json` and `radar-match-*.json`.

---

## 18. Sample `radar-index.json`

```json
{
  "schemaVersion": 1,
  "module": "radar_sportpulse",
  "competitionKey": "la_liga",
  "seasonKey": "2025_2026",
  "matchday": 26,
  "radarKey": "radar:la_liga:2025_2026:26",
  "sectionTitle": "Radar SportPulse",
  "sectionSubtitle": "Lo que está en la mira hoy",
  "moduleState": "READY_MIXED",
  "evidenceTier": "STABLE",
  "dataQuality": "OK",
  "policyVersion": 1,
  "isHistoricalSnapshot": true,
  "isHistoricalRebuild": false,
  "generatedAt": "2026-03-07T14:05:00Z",
  "updatedAt": "2026-03-07T22:41:00Z",
  "cardsCount": 3,
  "cards": [
    {
      "matchId": "ll_2025_2026_26_001",
      "editorialRank": 1,
      "editorialState": "POST_MATCH",
      "labelKey": "PARTIDO_ENGANOSO",
      "labelText": "Partido engañoso",
      "preMatchText": "La tabla sugiere un cruce más simple de lo que muestran las señales previas.",
      "hasVerdict": true,
      "verdict": "CONFIRMED",
      "verdictTitle": "La lectura se confirmó",
      "verdictText": "El cruce no fue tan simple como la superficie sugería.",
      "detailFile": "match_ll_2025_2026_26_001.json"
    }
  ]
}
```

---

## 19. Sample `radar-match-<id>.json`

```json
{
  "schemaVersion": 1,
  "module": "radar_sportpulse",
  "competitionKey": "la_liga",
  "seasonKey": "2025_2026",
  "matchday": 26,
  "radarKey": "radar:la_liga:2025_2026:26",
  "matchId": "ll_2025_2026_26_001",
  "editorialRank": 1,
  "editorialState": "POST_MATCH",
  "evidenceTier": "STABLE",
  "dataQuality": "OK",
  "policyVersion": 1,
  "isHistoricalSnapshot": true,
  "isHistoricalRebuild": false,
  "buildReason": "AUTO_PRE_MATCH_GENERATION",
  "generatedAt": "2026-03-07T14:05:00Z",
  "updatedAt": "2026-03-07T22:41:00Z",
  "resolvedAt": "2026-03-07T22:40:30Z",
  "lastLiveStatusSeen": "FINISHED",
  "labelKey": "PARTIDO_ENGANOSO",
  "labelText": "Partido engañoso",
  "signalKey": "SURFACE_CONTRADICTION",
  "signalSubtype": "TABLE_FORM_CONTRADICTION",
  "radarScore": 74,
  "preMatchText": "La tabla sugiere un cruce más simple de lo que muestran las señales previas.",
  "reasons": [
    "La tabla marca una diferencia que la forma reciente no acompaña del todo.",
    "El split reciente reduce parte de la comodidad que la previa insinuaba.",
    "La distancia visible existe, pero el partido llega menos lineal de lo esperado."
  ],
  "favoriteSide": "HOME",
  "underdogSide": "AWAY",
  "signalScores": {
    "attentionScore": 41,
    "hiddenValueScore": 58,
    "favoriteVulnerabilityScore": 62,
    "surfaceContradictionScore": 74,
    "openGameScore": 39,
    "tightGameScore": 22
  },
  "evidenceSources": {
    "seasonCurrentUsed": true,
    "seasonPreviousUsed": false,
    "bootstrapMode": false
  },
  "verdict": "CONFIRMED",
  "verdictTitle": "La lectura se confirmó",
  "verdictText": "El cruce no fue tan simple como la superficie sugería.",
  "postMatchNote": null,
  "resolutionState": "RESOLVED"
}
```

