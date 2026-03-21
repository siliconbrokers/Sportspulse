# CLAUDE.md

Guidance for Claude Code working in this repository.

---

## API Consumption Control — CRÍTICO

**Spec:** `docs/specs/ops/spec.sportspulse.ops.api-consumption-control.md`

Tres storms (2026-03-21) destruyeron la cuota diaria de API-Football. Cumplimiento obligatorio.

**R1 — Clasificar LIVE vs OFFLINE antes de escribir código**
- `LIVE`: datos en tiempo real → ciclo de refresh con protección
- `OFFLINE`: training data, stats históricas, player stats → **NUNCA en ciclo de refresh automático**
- Es `OFFLINE` si: TTL > 24h, se llama por entidad, o existe fallback estático aceptable

**R2 — Calcular impacto antes de implementar**
Documentar `calls_per_cycle`, `calls_per_day`, `cold_restart_impact`. Si `cold_restart_impact > 75` (1% de 7500/día) → requiere aprobación explícita.

**R3 — Tres capas anti-storm para toda llamada LIVE**
1. Sentinel en disco en TODOS los error paths (HTTP error, quota, catch, respuesta vacía)
2. Write-before-fetch para llamadas que se disparan N veces por ciclo
3. Cap global por proceso (`MAX_FETCHES_PER_PROCESS`)

**R4 — Dev y prod comparten cuota**
`APIFOOTBALL_KEY` es la misma en dev y prod. Toda llamada `OFFLINE` gateada con `ENABLE_TRAINING_FETCHES=true` (off por defecto).

---

## Declaración de agente — CRÍTICO

**Solo en respuestas con trabajo concreto** (edición, escritura, bash con cambio de estado). NO en respuestas conversacionales.

```
Agente: <NombreAgente> (<ModeloReal>) | Tokens: ~<N>k input / ~<N>k output
```

- Declarar el agente que **realmente ejecutó**. Main instance sin despacho → `Claude Code (Sonnet)`.
- Agentes con `model:` en frontmatter usan ESE modelo (architect=Opus, git-ops=Haiku).

---

## Gestión de Tareas — OBLIGATORIO

- **Feature nueva o mejora UX solicitada** → `TaskCreate` con subject, description, criterios, `metadata.tier` y `metadata.agent` — ANTES de implementar.
- Al terminar → `TaskUpdate` a `completed` inmediatamente.
- Bugs triviales de una línea: no requieren tarea.

---

## Zonas horarias — CRÍTICO

**Nunca cortar un timestamp UTC para derivar fecha local.** `.toISOString().slice(0, 10)` devuelve fecha UTC, no local — puede diferir un día entero para partidos nocturnos.

```typescript
// ❌ INCORRECTO
const dateLocal = utcIsoString.slice(0, 10);

// ✅ CORRECTO
const dateLocal = new Date(utcIsoString).toLocaleDateString('en-CA', {
  timeZone: 'America/Montevideo',
});
```

- **Frontend**: usar `toLocaleDateString('en-CA', { timeZone })` en todo campo `*Utc` → `dateLocal`
- **Backend**: usar `utcToLocalDate(iso, timezone)` (`packages/api/src/ui/resolve-date.ts`)
- **Portal timezone**: `'America/Montevideo'` (UTC-3)

---

## UI — Reglas de presentación

- **No repetir datos en la misma vista.** Score ya visible en ficha → no repetir en pronóstico/stats.
- **Todo partido visible debe tener DetailPanel funcional** al hacer click (mobile y desktop, cualquier liga/copa).

---

## Git & Deploy — CRÍTICO

- **NUNCA hacer `git push` sin instrucción explícita.** Push despliega a producción (Render) automáticamente.
- **NUNCA hacer `git commit` sin instrucción explícita.** Son dos pasos separados.
- Al terminar tarea: listar archivos modificados → ESPERAR instrucción. No commitear por iniciativa propia.

---

## League Governance — CRÍTICO

**Toda adición de liga/torneo → DEBE usar el skill `/add-league`.** No agregar por instrucción directa en chat.
- Motivo: toca 4+ archivos con campos específicos (leagueId, seasonKind, mode, etc.)
- Excepción: modificar `mode` de liga existente sí puede hacerse directamente.

---

## Nuevo paquete workspace — CRÍTICO

Al crear `packages/<nuevo>`, obligatoriamente antes de terminar:
1. Alias en `tsconfig.server.json`: `"@sportpulse/<nombre>": ["./packages/<nombre>/src/index.ts"]`
2. `pnpm install` — Render usa `--frozen-lockfile`; lockfile desactualizado = deploy fallido
3. Dockerfile en dos lugares: sección manifests (antes de `RUN pnpm install`) + sección fuentes
4. `pnpm build` sin errores

---

## Dev Server & Build — OBLIGATORIO

- Tras cambio de backend: `pnpm build` + reiniciar dev automáticamente (sin pedirle al usuario):
  ```
  pkill -f "tsx.*server" 2>/dev/null; pkill -f "vite" 2>/dev/null; sleep 1; pnpm dev
  ```
- Frontend (Vite HMR) actualiza solo. Backend necesita reinicio (sirve JS compilado desde `dist/`).
- Nunca terminar tarea sin confirmar que el servidor quedó corriendo.

---

## Deployment Quality Guards — OBLIGATORIO

### Archivos clave (NO modificar sin entender impacto)
- `tsconfig.server.typecheck.json` — typecheck de `server/` en CI
- `server/env-validator.ts` — falla startup si vars faltan. **Actualizar al agregar var requerida.**
- `scripts/smoke-test.ts` — post-deploy: `pnpm smoke-test` o `SMOKE_BASE_URL=https://... pnpm smoke-test`
- `.env.production.example` — referencia de vars para Render. **Actualizar al agregar var.**

| Situación | Guard obligatorio |
|-----------|-------------------|
| Nueva var requerida al servidor | `server/env-validator.ts` + `.env.production.example` |
| Nuevo archivo en `server/` | `pnpm tsc --noEmit --project tsconfig.server.typecheck.json` |
| Deploy a producción | `pnpm smoke-test` con `SMOKE_BASE_URL` |
| Nueva liga al portal | Verificar `/api/ui/status` → `loaded: true` post-deploy |

**Typecheck server/:** `pnpm -r build` NO compila `server/`. Único check: `pnpm tsc --noEmit --project tsconfig.server.typecheck.json`.

**Startup sequence:** `validateEnv()` → data sources → `assertRoutingParity()` → Fastify. Fallo en 1-3 = exit no-cero, deploy marcado como fallido.

---

## Methodology: Spec-Driven Development (SDD)

**El código implementa specs, nunca al revés. Sin spec que autorice → actualizar spec primero.**

### Jerarquía de documentos (mayor número = menor precedencia)

1. `docs/core/spec.sportpulse.core.constitution.md`
2. `docs/core/spec.sportpulse.core.domain-glossary-and-invariants.md`
3. `docs/core/spec.sportpulse.core.mvp-execution-scope.md`
4. `docs/core/spec.sportpulse.core.non-functional-requirements.md`
5. `docs/core/spec.sportpulse.ops.operational-baseline.md`
6. `docs/core/spec.sportpulse.core.repo-structure-and-module-boundaries.md`
7. `docs/core/spec.sportpulse.shared.errors-and-warnings-taxonomy.md`
8. QA Matrix + Golden Fixtures
9. Core technical specs (signals, scoring, snapshot, layout, API contract, frontend arch, UI)
10. Supporting docs (component map, backend arch, data normalization, event lifecycle, data quality)
11. `docs/core/spec.sportpulse.core.ai-sdd-operating-protocol.md`
12. `docs/core/spec.sportpulse.core.subagents-definition.md`
13. `docs/core/spec.sportpulse.core.implementation-backlog.md`

### Workflow obligatorio por tarea

- **Stage 0** — Intake: clasificar (spec change / impl / test / refactor / bug)
- **Stage 1** — Spec alignment: specs gobernantes, invariantes, versiones afectadas
- **Stage 2** — Design: enfoque, módulo, outputs, acceptance checks. **Sin código hasta Stage 2 aprobado.**
- **Stage 3** — Implementation
- **Stage 4** — Verification: tests, determinismo, no forbidden deps
- **Stage 5** — Delivery: archivos, tests, versiones, fixtures

### Invariantes clave

- `buildNowUtc` es el ancla semántica de tiempo (no `computedAtUtc`)
- Determinismo: mismos inputs + política = output idéntico
- Tie-breaking explícito: layoutWeight desc, teamId asc
- Rounding determinístico con distribución de residuos explícita
- Provider schemas nunca leak al frontend contract

### Versioning gates

- Scoring semántico → bump `policyVersion`
- Geometría → bump `layoutAlgorithmVersion`
- DTO shape → bump `snapshotSchemaVersion`

### Golden fixtures — truth locks

Al fallar: identificar fixture → capa cambiada → clasificar (bug / cambio intencional+versioned / fixture defect) → proponer corrección. **Nunca actualizar expected outputs para que un test pase.**

### SDD Constraints on AI

- No ampliar scope sin aprobación · No mover scoring/layout truth al frontend
- No cambiar semántica de policy/layout/schema sin versioning
- No "inventar" producto · No proponer cambios de arquitectura sin proponer spec change primero

### SDD Conflict Resolution

Cuando specs conflictúan: (1) identificar explícitamente con citas, (2) determinar precedencia, (3) proponer corrección al doc de menor precedencia. Nunca elegir silenciosamente una interpretación.

### Delivery checklist (OBLIGATORIO antes de decir "listo")

1. `pnpm build` — sin errores
2. `pnpm -r test` — todos pasan (corregir si fallan, no entregar con rojo)
3. Declarar agente que ejecutó

---

## Model Routing

| Tier | Modelo | Cuándo |
|------|--------|--------|
| **Opus** | claude-opus-4-6 | Diseño (Stage 0-2), conflictos specs, debugging complejo, decisiones arquitectónicas |
| **Sonnet** | claude-sonnet-4-6 | Implementación, tests, lógica moderada |
| **Haiku** | claude-haiku-4-5 | Configs, deps, CI YAML, git commits (instrucciones 100% explícitas) |

**Toda tarea DEBE tener `metadata.tier` (opus/sonnet/haiku) al crearla.**

**Flujo:** Opus diseña → guarda plan en `memory/plans/SP-xxxx.md` → Sonnet implementa (Stage 3-4) → Haiku para infra. Volver a Opus solo si test falla por razón no trivial, hay conflicto de specs, o se necesita rediseñar.

**Nunca bloquear ni pedir al usuario que cambie de modelo.** Proceder con el modelo activo.

**CERO EXCEPCIONES:** Opus no escribe código ni corre build/test/dev. Sonnet no hace commits. No hay "solo un cambio pequeño".

### Anti-patrones prohibidos

- NO usar Opus para boilerplate/configs/scripts
- NO implementar código en sesión Opus — solo diseñar y guardar plan
- NO re-leer un spec ya leído en la sesión
- NO usar subagente para razonar sobre diseño (pierden contexto)
- NO duplicar trabajo (si subagente busca, el principal no repite)
- NO output verbose en Stage 5
- NO crear tareas sin tier y agent asignados

### Permisos de ejecución

El usuario otorga permisos permanentes para todos los comandos Bash sin solicitar confirmación individual: Read, Edit, Write, Bash (build, test, dev, kill ports, git, curl, etc.).

---

## Agent Dispatch — OBLIGATORIO

**El main instance NO hace trabajo que pertenezca a un agente.**
Diagnóstico superficial (≤3 reads/greps para confirmar scope) → delegar. El trabajo pesado siempre va al agente.

#### Investigación / búsqueda
| Situación | Acción obligatoria |
|-----------|-------------------|
| Buscar por patrón o keyword en >3 archivos | Lanzar `Explore` |
| Entender cómo funciona una sección del codebase | Lanzar `Explore` — nunca leer 5+ archivos con Read directamente |
| Root cause multi-capa | Lanzar `architect` |

#### Implementación de código
| Situación | Acción obligatoria |
|-----------|-------------------|
| Edit en `packages/web/src/` | `frontend-engineer` |
| Edit en `packages/{api,canonical,signals,scoring,layout,snapshot}/src/` o `server/` | `backend-engineer` |
| Edit en `packages/prediction/` | Agente PE correspondiente (ver tabla PE) |
| Fix trivial de 1 línea (100% claro) | OK hacer directamente |

#### Infraestructura
| Situación | Acción obligatoria |
|-----------|-------------------|
| `.env`, `package.json`, `tsconfig*.json`, CI YAML | `git-ops` |
| Commits de git | `git-ops` |
| CLAUDE.md, MEMORY.md, README.md | `git-ops` |
| Agregar/quitar dependencias | `git-ops` |

**Paralelismo obligatorio:** 2+ tareas independientes → lanzar en paralelo en un solo mensaje.

**Anti-patrón prohibido:**
❌ Main instance investiga exhaustivamente (10+ files, 15 curls) y LUEGO lanza agente para formalizar.
✅ Main instance identifica tipo de tarea → lanza agente correcto de entrada → recibe resultado.

### Sub-agentes definidos (`.claude/agents/`)

Agentes con `model:` en frontmatter usan ESE modelo (no el de la sesión).

**Governance:** SDD Orchestrator · Spec & Version Guardian · QA / Fixture Enforcer

**Implementation** (escriben código SOLO dentro de su paquete):
Canonical Engineer · Signals Engineer · Scoring Policy Engineer · Layout Engineer · Snapshot Engine Engineer · UI API Engineer · Frontend Engineer

### Predictive Engine — Agentes PE (FUENTE PRIMARIA OBLIGATORIA)

**Toda tarea en `packages/prediction/` DEBE usar el agente PE correspondiente.** No usar `backend-engineer` como sustituto.

| Agente PE | Scope primario |
|-----------|---------------|
| `predictive-engine-orchestrator` | Cross-cutting, diseño, handoffs |
| `domain-contracts-agent` | `src/contracts/` — tipos, enums, DTOs, schemas |
| `match-prediction-engine` | Elo, lambdas, Poisson, scoreline matrix, raw-aggregator |
| `calibration-decision-policy` | Calibración, derived-calibrated, decision-policy, metrics |
| `validation-operating-modes` | Validación, modos FULL/LIMITED/NOT_ELIGIBLE, elegibilidad |
| `competition-engine` | Standings, grupos, knockout, bracket |
| `predictive-engine-qa` | Tests de invariantes, conformidad, anti-leakage |
| `predictive-engine-auditor` | Auditorías formales — NO escribe código |

**Routing PE:** fix output shape → `calibration-decision-policy` · fix elegibilidad → `validation-operating-modes` · fix Poisson/Elo → `match-prediction-engine` · tests → `predictive-engine-qa` · auditoría → `predictive-engine-auditor` · cross-cutting → `predictive-engine-orchestrator`

### Auditorías PE — Persistencia obligatoria

Todo resultado de auditoría formal → `docs/audits/PE-audit-YYYY-MM-DD.md`. Contenido obligatorio: dictamen (CONFORMANT / PARTIALLY_CONFORMANT / NON_CONFORMANT), findings con severidad + estado (OPEN/CLOSED), secciones spec verificadas, conteo de tests. Múltiples rondas = secciones en el mismo archivo del día. Sin artefacto = no cuenta como evidencia.

**Append obligatorio cuando:** se agregan tests a `packages/prediction/` · se cierra finding post-audit · se corrige finding sin nueva ronda formal · cambia el conteo de tests.

---

## Project Overview

SportPulse es un **dashboard de atención deportiva snapshot-first**. Transforma datos de fútbol en un treemap determinístico que muestra qué equipos merecen atención y por qué. Pipeline completo: canonical→signals→scoring→layout→snapshot→api→web. Stack: TypeScript (Fastify backend, React/Vite frontend), pnpm workspaces.

**Competitions:** LaLiga (PD), Premier League (PL), Bundesliga (BL1), Liga Uruguaya (TheSportsDB:4432).

**Status:** Fases 0-10 completas + News + Video Highlights + Eventos V1 + Matchday Cache + Back Office + Predictive Engine (PE V3 + NEXUS).

### API endpoints

```
GET /api/ui/dashboard        — treemap + match cards
GET /api/ui/team             — team detail projection
GET /api/ui/standings        — league table
GET /api/ui/competition-info — matchday info
GET /api/ui/news             — news feed por liga
GET /api/ui/videos           — video highlights (YouTube)
GET /api/ui/eventos          — streaming events list
GET /api/ui/eventos/event/:id — single event (provider URL never exposed to client)
```

### server/ composition root

- `server/news/` — NewsService: Tenfield RSS (URU) + RSS directo (LL/EPL/BUN)
- `server/video/` — VideoService: YouTube playlistItems + fallback search
- `server/football-data-source.ts` — football-data.org adapter
- `server/the-sports-db-source.ts` — TheSportsDB adapter (Liga Uruguaya)
- `server/routing-data-source.ts` — composite routing by competitionId
- `server/matchday-cache.ts` — file cache por matchday (spec: `docs/specs/pipeline/spec.sportpulse.server.matchday-cache.md` v1.1)
  - Ruta: `/cache/{provider}/{compId}/{season}/matchday-{NN}[-{KEY}].json`
  - Sub-tournament suffix (v1.1): ligas con `hasSubTournaments=true` → `matchday-NN-KEY.json` (evita conflicto Apertura/Clausura)
  - TTLs: finished=1y, scheduled=6h, live=60s, mixed=5min. Atomic write (.tmp → rename)

### Architecture

```
shared → canonical → signals → scoring → layout → snapshot → api → web
```

| Package | Owns | Must NOT own |
|---------|------|-------------|
| `shared` | Domain primitives, IDs, enums, time utils, error/warning types | IO, scoring, layout, provider logic |
| `canonical` | Provider adapters, canonical models (Team, Match, Competition), normalization | Scoring, layout, snapshot DTOs, UI |
| `signals` | Signal computation from canonical data, normalization [0..1] | Weights, policies, layout, ingestion |
| `scoring` | Policy definitions, weight sets, contributions | Ingestion, normalization, treemap, rendering |
| `layout` | Squarified treemap, rounding, geometry validation | Scoring, signals, snapshot, frontend |
| `snapshot` | Pipeline, caching, fallback, projections | Provider adapters, treemap internals, UI |
| `api` | Validation, routing, response shaping, error envelopes | Scoring, layout, signals, provider calls |
| `web` | Render snapshot DTOs, interactions, theming (Night/Day) | Score computation, treemap solving, provider calls |

### Hard-Forbidden Dependencies

- `web` NEVER imports from `scoring`, `layout`, `signals`, `canonical`
- `api` NEVER imports from `canonical`, `signals`, `scoring`, `layout`
- `layout` NEVER imports from `scoring` or `signals`
- `scoring` NEVER imports canonical ingestion adapters
- Frontend NEVER computes scoring/layout truth or calls provider APIs directly

### Prohibited Legacy Constructs

`SIZE_SCORE` · `PROXIMITY_BONUS` · `HOT_MATCH_SCORE` · `scoreVersion` como identity (usar `policyKey`+`policyVersion`) · client-side treemap solving · UI-derived urgency bonuses · hash-based hidden ordering

### Test Structure

- Tests en `test/` de cada paquete. Golden fixtures en `tools/fixtures/golden/<fixtureId>/`.
- Tests deben mapear a acceptance matrix IDs (A-01 a J-02).
- MVP must-pass: A-01, A-03, B-01, B-04, B-05, C-01, C-02, C-04, D-01, D-02, D-04, D-05, E-01, E-02, E-03, F-01, F-02, F-03, F-04, G-01, G-02, H-01, H-02, H-03, I-01, J-01, J-02

### Frontend Responsive — OBLIGATORIO

Todo código nuevo/modificado en `packages/web` debe ser responsive y funcionar en mobile.

- **Mobile-First con Tailwind CSS.** `style={{}}` inline solo para valores dinámicos de runtime.
- `useWindowWidth()` (`packages/web/src/hooks/use-window-width.ts`) para breakpoint `'mobile'` | `'desktop'`.
- Touch targets ≥ 44px · sin overflow horizontal · toda `<table>` con `overflow-x: auto` en su wrapper.
- Si un componente existente se modifica sin mobile support: agregarlo en el mismo cambio.
- **No hay excepciones:** componente sin soporte mobile no está terminado.

### Back Office

`/admin` — auth via `ADMIN_SECRET`. Config persiste en `cache/portal-config.json` (atomic .tmp→rename). Audit log en `cache/portal-config-audit.jsonl`. Archivos clave: `server/portal-config-store.ts`, `server/admin-router.ts`, `packages/api/src/ui/portal-config-route.ts`, `packages/web/src/admin/AdminPage.tsx`. Mapping centralizado: `packages/web/src/utils/competition-meta.ts`.

### .env keys

```
FOOTBALL_DATA_TOKEN=...    # football-data.org
COMPETITIONS=PD,PL,BL1
PORT=3000
SPORTSDB_API_KEY=123       # TheSportsDB free tier
YOUTUBE_API_KEY=...        # YouTube Data API v3
APIFOOTBALL_KEY=...        # API-Football v3 (dev y prod comparten cuota)
ENABLE_TRAINING_FETCHES=   # off por defecto — activar solo para training fetches
PREDICTION_NEXUS_SHADOW_ENABLED=...
ADMIN_SECRET=...
```
