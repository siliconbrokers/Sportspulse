---
artifact_id: RADAR-08-IMPLEMENTATION-DECISIONS
title: "Radar SportPulse — Decisiones de Implementación"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: prediction/radar
slug: implementation-decisions
owner: team
created_at: 2026-03-16
updated_at: 2026-03-16
---

# Radar SportPulse — Decisiones de Implementación

Este documento registra las decisiones técnicas y de producto tomadas durante la implementación que se desvían de la spec original o que la spec no cubría explícitamente. Sirve como fuente de verdad para auditorías futuras.

---

## D-01 — Prior-season evidence en BOOTSTRAP no implementada

**Spec dice:** En matchdays 1-3 (BOOTSTRAP), el sistema puede usar el tramo final de la temporada anterior como "supporting evidence" cuando el equipo tiene historial comparable.

**Decisión:** No implementado. `buildCandidatePool()` y `radar-signal-evaluator.ts` solo consumen partidos de la temporada actual.

**Razón:** Complejidad de integración cross-season sin beneficio claro en jornadas tempranas donde el Radar ya tiene evidenceTier=BOOTSTRAP con expectativas reducidas del usuario. Decisión de scope.

**Estado:** Pendiente — ver plan de implementación Radar, item RADAR-BOOTSTRAP-EVIDENCE.

---

## D-02 — Feature flags de Radar no implementados

**Spec dice (radar-01 §23):** `enableRadarSection`, `hideMapSection`, `enableRadarPostMatchVerdict` deben ser feature flags controlables.

**Decisión:** No implementado. El Radar siempre renderiza si hay snapshot disponible. No hay checks en `radar-route.ts` ni en `RadarSection.tsx`.

**Razón:** El back office (portal-config) existe pero los flags específicos del Radar no fueron integrados. Decisión de scope en Phase 1.

**Estado:** Pendiente — ver plan de implementación Radar, item RADAR-FEATURE-FLAGS.

---

## D-03 — Restricciones de tone editorial no aplicadas

**Spec dice (radar-02 §14):**
- Máximo 1 frase con tone `venenoso` por label por snapshot cuando haya alternativas.
- No repetir opening pattern de 4+ palabras dentro del mismo label en el mismo snapshot.

**Decisión:** Implementada solo deduplicación por texto exacto. Las restricciones de tone y opening pattern no se aplican.

**Razón:** La biblioteca de copy v3 fue diseñada para minimizar estos conflictos a nivel de templates, pero el selector no los valida en runtime.

**Estado:** Pendiente — ver plan de implementación Radar, item RADAR-TONE-DEDUP.

---

## D-04 — dataQuality siempre 'OK'

**Spec dice (radar-03 §9):** `dataQuality` puede ser `'OK'` o `'INCONSISTENT_SOURCE'`.

**Decisión:** Siempre se escribe `'OK'`. No hay lógica para detectar inconsistencia de fuente de datos.

**Razón:** No se definió qué condición concreta dispara `'INCONSISTENT_SOURCE'` durante la implementación.

**Estado:** Pendiente — definir criterio y agregar guard en `radar-service.ts`.

---

## D-05 — isHistoricalRebuild siempre false

**Spec dice (radar-03 §16):** El campo `isHistoricalRebuild` debe marcarse `true` cuando un snapshot se reconstruye históricamente.

**Decisión:** Siempre `false`. No hay mecanismo para triggear un rebuild explícito que lo marque.

**Razón:** El flujo de build actual no distingue entre primera generación y reconstrucción.

**Estado:** Pendiente — ver plan de implementación Radar, item RADAR-REBUILD-MECHANISM.

---

## D-06 — Animaciones de cards implementadas (spec decía "no required")

**Spec dice (radar-04 §4):** "No animation required in MVP."

**Decisión:** Se implementó `animationDelay` escalonado (60ms por card) en `RadarSection.tsx`.

**Razón:** Mejora perceptible de UX, decisión del equipo de frontend. No viola la spec (la spec dice "no requeridas", no "prohibidas").

**Estado:** Implementado y aceptado. Spec actualizada en radar-04.

---

## D-07 — Sorting de cards en UI: LIVE primero

**Spec dice:** No especifica orden de rendering de cards en la UI.

**Decisión:** `RadarSection.tsx` ordena cards: LIVE matches primero, luego por `startTimeUtc` ascendente.

**Razón:** Priorizar el contenido más relevante para el usuario en tiempo real.

**Estado:** Implementado y aceptado. Spec actualizada en radar-04.

---

## D-08 — Guard de etiquetas analíticas en BOOTSTRAP ausente

**Spec dice (radar-02 §21):** En BOOTSTRAP, las etiquetas analíticas fuertes (SENAL_DE_ALERTA, PARTIDO_ENGANOSO) deberían aplicarse con restricciones adicionales.

**Decisión:** No hay guard. En matchday 1-3 pueden aparecer estas etiquetas con evidencia mínima.

**Razón:** La spec es ambigua sobre qué constituye "restricción adicional". El evidenceTier=BOOTSTRAP ya señala al usuario que hay datos limitados.

**Estado:** Pendiente — definir criterio exacto y agregar guard en signal evaluator.
