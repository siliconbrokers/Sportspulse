---
artifact_id: SPEC-SPORTPULSE-RADAR-V2-PACKAGE-INDEX
title: "Radar SportPulse v2 — Package Index"
artifact_class: index
status: draft
version: 2.0.0
project: sportpulse
domain: radar
slug: radar-v2-package-index
owner: team
created_at: 2026-03-16
updated_at: 2026-03-16
canonical_path: docs/specs/prediction/radar/Version 2/spec.sportpulse.radar-v2-package-index.md
---

# Radar SportPulse v2 — Package Index

## Purpose

This index defines the full documentation package required to implement Radar v2 as a
standalone module, without predictor integration.

Radar v2 must be deliverable, testable, and operable on its own.

## In Scope

This package includes:

1. Radar v2 Core Spec
2. Radar v2 JSON Contracts and Lifecycle
3. Radar v2 Editorial Rendering Policy
4. Radar v2 UI/UX Spec
5. Radar v2 QA, Acceptance, and Edge Cases
6. Radar v2 Implementation Guide
7. Radar v2 Migration and Rollout Plan

## Explicitly Out of Scope

The following are intentionally excluded from this package:

- predictor integration
- probability rendering
- hybrid ranking with prediction outputs
- dependency on PredictionResponse
- dependency on PredictionStore
- analytical gating driven by predictor operating mode
- public explanatory copy that references probabilities

Those concerns belong to a future Radar-Prediction Integration package.

## Package Philosophy

Radar v2 must preserve what v1 already solved correctly:

- snapshot-driven architecture
- matchday-scoped editorial module
- frontend without editorial recomputation
- frozen pre-match reading
- post-match contrast without historical overwrite
- deterministic rendering
- safe degradation

Radar v2 must replace what v1 handled poorly:

- monolithic internal label truth
- fixed linear precedence as the only resolution law
- mixed ontology between context, dynamics, and misalignment
- weak distinction between internal activation and visual primary badge

## Document Order

Recommended reading and implementation order:

1. `spec.sportpulse.radar-v2-core.md`
2. `spec.sportpulse.radar-v2-json-contracts-and-lifecycle.md`
3. `spec.sportpulse.radar-v2-editorial-rendering-policy.md`
4. `spec.sportpulse.radar-v2-ui-ux-spec.md`
5. `spec.sportpulse.radar-v2-qa-acceptance-and-edge-cases.md`
6. `spec.sportpulse.radar-v2-implementation-guide.md`
7. `spec.sportpulse.radar-v2-migration-and-rollout-plan.md`

## Implementation Rule

No implementation work may treat old integration drafts as source of truth for Radar v2.
Radar v2 must first exist as an autonomous system.

## Success Condition

This package is considered complete when Radar v2 can:

- compute cards without predictor integration
- persist valid snapshots per scope
- render deterministically in UI
- preserve frozen pre-match reading across match states
- append verdicts without overwriting original text
- pass acceptance and edge-case QA
- roll out without breaking Radar v1 history
