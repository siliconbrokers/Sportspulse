---
artifact_id: SPEC-SPORTPULSE-RADAR-V2-IMPLEMENTATION
title: "Radar SportPulse — Implementation Guide v2"
artifact_class: implementation_guide
status: draft
version: 2.0.0
project: sportpulse
domain: radar
slug: radar-v2-implementation-guide
owner: team
created_at: 2026-03-16
updated_at: 2026-03-16
canonical_path: docs/specs/spec.sportpulse.radar-v2-implementation-guide.md
---

# Radar SportPulse — Implementation Guide v2

## 1. Purpose

This guide translates the v2 specs into implementation-oriented decisions.

It is intentionally predictor-agnostic.

## 2. Recommended Architecture

Suggested module split:

- `radar-types.ts`
- `radar-scope-loader.ts`
- `radar-candidate-evaluator.ts`
- `radar-family-resolver.ts`
- `radar-card-resolver.ts`
- `radar-text-renderer.ts`
- `radar-verdict-resolver.ts`
- `radar-snapshot-writer.ts`
- `radar-validator.ts`

## 3. Recommended Responsibility Split

### radar-types.ts
Defines:
- labels
- families
- evidence tiers
- confidence bands
- snapshot contracts

### radar-scope-loader.ts
Loads canonical scope input data.

### radar-candidate-evaluator.ts
Evaluates candidate matches and computes internal signal space.

### radar-family-resolver.ts
Resolves active families and their strengths.

### radar-card-resolver.ts
Resolves primary label, secondary badges, reasons, and final card structure.

### radar-text-renderer.ts
Renders deterministic editorial copy from label and subtype.

### radar-verdict-resolver.ts
Computes post-match verdicts without overwriting original text.

### radar-snapshot-writer.ts
Writes validated snapshot atomically.

### radar-validator.ts
Validates contracts and lifecycle laws before persistence.

## 4. Design Rule

Implementation must preserve richer internal truth than what UI displays.

Do not collapse internal model too early.

## 5. Internal Evaluation Strategy

A practical standalone Radar v2 flow:

1. load scope data
2. build candidate set
3. compute family-relevant internal signals
4. score family activations
5. resolve dominant reading
6. attach secondary badges if worthy
7. resolve subtype
8. render text deterministically
9. validate
10. atomically persist snapshot

## 6. Subtype Strategy

Subtype logic should remain bounded, versioned, and explainable.

Do not let subtype selection become free-form prompt output.

## 7. Legacy Compatibility Strategy

v1 historical snapshots may remain untouched.

v2 implementation may:
- coexist beside v1 snapshots
- use migration adapter layers
- expose version field clearly

It may not:
- silently reinterpret old historical Radar cards as v2 truth

## 8. Debugability

Internal debug payloads may exist in non-public environments to inspect:
- family scores
- active labels
- rejected labels
- reason weights
- chosen subtype
- confidence band

These fields need not be exposed publicly.

## 9. Conservative Defaults

When in doubt:
- choose fewer cards
- choose weaker copy
- degrade safely
- preserve honesty

## 10. Anti-Patterns

Do not:
- recreate blind six-label precedence as sole law
- let frontend infer labels
- let renderer invent unbounded text
- overwrite original pre-match copy
- use filler cards
- fake `dataQuality = OK`
- keep `isHistoricalRebuild` hardcoded false

## 11. Delivery Strategy

Recommended implementation sequence:

1. contracts and types
2. validator
3. snapshot writer
4. candidate evaluator
5. family resolver
6. card resolver
7. text renderer
8. verdict resolver
9. UI wiring
10. QA hardening

## 12. Success Condition

Implementation succeeds when Radar v2 behaves as an autonomous, deterministic, frozen, render-safe module with cleaner semantics than v1.
