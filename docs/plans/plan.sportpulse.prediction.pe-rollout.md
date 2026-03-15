# SportPulse — Predictive Engine Rollout Plan
**Version:** 1.0
**Status:** Active
**Input spec:** `SportPulse — Incremental Rollout Plan Update for Predictive Engine v1.0`
**Engine ref:** `SportPulse_Predictive_Engine_Spec_v1.3_Final.md`
**Engine state:** FROZEN / CONFORMANT — `docs/audits/PE-audit-2026-03-10.md`
**Strategy:** Shadow-first · Backend-first · Opt-in exposure

---

## Current State (Baseline)

| Component | Estado |
|-----------|--------|
| `packages/prediction/` | ✅ FROZEN / CONFORMANT — 889 tests |
| `server/prediction/prediction-service.ts` | ✅ Pipeline orchestrator (bootstrapping mode) |
| `GET /api/ui/prediction` | ✅ Endpoint client-driven existente |
| Adaptador automático portal → engine | ❌ No existe |
| Shadow execution server-side | ❌ No existe |
| Persistencia separada de predicciones | ❌ No existe |
| Inspection endpoint/page | ❌ No existe |
| Feature flags por competición | ❌ No existe |

`GET /api/ui/prediction` es client-driven (el frontend pasa todos los parámetros). El shadow mode requiere un trigger server-side automático — son cosas distintas.

---

## Non-Goals (bloqueados explícitamente en todos los stages)

- Reemplazar match cards, map cards, o list views existentes
- Integrar predicciones en todas las competiciones a la vez
- Mezclar outputs experimentales con datos de producción existentes
- Live-mode agresivo en phase 1
- Post-match enrichment más allá de debug/inspection
- Rediseño de product disparado por el engine
- Cualquier expansión sin acceptance gate explícita

---

## Fases y Tareas

### Phase 0 — Freeze Baseline ✅ COMPLETE
*Lock planning inputs. Bloquear semantic drift.*

**Exit criteria cumplidos:**
- Engine spec frozen: `SportPulse_Predictive_Engine_Spec_v1.3_Final.md`
- Audit final: CONFORMANT — `docs/audits/PE-audit-2026-03-10.md`
- Plan actualizado a estrategia shadow-first (este documento)
- No hay tareas de rediseño semántico abiertas

---

### Phase 1 — Shadow Execution
*Ejecutar el engine sobre partidos reales sin afectar el portal actual.*

**Milestone A exit:** predicciones generadas para partidos seleccionados · sin cambios de comportamiento público · fallos logueados e inspeccionables

#### Tarea PE-71: Input Adapter — portal Match domain → MatchInput

**Qué hace:** Convierte un `Match` canónico del portal en el `MatchInput` que requiere el engine. Incluye mapping de `competition_id`, derivación de `CompetitionProfile` (team_domain, competition_family, stage_type, format_type, leg_type), y construcción de `historical_context` desde los datos de estadísticas del partido.

**Prioridad:** P0 — bloquea todo lo demás

**Archivos afectados:**
- `server/prediction/match-input-adapter.ts` (nuevo)
- `server/prediction/prediction-service.ts` (consume el adapter)

**Restricciones:**
- El adapter NO debe lanzar excepciones que propaguen al portal
- Input inválido → resultado `NOT_ELIGIBLE` con razón, no throw
- El adapter debe ser determinístico: mismo Match → mismo MatchInput

**Dependencias:** ninguna

**Tier:** Sonnet · Agente: `backend-engineer`

---

#### Tarea PE-72: Shadow Pipeline — ejecución automática out-of-band

**Qué hace:** Hook en el ciclo de refresco del portal que ejecuta predicciones automáticamente para cada partido elegible, fuera del path de respuesta pública. La predicción es async, no bloquea el response del portal. Los errores del prediction pipeline se loguean y no se propagan.

**Prioridad:** P0

**Archivos afectados:**
- `server/prediction/shadow-runner.ts` (nuevo)
- `server/index.ts` (integrar shadow-runner en el ciclo de refresh)

**Restricciones:**
- Fault-isolated: cualquier error en el pipeline de predicción debe ser capturado y logueado — nunca propagado al portal
- No modificar los paths de respuesta existentes (`/api/ui/dashboard`, `/api/ui/team`, etc.)
- Activable por feature flag `PREDICTION_SHADOW_ENABLED` (env var)

**Competición inicial:** LaLiga (PD) — mayor volumen de datos históricos en el portal

**Dependencias:** PE-71 (adapter), PE-73 (persistencia para guardar resultado)

**Tier:** Sonnet · Agente: `backend-engineer`

---

#### Tarea PE-73: Separate Persistence — prediction_snapshot store

**Qué hace:** Almacenamiento dedicado para outputs del engine. Aislado de las estructuras de producción del portal. Implementación inicial: in-memory store con serialización a archivo JSON (sin base de datos — consistente con el enfoque file-based del proyecto).

**Prioridad:** P0

**Storage mínimo por entrada:**
```
match_id, competition_id, generated_at, engine_version (= '1.3'),
spec_version, request_payload_json, response_payload_json,
mode, calibration_mode, reasons_json, degradation_flags_json,
generation_status ('ok' | 'error'), error_detail?
```

**Archivos afectados:**
- `server/prediction/prediction-store.ts` (nuevo)
- `server/prediction/prediction-service.ts` (integrar store)

**Restricciones:**
- No tocar estructuras de datos de portal existentes
- Múltiples runs sobre el mismo match → distinguibles por `generated_at`
- El store debe ser accesible desde el inspection endpoint (PE-74)

**Dependencias:** ninguna (puede desarrollarse en paralelo con PE-71/72)

**Tier:** Sonnet · Agente: `backend-engineer`

---

#### Tarea PE-74: Feature Flag Infrastructure

**Qué hace:** Flags simples por competición y superficie, configurables por env vars.

**Flags requeridos:**
```
PREDICTION_SHADOW_ENABLED=PD         # competiciones en shadow mode
PREDICTION_INTERNAL_VIEW_ENABLED=PD  # competiciones en inspection view
PREDICTION_EXPERIMENTAL_ENABLED=     # vacío por defecto = ninguna
```

**Archivos afectados:**
- `server/prediction/prediction-flags.ts` (nuevo — 30 líneas máximo)

**Restricciones:**
- Sin UI de administración — env vars son suficientes para esta fase
- Cualquier experimental UI debe depender del flag, no de code removal

**Dependencias:** ninguna

**Tier:** Haiku · Agente: `backend-engineer`

---

### Phase 2 — Internal Inspection Surface
*Inspección rápida de outputs sin exposición pública.*

**Milestone B exit:** cualquier predicción generada puede inspeccionarse por match · mode/reasons/degradations visibles · main probs y expected goals visibles

#### Tarea PE-75: Inspection Endpoint

**Qué hace:** `GET /api/internal/predictions` — endpoint de solo lectura para inspeccionar predicciones almacenadas. No en navegación pública.

**Query params:**
- `?matchId=` — inspeccionar un partido específico
- `?competitionId=` — listar predicciones recientes de una competición
- `?limit=` — máximo de resultados (default 20)

**Response mínimo (P1 fields):**
```
match_id, competition_id, teams, kickoff_utc,
generated_at, engine_version, generation_status,
mode, calibration_mode, reasons,
p_home_win, p_draw, p_away_win,
predicted_result, expected_goals_home, expected_goals_away,
degradation_notes
```

**Response extendido (collapsible):**
```
full request_payload_json, full response_payload_json, internals
```

**Restricciones:**
- No aparece en public API docs
- No require auth compleja — suficiente con ruta no listada + env flag

**Dependencias:** PE-72, PE-73

**Tier:** Sonnet · Agente: `backend-engineer`

---

#### Tarea PE-76: Inspection Page (Labs/Admin)

**Qué hace:** Página interna `/labs/predicciones` (no en navbar pública). Tabla de predicciones recientes por competición. Click en fila → panel expandido con todos los campos del PE-75.

**Campos P1 en tabla:** match, equipos, kickoff, mode, reasons, p_home/draw/away, predicted_result, expected_goals, generated_at

**Campos P2 en panel expandido:** favorite_margin, draw_risk, degradation indicators, calibration_mode, full payload colapsable

**Restricciones:**
- No aparece en navegación pública
- No polished — es diagnóstico, no producto
- Desactivado si `PREDICTION_INTERNAL_VIEW_ENABLED` está vacío

**Dependencias:** PE-75

**Tier:** Sonnet · Agente: `frontend-engineer`

---

### Phase 3 — Limited Validation
*Validar en una competición antes de cualquier exposición pública.*

**Milestone C exit:** competición seleccionada se comporta consistentemente · casos degradados diagnosticables · sin bloqueantes en adapter o persistencia

#### Tarea PE-77: Controlled Validation — LaLiga (PD)

**No es una tarea de código.** Es una sesión de inspección estructurada:

1. Activar shadow mode para PD (`PREDICTION_SHADOW_ENABLED=PD`)
2. Esperar al menos un ciclo de refresco con partidos
3. Abrir la inspection page (`/labs/predicciones`)
4. Verificar:
   - Mode distribution esperada (FULL_MODE cuando hay histórico, LIMITED_MODE cuando no)
   - Degradation cases comprensibles
   - No errores silenciosos en generation_status
   - request_payload tiene los campos correctos del adapter
   - response_payload es coherente con mode
5. Documentar findings en `docs/audits/PE-validation-PD-YYYY-MM-DD.md`

**Exit gate:** ningún blocker abierto en adapter o persistencia antes de avanzar a Phase 4

**Dependencias:** PE-75, PE-76 operativos

---

### Phase 4 — Experimental Exposure (DEFERRED)
*Solo después de Milestone C explícitamente aprobado.*

#### Tarea PE-78: Feature-Flagged Prediction Section en Match Detail

**Qué hace:** Sección experimental en el detail view del partido (bajo `PREDICTION_EXPERIMENTAL_ENABLED`). Muestra: predicted_result, 1X2 probs, expected goals, nota de estado/degradación si LIMITED_MODE.

**Restricciones:**
- Solo en `DetailPanel` — no en match cards, no en mapa, no en lista
- El portal público debe permanecer idéntico cuando el flag está off
- Estados degradados representados honestamente (no como calibrated full outputs)
- Instant-disable via flag

**Dependencias:** Milestone C aprobado, PE-74

**Tier:** Sonnet · Agente: `frontend-engineer`

---

### Phase 5 — Controlled Expansion (DEFERRED)
*Solo después de Milestone D explícitamente aprobado.*

Orden de expansión (según §7.7 del spec):
1. Una competición → más competiciones
2. Inspection interna → detail experimental
3. Pre-match only → soporte de más estados
4. Core outputs → secondary outputs
5. Vista aislada → superficies adicionales

**Cada paso requiere acceptance gate documentado.**

---

## Resumen de Tareas — Prioridad y Orden

| # | Tarea | Phase | Prioridad | Dep | Tier | Agente |
|---|-------|-------|-----------|-----|------|--------|
| PE-71 | Input Adapter | 1 | P0 | — | Sonnet | backend-engineer |
| PE-73 | Prediction Store | 1 | P0 | — | Sonnet | backend-engineer |
| PE-74 | Feature Flags | 1 | P0 | — | Haiku | backend-engineer |
| PE-72 | Shadow Pipeline | 1 | P0 | 71, 73 | Sonnet | backend-engineer |
| PE-75 | Inspection Endpoint | 2 | P0 | 72, 73 | Sonnet | backend-engineer |
| PE-76 | Inspection Page | 2 | P1 | 75 | Sonnet | frontend-engineer |
| PE-77 | Validation PD | 3 | P1 | 75, 76 | — | manual |
| PE-78 | Experimental Detail | 4 | P2 | Milestone C | Sonnet | frontend-engineer |
| PE-7X | Expansion | 5 | P3 | Milestone D | — | TBD |

**Paralelas en Phase 1:** PE-71, PE-73, PE-74 pueden desarrollarse simultáneamente.
**PE-72** espera PE-71 y PE-73.

---

## Milestones y Exit Criteria

### Milestone A — Shadow Ready
- [ ] Adapter convierte Match canónico → MatchInput sin errores
- [ ] Shadow pipeline ejecuta predicciones out-of-band para PD
- [ ] Resultados almacenados en prediction_store con todos los campos requeridos
- [ ] Cero cambios en comportamiento del portal existente
- [ ] Fallos del pipeline logueados, no propagados

### Milestone B — Internally Inspectable
- [ ] GET /api/internal/predictions retorna resultados por matchId y competitionId
- [ ] Inspection page muestra mode, reasons, calibration_mode, 1X2 probs, expected goals
- [ ] Casos degradados (LIMITED_MODE, NOT_ELIGIBLE) visibles y diagnosticables
- [ ] Sin necesidad de leer logs para inspeccionar un partido

### Milestone C — Validated on PD
- [ ] Sesión de validación completada y documentada en `docs/audits/`
- [ ] Mode distribution coherente con datos históricos disponibles
- [ ] Degradation cases comprensibles y no engañosos
- [ ] Ningún blocker abierto en adapter o persistencia

### Milestone D — Experimental Detail Exposure
- [ ] Sección experimental funciona sin romper el detail page existente
- [ ] Toggle on/off limpio via flag
- [ ] Estados degradados representados honestamente

### Milestone E — Expansion Eligible
- [ ] Evidencia documentada de que A-D son estables
- [ ] Aprobación explícita para wider rollout

---

## Riesgos y Controles

| Riesgo | Control |
|--------|---------|
| Romper el portal existente | Shadow-only + persistencia separada antes de cualquier exposición |
| Confusión experimental vs producción | Storage dedicado + superficie de inspección aislada |
| Incapacidad de diagnosticar outputs degradados | Exponer mode, reasons, calibration_mode, degradations en internal view |
| Scope explosion | Phase gates estrictos + deferred list explícito |
| Adapter corrompe inputs silenciosamente | Guardar request_payload_json en store + validar vs fixtures conocidos |

---

## Nota sobre bootstrapping mode

`PredictionService` opera con Elo base 1500 para todos los equipos hasta que el rating pool esté conectado. Esto es esperado y declarado (`calibration_mode: 'bootstrap'` en cada response). Los outputs serán válidos pero con menor precisión hasta que haya datos históricos reales de Elo. No bloquea ninguna fase de este rollout.
