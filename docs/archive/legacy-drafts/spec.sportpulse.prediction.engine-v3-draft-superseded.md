# SP-PRED-V3 — Motor Predictivo Unificado

**Estado:** BORRADOR — pendiente aprobación
**Fecha:** 2026-03-15
**Versión:** 0.1
**Reemplaza:** Motor Radar (radar-api-adapter.ts), Motor V1 (prediction-service.ts / elo-rating.ts), Motor V2 (v2-engine.ts)
**Autor:** SportsPulse Architecture

---

## §1 — Contexto y propósito

El portal tiene tres implementaciones de predicción independientes:

| Motor | Archivo | Problema |
|---|---|---|
| Radar | `server/radar/radar-api-adapter.ts` | Sin persistencia, sin prior de temporada anterior, sin rival adjustment, sin explicabilidad |
| V1 | `packages/prediction/src/engine/elo-rating.ts` | Elo sin historial real, BASE_GOALS fijo, calibración sin entrenar, no llega al portal |
| V2 | `packages/prediction/src/engine/v2/v2-engine.ts` | Sin time-decay, sin DC-correction, sin venue split dinámico, no llega al portal |

Este spec define **V3**: un motor único que absorbe las fortalezas de los tres y elimina todas las debilidades. V3 reemplaza completamente a los tres.

---

## §2 — Principios de diseño

1. **Un motor, una fuente de verdad.** El portal consume V3 directamente. No hay cálculos de probabilidad fuera de V3.
2. **Sin parámetros hardcodeados evitables.** Toda constante que puede derivarse de datos observados, se deriva. Solo se hardcodea lo que es genuinamente estable (e.g. decay rate, corrección DC).
3. **Función pura y determinista.** Mismos inputs → mismos outputs. Sin IO, sin timestamps de entorno dentro del motor.
4. **Explicabilidad en cada output.** Cada predicción expone qué señales pesaron y cuánto.
5. **Degradación elegante.** Sin suficientes datos, el motor declara su nivel de confianza y retorna probabilidades conservadoras ancladas al baseline de liga — nunca crashea ni retorna null.
6. **Un solo store de evaluación.** Toda predicción se persiste con `engine_id='v3_unified'` en el `PredictionStore` existente.

---

## §3 — Inputs

```typescript
interface V3EngineInput {
  homeTeamId: string;
  awayTeamId: string;
  kickoffUtc: string;                    // ISO-8601 UTC
  buildNowUtc: string;                   // Anchor temporal (≤ kickoffUtc)
  currentSeasonMatches: V3MatchRecord[]; // Temporada actual (todos los jugados)
  prevSeasonMatches: V3MatchRecord[];    // Temporada anterior (puede estar vacío)
}

interface V3MatchRecord {
  homeTeamId: string;
  awayTeamId: string;
  utcDate: string;     // ISO-8601 UTC del partido
  homeGoals: number;
  awayGoals: number;
}
```

**Anti-lookahead:** El motor filtra internamente `utcDate < kickoffUtc` en `currentSeasonMatches`. El caller no necesita pre-filtrar.

**Temporada anterior:** Si `prevSeasonMatches` está vacío (liga en debut, datos no disponibles), el motor usa `LEAGUE_BASELINE` como prior. No es error.

---

## §4 — League Baseline (§LD)

Computar una vez por partido, a partir de `currentSeasonMatches` con `utcDate < buildNowUtc`:

```
baselines.league_home_goals_pg = media de goles locales por partido (FINISHED)
baselines.league_away_goals_pg = media de goles visitantes por partido (FINISHED)
baselines.league_goals_pg      = (league_home_goals_pg + league_away_goals_pg) / 2
```

**Fallback:** si hay < `MIN_GAMES_FOR_BASELINE` (= 10) partidos terminados, usar:

```
league_home_goals_pg = HOME_GOALS_FALLBACK = 1.45
league_away_goals_pg = AWAY_GOALS_FALLBACK = 1.15
```

Estos valores son el promedio europeo observado en PD/PL/BL1 (no el 1.35 simétrico de V1).

---

## §5 — Stats por equipo con time-decay (§TD)

Para cada equipo, calcular attack rate y defense rate con ponderación exponencial temporal:

```
weight(match) = exp(−DECAY_XI × days_ago(match, buildNowUtc))

attack_raw_td  = Σ(goals_scored_i  × weight_i) / Σ(weight_i)
defense_raw_td = Σ(goals_conceded_i × weight_i) / Σ(weight_i)
```

**Constante:**
```
DECAY_XI = 0.006   // half-life ≈ 115 días
```

**Venue split:** calcular separado para partidos en casa (venue=HOME) y fuera (venue=AWAY).
Si el equipo tiene ≥ `MIN_GAMES_VENUE` (= 5) partidos en ese venue, usar las stats de venue.
Si tiene < 5, usar las stats totales (sin filtro de venue) con `venueSplit = false`.

Cada equipo tiene:
```typescript
interface TeamTDStats {
  attack_td: number;     // time-decay weighted goals scored per game
  defense_td: number;    // time-decay weighted goals conceded per game
  games: number;         // total games in sample
  venueSplit: boolean;   // whether venue-specific stats were used
}
```

---

## §6 — Shrinkage Bayesiano (§SH)

Aplicar shrinkage de las stats observadas hacia el baseline de liga:

```
attack_shrunk  = (games × attack_td  + K_SHRINK × league_goals_pg) / (games + K_SHRINK)
defense_shrunk = (games × defense_td + K_SHRINK × league_goals_pg) / (games + K_SHRINK)
```

**Constante:**
```
K_SHRINK = 5   // equivalent prior sample size
```

Con pocos partidos (games ≪ 5): resultado anclado al baseline.
Con muchos partidos (games ≫ 5): resultado converge al observado.

---

## §7 — Prior de temporada anterior (§PR)

Si `prevSeasonMatches` no está vacío, calcular stats de la temporada anterior para cada equipo (sin time-decay — todos los partidos del año anterior tienen igual peso):

```
prior_attack  = media de goles marcados por partido (season anterior)
prior_defense = media de goles recibidos por partido (season anterior)
```

Mezclar con las stats actuales post-shrinkage:

```
effective_attack  = ALPHA_CURR × attack_shrunk  + (1 − ALPHA_CURR) × prior_attack
effective_defense = ALPHA_CURR × defense_shrunk + (1 − ALPHA_CURR) × prior_defense
```

**Constante:**
```
ALPHA_CURR = games / (games + PRIOR_EQUIV_GAMES)
PRIOR_EQUIV_GAMES = 8   // prior pesa como 8 partidos de season anterior
```

**Interpretación:** ALPHA_CURR es dinámico — al inicio de temporada (games=2), la temporada anterior pesa ~80%. A jornada 10 (games=10), pesa ~44%. A jornada 25+, pesa < 25%. Esto elimina el ALPHA_PREV=0.7 fijo de V2.

Si no hay `prevSeasonMatches`: `effective_attack = attack_shrunk`, `effective_defense = defense_shrunk`.

**Prior quality:**
- `prevSeasonMatches` con ≥ 15 partidos del equipo → `PREV_SEASON`
- `prevSeasonMatches` con 5–14 partidos → `PARTIAL`
- `prevSeasonMatches` con < 5 o vacío → `LEAGUE_BASELINE`

---

## §8 — Rival Adjustment (§RA)

Para cada partido del historial de un equipo, ajustar la señal por la calidad del rival:

```
attack_signal_i  = goals_scored_i   / rival_defense_baseline_i
defense_signal_i = goals_conceded_i / rival_attack_baseline_i
```

`rival_defense_baseline_i` = `effective_defense` del rival para ese partido (calculado con los datos disponibles hasta `utcDate_i`). Si el rival no tiene suficientes datos, usar `league_goals_pg`.

Esto normaliza: marcar 2 goles contra el mejor defensa vale más que marcar 2 contra el peor.

Los rival-adjusted signals reemplazan los goles crudos para el cómputo de recency (§9) cuando `rival_adjustment_available = true` (i.e., el rival tiene ≥ 3 partidos).

---

## §9 — Recency Delta (§RC)

Captura cambios bruscos de forma no reflejados aún en el time-decay (ej: lesión de figura, cambio de entrenador).

Tomar los últimos `N_RECENT` (= 5) partidos del equipo, ordenados cronológicamente.
Aplicar **solo si el equipo tiene ≥ MIN_GAMES_FOR_RECENCY (= 10) partidos totales.** Con menos historial, el time-decay ya es suficiente y la recency añadiría ruido.

```
recent_attack_avg  = media de attack_signal en últimos N_RECENT partidos
season_attack_avg  = effective_attack

delta_attack  = recent_attack_avg  / season_attack_avg   // centrado en 1.0
delta_defense = recent_defense_avg / season_defense_avg  // centrado en 1.0
```

Clip para evitar explosión: `delta ∈ [0.5, 2.0]`.

Si `games < MIN_GAMES_FOR_RECENCY`: `delta_attack = delta_defense = 1.0` (neutro).

---

## §10 — Effective Forces (§EF)

Las effective forces son los inputs finales al modelo de lambdas:

```
effective_attack_home  = effective_attack_home  × delta_attack_home
effective_defense_home = effective_defense_home × delta_defense_home
effective_attack_away  = effective_attack_away  × delta_attack_away
effective_defense_away = effective_defense_away × delta_defense_away
```

Home advantage: si `venueSplit = true` para ambos equipos (≥ 5 partidos en su venue respectivo), las stats ya incorporan el venue effect — **no se aplica multiplicador adicional**. Si `venueSplit = false` para alguno, aplicar:

```
effective_attack_home  *= HOME_ADVANTAGE_MULT   // = 1.12 (derivado de media PD/PL/BL1)
effective_defense_away *= HOME_ADVANTAGE_MULT
```

**Constante:**
```
HOME_ADVANTAGE_MULT = 1.12
```

---

## §11 — Lambda Computation (§LC)

Modelo log-lineal multiplicativo, relativo al baseline de liga:

```
lambda_home = league_home_goals_pg
            × (effective_attack_home  / league_goals_pg) ^ BETA_ATTACK
            × (effective_defense_away / league_goals_pg) ^ BETA_DEFENSE
            × delta_attack_home       ^ BETA_RECENT
            × delta_defense_away      ^ BETA_RECENT

lambda_away = league_away_goals_pg
            × (effective_attack_away  / league_goals_pg) ^ BETA_ATTACK
            × (effective_defense_home / league_goals_pg) ^ BETA_DEFENSE
            × delta_attack_away       ^ BETA_RECENT
            × delta_defense_home      ^ BETA_RECENT
```

**Constantes:**
```
BETA_ATTACK  = 1.0    // efecto lineal de diferencial de ataque
BETA_DEFENSE = 1.0    // efecto lineal de diferencial de defensa
BETA_RECENT  = 0.45   // recencia con efecto moderado (+12% boost con delta=1.3)
```

**Clip de seguridad:**
```
lambda_home = clamp(lambda_home, LAMBDA_MIN=0.3, LAMBDA_MAX=4.0)
lambda_away = clamp(lambda_away, LAMBDA_MIN=0.3, LAMBDA_MAX=4.0)
```

**Nota sobre double-counting:** El time-decay (§5) captura tendencias graduales del arco de la temporada. La recency delta (§9) captura cambios bruscos recientes (ventana 5 partidos). `BETA_RECENT=0.30` (vs 1.0 de BETA_ATTACK/DEFENSE) garantiza que la recency amplifica marginalmente sin sobreescribir la señal estructural.

---

## §12 — Dixon-Coles Correction (§DC)

Aplicar corrección a los scores bajos del producto de Poisson independiente:

```
tau(h, a, lh, la) =
  h=0, a=0 → 1 − lh × la × DC_RHO
  h=0, a=1 → 1 + lh × DC_RHO
  h=1, a=0 → 1 + la × DC_RHO
  h=1, a=1 → 1 − DC_RHO
  otherwise → 1

cell(h, a) = poissonPMF(lh, h) × poissonPMF(la, a) × tau(h, a, lh, la)
```

**Constante:**
```
DC_RHO = −0.13   // correlación empírica observada en ligas europeas
                  // negativo: cuando uno marca, el rival tiende a marcar menos
```

**Renormalización:** tras aplicar tau, `Σ cell(h,a)` puede no ser exactamente 1. Renormalizar dividiendo por la suma total.

---

## §13 — Poisson Matrix y 1X2 (§PM)

Grilla de marcadores `0..MAX_GOALS × 0..MAX_GOALS`:

```
MAX_GOALS = 7    // grilla 8×8 = 64 celdas

P(home_win) = Σ cell(h,a) for h > a
P(draw)     = Σ cell(h,a) for h = a
P(away_win) = Σ cell(h,a) for h < a
```

**Tail mass check:** si `1 − Σ cell(h,a)` > `MAX_TAIL_MASS` (= 0.02), registrar warning `TAIL_MASS_EXCEEDED` en el output y expandir grilla a MAX_GOALS=9 para ese partido. No silenciar.

---

## §14 — Elegibilidad (§EL)

```
min_games = min(games_home, games_away)

if min_games < THRESHOLD_NOT_ELIGIBLE (= 3):
  eligibility = NOT_ELIGIBLE   // no retornar probabilidades

elif min_games < THRESHOLD_ELIGIBLE (= 7):
  eligibility = LIMITED        // probabilidades con baja confianza

else:
  eligibility = ELIGIBLE
```

**NOT_ELIGIBLE:** el motor retorna un output con `prob_home = prob_draw = prob_away = null`. El portal debe mostrar "Sin datos suficientes" en lugar de probabilidades.

---

## §15 — Nivel de Confianza (§CF)

```typescript
type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT'
```

Tabla de asignación (basada en `min_games` y `prior_quality`):

| min_games | prior_quality | Confianza |
|---|---|---|
| ≥ 20 | cualquiera | HIGH |
| 12–19 | PREV_SEASON o PARTIAL | HIGH |
| 12–19 | LEAGUE_BASELINE | MEDIUM |
| 7–11 | PREV_SEASON | MEDIUM |
| 7–11 | PARTIAL o LEAGUE_BASELINE | LOW |
| 3–6 | cualquiera | LOW |
| < 3 | — | INSUFFICIENT |

**INSUFFICIENT** siempre coincide con NOT_ELIGIBLE. Se incluye en el output para claridad.

---

## §16 — Calibración (§CA)

Framework de calibración isotónica one-vs-rest heredado de V1, con modo bootstrapping:

**Bootstrap (sin datos de entrenamiento):** usar `IsotonicCalibrator.createIdentity()` — probabilidades raw pasan sin modificar.

**Trained (cuando haya ≥ 300 ejemplos resueltos por segmento):** entrenar calibradores separados por `(league, competition_family)`. Esto requiere que el EvaluationStore tenga suficientes registros COMPLETE.

La calibración es **opcional en V3.0** — no bloquea el despliegue inicial. Se activa cuando los datos lo justifiquen.

---

## §17 — Output Schema (§OS)

```typescript
interface V3PredictionOutput {
  engine_id: 'v3_unified';
  engine_version: '3.0';

  // Elegibilidad y confianza
  eligibility: 'ELIGIBLE' | 'LIMITED' | 'NOT_ELIGIBLE';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';

  // Probabilidades (null si NOT_ELIGIBLE)
  prob_home_win: number | null;
  prob_draw: number | null;
  prob_away_win: number | null;

  // Lambdas
  lambda_home: number | null;
  lambda_away: number | null;

  // Resultado predicho (null si TOO_CLOSE o NOT_ELIGIBLE)
  predicted_result: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null;
  favorite_margin: number | null;   // |p_max − p_second| — null si NOT_ELIGIBLE

  // Texto editorial (generado desde probs — misma lógica que Radar actual)
  pre_match_text: string | null;

  // Explicabilidad
  explanation: {
    effective_attack_home: number;
    effective_defense_home: number;
    effective_attack_away: number;
    effective_defense_away: number;
    delta_attack_home: number;      // recency delta (1.0 = neutro)
    delta_defense_home: number;
    delta_attack_away: number;
    delta_defense_away: number;
    home_advantage_applied: boolean;
    venue_split_home: boolean;
    venue_split_away: boolean;
    prior_quality_home: PriorQuality;
    prior_quality_away: PriorQuality;
    rival_adjustment_used: boolean;
    dc_correction_applied: boolean;
    league_home_goals_pg: number;
    league_away_goals_pg: number;
    games_home: number;
    games_away: number;
  };

  // Warnings
  warnings: ('TAIL_MASS_EXCEEDED' | 'NO_VENUE_SPLIT' | 'NO_PRIOR' | 'FALLBACK_BASELINE')[];
}
```

---

## §18 — Predicted Result (§PD)

```
max_prob = max(prob_home, prob_draw, prob_away)
second_prob = second highest

if max_prob − second_prob < TOO_CLOSE_THRESHOLD (= 0.05):
  predicted_result = null   // demasiado parejo para declarar ganador
else:
  predicted_result = argmax(prob_home, prob_draw, prob_away)
```

**Nota:** umbral aumentado de 0.02 (V1) a 0.05 — el margen de 2% era demasiado pequeño para ser estadísticamente significativo.

---

## §19 — Tabla de constantes

| Constante | Valor | Fuente | Descripción |
|---|---|---|---|
| `DECAY_XI` | 0.006 | Motor Radar | Decay exponencial — half-life ≈ 115 días |
| `MIN_GAMES_VENUE` | 5 | Motor Radar | Mínimo para usar stats de venue |
| `MIN_GAMES_FOR_BASELINE` | 10 | Nuevo | Mínimo partidos para no usar fallback baseline |
| `MIN_GAMES_FOR_RECENCY` | 10 | Nuevo | Mínimo para aplicar recency delta |
| `K_SHRINK` | 5 | Motor Radar + V2 | Fuerza del prior de liga en shrinkage |
| `PRIOR_EQUIV_GAMES` | 8 | Nuevo (reemplaza ALPHA_PREV fijo) | Prior de temporada anterior equivale a 8 partidos |
| `HOME_ADVANTAGES_MULT` | 1.12 | Nuevo (reemplaza +100 Elo) | Solo cuando no hay venue split |
| `HOME_GOALS_FALLBACK` | 1.45 | Nuevo (reemplaza 1.35) | Baseline home goals por partido |
| `AWAY_GOALS_FALLBACK` | 1.15 | Nuevo | Baseline away goals por partido |
| `DC_RHO` | −0.13 | Motor Radar | Parámetro de corrección Dixon-Coles |
| `N_RECENT` | 5 | Motor V2 | Partidos en ventana de recencia |
| `BETA_ATTACK` | 1.0 | Motor V2 | Elasticidad de ataque en lambda |
| `BETA_DEFENSE` | 1.0 | Motor V2 | Elasticidad de defensa en lambda |
| `BETA_RECENT` | 0.45 | Nuevo (V2 usaba 0.35) | Elasticidad de recency en lambda — +12% boost con delta=1.3 |
| `LAMBDA_MIN` | 0.3 | Motor V2 | Clip mínimo de lambda |
| `LAMBDA_MAX` | 4.0 | Motor V2 | Clip máximo de lambda |
| `MAX_GOALS` | 7 | V1 + V2 + Radar | Tamaño de grilla Poisson |
| `MAX_TAIL_MASS` | 0.02 | Motor V1 | Umbral para warning de cola truncada |
| `THRESHOLD_NOT_ELIGIBLE` | 3 | Motor V2 | Mínimo partidos para producir probs |
| `THRESHOLD_ELIGIBLE` | 7 | Nuevo (V2 usaba 5) | Mínimo para confianza plena |
| `TOO_CLOSE_THRESHOLD` | 0.05 | Nuevo (V1 usaba 0.02) | Margen mínimo para declarar ganador |

---

## §20 — Invariantes

1. **Determinismo:** mismo input → mismo output. Sin `Date.now()` dentro del motor.
2. **Anti-lookahead:** `currentSeasonMatches` nunca contiene partidos con `utcDate ≥ kickoffUtc`.
3. **NOT_ELIGIBLE sin probs:** si `eligibility = NOT_ELIGIBLE`, todas las probabilidades y lambdas son `null`.
4. **Suma de probs = 1:** tras DC-correction y renormalización, `|prob_home + prob_draw + prob_away − 1| < 1e-9`.
5. **Sin Elo en ningún paso:** el motor no usa ratings acumulados entre partidos. Cada predicción es función pura de los matches históricos provistos.
6. **Sin engine_id ambiguo:** todo snapshot persiste con `engine_id = 'v3_unified'`.
7. **Baseline derivado:** V3 nunca usa `BASE_GOALS` hardcodeado si hay ≥ 10 partidos terminados.

---

## §21 — Integración con el portal

V3 reemplaza el cálculo de probabilidades dentro de `RadarApiAdapter.buildLiveData()`. El adapter sigue existiendo como thin layer que:

1. Llama al V3 service por cada partido SCHEDULED de la jornada
2. Recibe `V3PredictionOutput`
3. Expone `probHomeWin`, `probDraw`, `probAwayWin`, `preMatchText` al frontend (sin cambio de contrato)

El V3 service también corre como shadow (reemplazando V1 + V2 shadow runners) para persistir predicciones en `PredictionStore` con evaluación.

---

## §22 — Plan de migración

### Archivos que se eliminan
- `packages/prediction/src/engine/elo-rating.ts`
- `packages/prediction/src/engine/lambda-computer.ts`
- `packages/prediction/src/engine/team-state-replay.ts`
- `packages/prediction/src/engine/v2/` (directorio completo)
- `server/prediction/prediction-service.ts` (reemplazado por V3Service)
- `server/prediction/shadow-runner.ts` (reemplazado por V3ShadowRunner)
- `server/prediction/v2-runner.ts` (reemplazado por V3ShadowRunner)
- `server/prediction/v2-prediction-store.ts` (unificado en PredictionStore)
- `server/prediction/historical-state-service.ts` → revisar si V3ShadowRunner lo necesita (probable que sí para prev season data)

### Archivos que se crean
- `packages/prediction/src/engine/v3/v3-engine.ts` — motor principal
- `packages/prediction/src/engine/v3/` — submódulos (stats, shrinkage, prior, rival, recency, lambda, dc, matrix)
- `server/prediction/v3-service.ts` — orquestador (reemplaza prediction-service.ts)
- `server/prediction/v3-shadow-runner.ts` — único shadow runner

### Archivos que se modifican
- `server/radar/radar-api-adapter.ts` — delegar cálculo de probs a V3Service (eliminar Poisson+DC interno)
- `server/prediction/prediction-store.ts` — `engine_id` ya añadido
- `server/prediction/prediction-flags.ts` — unificar flags en `PREDICTION_V3_ENABLED`
- `server/index.ts` — wiring del nuevo servicio

### Archivos que se mantienen intactos
- `server/prediction/prediction-store.ts` — estructura ya compatible
- `server/prediction/evaluation-store.ts` — sin cambios
- `server/prediction/forward-validation-store.ts` — sin cambios
- `server/prediction/inspection-route.ts` — sin cambios
- `server/prediction/experimental-route.ts` — apuntar a V3 store
- `packages/prediction/src/calibration/` — reutilizar en V3

---

## §23 — Fases de implementación

### Fase 1 — Motor puro (sin infraestructura)
Implementar `v3-engine.ts` como función pura. Tests unitarios cubriendo:
- Salida determinista
- NOT_ELIGIBLE con < 3 partidos
- DC-correction en scores bajos
- Venue split activo/inactivo
- Prior de temporada anterior presente/ausente
- Recency delta neutro cuando games < 10

### Fase 2 — Shadow runner y persistencia
Implementar `V3ShadowRunner` que reemplaza V1+V2 runners. Correr en paralelo con Radar (sin reemplazarlo aún). Persistir en PredictionStore.

### Fase 3 — Reemplazar Radar
Conectar V3 al `RadarApiAdapter`. Eliminar el Poisson+DC interno de Radar. Verificar que el contrato del portal no cambia.

### Fase 4 — Eliminar V1 y V2
Una vez Fase 3 estable: eliminar código de V1 y V2. Limpiar `packages/prediction/src/engine/`.

### Fase 5 — Calibración
Cuando EvaluationStore tenga ≥ 300 registros COMPLETE: entrenar isotónica segmentada por liga y activar.

---

*Spec en estado BORRADOR. Pendiente revisión de constantes con datos reales antes de Fase 1.*
*Próximo paso: aprobar este spec → crear tarea de implementación Fase 1.*
