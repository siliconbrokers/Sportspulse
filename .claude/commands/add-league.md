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

## Step 4 — Collect remaining metadata

Auto-infer as much as possible from the search results. Then ask the user ONLY for what cannot be inferred:

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
- **isTournament** — `false` for league tables, `true` for knockout cups. Show proposed value.
- **expectedSeasonGames** — games per team per season. Show proposed value with reasoning (ej: "17 games × 2 torneos = 34 total season games").
- **totalMatchdays** — if known and not a tournament. Show proposed value or "omitted".
- **hasSubTournaments** — `true` if Apertura/Clausura style. Show proposed value.
- **aperturaSeason** — ONLY if `hasSubTournaments=true`. Which half-year maps to "Apertura"?
  - `H1` = Apertura runs Jan–Jun (Argentina, Uruguay style — default)
  - `H2` = Apertura runs Jul–Dec (Liga MX, Colombia style)
  - Show proposed value. If wrong, the sub-tournament selector will auto-select the wrong tournament.
  - **CRITICAL**: this field is mandatory for any league with `hasSubTournaments=true`. Getting it wrong causes the calendar detection to return the wrong active sub-tournament.

Present all inferred values in a compact block and ask:
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
  isTournament:     {isTournament}
  expectedSeasonGames: {expectedSeasonGames}
  totalMatchdays:   {totalMatchdays or 'omitted'}
  hasSubTournaments: {hasSubTournaments or 'false'}
  aperturaSeason:    {aperturaSeason or 'omitted (no sub-tournaments)'}

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

## Step 10 — Report result

Report:
1. The 3 files edited, one line each describing the change
2. Build and typecheck status
3. Dev server restarted — new league visible in `/admin`
4. Next steps:
   - Ir a `/admin` → activar la liga con el toggle
   - En la primera activación: el data source descarga la temporada actual (~2 requests a API-Football)
   - El motor predictivo empieza a generar predicciones shadow una vez hay partidos FINISHED
   - xG se backfill automáticamente en el primer ciclo (máximo 20 fixtures/ciclo)

---

## Constraints

- Do NOT add news feeds or YouTube channels (separate workflow, out of scope)
- Do NOT set `enabled: true` — activation is always admin-only
- Do NOT commit or push — wait for explicit user instruction
- Do NOT add to COMPETITIONS env var
- `newsKey` must always be `null`
- If leagueId already exists in COMPETITION_REGISTRY → abort immediately
