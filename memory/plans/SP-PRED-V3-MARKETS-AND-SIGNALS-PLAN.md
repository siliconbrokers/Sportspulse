# SP-PRED-V3 — Plan: Mercados adicionales y señales nuevas
**Fecha:** 2026-03-15
**Estado:** ACTIVE — ejecución tier a tier
**Contexto:** Motor V3 Unificado operativo. Suite: 1063 tests / 100% pass. Mejoras P1/P2 completadas.

---

## Principio de ejecución

Cada tier se aprueba antes de iniciar el siguiente.
Dentro de cada tier, las tareas se ejecutan en el orden listado (hay dependencias).
Cada tarea tiene un ID único `MKT-T{n}-{nn}` para tracking.

---

## TIER 1 — Mercados desde la matriz existente (costo cero)

> La grilla Poisson 8×8 ya está calculada en el motor V3.
> Todos estos mercados son sumas de celdas — sin nuevos datos, sin nuevo modelo.
> Solo se agrega output shape, funciones de derivación, y exposición en el endpoint.

---

### MKT-T1-01 — Over/Under por umbral (0.5, 1.5, 2.5, 3.5, 4.5)

**Qué es:**
Para cada umbral N, P(goles totales del partido > N).
El más relevante es O/U 2.5 — es el mercado de volumen más alto después de 1X2.

**Input:** Matriz Poisson existente (prob por cada marcador h,a)
**Output:**
```typescript
over_under: {
  over_0_5: number;   // P(h+a >= 1)
  under_0_5: number;
  over_1_5: number;
  under_1_5: number;
  over_2_5: number;   // el más importante
  under_2_5: number;
  over_3_5: number;
  under_3_5: number;
  over_4_5: number;
  under_4_5: number;
}
```

**Dónde:**
- Nueva función `computeOverUnder(matrix)` en `packages/prediction/src/engine/v3/`
- Añadir al output de `V3PredictionOutput`
- Exponer en endpoint `/api/ui/predictions`

**Dependencias:** ninguna
**Esfuerzo:** S (1 sesión Sonnet)
**Impacto:** Alto — mercado de alto interés para el usuario

---

### MKT-T1-02 — BTTS (Both Teams To Score)

**Qué es:**
P(home > 0 AND away > 0).
El complemento es P(algún equipo no anota) — también relevante.

**Output:**
```typescript
btts: {
  yes: number;   // P(home > 0 AND away > 0)
  no: number;    // 1 - yes
}
```

**Dónde:** misma función utilitaria que T1-01 (misma sesión)
**Dependencias:** MKT-T1-01 (compartir estructura de derivación)
**Esfuerzo:** XS (parte de la sesión de T1-01)
**Impacto:** Alto — muy consultado junto con O/U 2.5

---

### MKT-T1-03 — Double Chance (1X, X2, 12)

**Qué es:**
Probabilidades para apuesta de doble oportunidad:
- 1X = P(home win OR draw) = prob_home_win + prob_draw
- X2 = P(draw OR away win) = prob_draw + prob_away_win
- 12 = P(home win OR away win) = 1 - prob_draw

**Output:**
```typescript
double_chance: {
  home_or_draw: number;   // 1X
  draw_or_away: number;   // X2
  home_or_away: number;   // 12
}
```

**Dónde:** derivable directamente de prob_home_win/prob_draw/prob_away_win (ya disponibles)
**Dependencias:** ninguna
**Esfuerzo:** XS (parte de la sesión de T1-01)
**Impacto:** Medio-alto — mercado popular como "apuesta segura"

---

### MKT-T1-04 — Expected Goals y Goal Lines

**Qué es:**
- `expected_goals_home` = lambda_home (ya lo tenemos)
- `expected_goals_away` = lambda_away (ya lo tenemos)
- `expected_goals_total` = lambda_home + lambda_away
- `goal_line` = el umbral O/U con probabilidad más cercana a 0.5 (línea de mercado implícita)

**Output:**
```typescript
expected_goals: {
  home: number;           // = lambda_home
  away: number;           // = lambda_away
  total: number;          // = lambda_home + lambda_away
  implied_goal_line: number;  // e.g. 2.5 si over_2_5 ≈ 0.50
}
```

**Dónde:** derivar de lambdas y over_under result (requiere T1-01)
**Dependencias:** MKT-T1-01
**Esfuerzo:** XS
**Impacto:** Medio — contexto valioso para el usuario, base para narrativa editorial

---

### MKT-T1-05 — Top Scorelines (Correct Score)

**Qué es:**
Los 5 marcadores más probables del partido con su probabilidad individual.
Ejemplo: "1-0 (18.3%) · 1-1 (14.2%) · 2-0 (12.1%) · 2-1 (11.5%) · 0-0 (9.4%)"

**Output:**
```typescript
top_scorelines: Array<{
  home: number;
  away: number;
  probability: number;
}>;  // array de 5, ordenado desc por probabilidad
```

**Dónde:** nueva función `computeTopScorelines(matrix, n)` en poisson-matrix.ts o módulo nuevo
**Dependencias:** necesita acceso a la matriz raw (hoy solo se exponen 1X2 del resultado)
**Nota:** Requiere que `computePoissonMatrix` retorne también la matriz raw (cambio menor en el tipo)
**Esfuerzo:** S
**Impacto:** Medio — muy visual para el usuario, diferenciador de contenido

---

### MKT-T1-06 — Draw No Bet (DNB) y Asian Handicap básico

**Qué es:**
- DNB home: P(home win) / (P(home win) + P(away win)) — elimina el empate
- DNB away: P(away win) / (P(home win) + P(away win))
- AH -0.5 home: = prob_home_win (home gana por al menos 1)
- AH +0.5 home: = prob_home_win + prob_draw

**Output:**
```typescript
dnb: {
  home: number;   // P(home | no draw)
  away: number;   // P(away | no draw)
}
asian_handicap: {
  home_minus_half: number;    // AH -0.5 = prob_home_win
  home_plus_half: number;     // AH +0.5 = prob_home_win + prob_draw
  away_minus_half: number;    // AH -0.5 away = prob_away_win
  away_plus_half: number;     // AH +0.5 away = prob_away_win + prob_draw
}
```

**Dependencias:** ninguna
**Esfuerzo:** XS (parte de misma sesión)
**Impacto:** Medio

---

### MKT-T1-07 — Output shape unificado y endpoint

**Qué es:**
Unificar todos los mercados T1-01..T1-06 en un `MarketsOutput` tipado, integrarlo en `V3PredictionOutput`, y exponerlo en:
- Endpoint `/api/ui/predictions` (response shape)
- `RadarApiAdapter` (para que llegue al frontend)
- Frontend: nuevo bloque "Mercados" en el panel de pronósticos

**Output:**
```typescript
// En V3PredictionOutput
markets: {
  over_under: OverUnderMarkets;
  btts: BTTSMarket;
  double_chance: DoubleChanceMarkets;
  dnb: DNBMarkets;
  asian_handicap: AsianHandicapMarkets;
  expected_goals: ExpectedGoalsMarkets;
  top_scorelines: TopScoreline[];  // top 5
} | null;  // null si NOT_ELIGIBLE
```

**Dependencias:** T1-01 a T1-06
**Esfuerzo:** M (integración + frontend)
**Impacto:** Alto — consolida todo el Tier 1 en un bloque presentable al usuario

---

## TIER 2 — Señales desde datos existentes (sin nuevas fuentes)

> Todos los datos necesarios ya están en `currentSeasonMatches` / `prevSeasonMatches`.
> Solo requiere nuevas funciones de computación y wiring en el pipeline.

---

### MKT-T2-01 — Ajuste por descanso / fatiga

**Qué es:**
El número de días desde el último partido afecta el rendimiento.
Un equipo que jugó hace 3 días vs uno que descansó 7 días tiene desventaja de fatiga.

**Fórmula propuesta:**
```
rest_days_home = days_since_last_match(homeTeamId, currentSeasonMatches, kickoffUtc)
rest_days_away = days_since_last_match(awayTeamId, currentSeasonMatches, kickoffUtc)
rest_delta = f(rest_days) → multiplicador en [0.92, 1.05]
  < 4 días  → 0.92 (fatiga severa)
  4-5 días  → 0.97 (leve)
  6-8 días  → 1.00 (normal)
  > 8 días  → 1.03 (descanso óptimo, pero hay riesgo de ritmo perdido)
  > 14 días → 1.00 (neutralizado — demasiada pausa también es negativa)
```

**Integración:** nuevo delta multiplicativo en §10 (effective forces), similar a recency delta
**Requiere spec update:** sí — nueva subsección en §10 o §9
**Dependencias:** ninguna (datos ya disponibles)
**Esfuerzo:** M
**Impacto:** Medio — significativo en semanas de Copa + Liga (equipos con doble partido)

---

### MKT-T2-02 — H2H como señal débil de ajuste

**Qué es:**
Historial directo entre los dos equipos en los últimos N partidos (max 10, últimas 2 temporadas).
Algunos cruces tienen desequilibrios sistemáticos que el modelo de fuerza de equipo no captura completamente.

**Fórmula propuesta:**
```
h2h_home_rate = goles marcados home en H2H / goles esperados por sus stats
h2h_adjustment = softmax(h2h_home_rate - 1.0) × weight_h2h
weight_h2h = n_h2h_matches / (n_h2h_matches + 8)   [Bayesian shrinkage]
```

**Restricciones:**
- Solo activo si hay ≥ 3 partidos H2H disponibles
- Ajuste máximo: ±8% sobre lambda
- Se registra en explanation como `h2h_adjustment_applied: boolean`

**Requiere spec update:** sí — nueva subsección §8b
**Dependencias:** MKT-T2-01 (establecer patrón de nuevos deltas)
**Esfuerzo:** M
**Impacto:** Bajo-Medio — mejora en rivalidades históricas extremas, neutro en el resto

---

### MKT-T2-03 — Detección de rachas de gol (goal scoring form)

**Qué es:**
El recency delta actual (`BETA_RECENT`) mide form general (ataque Y defensa juntos en últimos 5 partidos).
Esta tarea separa la señal de "racha anotadora" de la "racha defensiva" usando métricas de goles puro (no ajustadas por rival).

**Señales adicionales:**
```
goals_scored_form = media ponderada de goles anotados en últimos N_RECENT partidos
goals_conceded_form = media ponderada de goles recibidos en últimos N_RECENT partidos
clean_sheet_rate = % de partidos sin goles recibidos (últimos 10)
scoring_rate = % de partidos con al menos 1 gol anotado (últimos 10)
```

**Uso:** influir en O/U y BTTS más que en 1X2.
**Nota:** tiene overlap con el recency delta existente — evaluar si reemplaza o complementa.
**Requiere spec update:** sí
**Dependencias:** T1-01 (O/U debe estar listo para ver el beneficio)
**Esfuerzo:** M
**Impacto:** Medio — mejora específicamente la calibración de O/U y BTTS

---

## TIER 3 — Nuevas fuentes de datos (requiere integración externa)

> Ordenadas por impacto / complejidad. No avanzar hasta completar Tier 2.
>
> **Estado de desbloqueadores:**
> - T3-01, T3-03, T3-04 → misma fuente (API-Football). Constraint: budget (100 req/día compartidos). Solución: licencia mayor o key separada. **Decisión del usuario: comprar licencia cuando llegue el momento.**
> - T3-02 → **DECISIÓN TOMADA 2026-03-15:** Fase A = solo evaluación (edge = p_v3 - p_market, no afecta predicciones). Fase B = blend activo al 15% cuando ≥100 resultados lo justifiquen. THE_ODDS_API_KEY en .env.
> - xG histórico NO requiere licencia especial — API-Football ya provee xG en `/fixtures/statistics`. El constraint es el budget, no el licenciamiento.

---

### MKT-T3-00 — Diseño de contratos y extensión del pipeline (PRIMERA TAREA)

**Qué es:**
Antes de implementar cualquier módulo de Tier 3, el motor V3 necesita ser extendido para aceptar los nuevos inputs. Hoy `V3EngineInput` solo recibe historial de partidos — no tiene campos para xG, injuries, lineups ni odds.

**Trabajo de Stage 0–2 (solo diseño, sin código):**

1. **Extensión de `V3EngineInput`** — definir qué nuevos campos entran al contrato:
   - `historicalXg?: XgRecord[]` — historial de xG por partido (opcional, reemplaza/complementa goles reales en `computeTeamStatsTD`)
   - `injuries?: InjuryRecord[]` — lista de jugadores no disponibles por equipo + estimación de impacto
   - `confirmedLineup?: LineupRecord` — XI confirmado ~1h antes del kickoff
   - `marketOdds?: MarketOddsRecord` — probabilidades implícitas de mercado (opcional, usado en prior)

2. **Puntos de integración en el pipeline:**
   - xG → entra en `computeTeamStatsTD` (§5) como fuente alternativa de goles
   - Injuries + Lineup → nuevo módulo post-lambda `computeSquadAdjustment` (multiplicador en lambda)
   - Market odds → entra en `buildPrior` / `mixWithPrior` (§7) como tercer componente del prior

3. **Nuevos campos en `V3Explanation`** para trazabilidad de cada nueva señal

4. **Estrategia de optionalidad:** todos los nuevos inputs son opcionales — si no se proveen, el motor se comporta exactamente igual que hoy

**Output del Stage 2:** spec update + diseño de contratos (no código)
**Requiere:** Opus (decisiones arquitectónicas cross-cutting)
**Dependencias:** ninguna — es el prerequisito de T3-01 a T3-04
**Esfuerzo:** M (diseño puro)
**Bloqueado por:** nada (se puede hacer ahora)

---

### MKT-T3-01 — Bajas y lesionados (API-Football Injuries)

**Qué es:**
El mayor gap actual del modelo. Un equipo sin su delantero titular puede rendir 15-25% peor en ataque.

**Fuente:** API-Football v3 endpoint `/injuries` (usa el mismo `APIFOOTBALL_KEY` que ya tenemos)
**Dato disponible:** jugadores lesionados/suspendidos con fecha de retorno estimada (si la hay)

**Modelo de impacto:**
```
impact_player = posición × rating_normalizado
  Portero titular ausente → +15% goles concedidos esperados
  Delantero titular ausente → -15% goles anotados esperados
  Defensa central clave → +10% goles concedidos
  Mediocampista creativo → -8% goles anotados
```

**Integración:** nuevo módulo `server/prediction/injury-adjuster.ts`
**Restricciones del budget:** API-Football tiene 100 req/día compartidos — este endpoint cuesta por liga.
**Posible solución:** cache por partido (TTL 6h pre-kickoff, 48h post-anuncio), solo para partidos del próximo matchday.
**Requiere spec update:** sí — nueva sección §10b
**Dependencias:** Ninguna de modelo, pero requiere datos de squad/ratings
**Esfuerzo:** XL (integración + modelo de impacto + cache)
**Impacto:** **Muy Alto** — el mayor salto de calidad predictiva posible

---

### MKT-T3-02 — Cuotas de mercado como prior externo

**Qué es:**
Las cuotas de casas de apuestas son el mejor predictor individual de resultados de fútbol.
Pinnacle y otras casas eficientes tienen implícitas probabilidades muy calibradas.

**Uso propuesto:**
```
p_market_home = implied_prob_from_odds(home_odds)
p_market_draw = implied_prob_from_odds(draw_odds)
p_market_away = implied_prob_from_odds(away_odds)

// Mezcla con el modelo propio
p_blended = α × p_v3 + (1-α) × p_market
α = f(confidence_level)  → HIGH: 0.70, MEDIUM: 0.55, LOW: 0.40
```

**Fuente:** Odds API (free tier: 500 req/mes), o The Odds API
**Uso en evaluación:** también permite calcular `edge = p_v3 - p_market` como indicador de valor
**Requiere spec update:** sí — nueva sección §16 (market integration)
**Dependencias:** Ninguna de modelo
**Esfuerzo:** L
**Impacto:** Alto — mejora calibración, especialmente en partidos con incertidumbre estructural
**Riesgo:** dependency on external paid service; puede hacer el modelo menos "puro"

---

### MKT-T3-03 — xG histórico (Expected Goals)

**Qué es:**
Reemplazar goles reales por xG en el cálculo de attack/defense strength.
Los goles reales tienen alta varianza; el xG es mejor predictor de rendimiento futuro.

**Fuente:** API-Football v3 endpoint `/fixtures/statistics` — devuelve `Expected Goals` por equipo por partido. **No requiere licencia adicional ni scraping** — ya tenemos la key. El constraint es budget (100 req/día compartidos). Con licencia mayor o key separada, se puede fetchear el histórico completo.
**Cobertura:** PD, PL, BL1 (ligas top). URU via TheSportsDB no tiene xG — para Uruguay se mantienen goles reales.

**Impacto en el modelo:**
- `computeTeamStatsTD` usaría `xG_scored` y `xG_conceded` en lugar de `homeGoals/awayGoals`
- Se vuelve más estable early-season cuando el sample de goles es pequeño
- Requiere MKT-T3-00 completado (contrato `historicalXg` en `V3EngineInput`)

**Complejidad de fetch:** ~380 req por liga por temporada para poblar el histórico → se hace una vez y se cachea
**Alternativa parcial:** usar Poisson smoothing sobre goles reales (ya implementado vía shrinkage)
**Requiere spec update:** sí — §5 (team stats) se bifurca en goals vs xG
**Dependencias:** MKT-T3-00
**Esfuerzo:** L (fetch + cache + wiring en computeTeamStatsTD)
**Impacto:** Medio-Alto para PD/PL/BL1, neutro para URU
**Recomendación:** evaluar post-CP2 con datos reales de calibración

---

### MKT-T3-04 — Alineaciones confirmadas (~1h antes)

**Qué es:**
Las alineaciones son públicas ~1h antes del kickoff. Si el portero titular no está, el modelo puede ajustar.
Complementa T3-01 (injuries): T3-01 es proactivo (días antes), T3-04 es reactivo (minutos antes).

**Fuente:** API-Football v3 endpoint `/fixtures/lineups`
**Integración:** nuevo trigger en el scheduler del shadow runner, ~75 min antes del kickoff
**Requiere:** T3-01 implementado (necesita el mapa de impact por jugador)
**Esfuerzo:** L
**Impacto:** Alto para partidos donde T3-01 no captó la baja a tiempo

---

## TIER UI — Estado actual de la interfaz y gap de visualización

> Qué muestra la UI hoy, qué falta, y qué hay que construir para cada tier de datos.
> Este tier no produce código de modelo — produce componentes React y cambios de endpoint.

---

### Estado actual de la UI de pronósticos

#### Dónde viven los pronósticos hoy

| Superficie | Componente | Ruta |
|-----------|-----------|------|
| Página Pronósticos | `PronosticosView.tsx` + `PronosticoCard.tsx` | `/pronosticos` |
| Radar (partidos destacados) | `RadarSection.tsx` + `RadarCard.tsx` | Home |
| Detail Panel (click en partido) | `DetailPanel.tsx` → `PredictionExperimentalSection.tsx` | Cualquier partido |
| Lab experimental | `PredictionsLabPage.tsx` | `/labs/predictions` |

#### Qué se muestra HOY por componente

**`PronosticoCard`** (página `/pronosticos`):
- ✅ Escudos + nombres de equipo + fecha/hora
- ✅ Score si el partido terminó
- ✅ Barras de probabilidad 1X2 (Home / Draw / Away %) — componente `ProbabilityBars`
- ✅ Texto pre-partido narrativo (generado desde las probabilidades)
- ✅ Label editorial (EN_LA_MIRA, DUELO_CERRADO, etc.)
- ✅ Veredicto post-partido (Acertado / Fallado / Parcial) con badge animado
- ❌ Sin O/U, sin BTTS, sin expected goals, sin scorelines
- ❌ Sin información de confianza del modelo (eligibility, confidence level)
- ❌ Sin contexto de qué versión del motor produjo la predicción

**`RadarCard`** (Home):
- ✅ Liga + badge LIVE/Finalizado + hora
- ✅ Escudos + nombres + score
- ✅ Label editorial con chip de color
- ✅ Texto pre-partido
- ✅ Barras de probabilidad 1X2
- ✅ Veredicto post-partido (con texto del radar)
- ✅ Botón "Ver partido" → DetailPanel
- ❌ Sin mercados adicionales (O/U, BTTS, etc.)

**`DetailPanel` → `PredictionExperimentalSection`** (panel lateral por partido):
- ✅ Barras 1X2
- ✅ Texto pre-partido
- ✅ Indicador "Motor V3 activo" (cuando disponible)
- ❌ Sin O/U, sin BTTS, sin expected goals
- ❌ Sin explicabilidad visible (por qué se predijo X)
- ❌ Sin historial de predicciones anteriores para ese partido

**`PredictionsLabPage`** (lab interno):
- ✅ Lista de predicciones guardadas con probs + metadata
- ✅ engine_id, eligibility, confidence
- ❌ Sin O/U, sin BTTS
- ❌ Sin contraste predicción vs resultado real en tiempo real

---

### Tareas de visualización por tier

---

#### MKT-UI-T1 — Panel de mercados Tier 1

**Qué mostrar:** todos los mercados de Tier 1 en un bloque compacto dentro de `DetailPanel` y `PronosticoCard`.

**Diseño propuesto:**
```
┌─────────────────────────────────────────┐
│  MERCADOS                               │
├──────────────┬──────────────────────────┤
│  O/U 2.5     │  ●●● Over 58%  ──── 42% │
│  BTTS        │  ●●● Sí   62%  ──── 38% │
│  1X          │  ●●● 1X   71%  ──── 29% │
│  Goles esp.  │  Casa 1.6  ·  Visita 1.1│
├──────────────┴──────────────────────────┤
│  Top marcadores: 1-0 (18%) · 1-1 (14%) │
│                  2-1 (11%) · 0-0 (9%)  │
└─────────────────────────────────────────┘
```

**Componentes a crear:**
- `MarketsPanel.tsx` — bloque reutilizable con todos los mercados
- `OverUnderRow.tsx` — barra dual Over/Under por umbral
- `BttsRow.tsx` — barra Sí/No
- `ScorelineGrid.tsx` — grid de top 5 marcadores con probabilidades
- `ExpectedGoalsRow.tsx` — valores de xG con barra proporcional

**Dónde integrarlo:**
- `DetailPanel.tsx` → sección nueva debajo de las barras 1X2
- `PronosticoCard.tsx` → bloque colapsable en desktop, oculto por defecto en mobile
- `PredictionsLabPage.tsx` → columna adicional en la tabla

**Dependencias:** MKT-T1-07 (endpoint con shape unificado)
**Esfuerzo:** M
**Prioridad:** Alta — sin esto, los datos del Tier 1 no son visibles para nadie

---

#### MKT-UI-T2 — Indicadores de señales contextuales

**Qué mostrar:** señales que el modelo usó para llegar a la predicción (fatiga, H2H, form).

**Diseño propuesto (en DetailPanel, sección "Contexto del modelo"):**
```
┌─────────────────────────────────────────┐
│  CONTEXTO                               │
│  🟡 Real Madrid descansó 3 días         │
│  🔵 Barcelona descansó 7 días (ventaja) │
│  📊 H2H reciente: 3V-1E-0D (Barcelona) │
│  📈 Barcelona: 4 goles en últimos 3     │
└─────────────────────────────────────────┘
```

**Componentes a crear:**
- `ModelContextPanel.tsx` — chips/badges de señales activas
- `RestDaysIndicator.tsx` — comparativa días de descanso
- `H2HMiniSummary.tsx` — W/D/L de los últimos N cruces
- `GoalFormRow.tsx` — racha anotadora reciente

**Dónde integrarlo:**
- `DetailPanel.tsx` → collapsable "¿Por qué esta predicción?"
- `PronosticoCard.tsx` → tooltip o modal en desktop

**Dependencias:** MKT-T2-01, T2-02, T2-03
**Esfuerzo:** M

---

#### MKT-UI-T3 — Panel de lesionados y alineaciones

**Qué mostrar:** bajas confirmadas y alineación probable con su impacto estimado en el modelo.

**Diseño propuesto:**
```
┌─────────────────────────────────────────┐
│  BAJAS Y DISPONIBILIDAD                 │
│  🔴 Benzema (DEL) — lesionado           │
│     Impacto estimado: -12% ataque local │
│  🟡 Modric (MED) — duda                 │
│  ──────────────────────────────────     │
│  Alineación probable: [XI visual]       │
└─────────────────────────────────────────┘
```

**Componentes a crear:**
- `InjuryImpactPanel.tsx` — lista de bajas con badge de impacto
- `LineupPreview.tsx` — alineación probable en formación 4-4-2 / 4-3-3 simplificada

**Dependencias:** MKT-T3-01, MKT-T3-04
**Esfuerzo:** L

---

#### MKT-UI-EV — Panel de evaluación y contraste (transversal)

> Esta es la parte que pediste específicamente: contrastar predicciones vs resultados reales.

**Qué mostrar:** comparativa de predicciones pasadas con resultados reales, visible para el usuario.

**Surfaces:**

**1. Badge de calibración en PronosticoCard (post-match)**
```
Acertado ✓   [barra visual: 65% accuracy últimos 20]
```
Hoy solo muestra Acertado/Fallado por partido. Agregar tasa histórica del motor como contexto.

**2. PredictionsLabPage — tabla de evaluación**
```
┌──────────┬───────┬──────┬──────┬──────┬─────────┬──────────┐
│ Partido  │ Motor │ 1X2  │ O/U  │ BTTS │ Resultado│ Veredicto│
├──────────┼───────┼──────┼──────┼──────┼─────────┼──────────┤
│ RMA-BAR  │ V3    │H:62% │O:58% │S:65% │ 2-1     │ ✓✓✓      │
│ LIV-MCI  │ V3    │H:45% │U:52% │N:55% │ 1-1     │ ✗✓✗      │
└──────────┴───────┴──────┴──────┴──────┴─────────┴──────────┘
```

**3. Nueva página `/analytics` — dashboard de calibración**
```
┌──────────────────────────────────────────────────────┐
│  CALIBRACIÓN DEL MOTOR V3                            │
│  Últimos 30 días · 47 predicciones                  │
│                                                      │
│  1X2: 61% accuracy · 0.218 RPS · 0.31 Brier         │
│  O/U 2.5: 58% accuracy (disponible post T1)         │
│  BTTS: 62% accuracy (disponible post T1)            │
│                                                      │
│  ─────── Calibración por bucket ────────────────    │
│  [gráfico de curva predicha vs observada]           │
│                                                      │
│  ─────── Timeline de predicciones ──────────────    │
│  [lista scrolleable con badges Acertado/Fallado]    │
└──────────────────────────────────────────────────────┘
```

**Componentes a crear:**
- `CalibrationDashboard.tsx` — página `/analytics` nueva
- `AccuracyBadge.tsx` — badge reutilizable "N% accuracy últimas X predicciones"
- `CalibrationCurveChart.tsx` — gráfico predicha vs real por bucket (SVG simple)
- `PredictionHistoryTable.tsx` — tabla con todas las predicciones + resultado + veredicto por mercado
- `MarketAccuracyRow.tsx` — fila por mercado (1X2, O/U, BTTS) con accuracy + sample size

**Dependencias:** MKT-T1-07 (mercados en endpoint), EvaluationStore ya operativo
**Esfuerzo:** L
**Prioridad:** Alta — es la forma de demostrar (o refutar) el valor del motor V3

---

### Resumen UI gaps por superficie

| Superficie | Hoy muestra | Falta tras Tier 1 | Falta tras Tier 2 | Falta tras Tier 3 |
|-----------|-------------|------------------|------------------|------------------|
| `PronosticoCard` | 1X2 + texto + veredicto | O/U · BTTS · DC · xG | Indicadores fatiga/H2H | Bajas · impacto |
| `RadarCard` | 1X2 + texto editorial | O/U · BTTS compactos | — | — |
| `DetailPanel` | 1X2 + texto | MarketsPanel completo | ModelContextPanel | InjuryImpactPanel |
| `PredictionsLabPage` | Lista raw de preds | Columnas O/U+BTTS+veredicto | Columnas señales | Columnas lesionados |
| `/analytics` (nueva) | ❌ No existe | CalibrationDashboard básico | + señales contexto | + breakdown por lesionados |

---

## Resumen ejecutivo

```
TIER 1 — Mercados desde matriz existente ✅ COMPLETADO 2026-03-15
  MKT-T1-01  Over/Under (0.5 a 4.5)         S    Alto   ✅
  MKT-T1-02  BTTS                           XS   Alto   ✅ (con T1-01)
  MKT-T1-03  Double Chance (1X/X2/12)       XS   M-A    ✅ (con T1-01)
  MKT-T1-04  Expected Goals + Goal Line     XS   Medio  ✅ (con T1-01)
  MKT-T1-05  Top Scorelines (top 5)         S    Medio  ✅
  MKT-T1-06  DNB + Asian Handicap básico    XS   Medio  ✅ (con T1-01)
  MKT-T1-07  Output shape + endpoint + UI   M    Alto   ✅

TIER 2 — Señales desde datos existentes ✅ COMPLETADO 2026-03-15
  MKT-T2-01  Ajuste por descanso/fatiga     M    Medio   ✅
  MKT-T2-02  H2H como señal débil           M    Bajo-Medio ✅
  MKT-T2-03  Rachas de gol (form scorer)    M    Medio   ✅ (informacional en explanation)

TIER 3 — Nuevas fuentes
  MKT-T3-00  Diseño de contratos + extensión pipeline  M  Arquitectura  ⏳ PENDIENTE
  MKT-T3-01  Bajas/lesionados               XL   Muy Alto      (requiere T3-00 + licencia)
  MKT-T3-02  Cuotas de mercado como prior   L    Alto          (requiere T3-00 + decisión filosófica)
  MKT-T3-03  xG histórico (API-Football)    L    Medio-Alto    (requiere T3-00 + licencia)
  MKT-T3-04  Alineaciones confirmadas       L    Alto          (requiere T3-01)

TIER UI — Visualización y contraste
  MKT-UI-T1  MarketsPanel (O/U · BTTS · DC · xG · Scorelines)  M    Alto
  MKT-UI-T2  ModelContextPanel (fatiga · H2H · form)           M    Medio
  MKT-UI-T3  InjuryImpactPanel + LineupPreview                 L    Alto
  MKT-UI-EV  CalibrationDashboard /analytics (contraste)       L    Alto
```

---

## Decisiones pendientes antes de iniciar Tier 3

1. **MKT-T3-00** (diseño de contratos): no tiene bloqueadores externos. Se puede ejecutar ahora con Opus.
2. **Budget API-Football**: T3-01, T3-03 y T3-04 requieren más de 100 req/día. **Decisión tomada: comprar licencia mayor cuando llegue el momento.** T3-03 no es problema de licenciamiento — API-Football ya provee xG.
3. **Cuotas como prior** (T3-02): **DECISIÓN TOMADA 2026-03-15.**
   - Fase A (implementar ahora): cuotas solo para evaluación — almacenar odds + calcular `edge = p_v3 - p_market`. Las predicciones no cambian.
   - Fase B (condicional, OBLIGATORIA cuando datos lo justifiquen): activar blend al 15% (Opción 2) cuando ≥100 resultados muestren edge positivo consistente. **Esta fase debe ejecutarse — no es opcional.**
4. **Punto de evaluación previo a implementaciones de T3**: cuando tengamos ≥100 resultados en EvaluationStore, auditar la calibración del motor V3 actual antes de agregar complejidad (post-CP2).
5. **Tier 4** (Double Chance UI prominence y otros refinamientos de visualización): deferred — se retoma después de Tier 3.

---

## Estado de las mejoras V3 completadas (pre-plan)

| ID     | Descripción                          | Estado |
|--------|--------------------------------------|--------|
| P1-01  | Fix double-counting recency delta    | ✅ 2026-03-15 |
| P1-02  | DC_RHO adaptativo por liga           | ✅ 2026-03-15 |
| P1-03  | Home advantage dinámico              | ✅ 2026-03-15 |
| P2-01  | Time-decay en league-baseline        | ✅ 2026-03-15 |
| P2-02  | K_SHRINK 5→3                         | ✅ 2026-03-15 |
| P2-03  | Time-decay en prior temporada ant.   | ✅ 2026-03-15 |
| P2-04  | THRESHOLD_ELIGIBLE adaptativo        | ✅ 2026-03-15 |
| P2-05  | RPS como métrica de evaluación       | ✅ 2026-03-15 |
