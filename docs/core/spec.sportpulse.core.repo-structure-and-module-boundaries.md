---
artifact_id: SPEC-SPORTPULSE-CORE-REPO-STRUCTURE-AND-MODULE-BOUNDARIES
title: "Repo Structure and Module Boundaries"
artifact_class: spec
status: active
version: 1.2.0
project: sportpulse
domain: core
slug: repo-structure-and-module-boundaries
owner: team
created_at: 2026-03-15
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-SERVER-BACKEND-ARCHITECTURE
canonical_path: docs/core/spec.sportpulse.core.repo-structure-and-module-boundaries.md
---
# Repo Structure and Module Boundaries

Version: 1.2.0  
Status: Active

## Active additions required by frontend delta
Within `packages/api/src/server/` the following directories are now canonical:
- `auth/`
- `commerce/`
- `track-record/`
- `mail/`

Within `packages/api/` the following are canonical:
- `migrations/` for runtime state migrations

Boundary rules:
- frontend imports contracts, never backend service internals
- prediction computation remains outside `server/` route handlers
- mail provider adapters sit behind `server/mail/`, not inside frontend or commerce code
