Add League Wizard — SportsPulse

When this command is invoked, enter interactive wizard mode to add a new football league to SportsPulse.

## Core rule

Do NOT skip the wizard. Do NOT start editing files until ALL steps have been completed and the user has confirmed twice (step 3 + step 4). Proceed step by step, one question at a time.

---

## Context

Adding a league requires exactly 3 file edits. Everything else auto-derives from them:

| File | What it controls |
|------|-----------------|
| `server/competition-registry.ts` | Data source, shadow runner, portal-config catalog, incident source |
| `server/prediction/xg-source.ts` | xG backfill for prediction engine |
| `server/prediction/match-input-adapter.ts` | Competition profile for prediction engine (required for badge/pronósticos) |
| `.env` `PREDICTION_V3_SHADOW_ENABLED` + `NEXUS_SHADOW_ENABLED` | Enables shadow predictions for the league |
| `packages/web/src/hooks/use-portal-config.ts` | Frontend default config fallback |

The league is NOT auto-activated. The admin activates it via the back office toggle after the code is deployed.

---

## Step 1 — Ask for league name or country

Ask:
> ¿Qué liga querés agregar? (nombre y/o país, ej: "Liga MX", "Colombia", "Perú primera")

---

## Step 2 — Search and present options

Use WebSearch to find matching leagues in API-Football. Search query example: `site:api-football.com OR "api-football" league id "{name}" football`.

Also search for: `api-football league id {country} football divisions`

Before showing the list, read `server/competition-registry.ts` to get the current leagueIds already registered.

From the results, build a numbered list of candidate leagues showing:
- Division name (Primera, Segunda, etc.)
- Country
- AF league ID
- Season format (calendar year / european-style)
- Whether it's already in the registry

Mark already-registered leagues with `← ya agregada` and make them non-selectable.

Example output:
```
Ligas encontradas para México:

1. Liga MX — Primera División (ID: 262) ← ya agregada
2. Liga de Expansión MX — Segunda División (ID: 263) — temporada calendar
3. Copa MX (ID: 267) — torneo eliminación directa

¿Cuál querés agregar? (número)
```

If nothing is found via WebSearch, ask the user to provide the league ID manually and continue from Step 3.

---

## Step 3 — Confirm league selection

After the user picks a number, show a single confirmation line:

> La liga seleccionada es **{División} — {País}** (ID: {leagueId}). ¿Confirmás? (s/n)

Do NOT proceed until the user answers "s" or equivalent affirmative.

If the user says "n", go back to Step 2 and show the list again.

If the user selects a league marked as `← ya agregada`, reject the selection immediately and ask them to choose another.

---

## Step 3.5 — Auto-detect league format from AF fixtures (mandatory)

**Do NOT skip this step. Do NOT ask the user about format — detect it automatically.**

After the user confirms the league, fetch real fixtures from API-Football to determine the format. This must be done programmatically, not by asking the user — users frequently don't know or answer incorrectly.

### 3.5.1 — Get the API key

Read the `.env` file to extract `APIFOOTBALL_KEY`:

```bash
AFKEY=$(grep '^APIFOOTBALL_KEY=' .env 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'")
echo "Key found: ${AFKEY:0:8}..."
```

If the key is empty, try `.env.local` as fallback. If still not found, skip to Step 3.5.3 and mark all three format fields as "no detectado — ingresar manualmente".

### 3.5.2 — Fetch fixture data

Fetch the last 20 fixtures AND next 20 fixtures (to cover leagues mid-season and off-season):

```bash
AFKEY=$(grep '^APIFOOTBALL_KEY=' .env 2>/dev/null | cut -d= -f2 | tr -d '"')
YEAR=$(date +%Y)
PREV_YEAR=$((YEAR - 1))

# Try current year first, then previous year as fallback
ROUNDS=$(curl -s \
  "https://v3.football.api-sports.io/fixtures?league={leagueId}&season=${YEAR}&last=20" \
  -H "x-apisports-key: ${AFKEY}" \
  -H "x-rapidapi-key: ${AFKEY}" | \
  jq -r '[.response[].league.round] | unique | .[]' 2>/dev/null)

if [ -z "$ROUNDS" ]; then
  ROUNDS=$(curl -s \
    "https://v3.football.api-sports.io/fixtures?league={leagueId}&season=${PREV_YEAR}&last=20" \
    -H "x-apisports-key: ${AFKEY}" \
    -H "x-rapidapi-key: ${AFKEY}" | \
    jq -r '[.response[].league.round] | unique | .[]' 2>/dev/null)
fi

echo "$ROUNDS"
```

### 3.5.3 — Apply detection rules to round names

Given the list of unique round name strings, apply these rules **in order**:

**Rule A — Detect `hasSubTournaments`:**
- If any round contains the word `"Apertura"` OR `"Clausura"` (case-insensitive) → `hasSubTournaments = true`
- Otherwise → `hasSubTournaments = false`

**Rule B — Detect `aperturaSeason`** (only if hasSubTournaments=true):
- Find the earliest fixture whose round contains `"Apertura"` and look at its month (from `fixture.date`)
- If Apertura fixtures exist in months Jul–Dec (months 7–12) → `aperturaSeason = 'H2'`
- If Apertura fixtures exist in months Jan–Jun (months 1–6) → `aperturaSeason = 'H1'`
- If dates not available, fallback: fetch kickoff dates for the first Apertura fixtures:
  ```bash
  curl -s "https://v3.football.api-sports.io/fixtures?league={leagueId}&season=${YEAR}&round=Apertura%20-%201" \
    -H "x-apisports-key: ${AFKEY}" | jq -r '.response[0].fixture.date'
  ```
- CRITICAL: if this is wrong, the active sub-tournament detection will pick the wrong one (Apertura instead of Clausura or vice versa).

**Rule C — Detect `isTournament`:**
- If any round contains `"Group"` or `"Quarter"` or `"Semi"` or `"Final"` or `"Round of"` → `isTournament = true`
- If hasSubTournaments=true → `isTournament = false` (Apertura/Clausura are always league tables, not knockout)
- Otherwise → `isTournament = false`

**Rule D — Detect `totalMatchdays` / `expectedSeasonGames`:**
- Extract all round numbers: parse `"Regular Season - 14"` → 14, `"Apertura - 17"` → 17
- The max round number found = rounds per sub-tournament (or per season if no sub-tournaments)
- If hasSubTournaments=true: `totalMatchdays = max_round`, `expectedSeasonGames = max_round * 2` (home + away across both tournaments)
- If hasSubTournaments=false and isTournament=false: `totalMatchdays = max_round`

### 3.5.4 — Show detection results

After running the detection, show:

```
Formato detectado automáticamente (desde fixtures AF):

  Rondas encontradas:   ["Regular Season - 1", "Regular Season - 17", ...]
                        ["Apertura - 1", "Apertura - 17", "Clausura - 1", ...]  ← ejemplo con sub-torneos

  hasSubTournaments:    true  ← rondas "Apertura" y "Clausura" detectadas
  aperturaSeason:       H2    ← primer fixture "Apertura - 1" = 2025-07-18 (julio = H2)
  isTournament:         false ← no hay rondas tipo "Group" o "Round of"
  totalMatchdays:       17    ← máximo round number detectado
```

If detection fails (no fixtures found, API error, key missing), show:
```
⚠️  No se pudo auto-detectar el formato (sin fixtures disponibles o sin APIFOOTBALL_KEY).
    hasSubTournaments, aperturaSeason e isTournament deben ingresarse manualmente en Step 4.
```

### 3.5.5 — TheSportsDB Auto-resolution

Fetch badge and accent color from TheSportsDB:

```
GET https://www.thesportsdb.com/api/v1/json/3/search_all_leagues.php?l={displayName}
→ strBadge → logoUrl
→ Extract dominant color from badge URL → accentColor (use most prominent non-white color from the badge filename/path if extractable, else '#6b7280')
→ If not found: logoUrl='', accentColor='#6b7280' (log warning, do not interrupt)
```

Show as detected facts (same format as hasSubTournaments):
```
logoUrl:        {auto-detected}
accentColor:    {auto-detected}
```

### 3.5.6 — Capability Declaration

Check AF availability for this league:

```
GET /odds?league={leagueId}&season={currentSeason}&bookmaker=6 → Track 4 (odds) available?
GET /fixtures/statistics?fixture={sampleFixtureId} → xG available?
GET /fixtures/lineups?fixture={sampleFixtureId} → Track 1B (lineups) available?
```

Output:

```
## Capacidades para {displayName}

✅/⚠️  Tabla de posiciones: {sí/no}
✅/⚠️  Datos históricos: {N temporadas} disponibles
✅/⚠️  xG: {disponible | no disponible en AF — signal omitida del ensemble}
✅/⚠️  Odds: {disponibles | no disponibles — Track 4 con peso cero}
✅/⚠️  Lineups: {disponibles | no disponibles — Track 1B sin señal}

If any ⚠️ → ask: "¿Continuamos sabiendo que X estará degradado? (s/n)"
If all ✅ → continue automatically without asking
```

---

## Step 3.6 — Competition Rules Research

**Purpose:** Determine the zone structure (classification/relegation rules) for the standings table visual indicators, and flag any architectural incompatibilities before editing files.

**Do NOT ask the user for this information.** Use WebSearch automatically.

### 3.6.1 — WebSearch competition rules

Run two searches in parallel:

1. `"{displayName}" wikipedia standings zones classification promotion relegation football`
2. `"{displayName}" {country} football league table Libertadores Sudamericana descenso`

Focus on: positions for continental competition (Copa Libertadores, Copa Sudamericana, UEFA Champions/Europa/Conference League), playoff/liguilla spots, relegation zone. Prefer Wikipedia or official federation sources (CBF, CONMEBOL, UEFA, etc.).

### 3.6.2 — Extract zone structure

From search results, build a zone table using these standard colors:

| Zone type | Standard color | Applies to |
|-----------|---------------|-----------|
| Copa Libertadores / Champions League | `#00E0FF` | `type: 'ucl'` |
| Copa Sudamericana / Europa League | `#F97316` | `type: 'uel'` |
| Conference League / UEL Playoff | `#14b8a6` | `type: 'uecl'` |
| Playoff / Liguilla | `#FBBF24` | `type: 'playoff'` |
| Relegation / Descenso | `#EF4444` | `type: 'relegation'` |

If no zones apply (pure knockout, Copa del Mundo) → zones = [] (expected for `isTournament=true`).

### 3.6.3 — Architectural compatibility check

Evaluate the format:

| Criterion | Status |
|-----------|--------|
| Round-robin league table | ✅ Compatible |
| League + sub-tournament (Apertura/Clausura) | ✅ Soportado (hasSubTournaments) |
| Standalone knockout (no standings) | ✅ Omitir zona (isTournament=true) |
| Group stage + knockout hybrid | ⚠️ Verificar si AF devuelve standings de grupos |
| Format desconocido o multi-fase complejo | ❌ Requiere trabajo adicional |

If ❌: show blocking message, describe what additional work would be needed, and ask user how to proceed (implement new feature / proceed without standings / abort).

### 3.6.4 — Show results and confirm

Show:

```
Reglas del campeonato — {displayName}
─────────────────────────────────────────────────────
Formato:        {round-robin | liga+playoff | torneo eliminación | híbrido}
Compatibilidad: ✅ compatible | ⚠️ requiere config | ❌ bloqueante

Zonas detectadas:
  pos 1–N:    {label} ({type}) — {color}
  pos N+1–M:  {label} ({type}) — {color}
  pos K–T:    Descenso (relegation) — #EF4444
  [o: Sin zonas — torneo eliminación]

Fuente: {Wikipedia/federation URL o "fuente no encontrada"}
```

Ask:
> ¿Las zonas son correctas? Si querés ajustar algo, indicalo. Si está bien escribí "ok".

If the user corrects zones, update before proceeding to Step 4.

If no zones found and it's NOT a tournament: note "⚠️ No se encontraron zonas. La tabla de posiciones no tendrá indicadores de color. Podés agregarlos luego en `packages/web/src/components/StandingsTable.tsx`."

---

## Step 4 — Collect remaining metadata

**The fields `hasSubTournaments`, `aperturaSeason`, and `isTournament` come from Step 3.5 detection — do NOT ask the user about them.** Show them as detected facts. The user may override only if the detection result is clearly wrong (e.g. they say "that's wrong, fix it").

Ask the user ONLY for:

**Always ask:**
- **mode** — En qué modo querés agregar esta liga?
  - `portal` — visible para usuarios, datos y predicciones activos
  - `shadow` — no visible en portal, datos y predicciones activos internamente
  - `disabled` — completamente desactivada (solo registrar en el sistema)

**Auto-infer (show proposed value, let user correct):**
- **slug** — derive from country/league (ej: MX, CO, PE, CL, MX2). Show proposed value.
- **displayName** — full official name. Show proposed value.
- **shortName** — abbreviated name. Show proposed value.
- **normalizedLeague** — SCREAMING_SNAKE_CASE (ej: LIGA_MX). Show proposed value.
- **seasonLabel** — "2026" for calendar-year, "25/26" for european-style. Show proposed value.
- **seasonKind** — `calendar` or `european`. Show proposed value.
- **expectedSeasonGames** — games per team per season. Use value from detection. Show proposed value with reasoning (ej: "17 rondas × 2 torneos = 34 partidos/temporada completa"). If detection failed, show "?" and compute from league structure.
- **totalMatchdays** — use value from detection. Show proposed value or "omitted" if tournament.

**Show as detected facts (not questions):**
- **hasSubTournaments** — `{detected value}` ← auto-detectado desde rondas AF
- **isTournament** — `{detected value}` ← auto-detectado desde rondas AF
- **aperturaSeason** — `{H1|H2|omitted}` ← auto-detectado desde fecha kickoff Apertura (ONLY if hasSubTournaments=true)
- **logoUrl** — `{auto-detected}` ← auto-detectado desde TheSportsDB
- **accentColor** — `{auto-detected}` ← auto-detectado desde TheSportsDB

Present all values in a compact block and ask:
> ¿Corregís algo? Si está todo bien, escribí "ok".

---

## Step 5 — Final confirmation before editing

Show complete summary:

```
Liga a agregar:
  ID:               comp:apifootball:{leagueId}
  AF leagueId:      {leagueId}
  slug:             {slug}
  displayName:      {displayName}
  shortName:        {shortName}
  normalizedLeague: {normalizedLeague}
  mode:             {mode}
  accentColor:      {auto-detectado}
  logoUrl:          {auto-detectado}
  seasonLabel:      {seasonLabel}
  seasonKind:       {seasonKind}
  isTournament:     {isTournament}  ← {auto-detectado | ingresado manualmente}
  expectedSeasonGames: {expectedSeasonGames}
  totalMatchdays:   {totalMatchdays or 'omitted'}
  hasSubTournaments: {hasSubTournaments}  ← {auto-detectado | ingresado manualmente}
  aperturaSeason:    {aperturaSeason or 'omitted (no sub-tournaments)'}  ← {auto-detectado | ingresado manualmente}

Detección de formato:
  Rondas AF analizadas: {muestra las 5 primeras rondas únicas encontradas, o "n/a"}
  Fuente:               {fixtures season {year} | fallback season {prev_year} | sin datos}

Archivos a editar:
  1. server/competition-registry.ts
  2. server/prediction/xg-source.ts
  3. packages/web/src/hooks/use-portal-config.ts
```

Ask: **¿Procedemos con los edits?**

Do NOT proceed until the user confirms.

---

## Step 6 — Edit server/competition-registry.ts

Read the file first. Append a new entry to `COMPETITION_REGISTRY` array, after the last existing entry and before the closing `]`.

Entry shape:
```typescript
  {
    id:                  'comp:apifootball:{leagueId}',
    leagueId:            {leagueId},
    slug:                '{slug}',
    displayName:         '{displayName}',
    shortName:           '{shortName}',
    normalizedLeague:    '{normalizedLeague}',
    newsKey:             null,
    accentColor:         '{accentColor}',
    logoUrl:             '{logoUrl}',
    seasonLabel:         '{seasonLabel}',
    seasonKind:          '{seasonKind}',
    isTournament:        {isTournament},
    expectedSeasonGames: {expectedSeasonGames},
  },
```

Add optional fields only if provided:
- `totalMatchdays: {N},`
- `hasSubTournaments: true,`
- `aperturaSeason: '{H1|H2}',` (MANDATORY when hasSubTournaments=true. H1=Apertura Jan-Jun, H2=Apertura Jul-Dec)
- `phases: ['{phase1}', '{phase2}'],` (only if isTournament=true)
- `startDate: '{date}',`

Always set `newsKey: null` — news/video feeds are handled separately.

---

## Step 7 — Edit server/prediction/xg-source.ts

Read the file first. Locate the `AF_LEAGUE_IDS` constant. Add a new entry after the last `'comp:apifootball:*'` line:

```typescript
  'comp:apifootball:{leagueId}':   {leagueId},  // {displayName}
```

---

## Step 7b — Edit server/prediction/match-input-adapter.ts

**Skip this step if `isTournament=true`** (tournaments like Copa Libertadores use a different profile).

Read the file. Locate the `KNOWN_PROFILES` object, inside the `// API-Football canonical IDs` block. Add after the last `comp:apifootball:*` domestic league line:

```typescript
  'comp:apifootball:{leagueId}':   DOMESTIC_LEAGUE_PROFILE,  // {displayName}
```

**Why this matters:** Without this entry, `deriveCompetitionProfile()` returns `{ ok: false }` and the prediction engine silently skips all matches for this league — no badge, no pronósticos, no shadow predictions.

---

## Step 7c — Update .env and .env.production (shadow vars)

**Skip this step if `isTournament=true`.**

### 7c.1 — Update .env (local dev)

Read the current `.env` file. Append `comp:apifootball:{leagueId}` to **all four** shadow variables:

```
PREDICTION_MAIN_SHADOW_ENABLED=...,comp:apifootball:{leagueId}
PREDICTION_V3_SHADOW_ENABLED=...,comp:apifootball:{leagueId}
PREDICTION_NEXUS_SHADOW_ENABLED=...,comp:apifootball:{leagueId}
NEXUS_SHADOW_ENABLED=...,comp:apifootball:{leagueId}
```

Note: the NEXUS runner reads `NEXUS_SHADOW_ENABLED` (canonical name per spec §S8.2). `PREDICTION_NEXUS_SHADOW_ENABLED` is kept in sync as an alias. Update all four to keep dev and prod consistent.

**Why this matters:** Even with `match-input-adapter.ts` fixed, `isV3ShadowEnabled()` and the NEXUS runner gate on these env vars. A league not listed here will never receive shadow predictions.

### 7c.2 — Update .env.production (Render / production)

Read the current `.env.production` file. Append `comp:apifootball:{leagueId}` to the same four variables:

```
PREDICTION_MAIN_SHADOW_ENABLED=...,comp:apifootball:{leagueId}
PREDICTION_V3_SHADOW_ENABLED=...,comp:apifootball:{leagueId}
PREDICTION_NEXUS_SHADOW_ENABLED=...,comp:apifootball:{leagueId}
NEXUS_SHADOW_ENABLED=...,comp:apifootball:{leagueId}
```

**Why this matters:** `.env.production` is committed to the repo and loaded by the `start` script via `dotenv-cli -e .env.production`. Render picks it up automatically on each deploy — no manual Dashboard editing needed. Without this update, production will never enable shadow predictions for the new league even after deploy.

---

## Step 8 — Edit packages/web/src/hooks/use-portal-config.ts

Read the file first. Append to `DEFAULT_CONFIG.competitions` array:

```typescript
    {
      id: 'comp:apifootball:{leagueId}', slug: '{slug}', displayName: '{displayName}', mode: '{mode}',
      normalizedLeague: '{normalizedLeague}', newsKey: null, accentColor: '{accentColor}',
      isTournament: {isTournament}, logoUrl: '{logoUrl}',
      seasonLabel: '{seasonLabel}',
    },
```

`mode: '{mode}'` — el modo inicial lo define el wizard. El admin puede cambiarlo desde /admin.
Add `phases` and `startDate` if applicable.

---

## Step 4.6 — Zone Wiring in StandingsTable.tsx

Based on the zones confirmed in Step 3.6, add visual indicators to the standings table.

**Skip this step entirely if:** `isTournament=true` OR Step 3.6 confirmed empty zones (no classification/relegation for this league).

### 4.6.1 — Read StandingsTable.tsx

Read `packages/web/src/components/StandingsTable.tsx`. Locate `ZONE_CONFIGS` (around line 55) and the last zone constant defined before it (e.g. `const MX_ZONES`).

### 4.6.2 — Generate zone constant

Using the confirmed zones from Step 3.6, generate a new constant. Use the `SLUG` from Step 4 (uppercased, e.g. `BR` for Brasileirão, `CO` for Colombia):

```typescript
// {displayName} — {brief description, e.g. "pos 1-6 Libertadores, 7-12 Sudamericana, 17-20 descenso"}
const {SLUG}_ZONES: Zone[] = [
  { from: 1,  to: N,  type: 'ucl',        emoji: '🔵', label: '{label}', color: '#00E0FF' },
  { from: N+1,to: M,  type: 'uel',        emoji: '🟠', label: '{label}', color: '#F97316' },
  { from: K,  to: T,  type: 'relegation', emoji: '🔴', label: 'Descenso', color: '#EF4444' },
];
```

Emit only the zone entries that apply. Omit entries for zones that don't exist for this league.

Type mapping:
- Continental A (Libertadores, Champions League): `'ucl'`
- Continental B (Sudamericana, Europa League): `'uel'`
- Continental C (Conference League): `'uecl'`
- Playoff / Liguilla: `'playoff'`
- Relegation / Descenso: `'relegation'`

Emoji convention: 🔵 ucl · 🟠 uel · 🟢 uecl · 🟡 playoff · 🔴 relegation

### 4.6.3 — Apply the edit

Two edits to `StandingsTable.tsx`:

1. **Add zone constant** — insert `const {SLUG}_ZONES: Zone[] = [...]` after the last existing zone constant, just before `const ZONE_CONFIGS`.

2. **Add ZONE_CONFIGS entry** — inside the `// API-Football canonical IDs` block:
```typescript
  'comp:apifootball:{leagueId}': {SLUG}_ZONES,
```

Show the diff before applying. If zones are non-trivial (3+ zones or unusual structure), ask:
> ¿Confirmás la configuración de zonas para {displayName}? (s/n)

For empty zones, skip both edits and note: "Sin zonas configuradas — la tabla se mostrará sin indicadores de color."

---

## Step 9 — Verify

```bash
pnpm build
pnpm tsc --noEmit --project tsconfig.server.typecheck.json
```

Fix any errors before reporting done.

---

## Step 9b — Restart dev server

After a successful build, restart the dev server automatically using the designated script:

```bash
pnpm dev:restart
```

This script (`scripts/dev-restart.sh`) kills all previous processes, waits for port cleanup, and starts fresh. The admin panel will show the new league on the next page reload.

**Why this is mandatory:** the portal-config store merges new registry entries at server startup. Without a restart, the admin panel won't show the new league.

---

## Step 10 — Report result and post-activation checklist

Report:
1. All files edited, one line each describing the change
2. Build and typecheck status
3. Dev server restarted — new league visible in `/admin`
4. `.env.production` updated — Render will pick up the new shadow vars automatically on next `git push` (no manual Dashboard editing needed)

### Post-activation validation checklist

Show this checklist after reporting. Tell the user to run these verifications **after activating the league** in `/admin`:

**Para toda liga:**
- [ ] `/api/ui/status` muestra la liga con `loaded: true`
- [ ] `/api/ui/dashboard?competition={id}` devuelve partidos (o array vacío si fuera de temporada)
- [ ] `/api/ui/standings?competition={id}` devuelve tabla con equipos reales y puntos razonables
- [ ] El carrusel y el panel de detalle abren matches correctamente

**Solo si `hasSubTournaments=true`:**
- [ ] `/api/ui/competition-info?competition={id}` devuelve `activeSubTournament` con valor correcto (`APERTURA` o `CLAUSURA`) — verificar que corresponde al torneo activo según la fecha de hoy
- [ ] `/api/ui/standings?competition={id}&subTournamentKey=APERTURA` y `...&subTournamentKey=CLAUSURA` devuelven **tablas distintas** (diferente líder, distintos puntos). Si devuelven la misma tabla → hay un bug en la detección o en la implementación
- [ ] El selector de sub-torneo en el UI muestra ambas pestañas y auto-selecciona el torneo activo al cargar

**Solo si `isTournament=true`:**
- [ ] El bracket / fase de grupos se renderiza correctamente
- [ ] No hay tabla de posiciones vacía (los torneos knockout no tienen tabla)

### Next steps tras activar:
- Ir a `/admin` → el selector de 3 estados mostrará la liga con el modo configurado. Cambiar a `portal` cuando corresponda.
- En la primera activación: el data source descarga la temporada actual (~2 requests a API-Football)
- El motor predictivo empieza a generar predicciones shadow una vez hay partidos FINISHED
- xG se backfill automáticamente en el primer ciclo (máximo 20 fixtures/ciclo)
- Si algo falla en el checklist: reportar como bug antes de considerar la liga como lista

---

## Step 11 — Calibración del motor predictivo (opcional)

After reporting the result and checklist, ask:

> ¿Querés calibrar el motor predictivo para **{displayName}**?

If the user says NO or ignores: close the wizard with this note:
> "Liga activada sin calibración PE. Cuando haya suficiente histórico (recomendado: al menos una temporada completa), podés correr `/calibrate-league` para calibrar el motor."

If the user says YES, ask:

```
¿Qué motor querés calibrar?

1. Solo V3 (producción)
2. Solo NEXUS (shadow)
3. V3 + NEXUS
4. Ninguno por ahora
```

If the user chooses 1–3: invoke `/calibrate-league` passing the already-known compId and displayName as context. Do NOT ask for the league again — it's already confirmed.

If the user chooses 4: close with the same note as "NO" above.

**Important notes:**
- Not every league needs calibration. Skip this step (choose 4) for: Copa Libertadores, Copa del Mundo, and any tournament league (`isTournament=true`).
- Leagues without AF source cannot be calibrated with xG augmentation — `/calibrate-league` will handle this gracefully.
- NEXUS calibration (options 2 and 3) is Iteración 2 — the skill will inform the user if NEXUS is selected.

---

## Constraints

- Do NOT add news feeds or YouTube channels (separate workflow, out of scope)
- El modo inicial lo define el wizard en Step 4. El admin puede cambiarlo en cualquier momento desde /admin.
- Do NOT commit or push — wait for explicit user instruction
- Do NOT add to COMPETITIONS env var
- `newsKey` must always be `null`
- Do NOT add `defaultMode` to competition-registry.ts entries — the field does not exist in `CompetitionRegistryEntry` and will cause a typecheck error
- Step 7c MUST update BOTH `.env` (local) AND `.env.production` (committed/production). Skipping `.env.production` means Render will never enable shadow predictions for the new league
- If leagueId already exists in COMPETITION_REGISTRY → abort immediately
- Do NOT ask the user about `hasSubTournaments`, `aperturaSeason`, or `isTournament` — always auto-detect from AF fixtures in Step 3.5. Users frequently don't know the answer or answer incorrectly.
- Do NOT skip Step 3.5 even if the league "looks simple". The AF round names are the only reliable source of truth for format detection.
- If Step 3.5 detection fails (no APIFOOTBALL_KEY, no fixtures), mark the three fields as "no detectado" and ask the user only as a last resort — with explicit warning that a wrong answer will cause data bugs.
- Do NOT skip Step 3.6 even for "simple" leagues. Zone research via WebSearch takes 30 seconds and prevents visual bugs in the standings table.
- Do NOT skip Step 4.6 for non-tournament leagues that have zones. The `ZONE_CONFIGS` in `StandingsTable.tsx` is the only place to configure zone indicators — they won't appear otherwise.
