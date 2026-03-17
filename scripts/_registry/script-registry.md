---
artifact_id: SPEC-SPORTPULSE-GOVERNANCE-SCRIPT-REGISTRY
title: "Script Registry"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: governance
slug: script-registry
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: scripts/_registry/script-registry.md
---
# Script Registry

## 1. Purpose

This registry is the canonical inventory of governed scripts in the repository.

Its purpose is to make scripts discoverable, auditable, and maintainable by recording:

- what each script does
- where it lives
- who owns it
- how it is executed
- what inputs and outputs it expects
- what risks it carries
- whether it is still active, deprecated, or superseded

Without a script registry, repositories accumulate opaque operational logic hidden behind arbitrary filenames, duplicated tooling, and undocumented side effects.

This file exists to stop that.

---

## 2. Scope

Register any non-trivial script that is part of the repository’s operational surface, including:

- maintenance scripts
- data sync scripts
- normalization scripts
- seeders
- migrations helpers
- dev tooling scripts
- reporting scripts
- one-off scripts that became semi-permanent
- automation entrypoints
- CLI utilities maintained by the project

Do **not** register trivial package manager aliases unless they wrap meaningful internal scripts.

---

## 3. Registry rules

### 3.1 What must be registered

A script should be added to this registry if any of the following is true:

- it is called manually by developers or operators
- it changes repository state, database state, or external state
- it is part of a maintenance, migration, reporting, or normalization workflow
- it is invoked by CI/CD or scheduled automation
- it is important enough that someone could ask “what is this script for?”

### 3.2 What may be omitted

The following may be omitted unless they become operationally relevant:

- trivial wrappers with no project-specific logic
- experimental scratch scripts in `tmp/` or `scratch/`
- generated scripts not meant for human maintenance

### 3.3 Non-destructive rule

Do not silently remove scripts from the registry when the underlying script is retired.

Instead:

- mark it `deprecated`, `superseded`, or `archived`
- record replacement if one exists
- preserve traceability

---

## 4. Script identity model

Each governed script should have:

- a stable `script_id`
- a clear purpose
- a canonical path
- an execution method
- an owner
- a lifecycle status

### 4.1 Recommended `script_id` format

Use:

```text
SCRIPT-<PROJECT>-<DOMAIN>-<SLUG>
```

Examples:

- `SCRIPT-SPORTPULSE-DOCS-NORMALIZE-DOC-REGISTRY`
- `SCRIPT-SPORTPULSE-DATA-SYNC-COMPETITIONS`
- `SCRIPT-SPORTPULSE-PREDICTIONS-BACKTEST-REPORT`

Rules:

- uppercase letters and hyphens only
- stable over time if the script identity remains the same
- do not regenerate IDs casually

---

## 5. Status model

Each registered script must have one lifecycle status:

- `draft`
- `active`
- `deprecated`
- `superseded`
- `archived`

### Meaning

- `draft`: not ready for trusted operational use
- `active`: current and valid
- `deprecated`: still present but should not be extended further
- `superseded`: replaced by another script or workflow
- `archived`: retained for historical reference only

---

## 6. Registry fields

Each entry should record the following fields.

| Field | Required | Description |
|---|---:|---|
| `script_id` | Yes | Stable unique identifier |
| `name` | Yes | Human-readable script name |
| `purpose` | Yes | What the script actually does |
| `status` | Yes | Lifecycle state |
| `owner` | Recommended | Team, role, or person responsible |
| `canonical_path` | Yes | Repo-relative path |
| `entrypoint` | Yes | Actual file or command entrypoint |
| `language` | Yes | Script language/runtime |
| `execution_method` | Yes | How it is invoked |
| `inputs` | Recommended | Expected inputs, args, env vars, or dependencies |
| `outputs` | Recommended | Files, DB changes, reports, API effects, etc. |
| `side_effects` | Recommended | State mutations or irreversible actions |
| `frequency` | Recommended | Manual, ad hoc, CI, scheduled, on release, etc. |
| `dependencies` | Recommended | Internal/external services or files required |
| `failure_risk` | Recommended | low / medium / high |
| `observability` | Recommended | Logs, reports, output files, exit codes |
| `supersedes` | Optional | Prior script IDs replaced |
| `superseded_by` | Optional | Replacement script IDs |
| `notes` | Optional | Important caveats |

---

## 7. Execution method vocabulary

Use consistent values where possible.

Suggested values:

- `manual-cli`
- `package-script`
- `ci-job`
- `cron`
- `scheduler`
- `migration-hook`
- `one-off-operator-run`
- `predeploy`
- `postdeploy`

---

## 8. Failure risk guidance

Use these labels consistently:

- `low`: read-only or low-impact local effects
- `medium`: modifies controlled project state with recoverable consequences
- `high`: changes production-like state, external systems, schemas, destructive data, or critical registries

If unsure, classify upward, not downward.

---

## 9. Recommended registry maintenance rules

Update this registry whenever a governed script is:

- created
- renamed
- moved
- materially repurposed
- deprecated
- superseded
- archived

If a script’s meaning changes materially, either:

- update the same entry if identity is stable, or
- create a new entry and explicitly record supersession if identity changed

---

## 10. Duplicate and sprawl control

The following are governance violations:

- multiple scripts doing the same thing under different names
- scripts with vague names such as `helper`, `misc`, `runner2`, `testscript`, `script-final`
- scripts with unclear ownership
- scripts with destructive side effects but no documented execution method
- stale scripts still present and appearing active

The registry should be used to detect and stop script sprawl.

---

## 11. Template entry

Use this template when adding a script.

```md
### SCRIPT-<PROJECT>-<DOMAIN>-<SLUG>

- **Name:** <human-readable name>
- **Purpose:** <what it does>
- **Status:** <draft|active|deprecated|superseded|archived>
- **Owner:** <team|role|person>
- **Canonical path:** `<repo-relative-path>`
- **Entrypoint:** `<file-or-command>`
- **Language:** <ts|js|python|bash|sql|go|etc>
- **Execution method:** <manual-cli|package-script|ci-job|cron|...>
- **Inputs:** <args, env vars, files, services>
- **Outputs:** <files, records, reports, state changes>
- **Side effects:** <none|describe mutations>
- **Frequency:** <manual|ad hoc|daily|per release|etc>
- **Dependencies:** <services, files, runtimes, tools>
- **Failure risk:** <low|medium|high>
- **Observability:** <logs, report path, stdout, exit code>
- **Supersedes:** <script IDs or []>
- **Superseded by:** <script IDs or []>
- **Notes:** <important caveats>
```

---

## 12. Registry entries

> SportsPulse prediction engine scripts. All scripts are TypeScript, executed via `pnpm tsx` or `pnpm run <script>`.
> All scripts read/write from `cache/` (runtime, not versioned). No network mutation to production systems.

---

### SCRIPT-SPORTPULSE-PE-RUN-BACKTEST

- **Name:** Run PE backtest
- **Purpose:** Historical backtest + H3/H4 evaluation. Processes FINISHED LaLiga (PD) matches for current season. Probabilistic diagnostic to evaluate model edge.
- **Status:** active
- **Owner:** PE team
- **Canonical path:** `scripts/run-backtest.ts`
- **Entrypoint:** `scripts/run-backtest.ts`
- **Language:** ts
- **Execution method:** manual-cli
- **Inputs:** PE engine, `cache/` historical data
- **Outputs:** `cache/v2-predictions.json`, stdout summary
- **Side effects:** writes to `cache/`
- **Frequency:** ad hoc
- **Dependencies:** `packages/prediction`, `cache/` data
- **Failure risk:** low
- **Observability:** stdout, exit code
- **Supersedes:** []
- **Superseded by:** []
- **Notes:** Baseline backtest; H-series scripts extend this.

---

### SCRIPT-SPORTPULSE-PE-RUN-BACKTEST-HISTORICAL

- **Name:** Run PE historical backtest
- **Purpose:** Extended historical backtest across multiple seasons for long-range model evaluation.
- **Status:** active
- **Owner:** PE team
- **Canonical path:** `scripts/run-backtest-historical.ts`
- **Entrypoint:** `scripts/run-backtest-historical.ts`
- **Language:** ts
- **Execution method:** manual-cli
- **Inputs:** PE engine, `cache/historical/` data
- **Outputs:** stdout summary, extended metrics
- **Side effects:** reads from `cache/historical/`
- **Frequency:** ad hoc
- **Dependencies:** `packages/prediction`, historical match data
- **Failure risk:** low
- **Observability:** stdout, exit code
- **Supersedes:** []
- **Superseded by:** []
- **Notes:** —

---

### SCRIPT-SPORTPULSE-PE-RUN-CP0-FREEZE-INTEGRITY

- **Name:** Run CP0 freeze integrity check
- **Purpose:** Verifies the PE is frozen at CP0 baseline — validates that model outputs are deterministic and unchanged since freeze declaration on 2026-03-10.
- **Status:** active
- **Owner:** PE team
- **Canonical path:** `scripts/run-cp0-freeze-integrity.ts`
- **Entrypoint:** `scripts/run-cp0-freeze-integrity.ts`
- **Language:** ts
- **Execution method:** manual-cli
- **Inputs:** frozen calibration artifacts, PE engine
- **Outputs:** PASS/FAIL result, stdout
- **Side effects:** none (read-only)
- **Frequency:** ad hoc
- **Dependencies:** `packages/prediction`, `cache/calibration/`
- **Failure risk:** low
- **Observability:** stdout PASS/FAIL, exit code
- **Supersedes:** []
- **Superseded by:** []
- **Notes:** Run before any PE version bump to confirm freeze state.

---

### SCRIPT-SPORTPULSE-PE-RUN-FORWARD-VALIDATION-CHECKPOINT

- **Name:** Run forward validation checkpoint
- **Purpose:** Evaluates the PE against new real-world match outcomes (CP1, CP2 checkpoints) to track predictive performance over time.
- **Status:** active
- **Owner:** PE team
- **Canonical path:** `scripts/run-forward-validation-checkpoint.ts`
- **Entrypoint:** `scripts/run-forward-validation-checkpoint.ts`
- **Language:** ts
- **Execution method:** manual-cli
- **Inputs:** PE snapshot, post-kickoff match results
- **Outputs:** checkpoint report, stdout
- **Side effects:** none (read-only)
- **Frequency:** per-checkpoint (CP0 → CP1 ≥10 games → CP2 ≥30 games)
- **Dependencies:** `packages/prediction`, forward validation data
- **Failure risk:** low
- **Observability:** stdout, CP results
- **Supersedes:** []
- **Superseded by:** []
- **Notes:** See `memory/pe-cti-forward-validation.md` for checkpoint rules.

---

### SCRIPT-SPORTPULSE-PE-RESET-FORWARD-VALIDATION

- **Name:** Reset forward validation state
- **Purpose:** Clears forward validation accumulated state to restart the evaluation window. Use with care — irreversible reset of collected data.
- **Status:** active
- **Owner:** PE team
- **Canonical path:** `scripts/reset-forward-validation.ts`
- **Entrypoint:** `scripts/reset-forward-validation.ts`
- **Language:** ts
- **Execution method:** manual-cli
- **Inputs:** forward validation store
- **Outputs:** cleared validation state
- **Side effects:** **destructive** — deletes accumulated forward validation data
- **Frequency:** exceptional (only when restarting evaluation from scratch)
- **Dependencies:** `packages/prediction`
- **Failure risk:** high
- **Observability:** stdout confirmation, exit code
- **Supersedes:** []
- **Superseded by:** []
- **Notes:** High risk. Confirm intent before running.

---

### SCRIPT-SPORTPULSE-PE-TRAIN-GLOBAL-CALIBRATOR

- **Name:** Train global isotonic calibrator
- **Purpose:** Reads all `v2-segmented-*.json` backtest files from `cache/`, extracts ELIGIBLE predictions, fits a global post-hoc isotonic calibrator, and writes calibration artifact to `cache/calibration/`.
- **Status:** active
- **Owner:** PE team
- **Canonical path:** `scripts/train-global-calibrator.ts`
- **Entrypoint:** `scripts/train-global-calibrator.ts`
- **Language:** ts
- **Execution method:** manual-cli
- **Inputs:** `cache/v2-segmented-*.json`
- **Outputs:** `cache/calibration/global-isotonic-v1.json`
- **Side effects:** writes calibration artifact
- **Frequency:** ad hoc (after backtest accumulation)
- **Dependencies:** `packages/prediction`, `cache/` backtest outputs
- **Failure risk:** medium
- **Observability:** stdout, calibration artifact path
- **Supersedes:** []
- **Superseded by:** []
- **Notes:** Must be re-run if backtest data changes materially.

---

### SCRIPT-SPORTPULSE-PE-VALIDATE-V2-SEGMENTED

- **Name:** Validate V2 segmented
- **Purpose:** V2 segmented evaluation — runs PE against partitioned dataset segments and computes accuracy metrics per segment.
- **Status:** active
- **Owner:** PE team
- **Canonical path:** `scripts/validate-v2-segmented.ts`
- **Entrypoint:** `scripts/validate-v2-segmented.ts`
- **Language:** ts
- **Execution method:** manual-cli
- **Inputs:** PE engine, match dataset
- **Outputs:** `cache/v2-segmented-*.json`, stdout
- **Side effects:** writes to `cache/`
- **Frequency:** ad hoc
- **Dependencies:** `packages/prediction`
- **Failure risk:** low
- **Observability:** stdout, output file
- **Supersedes:** []
- **Superseded by:** []
- **Notes:** Used as input for `train-global-calibrator.ts`.

---

### SCRIPT-SPORTPULSE-PE-VALIDATE-V2-WALKFORWARD

- **Name:** Validate V2 walk-forward
- **Purpose:** Walk-forward validation — simulates online prediction by rolling through historical data chronologically to estimate real-world accuracy.
- **Status:** active
- **Owner:** PE team
- **Canonical path:** `scripts/validate-v2-walkforward.ts`
- **Entrypoint:** `scripts/validate-v2-walkforward.ts`
- **Language:** ts
- **Execution method:** manual-cli
- **Inputs:** PE engine, historical match data
- **Outputs:** stdout walk-forward report
- **Side effects:** none
- **Frequency:** ad hoc
- **Dependencies:** `packages/prediction`
- **Failure risk:** low
- **Observability:** stdout
- **Supersedes:** []
- **Superseded by:** []
- **Notes:** —

---

### SCRIPT-SPORTPULSE-PE-RUN-TRACK-A-OBSERVATION

- **Name:** Run Track A observation
- **Purpose:** Entry point for automated Track A runtime observation. Orchestrates observation collector + evaluator. Used as `pnpm track-a` cron every 10 minutes.
- **Status:** active
- **Owner:** PE team
- **Canonical path:** `scripts/run-track-a-observation.ts`
- **Entrypoint:** `scripts/run-track-a-observation.ts`
- **Language:** ts
- **Execution method:** cron
- **Inputs:** live backend snapshot (localhost:3000)
- **Outputs:** appends to Track A observation store
- **Side effects:** writes to observation log
- **Frequency:** every 10 minutes (cron)
- **Dependencies:** running dev server on port 3000
- **Failure risk:** low
- **Observability:** stdout, observation log file
- **Supersedes:** []
- **Superseded by:** []
- **Notes:** Must run while dev server is active. See `memory/track-a-automation.md`.

---

### SCRIPT-SPORTPULSE-PE-TRACK-A-OBSERVATION-COLLECTOR

- **Name:** Track A observation collector
- **Purpose:** Collects raw Track A backend observation events (prediction snapshots, confidence data) from the running backend.
- **Status:** active
- **Owner:** PE team
- **Canonical path:** `scripts/track-a-observation-collector.ts`
- **Entrypoint:** `scripts/track-a-observation-collector.ts`
- **Language:** ts
- **Execution method:** manual-cli
- **Inputs:** backend REST API
- **Outputs:** raw observation data
- **Side effects:** none
- **Frequency:** called by `run-track-a-observation.ts`
- **Dependencies:** running server port 3000
- **Failure risk:** low
- **Observability:** stdout
- **Supersedes:** []
- **Superseded by:** []
- **Notes:** Used by orchestrator, not standalone.

---

### SCRIPT-SPORTPULSE-PE-TRACK-A-EVALUATOR

- **Name:** Track A evaluator
- **Purpose:** Evaluates collected Track A observations against actual match outcomes to compute PE runtime accuracy metrics.
- **Status:** active
- **Owner:** PE team
- **Canonical path:** `scripts/track-a-evaluator.ts`
- **Entrypoint:** `scripts/track-a-evaluator.ts`
- **Language:** ts
- **Execution method:** manual-cli
- **Inputs:** Track A observation store
- **Outputs:** stdout evaluation report
- **Side effects:** none
- **Frequency:** ad hoc (post-observation evaluation)
- **Dependencies:** `packages/prediction`, observation store
- **Failure risk:** low
- **Observability:** stdout
- **Supersedes:** []
- **Superseded by:** []
- **Notes:** —

---

### SCRIPT-SPORTPULSE-PE-RUN-H6A-SENSITIVITY

- **Name:** H6a sensitivity analysis
- **Purpose:** Hypothesis H6a — PE sensitivity analysis on Elo weight parameters.
- **Status:** active
- **Owner:** PE team
- **Canonical path:** `scripts/run-h6a-sensitivity.ts`
- **Entrypoint:** `scripts/run-h6a-sensitivity.ts`
- **Language:** ts
- **Execution method:** manual-cli
- **Inputs:** PE engine, parameter grid
- **Outputs:** stdout sensitivity report
- **Side effects:** none
- **Frequency:** ad hoc
- **Dependencies:** `packages/prediction`
- **Failure risk:** low
- **Observability:** stdout
- **Supersedes:** []
- **Superseded by:** []
- **Notes:** Part of PE hypothesis testing series (H6-H11).

---

### SCRIPT-SPORTPULSE-PE-RUN-H6B-DRAW-DIAGNOSIS

- **Name:** H6b draw diagnosis
- **Purpose:** Hypothesis H6b — diagnoses draw prediction deficiency in the PE.
- **Status:** active
- **Owner:** PE team
- **Canonical path:** `scripts/run-h6b-draw-diagnosis.ts`
- **Entrypoint:** `scripts/run-h6b-draw-diagnosis.ts`
- **Language:** ts
- **Execution method:** manual-cli
- **Inputs:** PE engine, match dataset
- **Outputs:** stdout draw diagnosis report
- **Side effects:** none
- **Frequency:** ad hoc
- **Dependencies:** `packages/prediction`
- **Failure risk:** low
- **Observability:** stdout
- **Supersedes:** []
- **Superseded by:** []
- **Notes:** —

---

### SCRIPT-SPORTPULSE-PE-RUN-H6C-CALIBRATION-EXPERIMENT

- **Name:** H6c calibration experiment
- **Purpose:** Hypothesis H6c — calibration experiment comparing isotonic vs. Platt scaling approaches.
- **Status:** active
- **Owner:** PE team
- **Canonical path:** `scripts/run-h6c-calibration-experiment.ts`
- **Entrypoint:** `scripts/run-h6c-calibration-experiment.ts`
- **Language:** ts
- **Execution method:** manual-cli
- **Inputs:** PE engine, backtest predictions
- **Outputs:** stdout calibration comparison
- **Side effects:** none
- **Frequency:** ad hoc
- **Dependencies:** `packages/prediction`
- **Failure risk:** low
- **Observability:** stdout
- **Supersedes:** []
- **Superseded by:** []
- **Notes:** —

---

### SCRIPT-SPORTPULSE-PE-RUN-H6C2-CALIBRATION-COMPARISON

- **Name:** H6c2 calibration comparison
- **Purpose:** Hypothesis H6c2 — extended calibration comparison across multiple approaches.
- **Status:** active
- **Owner:** PE team
- **Canonical path:** `scripts/run-h6c2-calibration-comparison.ts`
- **Entrypoint:** `scripts/run-h6c2-calibration-comparison.ts`
- **Language:** ts
- **Execution method:** manual-cli
- **Inputs:** PE engine, backtest predictions
- **Outputs:** stdout comparison table
- **Side effects:** none
- **Frequency:** ad hoc
- **Dependencies:** `packages/prediction`
- **Failure risk:** low
- **Observability:** stdout
- **Supersedes:** [SCRIPT-SPORTPULSE-PE-RUN-H6C-CALIBRATION-EXPERIMENT]
- **Superseded by:** []
- **Notes:** —

---

### SCRIPT-SPORTPULSE-PE-RUN-H8-STRUCTURAL-EXPERIMENTS

- **Name:** H8 structural experiments
- **Purpose:** Hypothesis H8 — structural experiments testing Elo/lambda computation variants.
- **Status:** active
- **Owner:** PE team
- **Canonical path:** `scripts/run-h8-structural-experiments.ts`
- **Entrypoint:** `scripts/run-h8-structural-experiments.ts`
- **Language:** ts
- **Execution method:** manual-cli
- **Inputs:** PE engine
- **Outputs:** stdout experiment results
- **Side effects:** none
- **Frequency:** ad hoc
- **Dependencies:** `packages/prediction`
- **Failure risk:** low
- **Observability:** stdout
- **Supersedes:** []
- **Superseded by:** []
- **Notes:** —

---

### SCRIPT-SPORTPULSE-PE-RUN-H8B-CTI-SWEEP

- **Name:** H8b CTI sweep
- **Purpose:** Hypothesis H8b — sweeps CTI (Cumulative Thresholded Index) α parameter space to find optimal freeze threshold.
- **Status:** active
- **Owner:** PE team
- **Canonical path:** `scripts/run-h8b-cti-sweep.ts`
- **Entrypoint:** `scripts/run-h8b-cti-sweep.ts`
- **Language:** ts
- **Execution method:** manual-cli
- **Inputs:** PE engine, backtest dataset
- **Outputs:** CTI sweep table, stdout
- **Side effects:** none
- **Frequency:** ad hoc
- **Dependencies:** `packages/prediction`
- **Failure risk:** low
- **Observability:** stdout
- **Supersedes:** []
- **Superseded by:** []
- **Notes:** α=0.4 frozen based on this sweep.

---

### SCRIPT-SPORTPULSE-PE-RUN-H9-CTI-CROSS-VALIDATION

- **Name:** H9 CTI cross-validation
- **Purpose:** Hypothesis H9 — cross-validates frozen CTI (α=0.4) across multiple data splits.
- **Status:** active
- **Owner:** PE team
- **Canonical path:** `scripts/run-h9-cti-cross-validation.ts`
- **Entrypoint:** `scripts/run-h9-cti-cross-validation.ts`
- **Language:** ts
- **Execution method:** manual-cli
- **Inputs:** PE engine, dataset splits
- **Outputs:** cross-validation report, stdout
- **Side effects:** none
- **Frequency:** ad hoc
- **Dependencies:** `packages/prediction`
- **Failure risk:** low
- **Observability:** stdout
- **Supersedes:** []
- **Superseded by:** []
- **Notes:** —

---

### SCRIPT-SPORTPULSE-PE-RUN-H10-MULTI-LEAGUE-ROBUSTNESS

- **Name:** H10 multi-league robustness
- **Purpose:** Hypothesis H10 — tests PE robustness across all supported leagues (PD, PL, BL1, URU).
- **Status:** active
- **Owner:** PE team
- **Canonical path:** `scripts/run-h10-multi-league-robustness.ts`
- **Entrypoint:** `scripts/run-h10-multi-league-robustness.ts`
- **Language:** ts
- **Execution method:** manual-cli
- **Inputs:** PE engine, multi-league dataset
- **Outputs:** robustness report per league, stdout
- **Side effects:** none
- **Frequency:** ad hoc
- **Dependencies:** `packages/prediction`
- **Failure risk:** low
- **Observability:** stdout
- **Supersedes:** []
- **Superseded by:** []
- **Notes:** —

---

### SCRIPT-SPORTPULSE-PE-RUN-H10B-MULTI-LEAGUE-WITH-SA

- **Name:** H10b multi-league with sensitivity analysis
- **Purpose:** Hypothesis H10b — multi-league robustness extended with sensitivity analysis.
- **Status:** active
- **Owner:** PE team
- **Canonical path:** `scripts/run-h10b-multi-league-with-sa.ts`
- **Entrypoint:** `scripts/run-h10b-multi-league-with-sa.ts`
- **Language:** ts
- **Execution method:** manual-cli
- **Inputs:** PE engine, multi-league dataset, SA config
- **Outputs:** robustness + SA report, stdout
- **Side effects:** none
- **Frequency:** ad hoc
- **Dependencies:** `packages/prediction`
- **Failure risk:** low
- **Observability:** stdout
- **Supersedes:** [SCRIPT-SPORTPULSE-PE-RUN-H10-MULTI-LEAGUE-ROBUSTNESS]
- **Superseded by:** []
- **Notes:** —

---

### SCRIPT-SPORTPULSE-PE-RUN-H11B-GUARD-RAIL-DIAGNOSIS

- **Name:** H11b guard rail diagnosis
- **Purpose:** Hypothesis H11b — diagnoses PE guard rail behavior (eligibility degradation, NOT_ELIGIBLE edge cases).
- **Status:** active
- **Owner:** PE team
- **Canonical path:** `scripts/run-h11b-guard-rail-diagnosis.ts`
- **Entrypoint:** `scripts/run-h11b-guard-rail-diagnosis.ts`
- **Language:** ts
- **Execution method:** manual-cli
- **Inputs:** PE engine, edge case dataset
- **Outputs:** guard rail diagnosis report, stdout
- **Side effects:** none
- **Frequency:** ad hoc
- **Dependencies:** `packages/prediction`
- **Failure risk:** low
- **Observability:** stdout
- **Supersedes:** []
- **Superseded by:** []
- **Notes:** —

---

### SCRIPT-SPORTPULSE-PE-RUN-PPL-ROBUSTNESS

- **Name:** Run PPL robustness
- **Purpose:** PPL (Predictive Pipeline) robustness test — validates end-to-end PE prediction pipeline against stress inputs.
- **Status:** active
- **Owner:** PE team
- **Canonical path:** `scripts/run-ppl-robustness.ts`
- **Entrypoint:** `scripts/run-ppl-robustness.ts`
- **Language:** ts
- **Execution method:** manual-cli
- **Inputs:** PE pipeline, stress test data
- **Outputs:** robustness verdict, stdout
- **Side effects:** none
- **Frequency:** ad hoc
- **Dependencies:** `packages/prediction`
- **Failure risk:** low
- **Observability:** stdout, exit code
- **Supersedes:** []
- **Superseded by:** []
- **Notes:** —

---

### SCRIPT-SPORTPULSE-GOVERNANCE-VALIDATE-DOC-REGISTRY

- **Purpose:** Validates consistency between `docs/_registry/document-registry.md` and governed artifacts on disk. Detects: registry paths that don't exist, governed docs without registry entry, version mismatches, status mismatches. Exits with code 1 if errors found (suitable for CI).
- **Owner:** Platform / Governance
- **Canonical path:** `scripts/validate-doc-registry.ts`
- **Entrypoint:** `scripts/validate-doc-registry.ts`
- **Execution:** `pnpm tsx scripts/validate-doc-registry.ts` / `pnpm tsx scripts/validate-doc-registry.ts --fix-hints`
- **Inputs:** `docs/_registry/document-registry.md`, all `.md` files in `docs/` with YAML frontmatter
- **Outputs:** stdout report (errors/warnings); exit 1 on errors
- **Frequency:** On demand; recommended after any artifact creation, rename, or reorganization
- **Observability:** stdout, exit code
- **Supersedes:** []
- **Superseded by:** []
- **Notes:** Excludes `docs/archive/`, `docs/_governance/`, `docs/_registry/` from unregistered-doc check. Handles both 5-column and 6-column registry table formats.

---

## 13. Review checklist

Before considering this registry trustworthy, verify:

- every meaningful script is listed
- no active script has an unclear purpose
- destructive scripts are marked with realistic failure risk
- deprecated scripts are not presented as active
- canonical paths match real paths
- supersession is explicit where overlapping scripts exist
- the registry is updated when scripts change

---

## 14. Default enforcement rule

From this point forward, any script that becomes part of the project’s operational surface should be added to this registry and governed explicitly.

If a script matters operationally, it should not remain invisible.
