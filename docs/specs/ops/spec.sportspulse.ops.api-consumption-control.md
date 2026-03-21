# spec.sportspulse.ops.api-consumption-control.md

**Versión:** 1.0
**Estado:** VIGENTE
**Motivación:** Tres storms documentados en 2026-03-21 destruyeron la cuota diaria de API-Football
(`fixtures-statistics`, `injuries-by-league-date`, `players-by-id`). Causa raíz en los tres casos:
llamadas de datos de entrenamiento ejecutándose automáticamente en el ciclo de refresh de producción,
sin protección suficiente ante restarts y sin considerar que dev y prod comparten la misma API key.

---

## Regla 1 — Clasificación LIVE / OFFLINE (obligatoria antes de implementar)

Toda llamada a API externa debe clasificarse **antes de escribir código**:

| Clase | Definición | Puede ir en ciclo de refresh |
|-------|-----------|------------------------------|
| `LIVE` | Necesaria para servir datos en tiempo real (matchday, scores, lineups pre-kickoff, odds activas) | Sí, con protección anti-storm (Regla 3) |
| `OFFLINE` | Datos de entrenamiento, stats históricas, player stats, backfill, calibración | **Nunca.** Solo en scripts manuales o cron desacoplado |

### Criterio de clasificación

Una llamada es `OFFLINE` si **cualquiera** de estas condiciones es verdadera:
- El dato tiene TTL > 24h (player stats, historical matches, calibration data)
- Se llama una vez por jugador/fixture/entidad, no por partido en curso
- Es útil para mejorar la calidad del modelo pero no bloquea el render del portal
- Ya existe un fallback estático aceptable (e.g. importance por posición)

### Consecuencia del incumplimiento

`fetchPlayerMinutes` fue clasificada implícitamente como `LIVE` al agregarse al loop de injuries.
Resultado: storm de 5-6 req/s en cada restart, cuota destruida en minutos.

---

## Regla 2 — Cálculo de impacto obligatorio

Antes de implementar cualquier llamada API nueva, documentar en el código o en el PR:

```
operationKey: <nombre>
calls_per_cycle_worst_case: <N>   // cuántas veces se llama por refresh cycle
calls_per_day_worst_case: <N>     // asumiendo ciclo cada 2min × 720 ciclos/día
cold_restart_impact: <N>          // cuántas llamadas en el primer ciclo post-restart sin cache
quota_percentage: <X>%            // de los 7500 req/día disponibles
```

**Límite:** si `cold_restart_impact` supera el **1% de la cuota diaria** (75 llamadas), la
implementación requiere aprobación explícita antes de mergear.

### Ejemplo: `players-by-id` (debería haber sido rechazado)

```
operationKey: players-by-id
calls_per_cycle_worst_case: N_jugadores_lesionados × N_ligas ≈ 200
calls_per_day_worst_case: 200 × 720 = 144.000  // 19x la cuota diaria
cold_restart_impact: 200                         // burst inmediato en restart
quota_percentage: 2.7% por restart              // inaceptable
```

---

## Regla 3 — Checklist anti-storm (obligatorio para toda llamada LIVE)

Toda llamada en el ciclo de refresh debe pasar este checklist antes de considerarse completa:

### 3.1 — Sentinel en disco en TODOS los error paths

```typescript
// CORRECTO: escribir a disco en TODOS los casos — éxito, error HTTP, error de red, quota
if (!res.ok) {
  writeDiskCache(key, SENTINEL_VALUE); // sentinel = [] o null según el tipo
  return SENTINEL_VALUE;
}
// ... procesar respuesta ...
writeDiskCache(key, result);
return result;

// INCORRECTO: solo escribir en éxito
if (!res.ok) return []; // ← sin escritura → re-fetch en cada restart
```

### 3.2 — Cooldown basado en disco, no en memoria

Los mapas `_lastFetchAttemptMs = new Map()` se pierden en cada restart.
El cooldown efectivo requiere que el sentinel en disco actúe como gate permanente.

```typescript
// El sentinel escrito en 3.1 actúa como cooldown que sobrevive restarts:
const fromDisk = readDiskCache(key);
if (fromDisk !== null) return fromDisk; // sentinel o dato real — ambos bloquean el fetch
```

### 3.3 — Write-before-fetch para llamadas costosas

Para llamadas donde el burst en frío es peligroso, escribir el sentinel **antes** de la llamada:

```typescript
writeDiskCache(key, SENTINEL_VALUE);  // escrito antes — si crashea, no re-fetcha
_lastAttemptMs.set(key, Date.now());
const result = await fetch(url);      // si crashea aquí, el sentinel ya está
writeDiskCache(key, result);          // sobrescribe con dato real si tiene éxito
```

### 3.4 — Cap global por proceso como última defensa

Para llamadas que pueden dispararse N veces por ciclo (una por entidad):

```typescript
const MAX_FETCHES_PER_PROCESS = 30; // ajustar según cuota y cantidad de entidades
let _fetchCount = 0;

if (_fetchCount >= MAX_FETCHES_PER_PROCESS) return FALLBACK;
_fetchCount++;
```

---

## Regla 4 — Dev y prod comparten cuota

**Dev y prod usan la misma `APIFOOTBALL_KEY`.** Toda llamada que corre en dev quema cuota de prod.

### Consecuencias

- Las llamadas `OFFLINE` que necesiten la API **no pueden activarse automáticamente** en el servidor de desarrollo.
- Los scripts de backfill y training deben correr explícitamente con `ENABLE_TRAINING_FETCHES=true` (flag desactivado por defecto).
- Nunca correr el dev server con partidos en vivo activos mientras se desarrolla una feature que hace llamadas `OFFLINE` automáticas.

### Implementación obligatoria para nuevas llamadas OFFLINE

```typescript
// Toda llamada OFFLINE debe estar gateada
if (!process.env.ENABLE_TRAINING_FETCHES) {
  return FALLBACK_VALUE;
}
```

---

## Inventario de callers activos (AF mode, producción)

Estado al 2026-03-21 (actualizado post-audit F-01 a F-10):

| operationKey | Clase | Protección | Estado |
|---|---|---|---|
| `fixtures-live-all` | LIVE | matchday cache | OK |
| `injuries-by-league-date` | LIVE | disco + mem + cooldown 6h + disco-sentinel en quota-body path (F-05) | OK |
| `players-by-id` | OFFLINE | **DESHABILITADO** — importance estático | OK |
| `fixtures-statistics` (xG) | OFFLINE | disco + cap MAX_NEW_XG_FETCHES=3 + gate ENABLE_TRAINING_FETCHES (F-03) + mem-cache 10min (F-09) + error sentinels en HTTP/network paths (F-01) | OK |
| `fixtures-list` (xG fixture list) | OFFLINE | disco + error sentinels en HTTP/network paths (F-02) | OK |
| `fixtures-by-date` (lineups) | LIVE | disco + guard 15min pre-kickoff (previo 45min) | OK |
| `fixtures-lineups` | LIVE | disco + no cachea [] vacío (sin lineup publicado) + error paths con TTL_ERROR=30min (F-07) | OK |
| `odds` (af-odds-service) | LIVE | disco + sentinel null en error paths | OK |
| `fixtures-historical-by-league` | OFFLINE | disco + error sentinel 30min en HTTP/network catch (F-04) + sin QuotaExhaustedError sentinel | OK |

### Callers desactivados en AF mode

`teams-by-league` — solo activo con `SHADOW_AF_VALIDATION_ENABLED=true`. Tiene disco cache. Si se reactiva, debe cumplir Regla 3 completa.

### xG Backfill — gate ENABLE_TRAINING_FETCHES (F-03)

El timer de backfill de xG (`runXgBackfill` en `server/index.ts`) solo se activa si `ENABLE_TRAINING_FETCHES=true`. Por defecto está desactivado en dev y prod. Activar solo para seed inicial de datos xG en un ambiente nuevo. El runner (`v3-shadow-runner`) usa `readCachedXg()` (solo disco) — no llama a la API en el ciclo LIVE.

### Lineups — error TTL override (F-07)

Los error sentinels de lineups (`[]` + `ttlMs: 30min`) expiran en 30min, no en 24h. Esto evita que un error transitorio bloquee el fetch durante todo el día.
Los error sentinels de `fixtures-historical-by-league` tienen el mismo patrón con `TTL_ERROR_MS = 30min`.

---

## Checklist de revisión para PRs que agreguen llamadas API

Antes de mergear cualquier PR que agregue o modifique llamadas a API externa:

- [ ] Clasificación LIVE/OFFLINE documentada
- [ ] Cálculo de impacto completado (calls/ciclo, calls/día, cold_restart_impact)
- [ ] `cold_restart_impact` < 75 (1% de cuota diaria) o aprobación explícita
- [ ] Sentinel en disco en todos los error paths
- [ ] Cooldown efectivo ante restarts (disco-based o write-before-fetch)
- [ ] Cap global si la llamada se dispara N veces por ciclo
- [ ] Llamadas OFFLINE gateadas con `ENABLE_TRAINING_FETCHES`
- [ ] Entrada agregada al inventario de callers activos (esta sección)
