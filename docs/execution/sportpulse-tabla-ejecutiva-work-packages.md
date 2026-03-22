# SportPulse — Tabla ejecutiva de work packages

| Prioridad | WP | Qué se hace | Owner principal | Depende de | Salida esperada |
|---|---|---|---|---|---|
| P0 | WP-01 | Absorber delta en `api.contract` | API | freeze | contrato activo |
| P0 | WP-02 | Absorber delta en `backend-architecture` | Backend architecture | WP-01 | arquitectura activa |
| P0 | WP-03 | Normalizar estado `active` de specs frontend | Program/Spec governance | WP-01, WP-02 | baseline ejecutable |
| P0 | WP-13 | Canonizar K-07/K-08 + PF alignment | QA | WP-03 | matrix limpia |
| P0 | WP-14 | Integrar SPF al backlog maestro | Program/Spec governance | WP-03 | backlog unificado |
| P0 | WP-15 | Marcar patches como superseded | Program/Spec governance | WP-03 | corpus sin fuentes paralelas |
| P1 | WP-04A | `GET /api/session` | API | WP-01..03 | sesión canónica |
| P1 | WP-04B | magic-link start/complete | API | WP-04A, WP-16, WP-17 | auth diferida |
| P1 | WP-04C | logout + expired session | API | WP-04A | cierre limpio |
| P1 | WP-05 | `GET /api/ui/track-record` | Prediction + API | WP-01, WP-02 | track record público |
| P1 | WP-16 | cookies/CORS/rate-limit/security | Ops + API | WP-02 | runtime seguro |
| P1 | WP-17 | migraciones + env wiring | Ops + API | WP-02 | estado durable |
| P2 | WP-07 | foundations frontend | Frontend | WP-03 | shell/routing/API client |
| P2 | WP-08 | UI pública de track record | Frontend | WP-05, WP-07 | trust surface |
| P2 | WP-06A | checkout session | API | WP-04A, WP-16, WP-17 | create checkout |
| P2 | WP-06B | reconcile return | API | WP-06A, WP-04B | reconcile seguro |
| P2 | WP-06C | subscription status + refresh | API | WP-06B | entitlement truth |
| P2 | WP-09 | session hydration + auth callback | Frontend | WP-04A/B/C, WP-07 | auth integrada |
| P2 | WP-10 | paywall + checkout return + Pro + ads | Frontend | WP-06A/B/C, WP-09 | K-04/K-05/K-07 |
| P3 | WP-11 | QA integrada K-03..K-07 | QA | WP-08, WP-09, WP-10 | aceptación integrada |
| P3 | WP-12 | hardening visual + K-08 | Frontend | WP-11 | release visual |
| P3 | WP-18 | staging/smoke/rollback gate | Ops + QA | WP-11, WP-16, WP-17 | release gate |
