---
artifact_id: SPEC-SPORTPULSE-CORE-CORPUS-INTEGRATION-PATCH-LOG
title: "Corpus Integration Patch Log"
artifact_class: note
status: draft
version: 0.1.0
project: sportpulse
domain: core
slug: corpus-integration-patch-log
owner: team
created_at: 2026-03-21
updated_at: 2026-03-21
canonical_path: docs/core/spec.sportpulse.core.corpus-integration-patch-log.md
---

# SportPulse — Corpus Integration Patch Log

This note records the active-corpus integration work performed on 2026-03-21 for the backend↔frontend reengineering delta.

Patched documents:
- `spec.sportpulse.qa.acceptance-test-matrix.md` — added K-07 and K-08; minimum acceptance set now includes K-series.
- `spec.sportpulse.qa.prediction-track-record-fixtures.md` — corrected PF↔K mapping to avoid K-series collision.
- `spec.sportpulse.core.implementation-backlog.md` — Phase 10/11 tickets now reference the new backend delta contracts.
- `spec.sportpulse.core.repo-structure-and-module-boundaries.md` — added `docs/backend/` and `docs/qa/` locations for the delta package.
- `spec.sportpulse.core.ai-sdd-operating-protocol.md` — added mandatory delta package reading for web/auth/commercial integration work.
- `spec.sportpulse.core.constitution.md` — added a binding frontend reengineering delta package subsection.
- `spec.sportpulse.web.frontend-execution-backlog.md` — removed "K-08 or equivalent" ambiguity.
- `spec.sportpulse.web.frontend-modernization.md` — removed "K-08 or equivalent" ambiguity.
- `spec.sportpulse.web.auth-and-freemium-surface.md` — aligned K-07 wording with active acceptance adoption.

Remaining work outside this patch set:
- absorb the delta package into `spec.sportpulse.api.contract.md`
- absorb the delta package into `spec.sportpulse.server.backend-architecture.md`
- decide final status promotion path for the backend delta sub-specs after implementation review
