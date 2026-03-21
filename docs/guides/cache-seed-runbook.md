# Cache Seed Runbook — SportsPulse

Operativa estándar para mantener el disco de producción poblado y evitar storms de API en deploys.

---

## Contexto

El servidor usa un sistema de cache en disco (`cache/`) para evitar llamadas repetidas a APIs externas. En un fresh deploy o cuando Render reprovisiona el disco, este directorio puede estar vacío o incompleto.

Sin cache en disco, el servidor intenta fetchear todos los datos en el primer ciclo de refresh (cada 2 minutos con partidos en vivo), lo que genera un "storm" que destruye la cuota diaria de API en minutos. Se documentaron dos storms reales:

- **2026-03-20 — xG storm**: `fixtures-statistics` a ~3-4 req/s. Causa: sin sentinel para "no hay xG" → los mismos fixtures en `toFetch` cada ciclo.
- **2026-03-20 — Injury storm**: `injuries-by-league-date` a ~20+ req/min. Causa: misma arquitectura, sin cooldown, error paths sin escritura a disco.

**Solución:** poblar el disco de producción con los datos de dev antes de que el tráfico llegue.

---

## Cuándo hacer seed

| Situación | Acción |
|---|---|
| Deploy con nuevos datos de entrenamiento PE | Seed obligatorio |
| Render reprovisionó el disco | Seed obligatorio |
| Primer deploy del proyecto | Seed obligatorio |
| Deploy sin cambios en `cache/` | Opcional (el disco persiste entre deploys en Render) |
| Cuota de API quemada inesperadamente | Seed con `OVERWRITE=true` + verificar logs |
| Se agregó un nuevo directorio a `INCLUDE_DIRS` | Seed obligatorio (prod no tiene ese dir aún) |

**Regla simple:** ante la duda, hacer seed. Es idempotente por defecto (`overwrite: false` — no toca archivos existentes).

---

## Setup

`ADMIN_SECRET` y `SEED_URL` viven en `.env` (ya configurado). El hook `pre-push` los lee automáticamente — no requiere ningún paso adicional.

---

## Comandos

### Deploy normal (el flujo estándar)

```bash
git push origin main
# o equivalentemente:
pnpm deploy
```

El hook `pre-push` (`.husky/pre-push`) se ejecuta automáticamente antes del push, seedea el servidor actual y luego el push procede. El disco persiste entre deploys en Render, por lo que el nuevo deploy arranca con los archivos ya en disco.

Si `ADMIN_SECRET` o `SEED_URL` no están en `.env.local`, el hook advierte pero no bloquea el push.

### Deploy con sobreescritura (cuando dev tiene datos más correctos)

```bash
OVERWRITE=true git push origin main
```

Útil después de: recalibración PE, fix de fixtures, corrección de datos históricos.

### Solo seed (sin push — para re-seedear sin deployar)

```bash
ADMIN_SECRET=<secret> SEED_URL=https://sportspulse-qc6r.onrender.com pnpm pack-cache
```

### Solo empaquetar (verificar tamaño antes de subir)

```bash
pnpm pack-cache
# genera tmp/cache-seed.tar.gz y muestra el curl para subir manualmente
```

---

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `ADMIN_SECRET` | — | Bearer token para auth en `/api/admin/seed-cache` |
| `SEED_URL` | `https://sportspulse-qc6r.onrender.com` | Base URL del servidor destino |
| `OVERWRITE` | `false` | Si `true`, sobreescribe archivos existentes en prod |
Definir `ADMIN_SECRET` y `SEED_URL` en `.env.local` (no commiteado). El hook `pre-push` las carga automáticamente.

---

## Cómo funciona `pack-cache.sh` internamente

```
cache/ (dev)
  └─ apifootball/, xg/, injuries/, ...
        │
        ▼
tar czf tmp/cache-seed.tar.gz apifootball/ xg/ ...   # rutas relativas a cache/
        │
        ▼
base64 < cache-seed.tar.gz > cache-seed.b64           # encode
        │
        ▼
{ "data": "<b64>", "overwrite": false }               # payload JSON
        │
        ▼
POST /api/admin/seed-cache                            # upload
```

1. Itera `INCLUDE_DIRS` y omite silenciosamente los que no existen localmente
2. Crea tarball con rutas relativas — el endpoint extrae directamente en `cache/`
3. El payload JSON se construye con Python para manejar correctamente strings grandes
4. Si `ADMIN_SECRET` + `SEED_URL` están seteados, sube automáticamente y verifica `"ok":true`

Tamaño típico: ~1-2 MB comprimido (base64 ~1.4-2.8 MB). Límite del endpoint: 32 MB.

---

## Cómo funciona `POST /api/admin/seed-cache` internamente

```
request body (JSON, max 32MB)
  { data: "<base64>", overwrite: boolean }
        │
        ▼
Buffer.from(data, 'base64') → tmp/cache-seed-{ts}.tar.gz   # decode a disco temporal
        │
        ▼
tar xzf /tmp/cache-seed-{ts}.tar.gz -C /app/cache [--keep-old-files]
        │
        ▼
rm /tmp/cache-seed-{ts}.tar.gz                              # cleanup
        │
        ▼
{ ok: true, bytes: N, cacheEntries: ["apifootball","xg",...] }
```

- Auth: `Authorization: Bearer <ADMIN_SECRET>` — falla con 401 si no coincide
- `overwrite: false` → flag `--keep-old-files` en tar (no toca archivos ya presentes)
- `overwrite: true` → tar normal (sobreescribe todo)
- El tmpfile siempre se borra en el bloque `finally`, incluso si falla la extracción

---

## Directorios incluidos: estructura y TTLs

### `apifootball/` — Matchday data API-Football

```
cache/apifootball/{leagueId}/{season}/matchday-{NN}.json
cache/apifootball/{leagueId}/{season}/matchday-{NN}-{KEY}.json   # sub-torneos (Liga MX)
```

TTL: finished=1y, scheduled=6h, live=60s, mixed=5min. Gestionado por `matchday-cache.ts`.

### `football-data/` — Matchday data football-data.org

```
cache/football-data/{competitionCode}/{season}/matchday-{NN}.json
```

Mismos TTLs. Fuente principal para PD, PL, BL1.

### `xg/` — xG histórico por fixture

```
cache/xg/{leagueId}/{season}/{fixtureId}.json      # xG por partido — TTL infinito
cache/xg/{leagueId}/{season}/fixture-list.json     # índice de fixtures FINISHED — TTL 24h current / 1y past
```

Los archivos de fixture con `noXg: true` son sentinels que evitan re-fetch de fixtures sin estadísticas disponibles (e.g. partidos sin datos de tiro en AF).

### `historical/` — Partidos históricos por temporada (training data PE)

```
cache/historical/apifootball/{leagueId}/{year}.json         # historical-match-loader-af (AF)
cache/historical/af/{leagueId}/{season}.json                # af-historical-match-loader (AF, shadow validator)
cache/historical/football-data/{competitionCode}/{year}.json # historical-match-loader (FD: PD/PL/BL1)
cache/historical/thesportsdb/{leagueId}/{year}.json         # historical-match-loader-sportsdb + non-fd-prev-season-loader
cache/historical/sportsdb-ar/{leagueId}/{year}.json         # non-fd-prev-season-loader (ARG)
cache/historical/openligadb/{league}/{year}.json            # non-fd-prev-season-loader (BL1)
cache/historical/injuries/apifootball/{leagueId}/{season}/{date}.json   # archivo histórico injuries (write-once)
cache/historical/lineups/apifootball/{fixtureId}.json                   # archivo histórico lineups (write-once)
```

TTL por temporada: past seasons = 1 año (inmutable), current season = 6h.

### `injuries/` — Cache de lesiones por (liga/season/fecha)

```
cache/injuries/{leagueId}/{season}/{YYYY-MM-DD}.json
```

TTL disco: **12h**. TTL memoria: 6h. Cooldown de re-fetch: 6h por key `{leagueId}:{season}:{date}` (protege contra concurrent calls en el primer ciclo post-deploy).

### `player-stats/` — Stats de jugadores (importancia para modelo)

```
cache/player-stats/{season}/{playerId}.json
```

TTL: **30 días**. Se usa para derivar `importance` de cada jugador lesionado a partir de minutos jugados.

### `lineups/` — Alineaciones confirmadas

```
cache/lineups/{leagueId}/{date}.json          # lista de fixtures por liga+fecha
cache/lineups/fixtures/{fixtureId}.json       # lineup por fixture
```

TTL disco: **24h** para ambos (post-kickoff el lineup no cambia). Solo se fetchea dentro de los **15 minutos previos al kickoff**. Las respuestas vacías (lineup aún no publicado) no se cachean en disco — se reintenta en el próximo ciclo (2 min).

### `odds/` — Odds de mercado por fixture (AF)

```
cache/odds/{fixtureId}.json
```

TTL disco: **4h** si hay odds, **30min** si `odds: null` (confirmado sin odds). El campo `odds` puede ser `null` — eso es un resultado válido, no un error.

### `calibration/` — Tablas de calibración PE

```
cache/calibration/v3-iso-calibration.json              # tabla global
cache/calibration/v3-iso-calibration-{leagueCode}.json # tabla por liga (PD, PL, BL1, etc.)
cache/calibration/v3-iso-calibration-{leagueCode}-xg.json  # variante con xG
cache/calibration/v3-iso-calibration-ensemble.json     # ensemble global
```

Archivos planos en la raíz del directorio. Generados offline. Inmutables hasta próxima recalibración.

### `nexus-models/` — Modelo NEXUS

```
cache/nexus-models/track3-weights-global.json   # único archivo — pesos logísticos Track 3
```

Archivo único global. Reemplazar solo con `OVERWRITE=true` cuando hay un nuevo modelo entrenado.

### `events/` — Eventos de gol por partido FINISHED

```
cache/events/match_{provider}_{matchId}.json
# ej: cache/events/match_football-data_538015.json
```

TTL: **permanentes** (write-once, nunca se sobreescriben). Un archivo por partido FINISHED con los eventos de gol confirmados.

### `af-team-bridge/` — Mapeo AF teamId → canonical teamId

```
cache/af-team-bridge/{leagueId}-{season}.json
```

TTL: **30 días**. Se regenera automáticamente cuando vence.

### Caveat: caches de TTL corto

`injuries/` (12h), `odds/` (4h), `lineups/` (24h) tienen TTLs cortos. Si los archivos del tarball son más viejos que el TTL al momento de extraerse en prod, se tratan como expirados en el primer read y se refetchean de la API.

La protección en ese caso NO es el disco sino el **cooldown** (injuries: 6h por key). La implicancia es que el seed es más efectivo si se hace el mismo día o inmediatamente antes/después de un deploy. El valor de estos archivos decrece con el tiempo.

Los caches de TTL largo (`xg/` infinito, `historical/` 1 año past seasons) no tienen esta limitación y son los más valiosos de seedear.

---

## Directorios de `cache/` excluidos del tarball

| Directorio | Motivo de exclusión |
|---|---|
| `cache/shadow/` | Resultados del shadow validator — efímeros, se regeneran en cada run |
| `cache/incidents/` | Mapeo matchId → AF fixtureId — se reconstruye con 1 req por partido desconocido |
| `cache/nexus-shadow/` | Resultados del shadow NEXUS por partido — efímeros, se regeneran en cada run |
| `cache/portal-config-audit.jsonl` | Log de auditoría del back office — no tiene sentido replicar |

`portal-config.json` SÍ está incluido como archivo suelto en `INCLUDE_FILES` — es necesario para que el portal cargue con la configuración correcta de ligas habilitadas.

---

## Capas de defensa anti-storm por source

Cada source tiene múltiples capas. Un request solo llega a la API si todas las capas anteriores fallan.

### `xg-source.ts`

```
1. Memoria (fixture list: 1h TTL)
2. Disco   (fixture list: 24h current / 1y past seasons)
3. Sentinel noXg: true en disco → skip permanente sin TTL
4. Cooldown: XG_BACKFILL_INTERVAL_MS = 6h por competitionId
5. Cap:     MAX_NEW_XG_FETCHES_PER_CYCLE = 3 (máx 3 fixtures nuevos por ciclo)
```

### `injury-source.ts`

```
1. Memoria (MEM_CACHE_TTL_MS = 6h por leagueId:season:date)
2. Disco   (DISK_CACHE_TTL_MS = 12h por leagueId:season:date)
3. Cooldown: INJURY_FETCH_INTERVAL_MS = 6h por leagueId:season:date
   → previene burst de concurrent calls (múltiples partidos del mismo día en paralelo)
4. Error paths escriben [] al disco → el próximo restart lee disco directamente
```

### `lineup-source.ts`

```
1. Guard: minutesToKickoff > 15 → return [] (no fetchea para partidos lejanos)
2. Memoria (fixtures: 1h, lineups: 2h)
3. Disco   (fixtures: 24h, lineups: 24h)
4. Error paths escriben [] al disco
5. Respuesta vacía (lineup no publicado aún) NO se cachea en disco — reintenta el próximo ciclo
```

### `af-odds-service.ts`

```
1. Memoria (MEM_TTL_MS = 2h si hay odds, NULL_TTL_MS = 30min si no hay)
2. Disco   (DISK_TTL_MS = 4h si hay odds, NULL_TTL_MS = 30min si no hay)
3. Error paths escriben null al disco (HTTP error + catch)
```

---

## Verificación post-seed

### Via logs de Render

```
[AdminRouter] seed-cache: extracted 1048576 bytes → /app/cache (apifootball,football-data,xg,injuries,player-stats,lineups,odds,historical,calibration,nexus-models,af-team-bridge,portal-config.json)
```

### Via API

```bash
curl https://sportspulse-qc6r.onrender.com/api/ui/status
# Verificar que todas las ligas tienen "loaded": true
```

### Conteo de archivos esperado (aproximado)

| Directorio | Archivos típicos |
|---|---|
| `xg/` | 5000-6000 (uno por fixture FINISHED) |
| `historical/` | ~50-100 (por liga × temporadas) |
| `injuries/` | ~200-400 (por liga × días con partidos) |
| `player-stats/` | ~500-2000 (varía según temporadas activas) |
| `lineups/` | ~100-300 (solo post-kickoff, 15min window) |
| `odds/` | ~200-500 (fixtures activos en ventana de tiempo) |
| `events/` | ~100+ y creciendo (uno por partido FINISHED con eventos de gol) |

---

## Troubleshooting

### Storm activo en producción

```
1. Identificar operationKey en /api/admin/ops (panel de ops)
2. Deshabilitar APIFOOTBALL_KEY en Render Dashboard (variables → eliminar temporalmente)
   → El servidor retorna [] para todos los fetches — cuota protegida
3. Hacer seed:
   OVERWRITE=true ADMIN_SECRET=xxx SEED_URL=... pnpm pack-cache
4. Re-habilitar APIFOOTBALL_KEY
5. Verificar que el operationKey no aparece más en los logs
```

### Seed falla con error 401

```bash
# Verificar que ADMIN_SECRET coincide con la var en Render
echo $ADMIN_SECRET
```

### Seed falla con error 500 — "Extraction failed"

```bash
# Verificar tamaño del payload (límite: 32MB)
wc -c tmp/cache-seed.b64

# Ver detalle del error en logs de Render
# Causa más común: directorio cache/ sin permisos de escritura
```

### `--keep-old-files` da error en macOS

```bash
# macOS BSD tar y GNU tar (Linux/Render) soportan --keep-old-files
# Si hay problema local usar OVERWRITE=true para testing y dejar el seed a prod sin OVERWRITE
```

### El seed se completa pero los datos no aparecen

```bash
# Verificar que el tarball tiene rutas relativas (no absolutas)
tar tzf tmp/cache-seed.tar.gz | head -20
# Debe mostrar: apifootball/268/2026/matchday-01.json
# NO debe mostrar: /app/cache/apifootball/... ni ./apifootball/...
```
