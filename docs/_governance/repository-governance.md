---
artifact_id: SPEC-SPORTPULSE-GOVERNANCE-REPOSITORY-GOVERNANCE
title: "Repository Governance Standard"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: governance
slug: repository-governance
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/_governance/repository-governance.md
---
# Repository Governance Standard

## 1. Purpose

This document defines the canonical governance standard for repository artifacts.

Its purpose is to eliminate naming drift, structural inconsistency, duplicate artifacts, unclear authority, and document sprawl.

This standard governs how artifacts are:

- classified
- named
- placed
- versioned
- linked
- superseded
- archived
- normalized

This is a repository rule, not a stylistic suggestion.

---

## 2. Scope

This standard applies to all non-trivial project artifacts, including but not limited to:

- documentation
- prompts and AI artifacts
- scripts and operational tooling
- tests
- schemas and migrations
- reports and audits
- temporary working artifacts

It does **not** force one naming convention onto all artifact categories.  
Each category follows its own appropriate convention.

---

## 3. Authority and precedence

The following precedence order applies:

1. Explicit repository-specific conventions already established for a given artifact category
2. This repository governance standard
3. Tool- or assistant-specific defaults

If an existing category already has a stronger local convention, that convention remains authoritative.

This document fills gaps, resolves ambiguity, and prevents drift. It does not authorize arbitrary rewrites of already-stable conventions.

---

## 4. Core principles

### 4.1 Artifact-first governance

Every file must be treated first as an artifact with a role, not merely as a filename.

### 4.2 Category-specific naming

Naming rules are category-dependent.  
A spec, a React component, a migration, and a scratch note must not be governed as if they were the same thing.

### 4.3 Canonical vs temporary separation

Stable artifacts must be clearly distinguishable from drafts, scratch files, exports, and other temporary material.

### 4.4 Metadata over filename overload

Artifact identity, status, ownership, and version must live in metadata where applicable, not be crammed into filenames.

### 4.5 Traceability over cleanliness theater

No meaningful artifact may be silently deleted or overwritten in the name of “cleanup”.

### 4.6 Reference integrity

Renames and relocations must consider import paths, relative links, CI references, scripts, configs, and discoverability.

### 4.7 Explicit supersession

If one artifact replaces another, that replacement must be explicit.

---

## 5. Artifact taxonomy

Every governed artifact must be assigned one primary class.

### 5.1 Documentation artifacts

- `spec`
- `analysis`
- `plan`
- `adr`
- `audit`
- `runbook`
- `report`
- `research`
- `changelog`
- `note`

### 5.2 Prompt and AI artifacts

- `prompt`
- `workflow`
- `skill`
- `agent-spec`
- `evaluation`
- `rubric`

### 5.3 Code and executable artifacts

- `module`
- `component`
- `service`
- `controller`
- `model`
- `utility`
- `hook`
- `job`
- `worker`
- `cli`
- `script`

### 5.4 Data and schema artifacts

- `migration`
- `seed`
- `schema`
- `contract`
- `fixture`
- `snapshot`

### 5.5 Temporary and non-canonical artifacts

- `draft`
- `scratch`
- `temp`
- `export`

If classification is ambiguous, the artifact must be classified according to its dominant purpose, not its superficial format.

---

## 6. Canonical repository placement

Preferred top-level structure:

```text
docs/
  _governance/
  _registry/
  specs/
  analyses/
  plans/
  adrs/
  audits/
  runbooks/
  reports/
  research/
  changelogs/
  notes/

prompts/
  _registry/

src/
tests/
scripts/
migrations/
schemas/
seeds/
assets/
tmp/
drafts/
exports/
archive/
```

### Placement rules

- canonical docs belong in `docs/`
- canonical prompt artifacts belong in `prompts/` if that folder exists
- executable scripts belong in `scripts/`
- tests belong in test folders appropriate to the stack
- migrations belong in `migrations/`
- temporary artifacts must live in non-canonical folders such as `tmp/`, `drafts/`, `scratch/`, or `exports/`
- canonical and temporary artifacts must not be mixed casually

If the repository already has an approved alternative structure, preserve it and apply these rules semantically.

---

## 7. Naming standards by artifact class

## 7.1 Stable documentation and prompt artifacts

Canonical format:

```text
<artifact_class>.<project>.<domain>.<slug>.md
```

Examples:

- `spec.sportpulse.portal.tournament-selection.md`
- `analysis.sportpulse.data.subtournament-support-gap.md`
- `plan.sportpulse.docs.repository-normalization.md`
- `prompt.sportpulse.docs.repo-governance-enforcer.md`

### Rules

- lowercase only
- ASCII only
- kebab-case tokens
- no spaces
- no underscores
- no vague suffixes such as `final`, `final2`, `new`, `latest`, `ok`, `fixed`, `reviewed`
- no dates in filenames for evergreen artifacts

---

## 7.2 Time-bound artifacts

Only inherently time-bound artifacts may include dates.

Canonical format:

```text
<artifact_class>.<project>.<domain>.<slug>.<yyyy-mm-dd>.md
```

Examples:

- `report.sportpulse.ops.shadow-mode-status.2026-03-15.md`
- `audit.sportpulse.portal.render-regression.2026-03-15.md`

Use dated filenames only when the artifact is meaningfully tied to a specific reporting date or event snapshot.

---

## 7.3 Code artifacts

Code files must follow the dominant language and framework convention of the repository.

Examples:

- `TournamentSelector.tsx`
- `computeTournamentPhase.ts`
- `tournament_phase_mapper.py`
- `tournament_phase_mapper.go`

### Rules

- preserve ecosystem-native naming
- do not rename code into document-style dot filenames
- do not rename code casually if imports, exports, route loading, reflection, or framework conventions may break

---

## 7.4 Test artifacts

Tests must mirror the target under test and follow the relevant test framework convention.

Examples:

- `tournament-phase-mapper.test.ts`
- `TournamentSelector.test.tsx`
- `test_tournament_phase_mapper.py`
- `tournament-selector.e2e.spec.ts`

### Rules

- the target under test must be inferable from the filename
- test helpers, fixtures, and mocks must be clearly named as such

---

## 7.5 Migration artifacts

Migrations are order-sensitive artifacts.

If no local convention exists, use:

```text
<yyyyMMddHHmmss>_<slug>.<ext>
```

Examples:

- `20260315103000_create_tournament_phase_table.sql`
- `20260315111500_add_prediction_status_index.ts`

### Rules

- preserve ordering
- never rename historical migrations casually
- treat migration renames as high-risk operations

---

## 7.6 Script artifacts

Scripts must use purpose-driven names.

Examples:

- `normalize-doc-registry.ts`
- `sync_competitions.py`
- `rebuild-search-index.sh`

### Rules

- prefer `verb + object`
- reject garbage names like `helper2`, `misc`, `testscript`, `script-final`

---

## 7.7 Temporary artifacts

Temporary artifacts may use looser names, but they must be isolated from canonical folders and must not impersonate source-of-truth artifacts.

Examples:

- `tmp/portal-filter-debug-notes.md`
- `drafts/spec.portal.phase-support.draft.md`
- `exports/match-data-2026-03-15.json`

---

## 8. Metadata standard for governed text artifacts

All governed documentation and prompt artifacts should include YAML frontmatter.

### Required schema

```yaml
---
artifact_id: <UPPERCASE-STABLE-ID>
title: <human-readable title>
artifact_class: <spec|analysis|plan|adr|audit|runbook|report|research|changelog|note|prompt|workflow|skill|agent-spec|evaluation|rubric>
status: <draft|active|superseded|deprecated|archived>
version: <MAJOR.MINOR.PATCH>
project: <project name>
domain: <functional area>
slug: <canonical slug>
owner: <team|role|person if known>
created_at: <YYYY-MM-DD>
updated_at: <YYYY-MM-DD>
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: <repo-relative-path>
---
```

### Rules

- `artifact_id` must be stable and unique
- `canonical_path` must match actual repository path
- `updated_at` must change on meaningful edits
- supersession must be explicit
- metadata must not contradict filename or folder placement

Code files do not require YAML frontmatter unless the project explicitly adopts such a pattern.

---

## 9. Stable artifact IDs

Governed non-code artifacts must use stable IDs in this format:

```text
<CLASS>-<PROJECT>-<DOMAIN>-<SLUG>
```

Examples:

- `SPEC-SPORTPULSE-PORTAL-TOURNAMENT-SELECTION`
- `ANALYSIS-SPORTPULSE-DATA-SUBTOURNAMENT-SUPPORT-GAP`
- `PLAN-SPORTPULSE-DOCS-REPOSITORY-NORMALIZATION`
- `PROMPT-SPORTPULSE-DOCS-REPO-GOVERNANCE-ENFORCER`

### Rules

- uppercase letters and hyphens only
- stable across non-breaking edits
- must not be regenerated arbitrarily

---

## 10. Versioning policy

Governed docs and prompt artifacts must use semantic versioning in metadata.

### 10.1 PATCH

Use `PATCH` for:

- wording cleanup
- formatting fixes
- typo fixes
- examples
- non-semantic clarifications

### 10.2 MINOR

Use `MINOR` for:

- additive sections
- expanded criteria
- clarifications that do not change core meaning
- non-breaking structural growth

### 10.3 MAJOR

Use `MAJOR` for:

- changed contract
- changed meaning
- changed decision
- incompatible rewrite
- materially different scope or authority

### Rules

- if identity remains stable, keep the same filename and `artifact_id`
- if semantic identity changes materially, create a new artifact instead of mutating the old one invisibly
- do not put versions in canonical filenames unless a local category-specific convention already requires it

---

## 11. Status policy

Governed non-code artifacts must have one of the following statuses:

- `draft`
- `active`
- `superseded`
- `deprecated`
- `archived`

### Meaning

- `draft`: not yet authoritative
- `active`: current and authoritative
- `superseded`: replaced by another artifact
- `deprecated`: still present but should no longer be extended
- `archived`: retained for history only

---

## 12. Supersession and archive policy

No meaningful artifact may disappear without trace.

### Rules

- when replacing an artifact, populate `supersedes` and `superseded_by`
- when retiring an artifact, mark it explicitly
- use `archive/` or equivalent for retired but historically relevant artifacts
- preserve discoverability of replacements

### Prohibited behavior

- deleting meaningful historical docs during “cleanup”
- overwriting an old spec with new meaning while keeping silent continuity
- leaving multiple overlapping artifacts active without authority clarification

---

## 13. Registry policy

Governed artifact families should be tracked in registries.

### Minimum registries

- `docs/_registry/document-registry.md`
- `prompts/_registry/prompt-registry.md`

### Optional but recommended

- `scripts/_registry/script-registry.md`
- `schemas/_registry/schema-registry.md`

### Minimum registry fields

- `artifact_id`
- `title` or `purpose`
- `artifact_class`
- `status`
- `version` where applicable
- `canonical_path`
- `supersedes`
- `superseded_by`

If the project grows beyond trivial size and no registry exists, creating one is the correct move.

---

## 14. Duplicate and overlap control

The following must be treated as governance violations:

- duplicate artifacts with different names but the same purpose
- overlapping specs with unclear authority
- reports pretending to be active specs
- drafts stored in canonical folders
- exports masquerading as source of truth
- multiple prompt variants with unclear scope or ownership
- generic filenames that hide function

Repository sprawl is not productivity.

---

## 15. Reference integrity policy

Before renaming or relocating artifacts, evaluate impact on:

- imports
- exports
- relative paths
- internal markdown links
- config references
- scripts
- CI workflows
- automation rules
- discovery patterns used by humans or tools

### Rules

- if references can be repaired safely, repair them
- if impact is uncertain, report the risk before applying destructive renames
- never normalize filenames while ignoring execution or linkage consequences

---

## 16. Normalization policy

Normalization means bringing repository artifacts into compliance with this standard.

### Required normalization workflow

1. inventory relevant artifacts
2. classify each artifact
3. detect naming violations
4. detect placement violations
5. detect duplicates and semantic overlaps
6. detect missing metadata where required
7. propose or apply canonical names
8. assign stable IDs where required
9. standardize version and status metadata
10. repair or update registries
11. evaluate reference impact
12. mark superseded or archived artifacts explicitly
13. produce a normalization report

### Normalization report must include

- old path
- new path
- artifact class
- action taken
- reason
- version/status impact
- supersession/archive action
- reference impact
- unresolved ambiguity

### Non-destructive rule

If the task is an audit, report only.  
If the task is an apply/normalize request, changes may be executed.  
Meaningful artifacts must never be silently deleted.

---

## 17. Operational behavior for future artifact work

Whenever creating or updating a project artifact, the operator must:

1. classify the artifact
2. decide whether it is canonical or temporary
3. choose the correct folder
4. apply the correct naming convention for that category
5. add metadata if required
6. assess reference impact
7. update registries if applicable
8. mark status and supersession explicitly where relevant

Failure to do this is governance drift.

---

## 18. Enforcement examples

## 18.1 Bad filenames

- `spec-final.md`
- `new_tournament_doc.md`
- `analysis_ok_now.md`
- `portalFixV2.md`
- `random_notes.md`

## 18.2 Good filenames

- `spec.sportpulse.portal.tournament-selection.md`
- `analysis.sportpulse.data.subtournament-support-gap.md`
- `report.sportpulse.ops.shadow-mode-status.2026-03-15.md`
- `normalize-doc-registry.ts`
- `TournamentSelector.tsx`

---

## 19. Default enforcement rule

From this point forward, all newly created or materially updated repository artifacts must comply with this standard unless a stronger explicit category-specific convention already exists.

This document is the default governance authority for repository artifact consistency.

---

## 20. Recommended companion artifacts

This standard is stronger when paired with:

- `docs/_registry/document-registry.md`
- `prompts/_registry/prompt-registry.md`
- a repository normalization playbook
- assistant/project instructions that reference this governance standard

Without those, the policy exists.  
With those, the policy operates.
