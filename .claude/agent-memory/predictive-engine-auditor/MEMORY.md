# Predictive Engine Auditor — Persistent Memory

## Project: SportPulse Predictive Engine
Spec: `/Users/andres/Documents/04_Flux/SportsPulse/docs/specs/prediction/spec.sportpulse.prediction.engine.md` (v1.3 Frozen)
Implementation: `packages/prediction/` (V3 Unified Engine — engine_version '4.2' as of SP-V4-14)

## SP-V4 Fase 2 Audit — Current Status: PARTIALLY_CONFORMANT

### Findings closed in Fase 1 / confirmed closed in Fase 2
- **F3 [LOW]:** top_scorelines count=6→5. CLOSED in Fase 1. Still closed.
- **F4 [HIGH]:** double_chance/DNB using raw probs. CLOSED in Fase 1 (derived-calibrated.ts). Still closed.
- **Phase 8 `as any`:** `test/response-builder.test.ts:67` — CLOSED (line no longer exists). Memory note was stale.

### Open findings as of Fase 2 (2026-03-17)
- **F1 [MEDIUM]:** SofaScore API not subscribed — xG quality gap. OPEN.
- **F2 [MEDIUM]:** gen-calibration.ts does not use xG (training/inference gap). PARTIALLY_CLOSED — blocked by missing historical xG cache.
- **F5 [MEDIUM NEW]:** spec §23.2 requires log_loss + Brier score in backtest report. Fase 2 backtest only reports acc/DR/DP. OPEN.

### Deferred items
- **SP-V4-11:** MARKET_WEIGHT sweep — deferred, not testeable in backtest without historical odds.

## Architecture Notes (confirmed, as of Phase 7)
- `packages/prediction/src/` — 37 source files, 34 test files, 880 tests passing
- Branded types: `RawMatchDistribution`, `Raw1x2Probs`, `Calibrated1x2Probs` use `unique symbol` branding
- `prior_rating_available`: can now be overridden by actual `PriorRating` records in `MatchValidationContext`
- `tailMassExceeded` flag is computed and NOW acted upon — `buildFullModeResponse` degrades to `LIMITED_MODE`
- `DOMAIN_POOL_UNAVAILABLE` and `INVALID_PRIOR_RATING` are now emittable from `match-validator.ts`
- `PredictiveStageType` does NOT include `'REGULAR_SEASON'` or `'LEAGUE'` — those are invalid values used in several tests with `as any`

## Frequently Misimplemented Areas
- `as any` bypasses in test files: `tc-056-074`, `no-raw-calibrated-mixing.test.ts`, `reconstruction.test.ts` use invalid `stage_type` values not in the spec enum. These require factory helpers or valid enum values.
- `RawMatchDistribution` brand bypass in `tc-056-074` line 113: use `buildTestRawDistribution()` from `branded-factories.ts` instead.
- `PredictiveStageType` enum does NOT include `REGULAR_SEASON` or `LEAGUE`. Valid values: `QUALIFYING`, `GROUP_STAGE`, `LEAGUE_PHASE`, `PLAYOFF`, `ROUND_OF_32`, `ROUND_OF_16`, `QUARTER_FINAL`, `SEMI_FINAL`, `THIRD_PLACE`, `FINAL`.
- `FormatType` does NOT include `'LEAGUE'`. Valid values: `ROUND_ROBIN`, `GROUP_CLASSIC`, `LEAGUE_PHASE_SWISS_STYLE`, `KNOCKOUT_SINGLE_LEG`, `KNOCKOUT_TWO_LEG`.

## V3 Engine Architecture Snapshot (engine_version '4.2' as of SP-V4-14)
- Pipeline order: Poisson → MarketBlend → Calibration (isotonic) → DrawAffinity → PredictedResult
- Training uses `_skipDrawAffinity=true` (gen-calibration.ts) to avoid training/inference mismatch
- Calibration strategy: MIXED — PD=per-league table, PL=global, BL1=global
- DC_RHO_PER_LEAGUE: PD=-0.25, PL=-0.19, BL1=-0.14 (sweep 2026-03-17)
- SOS_SENSITIVITY=0.0 (optimal — rival_adjustment already normalizes by opponent quality)
- leagueCode flows from v3-shadow-runner.ts via deriveLeagueCode()
- 1187 tests / 1186 passed (1 pre-existing failure: match-validator catalog size F-005)
- Calibration tables: `cache/calibration/v3-iso-calibration*.json` (TTL 6h in shadow runner)
- POSITION_IMPACT: GK/DEF/MID/FWD positional factors in absence-adjustment (SP-V4-13)
- MIN_IMPORTANCE_THRESHOLD=0.3: players with importance < 0.3 excluded from absence model (SP-V4-12)
- MARKET_WEIGHT=0.15: blend weight for market odds (SP-V4-10, not optimized empirically yet)

## Calibration Training/Inference Gap (recurring risk)
- If gen-calibration.ts does not include new features (e.g. xG) when training, the calibration tables won't reflect runtime improvements. This caused acc plateau at 50.7% in SP-V4 Fase 1 despite xG augmentation being active in runtime.
- Always verify gen-calibration.ts passes same features as production pipeline when auditing calibration cycles.

## Motor Predictivo V2 Audit (2026-03-11) — APROBABLE CON RIESGOS SERIOS
Spec: `/Users/andres/Documents/04_Flux/SportsPulse/docs/specs/# Motor Predictivo V2.md`
Implementation: `packages/prediction/src/engine/v2/`, `server/prediction/v2-runner.ts`

### Patrones de fallo recurrentes en V2
- **Tipos fantasma**: `PriorSource` declara `PARTIAL` y `LOWER_DIVISION` pero ninguna rama de código los asigna. `D_PROMOTED` (0.40) es constante huérfana sin uso. Siempre verificar que los valores de enums/unions sean alcanzables en runtime.
- **Caller vs. callee**: `getRivalBaseline()` implementa correctamente 3 niveles de fallback (stats → prior → baseline), pero el caller en `v2-engine.ts` pasa `null` como prior del rival, cortocircuitando el nivel 2. Los tests unitarios de la función son insuficientes si el caller no la usa correctamente.
- **Separación de temporadas por año calendario**: `matchYear(utcDate) >= currentSeasonYear` es incorrecto para ligas europeas bicanuales (2024-25). Enero-mayo de la temporada anterior caen en el mismo año que el inicio de la temporada actual.
- **Validación §17**: Siempre verificar si existe walk-forward temporal con métricas (log-loss, Brier, calibración) para el motor auditado. Es criterio de aceptación, no opcional.
- **aggPriorSource**: usar el equipo local como árbitro arbitrario del `prior_source` de nivel superior es un smell. Debe existir una regla coherente documentada (peor de los dos, o al menos declarado explícitamente).

### Open items V2 (no resueltos — auditoría engine)
- C-01: Ruta LOWER_DIVISION no implementada
- C-02: PARTIAL no implementado / tipo a eliminar o activar
- C-03: prior del rival siempre null en v2-engine.ts
- C-04: separación de temporadas por año calendario (bug para ligas EU)
- C-05: walk-forward V2 AHORA IMPLEMENTADO — ver auditoría walk-forward abajo
- C-06: aggPriorSource arbitrario
- C-07 a C-10: correcciones de tests y documentación

## Walk-Forward Framework V2 Audit (2026-03-11) — APROBABLE CON RIESGOS SERIOS
Archivos: `packages/prediction/src/validation/walk-forward.ts`, `metrics.ts`, `scripts/validate-v2-walkforward.ts`

### Veredicto: anti-lookahead es correcto; comparación V1 vs V2 es inválida sin correcciones

### Patrones de fallo críticos (walk-forward)
- **Universos distintos V1 vs V2**: `loadV1Backtest` filtra solo por `competition_code` sin restricción temporal; V2 filtra por `seasonBoundaryIso(year)`. N(V1) != N(V2) sin advertencia. CRÍTICO.
- **NOT_ELIGIBLE asimétrico**: V1 excluye `mode !== 'NOT_ELIGIBLE'` (string de pipeline V1); V2 excluye `eligibility_status !== 'NOT_ELIGIBLE'` (enum V2). Definiciones no equivalentes.
- **V1 calibrado vs V2 sin calibrar**: V1 usa Elo+calibración Platt/Isotonic; V2 usa Poisson directo. Comparar Log Loss en valor absoluto es engañoso.
- **Brier Score rango [0,2] no declarado en reporte**: el reporte imprime el número sin contexto de rango.
- **Calibración combinada sin advertencia**: 3 outcomes mezclados en un mismo pool de buckets; oculta calibración por clase.
- **Baselines de referencia no impresos**: Log Loss naive ≈ 1.099, Brier naive ≈ 0.667 están en comentarios del código pero no en stdout.
- **Cold-start no desglosado**: primer partido evaluado con i=0 (cero contexto); no hay tabla de métricas cold-start vs steady-state.

### Lo que SÍ está correcto (walk-forward)
- Anti-lookahead: `slice(0,i)` + filtro interno engine `utcDate < kickoffUtc` — doble protección correcta
- Rival-adjustment sin lookahead: opera sobre `currentFiltered` ya recortado
- Recency sin lookahead: idem
- Fórmulas Log Loss, Brier, Accuracy, DrawRate, Goals: correctas matemáticamente
- NOT_ELIGIBLE excluido de todas las métricas: correcto
- Engine real importado (no mock): correcto

### Correcciones obligatorias (prioridad)
1. Filtrar V1 snapshots por misma ventana temporal que V2 en `loadV1Backtest`
2. Declarar en reporte si N(V1) != N(V2) con advertencia explícita
3. Nota en reporte: "V1=Elo+calibrado, V2=Poisson sin calibrar — no comparables en valor absoluto"
4. Imprimir baselines de referencia en stdout
5. Declarar calibración como combinada, no por clase
6. Añadir desglose de métricas cold-start (n_current_at_time < 10) vs steady-state

## NEXUS (PE v2) Audit — 2026-03-19 — PARTIALLY_CONFORMANT
Artefacto: `docs/audits/PE-audit-2026-03-19.md`
Specs auditadas: 6 documentos en `docs/specs/prediction/engine-v2/`

### Findings OPEN (8 total: 3 HIGH, 3 MEDIUM, 2 LOW)
- **F-001 [HIGH]:** `PREDICTION_NEXUS_SHADOW_ENABLED` en code vs `NEXUS_SHADOW_ENABLED` en spec (master S8.2). Fix: renombrar env var en `nexus-shadow-runner.ts:75`.
- **F-002 [HIGH]:** `NexusShadowSnapshot` missing 4 of 8 fingerprint fields (NEXUS-0 S9.2): `featureSchemaVersion`, `datasetWindow`, `modelVersion`, `calibrationVersion`.
- **F-003 [HIGH]:** `computeOddsConfidence()` uses `buildNowUtc`-relative age instead of kickoff-relative distance (MSP S2.2). Must accept `kickoffUtc` as parameter.
- **F-004 [MEDIUM]:** Spurious aggregate `liveShadowN < 100` check in `gate-evaluator.ts:131-138` not defined in spec §S6.2. Remove it.
- **F-005 [MEDIUM]:** `fitNexusCalibration()` assigns same PAVA curve to all three classes (broken one-vs-rest). Use `fitNexusCalibrationFromTriplets()` instead or fix/delete.
- **F-006 [MEDIUM]:** `isNeutralVenue` hardcoded to `false` in shadow runner (spec prohibits defaulting — taxonomy S3.2).
- **F-007 [LOW]:** Bootstrap `learnedAt` hardcoded to '2026-03-18T00:00:00.000Z' — use `new Date().toISOString()`.
- **F-008 [LOW]:** `nexus-startup-init.ts` imports via relative paths into packages/ instead of using `@sportpulse/prediction` alias.

### NEXUS: Lo que SÍ está correcto (core math)
- Dixon-Coles factors exact (all 4 cells), per-liga rho with DEFAULT_RHO fallback
- MIN_WEIGHT_TRACK12=0.20 (spec governs over prompt's 0.35) — enforced in all redistribution paths
- Anti-lookahead: strict less-than in all three enforcement points (feature store, calibration, scorecard)
- MISSING = Symbol('MISSING') — correct sentinel
- Append-only raw odds store with atomic write
- De-vigging: proportional normalization only, Pinnacle-only benchmark — correct
- Scorecard disjoint invariant: throws on overlap — correct
- RPS formula: exact match with evaluation spec S2.1
- Promotion gate: all thresholds match spec (600/200/100 volume, 0.005/0.03/0.02 performance tolerances)
- Operating modes: Track3 inactive → LIMITED_MODE — correct

### NEXUS: Recurring patterns to watch
- **Server runner vs. package boundary**: `nexus-shadow-runner.ts` correctly imports via `@sportpulse/prediction`; `nexus-startup-init.ts` does not. Check this distinction in future modules.
- **Two calibration entry points**: `fitNexusCalibration()` (broken) and `fitNexusCalibrationFromTriplets()` (correct). Always use the triplets variant.
- **Confidence reference point**: Track 4 odds confidence = distance to KICKOFF (not to buildNowUtc). This is a subtle distinction the spec makes explicit in MSP S2.2.
