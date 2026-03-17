---
artifact_id: SPEC-SPORTPULSE-RADAR-V2-MIGRATION
title: "Radar SportPulse — Migration and Rollout Plan v2"
artifact_class: rollout_plan
status: draft
version: 2.0.0
project: sportpulse
domain: radar
slug: radar-v2-migration-and-rollout-plan
owner: team
created_at: 2026-03-16
updated_at: 2026-03-16
canonical_path: docs/specs/prediction/radar/Version 2/spec.sportpulse.radar-v2-migration-and-rollout-plan.md
---

# Radar SportPulse — Migration and Rollout Plan v2

## 1. Purpose

This document defines how Radar v2 should be introduced without mixing it with predictor integration work.

## 2. Strategic Rule

Radar v2 rollout must happen as a standalone project.

Integration with predictor is a later project.
It must not contaminate v2 core rollout.

## 3. Migration Philosophy

Preserve what is historically valid.
Replace what is semantically weak.
Avoid silent reinterpretation.

## 4. Rollout Phases

### Phase 0 — Freeze Baseline
Freeze Radar v1 documentation and behavior as baseline historical reference.

### Phase 1 — Introduce v2 Contracts
Create v2 contracts, validators, and snapshot envelope.

No UI switch yet.

### Phase 2 — Dual Internal Support
Allow v1 and v2 snapshots to coexist in non-public or staging environments.

### Phase 3 — Implement v2 Standalone Logic
Ship candidate evaluation, family resolution, card resolution, rendering, and verdict append flow.

### Phase 4 — Shadow Validation
Run v2 against live scopes without making it primary UI truth.
Inspect semantic coherence, card quality, and QA results.

### Phase 5 — Controlled UI Rollout
Expose Radar v2 in controlled environments or behind rollout gating.

### Phase 6 — Promote v2
Promote Radar v2 as the default Radar implementation.

### Phase 7 — Archive v1 Logic
Keep v1 historical records, but retire v1 as active generation logic.

## 5. Migration Rules

### 5.1 No Historical Rewrite
Old v1 cards remain historical artifacts of v1.

### 5.2 Version Visibility
All snapshots must clearly expose schema version.

### 5.3 No Forced Backfill
Do not mass-regenerate old scopes just to make history look uniform.

### 5.4 Explicit Rebuilds
If historical rebuilds are ever performed, mark them explicitly.

## 6. Operational Checklist

Before promoting v2:
- contracts validated
- impossible combinations rejected
- max-3-card rule enforced
- empty/degraded/failed states tested
- frozen pre-match text behavior verified
- verdict append-only behavior verified
- mobile readability verified

## 7. Rollout Kill Conditions

Pause rollout if:
- v2 rewrites old reading
- v2 emits impossible family/label pairs
- v2 fabricates filler cards
- UI depends on frontend recomputation
- degraded states confuse or block page behavior

## 8. Documentation Rule

Do not treat old integration drafts as rollout prerequisites for Radar v2.
They are separate future work.

## 9. Exit Criteria

Radar v2 rollout is complete when:
- standalone generation is stable
- UI is using v2 safely
- QA edge cases pass
- historical truth is preserved
- no predictor dependency exists in the active Radar v2 path
