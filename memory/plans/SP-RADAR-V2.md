# SP-RADAR-V2 -- Radar v2 Standalone Implementation

## Scope Statement
Implement Radar v2 as a standalone module in `server/radar-v2/` with new ontology (3 families, 6 labels), v2 JSON contracts, lifecycle management, editorial rendering, and validation. No predictor integration. No v1 history overwrite. Coexists with v1.

## Authoritative Spec References
1. spec.sportpulse.radar-v2-package-index.md -- package scope
2. spec.sportpulse.radar-v2-core.md -- ontology, families, labels, resolution logic
3. spec.sportpulse.radar-v2-json-contracts-and-lifecycle.md -- JSON shapes, lifecycle, validation
4. spec.sportpulse.radar-v2-editorial-rendering-policy.md -- rendering chain, tone, sanitization
5. spec.sportpulse.radar-v2-ui-ux-spec.md -- card anatomy, placement, states
6. spec.sportpulse.radar-v2-qa-acceptance-and-edge-cases.md -- acceptance criteria, edge cases
7. spec.sportpulse.radar-v2-implementation-guide.md -- module split, delivery sequence
8. spec.sportpulse.radar-v2-migration-and-rollout-plan.md -- rollout phases, migration rules

## V1 Reusability
- REUSE: evidence-tier, candidate-builder, diversity-filter, verdict logic, signal computations, text renderer (wrapped)
- REPLACE: types/contracts, service orchestrator, snapshot reader, API adapter
- NEW: family-resolver, card-resolver, validator

## Family Scoring
- CONTEXT = max(attentionScore, hiddenValueScore)
- DYNAMICS = max(openGameScore, tightGameScore)
- MISALIGNMENT = max(favoriteVulnerabilityScore, surfaceContradictionScore)
- Family precedence for ties: MISALIGNMENT > DYNAMICS > CONTEXT

## Implementation Order
1. Types 2. Validator 3. Writer 4. Reader 5. Scope loader 6. Candidate evaluator
7. Family resolver 8. Card resolver 9. Text renderer 10. Verdict resolver
11. Service 12. API adapter 13. Route+wiring 14. Tests

## Top 3 Risks
1. Signal threshold calibration shift under family-first resolution
2. Text renderer coupling to v1 copy library
3. Disk space doubling during v1/v2 coexistence

## Feature Flag
`RADAR_V2_ENABLED=true` in .env to activate v2 endpoint

## Endpoint
`GET /api/ui/radar/v2?competitionId=X&matchday=N`

---

## Estado de implementación (2026-03-16)

**Dictamen auditoría:** CONFORMANT — commit `815be6d`

### Cobertura

| Área | Estado |
|------|--------|
| Contratos JSON v2.0.0 | ✅ conforme |
| Validación (7 reglas de rechazo) | ✅ conforme |
| Resolución de familias + secondary badges | ✅ conforme |
| Ciclo de vida (frozen text, verdict append-only) | ✅ conforme |
| Operación standalone (sin predictor) | ✅ confirmado |
| Atomicity & single writer | ✅ conforme |
| Max 3 / min 0 cards | ✅ conforme |
| Bootstrap guard (SENAL ≥80, ENGANOSO ≥85) | ✅ conforme |
| Tests | 67 propios + 1732 totales — 0 fallos |
| Build | Limpio |

### Archivos creados

`server/radar-v2/`: radar-v2-types.ts, radar-v2-validator.ts, radar-v2-snapshot-writer.ts, radar-v2-snapshot-reader.ts, radar-v2-candidate-evaluator.ts, radar-v2-family-resolver.ts, radar-v2-card-resolver.ts, radar-v2-verdict-resolver.ts, radar-v2-service.ts, radar-v2-api-adapter.ts, index.ts

`server/radar-v2/test/`: radar-v2-validator.test.ts, radar-v2-family-resolver.test.ts, radar-v2-lifecycle.test.ts, radar-v2-types.test.ts

`packages/api/src/ui/radar-v2-route.ts`

### Modificados

`packages/api/src/app.ts`, `packages/api/src/ui/types.ts`, `server/index.ts`

### Gaps documentados (no bloquean MVP)

| Gap | Severidad |
|-----|-----------|
| Edge cases QA §6 (postponed, cancelled, provider disagree) sin test e2e | Baja |
| `resolveConfidenceBand()` lógica OR/EARLY sin comentario | Baja |
| Scope isolation sin test de aislamiento e2e | Baja |

### Fuera de alcance (por diseño)

- Frontend UI v2 → Phase 5 del rollout
- Shadow mode → Phase 4 del rollout
- Verdict scheduler wiring → pendiente
- Copy library separada para v2 → reutiliza v3 de v1
- Predictor integration → proyecto separado

### Integración con motor predictivo (2026-03-16)

**Estado:** ✅ IMPLEMENTADO — build limpio, 80 tests radar-v2 pasando, 1732 totales OK

**Archivos modificados/creados:**
- `server/radar-v2/radar-v2-types.ts` — `RadarV2PredictionContext`, campo `predictionContext` en `RadarV2Card`, version bump `radar-v2-integrated-1.1.0`
- `server/radar-v2/radar-v2-prediction-fetcher.ts` — NUEVO: extrae `RadarV2PredictionContext` de `PredictionStore`
- `server/radar-v2/radar-v2-card-resolver.ts` — `CardResolverInput.predictionFetcher`, razón cuantitativa, re-anchoring amplifier (secondary badge SENAL_DE_ALERTA en CONTEXT+TOO_CLOSE)
- `server/radar-v2/radar-v2-service.ts` — `BuildRadarV2Input.predictionFetcher`
- `server/radar-v2/radar-v2-api-adapter.ts` — Constructor acepta `PredictionStore?`, construye fetcher
- `server/radar-v2/radar-v2-validator.ts` — Regla 9: valida `predictionContext` si presente
- `server/radar-v2/index.ts` — Exporta `RadarV2PredictionContext`, `PredictionFetcher`
- `server/index.ts` — Pasa `predictionStore` a `RadarV2ApiAdapter`
- `server/radar-v2/test/radar-v2-prediction-integration.test.ts` — NUEVO: 13 tests

**Contratos:**
- `predictionContext` es aditivo → schema version sigue `2.0.0`
- Gating: NOT_ELIGIBLE→null | LIMITED_MODE→xG only | FULL_MODE→completo
- Degradación silenciosa: si no hay predictor data → `predictionContext: null`
- preMatchText frozen, verdict append-only — INVARIANTE RESPETADO

### Próximos pasos por fase

| Fase | Estado |
|------|--------|
| Phase 1 — Core implementation | ✅ COMPLETO |
| Phase 2 — Validation & QA | ✅ COMPLETO |
| Phase 3 — Integration testing | ✅ COMPLETO |
| Phase 3b — Predictor integration | ✅ COMPLETO (2026-03-16) |
| Phase 4 — Shadow mode | ⏸ PENDIENTE |
| Phase 5 — Controlled UI rollout | ⏸ PENDIENTE |
