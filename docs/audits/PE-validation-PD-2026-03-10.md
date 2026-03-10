# PE — Sesión de Validación Controlada: LaLiga (PD)
**Fecha:** 2026-03-10
**Fase:** Phase 3 — Limited Validation (PE-77)
**Competición:** LaLiga — `comp:football-data:PD`
**Flags activos:**
```
PREDICTION_SHADOW_ENABLED=comp:football-data:PD
PREDICTION_INTERNAL_VIEW_ENABLED=comp:football-data:PD
```

---

## Procedimiento

1. Activar shadow mode para PD
2. Reiniciar servidor y esperar primer ciclo de refresh (scheduler: 2 min, live match activo)
3. Verificar endpoint `GET /api/internal/predictions?competitionId=comp:football-data:PD`
4. Verificar `/labs/predicciones` (página de inspección interna)

---

## Findings

### F001 — BLOCKER (RESUELTO antes del cierre)

**Descripción:** Todos los partidos retornaban `NOT_ELIGIBLE` con reason `INVALID_COMPETITION_PROFILE`.

**Causa raíz:** El adapter (`match-input-adapter.ts`) enviaba `stage_type: 'GROUP_STAGE'` + `format_type: 'ROUND_ROBIN'`. El validador §8.3 exige que `GROUP_STAGE` use `GROUP_CLASSIC` (no `ROUND_ROBIN`). Adicionalmente, `GROUP_CLASSIC` requiere `group_ranking_rules`, `qualification_rules` y `tie_break_rules`.

**Fix aplicado:** `KNOWN_PROFILES` actualizado a `GROUP_STAGE` + `GROUP_CLASSIC` con reglas estándar de liga doméstica (3-1-0, rank_by POINTS/GD/GF/H2H/DRAW_LOT).

**Estado:** ✅ RESUELTO

---

## Resultados post-fix

| Métrica | Valor |
|---------|-------|
| Predicciones generadas | 100 |
| `generation_status = 'ok'` | 100 (100%) |
| `generation_status = 'error'` | 0 |
| Modo dominante | `NOT_ELIGIBLE` |
| Reason code | `INSUFFICIENT_HISTORY_AND_NO_UTILIZABLE_PRIOR_RATING` |
| Errores silenciosos | Ninguno |

### Análisis del mode distribution

**`NOT_ELIGIBLE` (100%) — CORRECTO en modo bootstrapping.**

El adapter envía `historical_context` con todos los campos en cero (`home/away_completed_official_matches_last_365d = 0`, `home/away_prior_rating_available = false`). Esto es el comportamiento correcto hasta que el rating pool esté conectado:

- Con historial = 0 Y sin prior rating → `NOT_ELIGIBLE` (per §11.1)
- Con historial < umbral Y con prior rating → `LIMITED_MODE` (fase futura)
- Con historial ≥ umbral Y con prior rating → `FULL_MODE` (fase futura)

El reason code `INSUFFICIENT_HISTORY_AND_NO_UTILIZABLE_PRIOR_RATING` es preciso, comprensible y no engañoso.

### Verificación del request_payload

Muestra representativa:
```json
{
  "schemaVersion": 1,
  "match_id": "match:football-data:544570",
  "kickoff_utc": "2026-05-17T00:00:00Z",
  "competition_id": "comp:football-data:PD",
  "season_id": "season:football-data:2429",
  "home_team_id": "team:football-data:79",
  "away_team_id": "team:football-data:80",
  "competition_profile": {
    "stage_type": "GROUP_STAGE",
    "format_type": "GROUP_CLASSIC",
    "team_domain": "CLUB",
    "competition_family": "DOMESTIC_LEAGUE",
    "leg_type": "SINGLE",
    "neutral_venue": false
  },
  "historical_context": {
    "home_completed_official_matches_last_365d": 0,
    "away_completed_official_matches_last_365d": 0,
    "home_prior_rating_available": false,
    "away_prior_rating_available": false
  }
}
```

✅ Campos correctos · ✅ Perfiles bien formados · ✅ Determinísticos

### Verificación del response_payload

Coherente con NOT_ELIGIBLE per §21:
- `eligibility_status: 'NOT_ELIGIBLE'`
- `predictions: null`
- `internals: null`
- `reasons: ['INSUFFICIENT_HISTORY_AND_NO_UTILIZABLE_PRIOR_RATING']`

---

## Comportamiento del pipeline

- Shadow runner ejecuta out-of-band al final de cada `runRefresh()`
- Errores de predicción: capturados y logueados, no propagados al portal
- Persistencia: `cache/predictions/snapshots.json` escribe atómicamente (tmp → rename)
- Endpoint de inspección: `GET /api/internal/predictions` retorna items correctamente
- Página de inspección: `/labs/predicciones` disponible y funcional

---

## Exit Gate — Milestone C

| Criterio | Estado |
|----------|--------|
| Sesión completada y documentada | ✅ |
| Mode distribution coherente con datos disponibles | ✅ (NOT_ELIGIBLE en bootstrapping = esperado) |
| Degradation cases comprensibles | ✅ (reason code preciso) |
| Ningún blocker abierto en adapter o persistencia | ✅ (F001 resuelto) |

**Resultado: Milestone C — PASSED** ✅

---

## Notas para fases futuras

- **Rating pool**: cuando se conecte el pool de ratings históricos, los partidos calificarán para `LIMITED_MODE` o `FULL_MODE`. El `historical_context` deberá poblarse con datos reales de matches completados por equipo.
- **Modo bootstrapping declarado**: todos los outputs en bootstrapping llevan `calibration_mode: 'bootstrap'` — no hay riesgo de confusión con outputs calibrados.
- **Phase 4 (PE-78)** queda desbloqueada: Milestone C aprobado.
