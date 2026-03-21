---
artifact_id: SPEC-SPORTPULSE-EXECUTION-PLAN-BACKEND-FRONTEND-GAP-CLOSURE
artifact_class: plan
status: draft
version: 0.1.0
project: sportpulse
domain: execution
slug: backend-frontend-gap-closure
owner: team
created_at: 2026-03-21
updated_at: 2026-03-21
---

# SportPulse — Plan de ejecución para cierre del gap backend↔frontend

## 1. Objetivo

Cerrar de forma controlada el gap entre la reingeniería del frontend y las superficies backend necesarias para soportarla, evitando:

- contratos implícitos,
- implementación en paralelo sin verdad compartida,
- QA validando una versión vieja del producto,
- y despliegues donde el frontend quede “bonito” pero funcionalmente incompleto.

## 2. Resultado buscado

Al terminar este plan, el proyecto debe tener:

1. contratos backend absorbidos en el corpus técnico activo,
2. frontend ejecutado contra contratos explícitos,
3. acceptance y fixtures alineados con la realidad del producto,
4. una secuencia de implementación que permita progreso paralelo sin contradicciones,
5. gates objetivos para decidir merge, integración y release.

## 3. Principios operativos

1. No implementar contra drafts conversacionales.
2. No abrir trabajo de checkout antes de cerrar session/auth.
3. No declarar “frontend listo” hasta que K-04..K-08 sean testeables.
4. No tocar theming/config como excusa para posponer flujos críticos.
5. No permitir que frontend invente verdad de negocio.
6. No permitir que backend entregue contratos no versionados o no documentados.

## 4. Inputs ya producidos

Este plan asume como paquete de trabajo existente:

- `spec.sportpulse.backend.frontend-integration-delta.md`
- `spec.sportpulse.backend.session-auth-contract.md`
- `spec.sportpulse.backend.shared-return-context-contract.md`
- `spec.sportpulse.backend.subscription-checkout-contract.md`
- `spec.sportpulse.backend.track-record-contract.md`
- `spec.sportpulse.qa.acceptance-gap-closure-update.md`
- `spec.sportpulse.qa.prediction-track-record-fixtures.md` (corregido)

## 5. Fases de ejecución

### Fase 0 — Freeze documental y baseline de trabajo

**Objetivo**
Congelar el paquete documental mínimo y evitar que se siga implementando contra supuestos viejos.

**Acciones**
- Declarar el paquete delta como referencia obligatoria del workstream.
- Marcar explícitamente qué docs viejos no deben guiar implementación frontend/backend en este frente.
- Abrir branch o carpeta de integración documental separada del desarrollo de features.
- Definir responsables por bloque: BE, FE, QA, reviewer.

**Owner principal**
Product/arquitectura técnica.

**Salida obligatoria**
- listado de docs fuente,
- listado de docs que deben absorber cambios,
- responsables asignados,
- freeze explícito de alcance v1.

**Gate para salir**
Nadie puede decir “yo entendí otra cosa”.

---

### Fase 1 — Absorción en corpus técnico activo

**Objetivo**
Mover la lógica crítica desde el delta package hacia los documentos activos que la constitución ya reconoce como canónicos.

**Acciones**
- Absorber session/auth, subscription/checkout y track record en:
  - `spec.sportpulse.api.contract.md`
  - `spec.sportpulse.server.backend-architecture.md`
- Mantener el delta package como documento índice/transición, no como sustituto eterno.
- Verificar que `repo-structure`, `implementation-backlog`, `acceptance-test-matrix` y `prediction-track-record-fixtures` queden cruzados correctamente.
- Resolver cualquier naming drift entre DTOs, errores y endpoints.

**Owner principal**
Backend lead + architecture reviewer.

**Dependencias**
Fase 0 cerrada.

**Salida obligatoria**
- endpoints y payloads integrados en `api.contract`,
- responsabilidades y boundaries integradas en `backend-architecture`,
- references cruzadas corregidas.

**Gate para salir**
No debe quedar ningún endpoint crítico “solo en un draft lateral”.

---

### Fase 2 — Backend core implementation

**Objetivo**
Implementar la verdad backend mínima para que frontend deje de vivir sobre mocks ambiguos.

**Secuencia obligatoria**
1. `GET /api/session`
2. `POST /api/auth/magic-link/start`
3. `POST /api/auth/magic-link/complete`
4. `POST /api/logout`
5. `GET /api/ui/track-record`
6. `POST /api/checkout/session`
7. `GET /api/subscription/status`
8. `POST /api/checkout/return/reconcile`
9. `POST /api/subscription/refresh-entitlement`

**Acciones**
- Implementar contratos con error envelope canónico.
- Implementar reglas de fail-closed para Pro depth.
- Implementar recovery de `checkout return` con sesión perdida según el contrato acordado.
- Alinear classification de `commercial ad` / `operational notice` / `system warning` para que K-07 sea verificable.

**Owner principal**
Backend.

**Dependencias**
Fase 1 cerrada.

**Salida obligatoria**
- endpoints funcionales en entorno de desarrollo,
- tests de contrato backend,
- errores canónicos estables,
- fixtures mínimas para happy path y failure path.

**Gate para salir**
Frontend ya no necesita inventar payloads ni estados de error.

---

### Fase 3 — Frontend foundations y trust surface

**Objetivo**
Quitar deuda estructural antes de tocar el funnel comercial completo.

**Acciones**
- Ejecutar Stream 1 del frontend backlog: API client, shell, rutas, context model, state model.
- Ejecutar Stream 2: route pública de track record, estados `loading/empty/below-threshold/available/unavailable`, disclosure de walk-forward cuando aplique.
- Integrar `/:competitionId/track-record` como superficie pública real.

**Owner principal**
Frontend.

**Dependencias**
- Parte de Fase 2 lista para `track-record`
- route model y shell aprobados.

**Salida obligatoria**
- navegación estable,
- track record público visible,
- sin auth requerida,
- sin regresión en dashboard/predicciones públicas.

**Gate para salir**
K-03 debe ser testeable de punta a punta.

---

### Fase 4 — Auth/session integration

**Objetivo**
Introducir identidad de forma tardía, coherente y sin romper el uso anónimo.

**Acciones**
- Implementar `AuthContext` o equivalente con una sola fuente de verdad para sesión.
- Hydration inicial desde `GET /api/session`.
- Integración de `/auth/callback`.
- Restauración de `returnContext` después de auth.
- Manejo explícito de `anonymous | loading | authenticated | expired`.

**Owner principal**
Frontend + Backend.

**Dependencias**
Session/Auth API implementada.

**Salida obligatoria**
- no hay prompt de auth en primera visita,
- auth solo entra por shell action o intento Pro-gated,
- sesión no deja flashes de Pro indebidos,
- logout y expired no dejan UI colgada.

**Gate para salir**
K-06 debe ser testeable y estable.

---

### Fase 5 — Subscription / checkout / Pro behavior

**Objetivo**
Cerrar el funnel comercial sin contradecir el contrato free/public.

**Acciones**
- Implementar paywall inline/contextual, no route-level wall.
- Integrar checkout handoff.
- Integrar `/checkout/return`.
- Implementar entitlement refresh en misma sesión.
- Implementar fallback `verificando suscripción`.
- Implementar supresión de ads comerciales para Pro sin romper notices operativos.

**Owner principal**
Frontend + Backend.

**Dependencias**
Fase 4 cerrada.

**Salida obligatoria**
- usuario free ve 1X2 y CTA Pro en depth,
- usuario Pro ve depth sin fricción,
- post-checkout desbloquea en misma sesión,
- ad suppression funciona por clasificación semántica.

**Gate para salir**
K-04, K-05 y K-07 deben pasar con evidencia automatizable.

---

### Fase 6 — QA de integración y hardening

**Objetivo**
Evitar que la implementación “funcione en demo” pero no en producto real.

**Acciones**
- Contract tests backend por endpoint nuevo.
- UI integration tests para:
  - anonymous first visit,
  - intent-triggered auth,
  - non-Pro paywall,
  - Pro unlocked depth,
  - checkout return,
  - lost-session recovery,
  - track record threshold/disclosure,
  - K-07 ad suppression.
- Smoke tests responsive sobre shell, track record, predicciones, Pro, cuenta/auth.
- Revisar regresión de warnings/degraded-state y que Pro no los suprima.

**Owner principal**
QA + FE + BE reviewer.

**Dependencias**
Fases 3, 4 y 5 cerradas.

**Salida obligatoria**
- suite mínima verde,
- issues remanentes clasificados por severidad,
- lista cerrada de launch blockers.

**Gate para salir**
No hay blockers abiertos en K-03..K-08.

---

### Fase 7 — Release readiness

**Objetivo**
Tomar una decisión seria de salida, no una autocelebración.

**Acciones**
- Ejecutar checklist final contra acceptance activa.
- Verificar que los contratos backend absorbidos coincidan con lo implementado.
- Verificar que docs proposed no contradigan al corpus activo.
- Congelar scope y cortar todo lo que no sea launch-critical.

**Owner principal**
Tech lead / product owner.

**Salida obligatoria**
- decisión explícita: release / no release,
- riesgos aceptados documentados,
- backlog post-launch separado.

**Gate para salir**
El producto pasa de “promesa” a “release candidate” con criterios verificables.

## 6. Orden real de implementación

### Trabajo secuencial crítico
1. Absorción en corpus activo
2. Session/Auth backend
3. Track record backend
4. Frontend shell/routing + track record
5. Frontend auth/session
6. Checkout/subscription backend
7. Frontend paywall/checkout/pro behavior
8. QA integrada

### Trabajo paralelizable
- FE foundations puede arrancar mientras BE absorbe contratos.
- QA puede preparar harness y casos antes de que todos los endpoints existan.
- Design-system / responsive hardening puede avanzar, pero no debe bloquear session/checkout.

## 7. RACI simple

| Bloque | Responsable primario | Co-responsable | Revisor |
|---|---|---|---|
| Absorción en `api.contract` y `backend-architecture` | Backend/Arquitectura | Product | Reviewer técnico |
| Session/Auth API | Backend | Frontend | QA + reviewer |
| Track Record API | Backend | Frontend | QA |
| Shell/routing/foundations | Frontend | Product | Reviewer FE |
| Auth/session frontend | Frontend | Backend | QA |
| Subscription/checkout | Backend + Frontend | Ops | Reviewer técnico |
| Acceptance/fixtures/tests | QA | FE + BE | Product |

## 8. Riesgos que te pueden desordenar todo

1. **Implementar checkout antes de session/auth estable**
   Resultado: flujo comercial inconsistente y rehidratación rota.

2. **Querer cerrar diseño visual antes de los contratos**
   Resultado: UI linda atada a supuestos falsos.

3. **No absorber cambios en `api.contract` y `backend-architecture`**
   Resultado: el delta package queda como satélite y el corpus activo sigue mintiendo.

4. **Dejar K-07/K-08 como “después”**
   Resultado: QA valida una versión vieja del producto.

5. **No probar lost-session recovery**
   Resultado: pagos confirmados que parecen fallidos.

6. **Permitir payloads ad hoc en frontend**
   Resultado: provider leak y deriva semántica.

## 9. Definición de terminado del workstream

Este workstream no está “terminado” cuando existen los docs.
Está terminado solo si se cumplen **todas** estas condiciones:

- contratos absorbidos en specs activas,
- endpoints implementados y testeados,
- frontend route-driven y session-aware estable,
- track record público funcionando,
- paywall/depth/Pro funcionando,
- checkout return y entitlement refresh funcionando,
- K-03, K-04, K-05, K-06, K-07 y K-08 activos y verificables,
- sin launch blockers abiertos.

## 10. Recomendación ejecutiva

No intentes ejecutar esto “por áreas” sin gates.
Ejecutalo por **fases con salida obligatoria**, y tratá session/auth + checkout como el cuello de botella principal.

El peor error posible ahora es empezar a mezclar:
- visual polish,
- checkout,
- auth,
- responsive fixes,
- y shell refactor,

sin un orden duro.

Ese camino termina en caos, retrabajo y falsa sensación de avance.
