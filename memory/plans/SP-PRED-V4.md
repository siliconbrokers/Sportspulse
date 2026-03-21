# SP-PRED-V4 -- Plan de Mejoras del Motor Predictivo V4

**Fecha:** 2026-03-17
**Estado:** DRAFT -- pendiente aprobacion
**Autor:** Architect (Opus)
**Baseline:** V3 Unified Engine -- acc=50.7%, DR=51.6%, DP=35.1% (walk-forward PD+PL+BL1, ~590 partidos)

---

## 1. Objetivo del Plan

Llevar el motor predictivo de 50.7% accuracy a 55%+ en tres fases incrementales,
cada una con criterios de avance/rollback independientes. Cada fase se valida
contra el backtest walk-forward antes de mergearse a produccion.

### Metricas Target por Fase

| Fase | Accuracy | DRAW Recall | DRAW Precision | Composite Score | Definition of Done |
|------|----------|-------------|----------------|-----------------|-------------------|
| Fase 1 | >=51.5% | >=51% | >=35% | >= baseline + 0.02 | Walk-forward PD+PL+BL1 con xG+SoS+rho cumple targets. Suite 100% pass. |
| Fase 2 | >=53% | >=51% | >=36% | >= Fase1 + 0.02 | Market blend activo (w>=0.15) mejora acc en >=1pp vs post-Fase1. >=50 partidos con odds evaluados. |
| Fase 3 | >=54.5% | >=51% | >=37% | >= Fase2 + 0.01 | Ensemble supera cada componente individual en walk-forward. |

### Definition of Done Global

- Walk-forward backtest sobre PD+PL+BL1 2025-26 (>=580 partidos FINISHED)
- Suite completa de tests: 100% pass
- Auditoria PE formal post-fase (artefacto en `docs/audits/`)
- Forward validation con >=30 predicciones reales post-deploy
- engine_version bumped a '4.x' (4.1 tras Fase 1, 4.2 tras Fase 2, 4.3 tras Fase 3)

---

## 2. Analisis de Viabilidad por Fase

### FASE 1 -- xG como base de signals + SoS en forma reciente + Rho dinamico

#### 2.1.1 xG como base de signals

**Estado actual:** Ya implementado parcialmente.
- `xg-augment.ts` reemplaza `homeGoals/awayGoals` con `xgHome/xgAway` en V3MatchRecord[]
- `XgSource` (server/prediction/xg-source.ts) fetcha xG de API-Football `/fixtures/statistics`
- `V3EngineInput.historicalXg?: XgRecord[]` ya existe como campo opcional
- V3 shadow runner ya pasa `historicalXg` al motor cuando disponible

**Verificacion MCP SofaScore:** El endpoint `Get_match_statistics` (SofaScore) retorna xG como:
```json
{
  "key": "expectedGoals",
  "homeValue": 2.09,
  "awayValue": 0.48
}
```
Disponible en periodos ALL, 1ST, 2ND. Dato total por equipo (no por tiro).

**Fuentes de xG disponibles:**

| Fuente | Formato | Cobertura | Costo | Latencia |
|--------|---------|-----------|-------|----------|
| API-Football `/fixtures/statistics` | `expected_goals` total por equipo | PD, PL, BL1 (top-5 europeas) | Budget compartido 100 req/dia | Post-match |
| SofaScore MCP `Get_match_statistics` | `expectedGoals` total por equipo | Todas las ligas SofaScore | RapidAPI plan (req/mes) | Post-match |

**Problema actual:** El pipeline xG depende de API-Football con budget compartido (100 req/dia).
La cobertura actual es incremental -- cada ciclo del shadow runner fetcha unos pocos fixtures nuevos.
Para backfill completo de 3 ligas x ~380 partidos = ~1140 fixtures se necesitarian ~1140 requests,
o sea ~11 dias de budget exclusivo para xG.

**Alternativa SofaScore:** El MCP de SofaScore provee xG sin compartir budget con API-Football.
Requiere mapeo de match_id SofaScore <-> canonical match. El endpoint recibe un `match_id` numerico
de SofaScore. La integracion seria:
1. Usar `Get_matches_by_date` para obtener la lista de partidos del dia con IDs de SofaScore
2. Mapear por (homeTeam, awayTeam, date) a nuestro canonical matchId
3. Fetchear `Get_match_statistics` por cada match_id para extraer xG
4. Persistir en disco como `XgRecord` (misma interfaz que el XgSource actual)

**Evaluacion de impacto:** El xG reemplaza goles en `computeLeagueBaselines` y `resolveTeamStats`.
El efecto esperado es:
- Reduccion de varianza en effective attack/defense (xG es mas estable que goles)
- Mejor early-season performance (menos ruido por muestra pequena)
- Impacto estimado: +0.5-1.0pp accuracy basado en literatura (Dixon-Coles con xG vs goles)

**Fallback:** Partidos sin xG disponible retienen goles reales (ya implementado en `augmentMatchesWithXg`).
URU no tiene xG en ninguna fuente -- se mantiene con goles reales.

**Necesita calibracion separada?** Si. Las distribuciones de xG son diferentes a las de goles
(media similar pero varianza menor). La calibracion isotonica actual fue entrenada sobre
el pipeline con goles. Post-xG se debe regenerar la tabla de calibracion con
`tools/gen-calibration.ts`.

**Backfill necesario:** 3 ligas x ~380 partidos x 1 temporada completa (2025-26) = ~1140 xG records.
Con SofaScore MCP, el costo son ~1140 requests al MCP (independiente del budget API-Football).
Una temporada anterior (2024-25) seria deseable para el prior -- otros ~1140 records.

**Accion concreta Fase 1:**
1. Crear `SofaScoreXgSource` como alternativa a `XgSource` (API-Football)
2. Backfill xG 2025-26 para PD, PL, BL1 via SofaScore MCP
3. Regenerar calibracion post-xG
4. Evaluar impacto en walk-forward

#### 2.1.2 SoS (Strength of Schedule) en forma reciente

**Que es:** El recency delta actual (§9) compara los ultimos N_RECENT=5 partidos contra
la media de la temporada, pero NO ajusta por la calidad de los rivales enfrentados recientemente.
Un equipo que enfrento 5 rivales del fondo de la tabla y otro que enfrento 5 top-5 tienen
el mismo recency delta si sus resultados relativos son iguales.

**Estado actual:** El rival_adjustment (§8) ya normaliza signals por calidad del rival,
pero lo hace por partido individual. El recency delta usa esos signals RA, asi que
*ya incorpora SoS implicitamente a traves de rival-adjustment*.

**Diagnostico:** La pregunta real es: esta el SoS suficientemente capturado por el
rival-adjustment actual, o hay valor adicional en un factor explicito?

El rival-adjustment divide goles scored/conceded por la effective rate del rival:
```
attack_signal_i  = goals_scored_i   / rival_defense_baseline_i
defense_signal_i = goals_conceded_i / rival_attack_baseline_i
```

Esto ya es una forma de SoS. El recency delta luego promedia estos signals ajustados.
La mejora potencial es *ponderar* los N_RECENT partidos por la calidad del rival
en vez de promediar uniformemente.

**Formula propuesta:**
```
weight_i = 1 + SOS_SENSITIVITY * (rival_strength_i - league_avg_strength)
rival_strength_i = (opp_attack_eff + opp_defense_eff) / 2
league_avg_strength = 1.0 (por definicion, ya que effective rates estan normalizadas)

delta_attack = weighted_avg(attack_signal_recent, weight_i) / season_attack
```

**SOS_SENSITIVITY:** Parametro en [0, 0.5]. A 0 se comporta como hoy. A 0.5, un rival
con strength 1.3 (top team) pesa 1.15x mas que un rival promedio.

**Donde se integra:** Modificacion de `computeRecencyDeltas` en `recency.ts`.
Las signals RA ya contienen la info del rival (son rival-adjusted), pero el promedio
actual es uniforme. El cambio agrega ponderacion por rival_strength.

**Requiere datos nuevos?** No -- la effective rate del rival ya se computa en v3-engine.ts
(via `getOpponentEffective`). Solo se necesita pasar las strengths al modulo de recency.

**Impacto estimado:** +0.2-0.5pp accuracy. Beneficia especialmente a equipos que
alternan rivales fuertes y debiles (comun en mid-table).

**Riesgo:** Con N_RECENT=5, la ponderacion tiene pocas observaciones. Si SOS_SENSITIVITY
es demasiado alto, un partido contra un top team domina el delta. Mitigacion: clip
SOS_SENSITIVITY <= 0.3 y verificar en walk-forward.

#### 2.1.3 Rho Dinamico por Liga

**Estado actual:** `DC_RHO = -0.15` fijo para todas las ligas y temporadas.
El estimador empirico `estimateDcRho` existe pero no se usa en produccion
(backtest evidence: fijo supera al empirico en +0.035 composite score).

**Por que el estimador empirico falla:** Usa lambdas promedio de liga como proxies
de lambdas per-partido. Esto homogeneiza el efecto de scores bajos y produce
estimaciones suboptimas.

**Propuesta:** Rho fijo por liga, estimado offline via grid search sobre datos historicos
completos (no los baselines promedio del estimador actual).

**Metodo:**
1. Para cada liga, correr walk-forward con DC_RHO en [-0.25, 0.00] step 0.01
2. Seleccionar el rho que maximiza composite score para esa liga
3. Hardcodear como default per-liga, con fallback a -0.15 para ligas nuevas

**Formato:**
```typescript
const DC_RHO_PER_LEAGUE: Record<string, number> = {
  'PD':  -0.14,  // LaLiga: empates frecuentes, home advantage moderado
  'PL':  -0.16,  // Premier: mas 0-0 de lo esperado
  'BL1': -0.12,  // Bundesliga: mas goles, menos correlacion scores bajos
};
```

**Estimado por liga o por temporada-liga?** Por liga solamente. La correlacion
de scores bajos es un parametro estructural de la liga (estilo de juego, arbitraje)
que cambia poco entre temporadas. Estimar por temporada-liga requeriria ~150+
partidos (media temporada) para convergir -- demasiado tarde para ser util.

**Cuantos partidos minimos?** Para que el grid search sea fiable, necesitamos al
menos una temporada completa (~380 partidos) por liga. Los datos 2024-25 + 2025-26
proveen ~760 partidos por liga, suficiente para un sweep estable.

**Fallback:** Si una liga tiene <200 partidos historicos (ej: URU Clausura 15 partidos
por equipo), usar DC_RHO = -0.15 (default actual).

**Implementacion:** En `v3-engine.ts`, reemplazar:
```typescript
// Antes:
const estimatedRho = dcRhoOverride ?? DC_RHO;
// Despues:
const leagueRho = DC_RHO_PER_LEAGUE[leagueCode] ?? DC_RHO;
const estimatedRho = dcRhoOverride ?? leagueRho;
```

Requiere pasar `leagueCode` como nuevo campo en `V3EngineInput` (o derivarlo del
competitionId que ya existe en el caller).

**Impacto estimado:** +0.2-0.4pp accuracy. El mayor beneficio sera en BL1 (donde
rho=-0.15 puede estar sobre-corrigiendo en una liga de mas goles).

**Sigue en `_overrideConstants`?** Si -- el sweep tool sigue usando el override
para experimentar con valores. Pero el default cambia de constante global a lookup.

---

### FASE 2 -- Odds pre-match como signal activa + Lesiones mejoradas

#### 2.2.1 Odds Pre-Match como Signal Activa

**Estado actual:**
- `OddsService` (server/odds/odds-service.ts) ya fetcha odds de The Odds API v4
- Odds se almacenan en `EvaluationStore` para calculo de edge
- `market-blend.ts` ya implementa la mezcla con `MARKET_WEIGHT = 0.15`
- `V3EngineInput.marketOdds?: MarketOddsRecord` ya existe
- **PERO: el market blend no se activa en produccion** -- el v3-shadow-runner no pasa
  marketOdds al engine (solo lo guarda en evaluation store)

**Endpoint exacto:** The Odds API v4: `GET /v4/sports/{sport_key}/odds/`
- Regiones: `eu` (Europa -- incluye Bet365, Pinnacle, William Hill, etc.)
- Markets: `h2h` (1X2)
- Formato: decimal odds
- Costo: 500 req/mes free tier, $79/mes basic (mas que suficiente)

**Bookmaker de referencia:** El servicio actual promedia todos los bookmakers disponibles
y hace de-vig via normalizacion. Esto es correcto -- el consenso de mercado es mejor
predictor que un bookmaker individual. Pinnacle es el mas eficiente pero no siempre
esta disponible. El promedio ponderado es la mejor estrategia practica.

**Conversion odds decimales a probabilidades implicitas (vig removal):**
Ya implementado en `OddsService._matchEvent()`:
```typescript
const rawHome = 1 / avgHome;
const rawDraw = 1 / avgDraw;
const rawAway = 1 / avgAway;
const total = rawHome + rawDraw + rawAway;
const probHome = rawHome / total;  // de-vigged
```
Metodo: normalizacion simple (divide por suma). Alternativas mas sofisticadas
(Shin, power, margin proportional) dan resultados similares con odds de mercados
eficientes. El metodo actual es correcto para la precision que necesitamos.

**Como integrar en el pipeline:**
El `market-blend.ts` ya existe y funciona. La activacion requiere:
1. En `runMatchPredictions()` (v3-shadow-runner), fetchear odds via OddsService
2. Construir `MarketOddsRecord` desde `ImpliedOdds`
3. Pasar como `input.marketOdds` al engine

**MARKET_WEIGHT actual: 0.15** (85% modelo + 15% mercado).
Post-Fase1 (con xG), el modelo sera mejor -- el peso optimo podria ser menor.
Propuesta: sweep MARKET_WEIGHT en [0.05, 0.30] step 0.05 post-xG.

**Que hacer cuando odds no estan disponibles:**
- Ligas menores (URU): The Odds API puede no cubrir todos los partidos. Fallback:
  `marketOdds = undefined` -> sin blend (modelo puro). Ya implementado.
- Partidos lejanos (>7 dias): Odds disponibles pero menos informativas (early market).
  Propuesta: no filtrar por distancia temporal -- las opening odds ya capturan
  informacion valiosa. El peso MARKET_WEIGHT regula cuanto confiar.
- Disponibilidad tipica: odds estan disponibles ~7 dias antes del kickoff para
  ligas top (PD/PL/BL1). Para partidos del matchday actual, disponibilidad ~100%.

**Impacto estimado:** +1.0-2.0pp accuracy. Las odds de mercado son el mejor
predictor individual de futbol. Incluso con peso bajo (15%), el efecto es significativo
porque corrigen sesgos sistematicos del modelo (ej: sobre-estimacion de home advantage).

#### 2.2.2 Lesiones Mejoradas

**Estado actual:** Ya implementado.
- `InjurySource` (server/prediction/injury-source.ts) fetcha de API-Football `/injuries`
- `absence-adjustment.ts` computa multiplicadores de lambda por equipo
- `LineupSource` (server/prediction/lineup-source.ts) detecta ausencias adicionales — fetchea a partir de T-15min pre-match

**Endpoint exacto:** API-Football v3 `GET /injuries?league={id}&season={year}&date={YYYY-MM-DD}`
Retorna: jugador, tipo (injury/suspension/doubtful), fecha de retorno estimada.

**Mejoras propuestas para Fase 2:**

1. **Importancia basada en minutos jugados** (no en constantes fijas):
   Actualmente `importance` es un input externo (0..1) que viene de la fuente.
   En la practica, `InjurySource` no tiene acceso a minutos jugados del jugador.
   Mejora: usar API-Football `/players?id={id}&season={year}` para obtener minutos
   jugados y derivar `importance = min_played / max_possible_minutes`.
   Costo: 1 request por jugador lesionado, ~5-15 por partido.

2. **Ajuste posicional diferenciado:**
   Actualmente `ABSENCE_IMPACT_FACTOR = 0.04` es uniforme para todas las posiciones.
   Mejora: factores diferenciados:
   ```typescript
   const POSITION_IMPACT: Record<PlayerPosition, number> = {
     GK:  0.06,   // Portero titular ausente: max impacto defensivo
     DEF: 0.035,  // Defensa central: impacto moderado
     MID: 0.03,   // Mediocampista: menor impacto individual
     FWD: 0.05,   // Delantero titular: alto impacto ofensivo
   };
   ```
   Y aplicar la penalizacion de forma dirigida:
   - GK/DEF ausente -> penaliza defense lambda del equipo
   - FWD/MID creativo ausente -> penaliza attack lambda del equipo

3. **Threshold de importancia:** Solo jugadores con `importance >= 0.3` (>30% de minutos posibles)
   afectan el modelo. Suplentes con <30% tienen impacto marginal.

**Impacto estimado:** +0.3-0.8pp accuracy. El efecto es concentrado: en partidos donde
hay bajas significativas el modelo mejora mucho, en partidos sin bajas no cambia nada.
El impacto promedio depende de la frecuencia de bajas significativas (~20-30% de partidos).

---

### FASE 3 -- Ensemble Poisson + Logistica

#### 2.3.1 Cuando Implementar

Despues de Fase 1 y Fase 2. Razon: el ensemble necesita features estabilizadas.
Si xG o odds cambian post-ensemble, hay que re-entrenar. Mejor construir el
ensemble sobre la version final del feature set.

#### 2.3.2 Forma del Ensemble

**Propuesta: Weighted average con pesos aprendidos por tipo de partido.**

No un meta-learner full (stacking) porque:
- Muestra limitada (~600 partidos/temporada para 3 ligas)
- Riesgo de overfitting alto con meta-learner
- El weighted average es mas robusto y explicable

**Componentes del ensemble:**

| Componente | Que produce | Fortaleza |
|-----------|------------|-----------|
| Poisson-DC V4 (modelo actual post-Fase2) | 1X2 probs desde lambdas | Captura fuerza de equipo, forma, xG |
| Market Consensus (odds de-vigged) | 1X2 probs implicitas | Captura toda la informacion publica |
| Logistic 1X2 (nuevo) | 1X2 probs desde features tabulares | Captura interacciones no-lineales |

**Regresion logistica (componente nuevo):**

Features para la logistica:
```
- lambda_home, lambda_away (del modelo Poisson)
- home_advantage_mult (ratio real de la liga)
- rest_days_home, rest_days_away
- h2h_mult_home, h2h_mult_away
- absence_score_home, absence_score_away
- xg_coverage (0..1)
- balance_ratio (min_lambda/max_lambda)
- table_proximity (ppg_diff)
- draw_propensity_home, draw_propensity_away
- league_code (one-hot: PD, PL, BL1)
```

Entrenada via walk-forward cross-validation (misma estructura que el sweep actual).
Output: P(home), P(draw), P(away) via softmax.

**Pesos del ensemble:**
```
final_prob = w_poisson * p_poisson + w_market * p_market + w_logistic * p_logistic
```
Pesos aprendidos via minimizacion de RPS sobre el training fold del walk-forward.
Restricciones: w_i >= 0, sum(w_i) = 1.

**Impacto estimado:** +0.5-1.5pp accuracy sobre el mejor componente individual.
El mayor beneficio esta en partidos donde Poisson y mercado divergen -- la logistica
actua como arbitradora.

---

## 3. Impacto en Arquitectura Actual

### 3.1 Fase 1 -- Archivos Modificados

| Archivo | Cambio | Tipo |
|---------|--------|------|
| `packages/prediction/src/engine/v3/constants.ts` | Agregar `DC_RHO_PER_LEAGUE`, `SOS_SENSITIVITY` | Modify |
| `packages/prediction/src/engine/v3/types.ts` | Agregar `leagueCode?: string` a `V3EngineInput` | Modify |
| `packages/prediction/src/engine/v3/recency.ts` | Agregar ponderacion por rival_strength (SoS) | Modify |
| `packages/prediction/src/engine/v3/v3-engine.ts` | Pasar leagueCode a rho lookup, rival strengths a recency | Modify |
| `server/prediction/xg-source-sofascore.ts` | **Nuevo** -- XgSource alternativo via SofaScore MCP | Create |
| `server/prediction/v3-shadow-runner.ts` | Soportar SofaScore XgSource como alternativa | Modify |
| `tools/sweep-rho-per-league.ts` | **Nuevo** -- Grid search de rho optimo por liga | Create |
| `tools/gen-calibration.ts` | Regenerar post-xG (ya existe, solo re-correr) | No change |

**Archivos nuevos:** 2
**Archivos modificados:** 5
**Cambios en contratos publicos:** Si -- `V3EngineInput.leagueCode` (optional, backward-compatible)
**Cambios en server/:** Si -- `v3-shadow-runner.ts`, nuevo `xg-source-sofascore.ts`
**Cambios en packages/api/:** No
**Afecta output DTO:** No -- engine_version bump a '4.1' en V3PredictionOutput
**Requiere recalibracion:** Si -- regenerar tabla isotonica post-xG

### 3.2 Fase 2 -- Archivos Modificados

| Archivo | Cambio | Tipo |
|---------|--------|------|
| `server/prediction/v3-shadow-runner.ts` | Pasar `marketOdds` al engine desde OddsService | Modify |
| `packages/prediction/src/engine/v3/absence-adjustment.ts` | Factores posicionales diferenciados | Modify |
| `packages/prediction/src/engine/v3/constants.ts` | `POSITION_IMPACT` record, `MIN_IMPORTANCE_THRESHOLD` | Modify |
| `server/prediction/injury-source.ts` | Fetchear minutos jugados para importance derivada | Modify |

**Archivos nuevos:** 0
**Archivos modificados:** 4
**Cambios en contratos publicos:** No (MarketOddsRecord ya existe)
**Cambios en server/:** Si -- shadow runner + injury source
**Cambios en packages/api/:** No
**Afecta output DTO:** Si -- engine_version bump a '4.2', explanation ya tiene market_blend fields
**Requiere recalibracion:** Si -- post market-blend activation

### 3.3 Fase 3 -- Archivos Modificados

| Archivo | Cambio | Tipo |
|---------|--------|------|
| `packages/prediction/src/engine/v3/logistic-model.ts` | **Nuevo** -- Regresion logistica 1X2 | Create |
| `packages/prediction/src/engine/v3/ensemble.ts` | **Nuevo** -- Combinador weighted average | Create |
| `packages/prediction/src/engine/v3/v3-engine.ts` | Integrar ensemble post-Poisson | Modify |
| `packages/prediction/src/engine/v3/types.ts` | Agregar `EnsembleWeights` a output/explanation | Modify |
| `packages/prediction/src/engine/v3/constants.ts` | Pesos default del ensemble | Modify |
| `tools/train-logistic.ts` | **Nuevo** -- Entrenamiento de la logistica | Create |
| `tools/sweep-ensemble-weights.ts` | **Nuevo** -- Optimizacion de pesos del ensemble | Create |

**Archivos nuevos:** 4
**Archivos modificados:** 3
**Cambios en contratos publicos:** Si -- `V3Explanation` agrega ensemble fields
**Afecta output DTO:** Si -- engine_version bump a '4.3', nuevos campos en explanation
**Requiere recalibracion:** Si -- post-ensemble la distribucion de probs cambia

---

## 4. Riesgos y Mitigaciones

### 4.1 Fase 1

| # | Riesgo | Severidad | Mitigacion | Criterio de Abort |
|---|--------|-----------|------------|-------------------|
| R1-1 | xG backfill incompleto por limites de MCP/API | Alta | SofaScore MCP como alternativa a API-Football budget. Fallback a goles reales (ya implementado). Backfill incremental. | Si coverage <50% de partidos tras 2 semanas, reevaluar fuente |
| R1-2 | SoS weighting introduce ruido con N_RECENT=5 | Media | Clip SOS_SENSITIVITY en [0, 0.3]. Sweep en walk-forward. Si no mejora, SOS_SENSITIVITY=0 (equivale a estado actual). | Si walk-forward con SoS es peor que sin el en >0.5pp, desactivar |
| R1-3 | Rho per-liga overfits a datos 2025-26 | Media | Usar 2 temporadas (2024-25 + 2025-26) para el sweep. Cross-validar entre temporadas. Mantener fallback global DC_RHO=-0.15 para ligas con pocos datos. | Si rho per-liga no mejora vs global en >0.3pp, mantener global |

### 4.2 Fase 2

| # | Riesgo | Severidad | Mitigacion | Criterio de Abort |
|---|--------|-----------|------------|-------------------|
| R2-1 | Odds no disponibles para partidos URU | Alta | Market blend es optional -- sin odds, modelo puro. URU ya opera sin odds. Solo PD/PL/BL1 se benefician. | No aplica abort -- degradation graceful |
| R2-2 | MARKET_WEIGHT optimo depende del modelo base | Media | Sweep MARKET_WEIGHT despues de cada cambio de modelo (post-xG). Si el modelo mejora, el peso optimo baja (menos necesidad de mercado). | Si MARKET_WEIGHT optimo < 0.05, desactivar blend |
| R2-3 | API-Football budget insuficiente para injuries+minutos | Alta | Cache agresivo en disco (injuries TTL 12h, player stats TTL 30 dias). Priorizar partidos del matchday actual. Evaluar SofaScore como fuente alternativa. | Si <30% de partidos tienen injury data, deprioritizar mejoras |

### 4.3 Fase 3

| # | Riesgo | Severidad | Mitigacion | Criterio de Abort |
|---|--------|-----------|------------|-------------------|
| R3-1 | Overfitting de la logistica con ~600 observaciones | Alta | Regularizacion L2 fuerte. Walk-forward strict (nunca entrenar en test fold). Cross-validar con leave-one-league-out. | Si la logistica sola es peor que el baseline en >1pp, no incluir en ensemble |
| R3-2 | Ensemble no supera componentes individuales | Media | Es esperado si los componentes estan altamente correlacionados. Medir correlacion de errores antes de construir ensemble. Si corr > 0.8, el ensemble tiene poco que agregar. | Si ensemble no supera el mejor componente en >0.3pp, descartar y mantener weighted model+market |
| R3-3 | Complejidad de mantenimiento del pipeline | Media | Mantener el ensemble como modulo aislado (`ensemble.ts`). Si se desactiva, el motor vuelve al Poisson puro con market blend. Feature flag `ENSEMBLE_ENABLED`. | Si la complejidad de debugging supera el beneficio, desactivar |

---

## 5. Plan de Tickets

### Fase 1 -- xG + SoS + Rho

| ID | Descripcion | Deps | Agente PE | Tier | Size | Acceptance Criteria |
|----|------------|------|-----------|------|------|---------------------|
| SP-V4-01 | SofaScore XgSource: crear adaptador MCP para xG historico | -- | match-prediction-engine | sonnet | M | `SofaScoreXgSource.getHistoricalXg()` retorna XgRecord[] para PD/PL/BL1. Tests unitarios con mock MCP. |
| SP-V4-02 | xG Backfill: poblar cache/xg/ con datos 2025-26 via SofaScore | SP-V4-01 | match-prediction-engine | sonnet | M | >=80% coverage de partidos FINISHED para PD, PL, BL1 2025-26. Cache en disco persistente. |
| SP-V4-03 | Rho per-liga: sweep tool + constantes | -- | calibration-decision-policy | sonnet | M | `sweep-rho-per-league.ts` produce tabla de rho optimos. `DC_RHO_PER_LEAGUE` en constants.ts. Walk-forward muestra acc >= baseline. |
| SP-V4-04 | V3EngineInput.leagueCode: propagar desde shadow runner | SP-V4-03 | match-prediction-engine | sonnet | S | leagueCode llega al engine. Rho per-liga se usa en produccion. Tests de integracion. |
| SP-V4-05 | SoS weighted recency: ponderar N_RECENT por rival strength | -- | match-prediction-engine | sonnet | M | `computeRecencyDeltas` acepta rival_strengths. SOS_SENSITIVITY como constante. Walk-forward >= baseline. |
| SP-V4-06 | Calibracion post-xG: regenerar tablas isotonicas | SP-V4-02,SP-V4-04,SP-V4-05 | calibration-decision-policy | sonnet | S | Tablas regeneradas en `cache/calibration/`. Walk-forward con xG+SoS+rho per-liga cumple targets Fase 1. |
| SP-V4-07 | Auditoria Fase 1: walkforward completo + artefacto audit | SP-V4-06 | predictive-engine-auditor | opus | S | `docs/audits/PE-audit-YYYY-MM-DD.md` con dictamen. Targets: acc>=51.5%, DR>=51%, DP>=35%. |

### Fase 2 -- Odds + Lesiones

| ID | Descripcion | Deps | Agente PE | Tier | Size | Acceptance Criteria |
|----|------------|------|-----------|------|------|---------------------|
| SP-V4-10 | Market blend activation: pasar odds al engine en shadow runner | SP-V4-07 (Fase 1 auditada) | match-prediction-engine | sonnet | S | `input.marketOdds` populated cuando OddsService retorna odds. Walk-forward con blend >= Fase 1 acc + 0.5pp. |
| SP-V4-11 | MARKET_WEIGHT sweep post-Fase1 | SP-V4-10 | calibration-decision-policy | sonnet | S | Sweep MARKET_WEIGHT [0.05, 0.30]. Optimo documentado. Constante actualizada si difiere de 0.15. |
| SP-V4-12 | Importance basada en minutos jugados | -- | match-prediction-engine | sonnet | M | InjurySource enriches importance via player stats API. Cache 30d en disco. Tests con mocks. |
| SP-V4-13 | Factores posicionales en absence-adjustment | SP-V4-12 | match-prediction-engine | sonnet | S | POSITION_IMPACT record. GK/FWD penalizan defense/attack lambda respectivamente. Tests unitarios. |
| SP-V4-14 | Calibracion post-Fase2 | SP-V4-10,SP-V4-13 | calibration-decision-policy | sonnet | S | Tablas regeneradas. Walk-forward cumple targets Fase 2. |
| SP-V4-15 | Auditoria Fase 2 | SP-V4-14 | predictive-engine-auditor | opus | S | Artefacto audit. Targets: acc>=53%, DR>=51%, DP>=36%. |

### Fase 3 -- Ensemble

| ID | Descripcion | Deps | Agente PE | Tier | Size | Acceptance Criteria |
|----|------------|------|-----------|------|------|---------------------|
| SP-V4-20 | Logistic model: feature extraction + training tool | SP-V4-15 (Fase 2 auditada) | match-prediction-engine | sonnet | L | `logistic-model.ts` pure function. `train-logistic.ts` CLI tool. Walk-forward AUC > baseline. |
| SP-V4-21 | Ensemble combinator: weighted average module | SP-V4-20 | match-prediction-engine | sonnet | M | `ensemble.ts` con `combineEnsemble(poisson, market, logistic, weights)`. Tests de invariantes (sum=1, non-negative). |
| SP-V4-22 | Ensemble weight optimization tool | SP-V4-21 | calibration-decision-policy | sonnet | M | `sweep-ensemble-weights.ts`. Pesos optimos documentados. |
| SP-V4-23 | Integration: ensemble en v3-engine + feature flag | SP-V4-21,SP-V4-22 | match-prediction-engine | sonnet | M | `ENSEMBLE_ENABLED` flag. Cuando activo, pipeline: Poisson -> MarketBlend -> Logistic -> Ensemble -> Calibration -> DrawAffinity. |
| SP-V4-24 | Calibracion post-ensemble | SP-V4-23 | calibration-decision-policy | sonnet | S | Tablas regeneradas. Walk-forward cumple targets Fase 3. |
| SP-V4-25 | Auditoria Fase 3 | SP-V4-24 | predictive-engine-auditor | opus | S | Artefacto audit. Targets: acc>=54.5%, DR>=51%, DP>=37%. |

---

## 6. Secuencia de Implementacion y Dependencias

```
FASE 1 (estimacion: 2-3 semanas)
==================================

  SP-V4-01 SofaScore XgSource ──────┐
                                     ├── SP-V4-02 xG Backfill ──┐
  SP-V4-03 Rho per-liga (paralelo) ──┤                           │
                                     ├── SP-V4-04 leagueCode ───┤
  SP-V4-05 SoS recency (paralelo) ──┘                           │
                                                                  ├── SP-V4-06 Calibracion
                                                                  │
                                                                  └── SP-V4-07 Auditoria
                                                                       │
FASE 2 (estimacion: 2 semanas)                                        │
==================================                                     │
                                                                       ▼
  SP-V4-10 Market blend activation ──────────────────────────────── (gate: Fase 1 OK)
  SP-V4-11 MARKET_WEIGHT sweep ──────── (depende SP-V4-10)
  SP-V4-12 Importance minutos ────┐
                                   ├── SP-V4-13 Factores posicionales
  (paralelo con SP-V4-10/11) ────┘        │
                                           ├── SP-V4-14 Calibracion
                                           └── SP-V4-15 Auditoria
                                                 │
FASE 3 (estimacion: 2-3 semanas)                 │
==================================                │
                                                  ▼
  SP-V4-20 Logistic model ────── SP-V4-21 Ensemble combinator ──── (gate: Fase 2 OK)
                                       │
  SP-V4-22 Weight sweep ──────────────┤
                                       ├── SP-V4-23 Integration
                                       │
                                       ├── SP-V4-24 Calibracion
                                       └── SP-V4-25 Auditoria

CRITICAL PATH: SP-V4-01 -> 02 -> 06 -> 07 -> 10 -> 14 -> 15 -> 20 -> 23 -> 25
PARALLELIZABLE: SP-V4-03/05 con SP-V4-01; SP-V4-12/13 con SP-V4-10/11
```

---

## 7. Metricas de Exito por Fase

| Fase | Accuracy Target | DR Target | DP Target | Composite Target | Criterio de Fracaso (Rollback) |
|------|----------------|-----------|-----------|------------------|-------------------------------|
| Fase 1 | >=51.5% | >=51% | >=35% | >= 0.390 | Si acc cae >1pp vs V3 actual (50.7%) |
| Fase 2 | >=53% | >=51% | >=36% | >= 0.420 | Si acc no mejora >1pp vs post-Fase1 |
| Fase 3 | >=54.5% | >=51% | >=37% | >= 0.440 | Si ensemble no supera el mejor componente individual |

**Composite Score = 0.4 * accuracy + 0.3 * draw_recall + 0.3 * draw_precision**
(Misma formula usada en los sweeps V3)

**Criterio de rollback por liga:**
Ademas del aggregate, cada liga debe mantener su accuracy dentro de +-2pp de su baseline individual.
Si una liga cae >2pp, investigar antes de deploy.

| Liga | Baseline Acc V3 | Min Aceptable |
|------|----------------|---------------|
| PD   | ~52% | >=50% |
| PL   | ~48% | >=46% |
| BL1  | ~52% | >=50% |

---

## 8. Consideraciones de Producto

### 8.1 Cambios en UI de Pronosticos por Fase

**Fase 1 (xG + SoS + Rho):**
- No requiere cambios en UI. Los outputs siguen siendo 1X2 probs + markets.
- engine_version cambia a '4.1' -- visible en labs pero no en UI publica.
- La mejora es invisible para el usuario (misma interface, mejores probs).

**Fase 2 (Odds + Lesiones mejoradas):**
- **Odds en UI:** Decision de producto necesaria.
  - Opcion A: NO mostrar odds al usuario. Las odds son input del modelo, no output.
    El usuario ve las probabilidades del modelo (que ya incorporan informacion del mercado).
    Ventaja: mas limpio, sin implicaciones legales.
  - Opcion B: Mostrar "Consenso de mercado" como referencia, con disclaimer.
    Ventaja: transparencia, el usuario puede comparar modelo vs mercado.
  - **Recomendacion: Opcion A para MVP.** Las odds son una señal interna del modelo.
    Mostrarlas abre preguntas de regulacion y "parece apuestas". En el futuro,
    la pagina /analytics puede mostrar la comparativa modelo vs mercado para
    usuarios avanzados.
- **Lesiones mejoradas en UI:** Ya existe `PredictionExperimentalSection` en DetailPanel.
  El campo `absence_adjustment_applied` ya se expone. Mejora sugerida: si
  `absence_count_home > 0 || absence_count_away > 0`, mostrar un chip
  "X bajas afectan esta prediccion" con tooltip detallando posiciones.

**Fase 3 (Ensemble):**
- No requiere cambios en UI. El ensemble es transparente para el usuario.
- La explicacion interna (`V3Explanation`) tendra nuevos campos pero no se
  muestran en el frontend.

### 8.2 Comunicacion de Confianza

Actualmente el modelo tiene `confidence: HIGH | MEDIUM | LOW | INSUFFICIENT`.

Con odds disponibles (Fase 2), la confianza podria modularse:
- Si modelo y mercado coinciden (ambos predicen HOME_WIN): confianza reforzada.
- Si divergen significativamente: confianza degradada.

**Propuesta:** Agregar campo `model_market_agreement: 'AGREE' | 'DISAGREE' | 'NO_MARKET'`
en la explanation. No cambiar el enum de confidence -- usarlo como señal informativa
en UI ("El modelo y el mercado coinciden en esta prediccion").

### 8.3 Implicaciones Legales de Mostrar Odds

- **En Uruguay:** La regulacion de apuestas (Ley 17.453) regula casas de apuestas,
  no la muestra informativa de probabilidades. Mostrar "odds de mercado" como dato
  informativo no requiere licencia.
- **En general:** SportsPulse NO es una casa de apuestas, no toma dinero, no ofrece
  cuotas. Mostrar probabilidades implicitas del mercado es equivalente a citar
  datos publicos (como Oddschecker o similar).
- **Precaucion:** Incluir disclaimer: "Probabilidades de mercado son informativas.
  SportsPulse no es una casa de apuestas y no promueve el juego."
- **Recomendacion:** Para MVP, NO mostrar odds. Fase posterior puede agregar
  la comparativa en /analytics con disclaimer.

---

## Appendix A: Datos Clave del Codebase

### Pipeline Actual V3

```
Anti-lookahead filter
  -> xG Augmentation (T3-01, ya implementado)
  -> League Baselines (§4)
  -> Team Stats TD (§5)
  -> Eligibility (§14, early exit)
  -> Shrinkage Bayesiano (§6)
  -> Prior temporada anterior (§7)
  -> Rival Adjustment (§8)
  -> Recency Deltas (§9)
  -> Lambda Computation (§10+§11)
  -> Rest Adjustment (T2-01)
  -> H2H Adjustment (T2-02)
  -> Goal Form (T2-03, informacional)
  -> Absence Adjustment (T3-02+03)
  -> Poisson Matrix + Dixon-Coles (§12+§13)
  -> Market Blend (T3-04, INACTIVE in prod)
  -> Isotonic Calibration
  -> Draw Affinity
  -> Confidence (§15)
  -> Predicted Result (§18)
  -> Markets (T1)
```

### Constantes Clave Actuales

| Constante | Valor | Descripcion |
|-----------|-------|-------------|
| DC_RHO | -0.15 | Dixon-Coles rho (fijo global) |
| K_SHRINK | 3 | Equivalente de partidos del prior de liga |
| PRIOR_EQUIV_GAMES | 16 | Peso del prior de temporada anterior |
| BETA_RECENT | 0.20 | Elasticidad de recency en lambdas |
| MARKET_WEIGHT | 0.15 | Peso de odds en blend (inactivo) |
| DRAW_AFFINITY_ALPHA | 0.50 | Intensidad del boost de empate |
| DRAW_AFFINITY_POWER | 2.0 | Exponente del balance ratio |
| N_RECENT | 5 | Partidos para recency delta |

### Fuentes de Datos Existentes

| Fuente | Implementada | Estado | Costo |
|--------|-------------|--------|-------|
| API-Football (xG historico) | XgSource | Activa, incremental | Budget compartido 100/dia |
| API-Football (injuries) | InjurySource | Activa | Budget compartido |
| API-Football (lineups) | LineupSource | Activa (T-15min pre-match) | Budget compartido |
| The Odds API (h2h odds) | OddsService | Activa (solo evaluacion) | 500 req/mes free |
| SofaScore MCP (statistics) | NO | Disponible via RapidAPI | Independiente de API-Football |

---

---

## Fase 4 — Activar features implementadas pero inactivas (2026-03-17)

**Contexto:** Tras completar Fases 1-3 + SP-DRAW-V1, el motor está en V4.4 con accuracy=54.9%.
Diagnóstico realizado el 2026-03-17 reveló que tres features del plan están **implementadas en código
pero inactivas** — nunca contribuyeron al 54.9%. Son el margen de mejora más directo hacia el 57%.

### Estado real de features post-Fase-3

| Feature | Código | Estado real | Efecto en accuracy |
|---------|--------|-------------|--------------------|
| DC_RHO per-liga | ✅ | ACTIVO (PD=-0.25, PL=-0.19, BL1=-0.14) | Contribuye |
| Market blend (w=0.20) | ✅ | ACTIVO | Contribuye |
| Isotonic calibration | ✅ | ACTIVO | Contribuye |
| DRAW_FLOOR rule | ✅ | ACTIVO (0.26/0.15) | Contribuye |
| Positional injuries | ✅ | ACTIVO | Contribuye |
| **xG augmentation** | ✅ | **INACTIVO — cache/xg/ vacío (0% cobertura)** | **0 beneficio actual** |
| **SoS weighted recency** | ✅ | **INACTIVO — SOS_SENSITIVITY=0.0** | **0 beneficio actual** |
| **Logistic model** | ✅ | **INACTIVO — w_logistic=0.00, ENSEMBLE_ENABLED=false** | **0 beneficio actual** |
| HOME_ADVANTAGE_MULT per-liga | ❌ | No implementado — constante global 1.12 | Pendiente |

### Hoja de ruta Fase 4 (ordenada por impacto estimado/esfuerzo)

| ID | Acción | Impacto estimado | Esfuerzo | Dependencia |
|----|--------|-----------------|---------|-------------|
| SP-V4-30 | Poblar cache/xg/ via SofaScore MCP (SofaScoreXgSource ya existe) | +0.5–1.0pp | M | Ninguna — adaptador listo |
| SP-V4-31 | Regenerar calibración post-xG (gen-calibration.ts) | parte de SP-V4-30 | S | SP-V4-30 |
| SP-V4-32 | Sweep SOS_SENSITIVITY en [0.0..0.3 step 0.05] — activar si mejora | +0.2–0.5pp | S | Ninguna |
| SP-V4-33 | Logistic con 4 features de empate (SP-DRAW-V1 Fase 2: home_draw_rate, away_draw_rate, h2h_draw_rate, table_proximity) + re-train | desconocido (puede ser 0) | M | SP-V4-31 |
| SP-V4-34 | HOME_ADVANTAGE_MULT per-liga derivado de datos históricos (sweep por liga) | +0.1–0.3pp | M | SP-V4-30 |

### Targets Fase 4

| Métrica | Actual (V4.4) | Target Fase 4 |
|---------|--------------|---------------|
| Accuracy | 54.9% | ≥56.0% |
| DRAW recall | 28.2% | ≥25% (mantener) |
| engine_version | 4.4 | 4.5 |

**Techo razonable con xG + SoS activados:** ~55.5–56.0%.
**Techo aspiracional (57%):** requiere xG + SoS + logistic con features de empate activo.

### Definition of Done Fase 4

- cache/xg/ tiene ≥80% cobertura para PD/PL/BL1 2025-26
- Walk-forward con xG muestra acc ≥ 55.5%
- SOS_SENSITIVITY > 0 si sweep muestra mejora; 0.0 si no mejora
- engine_version = '4.5'
- Suite completa pasa (pnpm -r test)
- Auditoría PE formal post-Fase4

---

## Appendix B: SofaScore xG Data Format (Verificado)

El endpoint `Get_match_statistics` con `match_id` retorna un array de periodos.
Periodo `ALL` contiene en `Match overview`:

```json
{
  "key": "expectedGoals",
  "homeValue": 2.09,
  "awayValue": 0.48
}
```

- `homeValue` / `awayValue`: xG total por equipo (float, 2 decimales).
- Disponible para periodos ALL, 1ST, 2ND.
- Para nuestro uso (XgRecord), tomamos el periodo ALL.
- El match_id de SofaScore es un entero numerico. Se necesita mapeo externo
  (via `Get_matches_by_date`) para obtener el match_id dado fecha + equipos.
