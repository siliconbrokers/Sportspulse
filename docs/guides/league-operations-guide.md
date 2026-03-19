# Guía Operacional de Ligas — SportsPulse Predictive Engine

**Audiencia:** técnico con acceso al repo
**Actualizado:** 2026-03-19
**Skills disponibles:** `/add-league`, `/calibrate-league`, `/governance`

---

## 1. Agregar una liga nueva

Siempre usar el skill. Nunca hacerlo a mano.

```bash
# En Claude Code:
/add-league
```

El wizard guía paso a paso por:
1. Identificar el `compId` (ej: `comp:apifootball:262`)
2. Configurar `seasonKind`: `cross-year` (temporadas tipo 2024-25) o `calendar` (año único, ej: 2024)
3. Registrar en `server/competition-registry.ts`
4. Agregar a `server/portal-config-store.ts` con `mode: 'disabled'` inicialmente
5. Configurar AF canonical source si aplica
6. Verificar build y tests

**Tiempo estimado:** 15–30 minutos con el wizard.

**Resultado esperado:**
- Liga visible en `/admin` con `mode: disabled`
- `pnpm build` y `pnpm -r test` pasan sin errores

---

## 2. Calibrar V3 (Elo + Poisson + isotonic)

### ¿Cuándo calibrar?
Calibrar cuando la liga tiene ≥300 partidos históricos disponibles. Con menos datos la tabla global da resultados similares y más robustos.

### Proceso

```bash
/calibrate-league
# Seleccionar liga → opción "Solo V3"
```

El wizard internamente ejecuta:

```bash
# 1. Descarga histórico de AF API (2 temporadas atrás)
npx tsx --tsconfig tsconfig.server.json tools/calibrate-league-report.ts \
  --comp {compId} --seasons 2

# 2. Genera tabla isotónica
# Archivo: cache/calibration/v3-iso-calibration-{SLUG}.json
```

### Entender el output

**Bias (pred_avg - real_rate):**
| Símbolo | Rango | Significado |
|---------|-------|-------------|
| ✓ | \|bias\| < 0.03 | Pequeño — corrección leve |
| ⚠ | 0.03–0.08 | Moderado — corrección útil |
| ❌ | > 0.08 | Grande — tabla necesaria |

**Ejemplo real (Liga MX 2024-25 + 2023-24):**
```
HOME: +0.073 ⚠   DRAW: +0.017 ✓   AWAY: -0.091 ❌
Real rates → HOME: 47.7%  DRAW: 24.0%  AWAY: 28.3%
```
El motor sobrepredice victorias locales y subestima victorias visitantes — la tabla lo corrige.

**Veredicto de confiabilidad:**
- `ALTA`: ≥300 tuples + bias HOME o AWAY ≥ 0.03
- `MEDIA`: 100–299 tuples o bias todo < 0.03
- `NO EVALUABLE`: backtest N/A (temporada test en curso)

**Backtest N/A** no es un error — significa que la temporada actual aún no tiene suficientes partidos terminados. La tabla es válida; se evaluará cuando avance la temporada.

### Estrategia per-liga vs global

| Tuples | Estrategia recomendada |
|--------|----------------------|
| ≥ 1000 | Per-liga (tabla dedicada) |
| 300–999 | Per-liga o global — elegir según bias |
| < 300 | Global fallback obligatorio |

### Wiring
El wizard agrega automáticamente la entrada en `server/prediction/v3-shadow-runner.ts`:
```typescript
const PER_LEAGUE_TABLE_CODES: Record<string, string> = {
  'comp:football-data:PD': 'PD',
  'comp:apifootball:262':  'MX',  // agrega aquí la nueva liga
};
```

---

## 3. Calibrar NEXUS (ensemble multi-track)

NEXUS usa features genéricos (Elo, forma, descanso, congestión) y puede inferir en **cualquier liga sin reentrenamiento**. El modelo base fue entrenado con PD, PL, BL1 y MX.

### Proceso

```bash
/calibrate-league
# Seleccionar liga → "Solo NEXUS" o "V3 + NEXUS"
```

**¿Reentrenar?**
Solo si la liga tiene ≥200 partidos históricos Y querés que sus patrones específicos influyan en los pesos del ensemble.

```bash
# Reentrenamiento manual (opcional):
pnpm train:track3 --include-comp comp:apifootball:262
pnpm tsx tools/train-logistic.ts --include-comp comp:apifootball:262
```

**Modelo actual:** v1.0.0, 1057 samples, leagues=[PD,PL,BL1,MX], trainAcc=52.5%

---

## 4. Activar todo — variables de entorno

Una vez calibrada y verificada, activar en `.env`:

```env
# V3 shadow — genera predicciones pre-kickoff para las ligas listadas
PREDICTION_SHADOW_ENABLED=comp:apifootball:140,comp:apifootball:39,...,{nuevaLiga}
PREDICTION_V3_SHADOW_ENABLED=comp:apifootball:140,...,{nuevaLiga}

# NEXUS shadow — corre en paralelo a V3
PREDICTION_NEXUS_SHADOW_ENABLED=comp:apifootball:262,comp:apifootball:140,...,{nuevaLiga}

# UI experimental (muestra pronósticos en el portal)
PREDICTION_EXPERIMENTAL_ENABLED=comp:apifootball:140,...,{nuevaLiga}

# Inspección interna (debug)
PREDICTION_INTERNAL_VIEW_ENABLED=comp:apifootball:140
```

**Activar en el portal:**
`/admin` → seleccionar liga → cambiar `mode` de `disabled` a `shadow` o `portal`.

**Reiniciar servidor:**
```bash
pnpm dev:restart
```

---

## 5. Datos históricos automáticos

El pipeline descarga automáticamente **2 temporadas completas** hacia atrás al correr:

```bash
npx tsx --tsconfig tsconfig.server.json tools/calibrate-league-report.ts \
  --comp {compId} --seasons 2
```

Los archivos se guardan en:
```
cache/historical/apifootball/{leagueId}/{seasonLabel}.json
# Ejemplo: cache/historical/apifootball/262/2024-25.json
#          cache/historical/apifootball/262/2023-24.json
```

Formato: `{ matches: V3MatchRecord[] }` — array de partidos FINISHED con homeTeamId, awayTeamId, utcDate, homeGoals, awayGoals.

La temporada **actual en curso** se usa como test set del walk-forward (backtest). Las 2 anteriores son el training set de calibración.

**`--resume` flag:** nunca re-descarga fixtures ya cacheados. Seguro correr múltiples veces.

---

## 6. Dónde ver las métricas

### Labs (uso interno — requiere server corriendo)

| URL | Qué muestra |
|-----|-------------|
| `http://localhost:5173/labs/predicciones` | Snapshots NEXUS: predicciones shadow almacenadas |
| `http://localhost:5173/labs/evaluacion` | Evaluación V3: accuracy, confusion matrix, by mode |
| `http://localhost:5173/labs/evaluacion-historica` | Walk-forward histórico: evolución temporal |
| `http://localhost:5173/labs/training` | Estado del modelo NEXUS: pesos, tracks |

### Track A — Observación automatizada

```bash
# Corre manualmente:
pnpm track-a

# O automatizar via cron (cada 10 minutos):
# cd SportsPulse && pnpm tsx scripts/run-track-a-observation.ts
```

Guarda resultados en `ops/` (CSV + JSON). Evalúa cobertura de casos B1..B8.

### Promotion gate NEXUS

```bash
pnpm eval:nexus-gate
```

Evalúa si NEXUS está listo para reemplazar V3 en producción.

---

## 7. Métricas clave y cómo interpretarlas

### Accuracy (precisión del resultado predicho: HOME / DRAW / AWAY)

| Referencia | Valor | Significado |
|------------|-------|-------------|
| Random (baseline ingenuo) | ~33.3% | Peor caso posible |
| Majority class (siempre HOME) | ~45–47% | Baseline naive competitivo |
| V3 con calibración (PD+PL+BL1) | ~49–51% | Línea base actual del motor |
| Objetivo mínimo | ≥ 48% | Por debajo = motor no aporta valor |
| Objetivo target | ≥ 52% | Supera mayoría de modelos públicos simples |
| Con market signals activos | ~55–56% | Con MARKET_WEIGHT=0.65 (Pinnacle odds) |

> **Nota:** accuracy sola es engañosa. Un modelo que siempre predice HOME puede llegar al 46% sin aprender nada. Siempre evaluar junto a DRAW recall.

### DRAW recall (% de empates reales que el motor detecta)

| Referencia | Valor |
|------------|-------|
| Baseline (nunca predice DRAW) | 0% |
| Objetivo mínimo | ≥ 30% |
| Objetivo target | ≥ 40% |
| V3 con calibración (PD+PL+BL1) | ~41–43% |

Los empates son difíciles de predecir (tasa real ~24–26%) y generan las apuestas de mayor valor. Un DRAW recall bajo indica que el motor no los detecta.

### RPS — Ranked Probability Score (métrica principal de calibración)

Mide qué tan bien distribuidas están las probabilidades, no solo el resultado predicho. **Menor es mejor.**

| Referencia | RPS | Significado |
|------------|-----|-------------|
| Predicción uniforme (33/33/33) | ~0.222 | Baseline máximo |
| Modelo sin calibrar | ~0.210–0.215 | Típico |
| V3 calibrado (PD+PL+BL1) | ~0.200–0.205 | Bueno |
| Objetivo para NEXUS ≥ V3 | RPS_NEXUS < RPS_V3 | Gate de promoción |

### Log Loss

| Referencia | Log Loss |
|------------|----------|
| Naive baseline (equiprobable) | ~1.099 |
| Motor bien calibrado | < 1.050 |

---

## 8. Gate de promoción NEXUS → producción

NEXUS reemplaza a V3 cuando cumple **todas** estas condiciones simultáneamente:

**Volumen mínimo:**
- ≥ 600 partidos evaluados en total
- ≥ 100 partidos por cada liga de producción
- ≥ 50 predicciones en modo `live_shadow` (buildNowUtc < kickoffUtc)
- ≥ 3 fases de competición distintas
- ≥ 10 matchdays distintos

**Calidad:**
- RPS_NEXUS < RPS_V3 (estrictamente mejor en agregado)
- Por cada liga individual: RPS_NEXUS_liga ≤ RPS_V3_liga + 0.005 (sin regresión)
- RPS live_shadow ≤ RPS_V3_live_shadow + 0.005
- DRAW recall ≥ 30%
- Accuracy ≥ 45%
- Log-loss ≤ 1.10
- ≥ 70% de matchdays con predicciones

**Demotion trigger (vuelta a V3):**
Si RPS_NEXUS > RPS_V3 + 0.005 por ≥ 10 partidos consecutivos → NEXUS se demota automáticamente.

```bash
# Verificar gate manualmente:
pnpm eval:nexus-gate
```

---

## 9. Flujo completo resumido

```
1. /add-league          → registrar, build, tests
2. Descargar histórico  → calibrate-league-report.ts --seasons 2
3. /calibrate-league    → V3 (tabla isotónica) + NEXUS (reentrenar si aplica)
4. .env                 → agregar a PREDICTION_*_SHADOW_ENABLED
5. /admin               → cambiar mode a 'shadow'
6. pnpm dev:restart     → recargar configuración
7. Labs                 → verificar que aparecen predicciones
8. pnpm track-a         → iniciar observación continua
9. pnpm eval:nexus-gate → cuando haya ≥600 partidos, evaluar promoción
```

---

## 10. Comandos de referencia rápida

```bash
pnpm build                    # compilar todos los paquetes
pnpm -r test                  # correr suite completa (>2100 tests)
pnpm dev:restart              # reiniciar servidor de desarrollo
pnpm track-a                  # observación Track A (B1..B8)
pnpm eval:nexus-gate          # evaluar gate de promoción NEXUS
pnpm train:track3             # reentrenar NEXUS Track 3
/governance                   # auditoría completa de gobernanza (18 dominios)
/add-league                   # agregar liga nueva
/calibrate-league             # calibrar liga existente (V3 o NEXUS)
```

---

## 11. Archivos clave

| Archivo | Propósito |
|---------|-----------|
| `server/competition-registry.ts` | Registro central de ligas |
| `server/prediction/v3-shadow-runner.ts` | PER_LEAGUE_TABLE_CODES — wiring calibración V3 |
| `cache/calibration/v3-iso-calibration-{SLUG}.json` | Tabla isotónica por liga |
| `cache/historical/apifootball/{id}/{season}.json` | Histórico de partidos AF |
| `.env` | Feature flags de predicción |
| `docs/audits/PE-audit-*.md` | Historial de auditorías del motor |
| `ops/track-a-observations.csv` | Observaciones Track A en tiempo real |
