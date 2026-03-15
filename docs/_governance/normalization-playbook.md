---
artifact_id: SPEC-SPORTPULSE-GOVERNANCE-NORMALIZATION-PLAYBOOK
title: "Repository Normalization Playbook"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: governance
slug: normalization-playbook
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/_governance/normalization-playbook.md
---
# Repository Normalization Playbook

## 1. Purpose

This playbook defines the operational procedure for auditing, planning, and executing repository normalization work under the repository governance standard.

It exists to prevent fake cleanup, unsafe renames, silent deletions, broken references, and uncontrolled document sprawl.

This is not a theory document. It is an execution procedure.

---

## 2. Scope

This playbook applies whenever the repository or a material subset of it must be:

- audited for naming or structural drift
- normalized for consistency
- cleaned without losing traceability
- reorganized by artifact class
- prepared for scale, handoff, or formal governance
- repaired after uncontrolled artifact proliferation

It applies to governed artifact families such as:

- documentation
- prompts and AI artifacts
- scripts
- tests
- schemas and migrations
- temporary artifacts incorrectly stored as canonical artifacts

---

## 3. Governing rule

All normalization work must comply with `docs/_governance/repository-governance.md`.

If a stronger category-specific convention already exists in the repository, that local convention overrides this playbook for that category.

---

## 4. Core non-negotiables

### 4.1 No silent deletion

No meaningful artifact may be silently deleted during normalization.

### 4.2 No silent overwrite

No canonical artifact may be overwritten with materially different meaning without explicit supersession handling.

### 4.3 No blind renames

No rename or relocation may be applied without considering imports, links, references, configs, CI, scripts, and discovery impact.

### 4.4 No cleanup theater

Moving chaos into different folders without classification, metadata, and traceability is not normalization.

### 4.5 Classification before action

Every relevant artifact must be classified before it is renamed, moved, archived, merged, or superseded.

---

## 5. Normalization modes

## 5.1 Audit mode

Use audit mode when the task is to inspect, assess, map violations, and propose changes.

Audit mode must:

- inventory artifacts
- classify artifacts
- detect violations
- detect overlap and duplication
- detect metadata gaps
- detect reference-risk operations
- produce a concrete normalization plan

Audit mode must **not** apply changes.

## 5.2 Apply mode

Use apply mode when the task explicitly authorizes execution of normalization changes.

Apply mode must:

- follow an approved or explicit plan
- execute safe renames and relocations
- add or repair metadata where required
- update registries
- mark supersession/archive explicitly
- record every meaningful action taken

---

## 6. Trigger conditions

Run this playbook when any of the following is true:

- filenames are inconsistent or arbitrary
- canonical and temporary artifacts are mixed together
- duplicate specs/plans/reports/prompts exist with unclear authority
- the docs or prompts folders have become difficult to navigate
- files are named with garbage suffixes such as `final`, `final2`, `latest`, `ok`, `fixed`
- major repository refactors are being prepared
- artifacts are being formalized for long-term maintenance
- a governance audit is requested

---

## 7. Roles and responsibilities

## 7.1 Operator

The operator executing normalization is responsible for:

- classification accuracy
- naming and placement corrections
- metadata repair
- registry updates
- reference-risk detection
- change reporting

## 7.2 Reviewer

If a reviewer exists, the reviewer is responsible for:

- validating classification decisions
- challenging ambiguous merges or supersessions
- validating high-risk renames
- confirming that traceability has been preserved

---

## 8. Artifact classes in scope

At minimum, normalization must account for these artifact classes:

### Documentation
- spec
- analysis
- plan
- adr
- audit
- runbook
- report
- research
- changelog
- note

### Prompt / AI
- prompt
- workflow
- skill
- agent-spec
- evaluation
- rubric

### Executable / operational
- script
- cli
- job
- worker

### Data / schema
- migration
- seed
- schema
- contract
- fixture
- snapshot

### Temporary / non-canonical
- draft
- scratch
- temp
- export

---

## 9. Standard normalization workflow

Normalization must follow this order.

## Step 1 — Define normalization boundary

Determine whether the scope is:

- whole repository
- docs only
- prompts only
- scripts only
- a specific subtree
- a specific product/domain slice

Do not pretend to normalize the whole repo when only a narrow subtree was inspected.

### Output

- scope statement
- included folders
- excluded folders
- assumptions

---

## Step 2 — Inventory artifacts

Create a complete inventory of all candidate artifacts in scope.

For each artifact, capture at least:

- current path
- filename
- probable artifact class
- probable status
- whether canonical or temporary
- whether metadata exists
- whether registry entry exists
- whether obvious references depend on the path

### Output

- raw inventory table

---

## Step 3 — Classify artifacts

Assign one primary artifact class to each item.

Classification must be based on actual purpose, not just extension or folder name.

### Rules

- a report is not a spec just because it lives in `docs/`
- a scratch note is not canonical just because it is markdown
- a prompt stored in docs is still a prompt artifact if its purpose is prompt execution
- a dated artifact may still be authoritative if its nature is inherently time-bound

### Output

- classified inventory
- ambiguity list

---

## Step 4 — Detect violations

For each artifact, evaluate violations across these axes:

- naming
- placement
- metadata
- versioning
- status clarity
- duplication
- overlap
- unclear authority
- reference risk
- canonical vs temporary confusion

### Common violations

- arbitrary filenames
- missing frontmatter for governed text artifacts
- duplicate artifacts with different names but same purpose
- drafts in canonical folders
- exports mixed with source-of-truth artifacts
- multiple active artifacts with overlapping scope

### Output

- violation register

---

## Step 5 — Determine action type per artifact

Each artifact must receive one primary action decision.

Allowed actions:

- keep
- rename
- move
- rename-and-move
- add-metadata
- repair-metadata
- register
- supersede
- archive
- merge
- split
- delete-noncanonical
- leave-pending

### Rules

- `delete-noncanonical` is only allowed for clearly temporary, non-referenced junk
- `merge` requires authority resolution
- `supersede` requires explicit traceability
- `leave-pending` must include a reason

### Output

- action map per artifact

---

## Step 6 — Evaluate reference impact

Before applying any rename or move, inspect likely dependency impact.

Check at minimum:

- imports and exports
- relative file references
- markdown links
- registry paths
- CI and workflow references
- script paths
- config pointers
- human discovery patterns if tooling depends on names

### Risk classes

- low: text artifact rename with no known inbound references
- medium: registry-tracked artifact with manageable link updates
- high: executable or imported artifact, migration, config-linked file, or unknown dependency surface

### Output

- reference impact register
- high-risk action list

---

## Step 7 — Produce normalization plan

Before applying changes, produce a concrete plan.

The plan must include:

- old path
- new path
- artifact class
- action
- reason
- metadata action
- registry action
- supersession/archive action
- reference impact
- execution risk

### Output

- normalization plan

---

## Step 8 — Apply safe changes

If apply mode is authorized, execute changes in a controlled order.

Recommended order:

1. create missing target folders
2. create backups/snapshots if needed
3. add or repair metadata
4. execute low-risk renames and moves
5. update registries
6. update links and path references
7. handle supersession/archive actions
8. isolate temporary artifacts
9. revisit medium/high-risk actions
10. generate final report

### Rules

- do not apply high-risk changes casually
- do not archive active canonical artifacts without replacement logic
- do not merge artifacts without preserving unique information

---

## Step 9 — Update registries

Registries must reflect the post-normalization state.

At minimum, update as applicable:

- `docs/_registry/document-registry.md`
- `prompts/_registry/prompt-registry.md`
- `scripts/_registry/script-registry.md`
- other local registries if present

Each affected entry must reflect:

- canonical path
- current status
- current version
- supersedes / superseded_by if relevant

---

## Step 10 — Produce final normalization report

The final report must document exactly what happened.

### Minimum fields per changed artifact

- old path
- new path
- artifact class
- action taken
- reason
- status change
- version change
- supersession/archive action
- reference repair action
- unresolved issue

### Final summary must include

- total artifacts inventoried
- total artifacts changed
- total renamed
- total moved
- total archived
- total superseded
- total deleted as clearly non-canonical junk
- outstanding ambiguities
- high-risk items deferred

---

## 10. Naming decision rules

Use the repository governance standard for naming.

### Stable documentation and prompt artifacts

Use:

```text
<artifact_class>.<project>.<domain>.<slug>.md
```

### Time-bound artifacts

Use:

```text
<artifact_class>.<project>.<domain>.<slug>.<yyyy-mm-dd>.md
```

### Code, tests, scripts, and migrations

Follow category-specific and stack-specific conventions.

Do not force doc-style names onto code.

---

## 11. Metadata repair rules

Governed documentation and prompt artifacts must have metadata repaired if missing or inconsistent.

Required fields are defined by the repository governance standard.

### Repair priorities

1. artifact_id
2. title
3. artifact_class
4. status
5. version
6. project/domain/slug
7. canonical_path
8. dates
9. supersession fields
10. related_artifacts

If metadata cannot be inferred safely, mark the ambiguity explicitly instead of fabricating certainty.

---

## 12. Supersession rules

Use `supersede` when one artifact clearly replaces another while preserving historical traceability.

### Use supersession when

- a new spec replaces an obsolete spec
- a normalized canonical artifact replaces an uncontrolled prior artifact
- a governance document replaces a weaker earlier one

### Do not use supersession when

- the relationship is only partial overlap
- two artifacts should instead be merged into one new artifact
- the older artifact is merely related, not replaced

---

## 13. Archive rules

Archive meaningful artifacts when they are no longer active but still historically relevant.

### Archive candidates

- superseded docs
- completed reports no longer active as control documents
- retired prompt variants with historical relevance
- deprecated but still useful reference material

### Do not archive

- active canonical artifacts
- temporary junk that should simply be removed
- artifacts whose authority has not yet been resolved

---

## 14. Delete rules

Deletion is the exception.

Deletion is only acceptable for artifacts that are clearly:

- temporary
- non-canonical
- non-referenced
- non-historical
- non-authoritative
- redundant at zero informational cost

Examples:

- scratch exports
- duplicate generated output files
- abandoned temp notes with no unique content

If there is doubt, archive or mark instead of deleting.

---

## 15. Merge and split rules

## Merge

Use merge when multiple artifacts attempt to serve the same authoritative purpose.

Conditions:

- same functional purpose
- no legitimate reason for parallel authority
- unique content can be preserved in the merge target

## Split

Use split when one artifact carries multiple distinct responsibilities.

Conditions:

- one file mixes spec + plan + audit + notes
- multiple audiences require separate control documents
- versioning/status cannot be managed coherently as one artifact

---

## 16. Ambiguity protocol

When the correct action is unclear:

1. state the ambiguity
2. list candidate interpretations
3. choose the least destructive provisional action
4. leave explicit follow-up markers

Never hide ambiguity behind false precision.

---

## 17. Suggested output structure for audit mode

When running in audit mode, produce:

1. Scope
2. Findings
3. Artifact inventory summary
4. Classification map
5. Violations
6. Duplicate/overlap analysis
7. Proposed rename/move map
8. Metadata repair plan
9. Registry update plan
10. Reference impact analysis
11. Open ambiguities
12. Recommended apply sequence

---

## 18. Suggested output structure for apply mode

When running in apply mode, produce:

1. Scope
2. Executed actions summary
3. Detailed change log
4. Registry updates
5. Supersession/archive actions
6. Reference repairs applied
7. High-risk actions deferred
8. Remaining ambiguities
9. Final repository state summary

---

## 19. Minimum normalization checklist

Use this checklist before declaring normalization complete.

- [ ] Scope explicitly defined
- [ ] Inventory completed
- [ ] All artifacts classified
- [ ] Violations identified
- [ ] Duplicate/overlap analysis completed
- [ ] Action map assigned
- [ ] Reference impact evaluated
- [ ] Metadata repaired where required
- [ ] Registries updated
- [ ] Supersession/archive actions recorded
- [ ] Temporary artifacts isolated
- [ ] Final report produced

If any of these are missing, normalization is incomplete.

---

## 20. Failure patterns to reject

Reject the following anti-patterns:

- renaming without classifying
- moving files because a folder “looks cleaner”
- deleting historical material to reduce clutter
- leaving multiple overlapping active specs unresolved
- adding frontmatter inconsistently
- normalizing docs but ignoring prompt artifacts
- updating names but not registries
- updating registries but not links
- claiming completion without a report

---

## 21. Example normalization actions

### Example A — Bad doc rename

From:

- `docs/spec-final-v2.md`

To:

- `docs/specs/spec.sportpulse.portal.tournament-selection.md`

Actions:

- classify as `spec`
- repair frontmatter
- assign `artifact_id`
- set status/version
- update document registry
- inspect inbound links

### Example B — Prompt relocation

From:

- `docs/random-prompt-for-claude.md`

To:

- `prompts/prompt.sportpulse.docs.repo-normalization-governor.md`

Actions:

- classify as `prompt`
- move to prompts folder
- add frontmatter
- register in prompt registry
- evaluate references from docs

### Example C — Temporary export isolation

From:

- `docs/match-data-export.json`

To:

- `exports/match-data-2026-03-15.json`

Actions:

- classify as `export`
- mark non-canonical
- remove from docs space
- no registry entry required unless policy says otherwise

---

## 22. Completion criteria

Normalization is complete only when:

- all in-scope artifacts have been classified
- all approved actions have been executed or explicitly deferred
- all required metadata has been repaired
- all registries have been updated
- supersession/archive has been made explicit where relevant
- temporary artifacts no longer pollute canonical space
- reference-impact actions have been handled or reported
- the final report exists

---

## 23. Recommended companion files

This playbook is most effective when used alongside:

- `docs/_governance/repository-governance.md`
- `docs/_registry/document-registry.md`
- `prompts/_registry/prompt-registry.md`
- `scripts/_registry/script-registry.md` when applicable

Without those, normalization can still happen. It just happens with weaker control.

---

## 24. Default enforcement statement

Whenever repository normalization is requested, this playbook defines the minimum acceptable execution procedure.

Any shortcut that skips inventory, classification, traceability, or reference impact analysis is not normalization.
It is damage with better formatting.
