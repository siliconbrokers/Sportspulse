# SP-AF-MIGRATION — Migración a API-Football como fuente única

## Fecha: 2026-03-16
## Trigger: Suscripción completa API-Football disponible

---

## Hallazgo crítico: los IDs canónicos están acoplados al proveedor

Los IDs del sistema son `team:football-data:340`, `match:football-data:401245`.
Un reemplazo total de football-data.org rompería:
- Todos los caches de matchday en `/cache/football-data/`
- Todos los prediction snapshots (usan canonical team IDs)
- Todos los incident/xG caches (indexados por canonical matchId)
- Todos los radar snapshots

**Por eso: NO es un reemplazo directo. Es una consolidación en fases.**

---

## Estrategia en 3 tracks independientes

### Track A — Activar T3 completo (ya implementado, solo desbloquear)
**Riesgo:** Ninguno. **Valor:** Inmediato. **Tiempo:** 1 día.

Los fetchers de injuries, lineups, xG ya existen. Solo los frena el `af-budget.ts`
que asumía 100 req/día (free tier). Con suscripción completa ese freno desaparece.

### Track B — API-Football como fuente histórica del PE
**Riesgo:** Bajo. **Valor:** Alto (más datos, xG histórico, más temporadas). **Tiempo:** 1 semana.

El PE consume `V3MatchRecord[]` — una estructura simple `{homeTeamId, awayTeamId, utcDate, homeGoals, awayGoals}`.
Si construimos esos records desde API-Football usando un bridge de IDs
(AF team ID → canonical football-data team ID), el PE obtiene datos enriquecidos
sin tocar el layer canónico.

### Track C — Migración canónica completa (largo plazo)
**Riesgo:** Alto. **Valor:** Arquitectural. **Tiempo:** 2–4 semanas + QA extenso.

Introduce `apifootball` como provider key estable. Requiere scripts de migración
de cache, invalidación de todos los snapshots existentes, y un cutover coordinado.
**No bloquea Tracks A y B. Ejecutar solo después de ≥2 meses de estabilidad.**

---

## Track A — Detalles de implementación

### A1: Eliminar af-budget brake
**Archivo:** `server/af-budget.ts`
- Cambiar `DAILY_QUOTA = 100` a un valor acorde al plan contratado
- Eliminar el `brake` (throttling a 20min) o subir el umbral al 95% del nuevo límite
- Actualizar `consumeRequest()` para loguear sin bloquear

### A2: Desbloquear XgSource
**Archivo:** `server/prediction/xg-source.ts`
- Eliminar `MAX_XG_REQUESTS_PER_CYCLE = 5`
- Permitir backfill completo por temporada sin límite artificial

### A3: Habilitar injuries + lineups para BL1 + otras ligas
**Archivo:** `server/prediction/injury-source.ts`, `server/prediction/lineup-source.ts`
- Verificar que `AF_LEAGUE_IDS` incluye todos los competition IDs activos
- Añadir Liga Argentina (4406) si corresponde

### A4: Actualizar logs/monitoreo
- Cambiar nivel de warning de budget a INFO
- Agregar métrica de req/día en logs para visibilidad con nueva cuota

---

## Track B — API-Football como fuente histórica del PE

### Arquitectura

```
football-data.org  ─────────────────────────────→  Canonical layer (UI, IDs, live)
                                                       │
                                                       │ match-input-adapter.ts
                                                       ↓
API-Football v3  ──→  AF Historical Loader  ──→  V3MatchRecord[]  ──→  PE Engine
                        (con ID bridge)
```

El PE recibe `V3MatchRecord[]` desde API-Football usando IDs canónicos
traducidos via un bridge (AF team ID ↔ canonical FD team ID).

### B1: Team ID Bridge
**Archivo nuevo:** `server/prediction/af-team-id-bridge.ts`

```typescript
// Bridge: AF numeric team ID → canonical team ID
// Construido cruzando nombre de equipo entre ambas APIs
interface AfTeamBridge {
  afTeamId: number;
  afTeamName: string;
  canonicalTeamId: string;  // "team:football-data:340"
  canonicalName: string;
}
```

**Estrategia de construcción:**
1. Para cada liga, llamar `/teams?league={id}&season={year}` (AF) + equipos de football-data
2. Cross-match por nombre normalizado (ya tenemos `normLiveName()`)
3. Persistir en `/cache/af-team-bridge/{leagueId}.json` (TTL 30 días)
4. Fallback: si no hay match → excluir el partido del V3MatchRecord

**Cobertura esperada:** 95%+ para PD/PL/BL1. Equipos con nombres muy distintos
(Leganés vs "CD Leganes") pueden necesitar entradas manuales en `TEAM_ALIASES`.

### B2: AF Historical Match Loader
**Archivo nuevo:** `server/prediction/af-historical-match-loader.ts`

Reemplaza / complementa `server/historical-match-loader.ts` para las ligas
que tienen cobertura en AF.

```typescript
// Endpoint: /fixtures?league={id}&season={year}&status=FT
// Mapea cada fixture → V3MatchRecord usando bridge de IDs
// Cache: /cache/historical/af/{leagueId}/{season}.json
//   TTL: 6h (current season), 1 año (past seasons)

async function loadAfHistoricalMatches(
  leagueId: number,
  season: number,
  bridge: AfTeamBridge[],
): Promise<V3MatchRecord[]>
```

**Campos a mapear:**
| Campo AF | Campo V3MatchRecord | Notas |
|----------|-------------------|-------|
| `fixture.date` | `utcDate` | ISO 8601 Z |
| `teams.home.id` | `homeTeamId` | vía bridge |
| `teams.away.id` | `awayTeamId` | vía bridge |
| `goals.home` | `homeGoals` | null → excluir |
| `goals.away` | `awayGoals` | null → excluir |

**xG augmentation:** Si AF devuelve xG en `/fixtures/statistics`,
incluirlo directamente en `XgRecord[]` sin llamada adicional.

### B3: Shadow validation (antes de activar)
**Duración:** 1 semana en paralelo

- Correr AF loader en shadow junto al football-data loader
- Comparar `V3MatchRecord[]` resultantes: mismos partidos, mismos goles
- Loguear discrepancias (partidos faltantes, goles distintos)
- Umbral de aceptación: ≥98% de matches con goals idénticos

### B4: Cutover del PE
- Una vez shadow validation ≥98%: switch `historical-match-loader.ts` → AF
- Flag de feature: `AF_HISTORICAL_ENABLED=true` en .env
- Rollback: `AF_HISTORICAL_ENABLED=false` revierte a football-data en 1 línea

---

## Track C — Migración canónica completa (largo plazo)

### Prerequisito
- Track A y B estables en producción ≥2 meses
- ≥1 temporada de datos AF acumulados y validados

### C1: Nuevo provider key estable
```
team:apifootball:886    (en lugar de team:football-data:340)
match:apifootball:1234  (en lugar de match:football-data:401245)
```

### C2: Script de migración de cache
- Recorrer todos los `/cache/` dirs
- Reescribir IDs en prediction snapshots, radar snapshots, incident cache
- Validar integridad antes y después

### C3: Nuevo AF canonical adapter
**Archivo:** `packages/canonical/src/ingest/api-football-adapter.ts`
Espejo de `football-data-adapter.ts` pero con AF response shape.

### C4: Cutover del routing
- Cambiar `routing-data-source.ts` para dirigir PD/PL/BL1 → `ApiFootballSource`
- Mantener TheSportsDB para URU (cobertura AF de la liga uruguaya es parcial)

### C5: Decommission football-data.org
- Remover `FOOTBALL_DATA_TOKEN` de `.env`
- Archivar `server/football-data-source.ts`
- Actualizar Dockerfile, CI

---

## Mapa de riesgos

| Riesgo | Track | Probabilidad | Impacto | Mitigación |
|--------|-------|-------------|---------|------------|
| Team name mismatch en bridge | B | Media | Datos faltantes en PE | TEAM_ALIASES + shadow validation |
| AF tiene datos históricos incompletos (temporadas viejas) | B | Baja | Prior quality degradada | Mantener FD como fallback para prev season |
| Quota excedida en nuevo plan | A | Muy baja | Throttling | Monitorear req/día en logs |
| Liga Uruguaya con cobertura AF incompleta | B/C | Media | URU sin predicciones | Mantener TheSportsDB para URU |
| Cache invalidation incompleta en Track C | C | Media | IDs mixtos en snapshots | Script de validación pre-cutover |

---

## Orden de ejecución recomendado

```
Semana 1:  Track A (desbloquear T3 — 1 día de trabajo)
Semanas 2-3: Track B1+B2 (bridge + loader)
Semana 4:  Track B3 (shadow validation)
Semana 5:  Track B4 (cutover PE)

Mes 3+:    Track C (cuando el usuario decida priorizar la migración canónica)
```

---

## Métricas de éxito

| Métrica | Target |
|---------|--------|
| T3 coverage: xG por partido | ≥80% de partidos en PD/PL |
| T3 coverage: injuries | ≥1 update/matchday |
| T3 coverage: lineups | disponibles 60min antes del kickoff |
| Bridge accuracy | ≥98% de equipos mapeados correctamente |
| PE eligibility rate post-migración | igual o mayor que pre-migración |
| Req/día con suscripción completa | <5% del límite contratado |

---

## Decisiones que requieren confirmación del usuario

1. **¿Cuál es el límite exacto de requests/día del plan contratado?**
   Determina si eliminamos el brake completamente o solo lo subimos.

2. **¿Migrar Liga Uruguaya también a AF, o mantener TheSportsDB?**
   AF tiene la liga (268) pero TheSportsDB puede tener más historial local.

3. **¿Track C es prioridad ahora o se difiere?**
   Recomendación: diferir. El valor de Tracks A+B es inmediato sin el riesgo de C.
