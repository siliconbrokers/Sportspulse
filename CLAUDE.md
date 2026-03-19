# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Declaración de agente — Regla CRÍTICA

**Toda respuesta que ejecute trabajo concreto DEBE terminar declarando el agente que realmente lo ejecutó.**

Formato obligatorio:

```
Agente: <NombreAgente> (<ModeloReal>) | Tokens: ~<N>k input / ~<N>k output
```

Ejemplos:
- `Agente: frontend-engineer (Sonnet) | Tokens: ~12k input / ~2k output`
- `Agente: git-ops (Haiku) | Tokens: ~8k input / ~1k output`
- `Agente: architect (Opus) | Tokens: ~20k input / ~3k output`
- `Agente: Claude Code (Sonnet) | Tokens: ~15k input / ~1k output` ← cuando el main instance hace el trabajo

**Reglas:**
- Declarar el agente que **realmente ejecutó** — no el "recomendado". Si el main instance hizo el trabajo sin despachar a un subagente, declarar `Claude Code (<ModeloActual>)`.
- **NO declarar en respuestas puramente conversacionales** (preguntas, diagnósticos, aclaraciones sin edición/escritura/bash con cambio de estado).
- Aplica a: código, docs, configs, patches, cualquier respuesta que modifique estado.

---

## Gestión de Tareas — Regla obligatoria

- **Cada vez que el usuario pide una funcionalidad nueva** (no una corrección de bug), crear automáticamente una tarea con `TaskCreate` ANTES de implementar, con subject descriptivo, description con contexto y criterios de aceptación, y metadata con `tier` y `agent`.
- Al terminar la implementación, marcar la tarea como `completed` con `TaskUpdate`.
- Las correcciones de bugs simples no requieren tarea, pero sí las features, mejoras de UX y cambios de comportamiento solicitados explícitamente.

---

## Zonas horarias — Regla CRÍTICA

**Nunca derivar una fecha local cortando un timestamp UTC.** `.toISOString().slice(0, 10)` y `.slice(0, 10)` sobre strings ISO UTC devuelven la fecha UTC, no la fecha local del usuario, y pueden diferir por un día entero para partidos nocturnos.

### Regla

- **Siempre almacenar y transportar timestamps como UTC** (ISO 8601 con `Z`).
- **Convertir a fecha local solo en el punto de presentación o consulta**, usando `Intl.DateTimeFormat` con la timezone explícita.

### Patrón obligatorio

```typescript
// ❌ INCORRECTO — devuelve fecha UTC, puede ser el día siguiente al local
const dateLocal = utcIsoString.slice(0, 10);
const dateLocal = new Date().toISOString().split('T')[0];

// ✅ CORRECTO — convierte a fecha en la timezone del usuario
const dateLocal = new Date(utcIsoString).toLocaleDateString('en-CA', {
  timeZone: 'America/Montevideo', // o la tz del usuario
});
```

### Aplicación

- **Frontend**: toda fecha derivada de un campo `*Utc` que se pasa como `dateLocal` al API **debe** usar `toLocaleDateString('en-CA', { timeZone })`.
- **Backend**: al derivar `dateLocal` desde timestamps UTC para consultas internas, usar `utcToLocalDate(iso, timezone)` (ya implementado en `packages/api/src/ui/resolve-date.ts`). Los parámetros de fecha para APIs externas pueden usar UTC según lo requiera cada API.
- **Timezone del portal**: `'America/Montevideo'` (UTC-3). Todos los componentes ya usan esta tz.

---

## UI — Reglas de presentación de datos

- **No repetir datos ya expresados en la misma vista.** Si un dato (resultado, score, fecha, etc.) ya se muestra claramente en la ficha del partido, no volver a mostrarlo en otro módulo de la misma pantalla (ej: cuadro de pronóstico, sección de estadísticas, etc.).
- Esta regla aplica especialmente al panel de detalle del partido (`DetailPanel`): cada dato se muestra una sola vez, en el lugar más prominente y natural.
- **Todo partido visible en la app debe tener DetailPanel funcional.** Cualquier tarjeta de partido que aparezca en LiveCarousel, MatchCardList, EventCard u otro componente debe abrir el DetailPanel al hacer click, sin importar el torneo o liga (ligas, Copa Libertadores, Copa del Mundo, Copa América, etc.). Esto aplica en mobile y desktop.

---

## Git & Deploy — Reglas CRÍTICAS

- **NUNCA hacer `git push` sin que el usuario lo pida explícitamente.** El push despliega a producción automáticamente (Render). Un push no autorizado puede romper el ambiente productivo.
- Solo hacer commit cuando el usuario lo pida. Solo hacer push cuando el usuario lo pida. Son dos pasos separados que requieren confirmación explícita cada uno.
- Al terminar una tarea: hacer commit local si el usuario lo pidió, pero **detenerse ahí**. Informar al usuario y esperar instrucción de push.

---

## Nuevo paquete workspace — Regla CRÍTICA

Cada vez que se crea un nuevo paquete en `packages/`, se deben hacer **obligatoriamente** estas cuatro cosas antes de terminar la tarea:

1. Agregar el path alias en `tsconfig.server.json` bajo `compilerOptions.paths`:
   ```json
   "@sportpulse/<nombre>": ["./packages/<nombre>/src/index.ts"]
   ```
2. Correr `pnpm install` para actualizar `pnpm-lock.yaml` con las dependencias del nuevo paquete.
3. Agregar el paquete en `Dockerfile` en **dos lugares**:
   - Sección de manifests (antes de `RUN pnpm install`): `COPY packages/<nombre>/package.json ./packages/<nombre>/`
   - Sección de fuentes (después de `RUN pnpm install`): `COPY packages/<nombre> ./packages/<nombre>`
4. Verificar que el paquete compile: `pnpm build` debe terminar sin errores.

**Por qué:**
- El alias en `tsconfig.server.json` es necesario porque `tsx` (dev server) resuelve `@sportpulse/*` desde ahí. Sin él, el API server crashea con `Cannot find module`.
- `pnpm install` es obligatorio porque Render usa `--frozen-lockfile` en CI. Si `pnpm-lock.yaml` no refleja el nuevo paquete, el deploy falla con exit code 1 antes de llegar al build.
- El `Dockerfile` lista los paquetes explícitamente — no hay glob. Si no se agrega el paquete, el contenedor no lo incluye y el servidor falla al iniciar.

---

## Dev Server & Build — Reglas obligatorias

- Después de cualquier cambio de backend (`packages/snapshot`, `packages/api`, `packages/scoring`, etc.) **siempre** correr `pnpm build` y luego reiniciar el dev server automáticamente — sin pedirle al usuario que lo haga.
- El reinicio se hace con: `pkill -f "tsx.*server" 2>/dev/null; pkill -f "vite" 2>/dev/null; sleep 1; pnpm dev` (en background).
- El frontend (Vite HMR) actualiza solo; el backend Node.js necesita reinicio porque sirve JS compilado desde `dist/`.
- Nunca terminar una tarea de implementación sin confirmar que el servidor quedó corriendo.

---

## Deployment Quality Guards — Reglas obligatorias

Estos guards existen para evitar que cambios en dev lleguen a producción rotos silenciosamente.

### Archivos clave (NO eliminar ni modificar sin entender el impacto)

- `tsconfig.server.typecheck.json` — typecheck de `server/` en CI. Usa `module:ESNext` + `moduleResolution:Bundler` para coincidir con cómo tsx resuelve imports. Si se agrega un archivo nuevo a `server/`, se typecheck automáticamente.
- `server/env-validator.ts` — falla el startup si vars requeridas no están seteadas. **Actualizar cuando se agrega una nueva var requerida al servidor.**
- `scripts/smoke-test.ts` — test post-deploy que verifica portal-config, routing, dashboard por liga y news. Correr con `pnpm smoke-test` o `SMOKE_BASE_URL=https://... pnpm smoke-test`.
- `.env.production.example` — referencia de todas las vars de entorno para Render. **Actualizar cuando se agrega una nueva var.**
- `.github/workflows/smoke-test.yml` — workflow manual en GitHub Actions para smoke test contra producción.

### Cuándo correr cada guard

| Situación | Guard obligatorio |
|-----------|-------------------|
| Agregar una var de entorno requerida al servidor | Actualizar `server/env-validator.ts` + `.env.production.example` |
| Agregar un archivo nuevo a `server/` | `pnpm tsc --noEmit --project tsconfig.server.typecheck.json` debe pasar |
| Después de un deploy a producción | `pnpm smoke-test` con `SMOKE_BASE_URL` de Render |
| Agregar una nueva liga/competition al portal | Verificar que `/api/ui/status` la muestre como `loaded: true` post-deploy |

### Regla de typecheck para server/

`pnpm -r build` compila solo `packages/*`. Los archivos en `server/` se ejecutan via `tsx` y **nunca son compilados por el build**. El único check de tipos para `server/` es:

```bash
pnpm tsc --noEmit --project tsconfig.server.typecheck.json
```

Este paso corre automáticamente en CI. Si falla, el deploy no llega a Render.

### Startup sequence (orden de checks en producción)

1. `validateEnv()` — falla si vars requeridas faltan
2. Inicialización de data sources
3. `assertRoutingParity()` — falla si competition IDs del portal no tienen ruta registrada
4. Fastify arranca y acepta requests

Si cualquiera de los pasos 1-3 falla, el container sale con código no-cero y Render marca el deploy como fallido.

---

## Methodology: Spec-Driven Development (SDD)

This project is governed entirely by **SDD (Spec-Driven Development)**. The specs are the source of truth. Code implements specs — never the reverse. Every document, architectural decision, implementation task, and test exists under this framework.

### Core SDD Principle

**No code exists without a spec that authorizes it.** If a spec doesn't cover something, the answer is to update the spec first — not to "just write the code."

### Document Hierarchy (Precedence Order)

When information conflicts, the higher-numbered document loses:

1. `docs/core/spec.sportpulse.core.constitution.md` — supreme governance, principles, boundaries
2. `docs/core/spec.sportpulse.core.domain-glossary-and-invariants.md` — canonical terminology, semantic backbone
3. `docs/core/spec.sportpulse.core.mvp-execution-scope.md` — what to build / not build
4. `docs/core/spec.sportpulse.core.non-functional-requirements.md` — quality baseline
5. `docs/core/spec.sportpulse.ops.operational-baseline.md` — CI/CD, deployment, security, logging, performance targets
6. `docs/core/spec.sportpulse.core.repo-structure-and-module-boundaries.md` — architecture and dependency rules
7. `docs/core/spec.sportpulse.shared.errors-and-warnings-taxonomy.md` — error/warning codes and semantics
8. `docs/core/spec.sportpulse.qa.acceptance-test-matrix.md` + `docs/core/spec.sportpulse.qa.golden-snapshot-fixtures.md` — truth locks
9. Core technical specs: `docs/specs/pipeline/spec.sportpulse.signals.core.md`, `docs/specs/pipeline/spec.sportpulse.signals.metrics.md`, `docs/specs/pipeline/spec.sportpulse.scoring.policy.md`, `docs/specs/pipeline/spec.sportpulse.snapshot.engine.md`, `docs/specs/pipeline/spec.sportpulse.snapshot.dashboard-dto.md`, `docs/specs/api/spec.sportpulse.api.contract.md`, `docs/specs/layout/spec.sportpulse.layout.treemap-algorithm.md`, `docs/specs/layout/spec.sportpulse.layout.stability.md`, `docs/architecture/spec.sportpulse.web.frontend-architecture.md`, `docs/specs/portal/spec.sportpulse.web.ui.md`
10. Supporting docs: `docs/architecture/spec.sportpulse.web.component-map.md`, `docs/specs/portal/spec.sportpulse.portal.interaction.md`, `docs/architecture/spec.sportpulse.server.backend-architecture.md`, `docs/data/spec.sportpulse.data.normalization.md`, `docs/data/spec.sportpulse.data.event-lifecycle.md`, `docs/data/spec.sportpulse.data.quality.md`, `docs/evolution/spec.sportpulse.product.feature-evolution.md`, `docs/evolution/spec.sportpulse.product.product-loop.md`
11. `docs/core/spec.sportpulse.core.ai-sdd-operating-protocol.md` — governs how AI participates in development
12. `docs/core/spec.sportpulse.core.subagents-definition.md` — sub-agent system: roles, prompts, handoffs, execution workflow
13. `docs/core/spec.sportpulse.core.implementation-backlog.md` — ticket graph with phases, dependencies, and acceptance mapping

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

### Sub-agent System (definido en `docs/core/spec.sportpulse.core.subagents-definition.md`)

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

### Predictive Engine — Agentes especializados (FUENTE PRIMARIA OBLIGATORIA)

**Toda tarea que toque `packages/prediction/` DEBE ejecutarse con el agente PE correspondiente** definido en `.claude/agents/`. No usar `backend-engineer` ni `frontend-engineer` como sustituto. El agente PE es fuente primaria; el agente genérico es fallback de último recurso únicamente si el agente PE no cubre el scope.

| Agente PE | Scope primario en `packages/prediction/` |
|-----------|------------------------------------------|
| `predictive-engine-orchestrator` | Coordinación multi-fase, diseño cross-cutting, handoffs |
| `domain-contracts-agent` | `src/contracts/` — tipos, enums, DTOs, schemas |
| `match-prediction-engine` | `src/engine/elo-rating`, `lambda-computer`, `derived-raw`, `scoreline-matrix`, `raw-aggregator` |
| `calibration-decision-policy` | `src/calibration/`, `src/engine/derived-calibrated`, `src/engine/decision-policy`, `src/metrics/` |
| `validation-operating-modes` | `src/validation/`, modos operativos (FULL/LIMITED/NOT_ELIGIBLE), eligibilidad |
| `competition-engine` | `src/competition/` — standings, grupos, knockout, bracket |
| `predictive-engine-qa` | `test/` — invariantes, conformidad, anti-leakage, cobertura |
| `predictive-engine-auditor` | Auditorías formales de conformidad — NO escribe código |

**Regla de routing PE por tipo de tarea:**
- Fix contractual en output shape → `calibration-decision-policy`
- Fix de elegibilidad o modos → `validation-operating-modes`
- Fix en distribución Poisson / Elo / lambdas → `match-prediction-engine`
- Agregar/corregir tests de invariantes → `predictive-engine-qa`
- Auditoría de cierre → `predictive-engine-auditor`
- Cambio cross-cutting o fase nueva → `predictive-engine-orchestrator`

### Auditorías PE — Persistencia obligatoria de resultados

**Todo resultado de auditoría formal del `predictive-engine-auditor` DEBE persistirse en disco** en `docs/audits/` antes de cerrar la tarea.

- **Nombre de archivo:** `PE-audit-YYYY-MM-DD.md` (fecha de ejecución)
- **Contenido obligatorio:** dictamen (CONFORMANT / PARTIALLY_CONFORMANT / NON_CONFORMANT), lista de findings con severidad y estado (OPEN/CLOSED), secciones del spec verificadas, conteo de tests, notas de cobertura
- **Si hay múltiples rondas** en la misma sesión: un único archivo con secciones por ronda
- **Esta regla aplica también a re-auditorías** después de fixes — la segunda pasada se agrega como nueva sección al mismo archivo del día

Un audit sin artefacto persistido no cuenta como evidencia de conformidad.

**Append obligatorio al archivo de auditoría del día en estos casos:**

| Evento | Qué appendear |
|--------|--------------|
| Se agregan tests nuevos al paquete (`packages/prediction/`) | Nombre del test / describe, qué cubre, spec refs, nuevo conteo de suite |
| Se cierra una nota de cobertura pendiente documentada en el audit | Sección de cierre con tabla de tests y conteo actualizado |
| Se corrige un finding post-audit sin nueva ronda formal | Nota de corrección con finding ID, cambio aplicado, conteo actualizado |
| Se actualiza el conteo de tests por cualquier motivo | Actualizar la línea `Tests N passed` en "Suite final" |

**Si no existe archivo de auditoría del día** (primera intervención del día sobre `packages/prediction/`): crear `PE-audit-YYYY-MM-DD.md` con el contexto mínimo antes de appendear.

### Cuándo usar Agent tool (subagentes)

Los agentes definidos en `.claude/agents/` con `model:` en su frontmatter usan **ese modelo específico** (e.g. `architect` corre Opus, `git-ops` corre Haiku). El Agent tool genérico sin definición de agente usa el modelo de la sesión.

El Agent tool es útil para:
- **Paralelismo**: lanzar múltiples tareas independientes simultáneamente
- **Aislamiento de contexto**: evitar que boilerplate contamine el contexto principal
- **Exploración**: buscar en codebase sin gastar contexto del principal
- **Cambio de modelo**: despachar a `architect` para diseño en Opus, `git-ops` para infra en Haiku

---

### Agent Dispatch — Reglas de despacho obligatorio

**El main instance NO debe hacer trabajo que pertenezca a un agente.**
Estas reglas son de cumplimiento obligatorio en toda sesión, no solo cuando es conveniente.

#### Investigación / búsqueda de archivos
| Situación | Acción obligatoria |
|-----------|-------------------|
| Buscar archivos por patrón o keyword en >3 archivos | Lanzar `Explore` (quick/medium/very thorough según alcance) |
| Entender cómo funciona una sección del codebase | Lanzar `Explore` — nunca leer 5+ archivos con Read directamente |
| Root cause de un bug que involucra múltiples capas | Lanzar `architect` para diagnóstico |

#### Implementación de código
| Situación | Acción obligatoria |
|-----------|-------------------|
| Cualquier edit en `packages/web/src/` | `frontend-engineer` |
| Cualquier edit en `packages/{api,canonical,signals,scoring,layout,snapshot}/src/` o `server/` | `backend-engineer` |
| Cualquier edit en `packages/prediction/` | Agente PE correspondiente (ver tabla PE) |
| Fix de 1 sola línea en un archivo de código | OK hacer directamente si el cambio es trivial y está 100% claro |

#### Operaciones de infraestructura
| Situación | Acción obligatoria |
|-----------|-------------------|
| Editar `.env`, `package.json`, `tsconfig*.json`, CI YAML | `git-ops` |
| Commits de git | `git-ops` |
| Actualizar CLAUDE.md, MEMORY.md, README.md | `git-ops` |
| Agregar/quitar dependencias | `git-ops` |

#### Anti-patrón prohibido
❌ **Main instance investiga exhaustivamente (lee 10+ archivos, corre 15 curls) y LUEGO lanza un agente para formalizar.**
✅ **Main instance identifica el tipo de tarea → lanza el agente correcto de entrada → recibe resultado.**

El main instance debe hacer diagnóstico *superficial* (2-3 reads o greps para confirmar el scope) y luego delegar. El trabajo pesado siempre va al agente.

#### Paralelismo obligatorio
Cuando hay 2+ tareas independientes (distintos archivos, distintos dominios), siempre lanzarlas en paralelo en un solo mensaje. Nunca secuencial si no hay dependencia real.

---

### Enforcement automático por tier

**Nunca bloquear ni pedir al usuario que cambie de modelo manualmente.** Proceder siempre con el modelo activo. Al finalizar, declarar el agente que ejecutó el trabajo (ver § Declaración de agente). No declarar en respuestas puramente conversacionales.

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

All phases (0-9) complete + Phase 10 (UI Polish) complete + News + Video Highlights + Eventos V1 + Matchday File Cache + Predictive Engine (PE). The full pipeline is operational: canonical→signals→scoring→layout→snapshot→api→web. Stack: TypeScript (Node.js/Fastify backend, React/Vite frontend), pnpm workspaces.

### API endpoints
- `GET /api/ui/dashboard` — snapshot treemap + match cards
- `GET /api/ui/team` — team detail projection
- `GET /api/ui/standings` — league table
- `GET /api/ui/competition-info` — matchday info
- `GET /api/ui/news` — news feed por liga (URU/LL/EPL/BUN)
- `GET /api/ui/videos` — video highlight por liga (YouTube Data API v3)
- `GET /api/ui/eventos` — streaming events list (streamtp10)
- `GET /api/ui/eventos/event/:id` — single event (provider URL never exposed to client)

### server/ composition root (outside packages)
- `server/news/` — NewsService: Tenfield RSS (URU) + SerpAPI google_news (LL/EPL/BUN)
- `server/video/` — VideoService: YouTube playlistItems + fallback search
- `server/football-data-source.ts` — football-data.org adapter
- `server/the-sports-db-source.ts` — TheSportsDB adapter (Liga Uruguaya)
- `server/routing-data-source.ts` — composite routing by competitionId
- `server/matchday-cache.ts` — file-based JSON cache per matchday (spec: `docs/specs/pipeline/spec.sportpulse.server.matchday-cache.md` v1.1)
  - Cache dir: `/cache/{provider}/{competitionId}/{season}/matchday-{NN}.json` (runtime, not versioned)
  - **Sub-tournament suffix (v1.1):** leagues with `hasSubTournaments=true` use `matchday-{NN}-{KEY}.json` (e.g. `matchday-07-CLAUSURA.json`). `buildCachePath()` accepts optional `subTournamentKey`; `persistMatchesByMatchday()` groups by `(matchday, subTournamentKey)` pair to avoid Apertura/Clausura sharing the same filename.
  - Atomic write (.tmp → rename), TTL by status (finished=1y, live=60s, scheduled=6h, mixed=5min)
  - Integrated in both data sources via `checkMatchdayCache` / `persistMatchdayCache`
  - Bug fix (2026-03): window fetch was overwriting matchday cache files with partial data when a matchday spans multiple days; fix: merge with baseMatches per matchday before persisting
  - Bug fix (2026-03-19): Apertura/Clausura cache key conflict — rounds 1-17 existed in both sub-tournaments with the same filename. Fix: sub-tournament suffix in path. Old-format files (no suffix) deleted and re-populated automatically on next fetch.
  - Optimization: in incremental window fetch, if `checkMatchdayCache()` returns a hit with status=finished and all matches are FINISHED → skip processing (continue), reuse cached data

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

### Principio rector: Mobile-First con Tailwind CSS

- **Diseño Mobile-First siempre:** construir primero para pantallas pequeñas y escalar hacia desktop. Nunca al revés.
- **Usar Tailwind CSS** para estilos de layout, spacing, tipografía y colores. Solo usar `style={{}}` inline cuando el valor sea dinámico (calculado en runtime, como gradientes con colores de datos).
- **Tablas y grids manejables en mobile:** toda tabla (`<table>`) debe tener `overflow-x: auto` en su contenedor, ocultar columnas secundarias en mobile, y nunca causar scroll horizontal en la página. Todo grid debe usar `auto-fill` / `minmax()` o columnas explícitas adaptadas por breakpoint.

### Reglas obligatorias para cualquier tarea de frontend:

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

### Back Office — Dynamic Portal Configuration

**Location:** `/admin` (public route, auth via `ADMIN_SECRET` env var)

**Files:**
- `server/portal-config-store.ts` — atomic JSON store for portal config (enabled competitions + features TV/Pronósticos)
- `server/admin-router.ts` — admin endpoints: POST /api/admin/auth, GET/PUT /api/admin/config
- `packages/api/src/ui/portal-config-route.ts` — public endpoint GET /api/ui/portal-config (no auth required)
- `packages/web/src/admin/AdminPage.tsx` — admin dashboard
- `packages/web/src/hooks/use-portal-config.ts` — hook with auto-retries (serverReady, 3s retry on 500/error)
- `packages/web/src/components/ServerBootScreen.tsx` — loading screen while server boots

**Data flow:**
1. Frontend fetches `GET /api/ui/portal-config` (public) on mount → `usePortalConfig` hook
2. If server not ready (500/error), retries every 3s, shows `ServerBootScreen`
3. Admin accesses `/admin`, enters ADMIN_SECRET, submits config changes
4. POST `/api/admin/config` persists to `cache/portal-config.json` (atomic .tmp → rename)
5. Audit log appended to `cache/portal-config-audit.jsonl` (one event per line)
6. Config propagates to:
   - `Navbar.tsx` — filters TV/Pronósticos menu items by `features.tv` and `features.predictions`
   - `HomePortal.tsx` — enables/disables league sections (LiveCarousel, DailyHighlights, EventsSection)
   - `LiveCarousel.tsx` — filters matches by `enabledCompetitionIds`
   - `DailyHighlights.tsx` — filters news/video blocks by `enabledLeagueKeys`
   - `EventsSection.tsx` — filters events by `enabledCompetitionIds`

**Centralized mapping:** `packages/web/src/utils/competition-meta.ts`
- `COMP_ID_TO_NEWS_KEY`: maps competitionId → league key for news filtering
- `COMP_ID_TO_NORMALIZED_LEAGUE`: maps competitionId → normalized league display name
- `MANAGED_NORMALIZED_LEAGUES`: tuple of league names managed by back office

**Cache location:** `/cache/portal-config.json` and `/cache/portal-config-audit.jsonl` (runtime, not versioned)

### Known bugs fixed
- Race condition al cambiar de liga rápido: `use-dashboard-snapshot.ts` usa `AbortController` para cancelar requests anteriores en vuelo.
- Window fetch partial overwrite: merging with baseMatches before persisting matchday cache prevents data loss for multi-day matchdays.
- LiveCarousel hover clipping: `paddingTop:4` on scroll container prevents `translateY(-2px)` from being clipped by overflow.
- Standings legend emojis replaced with colored squares using exact `zone.color` values.
- Pronósticos missing matches: window fetch was caching partial matchday data; merge fix ensures full match list.
- LiveCarousel score alignment: gap:7 + fixed crest height aligns score column vertically with team rows.
- Liga MX sub-tournament cache key conflict (2026-03-19): Apertura and Clausura rounds share the same 1-17 round numbers. Old code produced `matchday-07.json` for both, causing Clausura rounds 1-11 to read Apertura historical data (TTL=1y). Fix: `buildCachePath()` appends `-{KEY}` suffix when `subTournamentKey` is provided → `matchday-07-CLAUSURA.json`. `persistMatchesByMatchday()` groups by `(matchday, subTournamentKey)` pair.
- Liga MX cold-start not defaulting to Clausura (2026-03-19): `competition-info-route.ts` early return (when `seasonId=null`) was returning without `activeSubTournament`. Fix: call `getActiveSubTournament()` (uses static fallback via `resolveActiveSubTournament`) even in the early return path.
- Liga MX `useEffect #2` guard blocking auto-selection (2026-03-19): guard `!compInfo?.subTournaments?.length` in App.tsx prevented CLAUSURA from being set during cold-start when `subTournaments=[]`. Fix: removed the guard — now sets `subTournamentKey` from `activeSubTournament` whenever present.
