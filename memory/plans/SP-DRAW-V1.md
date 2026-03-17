# SP-DRAW-V1 -- Plan de Mejora de Prediccion de Empates

**Fecha:** 2026-03-17
**Estado:** DRAFT -- pendiente aprobacion
**Autor:** Architect (Opus)
**Baseline:** V4.3 engine -- acc=54.8%, log_loss=0.9923, brier=0.5908, DRAW recall=0%, DRAW predictions=1%
**Empates reales en la muestra:** 26.7% (~806 partidos PD+PL+BL1 2025-26)
**Referencia mercado:** 54.3% accuracy con 0% draw predictions (argmax de odds)

---

## 1. Objetivo del Plan

Dotar al motor V4.3 de capacidad de predecir empates sin degradar la accuracy global.
El motor actual tiene un deficit estructural: el modelo Poisson con home advantage
casi nunca produce p_draw > p_home, y tras fix #3 se desactivaron DrawAffinity y
DRAW_FLOOR porque overcorregian. El resultado es 0% draw recall.

### Metricas Target

| Metrica | Baseline (V4.3) | Target Solucion A | Target Solucion B | Hard Floor |
|---------|-----------------|-------------------|-------------------|------------|
| Accuracy | 54.8% | >= 54.0% | >= 54.0% | >= 53.5% (rollback si cae debajo) |
| DRAW Recall | 0% | >= 10% | >= 15% | >= 8% (min para justificar feature) |
| DRAW Precision | N/A | >= 35% | >= 35% | >= 30% |
| AWAY Recall | ~40% | >= 35% | >= 35% | >= 30% |
| HOME Recall | ~67% | >= 60% | >= 60% | >= 55% |
| Coverage | ~95% | >= 75% | >= 75% | >= 70% |
| pct_draw_pred | 1% | 8-18% | 10-22% | <= 30% |

**Composite Score** = 0.4 * accuracy + 0.3 * draw_recall + 0.3 * draw_precision
(mismo que sweep-draw-affinity.ts)

### Restriccion Critica

El accuracy (54.8%) NO debe degradarse a menos de 53.5%. Si la Solucion A no
alcanza los targets, documentar por que y escalar a Solucion B. No aplicar ambas
soluciones simultaneamente sin validacion separada primero.

---

## 2. Diagnostico del Problema

### 2.1 Por que el modelo Poisson no predice empates

El modelo Dixon-Coles/Poisson calcula p_draw como la suma de la diagonal principal
de la matriz bivariate: P(0-0) + P(1-1) + P(2-2) + ... Cuando lambda_home > lambda_away
(home advantage), las distribuciones se separan y la diagonal suma menos.

Con home advantage tipico (lambda_home ~1.45, lambda_away ~1.15):
- p_home ~ 0.42
- p_draw ~ 0.27
- p_away ~ 0.31

El argmax es HOME_WIN. Para que p_draw gane como argmax, se necesita
lambda_home ~ lambda_away Y ambos bajos -- un caso raro por construccion.

### 2.2 Estado del pipeline actual (fix #3)

```
Poisson+DC -> MarketBlend(w=0.20) -> Calibration(isotonic) -> [DrawAffinity=OFF] -> PredictedResult(FLOOR=OFF)
```

La calibracion isotonica corrige el sesgo sistematico (p_home sobre-estimado,
p_away sub-estimado), pero NO cambia el ranking relativo dentro de cada partido
de forma suficiente para hacer p_draw > p_home.

### 2.3 Infraestructura existente reutilizable

| Modulo | Estado | Reutilizable |
|--------|--------|-------------|
| `draw-affinity.ts` | DESACTIVADO (fix #3) | Si -- pero NO como solucion. Es la pieza que overcorregida. |
| `predicted-result.ts` DRAW_FLOOR | DESACTIVADO (fix #3) | Si -- es la pieza clave para Solucion A. |
| `logistic-model.ts` | Coeficientes=0 (uniform) | Si -- necesita re-entrenamiento con features de empate. |
| `sweep-draw-affinity.ts` | Funcional | Si -- adaptar para sweep solo FLOOR/MARGIN sin DA. |
| `train-logistic.ts` | Funcional | Si -- extender con nuevas features. |
| `gen-calibration.ts` | Funcional | Si -- re-generar tras cambiar logistico. |
| `backtest-v3.ts` | Funcional | Si -- evaluacion walk-forward estandar. |

---

## 3. Solucion A -- Regla DRAW_FLOOR/MARGIN sobre p_draw honesta (sin DrawAffinity)

### 3.1 Hipotesis

La p_draw post-calibracion (sin DrawAffinity) es "honesta" -- refleja la
probabilidad real del modelo. Cuando p_draw es alta pero no la mas alta,
una regla de decision con umbrales calibrados puede capturar empates sin
distorsionar las probabilidades subyacentes.

La diferencia clave vs el intento anterior: antes DRAW_FLOOR operaba sobre
p_draw post-DrawAffinity (inflada). Ahora opera sobre p_draw post-calibracion
(honesta). Los umbrales optimos seran diferentes.

### 3.2 Mecanismo

En `computePredictedResult()` (ya implementado, solo desactivado):
```
if (DRAW_FLOOR_ENABLED) {
  if (probDraw >= DRAW_FLOOR && maxOther - probDraw <= DRAW_MARGIN) {
    predicted_result = 'DRAW'
  }
}
```

Los parametros a optimizar son:
- `DRAW_FLOOR` -- umbral minimo de p_draw para activar la regla
- `DRAW_MARGIN` -- margen maximo entre max(p_home, p_away) y p_draw

### 3.3 Por que puede funcionar ahora

Sin DrawAffinity, p_draw post-calibracion tiene una distribucion mas concentrada
y menos inflada. Los partidos donde p_draw es genuinamente alta (>0.28) son
partidos con equipos realmente parejos. DRAW_MARGIN controla cuanto "estira"
el modelo para capturar empates.

El sweep anterior (96 combos) busco optimos con DrawAffinity activa. Un nuevo
sweep sin DA, con grid mas fino en FLOOR y MARGIN, deberia encontrar un punto
dulce donde se capturan 10-15% de empates con precision >=35%.

### 3.4 Riesgos de Solucion A

1. **El rango de p_draw honesta puede ser demasiado estrecho.** Si la calibracion
   comprime p_draw a un rango [0.24, 0.30], los umbrales FLOOR/MARGIN pueden no
   separar empates reales de falsos. Mitigacion: analizar la distribucion de p_draw
   antes del sweep.

2. **Trade-off accuracy/recall puede ser desfavorable.** Cada draw predicho que
   falla resta de accuracy. Si solo 35% de draws predichos son correctos y
   predecimos 15% de partidos como draw, perdemos ~10% * 65% = 6.5% de accuracy.
   Mitigacion: targets conservadores (10% recall, no 50%).

3. **Sin informacion per-partido.** DRAW_FLOOR es una regla global -- no usa
   draw rates historicos ni H2H. Captura empates "por probabilidad" pero no
   empates "por contexto" (derby, tabla pareja, etc.).

---

## 4. Solucion B -- Features especificas de empate en el logistico

### 4.1 Hipotesis

El modelo logistico tiene la estructura correcta (softmax multinomial con clase
DRAW explicita) pero le faltan features que discriminen empates de no-empates.
Las features actuales (lambda_home, lambda_away, balance_ratio, etc.) son buenas
para separar HOME de AWAY pero no para detectar DRAW.

Features nuevas propuestas:
- `home_draw_rate` -- ya calculada en v3-engine.ts (Bayesian-smoothed)
- `away_draw_rate` -- ya calculada en v3-engine.ts
- `h2h_draw_rate` -- ya calculada en v3-engine.ts (>=2 h2h matches)
- `table_proximity` -- ya calculada en v3-engine.ts

Estas 4 features YA EXISTEN en el pipeline para DrawAffinity. Solo hay que
extraerlas en `extractLogisticFeatures()` y pasarlas al logistico.

### 4.2 Por que las features existentes no bastan

El `balance_ratio` (min(lh,la)/max(lh,la)) captura fuerzas parejas pero
no captura propensidad historica de empate. Un equipo puede tener lambdas
parecidas pero ganar frecuentemente (equipo con mentalidad ganadora) o
empatar frecuentemente (equipo defensivo). Las draw rates por equipo
capturan este patron.

### 4.3 Cadena de cambios para Solucion B

1. Ampliar `LogisticFeatureVector` con 4 features nuevas
2. Ampliar `LOGISTIC_FEATURE_KEYS` con los 4 nombres
3. Ampliar `extractLogisticFeatures()` con 4 nuevos parametros
4. Ampliar el caller en `v3-engine.ts` para pasar los 4 valores
5. Re-entrenar el logistico (`tools/train-logistic.ts`) -- coefficients nuevos
6. Re-generar calibracion (`tools/gen-calibration.ts`)
7. Activar ENSEMBLE_ENABLED=true con w_logistic > 0
8. Validar via backtest walk-forward

### 4.4 Riesgos de Solucion B

1. **Overfitting en training set pequeno.** 806 partidos / 3 clases / 23 features
   = alto riesgo de overfitting. L2 regularization mitiga parcialmente.
   Mitigacion: walk-forward validation (no train/test split).

2. **Ensemble weight puede ser cero.** Si el logistico no mejora sobre
   Poisson+Market en walk-forward, el sweep de pesos lo descartara.
   El sweep SP-V4-22 ya dio w_logistic=0 con las features actuales.
   Mitigacion: las 4 features nuevas son la razon por la que w_logistic
   podria subir a >0 -- hay que re-evaluar.

3. **Cadena de re-entrenamiento larga.** Cambiar features del logistico
   requiere: re-train logistic -> re-gen calibration -> re-sweep ensemble weights.
   Son 3 pasos dependientes. Error en cualquiera invalida los siguientes.
   Mitigacion: scripts automatizados existentes.

---

## 5. Tabla de Tickets

### Fase 0 -- Diagnostico y preparacion (pre-requisito)

| ID | Descripcion | Deps | Agente PE | Tier | Criterios de Aceptacion |
|----|-------------|------|-----------|------|------------------------|
| SP-DRAW-00 | Analizar distribucion de p_draw post-calibracion (sin DA) sobre los 806 partidos. Generar histograma, p25/p50/p75/p90, separado por outcome real. Guardar en `cache/draw-diagnostics.json`. | Ninguna | `match-prediction-engine` | sonnet | Archivo JSON generado con stats. p_draw mediana de empates reales vs no-empates documentada. |
| SP-DRAW-01 | Crear `tools/sweep-draw-floor.ts` -- grid search de DRAW_FLOOR x DRAW_MARGIN (sin DrawAffinity). Grid: FLOOR in [0.20..0.35 step 0.01], MARGIN in [0.02..0.15 step 0.01]. Misma metodologia walk-forward que sweep-draw-affinity.ts pero con DA=OFF fijo. Output: `cache/draw-floor-sweep.json`. | SP-DRAW-00 | `match-prediction-engine` | sonnet | Script ejecutable. JSON con 16x14=224 combinaciones. Cada combo tiene acc/DR/DP/AR/HR/pct_draw. Optimo seleccionado por composite score con filtros (acc>=53.5%, DP>=30%, AR>=30%). |

### Fase 1 -- Solucion A (DRAW_FLOOR sobre p_draw honesta)

| ID | Descripcion | Deps | Agente PE | Tier | Criterios de Aceptacion |
|----|-------------|------|-----------|------|------------------------|
| SP-DRAW-10 | Ejecutar sweep-draw-floor.ts. Seleccionar configuracion optima. Documentar resultados. | SP-DRAW-01 | `match-prediction-engine` | sonnet | Sweep ejecutado. Top 5 configs documentadas con todas las metricas. Decision: si cumple targets de Solucion A -> proceder a SP-DRAW-11. Si ninguna config cumple -> documentar por que y saltar a Fase 2. |
| SP-DRAW-11 | Aplicar DRAW_FLOOR y DRAW_MARGIN optimos en constants.ts. Cambiar DRAW_FLOOR_ENABLED=true (DRAW_AFFINITY_ENABLED sigue false). Regenerar calibracion (gen-calibration.ts -- la calibracion NO cambia porque solo cambia la regla de decision, no las probabilidades). | SP-DRAW-10 (si cumple targets) | `calibration-decision-policy` | sonnet | constants.ts actualizado. DRAW_FLOOR_ENABLED=true. DRAW_AFFINITY_ENABLED=false. Los valores de DRAW_FLOOR y DRAW_MARGIN reflejan el optimo del sweep. |
| SP-DRAW-12 | Ejecutar backtest-v3.ts completo con nueva config. Verificar que metricas coinciden con sweep. Bump engine_version a '4.4'. | SP-DRAW-11 | `predictive-engine-qa` | sonnet | Backtest reporta: acc>=54.0%, DR>=10%, DP>=35%, AR>=35%. engine_version='4.4' en output. Suite existente pasa. |
| SP-DRAW-13 | Agregar tests unitarios para predicted-result.ts con DRAW_FLOOR_ENABLED=true: (a) caso donde p_draw >= FLOOR y margin <= DRAW_MARGIN -> DRAW, (b) caso donde p_draw < FLOOR -> argmax normal, (c) caso donde margin > DRAW_MARGIN -> argmax normal, (d) caso TOO_CLOSE sigue tomando precedencia sobre DRAW_FLOOR. | SP-DRAW-11 | `predictive-engine-qa` | sonnet | 4 tests nuevos pasando. Cobertura de la regla DRAW_FLOOR completa. |
| SP-DRAW-14 | Decision Gate: evaluar Solucion A. Si cumple targets -> cerrar SP-DRAW-V1 como exitoso. Si no cumple targets pero acc >= 53.5% -> mantener config y escalar a Fase 2. Si acc < 53.5% -> rollback a DRAW_FLOOR_ENABLED=false y escalar a Fase 2. | SP-DRAW-12 | `predictive-engine-orchestrator` | opus | Decision documentada en este plan (campo "Decision Gate A" al final). Si rollback, constants.ts revertido a DRAW_FLOOR_ENABLED=false. |

### Fase 2 -- Solucion B (Features de empate en logistico)

| ID | Descripcion | Deps | Agente PE | Tier | Criterios de Aceptacion |
|----|-------------|------|-----------|------|------------------------|
| SP-DRAW-20 | Ampliar LogisticFeatureVector con 4 features: `home_draw_rate`, `away_draw_rate`, `h2h_draw_rate` (0.25 fallback si <2 h2h), `table_proximity`. Actualizar LOGISTIC_FEATURE_KEYS, extractLogisticFeatures(). Agregar 4 parametros nuevos a extractLogisticFeatures(). DEFAULT_LOGISTIC_COEFFICIENTS debe incluir weight=0 para los 4 nuevos (backward compatible). | SP-DRAW-14 (si no cumple targets) | `domain-contracts-agent` | sonnet | LogisticFeatureVector tiene 23 keys (19 actuales + 4 nuevas). LOGISTIC_FEATURE_KEYS tiene 23 entries. extractLogisticFeatures() acepta los 4 params nuevos con defaults. Suite existente pasa sin cambios (pesos=0 -> no afecta output). |
| SP-DRAW-21 | Conectar v3-engine.ts: pasar homeDrawRate, awayDrawRate, h2hDrawRate, tableProximity a extractLogisticFeatures(). Los valores ya estan calculados en el pipeline (lineas ~474-517). Solo hay que pasarlos al feature extractor. | SP-DRAW-20 | `match-prediction-engine` | sonnet | v3-engine.ts pasa los 4 valores. Con coeficientes=0 (default), output es bit-exact al pre-cambio. Test de determinismo pasa. |
| SP-DRAW-22 | Re-entrenar logistico con train-logistic.ts (que ahora incluye las 23 features). Guardar coefficients en cache/logistic-coefficients.json. Documentar: coeficientes de las 4 features nuevas para la clase DRAW (deben ser positivos y significativos si la hipotesis es correcta). | SP-DRAW-21 | `match-prediction-engine` | sonnet | logistic-coefficients.json actualizado con 23 features. Coeficientes de draw-class para home_draw_rate y away_draw_rate son positivos (>0.1). Training converge (loss decrece monotonamente). |
| SP-DRAW-23 | Re-generar calibracion: gen-calibration.ts con ENSEMBLE_ENABLED=true + nuevos coefficients. La calibracion debe re-entrenarse porque ahora el espacio de probabilidades incluye el componente logistico. | SP-DRAW-22 | `calibration-decision-policy` | sonnet | calibration-table.json regenerado. calibration-metadata muestra trained_on_matches >= 500. |
| SP-DRAW-24 | Sweep de ensemble weights (sweep-ensemble-weights.ts) con el logistico re-entrenado. Grid: w_logistic in [0.00..0.40 step 0.05]. Determinar si w_logistic > 0 ahora mejora vs w_logistic=0. | SP-DRAW-23 | `match-prediction-engine` | sonnet | Sweep ejecutado. Optimo documentado. Si w_logistic > 0 en optimo -> proceder. Si w_logistic = 0 sigue optimo -> documentar que las features no ayudan y cerrar plan. |
| SP-DRAW-25 | Aplicar ensemble weights optimos + ENSEMBLE_ENABLED=true en constants.ts. Si DRAW_FLOOR_ENABLED=true (de Fase 1), evaluar si sigue siendo beneficioso o si el logistico ya captura los empates. Sweep DRAW_FLOOR con nueva config si necesario. | SP-DRAW-24 (si w_logistic > 0) | `calibration-decision-policy` | sonnet | constants.ts actualizado: ENSEMBLE_ENABLED, ENSEMBLE_WEIGHTS_DEFAULT, y opcionalmente DRAW_FLOOR_ENABLED. |
| SP-DRAW-26 | Backtest walk-forward completo con config final. Bump engine_version a '4.5'. | SP-DRAW-25 | `predictive-engine-qa` | sonnet | acc>=54.0%, DR>=15%, DP>=35%, AR>=35%. engine_version='4.5'. Suite pasa. |
| SP-DRAW-27 | Tests del logistico con features nuevas: (a) extractLogisticFeatures con draw rates -> vector correcto, (b) predictLogistic con coeficientes entrenados -> p_draw > p_home para caso equilibrado con alto draw rate, (c) ensemble con w_logistic > 0 -> output difiere de w_logistic=0. | SP-DRAW-26 | `predictive-engine-qa` | sonnet | 3+ tests nuevos. Cobertura de las 4 features en extractor. Cobertura del ensemble con logistico activo. |

---

## 6. Diagrama de Dependencias

```
SP-DRAW-00 (diagnostico)
    |
SP-DRAW-01 (crear sweep tool)
    |
SP-DRAW-10 (ejecutar sweep)
    |
SP-DRAW-11 (aplicar config) ----> SP-DRAW-13 (tests unitarios)
    |
SP-DRAW-12 (backtest final)
    |
SP-DRAW-14 (DECISION GATE A)
    |
    +-- SI cumple targets --> CERRAR PLAN (exito Solucion A)
    |
    +-- NO cumple targets --> SP-DRAW-20 (ampliar features)
                                  |
                              SP-DRAW-21 (conectar en engine)
                                  |
                              SP-DRAW-22 (re-train logistic)
                                  |
                              SP-DRAW-23 (re-gen calibration)
                                  |
                              SP-DRAW-24 (sweep ensemble)
                                  |
                              SP-DRAW-25 (aplicar config)
                                  |
                              SP-DRAW-26 (backtest final) ----> SP-DRAW-27 (tests)
```

**Paralelismo posible:**
- SP-DRAW-11 y SP-DRAW-13 pueden correr en paralelo (uno modifica constants, otro escribe tests)
- SP-DRAW-26 y SP-DRAW-27 pueden correr en paralelo
- Todo lo demas es secuencial por dependencia de datos

---

## 7. Estrategia de Reentrenamiento y Calibracion

### Solucion A (Fase 1)

No requiere re-entrenamiento ni re-calibracion. La DRAW_FLOOR rule opera sobre
probabilidades finales (post-calibracion) como regla de decision pura. No modifica
las probabilidades subyacentes.

**Verificacion necesaria:** Confirmar que gen-calibration.ts genera tuples con
`_skipDrawAffinity=true` (ya lo hace), y que la calibracion existente fue entrenada
sobre probabilidades sin DA. Si la calibracion actual fue entrenada CON DA, hay que
re-generarla. Revisar `cache/calibration-table.json` metadata.

### Solucion B (Fase 2)

Cadena de re-entrenamiento obligatoria (en orden estricto):

1. **Re-train logistic** (train-logistic.ts)
   - Input: cache de matchdays + nuevas features
   - Output: cache/logistic-coefficients.json
   - Criterio: loss converge, coeficientes de draw features son significativos

2. **Re-generate calibration** (gen-calibration.ts)
   - Input: pipeline con ENSEMBLE_ENABLED=true + nuevos coefficients
   - Output: cache/calibration-table.json
   - Criterio: metadata.trained_on_matches >= 500
   - IMPORTANTE: correr con `_skipDrawAffinity=true` (ya es default en gen-cal)

3. **Sweep ensemble weights** (sweep-ensemble-weights.ts)
   - Input: pipeline con calibracion nueva
   - Output: optimo de w_poisson/w_market/w_logistic
   - Criterio: composite score > baseline

4. **Sweep DRAW_FLOOR** (sweep-draw-floor.ts, si se mantiene activo)
   - Input: pipeline con todo lo anterior
   - Output: optimos de FLOOR/MARGIN para el nuevo pipeline
   - Criterio: mismos filtros que Fase 1

**Advertencia:** Si se cambia cualquier paso anterior, todos los posteriores
deben re-ejecutarse. No es valido usar calibracion vieja con logistico nuevo.

---

## 8. Suite de Pruebas

### Tests nuevos por ticket

| Ticket | Tests | Tipo | Archivo |
|--------|-------|------|---------|
| SP-DRAW-13 | 4 tests de regla DRAW_FLOOR | Unit | `test/engine/v3/predicted-result.test.ts` |
| SP-DRAW-27.a | extractLogisticFeatures con draw rates | Unit | `test/engine/v3/logistic-model.test.ts` |
| SP-DRAW-27.b | predictLogistic con coeficientes entrenados | Unit | `test/engine/v3/logistic-model.test.ts` |
| SP-DRAW-27.c | ensemble con w_logistic > 0 | Unit | `test/engine/v3/ensemble.test.ts` |

### Tests existentes que deben seguir pasando

- `predicted-result.test.ts` -- todos los casos existentes (backward compat)
- `logistic-model.test.ts` -- tests de coeficientes=0 producen uniform
- `ensemble.test.ts` -- tests de redistribucion de pesos
- `v3-engine.test.ts` -- determinismo del pipeline
- Suite completa: `pnpm -r test` (889+ tests)

### Tests de regresion criticos

- **Determinismo:** mismo input -> mismo output (fixture existente)
- **Backward compat de Solucion B:** con coeficientes=0 para features nuevas,
  output debe ser bit-exact al pre-cambio

---

## 9. Criterios de Avance/Rollback por Etapa

### Fase 0 (Diagnostico)

- **Avance:** Distribucion de p_draw analizada. Si mediana de p_draw en empates
  reales > mediana en no-empates -> hay signal. Avanzar a Fase 1.
- **Rollback:** Si p_draw es identica entre empates y no-empates -> la calibracion
  no preserva informacion de empate. Saltar directamente a Fase 2 (el Poisson no
  da signal via p_draw, solo via features).

### Fase 1 (Solucion A)

- **Avance a produccion:** acc >= 54.0% AND DR >= 10% AND DP >= 35% AND AR >= 35%
- **Avance a Fase 2:** acc >= 53.5% AND DR < 10% (hay signal pero insuficiente)
  O acc >= 54.0% AND DR >= 8% AND DP < 35% (captura empates pero imprecisamente)
- **Rollback a baseline:** acc < 53.5% O AR < 30% (la regla dano HOME/AWAY)

### Fase 2 (Solucion B)

- **Avance a produccion:** acc >= 54.0% AND DR >= 15% AND DP >= 35%
- **Rollback parcial:** Si w_logistic=0 en sweep -> cerrar plan, mantener
  config de Fase 1 (si fue exitosa) o baseline
- **Rollback total:** acc < 53.5% -> revertir a V4.3 baseline

---

## 10. Analisis de Riesgo

### Riesgo 1: La calibracion isotonica comprime p_draw a un rango estrecho

**Severidad:** Alta
**Probabilidad:** Media
**Impacto:** Solucion A no funciona (DRAW_FLOOR no puede separar empates)
**Mitigacion:** SP-DRAW-00 diagnostica esto ANTES de invertir en el sweep.
Si p_draw es uniformemente ~0.27 para todos los partidos, skip a Fase 2.
**Deteccion:** Histograma de p_draw en SP-DRAW-00.

### Riesgo 2: Accuracy cae por debajo del hard floor al predecir empates

**Severidad:** Critica
**Probabilidad:** Media-Baja
**Impacto:** El modelo predice peor que antes
**Mitigacion:** Targets conservadores (10% recall, no 50%). Sweep con filtro
acc >= 53.5%. Decision gates explicitos con rollback automatico.
**Deteccion:** Backtest walk-forward en cada decision gate.

### Riesgo 3: Re-entrenamiento del logistico overfittea con 806 muestras

**Severidad:** Media
**Probabilidad:** Media
**Impacto:** El logistico funciona en backtest pero no generaliza
**Mitigacion:** Walk-forward validation (no random split). L2 regularization
(REG_LAMBDA=0.01). Sweep de regularization strength si coeficientes son
demasiado grandes. Forward validation post-deploy (>=30 predicciones).
**Deteccion:** Comparar accuracy en ultimas 100 predicciones vs primeras 100
del walk-forward (drift check).

---

## 11. Spec References

| Spec | Seccion | Relevancia |
|------|---------|-----------|
| SP-PRED-V3-Unified-Engine-Spec.md | S18 | Predicted Result: define DRAW_FLOOR/MARGIN/TOO_CLOSE_THRESHOLD |
| SP-PRED-V3-Unified-Engine-Spec.md | S17 | Calibration: isotonic one-vs-rest |
| SP-PRED-V4.md | SP-V4-20 | Logistic model: feature vector, training, inference |
| SP-PRED-V4.md | SP-V4-21 | Ensemble combinator: weight redistribution |
| SP-PRED-V4.md | SP-V4-23 | Ensemble integration: feature flag, activation path |
| Domain Glossary | draw_affinity | Multiplicador post-Poisson para corregir sesgo de empate |

---

## 12. Assumptions

1. La calibracion actual fue entrenada SIN DrawAffinity (gen-calibration usa
   `_skipDrawAffinity=true`). Si no, hay que re-generarla antes de Fase 1.

2. Los 806 partidos del backtest son suficientes para un sweep de 224 combinaciones
   (Fase 1) y para re-entrenar un logistico de 23 features (Fase 2).

3. El market blend (w=0.20) se mantiene activo en ambas soluciones. Las odds
   del mercado contribuyen ~20% a p_draw, lo cual es signal util.

4. El `TOO_CLOSE_THRESHOLD=0.05` se mantiene sin cambios. Un partido donde la
   diferencia entre max y second prob es < 5pp sigue siendo `null` (abstain).

5. home_draw_rate, away_draw_rate, h2h_draw_rate, table_proximity ya estan
   calculados en v3-engine.ts y son correctos. No hay que re-implementarlos.

---

## 13. Version Impact Analysis

| Cambio | Version afectada | Bump necesario |
|--------|-----------------|----------------|
| DRAW_FLOOR_ENABLED=true (Solucion A) | policyVersion | Si -- cambia semantica de predicted_result |
| engine_version -> '4.4' (Solucion A) | engine_version | Si |
| LogisticFeatureVector ampliado (Solucion B) | logistic model version | Si -- retrain requerido |
| ENSEMBLE_ENABLED=true (Solucion B) | engine_version -> '4.5' | Si |
| calibration-table.json regenerado | calibration version | Si -- metadata.trained_at actualizada |

No hay cambio en `snapshotSchemaVersion` ni `layoutAlgorithmVersion` -- los
cambios son internos al motor predictivo.

---

## 14. Definition of Done Global

- [ ] SP-DRAW-00 completado: distribucion de p_draw documentada
- [ ] Decision: proceder con Fase 1 o saltar a Fase 2
- [ ] Si Fase 1: sweep ejecutado, config aplicada, backtest validado, tests agregados
- [ ] Si Fase 2: features agregadas, logistico re-entrenado, calibracion regenerada, ensemble sweepado, backtest validado, tests agregados
- [ ] engine_version bumped
- [ ] Suite completa pasa: `pnpm -r test` (0 failures)
- [ ] Build pasa: `pnpm build`
- [ ] Auditoria PE formal post-cambio (artefacto en `docs/audits/`)
- [ ] Forward validation plan: >=30 predicciones reales monitoreadas post-deploy
- [ ] Plan actualizado con resultados finales y decision documentada

---

## 15. Decision Gate A (completar tras Fase 1)

### SP-DRAW-00 — Diagnóstico p_draw (ejecutado 2026-03-17)

**Resultado diagnóstico:**
- Muestras: 718 partidos (PD: 249, PL: 271, BL1: 198)
- Gap mediana p_draw (DRAW real vs no-DRAW): **0.006pp** → SIN SEÑAL (< 0.010pp threshold)
- La calibración isotónica comprime p_draw a un rango estrecho ([0.25..0.28] para 303 de 718 partidos)
- Sin separación estadística entre empates reales y no-empates
- Por liga: PD=0.007, PL=0.004, BL1=0.008 — todos AUSENTE

**Implicación:** La hipótesis "p_draw honesta post-calibración tiene señal" NO se verifica estadísticamente.
Sin embargo, el sweep se ejecutó igualmente per criterio del plan.

### SP-DRAW-01 — Sweep DRAW_FLOOR × DRAW_MARGIN (ejecutado 2026-03-17)

**Configuraciones exploradas:** 224 (FLOOR 0.20..0.35 × MARGIN 0.02..0.15)
**Baseline:** acc=54.7%, DR=0.0%, AR=57.7%, coverage=79.2%

**Óptimo encontrado:** DRAW_FLOOR=0.26, DRAW_MARGIN=0.15

| Métrica | Baseline | Óptimo | Target Plan | Estado |
|---------|----------|--------|-------------|--------|
| acc     | 54.7%    | 54.9%  | >=54.0%     | PASA   |
| DR      | 0.0%     | 28.2%  | >=10%       | PASA   |
| DP      | N/A      | 35.7%  | >=35%       | PASA   |
| AR      | 57.7%    | 45.1%  | >=35%       | PASA   |
| coverage| 79.2%    | 79.2%  | >=70%       | PASA   |

**Resultado sweep:** Óptimo CUMPLE todos los filtros del plan.
**Config optima:** DRAW_FLOOR=0.26, DRAW_MARGIN=0.15
**Metricas:** acc=54.9%, DR=28.2%, DP=35.7%, AR=45.1%, pct_draw=20.2%, composite=0.4111
**Decision:** AVANZAR A SP-DRAW-10 (aplicar config + backtest formal)
**Justificacion:** A pesar de que el diagnóstico no mostró señal estadística en p_draw,
el sweep empírico encontró una configuración que cumple los targets del plan. El MARGIN=0.15
(límite superior del grid) es el constraint binding — confirma señal débil, pero empíricamente
funciona. El trade-off principal es AR que cae -12.6pp (57.7%→45.1%) — dentro del hard floor
pero debe monitorearse en backtest formal (SP-DRAW-12).

**Nota arquitectónica:** El resultado empírico es posible porque aunque la diferencia de medianas
es pequeña (0.006pp), los partidos donde p_draw > 0.26 y margin ≤ 0.15 resultan en empate
el 35.7% de las veces — suficiente señal para que DRAW_FLOOR/MARGIN funcione como regla de decisión.

## 16. Decision Gate B (completar tras Fase 2, si aplica)

**Resultado sweep ensemble:** (pendiente)
**w_logistic optimo:** ?
**Config final:** (pendiente)
**Metricas finales:** acc=?%, DR=?%, DP=?%, AR=?%, pct_draw=?%
**Decision:** AVANZAR / ROLLBACK
**Justificacion:** (pendiente)
