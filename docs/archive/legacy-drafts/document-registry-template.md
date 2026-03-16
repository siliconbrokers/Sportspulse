---
artifact_id: SPEC-SPORTPULSE-GOVERNANCE-DOCUMENT-REGISTRY-TEMPLATE
title: "Document Registry (Template — superseded by docs/_registry/document-registry.md)"
artifact_class: spec
status: superseded
version: 1.0.0
project: sportpulse
domain: governance
slug: document-registry-template
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: ['SPEC-SPORTPULSE-GOVERNANCE-DOCUMENT-REGISTRY']
related_artifacts: []
canonical_path: docs/archive/legacy-drafts/document-registry-template.md
---
# Document Registry

## 1. Purpose

This registry is the authoritative index of governed project documents.

Its purpose is to provide a single, auditable view of:

- document identity
- document class
- current status
- version
- canonical path
- supersession relationships
- ownership and update traceability

This file is not optional bookkeeping. It is the minimum control surface required to keep documentation navigable as the repository grows.

---

## 2. Scope

This registry tracks governed documentation artifacts, including:

- specs
- analyses
- plans
- ADRs
- audits
- runbooks
- reports
- research documents
- changelogs
- governed notes

It does **not** replace detailed per-document metadata. It centralizes discoverability and authority.

---

## 3. Authority

If there is any conflict between:

- a random filename in the repository,
- a stale link in another document, and
- this registry,

then the conflict must be resolved explicitly.

This registry is intended to reflect the current canonical state, but the source of truth for document semantics remains the document itself plus its frontmatter.

---

## 4. Required fields

Each governed document entry must contain, at minimum:

- `artifact_id`
- `title`
- `artifact_class`
- `status`
- `version`
- `project`
- `domain`
- `owner`
- `canonical_path`
- `supersedes`
- `superseded_by`
- `updated_at`

### Field definitions

| Field | Meaning |
|---|---|
| `artifact_id` | Stable unique identifier for the document |
| `title` | Human-readable title |
| `artifact_class` | Primary class such as `spec`, `analysis`, `plan`, `adr`, `audit`, `runbook`, `report`, `research`, `changelog`, `note` |
| `status` | `draft`, `active`, `superseded`, `deprecated`, or `archived` |
| `version` | Semantic version in `MAJOR.MINOR.PATCH` format |
| `project` | Project or product namespace |
| `domain` | Functional area or subsystem |
| `owner` | Person, role, or team responsible |
| `canonical_path` | Repository-relative path to the current authoritative file |
| `supersedes` | Prior artifact IDs replaced by this document |
| `superseded_by` | Replacement artifact ID if this entry is no longer authoritative |
| `updated_at` | Last meaningful update date |

---

## 5. Registry rules

### 5.1 One row per governed document

Each governed document must appear exactly once in the active registry.

### 5.2 No duplicate identity

No two active rows may share the same `artifact_id`.

### 5.3 Canonical path must be current

If a document is moved or renamed, the `canonical_path` must be updated immediately.

### 5.4 Supersession must be explicit

If a document is replaced, both the old and new entries must reflect the supersession relationship.

### 5.5 Status must be meaningful

Do not leave `status` vague or implicit. A document is not “kind of current.” It is either active, draft, deprecated, superseded, or archived.

### 5.6 No silent disappearance

If a governed document is removed from canonical use, do not delete its registry history without explicit archival handling.

---

## 6. Maintenance workflow

Whenever a governed document is created, renamed, superseded, archived, or materially updated:

1. create or update the document frontmatter
2. assign or preserve the stable `artifact_id`
3. update the registry row
4. update `canonical_path` if the file moved
5. update `version` if semantics changed
6. update `status` if lifecycle changed
7. update `supersedes` / `superseded_by` if applicable
8. update `updated_at`

Failure to update the registry is governance drift.

---

## 7. Sorting policy

Preferred ordering for registry entries:

1. `artifact_class`
2. `project`
3. `domain`
4. `title`

Alternative ordering is acceptable only if the project already uses a stronger convention.

---

## 8. Status meanings

| Status | Meaning |
|---|---|
| `draft` | Exists but is not yet authoritative |
| `active` | Current authoritative document |
| `superseded` | Replaced by another document |
| `deprecated` | Still relevant for reference, but should not be extended |
| `archived` | Retained for history only |

---

## 9. Registry table

> Replace example rows below with real project entries. Do not keep fake examples in a production registry once real rows exist.

| artifact_id | title | artifact_class | status | version | project | domain | owner | canonical_path | supersedes | superseded_by | updated_at |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SPEC-EXAMPLE-PORTAL-TOURNAMENT-SELECTION | Tournament Selection Specification | spec | active | 1.0.0 | example | portal | product-team | docs/specs/spec.example.portal.tournament-selection.md |  |  | 2026-03-15 |
| ANALYSIS-EXAMPLE-DATA-SUBTOURNAMENT-SUPPORT-GAP | Subtournament Support Gap Analysis | analysis | active | 1.1.0 | example | data | architecture | docs/analyses/analysis.example.data.subtournament-support-gap.md |  |  | 2026-03-15 |
| PLAN-EXAMPLE-DOCS-REPOSITORY-NORMALIZATION | Repository Normalization Plan | plan | draft | 0.1.0 | example | docs | engineering | docs/plans/plan.example.docs.repository-normalization.md |  |  | 2026-03-15 |
| ADR-EXAMPLE-SHARED-REPOSITORY-GOVERNANCE | Repository Governance ADR | adr | active | 1.0.0 | example | shared | architecture | docs/adrs/adr.example.shared.repository-governance.md |  |  | 2026-03-15 |
| AUDIT-EXAMPLE-PORTAL-RENDER-REGRESSION | Portal Render Regression Audit | audit | superseded | 1.0.0 | example | portal | qa | docs/audits/audit.example.portal.render-regression.2026-03-01.md |  | AUDIT-EXAMPLE-PORTAL-RENDER-REGRESSION-FOLLOWUP | 2026-03-15 |

---

## 10. Optional segmented views

If the registry becomes large, maintain derived sections or separate filtered views such as:

- Active documents only
- Drafts requiring completion
- Superseded documents awaiting archive move
- Documents by project
- Documents by owner

These derived views do not replace the master registry.

---

## 11. Quality checks

The registry should periodically be audited for:

- missing documents that exist in canonical folders but are absent from the registry
- stale `canonical_path` values
- duplicate or conflicting `artifact_id` values
- active documents with missing or empty versions
- superseded documents missing replacement references
- rows pointing to files that no longer exist

---

## 12. Prohibited behaviors

The following are governance violations:

- adding governed docs without registry entries
- renaming documents without updating `canonical_path`
- keeping multiple active documents with the same authority scope and no differentiation
- deleting historical entries to fake cleanliness
- using the registry as a dumping ground for temporary notes or exports

---

## 13. Recommended companion files

This registry is strongest when used together with:

- `docs/_governance/repository-governance.md`
- document frontmatter in each governed file
- normalization reports for major cleanup operations
- prompt and script registries where those artifact families matter

---

## 14. Operational template for adding a new row

Use this checklist when registering a new document:

- classify the document
- assign `artifact_id`
- confirm the canonical filename
- confirm the canonical folder
- set the initial `status`
- set the initial `version`
- write or verify frontmatter
- add the registry row
- verify supersession fields
- verify the repository path

---

## 15. Default enforcement rule

Any governed document that is not present in this registry is incompletely governed.

That is not a cosmetic issue. It means the repository’s documentary control is broken.
