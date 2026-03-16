# Radar SportPulse — Implementation Plan

Status: APPROVED — implementing

## Data layer confirmed
- `Match[]` (toda temporada) + `StandingEntry[]` son suficientes
- No se necesita provider nuevo
- Funciones reutilizables: `extractRecentForm`, `extractGoalStats`, `computeFormPointsLast5`

## Signal algorithms (approved)

### ATTENTION_CONTEXT (threshold >= 58)
- +30 si home o away en top-4
- +20 si ambos en top-8
- +20 si diff puntos entre equipos <= 3
- +15 si jornada avanzada (> 60% season)
- +15 si algún equipo en zona descenso (bottom-3)

### HIDDEN_VALUE (threshold >= 60)
- Señal base: partido NO está en top-3 por attentionScore
- +35 si formaScore underdog > 0.60
- +25 si GF/partido visitante fuera > media liga
- +20 si favorito tiene cleanSheets bajos en últimas 5
- +20 si head-to-head en temporada mostró sorpresa

### FAVORITE_VULNERABILITY (threshold >= 64)
- Prereq: diff posición >= 5 O diff puntos >= 8
- +40 si favorito concedió en 4 de últimas 5
- +30 si underdog sumó puntos en 3 de últimas 5
- +20 si favorito como local: GF/partido < media liga
- +10 si forma favorito < 0.40

### SURFACE_CONTRADICTION (threshold >= 68)
- Prereq: diff puntos >= 6 (favorito claro)
- +40 si forma reciente underdog >= favorito
- +30 si away-form underdog > home-form favorito
- +20 si favorito no ganó últimas 2-3
- +10 si H2H reciente favorece underdog

### OPEN_GAME (threshold >= 63)
- +30 si avg goles/partido de ambos > 2.8
- +25 si ambos marcaron en >= 4 de últimas 5
- +25 si ambos concedieron en >= 3 de últimas 5
- +20 si ninguno tiene clean sheet en últimas 3
- Restricción: ambos lados deben contribuir

### TIGHT_GAME (threshold >= 63)
- +35 si avg goles/partido de ambos < 2.0
- +25 si ambos tienen >= 2 clean sheets en últimas 5
- +25 si ambos marcaron <= 1 gol en >= 3 de últimas 5
- +15 si diff puntos <= 4
- Restricción: no usar si openGame también es alto

## Phases

### RADAR-1: Types + Candidate Builder [DONE]
- server/radar/radar-types.ts
- server/radar/radar-candidate-builder.ts
- server/radar/radar-evidence-tier.ts

### RADAR-2: Signal Evaluator [DONE]
- server/radar/radar-signal-evaluator.ts

### RADAR-3: Editorial Engine [DONE]
- server/radar/radar-label-resolver.ts
- server/radar/radar-subtype-resolver.ts
- server/radar/radar-text-renderer.ts
- server/radar/radar-reason-selector.ts
- server/radar/radar-diversity-filter.ts

### RADAR-4: Snapshot Persistence [DONE]
- server/radar/radar-snapshot-writer.ts
- server/radar/radar-snapshot-reader.ts
- server/radar/radar-verdict-resolver.ts
- server/radar/radar-service.ts

### RADAR-5: API Endpoint [DONE]
- GET /api/ui/radar

### RADAR-6: Frontend [DONE]
- packages/web/src/hooks/use-radar.ts
- packages/web/src/components/radar/radar-section.tsx
- packages/web/src/components/radar/radar-card.tsx
- packages/web/src/components/radar/radar-empty-state.tsx
- packages/web/src/components/radar/radar-unavailable-state.tsx

### RADAR-7: Tests [DONE]
- Unit + contract + UI tests

---

## Backlog pendiente (post-audit 2026-03-16)

### RADAR-BOOTSTRAP-EVIDENCE
**Qué:** Implementar carga de temporada anterior como supporting evidence en BOOTSTRAP (matchdays 1-3).

**Por qué:** La spec (radar-01 §10) lo permite. Mejoraría la calidad de señales en las primeras jornadas.

**Scope:** `radar-candidate-builder.ts` — aceptar `prevSeasonMatches` opcional; `radar-service.ts` — pasarlo desde DataSource.

**Bloqueante:** Requiere que DataSource exponga partidos de temporada anterior.

**Prioridad:** Media

---

### RADAR-FEATURE-FLAGS
**Qué:** Integrar `enableRadarSection`, `enableRadarPostMatchVerdict` con el back office (portal-config-store).

**Por qué:** La spec (radar-01 §23) los define. Permite desactivar el Radar por liga desde el admin.

**Scope:** `radar-route.ts`, `RadarSection.tsx`, `portal-config-store.ts`.

**Prioridad:** Baja

---

### RADAR-TONE-DEDUP
**Qué:** Aplicar restricciones de tone editorial: máx 1 `venenoso` por label por snapshot; no repetir opening pattern de 4+ palabras.

**Por qué:** La spec (radar-02 §14) lo exige. Sin esto pueden colarse frases de tono inconsistente.

**Scope:** `radar-text-renderer.ts` — `selectTemplate()`.

**Prioridad:** Baja

---

### RADAR-REBUILD-MECHANISM
**Qué:** Implementar rebuild explícito de snapshot histórico con `isHistoricalRebuild = true`.

**Por qué:** La spec (radar-03 §16) lo define. Necesario para integridad auditora.

**Scope:** `radar-service.ts`, `radar-snapshot-writer.ts`.

**Prioridad:** Baja

---

### RADAR-BOOTSTRAP-GUARD
**Qué:** Agregar guard en signal evaluator para restringir etiquetas analíticas fuertes en BOOTSTRAP.

**Por qué:** La spec (radar-02 §21) establece restricciones en jornadas 1-3. Sin guard pueden aparecer con evidencia insuficiente.

**Scope:** `radar-signal-evaluator.ts` — verificar `evidenceTier` antes de permitir SENAL_DE_ALERTA y PARTIDO_ENGANOSO.

**Prioridad:** Media

---

### RADAR-DATA-QUALITY
**Qué:** Implementar detección de `dataQuality: 'INCONSISTENT_SOURCE'`.

**Por qué:** La spec (radar-03 §9) lo define. Sin esto el campo no tiene utilidad.

**Scope:** `radar-service.ts` — definir criterio (ej: match con múltiples fuentes inconsistentes) y escribirlo al snapshot.

**Prioridad:** Baja

---

### RADAR-SIGNAL-V3-INTEGRATION
**Qué:** Alimentar los signal scores del evaluador con outputs del motor predictivo v3.

**Por qué:** Actualmente las etiquetas (PARTIDO_ABIERTO, DUELO_CERRADO, SENAL_DE_ALERTA) se calculan con heurísticas independientes del motor predictivo. Usar `btts_prob`, `over_2_5_prob`, y el gap modelo/tabla mejoraría la coherencia y precisión.

**Scope:** `radar-signal-evaluator.ts`, `radar-service.ts` — integrar PredictionStore como input opcional.

**Bloqueante:** Requiere que PredictionStore esté disponible en el contexto del RadarService.

**Impacto:** Alto — cambiaría qué partidos reciben qué etiqueta.

**Prioridad:** Alta (deuda arquitectural principal)
