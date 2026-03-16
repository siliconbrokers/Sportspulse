---
artifact_id: SPEC-SPORTPULSE-RADAR-V2-CONTRACTS
title: "Radar SportPulse — JSON Contracts and Lifecycle v2"
artifact_class: spec
status: draft
version: 2.0.0
project: sportpulse
domain: radar
slug: radar-v2-json-contracts-and-lifecycle
owner: team
created_at: 2026-03-16
updated_at: 2026-03-16
canonical_path: docs/specs/spec.sportpulse.radar-v2-json-contracts-and-lifecycle.md
---

# Radar SportPulse — JSON Contracts and Lifecycle v2

## 1. Purpose

This document defines the JSON shapes, persistence rules, write order, and lifecycle behavior of Radar v2.

## 2. Architectural Rule

Radar v2 remains split into two layers:

- live/source data layer
- editorial snapshot layer

Frontend consumes the editorial snapshot layer.
Frontend does not recompute editorial logic.

## 3. Canonical Snapshot Key

Each Radar snapshot is uniquely identified by:

- `competitionKey`
- `seasonKey`
- `matchday`

Optional operational fields may exist, but they do not redefine scope truth.

## 4. Snapshot Envelope

```json
{
  "schemaVersion": "2.0.0",
  "competitionKey": "string",
  "seasonKey": "string",
  "matchday": "string|number",
  "generatedAt": "ISO-8601",
  "generatorVersion": "string",
  "status": "READY|EMPTY|DEGRADED|FAILED",
  "dataQuality": "OK|PARTIAL|DEGRADED",
  "isHistoricalRebuild": false,
  "evidenceTier": "BOOTSTRAP|EARLY|STABLE",
  "cards": []
}
```

## 5. Card Contract

```json
{
  "matchId": "string",
  "family": "CONTEXT|DYNAMICS|MISALIGNMENT",
  "primaryLabel": "EN_LA_MIRA|BAJO_EL_RADAR|SENAL_DE_ALERTA|PARTIDO_ENGANOSO|PARTIDO_ABIERTO|DUELO_CERRADO",
  "secondaryBadges": [],
  "subtype": "string",
  "confidenceBand": "LOW|MEDIUM|HIGH",
  "radarScore": 0,
  "evidenceTier": "BOOTSTRAP|EARLY|STABLE",
  "reasons": [],
  "preMatchText": "string",
  "verdict": null
}
```

## 6. Reasons Contract

```json
{
  "code": "string",
  "weight": 0,
  "text": "string"
}
```

Rules:
- `code` must be stable and machine-readable
- `text` is renderable explanation
- `weight` is used for internal ranking and debugability

## 7. Verdict Contract

```json
{
  "status": "CONFIRMED|PARTIAL|REJECTED",
  "label": "same as primaryLabel",
  "verdictText": "string",
  "resolvedAt": "ISO-8601"
}
```

Verdict is append-only.
It never rewrites `preMatchText`.

## 8. Status Semantics

### READY
Valid snapshot with 1 to 3 cards.

### EMPTY
Valid snapshot with 0 cards.

### DEGRADED
Snapshot generated under constrained conditions but still safe to render.

### FAILED
Snapshot not fit for rendering as Radar content.

## 9. dataQuality Semantics

### OK
Normal input quality.

### PARTIAL
Some inputs missing or reduced, but snapshot still renderable.

### DEGRADED
Input quality materially reduced. Snapshot may be sparse or conservative.

## 10. Historical Rebuild Flag

`isHistoricalRebuild` must be real.

It may not remain hardcoded false.

Use:
- `false` for normal forward generation
- `true` when generating or regenerating historical scopes outside normal forward flow

## 11. Write Order

Required write sequence:

1. read scope inputs
2. evaluate candidate matches
3. compute internal activations
4. resolve cards
5. generate render-ready text
6. validate snapshot
7. perform atomic write

Partial write is forbidden.

## 12. Atomicity Rule

A Radar snapshot write must be atomic at scope level.
Consumers may never observe half-built cards.

## 13. Single Writer Rule

Per scope, there must be one effective writer.
Concurrent writes for the same canonical scope are forbidden unless protected by clear orchestration.

## 14. Frontend Rule

Frontend may:
- render cards
- render verdict
- render degraded state
- render empty state

Frontend may not:
- recompute labels
- derive subtype
- generate reasons
- generate text
- reinterpret verdict logic

## 15. Lifecycle States

### Pre-Match
Render `preMatchText`.
No verdict.

### In-Play
Continue rendering the frozen `preMatchText`.
No editorial rewrite.

### Post-Match
Continue rendering the same `preMatchText`.
Append verdict block if available.

## 16. Safe Degradation

If Radar generation fails:
- do not block page
- do not show fake cards
- allow page to render match list normally
- optionally expose non-intrusive unavailable state

## 17. Backward Compatibility Rule

v2 snapshot contract may coexist with v1 snapshot storage during migration.
Compatibility adapters are allowed.
Silent reinterpretation of v1 historical records is forbidden.

## 18. Validation Rules

A snapshot is invalid if:
- scope keys are missing
- more than 3 cards exist
- duplicate `matchId` exists inside one scope
- `primaryLabel` is missing
- `preMatchText` is empty
- verdict exists before match is final
- family/label combination is impossible

## 19. Impossible Family/Label Combinations

Allowed combinations only:

- CONTEXT → EN_LA_MIRA
- CONTEXT → BAJO_EL_RADAR
- DYNAMICS → PARTIDO_ABIERTO
- DYNAMICS → DUELO_CERRADO
- MISALIGNMENT → SENAL_DE_ALERTA
- MISALIGNMENT → PARTIDO_ENGANOSO

Any other combination is invalid.

## 20. Success Condition

This contract succeeds when Radar snapshots are deterministic, atomic, renderable, historically honest, and frontend-safe.
