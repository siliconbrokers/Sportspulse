---
artifact_id: REPORT-SPORTPULSE-GOVERNANCE-NORMALIZATION-2026-03-15
title: "Repository Normalization Report — 2026-03-15"
artifact_class: report
status: active
version: 1.0.0
project: sportpulse
domain: governance
slug: normalization-report-2026-03-15
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-GOVERNANCE-REPOSITORY-GOVERNANCE
  - SPEC-SPORTPULSE-GOVERNANCE-NORMALIZATION-PLAYBOOK
  - SPEC-SPORTPULSE-GOVERNANCE-DOCUMENT-REGISTRY
  - SPEC-SPORTPULSE-GOVERNANCE-PROMPT-REGISTRY
  - SPEC-SPORTPULSE-GOVERNANCE-SCRIPT-REGISTRY
canonical_path: docs/_governance/normalization-report-2026-03-15.md
---

# Repository Normalization Report — 2026-03-15

## 1. Scope Statement

Full repository normalization of the SportsPulse monorepo against the governance standard defined in `docs/_governance/repository-governance.md`. Covers all governed artifact families: documentation (`docs/`), prompt/AI artifacts (`.claude/agents/`, `prompts/`), and scripts/operational tooling (`scripts/`).

---

## 2. Authoritative Sources

- `docs/_governance/repository-governance.md` — naming, placement, metadata, versioning, supersession, registry rules
- `docs/_governance/normalization-playbook.md` — apply-mode workflow (Steps 1–10)
- `docs/_registry/document-registry.md` — document index
- `prompts/_registry/prompt-registry.md` — prompt artifact index
- `scripts/_registry/script-registry.md` — script artifact index

---

## 3. Assumptions

1. All `.claude/agents/*.md` files use framework-native frontmatter (`name`, `description`, `model`) — governance frontmatter NOT applied per §3 of governance standard (framework convention takes precedence).
2. `memory/` directory is outside governance scope (conversation-scoped, not artifact-scoped).
3. `docs/plans/SP-xxxx.md` files retain short-code convention per existing project ticket system; canonical naming not applied to these.
4. Archive files in `docs/archive/legacy-drafts/` are retained with their original filenames where special characters were present (shell-safety reason), except where renamed was safe.
5. Audit files in `docs/audits/` retain date-stamped convention (`PE-audit-YYYY-MM-DD.md`) as that is the established operational convention for the PE auditor.

---

## 4. Findings Summary

| Category | Count |
|----------|-------|
| Naming violations (resolved) | 56 |
| Duplicate/export artifacts archived | 11 |
| Files renamed to canonical pattern | ~70 |
| Files with missing frontmatter (resolved) | 60 |
| Missing registries (created) | 3 |
| Cross-references repaired (CLAUDE.md, agents) | 12 |
| Open violations remaining | 0 |

---

## 5. Violation Classification Map

### 5.1 Naming Violations (all resolved)

| Pattern | Count | Resolution |
|---------|-------|-----------|
| `#` prefix (export artifacts) | 7 | Archived to `docs/archive/legacy-drafts/` |
| Human-readable names with spaces | ~25 | Renamed to `spec.sportpulse.<domain>.<slug>.md` |
| Version suffix (`_v1.0`, `_v1.3_Final`) | ~15 | Version moved to frontmatter `version` field |
| `-corrected` suffix | 8 | Suffix removed (canonical has no corrected suffix) |
| `(1)` export suffix | 1 | Archived |
| Uppercase snake_case (`MOTOR_PREDICTIVO_V2_SPEC...`) | 2 | Archived (superseded) |
| Root-level governance files (wrong placement) | 5 | Moved to `docs/_governance/`, `docs/_registry/`, `prompts/_registry/`, `scripts/_registry/` |

### 5.2 Placement Violations (all resolved)

| Violation | Resolution |
|-----------|-----------|
| `Repo_Structure_and_Module_Boundaries_v1.0.md` in `docs/architecture/` | Moved to `docs/core/` (it is a core governance spec) |
| `Predictive_Engine_Rollout_Plan_v1.0.md` in `docs/specs/` | Moved to `docs/plans/` |
| 5 governance framework files at repo root | Moved to canonical subdirectories |
| `SP-PRED-V3-Unified-Engine-Spec.md` at repo root | Archived as superseded |
| `SP-PRED-V2-Production-Authorization.md` at repo root | Moved to `docs/specs/adr.sportpulse.prediction.pe-v2-production-authorization.md` |

### 5.3 Missing Metadata (all resolved)

All ~60 governed docs received YAML frontmatter including: `artifact_id`, `title`, `artifact_class`, `status`, `version`, `project`, `domain`, `slug`, `owner`, `created_at`, `updated_at`, `supersedes`, `superseded_by`, `related_artifacts`, `canonical_path`.

---

## 6. Rename / Move Map

### docs/core/ (13 files)

| Before | After |
|--------|-------|
| `AI_SDD_Operating_Protocol_v1.0.md` | `spec.sportpulse.core.ai-sdd-operating-protocol.md` |
| `SportPulse_Constitution_v2.0_Master.md` | `spec.sportpulse.core.constitution.md` |
| `Domain_Glossary_and_Invariants_v1.0.md` | `spec.sportpulse.core.domain-glossary-and-invariants.md` |
| `Implementation_Backlog_SDD_v1.0.md` | `spec.sportpulse.core.implementation-backlog.md` |
| `MVP_Execution_Scope_v1.0.md` | `spec.sportpulse.core.mvp-execution-scope.md` |
| `Non_Functional_Requirements_v1.0.md` | `spec.sportpulse.core.non-functional-requirements.md` |
| `Repo_Structure_and_Module_Boundaries_v1.0.md` (from `docs/architecture/`) | `spec.sportpulse.core.repo-structure-and-module-boundaries.md` |
| `SubAgents_Definition_v1.0.md` | `spec.sportpulse.core.subagents-definition.md` |
| `Universal Case Intake Protocol.md` | `spec.sportpulse.core.universal-case-intake-protocol.md` |
| `Operational_Baseline_v1.0.md` | `spec.sportpulse.ops.operational-baseline.md` |
| `Acceptance_Test_Matrix_v1.0.md` | `spec.sportpulse.qa.acceptance-test-matrix.md` |
| `Golden_Snapshot_Fixtures_v1.0.md` | `spec.sportpulse.qa.golden-snapshot-fixtures.md` |
| `Errors_and_Warnings_Taxonomy_v1.0.md` | `spec.sportpulse.shared.errors-and-warnings-taxonomy.md` |

### docs/specs/ (~29 files renamed, 2 moved to plans, 1 moved to governance infrastructure)

Selected highlights:
| Before | After |
|--------|-------|
| `SportPulse_Predictive_Engine_Spec_v1.3_Final.md` | `spec.sportpulse.prediction.engine.md` |
| `api-contract-corrected.md` | `spec.sportpulse.api.contract.md` |
| `signals-spec.md` | `spec.sportpulse.signals.core.md` |
| `metrics-spec-corrected.md` | `spec.sportpulse.signals.metrics.md` |
| `scoring-policy.md` | `spec.sportpulse.scoring.policy.md` |
| `snapshot-engine-spec-corrected.md` | `spec.sportpulse.snapshot.engine.md` |
| `dashboard-snapshot-dto-corrected-v1.2.md` | `spec.sportpulse.snapshot.dashboard-dto.md` |
| `matchday-cache-technical-spec.md` | `spec.sportpulse.server.matchday-cache.md` |
| `Predictive_Engine_Rollout_Plan_v1.0.md` | `docs/plans/plan.sportpulse.prediction.pe-rollout.md` |
| `SP-PRED-V2-Production-Authorization.md` | `docs/specs/adr.sportpulse.prediction.pe-v2-production-authorization.md` |

### docs/architecture/ (3 files)

| Before | After |
|--------|-------|
| `frontend-architecture-corrected.md` | `spec.sportpulse.web.frontend-architecture.md` |
| `# SportPulse Frontend Component Map.md` | `spec.sportpulse.web.component-map.md` |
| `Backend Architecture (MVP) — football-data.md` | `spec.sportpulse.server.backend-architecture.md` |

### docs/data/, docs/evolution/, docs/product/ (8 files — all renamed to canonical pattern)

---

## 7. Versioning / Status Actions

| Artifact | Action | Rationale |
|----------|--------|-----------|
| `spec.sportpulse.prediction.engine-v3-draft-superseded.md` | status=superseded | V3 draft, never activated, PE v1.3 is canonical |
| `adr.sportpulse.prediction.pe-v2-production-authorization.md` | status=superseded | V2 authorization superseded by PE v1.3 implementation |
| `docs/archive/legacy-drafts/document-registry-template.md` | status=superseded | Template superseded by `docs/_registry/document-registry.md` |
| All archived `#` prefix duplicates | status=archived | Export duplicates of canonical specs |

---

## 8. Supersession / Archive Actions

| Archived File | Reason | Superseded By |
|---------------|--------|---------------|
| `# Match Detail Card Update Spec.md` | Duplicate of canonical spec | `spec.sportpulse.portal.match-detail-card-update.md` |
| `# Motor Predictivo V2.md` | Draft, superseded | `spec.sportpulse.prediction.engine.md` |
| `# SPEC — Back Office...menú.md` | Feature implemented; original preserved | — |
| `# SportPulse — Incremental Rollout Plan Update.md` | Duplicate | `plan.sportpulse.prediction.pe-rollout.md` |
| `# SportPulse — Predictive Engine Runtime Observation...md` | Duplicate | `PE-observation-evaluation-implementation-plan.md` |
| `# Track A Backend Runtime Observation Protocol.md` | Duplicate | `spec.sportpulse.prediction.track-a-observation-automation.md` |
| `# Track A Runtime Observation Protocol.md` | Duplicate | `spec.sportpulse.prediction.track-a-observation-automation.md` |
| `MOTOR_PREDICTIVO_V2_SPEC_FINAL_CONGELADA.md` | Superseded | `spec.sportpulse.prediction.engine.md` |
| `match_map_card_frontend_implementation_spec (1).md` | Export artifact `(1)` suffix | `spec.sportpulse.web.match-map-visual-encoding.md` |
| `track_a_backend_runtime_observation_template - Hoja 1.csv` | Runtime data export, not a spec | — |
| `spec.sportpulse.prediction.engine-v3-draft-superseded.md` | V3 draft, never activated | `spec.sportpulse.prediction.engine.md` |
| `document-registry-template.md` | Template superseded by real registry | `docs/_registry/document-registry.md` |

---

## 9. Registry Updates

### 9.1 Document Registry (`docs/_registry/document-registry.md`)

- **Created**: full registry with ~45 entries across 9 sections (core, specs, architecture, data, evolution, product, audits, plans, archive)
- **Added**: Governance Infrastructure section with 6 entries for the governance framework files themselves
- **Coverage**: all artifact families in `docs/`

### 9.2 Prompt Registry (`prompts/_registry/prompt-registry.md`)

- **Created**: registry document with governance rules, schema, maintenance policy
- **Populated**: 12 agent-spec entries for all `.claude/agents/*.md` files
- **Artifact IDs**: `AGENT-SPEC-SPORTPULSE-*` pattern

### 9.3 Script Registry (`scripts/_registry/script-registry.md`)

- **Populated**: 22 real SportsPulse scripts (prediction engine backtest, calibration, validation, Track A, hypothesis series H6a–H11b)
- **Replaced**: 3 generic placeholder entries from governance template

---

## 10. Reference Repair Impact

| File | References Updated |
|------|--------------------|
| `CLAUDE.md` | Document Hierarchy (§ Constitutional Reading Order) updated to canonical filenames for all 13 precedence-level documents |
| `.claude/agents/*.md` (8 PE files) | `SportPulse_Predictive_Engine_Spec_v1.3_Final.md` → `docs/specs/spec.sportpulse.prediction.engine.md` |
| `memory/MEMORY.md` | `matchday-cache-technical-spec.md` → `docs/specs/spec.sportpulse.server.matchday-cache.md` |

---

## 11. Open Ambiguities

None. All ambiguities were resolved:

- Agent files use framework-native frontmatter (not governance frontmatter) — §3 of governance standard
- Archive files with special characters in filenames retain originals (shell-safety)
- `docs/plans/SP-xxxx.md` retain short-code convention (existing ticket system)

---

## 12. Definition of Done

- [x] All ~56 naming violations resolved
- [x] All 11 duplicate/export artifacts archived with supersession records
- [x] All ~60 governed docs have YAML frontmatter
- [x] Document registry created with full coverage
- [x] Prompt registry created and populated with 12 real agent-spec entries
- [x] Script registry populated with 22 real scripts
- [x] CLAUDE.md document hierarchy updated to canonical filenames
- [x] All 8 PE agent files updated to new spec path
- [x] All governance infrastructure files staged in git
- [x] Normalization report produced (this document)

---

*Report generated: 2026-03-15. Executed against governance standard v1.0.0.*
