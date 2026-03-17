# Auditoría Forense — Caché, Flujo de Datos y Consumo de Proveedor Externo
**Fecha:** 2026-03-17
**Autor:** Backend Engineer (Sonnet)
**Trigger:** Cuota de API-Football (100 req/día) agotada en <24h en producción.

---

## Resumen ejecutivo

El sistema consume la cuota diaria de API-Football en un solo ciclo de refresh. El caché de matchday (disco, por jornada) funciona correctamente para datos operativos. El problema está en capas periféricas: el motor predictivo V3 llama a cargadores históricos que **no están integrados con el sistema de presupuesto** (`af-budget.ts`), y componentes como xG, injuries y lineups usan caché solo en memoria que se pierde en cada restart/deploy. Además, el budget counter en memoria también se resetea en cada restart, haciendo que el sistema crea que tiene cuota disponible aunque la API ya la consumió.

---

## Consumidores de API-Football identificados

| Consumidor | Archivo | Budget-aware | Requests por ciclo | Caché disco |
|------------|---------|-------------|-------------------|-------------|
| `ApiFootballCanonicalSource` | `server/api-football-canonical-source.ts` | ❌ NO | 1-3 por liga × 5 ligas | ✅ Sí (matchday) |
| `ApifootballLiveOverlay` | `server/apifootball-live-overlay.ts` | ✅ Sí | 1/2min LIVE, 1/15min idle | ❌ No |
| `ApiFootballCLIOverlay` | `server/api-football-cli-overlay.ts` | Parcial | 1/ciclo | ❌ No |
| `IncidentService` (ApiFootballIncidentSource) | `server/incidents/apifootball-incident-source.ts` | ✅ Sí | 1-3 por match | ✅ Sí (fixture map) |
| `historical-match-loader-af` | `server/prediction/historical-match-loader-af.ts` | ❌ **NO** | 1 por liga/temporada si MISS | ✅ Sí (1 año TTL) |
| `xg-source` | `server/prediction/xg-source.ts` | ✅ Sí | 1 lista + N fixtures MISS | ⚠️ Parcial (fixtures sí, lista no) |
| `injury-source` | `server/prediction/injury-source.ts` | ✅ Sí | 1 por (liga, fecha) si MISS | ❌ Solo memoria |
| `lineup-source` | `server/prediction/lineup-source.ts` | ✅ Sí | 1 por partido scheduled | ❌ Solo memoria |
| `ApiFootballCanonicalSource.getTopScorers` | `server/api-football-canonical-source.ts` | ❌ NO | 1 por liga/hora | ❌ Solo memoria |

---

## Top 5 hallazgos críticos

### F1 — CRÍTICO: `historical-match-loader-af.ts` bypasea af-budget
- **Archivo:** `server/prediction/historical-match-loader-af.ts`, líneas 131–143
- **Evidencia:** `fetch()` directo a `v3.football.api-sports.io` sin importar ni invocar `af-budget.ts`
- **Efecto:** cada ciclo de refresh donde hay cache miss → 1 req por liga (hasta 5) invisible al presupuesto
- **Afecta:** datos históricos de temporada anterior (inmutables pero pedidos en cada restart)
- **Confirmado:** inspección de código

### F2 — CRÍTICO: `xg-source.ts` hace hasta N requests por jornada sin control
- **Archivo:** `server/prediction/xg-source.ts`
- **Evidencia:** fixture list cacheada solo en memoria (TTL 1h). Cada fixture FINISHED sin caché de disco → 1 req AF. LaLiga tiene 380 fixtures/temporada. Si disco vacío → 380 requests solo para xG de una liga.
- **Efecto:** primer ciclo post-deploy puede consumir toda la cuota solo con xG
- **Afecta:** datos históricos de xG (inmutables una vez finalizado el partido)
- **Confirmado:** inspección de código

### F3 — ALTO: `ApiFootballCanonicalSource.apiGet()` no registra requests en af-budget
- **Archivo:** `server/api-football-canonical-source.ts`, método privado `apiGet()`
- **Evidencia:** sin import de `af-budget.ts`. Startup con 5 ligas → ~10-15 requests invisibles.
- **Efecto:** el consumidor más pesado del sistema es invisible al presupuesto
- **Confirmado:** inspección de código

### F4 — ALTO: Budget counter en memoria se resetea en cada restart
- **Archivo:** `server/af-budget.ts`, línea 19: `let _requestsToday = 0`
- **Evidencia:** variable en memoria pura. Cada restart = contador en 0, aunque la API ya consumió requests ese día.
- **Efecto:** sistema cree que tiene cuota disponible cuando no la tiene; no se detecta hasta que la API responde con error
- **Confirmado:** inspección de código

### F5 — ALTO: injury-source y lineup-source no cachean en disco
- **Archivos:** `server/prediction/injury-source.ts`, `server/prediction/lineup-source.ts`
- **Evidencia:** solo `Map` en memoria. Lesionados TTL 6h, lineups 1-2h en memoria.
- **Efecto:** cada restart → refetch de datos que no cambian en días (lesionados) u horas (lineups)
- **Confirmado:** inspección de código

---

## Separación dev/prod y política de no-refetch histórico

### ¿Producción refetchea históricos ya materializados?
**SÍ.** Si Render no tiene un disk volume persistente (configuración por defecto del free tier), el directorio `cache/` se pierde en cada deploy. Todos los cachés de disco desaparecen y el primer ciclo de refresh hace:
- 5 full-season fetches de temporada anterior (historical-match-loader-af)
- hasta 380 requests de xG por liga sin caché
= potencial de vaciar la cuota en el primer ciclo post-deploy

### ¿Existe política de no-refetch para datos históricos?
**NO existe explícitamente.** El mecanismo (TTL largo en disco) existe, pero sin disk persistente en Render y sin budget counter persistido, la protección es ilusoria.

### ¿Dev y prod comparten caché?
**No.** Cada entorno tiene su propio `cache/` local. No hay mecanismo de promoción de dataset materializado.

---

## Instrumentación faltante

| Métrica | Estado |
|---------|--------|
| Contador de requests por módulo (canonical, historical, xg, injury, lineup) | ❌ No existe |
| Log de "historical refetch attempted" | ❌ Solo console.log genérico |
| Budget counter persistido en disco | ❌ In-memory — se resetea en restart |
| Trazabilidad request → caller | ❌ No existe |
| Cache hit rate por módulo | ❌ No existe |
| Alarma si budget > umbral en N horas | ❌ No existe |

---

## Veredicto

| Aspecto | Veredicto |
|---------|-----------|
| Caché datos operativos (matchday, teams, standings) | **Funciona parcialmente** — correcto en lógica, pero no sobrevive deploys sin disk persistente |
| Caché datos históricos PE (historical-match-loader-af) | **Funciona pero desconectado del budget** — TTL correcto, pero no integrado con af-budget |
| Caché xG, injuries, lineups | **Parcialmente roto** — solo in-memory, se pierden en restart |
| Budget counter | **Roto para restarts** — no persiste entre procesos |
| Política de no-refetch histórico | **No existe explícitamente** — violada en producción |

---

## Plan de corrección

Ver: `memory/plans/SP-CACHE-BUDGET-FIX.md`
