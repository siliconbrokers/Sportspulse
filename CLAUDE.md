# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Methodology: Spec-Driven Development (SDD)

This project is governed entirely by **SDD (Spec-Driven Development)**. The specs are the source of truth. Code implements specs — never the reverse. Every document, architectural decision, implementation task, and test exists under this framework.

### Core SDD Principle

**No code exists without a spec that authorizes it.** If a spec doesn't cover something, the answer is to update the spec first — not to "just write the code."

### Document Hierarchy (Precedence Order)

When information conflicts, the higher-numbered document loses:

1. `SportPulse_Constitution_v2.0_Master.md` — supreme governance, principles, boundaries
2. `Domain_Glossary_and_Invariants_v1.0.md` — canonical terminology, semantic backbone
3. `MVP_Execution_Scope_v1.0.md` — what to build / not build
4. `Non_Functional_Requirements_v1.0.md` — quality baseline
5. `Repo_Structure_and_Module_Boundaries_v1.0.md` — architecture and dependency rules
6. `Errors_and_Warnings_Taxonomy_v1.0.md` — error/warning codes and semantics
7. `Acceptance_Test_Matrix_v1.0.md` + `Golden_Snapshot_Fixtures_v1.0.md` — truth locks
8. Core technical specs: signals, metrics, scoring-policy, snapshot-engine, dashboard-snapshot-dto, api-contract, treemap-algorithm, layout-stability, frontend-architecture, ui-spec
9. Supporting docs: component-map, interaction-spec, backend-architecture, data-normalization, event-lifecycle, data-quality, feature-evolution, product-loop
10. `AI_SDD_Operating_Protocol_v1.0.md` — governs how AI participates in development
11. `Implementation_Backlog_SDD_v1.0.md` — ticket graph with phases, dependencies, and acceptance mapping

Strategic briefs (MVP Strategic Brief, One Pager) are non-binding for implementation details. Archive docs are non-authoritative.

### Constitutional Reading Order

Before working on the project, follow this order (Constitution §23):

1. Constitution → 2. Component map → 3. Backend architecture → 4. Data normalization → 5. Event lifecycle → 6. Data quality → 7. Signals spec → 8. Metrics spec → 9. Scoring policy → 10. Snapshot engine → 11. Snapshot DTO → 12. Frontend architecture → 13. API contract → 14. Treemap algorithm → 15. Layout stability → 16. UI spec → 17. Interaction spec → 18. Feature evolution / product loop

### SDD Mandatory Workflow (per task)

Every task — without exception — must follow these stages in order:

- **Stage 0 — Intake:** Classify the task (spec change / implementation / test / refactor / bug fix)
- **Stage 1 — Spec alignment:** Identify governing specs, list relevant invariants, list affected versions (policy/layout/schema)
- **Stage 2 — Design proposal:** Proposed approach, module placement per repo boundaries, expected outputs, acceptance checks (mapped to matrix IDs), fixture impact analysis. **No code before this stage is approved.**
- **Stage 3 — Implementation:** Write code only after Stage 2 is complete and approved
- **Stage 4 — Verification:** Run tests per acceptance matrix, verify determinism, ensure no forbidden dependencies
- **Stage 5 — Delivery package:** Files changed, behavior summary, tests added/updated, version changes, fixture impact

### SDD Required Output Format

Every deliverable must include all 10 items: (1) scope statement, (2) authoritative spec references, (3) assumptions, (4) implementation plan, (5) files to create/modify, (6) tests mapped to acceptance matrix IDs, (7) versioning impact analysis, (8) golden fixture impact analysis, (9) top 3 risks, (10) definition of done.

### SDD Conflict Resolution

When specs conflict: (1) identify the conflict explicitly with quotes, (2) determine precedence per hierarchy, (3) propose correction to lower-precedence doc or versioned change request. **Never silently pick an interpretation and continue.**

### SDD Handling Ambiguity

When information is missing: (1) state what is missing, (2) propose the minimal safe assumption, (3) state the risk, (4) proceed only if assumption does not alter core semantic truth, (5) otherwise stop and request resolution. **Never fill unknowns with confident-sounding invention.**

### SDD Delivery Checklist

Every delivery must satisfy:
- scope matches MVP execution scope
- terms align with domain glossary/invariants
- non-functional baseline respected
- module boundaries respected
- warnings/errors taxonomy respected
- acceptance tests mapped and passing
- golden fixtures passing or intentionally updated with version discipline
- version bumps applied where required
- no legacy constructs reintroduced
- documentation updated if behavior changed

### SDD Constraints on AI

- Must NOT broaden scope beyond MVP execution scope without approval
- Must NOT reinterpret domain terms contrary to glossary
- Must NOT move scoring/layout truth to frontend
- Must NOT change policy/layout/schema semantics without versioning
- Must NOT update golden fixtures just to make tests pass
- Must NOT "invent" product truth — only implement what specs define
- Must NOT propose architecture changes without proposing spec changes first

### Golden Fixture Discipline

Golden fixtures are **truth locks**. When a fixture fails:
1. Identify which fixture(s) failed
2. Identify which layer changed (canonical / signals / scoring / layout / snapshot / API)
3. Classify: bug, intentional change requiring version bump, or fixture defect
4. Propose correction path

**Never "fix" golden failures by updating expected outputs** unless the change is intentional+versioned or the fixture is proven incorrect.

### Versioning Gates

Material changes require explicit version bumps:
- Scoring semantics change → bump `policyVersion`
- Geometry behavior change → bump `layoutAlgorithmVersion`
- DTO shape change → bump `snapshotSchemaVersion`

### Spec Change Requests

When proposing a spec change, provide: change description, rationale, affected documents, version impacts, acceptance matrix impacts, golden fixture impacts, migration notes. No "drive-by" spec edits.

---

## Agent Routing (Token Efficiency)

**Principio: no gastar tokens caros en tareas baratas.** El agente principal (Opus) solo razona; todo lo mecánico se delega.

### Por SDD Stage

| Stage | Agente principal | Subagente (Agent tool) | Herramientas directas |
|-------|-----------------|----------------------|----------------------|
| 0 — Intake | NO (es mecánico) | NO | Clasificar en una línea |
| 1 — Spec alignment | Solo si hay conflictos entre specs | Explore para buscar invariantes en paralelo | Grep/Read para secciones puntuales |
| 2 — Design proposal | SÍ (requiere razonamiento) | NO | — |
| 3 — Implementation | Solo lógica compleja (algorithms, scoring, signals) | Scaffolding, boilerplate, configs, tipos simples, archivos repetitivos | Write/Edit para archivos individuales |
| 4 — Verification | Solo diagnóstico de fallos complejos | Verificar boundary violations en paralelo | Bash para correr tests |
| 5 — Delivery | Resumen breve, ir al grano | NO | — |

### Por Fase del Backlog

| Fase | Principal para | Subagentes para |
|------|---------------|----------------|
| 0 — Scaffolding | Decisiones de tooling | Crear carpetas, configs, placeholders |
| 1 — Canonical | Diseño de modelos, normalization mapping | Scaffold de tipos, tests de mapping |
| 2 — Signals | Lógica de cómputo (FORM, NEXT_MATCH) | Registry boilerplate, tipos DTO |
| 3 — Scoring | Policy execution, weights, contributions | Legacy resistance tests (grep-based) |
| 4 — Layout | Squarified treemap, rounding rules | Geometry validation utilities |
| 5 — Snapshot | Pipeline orchestration, identity | Warning aggregation, cache scaffolding |
| 6 — API | Diseño de endpoints | Scaffolding de rutas, middleware, error envelopes |
| 7 — Frontend | Diseño de componentes | Component scaffolding, theme, state boilerplate |
| 8 — Degraded | Diagnóstico de fallos | Test harness, simulación de outage |
| 9 — Golden fixtures | Diseño del fixture runner | Generar directorios y JSONs esperados |

### Anti-patrones (prohibidos)

- **NO leer todos los specs con el agente principal** → subagente Explore o Grep directo
- **NO re-leer un spec que ya se leyó en la sesión** → confiar en el contexto
- **NO usar subagente para razonar sobre diseño** → pierden contexto, producen basura
- **NO duplicar trabajo** → si un subagente busca algo, el principal no repite
- **NO output verbose en Stage 5** → ir al grano
- **NO usar el agente principal para crear 10 archivos de boilerplate** → subagente o loop directo

---

## Project Overview

SportPulse is a **snapshot-first sports attention dashboard**. It transforms normalized football data into a deterministic, explainable treemap-based dashboard showing which teams deserve attention and why.

**MVP constraints:** football-only, single competition (La Liga), Mode B (Form + Agenda), football-data.org as data source, backend-owned scoring and treemap geometry.

## Repository Status

This repository currently contains **specification documents only** — no source code has been implemented yet. The implementation backlog starts with Phase 0 (repo scaffolding). The target stack is TypeScript (Node.js backend, web frontend), Postgres for storage, optional Redis for caching.

## Architecture (Layered Pipeline)

Strict unidirectional dependency chain:

```
shared → canonical → signals → scoring → layout → snapshot → api → web
```

### Package Responsibilities

| Package | Owns | Must NOT own |
|---------|------|-------------|
| `packages/shared` | Domain primitives, IDs, enums, time utils, error/warning types | Any IO, scoring, layout, or provider logic |
| `packages/canonical` | Provider ingestion adapters, canonical models (Team, Match, Competition), normalization | Scoring, layout, snapshot DTOs, UI concerns |
| `packages/signals` | Signal computation from canonical data + `buildNowUtc`, normalization to `[0..1]` | Weights, policies, layout, ingestion |
| `packages/scoring` | Policy definitions, weight sets, score transforms, contribution extraction | Ingestion, normalization, treemap, caching, rendering |
| `packages/layout` | Squarified treemap algorithm, rounding rules, geometry validation | Scoring, signals, snapshot logic, frontend |
| `packages/snapshot` | Snapshot build pipeline, caching, fallback, projections | Provider adapters, treemap solver internals, UI/web |
| `packages/api` | Request validation, routing, response shaping, error envelopes | Scoring, layout, signals computation, provider calls |
| `packages/web` | Rendering snapshot DTOs, interactions, theming (Night/Day) | Score computation, treemap solving, provider calls |

### Hard-Forbidden Dependencies

- `web` must NEVER import from `scoring`, `layout`, `signals`, or `canonical`
- `api` must NEVER import from `canonical`, `signals`, `scoring`, or `layout`
- `layout` must NEVER import from `scoring` or `signals`
- `scoring` must NEVER import canonical ingestion adapters
- `signals` must NEVER import provider ingestion adapters
- Frontend must NEVER compute scoring/layout truth or call provider APIs directly

## Key Invariants

- **`buildNowUtc`** is always the semantic time anchor (not `computedAtUtc`)
- **Determinism:** same canonical data + same `buildNowUtc` + same policy + same layout config = identical output
- **Tie-breaking** must be explicit (layoutWeight desc, teamId asc), never implicit or random
- **Rounding** rules must be deterministic with explicit residual distribution
- **Explainability:** every attention outcome must expose signals, weights, contributions, and policy identity
- **Provider isolation:** provider schemas never leak into frontend contract

## Prohibited Legacy Constructs

If these appear in new code, the change is rejected:
- `SIZE_SCORE`, `PROXIMITY_BONUS`, `HOT_MATCH_SCORE`
- `scoreVersion` as identity (use `policyKey` + `policyVersion`)
- Client-side treemap solving
- UI-derived urgency bonuses
- Hash-based hidden ordering

## Test Structure

- Each package has tests in its own `test/` directory
- Golden fixtures live in `tools/fixtures/golden/<fixtureId>/`
- Tests must map to acceptance matrix IDs (A-01 through J-02)
- Minimum per layer: canonical (normalization + lifecycle), signals (correctness + missingness), scoring (policy + contributions), layout (determinism + rounding + overlap/bounds), snapshot (pipeline + fallback + ordering), api (contract + validation), web (rendering + state restoration)

### MVP Minimum Acceptance Set (must-pass)

A-01, A-03, B-01, B-04, B-05, C-01, C-02, C-04, D-01, D-02, D-04, D-05, E-01, E-02, E-03, F-01, F-02, F-03, F-04, G-01, G-02, H-01, H-02, H-03, I-01, J-01, J-02

## Implementation Phases

Phase 0: Repo scaffolding → Phase 1: Canonical ingestion → Phase 2: Signals → Phase 3: Scoring → Phase 4: Layout → Phase 5: Snapshot engine → Phase 6: UI API → Phase 7: Frontend → Phase 8: Degraded states → Phase 9: Golden fixtures + regression gates

Tickets are in `Implementation_Backlog_SDD_v1.0.md` starting at SP-0001. Each ticket defines dependencies, authoritative refs, deliverables, acceptance tests, golden fixture impact, and version impact.
