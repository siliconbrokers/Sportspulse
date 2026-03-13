# Predictive Engine Auditor — Persistent Memory

## Project: SportPulse Predictive Engine
Spec: `/Users/andres/Documents/04_Flux/SportsPulse/docs/specs/SportPulse_Predictive_Engine_Spec_v1.3_Final.md`
Implementation: `/Users/andres/Documents/04_Flux/SportsPulse/packages/prediction/`

## Phase 8 Audit (third audit, closure) — Current Status: PARTIALLY_CONFORMANT

### All 4 second-audit findings: CLOSED
- **F1** (stage_type invalid enum in tc-056-074, no-raw-calibrated-mixing, reconstruction): CLOSED. All 3 files cleaned.
- **F2** (distribution: {...} as any in tc-056-074): CLOSED. Now uses `buildTestRawDistribution()`.
- **F3** (PredictionResponseNotEligible.internals optional): CLOSED. Field is now `internals: null` (required).
- **F4** (knockout-resolver: ROUND_ROBIN as any): CLOSED. No as any in that file.

### One NEW finding discovered in Phase 8 audit (LOW)
- `test/response-builder.test.ts` line 67: `stage_type: 'REGULAR_SEASON'`, `format_type: 'LEAGUE'`, `} as any` — same invalid-enum bypass pattern. This file was NOT tracked in Phase 6 or Phase 7 audits. It is the only remaining runtime `as any` in the test suite.

### Remaining open item
- **NOT_ELIGIBLE internals optionality**: CLOSED in Phase 8 — `PredictionResponseNotEligible.internals: null` (required, not optional). Confirmed at line 507 of `src/contracts/types/prediction-response.ts`.

### `as any` in test/ — final state (Phase 8)
Only runtime bypass: `test/response-builder.test.ts:67`. All other occurrences are JSDoc comments in `test/helpers/branded-factories.ts`.

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
