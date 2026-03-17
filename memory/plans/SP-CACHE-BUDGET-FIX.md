# Plan: SP-CACHE-BUDGET-FIX — Corrección de Caché y Presupuesto API-Football
**Creado:** 2026-03-17
**Contexto:** Auditoría `docs/audits/cache-provider-audit-2026-03-17.md`
**Problema raíz:** Cuota AF (100 req/día) agotada en <24h por 3 causas principales:
1. `historical-match-loader-af` no registra requests en af-budget
2. `xg-source` hace hasta N requests por fixture sin caché de disco para la lista
3. `af-budget` se resetea en restart → sistema cree tener cuota cuando no tiene

---

## Fase 0 — Crítico (implementar primero, máximo impacto, mínimo riesgo)

### TASK-CB-01: Integrar af-budget en historical-match-loader-af.ts
**Archivo:** `server/prediction/historical-match-loader-af.ts`
**Cambios:**
- Añadir import de `isQuotaExhausted, consumeRequest, markQuotaExhausted` desde `../../af-budget.js`
- En `loadAfHistoricalMatches()`: check `isQuotaExhausted()` antes del fetch → return `[]` si agotado
- Después de cada fetch exitoso: llamar `consumeRequest()`
- Si la API responde con `errors.requests`: llamar `markQuotaExhausted()`
**Impacto:** hasta 5 requests/ciclo pasan a ser visibles y limitadas por el hard stop

### TASK-CB-02: Persistir budget counter en disco (af-budget.ts)
**Archivo:** `server/af-budget.ts`
**Cambios:**
- Al iniciar el módulo: leer `cache/af-budget.json` si existe → si misma fecha UTC, restaurar `_requestsToday`
- En `consumeRequest()`: escribir `cache/af-budget.json` (asíncrono, fire-and-forget, no bloquear)
- En `markQuotaExhausted()`: escribir inmediatamente (sincrónico)
- Formato: `{ date: "YYYY-MM-DD", requestsToday: N, quotaExhaustedUntil: 0 }`
- Escritura atómica: `.tmp → rename`
**Impacto:** un restart del servidor ya no resetea el contador → sistema honesto sobre cuota disponible

### TASK-CB-03: Integrar af-budget en ApiFootballCanonicalSource.apiGet()
**Archivo:** `server/api-football-canonical-source.ts`
**Cambios:**
- Importar `isQuotaExhausted, consumeRequest, markQuotaExhausted` desde `./af-budget.js`
- En `apiGet()`: check `isQuotaExhausted()` al inicio → throw si agotado (igual que incident source)
- Después del fetch exitoso: `consumeRequest()`
- Si `errors?.requests`: `markQuotaExhausted()` y throw
**Impacto:** canonicalSource (mayor consumidor) pasa a ser visible y respeta el hard stop

---

## Fase 1 — Alto (reducir consumo estructural)

### TASK-CB-04: Cachear fixture list de xg-source en disco
**Archivo:** `server/prediction/xg-source.ts`
**Cambios:**
- La lista de fixtures (IDs + metadata) de una liga/temporada es estable → cachear en disco
- Path: `cache/xg/{leagueId}/{season}/fixture-list.json`
- TTL: 24h para temporada corriente, 1 año para pasadas
- Leer de disco antes de fetch; escribir tras fetch exitoso (atómico)
**Impacto:** elimina 1 req por liga por restart (actualmente invisible si lista expirada)

### TASK-CB-05: Cachear injuries en disco
**Archivo:** `server/prediction/injury-source.ts`
**Cambios:**
- Path: `cache/injuries/{leagueId}/{season}/{date}.json`
- TTL: 12h (lesionados no cambian intra-día)
- Leer de disco antes de fetch; escribir tras fetch exitoso (atómico)
**Impacto:** elimina refetch en restart para datos de lesionados

### TASK-CB-06: Cachear lineups en disco
**Archivo:** `server/prediction/lineup-source.ts`
**Cambios:**
- Path: `cache/lineups/{fixtureId}.json`
- TTL: 2h para partidos futuros, infinito para FINISHED
- Leer de disco antes de fetch; escribir tras fetch exitoso (atómico)
**Impacto:** elimina refetch en restart para alineaciones ya conocidas

### TASK-CB-07: Montar disk persistente en Render
**Acción operacional (no código):**
- Render Dashboard → Servicio → Disks → agregar disk en `/opt/render/project/src/cache`
- Esto hace que el directorio `cache/` sobreviva deploys
- Sin esto, todos los cachés de disco pierden su valor en cada deploy
**Impacto:** elimina el "cold start" post-deploy que vacía la cuota en el primer ciclo

---

## Fase 2 — Medio (observabilidad)

### TASK-CB-08: Budget warning logs
**Archivo:** `server/af-budget.ts`
**Cambios:**
- En `consumeRequest()`: si `_requestsToday` cruza umbrales (100, 200, 400, 500), loguear warning con caller stack si disponible
- Log formato: `[AfBudget] WARNING: {N}/{HARD_LIMIT} requests used today (brake active: {bool})`
**Impacto:** visibilidad de consumo sin instrumentación externa

### TASK-CB-09: Exponer stats de budget en /api/ui/status
**Archivos:** `packages/api/src/ui/` (ruta de status existente) o nuevo endpoint
**Cambios:**
- Añadir `afBudget: getBudgetStats()` al response de `/api/ui/status`
- Incluir `requestsToday`, `limit`, `exhausted`, `brakeActive`
**Impacto:** permite monitorear consumo sin acceso a logs del servidor

### TASK-CB-10: Separar pipeline PE del ciclo de refresh operativo
**Archivo:** `server/index.ts`
**Cambios:**
- `runV3Shadow()` actualmente se llama en cada `runRefreshInner()` (cada 2-30min)
- Los datos históricos de temporada anterior son inmutables → no necesitan recargarse en cada ciclo
- Mover `loadAfHistoricalMatches` a un cache in-memory con TTL 24h dentro de v3-shadow-runner
- El runner verifica si ya tiene los prevSeasonMatches en memoria antes de llamar al loader
**Impacto:** los 5 requests históricos (uno por liga) pasan de "potencialmente cada ciclo" a "una vez por día"

---

## Orden de implementación recomendado

```
TASK-CB-02  (budget persistido)    → prerequisito para que CB-01 y CB-03 tengan sentido
TASK-CB-01  (historical loader)    → mayor fuente de consumo invisible
TASK-CB-03  (canonical source)     → segundo mayor consumidor invisible
TASK-CB-04  (xg fixture list)      → elimina requests en restart
TASK-CB-05  (injuries en disco)    → elimina requests en restart
TASK-CB-07  (disk en Render)       → operacional, no requiere código
TASK-CB-10  (separar PE pipeline)  → reduce frecuencia de requests históricos
TASK-CB-06  (lineups en disco)     → menor impacto que injuries/xg
TASK-CB-08  (budget warnings)      → observabilidad
TASK-CB-09  (stats en /status)     → observabilidad
```

---

## Criterios de aceptación globales
- Un ciclo de refresh completo (5 ligas) no consume más de 10 requests AF en estado normal (caché fresco)
- Un restart del servidor no dispara refetch de datos históricos inmutables
- El budget counter refleja el consumo real del día aunque el servidor se haya reiniciado
- Si `isQuotaExhausted()` es true, NINGÚN módulo hace fetch al proveedor
- Los logs permiten trazar exactamente qué módulo hizo cada request AF
