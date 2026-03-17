---
artifact_id: SPEC-SPORTPULSE-PREDICTION-ENGINE
title: "Predictive Engine Specification v1.3"
artifact_class: spec
status: active
version: 1.3.0
project: sportpulse
domain: prediction
slug: engine
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: ['SPEC-SPORTPULSE-PREDICTION-ENGINE-V2']
superseded_by: []
related_artifacts: []
canonical_path: docs/specs/prediction/spec.sportpulse.prediction.engine.md
---
# SportPulse — Especificación técnica v1.3 del motor predictivo de partidos y competiciones

**Versión del documento:** 1.3  
**Estado:** Final / Frozen for implementation  
**Ámbito:** Predicción pre-partido de fútbol y resolución estructural de competiciones  
**Audiencia:** Backend, Data/ML, QA, Producto, Agentes de implementación

---

# 1. Propósito

Este documento define la arquitectura, alcance, contrato de entrada, salidas, reglas, invariantes, modos operativos, política de fallo, calibración y criterios de aceptación del sistema predictivo v1 de SportPulse para fútbol.

El sistema v1 debe:

- predecir partidos oficiales senior de fútbol 11v11 en **tiempo reglamentario**;
- producir probabilidades y derivados coherentes desde una arquitectura explícitamente separada en:
  - distribución base raw del partido;
  - vector visible calibrado 1X2;
- soportar distintas familias competitivas mediante un **Competition Engine** configurable;
- separar estrictamente:
  - predicción de partido,
  - resolución de competición,
  - validación de entrada,
  - exposición de outputs,
  - validación técnica.

---

# 2. Alcance exacto

## 2.1 Lo que sí cubre

El sistema v1 cubre:

- partidos oficiales senior 11v11;
- predicción **pre-partido**;
- resultado del partido en **90 minutos + descuento**;
- ligas domésticas;
- copas domésticas;
- torneos internacionales de clubes;
- torneos de selecciones;
- formatos:
  - round robin / liga,
  - fase de grupos clásica,
  - league phase,
  - knockout a partido único,
  - knockout ida y vuelta,
  - clasificación de mejores terceros,
  - fases previas / qualifying rounds.

## 2.2 Lo que no cubre dentro del predictor base

El Match Prediction Engine **no** modela como parte del 1X2 base:

- prórroga;
- penales;
- mercados de primer tiempo;
- corners;
- tarjetas;
- primer goleador;
- minuto del gol;
- props exóticos.

Si una competición requiere resolución de clasificación o avance más allá de 90’, eso lo resuelve el **Competition Engine**, no el predictor base del partido.

---

# 3. Principios de diseño obligatorios

## 3.1 Fuente única de verdad del partido

Debe existir una única **distribución base raw del partido** derivada de `lambda_home` y `lambda_away`.

Queda prohibido:

- entrenar un modelo para 1X2 y otro distinto para doble oportunidad;
- entrenar un modelo separado para over/under;
- entrenar un modelo separado para BTTS;
- combinar outputs de modelos incompatibles.

Regla obligatoria v1:

- los mercados de goles y scoreline deben derivarse de `raw_match_distribution`;
- el vector visible `1X2` debe exponerse como `calibrated_1x2_probs`;
- los mercados algebraicamente consistentes con `1X2` visible deben derivarse de `calibrated_1x2_probs`.

## 3.2 Separación de motores

El sistema debe separar obligatoriamente:

- **Match Prediction Engine**
- **Competition Engine**

## 3.3 Dependencia explícita de datos externos

El sistema depende de datos externos para:

- estructura del partido;
- historial;
- contexto competitivo;
- formato de torneo;
- reglas de clasificación;
- reglas de desempate;
- reglas de resolución knockout;
- contexto de ida/vuelta;
- dominio competitivo.

Sin datos externos válidos, el sistema no es elegible para operar en modo completo.

## 3.4 Consistencia matemática obligatoria

No se permite exponer ningún output visible si viola invariantes probabilísticos o estructurales.

## 3.5 Validación temporal obligatoria

La evaluación del sistema debe ser **walk-forward temporal**.  
Queda prohibido usar random split como validación principal de rendimiento predictivo.

## 3.6 Política anti-leakage obligatoria

Para cualquier predicción de un partido con `kickoff_utc = T`:

- solo pueden usarse partidos **completados** con timestamp estrictamente anterior a `T`;
- no pueden usarse partidos posteriores a `T`, aunque sean del mismo día;
- si hay simultaneidad o baja granularidad temporal, se excluyen partidos del mismo bloque temporal ambiguo definido por la granularidad máxima confiable disponible para esa fuente;
- no se permite reconstruir ratings, standings o calibraciones usando información posterior al corte de predicción.

---

# 4. Constantes globales

## 4.1 Tolerancias numéricas

```ts
epsilon_probability = 1e-9
epsilon_dnb_denominator = 1e-9
```

## 4.2 Convenciones de escala

- Internamente todas las probabilidades se almacenan como `float` en rango `[0,1]`.
- Visualmente pueden mostrarse como porcentaje `0–100`.
- Todos los cálculos se realizan sobre valores no redondeados.

## 4.3 Umbrales operativos obligatorios

```ts
min_recent_matches_club = 5
min_recent_matches_national_team = 5

strong_recent_matches_club = 12
strong_recent_matches_national_team = 8

max_tail_mass_raw = 0.01

prior_rating_max_age_days = 400
prior_rating_min_updates_last_730d = 3
prior_rating_cross_season_carry_allowed = true

too_close_margin_threshold = 0.02

strong_bridging_confidence_levels = ["HIGH", "MEDIUM"]
min_bucket_sample_for_calibration_eval = 100
```

---

# 5. Arquitectura general

## 5.1 Match Prediction Engine

Responsable de:

- rating base del equipo;
- ajustes contextuales del partido;
- `lambda_home`;
- `lambda_away`;
- `raw_match_distribution`;
- `raw_1x2_probs`;
- `calibrated_1x2_probs`;
- mercados derivados;
- outputs explicativos;
- persistencia de probabilidades raw y calibradas.

Predice exclusivamente el partido actual en reglamentario.

## 5.2 Competition Engine

Responsable de:

- tablas;
- standings;
- ranking de grupos;
- ranking cruzado de mejores terceros;
- clasificación de fase;
- brackets;
- agregados ida/vuelta;
- seeding;
- transición entre fases;
- aplicación de reglas de desempate;
- aplicación de reglas de resolución knockout.

No predice el partido; consume predicciones o resultados y resuelve estructura competitiva.

## 5.3 Validation Layer

Responsable de:

- validar integridad del input;
- determinar elegibilidad;
- asignar `operating_mode`;
- asignar razones de degradación o fallo;
- calcular `applicability_level`;
- verificar invariantes;
- verificar consistencia entre fuentes raw y calibradas.

---

# 6. Baseline obligatorio v1

## 6.1 Modelo base v1

El baseline obligatorio del v1 es:

- rating base: **Elo extendido**
- ajustes mínimos:
  - localía,
  - recencia,
  - peso por competición para actualización de rating,
  - forma ofensiva reciente,
  - forma defensiva reciente
- score engine:
  - **Poisson independiente**
- derivados:
  - todos salen de `raw_match_distribution` o de `calibrated_1x2_probs` según reglas explícitas de esta especificación
- calibración:
  - posterior a la salida raw del modelo
- persistencia:
  - raw y calibrated por separado

## 6.2 Fuera de alcance v1

Quedan fuera de v1 como baseline obligatorio:

- Dixon-Coles
- bivariado Poisson
- modelos separados por mercado
- modelos deep learning como baseline principal
- tracking-based modeling
- xG shot-level premium como requisito estructural

Pueden existir como mejoras futuras, no como parte obligatoria del v1.

---

# 7. Contrato de entrada — `MatchInput v1`

## 7.1 Objeto de entrada obligatorio

```ts
MatchInput {
  match_id: string;
  kickoff_utc: string; // ISO-8601 UTC

  competition_id: string;
  season_id: string;
  stage_id?: string | null;
  group_id?: string | null;

  home_team_id: string;
  away_team_id: string;

  competition_profile: CompetitionProfile;

  home_team_domain_id: string;
  away_team_domain_id: string;

  historical_context: {
    home_completed_official_matches_last_365d?: number;
    away_completed_official_matches_last_365d?: number;

    home_completed_official_matches_last_730d?: number;
    away_completed_official_matches_last_730d?: number;

    home_prior_rating_available: boolean;
    away_prior_rating_available: boolean;
  };
}
```

## 7.2 Campos críticos

Si falta cualquiera de estos, el partido es `NOT_ELIGIBLE`:

- `match_id`
- `kickoff_utc`
- `competition_id`
- `season_id`
- `home_team_id`
- `away_team_id`
- `competition_profile.team_domain`
- `competition_profile.competition_family`
- `competition_profile.stage_type`
- `competition_profile.format_type`
- `competition_profile.leg_type`
- `competition_profile.neutral_venue`

## 7.3 Campos condicionalmente obligatorios

### Si `leg_type = SECOND_LEG`
Debe existir:

- `aggregate_state_before_match`

Si falta, el partido es `NOT_ELIGIBLE`.

### Si `format_type = GROUP_CLASSIC`
Deben existir:

- `group_ranking_rules`
- `qualification_rules`
- `tie_break_rules`

### Si `format_type = LEAGUE_PHASE_SWISS_STYLE`
Deben existir:

- `league_phase_rules`
- `qualification_rules`
- `tie_break_rules`

### Si `format_type in {KNOCKOUT_SINGLE_LEG, KNOCKOUT_TWO_LEG}`
Debe existir:

- `knockout_resolution_rules`

salvo que el catálogo formal de la competición documente que el empate tras 90 minutos no puede ocurrir o no requiere resolución adicional.

## 7.4 Historia mínima requerida

### Para `team_domain = CLUB`

Cada equipo debe cumplir al menos una:

- tener **5 o más partidos oficiales completados** en los últimos 365 días, o
- tener **rating previo utilizable** según la sección 20.2.

### Para `team_domain = NATIONAL_TEAM`

Cada equipo debe cumplir al menos una:

- tener **5 o más partidos oficiales completados** en los últimos 730 días, o
- tener **rating previo utilizable** según la sección 20.2.

Si un equipo no cumple ninguna:

- el partido es `NOT_ELIGIBLE`.

Si ambos equipos tienen rating previo utilizable pero uno o ambos tienen historia reciente débil:

- el partido puede operar en `LIMITED_MODE` o en `FULL_MODE` con `applicability_level != STRONG`, según el resto del contexto.

## 7.5 Alcance de entrada permitido

Solo se aceptan partidos:

- oficiales,
- senior,
- 11v11,
- con contexto competitivo formalizable.

Fuera de alcance fuerte v1:

- amistosos como objetivo principal,
- juveniles,
- reservas,
- partidos sin estructura competitiva suficiente.

## 7.6 Validación de clasificación del partido

El v1 asume que la clasificación de partido como:

- oficial,
- senior,
- 11v11

no viene resuelta por flags ad hoc del `MatchInput`, sino por un **catálogo confiable de competición** asociado a `competition_id` y `season_id`.

Regla obligatoria:

- si el catálogo no permite determinar que el partido pertenece a una competición oficial senior 11v11, el partido debe pasar a `NOT_ELIGIBLE`.

Queda prohibido inferir esta clasificación por heurística blanda o por nombre libre del torneo.

## 7.7 Nota sobre `stage_id` y `group_id`

`stage_id` y `group_id` no son obligatorios para todos los partidos, pero sí son obligatorios cuando el `CompetitionEngine` los necesita para:

- construir standings,
- aplicar reglas de grupo,
- resolver clasificación,
- o mapear bracket.

---

# 8. Perfil de competición — `CompetitionProfile`

## 8.1 Objeto formal

```ts
CompetitionProfile {
  competition_profile_version: string;

  team_domain: "CLUB" | "NATIONAL_TEAM";

  competition_family:
    | "DOMESTIC_LEAGUE"
    | "DOMESTIC_CUP"
    | "INTERNATIONAL_CLUB"
    | "NATIONAL_TEAM_TOURNAMENT";

  stage_type:
    | "QUALIFYING"
    | "GROUP_STAGE"
    | "LEAGUE_PHASE"
    | "PLAYOFF"
    | "ROUND_OF_32"
    | "ROUND_OF_16"
    | "QUARTER_FINAL"
    | "SEMI_FINAL"
    | "THIRD_PLACE"
    | "FINAL";

  format_type:
    | "ROUND_ROBIN"
    | "GROUP_CLASSIC"
    | "LEAGUE_PHASE_SWISS_STYLE"
    | "KNOCKOUT_SINGLE_LEG"
    | "KNOCKOUT_TWO_LEG";

  leg_type: "SINGLE" | "FIRST_LEG" | "SECOND_LEG";

  neutral_venue: boolean;

  aggregate_state_before_match?: {
    home_aggregate_goals: number;
    away_aggregate_goals: number;
  } | null;

  knockout_resolution_rules?: KnockoutResolutionRules | null;

  group_ranking_rules?: GroupRankingRules | null;
  league_phase_rules?: LeaguePhaseRules | null;
  qualification_rules?: QualificationRules | null;
  tie_break_rules?: TieBreakRules | null;
}
```

## 8.2 Reglas mínimas configurables

### `GroupRankingRules`

```ts
GroupRankingRules {
  points_win: number;
  points_draw: number;
  points_loss: number;
  rank_by: (
    | "POINTS"
    | "GOAL_DIFFERENCE"
    | "GOALS_FOR"
    | "HEAD_TO_HEAD_POINTS"
    | "HEAD_TO_HEAD_GOAL_DIFFERENCE"
    | "HEAD_TO_HEAD_GOALS_FOR"
    | "FAIR_PLAY"
    | "DRAW_LOT"
  )[];
}
```

### `QualificationRules`

```ts
QualificationRules {
  qualified_count_per_group?: number;
  best_thirds_count?: number;
  allow_cross_group_third_ranking: boolean;

  bracket_mapping_definition?: {
    strategy: "FIXED" | "THIRD_PLACE_DEPENDENT" | "POSITION_SEEDED" | "LEAGUE_TABLE_SEEDED";
    mapping_table?: object | null;
  } | null;
}
```

### `TieBreakRules`

```ts
TieBreakRules {
  use_head_to_head: boolean;
  use_goal_difference: boolean;
  use_goals_for: boolean;
  use_fair_play: boolean;
  final_fallback: "DRAW_LOT" | "ORGANIZER_DEFINED";
}
```

### `LeaguePhaseRules`

```ts
LeaguePhaseRules {
  table_type: "SINGLE_TABLE";
  matches_per_team: number;
  direct_qualification_positions?: {
    start: number;
    end: number;
  } | null;
  playoff_positions?: {
    start: number;
    end: number;
  } | null;
  eliminated_positions?: {
    start: number;
    end: number;
  } | null;
  seeding_strategy:
    | "TABLE_POSITION"
    | "BRACKET_DEFINED"
    | "ORGANIZER_DEFINED";
}
```

### `KnockoutResolutionRules`

```ts
KnockoutResolutionRules {
  second_leg_resolution_order?: (
    | "AWAY_GOALS_AFTER_90"
    | "EXTRA_TIME"
    | "PENALTIES"
    | "ORGANIZER_DEFINED"
  )[] | null;

  single_leg_resolution_order?: (
    | "EXTRA_TIME"
    | "PENALTIES"
    | "REPLAY"
    | "ORGANIZER_DEFINED"
  )[] | null;

  final_overrides_prior_round_rules: boolean;
}
```

## 8.3 Reglas de consistencia

- `team_domain = CLUB` no puede usar pool de selecciones.
- `team_domain = NATIONAL_TEAM` no puede usar pool de clubes.
- `leg_type = SECOND_LEG` requiere agregado previo.
- `neutral_venue = true` obliga a modificar o anular localía estándar.
- `stage_type` debe ser consistente con `format_type`.
- `GROUP_CLASSIC` no puede venir sin reglas de grupo.
- `LEAGUE_PHASE_SWISS_STYLE` no puede venir sin reglas de league phase.
- si `qualification_rules.bracket_mapping_definition.strategy = THIRD_PLACE_DEPENDENT`, debe existir `mapping_table`.
- si el formato de la competición requiere rutas de bracket dependientes de terceros clasificados, el `CompetitionProfile` sin `mapping_table` es inválido.
- si una fase eliminatoria puede terminar empatada tras 90 minutos y no existe secuencia de resolución knockout válida, el `CompetitionProfile` es inválido.

## 8.4 Reglas determinísticas de resolución knockout

`KnockoutResolutionRules` debe modelar una secuencia ordenada de resolución y no una combinación libre de flags.

Reglas obligatorias:

- `second_leg_resolution_order` solo aplica cuando `format_type = KNOCKOUT_TWO_LEG`;
- `single_leg_resolution_order` solo aplica cuando `format_type = KNOCKOUT_SINGLE_LEG`;
- el orden de los elementos define precedencia normativa;
- no pueden repetirse pasos dentro del mismo arreglo;
- si aparece `ORGANIZER_DEFINED`, debe ser el último elemento del arreglo;
- si `final_overrides_prior_round_rules = true`, debe existir una definición específica para la final en el catálogo de competición/temporada;
- si una fase eliminatoria puede quedar empatada tras 90 minutos y no existe secuencia de resolución válida, el `CompetitionProfile` es inválido.

Ejemplos válidos:

- `["AWAY_GOALS_AFTER_90", "EXTRA_TIME", "PENALTIES"]`
- `["EXTRA_TIME", "PENALTIES"]`
- `["PENALTIES"]`

Queda prohibido inferir por heurística histórica si aplica:

- gol de visitante,
- prórroga,
- penales,
- replay,
- reglas especiales de final.

---

# 9. Familias de competición soportadas

## 9.1 `DOMESTIC_LEAGUE`

Uso fuerte.

Características:

- round robin;
- localía estándar;
- buena comparabilidad histórica;
- sin agregado.

## 9.2 `DOMESTIC_CUP`

Uso medio.

Características:

- mayor volatilidad;
- posibles cruces entre divisiones;
- puede haber ida/vuelta o partido único.

## 9.3 `INTERNATIONAL_CLUB`

Debe soportar:

- fases previas / qualifying rounds;
- play-offs;
- grupos clásicos;
- league phase;
- knockout ida/vuelta;
- knockout a partido único;
- final única.

## 9.4 `NATIONAL_TEAM_TOURNAMENT`

Debe soportar:

- grupos clásicos;
- ranking de mejores terceros;
- knockout a partido único;
- third-place match;
- sedes neutrales.

---

# 10. Pools de rating y bridging interliga/interpaís

## 10.1 Separación obligatoria de pools

Debe existir al menos:

- `club_rating_pool`
- `national_team_rating_pool`

Queda prohibido compartir directamente el mismo universo de rating entre clubes y selecciones.

## 10.2 Bridging para torneos internacionales de clubes

Para `INTERNATIONAL_CLUB`, el rating efectivo v1 debe ser:

```text
effective_elo_team = team_elo + league_strength_factor(team_domain_id)
```

donde:

- `team_elo` = rating base del equipo
- `league_strength_factor` = ajuste versionado por liga / país / asociación

## 10.3 Gobernanza del `league_strength_factor`

```ts
LeagueStrengthFactorRecord {
  league_strength_factor_version: string;
  team_domain_id: string;
  value: number;
  effective_from_utc: string;
  effective_to_utc: string | null;
  source: string;
  confidence_level: "HIGH" | "MEDIUM" | "LOW";
}
```

Reglas:

- debe ser versionado;
- debe ser persistido;
- debe ser auditable;
- debe tener vigencia temporal;
- debe aplicarse solo a `INTERNATIONAL_CLUB`.

## 10.4 Regla de ausencia

Si falta `league_strength_factor` válido para un partido `INTERNATIONAL_CLUB`:

- no puede operar en `FULL_MODE`;
- debe bajar al menos a `LIMITED_MODE`;
- `applicability_level` no puede ser `STRONG`.

## 10.5 Selecciones nacionales

Para `NATIONAL_TEAM_TOURNAMENT`:

- no se aplica `league_strength_factor`;
- se usa exclusivamente el pool de selecciones.

---

# 11. Modos operativos y política de fallo

## 11.1 Modos operativos

### `FULL_MODE`

Se usa cuando:

- todos los campos críticos están presentes;
- el perfil competitivo es consistente;
- ambos equipos tienen historia mínima o rating previo utilizable;
- no existen contradicciones graves;
- si aplica, existe bridging válido;
- si aplica, existen reglas knockout válidas.

Salida permitida:

- todos los outputs del v1.

### `LIMITED_MODE`

Se usa cuando:

- los campos críticos existen;
- el perfil competitivo es consistente;
- pero faltan algunos componentes secundarios o el contexto es débil.

Salida permitida:

- núcleo principal,
- derivados prioritarios cuando sean matemáticamente válidos,
- outputs explicativos básicos o parciales.

Salida restringida:

- outputs secundarios pueden ser parciales o `null`;
- outputs explicativos pueden ser parciales o `null`;
- `applicability_level` no puede ser `STRONG`.

### `NOT_ELIGIBLE`

Se usa cuando:

- faltan campos críticos;
- el perfil es contradictorio;
- falta agregado en segunda pierna;
- no existe historia mínima ni rating utilizable;
- el partido está fuera de alcance;
- el dominio o bridging es inválido;
- faltan reglas knockout requeridas;
- existe `prior_rating_domain_mismatch`.

Salida:

- no se exponen probabilidades visibles;
- solo se devuelve la razón del fallo.

## 11.2 Razones explícitas de fallo

Catálogo mínimo:

- `MISSING_CRITICAL_FIELD`
- `INVALID_COMPETITION_PROFILE`
- `MISSING_AGGREGATE_STATE_FOR_SECOND_LEG`
- `INSUFFICIENT_HISTORY_AND_NO_UTILIZABLE_PRIOR_RATING`
- `UNSUPPORTED_MATCH_TYPE`
- `DOMAIN_POOL_UNAVAILABLE`
- `INTERLEAGUE_FACTOR_UNAVAILABLE`
- `KNOCKOUT_RULES_UNAVAILABLE`
- `INVALID_PRIOR_RATING`
- `EXCESSIVE_TAIL_MASS_FOR_REQUESTED_OUTPUTS`

## 11.3 Regla de degradación

Si el partido entra en `LIMITED_MODE`:

- `predictions.core` debe seguir existiendo;
- derivados secundarios pueden ser parciales o `null`;
- explainability puede ser parcial o `null`;
- el motivo de degradación debe persistirse;
- `applicability_level` debe ser `CAUTION` o `WEAK`.

---

# 12. Resultado de validación — `ValidationResult`

Los flags de integridad **no** forman parte del input; son resultado de validación interna.

```ts
ValidationResult {
  match_id: string;
  eligibility_status: "ELIGIBLE" | "NOT_ELIGIBLE";
  operating_mode: "FULL_MODE" | "LIMITED_MODE" | "NOT_ELIGIBLE";
  applicability_level: "STRONG" | "CAUTION" | "WEAK";

  reasons: string[];

  data_integrity_flags: {
    teams_distinct: boolean;
    kickoff_present: boolean;
    profile_complete: boolean;
    stage_consistent_with_format: boolean;
    aggregate_state_consistent_with_leg_type: boolean;
    neutral_venue_consistent: boolean;
    domain_pool_available: boolean;
    leakage_guard_passed: boolean;
    knockout_rules_consistent: boolean;
    prior_rating_consistent: boolean;
  };
}
```

---

# 13. Política de aplicabilidad

`applicability_level` no es subjetivo. Se determina por reglas.

## 13.1 Reglas determinísticas

### `STRONG`

Solo si se cumplen todas:

- `operating_mode = FULL_MODE`
- se cumple una de estas:
  - `competition_family = DOMESTIC_LEAGUE`
  - `stage_type = GROUP_STAGE` y `competition_family in {INTERNATIONAL_CLUB, NATIONAL_TEAM_TOURNAMENT}`
- ambos equipos cumplen:
  - para `CLUB`: `completed_official_matches_last_365d >= strong_recent_matches_club`
  - para `NATIONAL_TEAM`: `completed_official_matches_last_730d >= strong_recent_matches_national_team`
- `neutral_venue = false`
- `leg_type != SECOND_LEG`
- si aplica bridging, existe y `confidence_level in {"HIGH", "MEDIUM"}`

Queda prohibido otorgar `STRONG` solo por existencia de `prior_rating` si no se cumple también el umbral fuerte de historia reciente.

### `CAUTION`

Si el partido es `FULL_MODE` pero no cumple todas las condiciones de `STRONG`, y además permanece dentro del alcance modelado, incluyendo cualquiera de estos casos:

- `competition_family = DOMESTIC_CUP`
- `competition_family = INTERNATIONAL_CLUB`
- `stage_type in {PLAYOFF, ROUND_OF_32, ROUND_OF_16, QUARTER_FINAL, SEMI_FINAL, FINAL, THIRD_PLACE}`
- `neutral_venue = true`
- `leg_type = SECOND_LEG`
- uno de los equipos no alcanza el umbral fuerte de historia reciente
- bridging existente con `confidence_level = LOW`

### `WEAK`

Si se cumple cualquiera:

- `operating_mode = LIMITED_MODE`
- faltan componentes secundarios requeridos para exposición completa
- uno o ambos equipos entran solo por rating previo utilizable con historia reciente por debajo del umbral fuerte
- el contexto competitivo es elegible pero con degradaciones acumuladas

---

# 14. Cálculo del partido

## 14.1 Salidas estructurales mínimas

El motor debe producir:

- `lambda_home`
- `lambda_away`

A partir de ahí debe construirse:

- `raw_match_distribution = P(home_goals = i, away_goals = j)`

## 14.2 Scoreline matrix v1

La matriz v1 debe calcularse inicialmente para:

- goles local `0..7`
- goles visitante `0..7`

Debe calcularse explícitamente la masa truncada raw sobre la malla utilizada antes de renormalizar:

- `tail_mass_raw = 1 - Σ P(i,j)` sobre `i,j in [0..matrix_max_goal]`

Política v1 obligatoria:

- la malla inicial usa `matrix_max_goal = 7`;
- si `tail_mass_raw <= max_tail_mass_raw`, se permite renormalización explícita de la matriz truncada;
- si `tail_mass_raw > max_tail_mass_raw`, el sistema debe ejecutar una de estas políticas versionadas:
  - ampliar la malla hasta un máximo configurado;
  - degradar el partido a `LIMITED_MODE`;
  - marcar auditoría técnica y no exponer scorelines si corresponde.

Queda prohibido renormalizar silenciosamente una matriz truncada cuya masa omitida supere el umbral máximo permitido.

## 14.3 Persistencia mínima para reconstrucción

Debe persistirse como mínimo:

- `lambda_home`
- `lambda_away`
- `score_model_type`
- `matrix_max_goal`
- `tail_mass_raw`
- parámetros suficientes para reconstrucción determinística

---

# 15. Outputs obligatorios del v1

## 15.1 Núcleo principal

En el baseline v1 con Poisson independiente:

- `expected_goals_home = lambda_home`
- `expected_goals_away = lambda_away`

Outputs núcleo:

- `p_home_win`
- `p_draw`
- `p_away_win`
- `expected_goals_home`
- `expected_goals_away`
- `predicted_result`
- `predicted_result_conflict`
- `favorite_margin`
- `draw_risk`

## 15.2 Derivados secundarios

- `home_or_draw`
- `draw_or_away`
- `home_or_away`
- `dnb_home`
- `dnb_away`
- `over_2_5`
- `under_2_5`
- `over_1_5`
- `under_3_5`
- `btts_yes`
- `btts_no`
- `team_home_over_0_5`
- `team_away_over_0_5`
- `team_home_over_1_5`
- `team_away_over_1_5`
- `clean_sheet_home`
- `clean_sheet_away`
- `win_to_nil_home`
- `win_to_nil_away`
- `low_scoring_risk`

## 15.3 Explainability

- `most_likely_scoreline`
- `top_scorelines` (top 5 ordenados por probabilidad descendente)

## 15.4 Internos

- `elo_home_pre`
- `elo_away_pre`
- `elo_diff`
- `raw_1x2_probs`
- `calibrated_1x2_probs`
- `lambda_home`
- `lambda_away`
- `tail_mass_raw`
- `matrix_max_goal`
- `home_advantage_effect`
- `applicability_level`
- `operating_mode`
- `decision_policy_version`
- `too_close_margin_threshold`

---

# 16. Fórmulas de outputs derivados

## 16.1 Agregación 1X2 desde la distribución raw

A partir de `raw_match_distribution` deben agregarse:

- `raw_p_home_win = Σ P(i,j) donde i > j`
- `raw_p_draw = Σ P(i,j) donde i = j`
- `raw_p_away_win = Σ P(i,j) donde i < j`

Estos tres valores conforman `raw_1x2_probs`.

## 16.2 Outputs visibles 1X2

Los outputs visibles 1X2 deben ser:

- `p_home_win = calibrated_1x2_probs.home`
- `p_draw = calibrated_1x2_probs.draw`
- `p_away_win = calibrated_1x2_probs.away`

## 16.3 Doble oportunidad

Los mercados de doble oportunidad visibles deben calcularse a partir de `calibrated_1x2_probs`.

- `home_or_draw = p_home_win + p_draw`
- `draw_or_away = p_draw + p_away_win`
- `home_or_away = p_home_win + p_away_win`

## 16.4 Draw No Bet

Los mercados DNB visibles deben calcularse a partir de `calibrated_1x2_probs`.

Si `1 - p_draw > epsilon_dnb_denominator`:

- `dnb_home = p_home_win / (1 - p_draw)`
- `dnb_away = p_away_win / (1 - p_draw)`

Si `1 - p_draw <= epsilon_dnb_denominator`:

- `dnb_home = null`
- `dnb_away = null`

## 16.5 Totales

Los totales visibles deben derivarse de `raw_match_distribution`.

- `over_2_5 = P(i + j >= 3)`
- `under_2_5 = P(i + j <= 2)`
- `over_1_5 = P(i + j >= 2)`
- `under_3_5 = P(i + j <= 3)`

## 16.6 BTTS

Los mercados BTTS visibles deben derivarse de `raw_match_distribution`.

- `btts_yes = P(i >= 1 y j >= 1)`
- `btts_no = 1 - btts_yes`

## 16.7 Totales por equipo

- `team_home_over_0_5 = P(i >= 1)`
- `team_away_over_0_5 = P(j >= 1)`
- `team_home_over_1_5 = P(i >= 2)`
- `team_away_over_1_5 = P(j >= 2)`

## 16.8 Portería a cero

- `clean_sheet_home = P(j = 0)`
- `clean_sheet_away = P(i = 0)`

## 16.9 Win to nil

- `win_to_nil_home = Σ P(i,j) donde i > j y j = 0`
- `win_to_nil_away = Σ P(i,j) donde j > i y i = 0`

## 16.10 Riesgo de partido cerrado

- `low_scoring_risk = P(0,0) + P(1,0) + P(0,1) + P(1,1)`

## 16.11 Explainability de scoreline

- `draw_risk = p_draw`
- `most_likely_scoreline = scoreline con mayor P(i,j)`
- `top_scorelines = top 5 scorelines ordenados por probabilidad`

## 16.12 Regla de tie-break para `predicted_result`

La clasificación `TOO_CLOSE` no se determina por tolerancia numérica técnica sino por un umbral de indecisión de negocio.

Procedimiento:

1. Tomar `calibrated_1x2_probs`.
2. Ordenar `p_home_win`, `p_draw`, `p_away_win` de mayor a menor.
3. Calcular:
   - `top_1 = mayor probabilidad calibrada`
   - `top_2 = segunda mayor probabilidad calibrada`
   - `decision_margin = top_1 - top_2`
4. Si `decision_margin < too_close_margin_threshold`:
   - `predicted_result_conflict = true`
   - `predicted_result = "TOO_CLOSE"`
5. Si `decision_margin >= too_close_margin_threshold`:
   - `predicted_result_conflict = false`
   - `predicted_result = argmax(calibrated_1x2_probs)`

Valores permitidos de `predicted_result`:

- `HOME`
- `DRAW`
- `AWAY`
- `TOO_CLOSE`

## 16.13 `favorite_margin`

- `favorite_margin = probabilidad calibrada del resultado más probable - probabilidad calibrada del segundo resultado más probable`

Debe calcularse sobre probabilidades calibradas, sin redondear.

---

# 17. Política de calibración v1

## 17.1 Método obligatorio v1

El v1 debe usar:

- **Isotonic calibration one-vs-rest** por clase (`HOME`, `DRAW`, `AWAY`)
- seguida de **renormalización** para que las tres probabilidades sumen 1

## 17.2 Segmentación

La calibración debe entrenarse con esta jerarquía:

1. calibración segmentada por `team_domain + competition_family` solo si el segmento tiene **>= 1000 partidos históricos** válidos;
2. si el segmento tiene **>= 300** y `< 1000` partidos, puede usarse una calibración intermedia opcional solo si:
   - está versionada,
   - está documentada,
   - y queda explícito el fallback aplicado;
3. si el segmento tiene `< 300` partidos, debe usarse calibración global v1.

Queda prohibido invocar suficiencia muestral fuera de estos umbrales explícitos.

## 17.3 Corte temporal

La calibración debe entrenarse solo con datos anteriores al bloque de validación / inferencia.  
Queda prohibido recalibrar con datos posteriores al corte de predicción.

## 17.4 Versionado

Debe persistirse:

- `model_version`
- `calibration_version`
- `decision_policy_version`
- `too_close_margin_threshold`

`predicted_result` debe poder reconstruirse determinísticamente a partir de:

- `calibrated_1x2_probs`
- `too_close_margin_threshold`
- `decision_policy_version`

---

# 18. Reglas especiales por formato

## 18.1 Partidos en sede neutral

Si `neutral_venue = true`:

- la localía estándar debe anularse o ajustarse mediante una política documentada;
- no puede usarse el mismo ajuste que en un partido home/away normal.

## 18.2 Ida y vuelta

Si `leg_type = SECOND_LEG`:

- debe existir `aggregate_state_before_match`;
- el Match Prediction Engine predice solo el partido actual;
- el Competition Engine resuelve clasificación del cruce.

## 18.3 Mejores terceros

El Competition Engine debe soportar:

- ranking cruzado de terceros;
- reglas de desempate por torneo;
- construcción de bracket condicionada a qué terceros clasificaron;
- cuando el bracket dependa de combinaciones específicas de mejores terceros, debe usar `qualification_rules.bracket_mapping_definition.mapping_table`.

Queda prohibido resolver estos cruces por lógica implícita o por nombre del torneo.

## 18.4 League phase

El Competition Engine debe soportar:

- tabla única parcial;
- número fijo de partidos por equipo;
- clasificación diferencial según posición;
- seeding posterior para fase eliminatoria.

---

# 19. Invariantes y validaciones matemáticas obligatorias

## 19.1 Invariantes base

Deben cumplirse siempre sobre outputs visibles calibrados:

- `0 <= p_home_win <= 1`
- `0 <= p_draw <= 1`
- `0 <= p_away_win <= 1`
- `abs((p_home_win + p_draw + p_away_win) - 1) <= epsilon_probability`

Además, sobre `raw_1x2_probs`:

- `0 <= raw_1x2_probs.home <= 1`
- `0 <= raw_1x2_probs.draw <= 1`
- `0 <= raw_1x2_probs.away <= 1`
- `abs((raw_1x2_probs.home + raw_1x2_probs.draw + raw_1x2_probs.away) - 1) <= epsilon_probability`

## 19.2 Scoreline matrix

- cada celda `P(i,j)` debe estar en `[0,1]`
- la suma total de la matriz renormalizada debe ser `1 ± epsilon_probability`
- `most_likely_scoreline` debe pertenecer a la matriz vigente
- `tail_mass_raw` debe persistirse siempre
- si `tail_mass_raw > max_tail_mass_raw`, no puede tratarse como una reconstrucción estándar silenciosa

## 19.3 Invariantes de derivados 1X2-consistentes

Los siguientes invariantes deben verificarse sobre probabilidades calibradas expuestas:

- `home_or_draw = p_home_win + p_draw`
- `draw_or_away = p_draw + p_away_win`
- `home_or_away = p_home_win + p_away_win`

Además, sobre outputs derivados de `raw_match_distribution`:

- `abs((btts_yes + btts_no) - 1) <= epsilon_probability`
- `abs((over_2_5 + under_2_5) - 1) <= epsilon_probability`

## 19.4 Invariante DNB

Si `1 - p_draw > epsilon_dnb_denominator`:

- `abs((dnb_home + dnb_away) - 1) <= epsilon_probability`

Si `1 - p_draw <= epsilon_dnb_denominator`:

- ambos deben ser `null`

Los invariantes DNB se verifican sobre probabilidades calibradas expuestas.

## 19.5 Invariantes de calibración y exposición

Debe distinguirse explícitamente entre:

- `raw_match_distribution`: distribución base del partido derivada de `lambda_home` y `lambda_away`;
- `raw_1x2_probs`: probabilidades 1X2 agregadas desde `raw_match_distribution`;
- `calibrated_1x2_probs`: probabilidades calibradas de `HOME`, `DRAW`, `AWAY`.

Regla obligatoria v1:

- la calibración definida en esta especificación aplica únicamente al vector `1X2`;
- los outputs 1X2-consistentes expuestos al usuario deben derivarse de `calibrated_1x2_probs`;
- los mercados de goles, scoreline y derivados estructurales de anotación permanecen en espacio raw, salvo que exista una calibración específica versionada para ese mercado;
- queda prohibido modificar retrospectivamente `raw_match_distribution` o la `scoreline matrix` para forzar consistencia con `calibrated_1x2_probs` si no existe una política formal de reconciliación versionada.

Outputs visibles que en v1 deben salir de `calibrated_1x2_probs`:

- `p_home_win`
- `p_draw`
- `p_away_win`
- `home_or_draw`
- `draw_or_away`
- `home_or_away`
- `dnb_home`
- `dnb_away`
- `predicted_result`
- `predicted_result_conflict`
- `favorite_margin`
- cualquier UI o ranking que compare explícitamente `HOME`, `DRAW`, `AWAY`

Outputs visibles que en v1 salen de `raw_match_distribution`:

- `expected_goals_home`
- `expected_goals_away`
- `over_2_5`
- `under_2_5`
- `over_1_5`
- `under_3_5`
- `btts_yes`
- `btts_no`
- `team_home_over_0_5`
- `team_away_over_0_5`
- `team_home_over_1_5`
- `team_away_over_1_5`
- `clean_sheet_home`
- `clean_sheet_away`
- `win_to_nil_home`
- `win_to_nil_away`
- `low_scoring_risk`
- `most_likely_scoreline`
- `top_scorelines`

Debe persistirse además:

- `raw_1x2_probs`
- `calibrated_1x2_probs`

Queda prohibido etiquetar como “calibrado” cualquier output no cubierto por una calibración específica versionada.

## 19.6 Invariantes contextuales

- si `neutral_venue = true`, no puede aplicarse localía estándar sin corrección;
- si `leg_type = SECOND_LEG`, debe existir agregado previo;
- si `team_domain = NATIONAL_TEAM`, no puede usarse el pool de clubes;
- si `prior_rating_domain_mismatch`, el partido es `NOT_ELIGIBLE`.

## 19.7 Regla de verificación por fuente

QA debe validar explícitamente dos familias de outputs:

- familia `1X2-consistent calibrated`: `p_home_win`, `p_draw`, `p_away_win`, dobles oportunidades, DNB, `predicted_result`, `favorite_margin`;
- familia `goal/scoreline raw`: xG, totales, BTTS, team totals, clean sheets, win to nil, low scoring risk, scorelines.

Queda prohibido validar mercados de goles usando invariantes algebraicos propios del vector calibrado 1X2.

---

# 20. Política de equipos nuevos o poca historia

## 20.1 Regla mínima v1

Si el equipo tiene:

- rating previo utilizable: puede entrar al sistema;
- no tiene rating previo utilizable pero sí historia mínima: puede construirse rating base;
- no tiene ni rating previo utilizable ni historia mínima: `NOT_ELIGIBLE`.

Debe existir una política explícita para:

- rating inicial por dominio;
- regresión parcial a media al inicio de temporada;
- seed desde temporada/categoría anterior si existe;
- equipos debutantes o con historia insuficiente.

## 20.2 Regla operativa para `prior_rating`

Un `prior_rating` se considera utilizable en v1 solo si se cumplen todas estas condiciones:

- pertenece al mismo `team_domain` del partido actual;
- no supera `prior_rating_max_age_days` respecto a `kickoff_utc`;
- el equipo tiene al menos `prior_rating_min_updates_last_730d` partidos oficiales usados para construir o actualizar ese rating dentro de la ventana histórica aplicable;
- no existe `domain_mismatch`;
- si hubo carry entre temporadas, este está permitido por `prior_rating_cross_season_carry_allowed`.

Reglas obligatorias:

- `prior_rating_domain_mismatch => NOT_ELIGIBLE`
- `prior_rating_age_days > prior_rating_max_age_days => prior_rating no utilizable`
- si el `prior_rating` no es utilizable y tampoco se cumple historia mínima, el partido es `NOT_ELIGIBLE`
- si el `prior_rating` es utilizable pero la historia reciente no alcanza umbral fuerte, el partido puede operar solo en `CAUTION` o `WEAK`, nunca en `STRONG`

---

# 21. Envelope de salida — `PredictionResponse v1`

```ts
PredictionResponse {
  match_id: string;

  model_version: string;
  calibration_version: string;
  competition_profile_version: string;
  league_strength_factor_version?: string | null;
  decision_policy_version: string;
  too_close_margin_threshold: number;

  eligibility_status: "ELIGIBLE" | "NOT_ELIGIBLE";
  operating_mode: "FULL_MODE" | "LIMITED_MODE" | "NOT_ELIGIBLE";
  applicability_level: "STRONG" | "CAUTION" | "WEAK";

  reasons: string[];

  predictions?: {
    core: {
      p_home_win: number;
      p_draw: number;
      p_away_win: number;

      expected_goals_home: number;
      expected_goals_away: number;

      predicted_result: "HOME" | "DRAW" | "AWAY" | "TOO_CLOSE";
      predicted_result_conflict: boolean;

      favorite_margin: number;
      draw_risk: number;
    };

    secondary?: {
      home_or_draw?: number | null;
      draw_or_away?: number | null;
      home_or_away?: number | null;

      dnb_home?: number | null;
      dnb_away?: number | null;

      over_2_5?: number | null;
      under_2_5?: number | null;
      over_1_5?: number | null;
      under_3_5?: number | null;

      btts_yes?: number | null;
      btts_no?: number | null;

      team_home_over_0_5?: number | null;
      team_away_over_0_5?: number | null;
      team_home_over_1_5?: number | null;
      team_away_over_1_5?: number | null;

      clean_sheet_home?: number | null;
      clean_sheet_away?: number | null;

      win_to_nil_home?: number | null;
      win_to_nil_away?: number | null;

      low_scoring_risk?: number | null;
    } | null;

    explainability?: {
      most_likely_scoreline?: string | null;
      top_scorelines?: { score: string; p: number }[] | null;
    } | null;
  } | null;

  internals?: {
    elo_home_pre: number;
    elo_away_pre: number;
    elo_diff: number;

    raw_1x2_probs: {
      home: number;
      draw: number;
      away: number;
    };

    calibrated_1x2_probs: {
      home: number;
      draw: number;
      away: number;
    };

    lambda_home: number;
    lambda_away: number;
    tail_mass_raw: number;
    matrix_max_goal: number;
    home_advantage_effect: number;
    score_model_type: "INDEPENDENT_POISSON";
  } | null;
}
```

## 21.1 Regla obligatoria para `NOT_ELIGIBLE`

Si `eligibility_status = NOT_ELIGIBLE`, entonces debe cumplirse todo esto:

- `predictions = null`
- `internals = null` o, como máximo, un bloque mínimo de diagnóstico técnico sin probabilidades
- `reasons` debe contener al menos un código válido del catálogo de fallos
- `operating_mode = NOT_ELIGIBLE`

Queda prohibido devolver probabilidades parciales o derivados visibles cuando el partido es `NOT_ELIGIBLE`.

## 21.2 Diagnóstico mínimo permitido en `NOT_ELIGIBLE`

Si se expone un bloque técnico mínimo en `NOT_ELIGIBLE`, solo puede incluir:

- `operating_mode`
- `applicability_level`
- `reasons`

No puede incluir:

- probabilidades,
- lambdas,
- scoreline matrix,
- derivados.

## 21.3 Regla de exposición por modo

En `FULL_MODE`:

- `predictions.core` es obligatorio;
- `predictions.secondary` es obligatorio salvo excepciones matemáticas explícitas como DNB indefinido;
- `predictions.explainability` es obligatorio.

En `LIMITED_MODE`:

- `predictions.core` sigue siendo obligatorio;
- `predictions.secondary` puede ser parcial o `null`;
- `predictions.explainability` puede ser parcial o `null`;
- toda ausencia debe justificarse mediante `reasons`.

Queda prohibido omitir `predictions.core` en un partido `ELIGIBLE`.

---

# 22. Prioridades de exposición

## 22.1 Prioridad A — obligatoria

- `predictions.core`
- `home_or_draw`
- `draw_or_away`
- `home_or_away`
- `dnb_home`
- `dnb_away`
- `over_2_5`
- `under_2_5`
- `btts_yes`
- `btts_no`

## 22.2 Prioridad B — recomendada

- `over_1_5`
- `under_3_5`
- `team_home_over_0_5`
- `team_away_over_0_5`
- `team_home_over_1_5`
- `team_away_over_1_5`
- `clean_sheet_home`
- `clean_sheet_away`
- `win_to_nil_home`
- `win_to_nil_away`
- `low_scoring_risk`
- `most_likely_scoreline`
- `top_scorelines`

## 22.3 Prioridad C — interna

- `elo_home_pre`
- `elo_away_pre`
- `elo_diff`
- `raw_1x2_probs`
- `calibrated_1x2_probs`
- `home_advantage_effect`
- `operating_mode`
- `applicability_level`
- `decision_policy_version`
- `too_close_margin_threshold`

---

# 23. Métricas y validación del modelo

## 23.1 Baselines obligatorios

El v1 debe compararse, como mínimo, contra:

- `Baseline A`: distribución empírica 1X2 estimada sobre partidos históricos previos al corte temporal, segmentada exclusivamente por:
  - `team_domain`
  - `competition_family`
  - `neutral_venue`

Si el segmento de `Baseline A` contiene menos de `300` partidos, debe hacerse fallback jerárquico documentado a:

1. `team_domain + neutral_venue`
2. `team_domain`
3. global

- `Baseline B`: Elo puro sin capa de goles ni calibración

El modelo no se considera aceptable si no mejora de forma consistente al menos uno de ellos en validación temporal.

## 23.2 Métricas

### Clasificación principal

Debe reportarse obligatoriamente:

- `inclusive_accuracy` = aciertos sobre total de partidos elegibles, contando `TOO_CLOSE` como no acierto resolutivo;
- `conditional_accuracy` = aciertos sobre partidos con `predicted_result in {HOME, DRAW, AWAY}`;
- `too_close_rate` = partidos con `predicted_result = TOO_CLOSE / total de partidos elegibles`;
- `effective_prediction_coverage` = partidos con `predicted_result in {HOME, DRAW, AWAY} / total de partidos elegibles`.

Queda prohibido reportar solo la accuracy condicional sin acompañarla de cobertura.

### Probabilidades

- log loss
- Brier score
- calibración por buckets

### Scoreline

- hit rate de `most_likely_scoreline`
- cobertura top-3
- cobertura top-5

### Goles esperados

- MAE / RMSE contra goles observados como proxy operativa

---

# 24. Umbrales de aceptación v1

## 24.1 Contextos `STRONG`

### 1X2

- `conditional_accuracy >= 0.45`
- `conditional_accuracy > 0.60` dispara auditoría
- `log_loss` debe mejorar al menos **5%** contra `Baseline A`
- `brier_score` debe mejorar al menos **3%** contra `Baseline A`

### Cobertura de predicción fuerte

- `too_close_rate <= 0.15`, salvo justificación técnica explícita
- `effective_prediction_coverage >= 0.85`

### Scoreline

- `most_likely_scoreline_hit_rate >= 0.08`
- `top_3_scoreline_coverage >= 0.25`
- `top_5_scoreline_coverage >= 0.35`

### Calibración

- error absoluto por bucket <= **0.07** en buckets con `n >= min_bucket_sample_for_calibration_eval`

## 24.2 Contextos `CAUTION`

### 1X2

- `conditional_accuracy >= 0.42`
- `log_loss` no debe ser peor que `Baseline B`
- `brier_score` no debe ser peor que `Baseline B`

### Cobertura de predicción fuerte

- `too_close_rate <= 0.25`
- `effective_prediction_coverage >= 0.75`

### Scoreline

- `most_likely_scoreline_hit_rate >= 0.06`
- `top_3_scoreline_coverage >= 0.20`

## 24.3 Contextos `WEAK`

- no se usa como benchmark principal de performance;
- outputs deben marcarse como débiles o degradarse;
- no deben presentarse como predicción fuerte.

## 24.4 Regla de auditoría

Debe abrirse revisión técnica si ocurre cualquiera de estos casos:

- accuracy anormalmente alta;
- mejora abrupta no explicada entre versiones;
- la calibración empeora aunque suba la accuracy;
- outputs derivados rompen invariantes;
- `FULL_MODE` cae en exceso a `LIMITED_MODE`;
- `too_close_rate` excede el umbral permitido para el contexto;
- `effective_prediction_coverage` cae por debajo del umbral permitido.

---

# 25. Suite mínima de validación automática

## 25.1 Validación de esquema

Verifica:

- presencia de campos críticos;
- consistencia del `CompetitionProfile`;
- elegibilidad por dominio y formato;
- consistencia de `KnockoutResolutionRules`.

## 25.2 Validación matemática

Verifica todos los invariantes del bloque 19.

## 25.3 Validación de modos operativos

Verifica:

- asignación correcta de `FULL_MODE`, `LIMITED_MODE`, `NOT_ELIGIBLE`;
- razones explícitas en fallos y degradaciones.

## 25.4 Validación de reconstrucción

Verifica que, a partir de:

- `lambda_home`
- `lambda_away`
- `score_model_type`
- `matrix_max_goal`
- `tail_mass_raw`

puedan reconstruirse de forma determinística los outputs raw correspondientes.

Además, verifica que, a partir de:

- `calibrated_1x2_probs`
- `too_close_margin_threshold`
- `decision_policy_version`

pueda reconstruirse de forma determinística `predicted_result`.

## 25.5 Validación temporal

La evaluación principal debe ser exclusivamente:

- walk-forward temporal

Queda prohibido:

- random split como evaluación principal.

---

# 26. Criterios de aceptación de implementación

La implementación v1 se considera correcta si cumple todo esto:

1. genera `lambda_home`, `lambda_away`, `raw_match_distribution`, `raw_1x2_probs` y `calibrated_1x2_probs` de forma consistente;
2. deriva correctamente:
   - mercados 1X2-consistentes desde `calibrated_1x2_probs`;
   - mercados de goles y scoreline desde `raw_match_distribution`;
3. respeta los invariantes matemáticos;
4. separa correctamente predictor de partido y motor de competición;
5. soporta perfiles de competición configurables;
6. opera con pools de rating separados por dominio;
7. implementa bridging para `INTERNATIONAL_CLUB`;
8. soporta grupos, league phase, mejores terceros, ida/vuelta y knockout;
9. implementa modos `FULL_MODE`, `LIMITED_MODE`, `NOT_ELIGIBLE`;
10. persiste probabilidades raw y calibradas por separado;
11. persiste `decision_policy_version` y `too_close_margin_threshold`;
12. permite backtesting temporal;
13. no depende de reglas dispersas hardcodeadas por torneo;
14. implementa versión explícita de modelo, calibración, profile, bridging y policy de decisión;
15. define `prior_rating` con reglas duras y no interpretables.

---

# 27. Decisión de cierre

La versión cerrada del v1 queda definida como:

> Un sistema compuesto por un **Match Prediction Engine** común para partidos oficiales senior en tiempo reglamentario, basado en **Elo extendido + ajustes contextuales + Poisson independiente**, que produce una **distribución base raw del partido** y un **vector visible calibrado 1X2**, y un **Competition Engine** configurable capaz de soportar ligas, copas, fases previas, group stage, league phase, mejores terceros, ida/vuelta y knockout, produciendo una salida probabilística coherente, determinística y auditable bajo reglas explícitas de exposición, calibración, validación y resolución competitiva.
