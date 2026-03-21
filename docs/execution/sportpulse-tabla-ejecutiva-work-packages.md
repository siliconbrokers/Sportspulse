# SportPulse — Tabla ejecutiva de work packages

## Resumen operativo

Secuencia de ejecución recomendada:

- **P0**: consolidación de corpus y verdad contractual
- **P1**: backend truth surfaces + foundations frontend
- **P2**: integración auth / checkout / Pro + QA integrada
- **P3**: hardening visual final

## Tabla ejecutiva

| Prioridad | WP | Qué se hace | Owner principal | Depende de | Salida esperada | Gate |
|---|---|---|---|---|---|---|
| P0 | WP-01 | Absorber el delta en `api.contract` | UI API Engineer | Freeze documental | Contrato activo de session/auth, checkout y track record incorporado al corpus | No coexistencia de contratos contradictorios |
| P0 | WP-02 | Absorber el delta en `backend-architecture` | UI API Engineer + arquitectura | WP-01 | Arquitectura técnica activa alineada con el nuevo flujo backend↔frontend | Bundle activo coherente |
| P0 | WP-03 | Normalizar estado `proposed/active` de specs frontend críticos | Spec/Version Guardian | WP-01, WP-02 | Base documental canonizada para ejecutar sin drift | No mezclar active con drafts contradictorios |
| P0 | WP-13 | Consolidar K-07/K-08 solo en la matrix autoritativa y fixture discipline | QA / Fixture Enforcer | WP-03 | Acceptance matrix limpia y PF sin colisión semántica | K-series unívoca |
| P0 | WP-14 | Mapear `WP-*` con backlog activo (`SP-*`, `SPF-*`) | SDD Orchestrator | WP-03 | Programa y backlog hablando el mismo idioma | Ejecución trazable a tickets reales |
| P0 | WP-15 | Fijar política de promoción/supersession del delta package | Spec/Version Guardian | WP-03 | Qué queda activo, qué se archiva y qué se supersede | Constitución cumplida |
| P1 | WP-04A | Implementar `GET /api/session` | UI API Engineer | WP-01, WP-02 | Verdad mínima de sesión para shell | Base para K-05/K-06 y fail-closed en Pro depth |
| P1 | WP-04B | Implementar magic-link start/complete | UI API Engineer | WP-04A | Inicio y cierre de auth diferida | Soporta modelo anonymous-first |
| P1 | WP-04C | Implementar logout + expired-session handling | UI API Engineer | WP-04A | Cierre de sesión limpio y estado expirado consistente | Frontend no expone Pro por incertidumbre |
| P1 | WP-05 | Implementar `GET /api/ui/track-record` | PE Agent Family + UI API Engineer | WP-01, WP-02 | Endpoint público con estados `below-threshold/available/unavailable` | K-03 y trust surface público, sin auth |
| P1 | WP-07 | Foundations frontend: shell, routing, API client, registry | Frontend Engineer | WP-03 | Base consumible para todas las superficies nuevas | No depende de auth completa para kickoff |
| P1 | WP-08 | UI pública de track record | Frontend Engineer | WP-05, WP-07 | Ruta pública con estados completos y CTA/navegación | Launch blocker destrabado sin auth |
| P1 | WP-16 | Seguridad/runtime: cookies, CORS, rate limit, headers | Ops + UI API Engineer | WP-04A, WP-04B | Base operativa segura para auth/session/checkout | Baseline operativo cumplido |
| P1 | WP-17 | Migraciones + env wiring para sesión/suscripción | Ops + UI API Engineer | WP-04A, WP-16 | Persistencia, configuración y separación de entornos listas | NFR de deployabilidad y configurabilidad |
| P2 | WP-06A | Crear checkout session | UI API Engineer | WP-04A, WP-16, WP-17 | Inicio de checkout autenticado | K-05 empieza a ser realizable |
| P2 | WP-06B | Reconcile checkout return | UI API Engineer | WP-06A | Return seguro + recuperación explícita | Misma sesión / fail-closed si entitlement incierto |
| P2 | WP-06C | Subscription status + refresh entitlement | UI API Engineer | WP-06B | Verdad comercial consumible por frontend | Sin lookup fiable no hay Pro real |
| P2 | WP-09 | Integración frontend de session/auth | Frontend Engineer | WP-04A/B/C, WP-07 | Hydration, callback y gating por session state | K-06 viable en UI real |
| P2 | WP-10 | Paywall / checkout return / Pro rendering / ad suppression | Frontend Engineer | WP-06A/B/C, WP-09 | Flujo free→auth→paywall→checkout→Pro sin huecos | K-04, K-05 y K-07 |
| P2 | WP-11 | QA integrada K-03..K-07 | QA / Fixture Enforcer + FE + API | WP-05, WP-08, WP-09, WP-10 | Cobertura automática de trust/commercial/auth | Matrix y fixtures coherentes |
| P2 | WP-18 | Staging, smoke, health, rollback, release gate | Ops + QA + API | WP-11, WP-16, WP-17 | Release candidate con despliegue y rollback ejercitados | Baseline operativo y aceptación extendida |
| P3 | WP-12 | Hardening visual y style propagation final | Frontend Engineer | WP-10, WP-11 | Pulido visual sin alterar verdad semántica | Visual al final, no antes de comportamiento |

## Orden de arranque real

### Batch 1
- WP-01
- WP-02
- WP-03
- WP-13
- WP-14
- WP-15

### Batch 2
- WP-04A
- WP-04B
- WP-04C
- WP-05
- WP-07

### Batch 3
- WP-08
- WP-16
- WP-17

### Batch 4
- WP-06A
- WP-06B
- WP-06C
- WP-09

### Batch 5
- WP-10
- WP-11

### Batch 6
- WP-18
- WP-12

## No negociables

- No arrancar checkout serio sin `WP-16` y `WP-17`.
- No arrancar Pro rendering sin `WP-04A` y `WP-06C`.
- No declarar release readiness sin `WP-18`.
- No tocar hardening visual antes de `WP-10` y `WP-11`.
