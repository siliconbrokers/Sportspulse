---
artifact_id: SPEC-SPORTPULSE-PRODUCT-MVP-ONE-PAGER
title: "MVP One Pager"
artifact_class: spec
status: superseded
version: 1.0.0
project: sportpulse
domain: product
slug: mvp-one-pager
owner: team
created_at: 2026-03-15
updated_at: 2026-03-16
supersedes: []
superseded_by: ["REPORT-SPORTPULSE-PRODUCT-BUSINESS-PLAN-2026-03"]
related_artifacts: []
canonical_path: docs/product/spec.sportpulse.product.mvp-one-pager.md
---
# SportPulse — MVP One‑Pager

Version: 1.0  
Status: Draft (stakeholder‑ready)  
Owner: SportPulse team  
Date: 2026‑03‑05

---

## 1) Qué es SportPulse (en 1 frase)

**SportPulse es un “mapa de atención” de una competencia de fútbol**: te muestra **qué equipos importan más ahora** y **por qué**, en una vista única y explicable.

---

## 2) El problema que atacamos

En una liga hay demasiadas cosas pasando a la vez:

- resultados recientes dispersos
- calendario y próximos partidos
- “relevancia” que el usuario termina armando a mano

La mayoría de apps responde “qué pasó / quién va ganando”.  
**Pocas responden “a qué le presto atención ahora, en toda la competencia, y por qué”.**

---

## 3) La propuesta de valor

SportPulse reduce el costo mental de escanear una competencia:

- **prioriza** (no solo lista)
- **explica** (no es una caja negra)
- **mantiene coherencia** (snapshot‑first: todo lo que ves pertenece a la misma “foto” del estado)

---

## 4) Para quién es (MVP)

Usuario probable:

- sigue una liga
- quiere orientarse rápido (“qué está caliente hoy”)
- no quiere abrir mil pantallas para combinar forma + agenda

No es (por ahora):

- analista profesional
- apostador que espera odds/predicciones
- usuario ultra casual que solo mira el resultado del partido de su equipo

---

## 5) Qué incluye el MVP (scope real)

**MVP = fútbol, una competencia a la vez, modo “Forma + agenda”.**

La UI principal es un **treemap de equipos** (mapa por tamaño), donde:

- el tamaño refleja la **atención** (calculada por backend)
- el usuario puede abrir detalle para ver **por qué** un equipo está grande

**Inputs del modelo (v1):**
- **Forma reciente** (últimos 5 partidos)
- **Proximidad del próximo partido** (cuánto falta)

**Características MVP:**
- vista principal “mapa de atención” (treemap)
- panel de detalle por equipo con explicación (top contributions)
- contexto de próximo partido (agenda)

---

## 6) Qué NO incluye el MVP (para proteger la validación)

Fuera de scope:

- odds / predicción
- xG, lesiones, transferencias, sentimiento
- multi‑competencia / multi‑deporte
- personalización avanzada
- cálculo de scoring o layout en frontend
- “bonos” por favoritos que alteren la verdad del mapa

---

## 7) Diferenciación (por qué no es “otra app de fútbol”)

- **attention‑first**: prioriza el “ahora” en toda la competencia
- **explicable**: el usuario entiende “por qué”
- **coherente**: snapshot‑first; no hay widgets que se contradigan
- **determinista y versionado**: evita arbitrariedad, habilita QA y confianza
- **agnóstico del proveedor**: normalización canónica evita lock‑in

---

## 8) Por qué la arquitectura importa (resumen no técnico)

El MVP promete confianza y coherencia. Por eso:

- el backend produce una “foto” consistente del estado (snapshot)
- el backend calcula el score y el layout (no hay trampas en UI)
- todo está versionado (policy y layout) para no romper historia ni pruebas

---

## 9) Hipótesis a validar (lo que importa)

**H1 — Utilidad:** el usuario entiende el mapa en segundos.  
**H2 — Relevancia:** los equipos destacados “tienen sentido” la mayoría del tiempo.  
**H3 — Confianza:** la explicación reduce el “¿por qué está grande esto?”.  
**H4 — Comportamiento:** la vista ayuda a decidir qué mirar después (del overview al detalle).  
**H5 — Ritual:** la gente vuelve a “chequear” el estado de la competencia.

---

## 10) Métricas MVP (pocas, estratégicas)

- **Time‑to‑understand** (cuánto tarda en entender la propuesta)
- **Trust rate** (qué tan seguido “esto tiene sentido”)
- **Overview→Detail conversion** (treemap a detalle/agenda)
- **Explanation usage** (uso real de “por qué”)
- **Return behavior** (vuelve a usarlo)

---

## 11) Riesgos principales (los de verdad)

- el treemap es “lindo” pero no útil → producto gimmicky
- forma + agenda es demasiado simple → ranking percibido como arbitrario
- el usuario no adopta un ritual → no hay valor recurrente
- falta de claridad narrativa → lo confunden con standings/fixtures

---

## 12) Criterio de decisión (go / rediseñar / matar)

**Go** si:
- se entiende rápido, se usa para orientar, y la explicación aumenta confianza.

**Rediseñar** si:
- el problema es real pero la visual (treemap) o la explicación no funcionan.

**Matar / re‑encuadrar** si:
- a la gente no le importa la priorización de atención como problema.

---

## 13) Próximos pasos recomendados (sin inflar scope)

1) Validar comprehension + trust con tests rápidos (usuarios reales).  
2) Ajustar narrativa y UX antes de agregar señales nuevas.  
3) Solo después: explorar expansión (más competencias, match‑level, personalización).

---

## 14) Pitch listo para usar

> “SportPulse te da un mapa de atención de una liga: en una mirada te muestra qué equipos importan más ahora y te explica por qué, combinando forma reciente y proximidad del próximo partido en una foto coherente del estado de la competencia.”

