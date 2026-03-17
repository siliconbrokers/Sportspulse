---
artifact_id: SPEC-SPORTPULSE-RADAR-V2-QA
title: "Radar SportPulse — QA, Acceptance, and Edge Cases v2"
artifact_class: qa_spec
status: draft
version: 2.0.0
project: sportpulse
domain: radar
slug: radar-v2-qa-acceptance-and-edge-cases
owner: team
created_at: 2026-03-16
updated_at: 2026-03-16
canonical_path: docs/specs/prediction/radar/Version 2/spec.sportpulse.radar-v2-qa-acceptance-and-edge-cases.md
---

# Radar SportPulse — QA, Acceptance, and Edge Cases v2

## 1. Purpose

This document defines acceptance criteria and edge-case behavior for Radar v2 as a standalone module.

## 2. Core Acceptance Criteria

Radar v2 is acceptable only if:

- scope isolation is preserved
- no more than 3 cards are emitted
- no filler cards are invented
- frontend never recomputes editorial logic
- pre-match text remains frozen through match state transitions
- verdict never overwrites original text
- degraded behavior remains safe
- impossible family/label combinations are rejected
- historical rebuilds are explicitly marked when applicable

## 3. Functional Tests

### 3.1 Scope Isolation
Given one selected competition and matchday,
Radar must only show matches from that scope.

### 3.2 Empty Valid Scope
Given a valid scope with no qualifying cards,
Radar returns `EMPTY` and does not fabricate content.

### 3.3 Max Card Count
Given many candidate matches,
Radar outputs at most 3 cards.

### 3.4 Duplicate Match Prevention
The same `matchId` may not appear twice in one snapshot.

### 3.5 Frozen Pre-Match Copy
When a match moves from pre-match to in-play to post-match,
the original `preMatchText` remains unchanged.

### 3.6 Verdict Append-Only
After match completion,
verdict may be added but original reading remains intact.

### 3.7 Safe Failure
If Radar generation fails,
the rest of the page still renders.

## 4. Data Integrity Tests

Reject snapshot if:
- scope keys missing
- `primaryLabel` missing
- `family` invalid
- family/label combination invalid
- more than 3 cards
- empty `preMatchText`
- verdict before final state
- duplicate `matchId`

## 5. Evidence Tier Discipline

### BOOTSTRAP
Must remain conservative.
Aggressive or overconfident misalignment labeling should be rare and reviewable.

### EARLY
May be moderately expressive but still disciplined.

### STABLE
Normal Radar operation allowed.

## 6. Edge Cases

### 6.1 Postponed Match
If match is postponed:
- preserve card history if already published
- do not append final verdict prematurely

### 6.2 Cancelled Match
If cancelled:
- preserve historical pre-match reading
- no normal verdict
- optional cancelled-state treatment may be added later

### 6.3 Provider Disagreement
If source data conflicts:
- degrade safely
- avoid false verdict emission

### 6.4 Promoted or Thin-History Teams
If team history is thin:
- Radar may still operate under `BOOTSTRAP`
- copy must remain conservative

### 6.5 Historical Rebuild
If rebuilding old scopes:
- mark `isHistoricalRebuild = true`
- avoid pretending it was original live-time generation

### 6.6 Partial Input Loss
If some Radar inputs are missing:
- prefer `DEGRADED` over fake confidence
- do not produce ornate editorial certainty

## 7. UI Acceptance Criteria

- primary badge always visible
- pre-match text readable on mobile
- verdict visually separated from original text
- degraded state non-blocking
- failed state non-destructive

## 8. Regression Guard

Any implementation that restores v1 blind precedence as the sole resolver fails review.

Any implementation that treats one primary visible label as one internal truth fails review.

## 9. Success Condition

QA succeeds when Radar v2 behaves safely, consistently, honestly, and deterministically across normal and pathological cases.
