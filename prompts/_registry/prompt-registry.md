---
artifact_id: SPEC-SPORTPULSE-GOVERNANCE-PROMPT-REGISTRY
title: "Prompt Registry"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: governance
slug: prompt-registry
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: prompts/_registry/prompt-registry.md
---
# Prompt Registry

## 1. Purpose

This registry is the authoritative index of governed prompt artifacts in the repository.

Its purpose is to prevent prompt sprawl, duplicate prompt intent, unclear authority, silent supersession, and naming drift.

This file tracks which prompt artifacts are canonical, which are deprecated or superseded, where they live, and what role they serve.

This is not an optional convenience list. It is the control surface for prompt governance.

---

## 2. Scope

This registry applies to governed prompt and AI instruction artifacts, including but not limited to:

- `prompt`
- `workflow`
- `skill`
- `agent-spec`
- `evaluation`
- `rubric`

It does not track arbitrary scratch prompts unless those prompts are intentionally promoted to governed repository artifacts.

---

## 3. Registry rules

Every governed prompt artifact must have exactly one registry entry.

Each entry must identify:

- stable artifact identity
- canonical path
- artifact class
- current status
- version
- owner
- purpose
- supersession state
- related artifacts where relevant

### Mandatory rules

- no governed prompt artifact may remain unregistered
- no two active entries may describe the same canonical prompt purpose without explicit differentiation
- if a prompt is replaced, supersession must be recorded explicitly
- if a prompt is archived, the registry must reflect that state
- the registry must be updated whenever a governed prompt artifact is created, renamed, superseded, deprecated, archived, or materially rewritten

---

## 4. Artifact classes covered

Use one of the following primary classes:

- `prompt`
- `workflow`
- `skill`
- `agent-spec`
- `evaluation`
- `rubric`

If classification is ambiguous, classify by dominant operational purpose.

---

## 5. Status values

Use one of the following statuses:

- `draft`
- `active`
- `superseded`
- `deprecated`
- `archived`

### Meaning

- `draft`: exists but is not yet authoritative
- `active`: current and authoritative for its role
- `superseded`: replaced by another governed artifact
- `deprecated`: still usable for reference or transition, but should not be extended
- `archived`: retained for history only

---

## 6. Versioning policy

Governed prompt artifacts should use semantic versioning in metadata.

- `PATCH`: wording cleanup, formatting, examples, non-semantic fixes
- `MINOR`: additive clarifications, extended instructions, non-breaking structural improvements
- `MAJOR`: changed operational meaning, changed contract, changed intended authority, incompatible rewrite

The registry must reflect the current version of the governed artifact.

---

## 7. Canonical path policy

Each prompt artifact must have one canonical repository path.

Preferred examples:

- `prompts/prompt.<project>.<domain>.<slug>.md`
- `prompts/workflow.<project>.<domain>.<slug>.md`
- `prompts/skill.<project>.<domain>.<slug>.md`
- `prompts/evaluation.<project>.<domain>.<slug>.md`

If the repository already uses a different but explicit prompt structure, preserve that structure and record the actual canonical path.

---

## 8. Registry fields

Each row must include at least:

- `artifact_id`
- `title`
- `artifact_class`
- `status`
- `version`
- `owner`
- `canonical_path`
- `purpose`
- `supersedes`
- `superseded_by`
- `related_artifacts`
- `last_updated`

Optional but recommended:

- `project`
- `domain`
- `notes`

---

## 9. Maintenance rules

Update this registry whenever any of the following happens:

- a new governed prompt artifact is created
- a prompt is renamed
- a prompt is moved
- a prompt changes status
- a prompt is superseded
- a prompt is archived
- a prompt changes version materially
- a duplicate prompt is merged or retired

Failure to update the registry is governance drift.

---

## 10. Duplicate and overlap control

Treat the following as violations:

- two active prompts with the same purpose and no explicit distinction
- renamed prompts that leave stale entries behind
- unregistered prompt artifacts in canonical prompt folders
- multiple variants with unclear authority
- scratch prompts pretending to be canonical assets

Prompt sprawl is not iteration. It is loss of control.

---

## 11. Supersession rules

If one prompt artifact replaces another:

- the old entry must move to `superseded` or `archived`
- the replacement must be listed in `superseded_by`
- the new artifact should list the older one in `supersedes`
- both sides of the relationship should be traceable

No silent replacement is allowed.

---

## 12. Recommended operating rhythm

At minimum, review this registry when:

- introducing a new reusable prompt
- promoting an ad hoc prompt into a governed artifact
- cleaning prompt folders
- conducting repo normalization
- changing project-wide assistant behavior through governed prompt assets

---

## 13. Registry table

| artifact_id | title | artifact_class | status | version | owner | canonical_path | purpose | supersedes | superseded_by | related_artifacts | last_updated | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AGENT-SPEC-SPORTPULSE-PLATFORM-ARCHITECT | Architect | agent-spec | active | 1.0.0 | Platform | .claude/agents/architect.md | Architectural decisions, SDD Stage 0-2 design, spec conflict resolution, trade-off analysis, complex debugging requiring multi-layer reasoning. Model: Opus. | [] | [] | [SPEC-SPORTPULSE-CORE-CONSTITUTION, SPEC-SPORTPULSE-CORE-AI-SDD-OPERATING-PROTOCOL] | 2026-03-15 | Governance agent. Does NOT write implementation code. |
| AGENT-SPEC-SPORTPULSE-PLATFORM-BACKEND-ENGINEER | Backend Engineer | agent-spec | active | 1.0.0 | Platform | .claude/agents/backend-engineer.md | Implementing and modifying backend packages: canonical ingestion, signals, scoring policy, layout algorithm, snapshot pipeline, API routes. Model: Sonnet. | [] | [] | [SPEC-SPORTPULSE-CORE-REPO-STRUCTURE-AND-MODULE-BOUNDARIES] | 2026-03-15 | Covers packages/canonical, signals, scoring, layout, snapshot, api. |
| AGENT-SPEC-SPORTPULSE-PLATFORM-FRONTEND-ENGINEER | Frontend Engineer | agent-spec | active | 1.0.0 | Platform | .claude/agents/frontend-engineer.md | Implementing and modifying React components, hooks, styles, and anything in packages/web/src. UI bugs, new UI features, frontend types, tests and builds. Model: Sonnet. | [] | [] | [SPEC-SPORTPULSE-CORE-REPO-STRUCTURE-AND-MODULE-BOUNDARIES] | 2026-03-15 | Exclusive scope: packages/web/. |
| AGENT-SPEC-SPORTPULSE-PLATFORM-GIT-OPS | Git Ops | agent-spec | active | 1.0.0 | Platform | .claude/agents/git-ops.md | Git commits, updating CLAUDE.md/MEMORY.md/README.md, editing package.json, adding/removing deps, CI YAML, prettier/eslint configs, 100%-explicit-instruction tasks. Model: Haiku. | [] | [] | [] | 2026-03-15 | Zero-ambiguity tasks only. |
| AGENT-SPEC-SPORTPULSE-PE-ORCHESTRATOR | Predictive Engine Orchestrator | agent-spec | active | 1.0.0 | PE | .claude/agents/predictive-engine-orchestrator.md | Full PE implementation orchestration, multi-phase coordination across domain contracts/engines/calibration/validation/QA/auditing, cross-cutting architectural decisions within PE. Model: Sonnet. | [] | [] | [SPEC-SPORTPULSE-PREDICTION-ENGINE, SPEC-SPORTPULSE-CORE-SUBAGENTS-DEFINITION] | 2026-03-15 | Primary PE coordinator. Delegates to specialized PE sub-agents. |
| AGENT-SPEC-SPORTPULSE-PE-DOMAIN-CONTRACTS | Domain Contracts Agent | agent-spec | active | 1.0.0 | PE | .claude/agents/domain-contracts-agent.md | TypeScript types, enums, DTOs, schemas, and public/internal contracts for the PE (MatchInput, CompetitionProfile, PredictionResponse, KnockoutResolutionRules). Spec §7,8,11,12,13,20,21. Model: Sonnet. | [] | [] | [SPEC-SPORTPULSE-PREDICTION-ENGINE] | 2026-03-15 | Scope: packages/prediction/src/contracts/. |
| AGENT-SPEC-SPORTPULSE-PE-MATCH-PREDICTION-ENGINE | Match Prediction Engine Agent | agent-spec | active | 1.0.0 | PE | .claude/agents/match-prediction-engine.md | Elo ratings, lambda computation, raw match distributions, scoreline matrices, 1x2 probabilities, expected goals, explainability outputs. PE regulation-time prediction layer. Model: Sonnet. | [] | [] | [SPEC-SPORTPULSE-PREDICTION-ENGINE] | 2026-03-15 | Scope: src/engine/elo-rating, lambda-computer, derived-raw, scoreline-matrix, raw-aggregator. |
| AGENT-SPEC-SPORTPULSE-PE-CALIBRATION-DECISION-POLICY | Calibration & Decision Policy Agent | agent-spec | active | 1.0.0 | PE | .claude/agents/calibration-decision-policy.md | Isotonic calibration (one-vs-rest) for 1X2 probs, decision policy module (predicted_result, conflict detection, favorite_margin), reconstruction tests, coverage/accuracy metrics. Spec §15.1,16.2,16.3,16.12,16.13,17,19.3,19.4,19.5,23,24. Model: Sonnet. | [] | [] | [SPEC-SPORTPULSE-PREDICTION-ENGINE] | 2026-03-15 | Scope: src/calibration/, src/engine/derived-calibrated, src/engine/decision-policy, src/metrics/. |
| AGENT-SPEC-SPORTPULSE-PE-VALIDATION-OPERATING-MODES | Validation & Operating Modes Agent | agent-spec | active | 1.0.0 | PE | .claude/agents/validation-operating-modes.md | Validation layer, eligibility logic, operating modes (FULL_MODE/LIMITED_MODE/NOT_ELIGIBLE), applicability levels, reasons catalog, data_integrity_flags, prior_rating operability, bridging, anti-leakage. Spec §3.3,3.6,7,10.4,11,12,13,19.6,20.1,20.2,25.1,25.3,25.5. Model: Sonnet. | [] | [] | [SPEC-SPORTPULSE-PREDICTION-ENGINE] | 2026-03-15 | Scope: packages/prediction/src/validation/. |
| AGENT-SPEC-SPORTPULSE-PE-COMPETITION-ENGINE | Competition Engine Agent | agent-spec | active | 1.0.0 | PE | .claude/agents/competition-engine.md | Competition structure resolution: standings computation, group ranking, qualification rules, best-third ranking, bracket mapping, seeding, knockout resolution (single/two-leg), aggregate state, phase transitions. NOT for match prediction. Model: Sonnet. | [] | [] | [SPEC-SPORTPULSE-PREDICTION-ENGINE] | 2026-03-15 | Scope: packages/prediction/src/competition/. |
| AGENT-SPEC-SPORTPULSE-PE-QA | Predictive Engine QA Agent | agent-spec | active | 1.0.0 | PE | .claude/agents/predictive-engine-qa.md | PE implementation conformance validation: probability computation, calibration, DNB/BTTS/totals invariants, operating modes, competition formats. Triggered after any PE pipeline change or spec §19,23,24,25,26 update. Model: Sonnet. | [] | [] | [SPEC-SPORTPULSE-PREDICTION-ENGINE] | 2026-03-15 | Scope: packages/prediction/test/. Suite: 34 files / 889 tests. |
| AGENT-SPEC-SPORTPULSE-PE-AUDITOR | Predictive Engine Auditor | agent-spec | active | 1.0.0 | PE | .claude/agents/predictive-engine-auditor.md | Formal compliance audits of PE implementation against frozen spec. Does NOT write code. Produces audit artifacts in docs/audits/. Used as pre-merge/pre-deploy gate check. Model: Sonnet. | [] | [] | [SPEC-SPORTPULSE-PREDICTION-ENGINE] | 2026-03-15 | Audit artifacts mandatory: docs/audits/PE-audit-YYYY-MM-DD.md. |

---

## 14. Entry template

Use this template when adding a new governed prompt artifact:

```md
| <ARTIFACT_ID> | <TITLE> | <CLASS> | <STATUS> | <VERSION> | <OWNER> | <CANONICAL_PATH> | <PURPOSE> | <SUPERSEDES> | <SUPERSEDED_BY> | <RELATED_ARTIFACTS> | <YYYY-MM-DD> | <NOTES> |
```

Example:

```md
| PROMPT-SPORTPULSE-DOCS-REPO-NORMALIZATION-GOVERNOR | Repo Normalization Governor | prompt | active | 1.0.0 | Platform | prompts/prompt.sportpulse.docs.repo-normalization-governor.md | Governs repo-wide naming, placement, metadata, and normalization behavior for repository artifacts. | [] | [] | [SPEC-SPORTPULSE-DOCS-REPOSITORY-GOVERNANCE, PLAN-SPORTPULSE-DOCS-REPO-NORMALIZATION] | 2026-03-15 | Canonical prompt for normalization tasks. |
```

---

## 15. Review checklist

Before considering this registry current, verify:

- every governed prompt artifact has exactly one row
- no active duplicates exist without explicit differentiation
- supersession chains are explicit
- canonical paths match reality
- statuses are current
- versions match artifact metadata
- archived or deprecated prompts are still traceable

---

## 16. Default enforcement rule

From this point forward, any governed prompt artifact created or materially updated in the repository should be entered or updated in this registry.

Without that, prompt governance is fiction.
