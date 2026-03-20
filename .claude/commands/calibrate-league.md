Calibrate League — SportsPulse Predictive Engine

When this command is invoked, enter guided calibration mode for a specific league.

## Core rule

Do NOT skip steps. Do NOT run calibration scripts until the user has confirmed the league and engine selection. Go step by step.

---

## Context

The SportsPulse predictive engine has two active engines:
- **V3** — production engine (Elo + Poisson + isotonic calibration)
- **NEXUS** — shadow challenger (multi-track ensemble, not yet in production)

Calibration is optional per league. Not every league needs or can have calibration:
- Requires AF source (API-Football data for xG)
- Requires enough historical data (≥100 matches for global fallback, ≥300 for intermediate, ≥1000 for full per-liga table)
- Tournament leagues (Copa Libertadores, World Cup) rarely benefit from calibration

This skill can be invoked:
1. **Independently** — `/calibrate-league` → asks which league and which engine
2. **From `/add-league` Step 11** — league is already known, only ask which engine

---

## Step 0 — Determine invocation context

Check if this skill was invoked from `/add-league` (the league compId is already provided in context).

**If invoked independently:**
- Read `server/competition-registry.ts` to get the list of registered leagues
- Show a numbered list of registered leagues (only non-tournament leagues are eligible for V3 calibration by default)
- Ask: "¿Qué liga querés calibrar? (número)"
- Wait for user selection

**If invoked from `/add-league`:**
- Use the compId and league metadata already resolved in that wizard
- Skip directly to Step 1

---

## Step 1 — Engine selection

Ask:
```
¿Qué motor querés calibrar para {displayName}?

1. Solo V3 (producción)
2. Solo NEXUS (shadow)
3. V3 + NEXUS
4. Cancelar
```

If the user selects 4: exit with message "Calibración cancelada. Podés correr /calibrate-league en cualquier momento."

If the user selects 2 or 3 (NEXUS): proceed — NEXUS retraining is fully supported via `tools/train-track3.ts` and `tools/train-logistic.ts` with `--include-comp`.

If the user selects 1 (V3 only): proceed to Step 2 (V3 pipeline).
If the user selects 2 (NEXUS only): skip Step 2, go directly to Step 3 (NEXUS pipeline).
If the user selects 3 (V3 + NEXUS): run Step 2 first, then Step 3.

---

## Step 2 — Diagnóstico previo

Before running anything, gather diagnostics:

### 2.1 — Resolver AF source

Check if the competition has an AF source by looking for `'comp:apifootball:{leagueId}'` in `server/prediction/xg-source.ts` AF_LEAGUE_IDS.

```bash
COMP_ID="{compId}"  # e.g. comp:apifootball:262
LEAGUE_ID=$(echo "$COMP_ID" | grep -oE '[0-9]+$')
echo "AF League ID: $LEAGUE_ID"
```

If no AF source found: inform the user and ask if they want to proceed without xG augmentation (calibration will use Poisson-only probabilities).

### 2.2 — Contar fixtures históricos disponibles

Count existing cached matchday files for this competition:

```bash
CACHE_DIR="cache/apifootball/${LEAGUE_ID}"
if [ -d "$CACHE_DIR" ]; then
  TOTAL=$(find "$CACHE_DIR" -name "matchday-*.json" | wc -l)
  SEASONS=$(ls "$CACHE_DIR" 2>/dev/null | wc -l)
  echo "Temporadas en caché: $SEASONS | Archivos de jornada: $TOTAL"
else
  echo "Sin caché local para esta liga"
fi
```

Interpret the count:
- 0 files: "Sin histórico. Se descargará desde AF al correr el pipeline."
- < 50 files (< ~1 temporada): "Histórico parcial — la calibración puede ser poco robusta. Se recomienda esperar más jornadas."
- ≥ 50 files: "Histórico suficiente para calibración."

Determine expected strategy based on estimated match count:
- < 300 matches estimated: "Solo tabla global disponible"
- 300–999: "Tabla intermedia o global"
- ≥ 1000: "Tabla per-liga posible"

### 2.3 — Mostrar diagnóstico

Show:
```
Diagnóstico para {displayName} (comp:apifootball:{leagueId})
─────────────────────────────────────────────────────────
AF source:           ✓ disponible (leagueId={leagueId})     [o ✗ sin AF source]
Caché local:         {N} archivos de jornada en {S} temporadas
Estrategia esperada: {solo global | intermedia | per-liga posible}
xG augmentation:     {disponible | no disponible (sin AF source)}
```

Ask: "¿Procedemos con el pipeline V3? [S/N]"

---

## Step 3 — Pipeline V3

### 3.1 — Determinar temporadas para backfill

Based on the league's `seasonKind` from competition-registry:
- `calendar`: seasons are years like `2024`, `2023`
- `european`: seasons are like `2024-25`, `2023-24`

Calculate the two most recent completed seasons from today's date. For calendar leagues, `prevYear = currentYear - 1` and `prevPrevYear = currentYear - 2`. For european, derive from current month (if Jan-Jun → current season is `{year-1}-{year}`, if Jul-Dec → current season is `{year}-{year+1}`).

### 3.2 — Correr el pipeline orquestado

Execute the calibration pipeline using the wrapper script:

```bash
npx tsx --tsconfig tsconfig.server.json tools/calibrate-league-report.ts \
  --comp {compId} \
  --xg \
  --seasons 2
```

This single command:
1. Runs xG backfill for the last 2 seasons (using `--resume` to skip already-cached fixtures)
2. Generates the isotonic calibration table
3. Runs the 3-variant backtest (sin cal / global / per-liga)
4. Shows the comparative report
5. Outputs a strategy recommendation

Show all output to the user as it streams.

**If xG source is not available**, run without `--xg`:
```bash
npx tsx --tsconfig tsconfig.server.json tools/calibrate-league-report.ts \
  --comp {compId} \
  --seasons 2
```

**If the pipeline fails** (non-zero exit): show the error and offer:
1. Retry
2. Proceed with global fallback only (no per-liga table)
3. Cancel

### 3.3 — Confirmar estrategia

After the pipeline completes, the script will have recommended a strategy. Show:

```
Pipeline completado.

Estrategia recomendada: {per-liga | global} para {displayName}

Esto registrará una tabla de calibración en:
  cache/calibration/v3-iso-calibration-{slug}.json

Y requiere agregar esta línea en calibration-selector.ts (o equivalente):
  '{compId}': '{per-liga | global}',

¿Confirmás esta estrategia? [S/N]
  (o escribí "global"/"per-liga" para elegir manualmente)
```

If the user confirms: proceed to Step 3.4.
If the user overrides: use their choice.
If the user cancels: inform that the table was generated but not wired. They can wire it manually or re-run later.

### 3.4 — Wiring en calibration-selector.ts

Read `packages/prediction/src/calibration/calibration-selector.ts`.

Find the strategy mapping (look for `MIXED_STRATEGY` or `getCalibrationTable` or similar). Add the new league mapping following the existing pattern.

If the file uses a static Record/map: add `'{compId}': 'perLg' | 'global'` to it.

Show the diff before applying and ask for confirmation.

---

### 3.5 — Odds backfill para blend accuracy (automático)

**Este paso corre siempre después del wiring, sin preguntar al usuario.**

El motor V3 en runtime ya mezcla odds en vivo (AfOddsService / OddsService). Este paso genera los snapshots de backtest y descarga odds históricas para poder medir la mejora de accuracy que produce el blend. El resultado alimenta el reporte final (Step 5).

#### 3.5.1 — Verificar soporte The Odds API

Verificar que el slug o leagueId de la liga aparezca en `COMP_CODE_TO_SPORT_KEY` en `server/prediction/historical-odds-store.ts`.

```bash
grep -n "'${SLUG}'\|'${LEAGUE_ID}'" server/prediction/historical-odds-store.ts
```

- Si **no aparece**: mostrar `⚠️ Liga sin soporte en The Odds API — blend accuracy no disponible.` y saltar al Step 4 directamente.
- Si **aparece**: continuar.

#### 3.5.2 — Generar backtest snapshots V3

Usar `scripts/run-backtest-v3-historical.ts` para las dos temporadas más recientes completadas.

Para ligas AF canonical (calendar-year), usar `{year}` y `{year-1}`:

```bash
SLUG="{slug}"  # e.g. CL, AR, BR
YEAR_1=$(($(date +%Y) - 1))
YEAR_2=$(($(date +%Y) - 2))

npx tsx --tsconfig tsconfig.server.json scripts/run-backtest-v3-historical.ts ${SLUG} ${YEAR_1}
npx tsx --tsconfig tsconfig.server.json scripts/run-backtest-v3-historical.ts ${SLUG} ${YEAR_2}
```

Para ligas european (cross-year, e.g. PD/PL/BL1), el script usa automáticamente las temporadas correctas desde el año proporcionado.

**Notas:**
- El script leyó de `cache/historical/apifootball/{leagueId}/` (AF canonical) o football-data.org.
- Si el archivo `cache/predictions/historical-backtest-v3-{slug}-{year}.json` ya existe, no regenerar — saltar.
- Si el script falla (sin datos históricos), mostrar aviso y saltar al Step 4.

#### 3.5.3 — Backfill de odds históricas

```bash
npx tsx --tsconfig tsconfig.server.json tools/backfill-historical-odds.ts --comp ${SLUG}
```

Este comando:
- Lee `cache/predictions/historical-backtest-v3-{slug}-*.json` para obtener las fechas de los partidos elegibles
- Descarga odds históricas desde The Odds API (resume-safe — saltea fechas ya cacheadas)
- Registra cada llamada en el ledger (`cache/api-usage.db`) para actualizar el contador en /admin/ops

**Cuota:** ~1 request por ventana de 5 días de partidos. Para 2 temporadas de 30 matchdays = ~12 requests típicamente.

Si el quota del mes está agotado (`THE_ODDS_API_KEY` retorna 429): mostrar aviso, saltar este paso, y anotar en el reporte final que blend accuracy no está disponible.

#### 3.5.4 — Análisis de blend accuracy

```bash
npx tsx --tsconfig tsconfig.server.json tools/analyze-blend-accuracy.ts --comp ${SLUG}
```

Capturar el output. La tabla tiene la forma:
```
Comp    Total  OddsFound  Coverage  ModelAcc  BlendAcc   Δacc
CL        432        415     96.1%     22.2%     52.2%  +30.0
```

Extraer: `Total`, `OddsFound`, `Coverage`, `ModelAcc`, `BlendAcc`, `Δacc` para incluirlos en el reporte final.

**Interpretación de Δacc:**
- Δacc > +5pp → blend aporta valor significativo — confirma que The Odds API está activo en runtime
- Δacc 0–5pp → blend marginal — la liga puede no tener odds líquidas
- Δacc < 0 → blend degrada — revisar calidad de odds o MARKET_WEIGHT

---

## Step 4 — Verificación

Run build and tests:

```bash
pnpm build
```

If build fails: show errors, do NOT mark calibration as complete.

---

## Step 5 — Reporte final

Parse the `[CALIBRATION_SUMMARY]` JSON line from the pipeline output. Use it plus the bias output (PASO 2) to build the report.

**Thresholds de interpretación de bias** (|pred_avg - real_rate|):
- `✓ pequeño` = < 0.03 — corrección leve, tabla agrega poco valor
- `⚠ moderado` = 0.03–0.08 — corrección útil, tabla recomendable
- `❌ grande` = > 0.08 — sobre-predicción significativa, tabla necesaria

**Veredicto de confiabilidad** — derivar así:
- `ALTA`: tuples ≥ 300 AND bias HOME o AWAY ≥ 0.03 (hay problema real que la tabla corrige) AND tabla generada
- `MEDIA`: tuples 100–299 OR bias todo < 0.03 (tabla generada pero corrección es leve)
- `NO EVALUABLE`: tuples < 100 o backtest N/A Y temporada en curso (tabla puede usarse, pero sin validación externa aún)

Show:
```
Calibración V3 completada para {displayName}
─────────────────────────────────────────────
Tabla generada:     cache/calibration/v3-iso-calibration-{slug}.json
Estrategia:         {per-liga | global}
xG augmentation:    {activo | no disponible}
Samples de cal.:    {N} partidos ({T} temporadas)
Bias corregido:     HOME {+X.XXX} {✓/⚠/❌}  DRAW {+X.XXX} {✓/⚠/❌}  AWAY {+X.XXX} {✓/⚠/❌}

Backtest isotónico:
  {Si evaluable > 0:}
  Δacc vs sin cal:    {+X.Xpp}
  Δacc vs global:     {+X.Xpp} (solo si per-liga)
  {Si evaluable = 0:}
  No disponible — temporada {testSeasonLabel} aún en curso.
  Estará disponible cuando avancen los partidos de la temporada actual.

Blend accuracy (modelo + odds de mercado):
  {Si odds disponibles:}
  Backtest snapshots: {N} partidos ({YEAR_2}, {YEAR_1})
  Odds coverage:      {Coverage}% ({OddsFound}/{Total} partidos)
  Accuracy modelo:    {ModelAcc}%
  Accuracy blend:     {BlendAcc}%  (MARKET_WEIGHT=0.65)
  Δacc blend:         {+Xpp}  {✓ blend aporta valor | ⚠ blend marginal | ❌ blend degrada}
  {Si odds no disponibles:}
  No disponible — {razón: liga sin soporte en The Odds API | quota agotada | sin histórico}

Confiabilidad de la tabla: {ALTA | MEDIA | NO EVALUABLE}
  {1 línea explicando el veredicto, ej: "622 tuples + bias HOME ❌ grande — corrección necesaria y bien respaldada"}

Wiring en calibration-selector.ts: ✓

Build: ✓ sin errores

Próximos pasos:
- Reiniciar el servidor para que cargue la nueva tabla: pnpm dev:restart
- Activar predicciones para esta liga en /admin (features.predictions)
- Monitorear accuracy en las próximas jornadas con: pnpm track-a
```

---

---

## Step 3 (NEXUS) — Pipeline NEXUS

**Solo si el usuario eligió NEXUS o V3+NEXUS en Step 1.**

### 3N.1 — Agregar liga a xg-features.ts

The NEXUS feature store needs to know the AF league ID to load xG features (if available).

Read `packages/prediction/src/nexus/feature-store/xg-features.ts`. Check if the competition's AF league ID already exists in `AF_LEAGUE_IDS`.

If NOT present, add:
```typescript
// In AF_LEAGUE_IDS:
'{SLUG}': {afLeagueId},   // {displayName}

// In AF_LEAGUE_ID_TO_CODE:
{afLeagueId}: '{SLUG}',
```

Where `SLUG` is a short uppercase code (e.g. `MX`, `URU`, `ARG`).

### 3N.2 — Verificar NonFdCompDescriptor en v3-shadow-runner.ts

Read `server/prediction/v3-shadow-runner.ts`. Check if `comp:apifootball:{leagueId}` already has a `NonFdCompDescriptor` registered.

If NOT present, add the descriptor for the new league following the AF-canonical pattern:
```typescript
{
  competitionId: '{compId}',
  provider: 'apifootball',
  providerLeagueId: '{leagueId}',
  providerKey: 'apifootball',
  expectedSeasonGames: {expectedSeasonGames},
  afApiKey: process.env.APIFOOTBALL_KEY ?? '',
}
```

Show the proposed addition to the user and confirm before applying.

### 3N.3 — Reentrenamiento (opcional)

Inform the user:

```
Track 3 (NEXUS) usa features genéricos (Elo, rest, form, congestion) y puede inferir
en cualquier liga SIN reentrenamiento. El modelo actual entrenado en PD/PL/BL1 es
válido para {displayName}.

¿Querés reentrenar el modelo incluyendo datos de {displayName}?
(Recomendado solo si hay ≥200 partidos históricos disponibles)

1. Sí — reentrenar con datos de {displayName} incluidos
2. No — usar modelo existente (recomendado para ligas nuevas con poco histórico)
```

**Si elige SÍ:**

Run Track 3 retraining:
```bash
npx tsx --tsconfig tsconfig.server.json tools/train-track3.ts --include-comp {compId}
```

Then run logistic retraining (ensemble weights):
```bash
npx tsx --tsconfig tsconfig.server.json tools/train-logistic.ts --include-comp {compId}
```

Show output as it streams. If either fails: report error and offer to skip retraining (use existing weights).

**Si elige NO:**
Skip to Step 3N.4 directly.

### 3N.4 — Verificación NEXUS

Run build:
```bash
pnpm build
```

Inform the user that NEXUS shadow will start generating predictions for the new league on the next scheduler cycle (once the competition is active in the portal and `PREDICTION_NEXUS_SHADOW_ENABLED` includes the compId or is set to `true`).

### 3N.5 — Reporte NEXUS

```
NEXUS configurado para {displayName}
──────────────────────────────────────
xg-features.ts:       ✓ {SLUG}:{afLeagueId} agregado
shadow-runner:        ✓ NonFdCompDescriptor registrado
Reentrenamiento:      {completado | omitido (modelo existente)}
Build:                ✓ sin errores

NEXUS generará predicciones shadow para {displayName} en el próximo ciclo del scheduler.
Para activar shadow: PREDICTION_NEXUS_SHADOW_ENABLED debe incluir {compId}
```

---

## Constraints

- Do NOT commit or push — wait for explicit user instruction
- Do NOT modify calibration tables for OTHER leagues when running for one specific league
- Do NOT activate predictions in portal-config — that's admin-only
- Do NOT update golden fixtures — requires a formal PE audit round
- xG backfill uses `--resume` — it never re-downloads already-cached fixtures
- NEXUS calibration is out of scope (Iteración 2) — if user insists, inform it's pending
- The global calibration table (`v3-iso-calibration.json`) must NOT be overwritten when running `--comp` for a single league
- Step 3.5 (odds backfill) runs automatically without user confirmation — it is always part of the V3 pipeline
- If `historical-backtest-v3-{slug}-{year}.json` already exists for a season, do NOT regenerate it — skip that year silently
- `backfill-historical-odds.ts` is resume-safe — never re-downloads dates already in `cache/historical-odds/`
- Odds backfill consumes The Odds API quota (~1 req per 5 days of matches). Check remaining before running: `cat cache/historical-odds/soccer_*/$(ls cache/historical-odds/soccer_*/ 2>/dev/null | sort | tail -1) 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print('remaining:', d.get('remaining', 'N/A'))"` — if remaining < 200, skip and note in report
- `run-backtest-v3-historical.ts` supports AF canonical leagues (AF_COMPS) via `cache/historical/apifootball/{leagueId}/{year}.json`. If the historical archive doesn't exist for that year, the script outputs 0 snapshots — this is not an error, just means no data yet
