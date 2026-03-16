---
artifact_id: RADAR-07-PREDICTION-INTEGRATION
title: "Radar SportPulse — Integración con Motor Predictivo"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: prediction/radar
slug: prediction-integration
owner: team
created_at: 2026-03-16
updated_at: 2026-03-16
---

# Radar SportPulse — Integración con Motor Predictivo

## 1. Propósito

Este documento especifica cómo el sistema Radar obtiene y presenta probabilidades de resultado para cada partido candidato. Cubre el modelo de fallback Poisson+Dixon-Coles y la integración con el PredictionStore del motor v3.

## 2. Fuente de probabilidades

El sistema Radar expone probabilidades 1X2 para cada partido de la jornada (no solo los 3 cards editoriales). La fuente se resuelve con este orden de prioridad:

1. **PredictionStore v3** — si existe un snapshot con `engine_id = 'v3_unified'` y `generation_status = 'ok'` para el partido, se usan sus probabilidades directamente (`prob_home_win`, `prob_draw`, `prob_away_win`) y su `pre_match_text`.
2. **Fallback Poisson+DC** — si no hay snapshot v3, se calcula en tiempo real usando el modelo descrito en §3.

## 3. Modelo Poisson + Dixon-Coles (fallback)

Parámetros fijos:

| Parámetro | Valor | Descripción |
|-----------|-------|-------------|
| `DECAY_XI` | 0.006 | Factor de decay temporal (λ = e^{-ξ·días}) |
| `SHRINKAGE_K` | 5 | Partidos de prior para shrinkage Bayesiano |
| `HOME_ADVANTAGE` | 1.15 | Multiplicador de lambda local |
| `DC_RHO` | -0.13 | Corrección Dixon-Coles para scorelines 0-0, 1-0, 0-1, 1-1 |
| `MAX_GOALS` | 7 | Límite de la matriz de scorelines |
| `MIN_MATCHES` | 3 | Mínimo de partidos para calcular probabilidad |
| `LEAGUE_AVG_GOALS` | 2.6 | Prior de goles por partido (fallback si liga tiene pocos datos) |

### 3.1 Pipeline de cálculo

1. Filtrar partidos del equipo en la temporada, excluyendo partidos con status terminal incompleto.
2. Aplicar decay temporal a cada partido: `w = e^{-DECAY_XI · días_desde_partido}`.
3. Calcular lambdas de ataque y defensa con shrinkage Bayesiano hacia la media de liga.
4. Aplicar `HOME_ADVANTAGE` al lambda de ataque local.
5. Construir matriz de Poisson 8×8 (0..MAX_GOALS para cada equipo).
6. Aplicar corrección Dixon-Coles a scorelines bajos.
7. Sumar probabilidades para obtener P(home_win), P(draw), P(away_win).
8. Normalizar para que sumen exactamente 1.0.

### 3.2 Requisito mínimo de datos

Si alguno de los dos equipos tiene menos de `MIN_MATCHES` partidos con peso suficiente, el modelo retorna `null` y no se muestran probabilidades en la UI.

## 4. Contrato de salida — RadarLiveMatchData

Campos de probabilidad en `RadarLiveMatchData`:

| Campo | Tipo | Fuente | Descripción |
|-------|------|--------|-------------|
| `probHomeWin` | `number \| undefined` | v3 o Poisson+DC | Probabilidad de victoria local [0..1] |
| `probDraw` | `number \| undefined` | v3 o Poisson+DC | Probabilidad de empate [0..1] |
| `probAwayWin` | `number \| undefined` | v3 o Poisson+DC | Probabilidad de victoria visitante [0..1] |
| `preMatchText` | `string \| undefined` | v3 o renderProbText() | Comentario analítico generado |

Cuando la fuente es v3, `preMatchText` proviene del output del motor. Cuando la fuente es Poisson+DC fallback, `preMatchText` se genera con `renderProbText()` (ver §5).

## 5. renderProbText() — Comentario analítico de probabilidades

Función pura que genera un comentario analítico en voz rioplatense a partir de las probabilidades 1X2. Usa el `matchId` como seed para determinismo (mismo partido → mismo texto, sin random).

### Reglas de asignación de template:

| Condición | Tono |
|-----------|------|
| `probHome ≥ 0.60` | Dominancia local clara |
| `probAway ≥ 0.60` | Dominancia visitante clara |
| `probDraw ≥ 0.35` | Empate como opción fuerte |
| `probHome ∈ [0.45, 0.60)` | Leve ventaja local |
| `probAway ∈ [0.45, 0.60)` | Leve ventaja visitante |
| resto | Máxima paridad |

Este comentario es distinto del `preMatchText` editorial generado por la biblioteca de copy del Radar (radar-02). Son dos capas separadas:
- El **comentario de probabilidades** (`renderProbText`) describe la distribución numérica.
- El **texto editorial del Radar** (`renderPreMatchText`) describe la narrativa analítica de la señal.

## 6. Interacción entre Radar editorial y probabilidades

El sistema de etiquetas del Radar (PARTIDO_ENGANOSO, SENAL_DE_ALERTA, etc.) se asigna **independientemente** de las probabilidades del motor predictivo. Los scores de señal se calculan desde datos crudos de la tabla y forma reciente, no desde probabilidades.

Esta separación es una deuda arquitectural conocida. Una futura integración debería alimentar los scores de señal con outputs del motor v3:
- `PARTIDO_ABIERTO` ← `btts_prob` del v3
- `DUELO_CERRADO` ← inverso de `over_2_5_prob` del v3
- `SENAL_DE_ALERTA` ← gap entre prob del modelo y favorito de tabla

Ver plan de implementación Radar para el roadmap de esta integración.
