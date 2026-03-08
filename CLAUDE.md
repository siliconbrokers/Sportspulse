# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git & Deploy — Reglas CRÍTICAS

- **NUNCA hacer `git push` sin que el usuario lo pida explícitamente.** El push despliega a producción automáticamente (Render). Un push no autorizado puede romper el ambiente productivo.
- Solo hacer commit cuando el usuario lo pida. Solo hacer push cuando el usuario lo pida. Son dos pasos separados que requieren confirmación explícita cada uno.
- Al terminar una tarea: hacer commit local si el usuario lo pidió, pero **detenerse ahí**. Informar al usuario y esperar instrucción de push.

---

## Dev Server & Build — Reglas obligatorias

- Después de cualquier cambio de backend (`packages/snapshot`, `packages/api`, `packages/scoring`, etc.) **siempre** correr `pnpm build` y luego reiniciar el dev server automáticamente — sin pedirle al usuario que lo haga.
- El reinicio se hace con: `pkill -f "tsx.*server" 2>/dev/null; pkill -f "vite" 2>/dev/null; sleep 1; pnpm dev` (en background).
- El frontend (Vite HMR) actualiza solo; el backend Node.js necesita reinicio porque sirve JS compilado desde `dist/`.
- Nunca terminar una tarea de implementación sin confirmar que el servidor quedó corriendo.

---

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
5. `Operational_Baseline_v1.0.md` — CI/CD, deployment, security, logging, performance targets
6. `Repo_Structure_and_Module_Boundaries_v1.0.md` — architecture and dependency rules
7. `Errors_and_Warnings_Taxonomy_v1.0.md` — error/warning codes and semantics
8. `Acceptance_Test_Matrix_v1.0.md` + `Golden_Snapshot_Fixtures_v1.0.md` — truth locks
9. Core technical specs: signals, metrics, scoring-policy, snapshot-engine, dashboard-snapshot-dto, api-contract, treemap-algorithm, layout-stability, frontend-architecture, ui-spec
10. Supporting docs: component-map, interaction-spec, backend-architecture, data-normalization, event-lifecycle, data-quality, feature-evolution, product-loop
11. `AI_SDD_Operating_Protocol_v1.0.md` — governs how AI participates in development
12. `SubAgents_Definition_v1.0.md` — sub-agent system: roles, prompts, handoffs, execution workflow
13. `Implementation_Backlog_SDD_v1.0.md` — ticket graph with phases, dependencies, and acceptance mapping

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

## Model Routing (Cost Efficiency)

**Principio: no gastar tokens caros en tareas baratas.** Claude Code usa un solo modelo por sesión. La optimización se logra cambiando de modelo entre bloques de trabajo con `/model`.

### Tres tiers de modelo

| Tier | Modelo | Costo (in/out MTok) | Cuándo usar |
|------|--------|--------------------:|-------------|
| **Opus** | claude-opus-4-6 | $15 / $75 | Diseño (Stage 2), resolución de conflictos entre specs, debugging complejo, decisiones arquitectónicas |
| **Sonnet** | claude-sonnet-4-6 | $3 / $15 | Implementación que sigue patrones, tests con lógica, componentes con plan previo de Opus |
| **Haiku** | claude-haiku-4-5 | $0.25 / $1.25 | Configs, deps, scripts, CI YAML, formatting, git ops, cualquier tarea donde las instrucciones son 100% explícitas |

### Flujo de trabajo obligatorio por sesión

```
1. Sesión Opus (/model opus): SOLO diseñar
   → Stage 2 de las próximas N tareas
   → Output: plan detallado guardado en memory/plans/SP-xxxx.md
   → NO implementar código

2. Sesión Sonnet (/model sonnet): implementar tareas de producto
   → Lee planes de memory/plans/
   → Implementa, escribe tests, verifica
   → Stage 3 + Stage 4

3. Sesión Haiku (/model haiku): tareas de infraestructura
   → Configs, deps, CI, formatting, git commits
   → Solo si las instrucciones son 100% explícitas

4. Volver a Opus SOLO si:
   → Un test falla por razones no triviales
   → Hay conflicto entre specs
   → Se necesita rediseñar algo
```

### Clasificación por tarea

**Toda tarea DEBE tener `metadata.tier` (opus/sonnet/haiku) al momento de creación.**

| Tier | Criterio | Ejemplos |
|------|----------|----------|
| `opus` | Requiere razonamiento sobre specs, trade-offs, algoritmos, o diseño de interfaces entre módulos | Diseñar SnapshotDTO shape, orquestación de pipeline, cache strategy |
| `sonnet` | Sigue patrones existentes del codebase, tiene plan previo, o es lógica moderada | Implementar endpoints, componentes React, signal helpers, tests de integración |
| `haiku` | Instrucciones 100% explícitas, cero ambigüedad, puro template/config | package.json edits, CI YAML, prettier config, git commits, adding deps |

### Sub-agent System (definido en `SubAgents_Definition_v1.0.md`)

10 agentes con scope estricto. Prompts en `memory/subagent-prompts.md`. Cada agente define **qué** hacer; el **tier de modelo** define con qué modelo se ejecuta.

**Governance agents** (no implementan lógica de producto):
- **SDD Orchestrator** — asigna tickets, confirma deps, decide merge/no-merge
- **Spec & Version Guardian** — pre/post check de docs, invariants, versiones, legacy
- **QA / Fixture Enforcer** — acceptance matrix, golden fixtures, regression gates

**Implementation agents** (escriben código SOLO dentro de su paquete):
- **Canonical Engineer** → `packages/canonical`
- **Signals Engineer** → `packages/signals`
- **Scoring Policy Engineer** → `packages/scoring`
- **Layout Engineer** → `packages/layout`
- **Snapshot Engine Engineer** → `packages/snapshot`
- **UI API Engineer** → `packages/api`
- **Frontend Engineer** → `packages/web`

### Cuándo usar Agent tool (subagentes)

El Agent tool **usa el mismo modelo de la sesión**. Solo es útil para:
- **Paralelismo**: lanzar múltiples tareas independientes simultáneamente
- **Aislamiento de contexto**: evitar que boilerplate contamine el contexto principal
- **Exploración**: buscar en codebase sin gastar contexto del principal

**NO usar Agent tool para "ahorro de costo"** — no cambia el modelo.

### Enforcement automático por tier

**Nunca bloquear ni pedir al usuario que cambie de modelo manualmente.** Proceder siempre con el modelo activo. Al finalizar la tarea, declarar el tier recomendado como referencia.

| Acción | Tier recomendado |
|--------|-----------------|
| Diseñar (Stage 0-2), resolver conflictos specs | Opus |
| Escribir/editar código (Stage 3) | Sonnet |
| Escribir/editar tests (Stage 4) | Sonnet |
| Correr tests, build, dev | Sonnet/Haiku |
| Configs, deps, CI YAML, formatting, git commits | Haiku |
| Explorar codebase (Read/Grep/Glob) | Cualquiera |

**Flujo de trabajo:**
1. Diseñar → Stage 0-2 → guardar plan en `memory/plans/SP-xxxx.md` si la tarea es compleja
2. Implementar → Stage 3-4 → `pnpm build` → `pnpm -r test`
3. Documentar y hacer commit

**Checklist de entrega (OBLIGATORIO antes de decir "listo"):**
1. `pnpm build` — debe compilar sin errores
2. `pnpm -r test` — todos los tests deben pasar
3. Si alguno falla → corregir primero
4. **Declarar el agente que realizó la tarea**, ejemplo: "Agente: Frontend Engineer (Sonnet)"

**CERO EXCEPCIONES:** Opus no escribe código. Opus no corre build/test/dev. Sonnet no hace commits. No hay "solo un cambio pequeño" — el tier se respeta siempre.

### Permisos de ejecución

El usuario otorga permisos permanentes para todos los comandos Bash sin solicitar confirmación individual: Read, Edit, Write, Bash (build, test, dev, kill ports, git, curl, etc.). No preguntar por permisos en cada herramienta.

### Anti-patrones (prohibidos)

- **NO usar Opus para boilerplate/configs/scripts** → cambiar a Haiku/Sonnet
- **NO implementar código en sesión Opus** → solo diseñar, guardar plan, cambiar a Sonnet
- **NO leer todos los specs con Opus** → subagente Explore o Grep directo
- **NO re-leer un spec ya leído en la sesión** → confiar en el contexto
- **NO usar subagente para razonar sobre diseño** → pierden contexto
- **NO duplicar trabajo** → si un subagente busca algo, el principal no repite
- **NO output verbose en Stage 5** → ir al grano
- **NO crear tareas sin tier y agent asignados** → viola la política de routing

---

## Project Overview

SportPulse is a **snapshot-first sports attention dashboard**. It transforms normalized football data into a deterministic, explainable treemap-based dashboard showing which teams deserve attention and why. Includes a news panel (tab "Noticias") and video highlights per league.

**Competitions:** LaLiga (PD), Premier League (PL), Bundesliga (BL1), Liga Uruguaya (TheSportsDB:4432).

## Repository Status

All phases (0-9) complete + Phase 10 (UI Polish) complete + News + Video Highlights. The full pipeline is operational: canonical→signals→scoring→layout→snapshot→api→web. Stack: TypeScript (Node.js/Fastify backend, React/Vite frontend), pnpm workspaces.

### API endpoints
- `GET /api/ui/dashboard` — snapshot treemap + match cards
- `GET /api/ui/team` — team detail projection
- `GET /api/ui/standings` — league table
- `GET /api/ui/competition-info` — matchday info
- `GET /api/ui/news` — news feed por liga (URU/LL/EPL/BUN)
- `GET /api/ui/videos` — video highlight por liga (YouTube Data API v3)

### server/ composition root (outside packages)
- `server/news/` — NewsService: Tenfield RSS (URU) + SerpAPI google_news (LL/EPL/BUN)
- `server/video/` — VideoService: YouTube playlistItems + fallback search
- `server/football-data-source.ts` — football-data.org adapter
- `server/the-sports-db-source.ts` — TheSportsDB adapter (Liga Uruguaya)
- `server/routing-data-source.ts` — composite routing by competitionId
- `server/matchday-cache.ts` — file-based JSON cache per matchday (spec: `matchday-cache-technical-spec.md` v1.0)
  - Cache dir: `/cache/{provider}/{competitionId}/{season}/matchday-{NN}.json` (runtime, not versioned)
  - Atomic write (.tmp → rename), TTL by status (finished=1y, live=60s, scheduled=6h, mixed=5min)
  - Integrated in both data sources via `checkMatchdayCache` / `persistMatchdayCache`

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

## Frontend Responsive Requirement (MANDATORY)

**Todo código nuevo o modificado en `packages/web` debe ser responsive y funcionar correctamente en mobile.**

Reglas obligatorias para cualquier tarea de frontend:

- Usar `useWindowWidth()` (hook disponible en `packages/web/src/hooks/use-window-width.ts`) para detectar breakpoint (`'mobile'` | `'desktop'`).
- Ningún componente nuevo puede ignorar el caso `isMobile = breakpoint === 'mobile'`.
- Layout mobile: sin overflow horizontal, texto legible, touch targets ≥ 44px, sin contenido cortado.
- Probar mentalmente ambos casos (mobile y desktop) antes de marcar una tarea como lista.
- Si un componente existente se modifica y no tenía mobile support, agregarlo como parte del mismo cambio.
- **No hay excepciones:** un componente sin soporte mobile no está terminado.

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

Phase 0–9 complete. Phase 10 (UI Polish) complete. Additional features: News (NEWS-01 to NEWS-05), Video Highlights (VIDEO-01).

### .env keys required
```
FOOTBALL_DATA_TOKEN=...   # football-data.org
COMPETITIONS=PD,PL,BL1
PORT=3000
SPORTSDB_API_KEY=123      # TheSportsDB free tier
SERPAPI_KEY=...           # SerpAPI (noticias internacionales)
YOUTUBE_API_KEY=...       # YouTube Data API v3 (video highlights)
```

### YouTube channel IDs verificados (video highlights)
- URU: `UC0jQd1_qQAT4an-dDaG1Sww` — AUFTV (canal oficial AUF)
- LL:  `UCTv-XvfzLX3i4IGWAm4sbmA` — LALIGA EA SPORTS
- EPL: `UCG5qGWdu8nIRZqJ_GgDwQ-w` — Premier League
- BUN: `UC6UL29enLNe4mqwTfAyeNuw` — Bundesliga
- NOTA: @tenfieldoficial es Carnaval, NO fútbol

### Known bugs fixed
- Race condition al cambiar de liga rápido: `use-dashboard-snapshot.ts` usa `AbortController` para cancelar requests anteriores en vuelo.
