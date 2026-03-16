---
artifact_id: ADR-SPORTPULSE-PREDICTION-PE-V2-PRODUCTION-AUTHORIZATION
title: "Predictive Engine V2 Production Authorization"
artifact_class: adr
status: superseded
version: 1.0.0
project: sportpulse
domain: prediction
slug: pe-v2-production-authorization
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: ['SPEC-SPORTPULSE-PREDICTION-ENGINE']
related_artifacts: []
canonical_path: docs/specs/adr.sportpulse.prediction.pe-v2-production-authorization.md
---
# SP-PRED-V2 — Motor Predictivo V2: Autorización de Producción y Trazabilidad de Engine

**Estado:** AUTORIZADO — pendiente de implementación
**Fecha:** 2026-03-15
**Autoridad:** SportPulse_Constitution_v2.0_Master.md §
**Versión:** 1.0

---

## 1. Objetivo

Autorizar el Motor Predictivo V2 (`v2_structural_attack_defense`) para ejecución en producción en modo **parallel-shadow**, corriendo simultáneamente con V1 (`v1_elo_poisson`) sin reemplazarlo. Cada predicción almacenada debe identificar de forma inequívoca qué engine la generó, permitiendo comparación y evaluación de performance entre motores.

---

## 2. Motivación

### 2.1 Por qué V2 en producción

El Motor V2 implementa un modelo estructural de ataque/defensa con Bayesian shrinkage (§MOTOR_PREDICTIVO_V2_SPEC_FINAL_CONGELADA.md). A diferencia de V1 (Elo + Poisson con home advantage fijo), V2:

- Usa tasas observadas de ataque/defensa por equipo (no ranking global)
- Incorpora prior de temporada anterior con shrinkage dinámico
- Ajusta por rival (calidad del oponente en cada partido)
- Modela recencia como delta sobre la media (no como goles crudos recientes)
- No usa Elo en ningún paso del pipeline

El V2 tiene 46+ tests y fue implementado según spec. Sin embargo, **nunca ha corrido en producción** — sus predicciones no se han comparado contra resultados reales.

### 2.2 Por qué parallel-shadow y no reemplazo

V1 es el engine primario activo. Reemplazarlo sin datos de performance sería una regresión de calidad no verificada. El objetivo de esta fase es recolectar predicciones V1 y V2 para los mismos partidos, esperar a que esos partidos terminen, y evaluar cuál modelo predice mejor.

**V1 sigue siendo el engine que alimenta el portal** hasta que los datos justifiquen cambiar.

---

## 3. Estado Actual (Pre-Spec → Post-Implementación)

| Componente | Estado |
|---|---|
| `packages/prediction/src/engine/v2/` | IMPLEMENTADO — 46+ tests |
| `server/prediction/v2-prediction-store.ts` | IMPLEMENTADO — store separado en `cache/v2-predictions.json` |
| `server/prediction/v2-runner.ts` | IMPLEMENTADO — V2 shadow wired en index.ts, usa `HistoricalStateService` |
| `engine_id` en `PredictionSnapshot` | **CORREGIDO (2026-03-15)** — campo añadido, default retroactivo `'v1_elo_poisson'` |
| `buildSnapshot()` con `engineId` param | **CORREGIDO (2026-03-15)** — param opcional, default `'v1_elo_poisson'` |
| V2 en runRefresh / shadow pipeline | **YA CONECTADO** — `runV2Shadow` en index.ts línea 632, usa `PREDICTION_V2_SHADOW_ENABLED` flag |
| Endpoint de comparación V1 vs V2 | **IMPLEMENTADO (2026-03-15)** — `GET /api/ui/predictions/compare?matchId=` |

> **Nota:** V2 ya estaba wired en producción via `v2-runner.ts` + `HistoricalStateService` (usa historical data de football-data.org). El env flag que controla V2 es `PREDICTION_V2_SHADOW_ENABLED` (definido en `prediction-flags.ts`).

### 3.1 Bug crítico de trazabilidad

`PredictionStore.buildSnapshot()` hardcodea:

```typescript
const ENGINE_VERSION = '1.3';  // Esto es la versión del spec, no el engine
const SPEC_VERSION = '1.3';
```

Como resultado, todos los snapshots almacenados tienen `engine_version: '1.3'`, que es ambiguo y no identifica el algoritmo subyacente. Cuando V2 también almacene predicciones, esta ambigüedad imposibilita distinguir qué engine generó cada predicción.

---

## 4. Cambios al Schema de PredictionSnapshot

### 4.1 Campo `engine_id` (nuevo, obligatorio)

Agregar el campo `engine_id` a `PredictionSnapshot`:

```typescript
export interface PredictionSnapshot {
  // ... campos existentes ...

  /**
   * Identificador estable del algoritmo de predicción que generó este snapshot.
   * Valores válidos: 'v1_elo_poisson' | 'v2_structural_attack_defense'
   * Este campo es la fuente de verdad para distinguir engines en análisis posteriores.
   */
  engine_id: 'v1_elo_poisson' | 'v2_structural_attack_defense';

  /**
   * Versión del spec bajo la que fue generado (e.g. '1.3').
   * Mantener separado de engine_id.
   */
  spec_version: string;  // ya existe, mantener
}
```

### 4.2 Corrección de `engine_version` existente

El campo `engine_version` existente en `PredictionSnapshot` debe ser reemplazado en semántica:

- **Antes:** `engine_version: '1.3'` (spec version — confuso)
- **Después:** `engine_version: '1.3'` se mantiene para compatibilidad retrospectiva con snapshots ya almacenados, pero el campo primario para discriminar engines es `engine_id`

Para snapshots generados por V1: `engine_id = 'v1_elo_poisson'`
Para snapshots generados por V2: `engine_id = 'v2_structural_attack_defense'`

### 4.3 `buildSnapshot()` actualizado

```typescript
export function buildSnapshot(
  matchId: string,
  competitionId: string,
  requestPayload: unknown,
  response: unknown,
  engineId: 'v1_elo_poisson' | 'v2_structural_attack_defense' = 'v1_elo_poisson',
): PredictionSnapshot {
  // ... lógica existente ...
  return {
    // ... campos existentes ...
    engine_id: engineId,
  };
}
```

El parámetro `engineId` tiene default `'v1_elo_poisson'` para preservar el comportamiento del shadow runner V1 existente sin cambios.

---

## 5. V2 Shadow Runner

### 5.1 Env flag

```
PREDICTION_V2_SHADOW_ENABLED=comp:football-data:PD,comp:football-data:PL
```

Formato idéntico a los flags V1 existentes. Procesado por `prediction-flags.ts`.

### 5.2 Función `runShadowV2()`

Nuevo archivo: `server/prediction/shadow-runner-v2.ts`

**Input requerido por V2:** a diferencia de V1 (que necesita `MatchInput` con prior_rating e historial de matches), V2 necesita:
- `currentSeasonMatches: V2MatchRecord[]` — todos los partidos jugados de la temporada actual (pre-kickoff del partido objetivo)
- `prevSeasonMatches: V2MatchRecord[]` — todos los partidos de la temporada anterior (completa)
- `homeTeamId`, `awayTeamId`, `kickoffUtc`

**Adaptación desde canonical:**

```typescript
// V2MatchRecord shape esperado:
interface V2MatchRecord {
  homeTeamId: string;
  awayTeamId: string;
  homeGoals: number;
  awayGoals: number;
  utcDate: string;  // ISO-8601
}
```

Los partidos canónicos con `status === 'FINISHED'` y `scoreHome !== null` son mapeables directamente.

### 5.3 Lógica del runner V2

```
Para cada competitionId con V2 shadow habilitado:
  1. Obtener matches del dataSource (season actual)
  2. Separar: finishedCurrentSeason, scheduledMatches
  3. Intentar obtener prevSeasonMatches si el dataSource lo soporta
  4. Para cada partido SCHEDULED con kickoff futuro:
     a. Construir V2EngineInput con currentSeasonMatches filtrados (< kickoffUtc)
     b. Llamar runV2Engine(input)
     c. Construir V2StoredPrediction con engine_id='v2_structural_attack_defense'
     d. Guardar en V2PredictionStore (ya existe)
  5. Persist V2PredictionStore
```

### 5.4 Temporada anterior

El dataSource actual (`football-data.org`, `TheSportsDB`) no expone directamente la temporada anterior en un solo call. Approach:

- Si hay datos de temporada anterior disponibles en cache → usarlos
- Si no → pasar `prevSeasonMatches: []` (V2 manejará el fallback a league baseline per §6 del V2 spec)
- **No bloquear** la ejecución V2 por ausencia de datos de temporada anterior

---

## 6. Unificación de Stores (V2 → PredictionStore)

### 6.1 Problema actual

`V2PredictionStore` y `PredictionStore` son estructuras separadas con esquemas diferentes. Esto impide la comparación cross-engine en un solo query.

### 6.2 Solución

**Opción elegida: V2 usa el mismo `PredictionStore`**, discriminado por `engine_id`.

El `V2PredictionStore` existente en `cache/v2-predictions.json` se migra al store unificado en `cache/predictions/snapshots.json`. Ambos engines escriben en el mismo store, distinguidos por `engine_id`.

**Ventajas:**
- Un solo archivo de cache
- Queries unificadas por `findByMatch(matchId)` retornan tanto V1 como V2
- El comparison endpoint es trivial

**Migración:** `V2PredictionStore` se puede deprecar (marcar DEPRECATED) y el shadow runner V2 escribirá a `PredictionStore` con `engine_id='v2_structural_attack_defense'`.

---

## 7. Comparison Endpoint

### 7.1 Ruta

```
GET /api/ui/predictions/compare?matchId=<matchId>
```

### 7.2 Respuesta

```typescript
interface PredictionCompareResponse {
  matchId: string;
  v1: CompareEntry | null;
  v2: CompareEntry | null;
}

interface CompareEntry {
  engine_id: string;
  generated_at: string;
  mode: string;  // FULL_MODE / LIMITED_MODE / NOT_ELIGIBLE
  prob_home: number | null;
  prob_draw: number | null;
  prob_away: number | null;
  predicted_result: string | null;  // HOME_WIN / DRAW / AWAY_WIN / null
  confidence: string | null;        // de V2: HIGH/MEDIUM/LOW/INSUFFICIENT
  eligibility: string | null;       // de V2: ELIGIBLE / NOT_ELIGIBLE / etc.
  lambda_home: number | null;
  lambda_away: number | null;
}
```

### 7.3 Extracción de campos V2

Los campos V2 (`confidence_level`, `eligibility_status`, `lambda_home`, `lambda_away`) están en `response_payload_json`. El endpoint los extrae del JSON almacenado.

### 7.4 Autorización

El endpoint está gateado por `features.predictions` del portal config (mismo gate que `/api/ui/radar`).

---

## 8. Integración con runRefresh()

```typescript
// En server/server.ts o donde se llame runRefresh():
import { runShadowV2 } from './prediction/shadow-runner-v2.js';

// Después de runShadow() V1:
await runShadowV2(dataSource, competitionIds, predictionStore);
```

Ambos runners son fire-and-forget. El runner V2 no bloquea el pipeline principal.

---

## 9. Invariantes del Modo Parallel-Shadow

1. **V1 es el engine primario**: el portal muestra predicciones V1. V2 no reemplaza la UI.
2. **V2 no bloquea**: si V2 falla, el portal sigue funcionando. Fault isolation garantizado.
3. **No hay leakage cruzado**: V1 y V2 son funciones puras sin estado compartido.
4. **Engine tracing es inmutable**: `engine_id` se escribe al momento de generación y nunca se modifica.
5. **Anti-lookahead**: V2 filtra `utcDate < kickoffUtc` internamente (`v2-engine.ts` línea 140). El runner V2 no necesita filtrar adicionalmente.

---

## 10. Criterios de Rollout (cuándo V2 puede ser primario)

V2 puede pasar a ser el engine primario del portal cuando se cumplan **todos** estos criterios:

| Criterio | Umbral |
|---|---|
| Partidos evaluados con resultado real | ≥ 30 partidos por competición |
| Brier Score V2 < Brier Score V1 | En al menos 2 de 3 competiciones habilitadas |
| Log Loss V2 ≤ Log Loss V1 + 0.02 | (tolerancia de 2% para evitar falsos positivos) |
| Zero crashes en producción V2 | 0 errores no manejados en 30 días |
| Draw rate coverage | V2 draw rate predicha dentro de ±5% de draw rate real |

El rollout es decisión manual del equipo basada en estos datos. No es automático.

---

## 11. Env Flags (resumen)

```bash
# V1 shadow (ya existente)
PREDICTION_SHADOW_ENABLED=comp:football-data:PD
PREDICTION_INTERNAL_VIEW_ENABLED=comp:football-data:PD
PREDICTION_EXPERIMENTAL_ENABLED=comp:football-data:PD

# V2 shadow (nuevo)
PREDICTION_V2_SHADOW_ENABLED=comp:football-data:PD
```

---

## 12. Archivos a Crear / Modificar

| Archivo | Acción | Descripción |
|---|---|---|
| `server/prediction/prediction-store.ts` | Modificar | Agregar `engine_id` a `PredictionSnapshot`; actualizar `buildSnapshot()` |
| `server/prediction/shadow-runner-v2.ts` | Crear | V2 shadow runner independiente |
| `server/prediction/prediction-flags.ts` | Modificar | Agregar `isV2ShadowEnabled()` |
| `server/prediction/v2-prediction-store.ts` | Deprecar | Marcar como DEPRECATED; V2 migra al store unificado |
| `packages/api/src/ui/prediction-route.ts` | Modificar | Agregar endpoint `/compare` |
| `server/server.ts` (o composition root) | Modificar | Wire `runShadowV2()` en refresh loop |

---

## 13. Tareas de Implementación (Fix Plan)

### SP-PRED-V2-T1: Engine tracing en PredictionStore
- Agregar `engine_id` a `PredictionSnapshot`
- Actualizar `buildSnapshot()` con parámetro `engineId`
- Actualizar `shadow-runner.ts` para pasar `'v1_elo_poisson'`

### SP-PRED-V2-T2: V2 shadow runner
- Crear `server/prediction/shadow-runner-v2.ts`
- Agregar `isV2ShadowEnabled()` en `prediction-flags.ts`
- Adaptar matches canónicos a `V2MatchRecord[]`
- Wire en el refresh loop

### SP-PRED-V2-T3: Comparison endpoint
- Agregar `GET /api/ui/predictions/compare?matchId=`
- Parsear `response_payload_json` para extraer campos V2
- Gate por `features.predictions`

### SP-PRED-V2-T4: Deprecar V2PredictionStore
- Marcar `v2-prediction-store.ts` como DEPRECATED
- Migrar datos existentes al store unificado (si hay datos en `cache/v2-predictions.json`)

---

## 14. Consideraciones de Migración

Los snapshots existentes en `cache/predictions/snapshots.json` no tienen campo `engine_id`. Al cargar el store, se les asigna retroactivamente `engine_id: 'v1_elo_poisson'` (default seguro — todos los snapshots existentes fueron generados por V1).

```typescript
// En _loadFromFile():
for (const snapshot of doc.snapshots) {
  if (!snapshot.engine_id) {
    snapshot.engine_id = 'v1_elo_poisson';  // retroactive default
  }
}
```

---

*Spec autorizado por el usuario el 2026-03-15. Implementar en orden: T1 → T2 → T3 → T4.*
