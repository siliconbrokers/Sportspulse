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

---

## Step 4 — Collect remaining metadata

**The fields `hasSubTournaments`, `aperturaSeason`, and `isTournament` come from Step 3.5 detection — do NOT ask the user about them.** Show them as detected facts. The user may override only if the detection result is clearly wrong (e.g. they say "that's wrong, fix it").

Ask the user ONLY for:

**Always ask:**
- **accentColor** — color hex para el UI (ej: `#16a34a`). Sugerí uno basado en los colores oficiales de la liga si los encontraste.
- **logoUrl** — URL del logo de la liga. Sugerí la URL de TheSportsDB o similar si la encontraste.

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
  accentColor:      {accentColor}
  logoUrl:          {logoUrl}
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

## Step 8 — Edit packages/web/src/hooks/use-portal-config.ts

Read the file first. Append to `DEFAULT_CONFIG.competitions` array:

```typescript
    {
      id: 'comp:apifootball:{leagueId}', slug: '{slug}', displayName: '{displayName}', enabled: false,
      normalizedLeague: '{normalizedLeague}', newsKey: null, accentColor: '{accentColor}',
      isTournament: {isTournament}, logoUrl: '{logoUrl}',
      seasonLabel: '{seasonLabel}',
    },
```

`enabled: false` — activation is admin-only via back office.
Add `phases` and `startDate` if applicable.

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
1. The 3 files edited, one line each describing the change
2. Build and typecheck status
3. Dev server restarted — new league visible in `/admin`

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
- Do NOT set `enabled: true` — activation is always admin-only
- Do NOT commit or push — wait for explicit user instruction
- Do NOT add to COMPETITIONS env var
- `newsKey` must always be `null`
- If leagueId already exists in COMPETITION_REGISTRY → abort immediately
- Do NOT ask the user about `hasSubTournaments`, `aperturaSeason`, or `isTournament` — always auto-detect from AF fixtures in Step 3.5. Users frequently don't know the answer or answer incorrectly.
- Do NOT skip Step 3.5 even if the league "looks simple". The AF round names are the only reliable source of truth for format detection.
- If Step 3.5 detection fails (no APIFOOTBALL_KEY, no fixtures), mark the three fields as "no detectado" and ask the user only as a last resort — with explicit warning that a wrong answer will cause data bugs.
