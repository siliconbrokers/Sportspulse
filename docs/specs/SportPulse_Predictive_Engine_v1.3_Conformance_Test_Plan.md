
# SportPulse — Plan de pruebas de conformidad v1.3

**Nombre del documento:** SportPulse_Predictive_Engine_v1.3_Conformance_Test_Plan  
**Versión:** 1.0  
**Estado:** Aprobado para QA y auditoría de implementación  
**Fuente de verdad normativa:** `SportPulse_Predictive_Engine_Spec_v1.3_Final.md`  
**Objetivo:** Verificar que la implementación cumple exactamente el spec congelado v1.3 y no una interpretación parcial.

---

# 1. Propósito

Este documento define los casos de prueba, la matriz de cobertura y los gates de conformidad para validar la implementación del motor predictivo v1.3 de SportPulse.

No es un plan de QA cosmético.  
Es un **plan de conformidad**: cada caso existe para probar una obligación normativa del spec congelado.

---

# 2. Regla de decisión PASS / FAIL

La implementación solo se considera **PASS** si cumple simultáneamente todo esto:

1. No falla ningún caso crítico de schema, elegibilidad, invariantes, exposición o temporalidad.
2. No existe ninguna contradicción entre:
   - `PredictionResponse`
   - fórmulas de outputs
   - invariantes matemáticos
   - reglas operativas
   - `ValidationResult`
3. Los outputs 1X2-consistentes visibles derivan de `calibrated_1x2_probs`.
4. Los mercados de goles, scoreline y anotación derivan de `raw_match_distribution`.
5. `KnockoutResolutionRules` es secuencial y determinístico.
6. `prior_rating` está gobernado por umbrales y reglas de invalidez concretas.
7. No existe ninguna referencia residual a `epsilon_display`.
8. `NOT_ELIGIBLE` no expone probabilidades visibles.
9. `top_scorelines` está alineado con `top_5_scoreline_coverage`.
10. La evaluación principal es walk-forward temporal y respeta anti-leakage estricto.

Cualquier incumplimiento en esos puntos implica **FAIL de conformidad**.

---

# 3. Tipos de prueba usados

- **Schema**: valida contratos, enums, nulabilidad, estados inválidos y estructuras imposibles.
- **Unit**: valida fórmulas y funciones determinísticas.
- **Property**: valida invariantes matemáticos y relaciones que deben mantenerse para múltiples entradas.
- **Integration**: valida interacción entre motores/capas/datos.
- **Acceptance**: valida comportamiento esperado completo contra reglas del spec.
- **Regression**: evita reintroducir contradicciones ya cerradas por el spec.

---

# 4. Fixtures mínimos recomendados

Estos fixtures deben existir antes de ejecutar la suite.

| Fixture | Nombre | Uso |
|---|---|---|
| FX-01 | Domestic League Strong | Partido DOMESTIC_LEAGUE con historia fuerte, sin neutral venue, sin second leg, sin bridging requerido. Base para FULL_MODE/STRONG. |
| FX-02 | Domestic Cup Caution | Partido de copa doméstica con input correcto y volatilidad competitiva. Base para CAUTION. |
| FX-03 | International Club Full | Partido INTERNATIONAL_CLUB con bridging HIGH/MEDIUM válido, historia suficiente y profile consistente. |
| FX-04 | International Club Limited No Bridging | Partido INTERNATIONAL_CLUB sin league_strength_factor válido. Base para degradación por bridging. |
| FX-05 | National Team Tournament | Partido de selecciones con pool nacional, sin league_strength_factor. |
| FX-06 | Second Leg Valid | KNOCKOUT_TWO_LEG con aggregate_state_before_match y second_leg_resolution_order válida. |
| FX-07 | Second Leg Invalid Aggregate Missing | SECOND_LEG sin aggregate_state_before_match. |
| FX-08 | Group Classic | Grupo clásico con group_ranking_rules, qualification_rules y tie_break_rules. |
| FX-09 | Best Thirds Tournament | Torneo con ranking cruzado de terceros y mapping_table dependiente de terceros clasificados. |
| FX-10 | League Phase | League phase con tabla única, posiciones de clasificación directa, playoff y eliminación. |
| FX-11 | Prior Rating Usable | Equipo con prior_rating dentro de age, updates y domain válidos. |
| FX-12 | Prior Rating Invalid | Casos de prior_rating demasiado viejo, domain mismatch o updates insuficientes. |
| FX-13 | Tail Mass Low | Parámetros de lambdas donde tail_mass_raw <= max_tail_mass_raw. |
| FX-14 | Tail Mass High | Parámetros de lambdas donde tail_mass_raw > max_tail_mass_raw. |
| FX-15 | Too Close Margin | calibrated_1x2_probs con margen < too_close_margin_threshold. |
| FX-16 | Clear Winner Margin | calibrated_1x2_probs con margen >= too_close_margin_threshold. |
| FX-17 | Leakage Trap | Dataset con partidos posteriores a kickoff, mismos bloques temporales ambiguos y riesgo de leakage. |
| FX-18 | Metric Evaluation Dataset | Dataset con folds walk-forward, baselines A/B y buckets de calibración. |

---

# 5. Matriz de cobertura por capítulo del spec

La siguiente matriz verifica que el plan cubre todo el spec congelado y no solo piezas aisladas.

| Capítulos del spec | Tema cubierto | Casos principales |
|---|---|---|
| 1–6 | Propósito, alcance, principios, constantes, arquitectura, baseline | TC-001, TC-021, TC-041, TC-056, TC-087, TC-091 |
| 7 | Contrato de entrada MatchInput | TC-001 a TC-012 |
| 8 | CompetitionProfile, reglas configurables y knockout | TC-013 a TC-024, TC-075 a TC-086 |
| 9 | Familias de competición soportadas | TC-022, TC-023, TC-025, TC-026, TC-037 |
| 10 | Pools y bridging | TC-022, TC-023, TC-024, TC-032, TC-033 |
| 11–13 | Modos operativos, ValidationResult y aplicabilidad | TC-025 a TC-040 |
| 14–16 | Cálculo del partido, outputs y fórmulas | TC-041 a TC-067 |
| 17 | Calibración | TC-056 a TC-067, TC-090 |
| 18 | Reglas especiales por formato | TC-020, TC-021, TC-075 a TC-086 |
| 19 | Invariantes matemáticos y por fuente | TC-042 a TC-067, TC-071, TC-105 |
| 20 | Equipos nuevos y prior_rating | TC-007, TC-008, TC-028 a TC-031 |
| 21–22 | PredictionResponse y prioridades de exposición | TC-040, TC-068 a TC-074 |
| 23–24 | Métricas, validación y umbrales de aceptación | TC-093, TC-095 a TC-104 |
| 25–26 | Suite mínima de validación y criterios de aceptación de implementación | TC-087 a TC-105 |

---

# 6. Plantilla normativa de cada caso

Cada caso de prueba debe ejecutarse y reportarse con esta estructura mínima:

```md
### TC-XXX — Nombre del caso

**Objetivo**  
Qué obligación del spec valida.

**Secciones del spec cubiertas**  
Lista exacta de secciones.

**Precondiciones / Input**  
Fixture, payload o situación de arranque.

**Resultado esperado**  
Modo operativo, contrato, output o invariante esperado.

**Criterio de PASS / FAIL**  
Condición binaria; no se admite interpretación libre.
```

---

# 7. Casos de prueba detallados

## A. Contratos y MatchInput

| ID | Tipo | Caso | Secciones del spec | Precondiciones / Input | Resultado esperado / criterio de PASS |
|---|---|---|---|---|---|
| TC-001 | Schema/Acceptance | MatchInput mínimo válido para partido elegible | 7.1, 7.2, 12 | Payload con todos los campos críticos, competition_profile consistente, partido oficial senior 11v11 | ValidationResult elegible; sin razones de fallo por campos críticos; schema acepta input |
| TC-002 | Schema | Falta match_id | 7.2, 11.2 | Eliminar match_id del input | eligibility_status = NOT_ELIGIBLE; reasons incluye MISSING_CRITICAL_FIELD |
| TC-003 | Schema | Falta competition_profile.team_domain | 7.2, 11.2 | Input sin team_domain | NOT_ELIGIBLE; reasons incluye MISSING_CRITICAL_FIELD o INVALID_COMPETITION_PROFILE |
| TC-004 | Schema | SECOND_LEG sin aggregate_state_before_match | 7.3, 8.1, 11.2, 19.6 | leg_type = SECOND_LEG sin aggregate_state_before_match | NOT_ELIGIBLE; reasons incluye MISSING_AGGREGATE_STATE_FOR_SECOND_LEG |
| TC-005 | Schema | GROUP_CLASSIC sin reglas de grupo | 7.3, 8.3 | format_type = GROUP_CLASSIC sin group_ranking_rules / qualification_rules / tie_break_rules | CompetitionProfile inválido; no FULL_MODE |
| TC-006 | Schema | LEAGUE_PHASE sin league_phase_rules | 7.3, 8.3 | format_type = LEAGUE_PHASE_SWISS_STYLE sin league_phase_rules / qualification_rules / tie_break_rules | CompetitionProfile inválido; no FULL_MODE |
| TC-007 | Schema | Historia mínima CLUB satisfecha por prior_rating | 7.4, 20.1, 20.2 | Equipo club con <5 partidos recientes pero prior_rating utilizable | No cae por historia mínima; sigue flujo de modo/aplicabilidad según reglas restantes |
| TC-008 | Schema | Sin historia mínima ni prior_rating | 7.4, 11.2, 20.1 | Ambos equipos sin historia mínima y sin prior_rating utilizable | NOT_ELIGIBLE; reasons incluye INSUFFICIENT_HISTORY_AND_NO_PRIOR_RATING |
| TC-009 | Schema | Ventanas históricas correctas por dominio | 7.4 | Comparar CLUB usando 365d y NATIONAL_TEAM usando 730d | La validación usa la ventana correcta según team_domain |
| TC-010 | Acceptance | Partido amistoso/juvenil/no oficial | 7.5, 7.6, 11.2 | Competition catalog marca partido fuera de alcance | NOT_ELIGIBLE; reasons incluye UNSUPPORTED_MATCH_TYPE |
| TC-011 | Acceptance | No se permite inferir oficial/senior/11v11 por nombre libre | 7.6 | Competition catalog ausente o insuficiente; nombre del torneo sugiere oficialidad | NOT_ELIGIBLE; sin heurística blanda |
| TC-012 | Integration | stage_id/group_id ausentes cuando Competition Engine los necesita | 7.7, 5.2 | Escenario de standings o bracket que requiere stage_id y/o group_id | No FULL_MODE o fallo explícito de perfil/validación según componente consumidor |


## B. CompetitionProfile y reglas knockout

| ID | Tipo | Caso | Secciones del spec | Precondiciones / Input | Resultado esperado / criterio de PASS |
|---|---|---|---|---|---|
| TC-013 | Schema | stage_type inconsistente con format_type | 8.3 | Ejemplo: stage_type=GROUP_STAGE con format_type=KNOCKOUT_TWO_LEG | INVALID_COMPETITION_PROFILE |
| TC-014 | Schema | THIRD_PLACE_DEPENDENT sin mapping_table | 8.3, 18.3 | qualification_rules.bracket_mapping_definition.strategy = THIRD_PLACE_DEPENDENT sin mapping_table | CompetitionProfile inválido |
| TC-015 | Schema | second_leg_resolution_order usado en KNOCKOUT_SINGLE_LEG | 8.4 | format_type = KNOCKOUT_SINGLE_LEG con second_leg_resolution_order presente | CompetitionProfile inválido |
| TC-016 | Schema | single_leg_resolution_order usado en KNOCKOUT_TWO_LEG | 8.4 | format_type = KNOCKOUT_TWO_LEG con single_leg_resolution_order presente | CompetitionProfile inválido |
| TC-017 | Schema | Secuencia knockout con pasos repetidos | 8.4 | second_leg_resolution_order = [EXTRA_TIME, EXTRA_TIME, PENALTIES] | CompetitionProfile inválido |
| TC-018 | Schema | ORGANIZER_DEFINED no es último paso | 8.4 | single_leg_resolution_order = [ORGANIZER_DEFINED, PENALTIES] | CompetitionProfile inválido |
| TC-019 | Schema | Final override requerido pero no definido | 8.4 | final_overrides_prior_round_rules = true sin definición específica de final | CompetitionProfile inválido |
| TC-020 | Acceptance | Secuencia knockout válida con precedencia inequívoca | 8.4, 18.2 | second_leg_resolution_order = [AWAY_GOALS_AFTER_90, EXTRA_TIME, PENALTIES] | Perfil válido; resolución usa exactamente ese orden |
| TC-021 | Integration | neutral_venue=true desactiva localía estándar | 8.1, 18.1, 19.6 | Partido en sede neutral con resto del input válido | home_advantage_effect no usa localía estándar sin corrección |
| TC-022 | Integration | INTERNATIONAL_CLUB sin league_strength_factor válido | 10.2, 10.4, 13.1 | Partido de INTERNATIONAL_CLUB sin bridging disponible | No FULL_MODE; applicability_level no puede ser STRONG |
| TC-023 | Integration | NATIONAL_TEAM no usa league_strength_factor | 10.5, 19.6 | Partido de selecciones con factor de liga inyectado erróneamente | Se ignora/valida como inconsistencia; nunca forma parte del cálculo |
| TC-024 | Integration | Pools de rating separados por dominio | 10.1, 19.6 | Intentar reutilizar club_rating_pool para NATIONAL_TEAM o viceversa | Validación falla o componente rechaza mezcla de pools |


## C. Elegibilidad, modos y aplicabilidad

| ID | Tipo | Caso | Secciones del spec | Precondiciones / Input | Resultado esperado / criterio de PASS |
|---|---|---|---|---|---|
| TC-025 | Acceptance | FULL_MODE STRONG doméstica estándar | 11.1, 13.1 | DOMESTIC_LEAGUE, neutral_venue=false, leg_type!=SECOND_LEG, historia fuerte en ambos equipos | operating_mode=FULL_MODE; applicability_level=STRONG |
| TC-026 | Acceptance | FULL_MODE CAUTION por copa/neutral/fase eliminatoria | 11.1, 13.1 | Partido FULL_MODE con competition_family=DOMESTIC_CUP o neutral_venue=true o stage knockout | applicability_level=CAUTION |
| TC-027 | Acceptance | LIMITED_MODE por historia reciente débil con prior_rating utilizable | 11.1, 11.3, 20.2 | Input elegible con prior_rating utilizable pero sin umbral fuerte de historia | operating_mode=LIMITED_MODE o FULL_MODE no STRONG según causas; reasons explica degradación |
| TC-028 | Schema | prior_rating_domain_mismatch | 20.2 | prior_rating del team_domain incorrecto | NOT_ELIGIBLE |
| TC-029 | Schema | prior_rating demasiado viejo | 4.3, 20.2 | prior_rating_age_days > prior_rating_max_age_days | prior_rating no utilizable |
| TC-030 | Schema | prior_rating con muy pocas actualizaciones | 4.3, 20.2 | prior_rating_min_updates_last_730d no cumplido | prior_rating no utilizable |
| TC-031 | Acceptance | prior_rating utilizable no habilita STRONG por sí solo | 13.1, 20.2 | Ambos equipos con prior_rating utilizable pero historia reciente por debajo del umbral fuerte | applicability_level != STRONG |
| TC-032 | Acceptance | Bridging LOW fuerza CAUTION | 4.3, 10.3, 13.1 | INTERNATIONAL_CLUB con league_strength_factor confidence_level = LOW | No STRONG; como máximo CAUTION |
| TC-033 | Schema | domain_pool unavailable | 11.2, 12 | Pool del dominio faltante | NOT_ELIGIBLE; reasons incluye DOMAIN_POOL_UNAVAILABLE |
| TC-034 | Integration | leakage_guard_passed false | 3.6, 12 | Escenario donde features usan datos posteriores al kickoff | No FULL_MODE; data_integrity_flags.leakage_guard_passed = false; fallo explícito |
| TC-035 | Acceptance | Reasons obligatorias en degradación | 11.3, 12, 21.3 | Partido en LIMITED_MODE | reasons no vacío y justifica la degradación |
| TC-036 | Acceptance | NOT_ELIGIBLE no expone predicciones visibles | 11.1, 21.1, 21.2 | Cualquier partido NOT_ELIGIBLE | predictions = null; internals nulo o solo diagnóstico mínimo sin probabilidades |
| TC-037 | Acceptance | STRONG solo en contextos permitidos | 13.1 | Probar FINAL, SECOND_LEG, neutral_venue=true, DOMESTIC_CUP | Ninguno obtiene STRONG |
| TC-038 | Acceptance | SECOND_LEG nunca STRONG | 13.1 | Partido SECOND_LEG por lo demás bien formado | applicability_level != STRONG |
| TC-039 | Acceptance | neutral_venue nunca STRONG | 13.1 | Partido neutral_venue=true por lo demás bien formado | applicability_level != STRONG |
| TC-040 | Schema/Acceptance | LIMITED_MODE mantiene core obligatorio | 21.3 | Partido ELIGIBLE en LIMITED_MODE | predictions.core presente; secondary y explainability pueden ser nulos/parciales con reasons |


## D. Match Prediction Engine raw

| ID | Tipo | Caso | Secciones del spec | Precondiciones / Input | Resultado esperado / criterio de PASS |
|---|---|---|---|---|---|
| TC-041 | Unit | Cálculo de lambda_home y lambda_away | 5.1, 14.1 | Input elegible mínimo | Se generan ambos lambdas como floats válidos |
| TC-042 | Property | Matriz raw renormalizada suma 1 | 14.2, 19.2 | tail_mass_raw dentro de umbral | Σ P(i,j) renormalizada = 1 ± epsilon_probability |
| TC-043 | Property | Cada celda está en [0,1] y el scoreline existe en la matriz | 14.2, 19.2 | Generar matriz en caso estándar | Todas las celdas válidas; most_likely_scoreline pertenece a la matriz vigente |
| TC-044 | Acceptance | tail_mass_raw bajo permite renormalización | 14.2, 19.2 | Caso con tail_mass_raw <= max_tail_mass_raw | Renormalización explícita permitida |
| TC-045 | Acceptance | tail_mass_raw alto no permite renormalización silenciosa | 14.2, 19.2 | Caso con tail_mass_raw > max_tail_mass_raw | Se amplía malla o degrada o audita; nunca se renormaliza en silencio |
| TC-046 | Unit | expected_goals coincide con lambdas | 15.1, 16.1 | Partido estándar | expected_goals_home=lambda_home; expected_goals_away=lambda_away |
| TC-047 | Unit | raw_1x2_probs se agregan desde la matriz | 16.1 | Calcular raw_match_distribution | raw_1x2_probs coincide con sumatorias i>j, i=j, i<j |
| TC-048 | Unit | Totales over/under desde raw | 16.5 | Calcular over_2_5, under_2_5, over_1_5, under_3_5 | Valores coinciden con sumas sobre raw_match_distribution |
| TC-049 | Property | BTTS desde raw y complemento exacto | 16.6, 19.3 | Calcular btts_yes/btts_no | btts_no = 1 - btts_yes; suma dentro de epsilon |
| TC-050 | Unit | Totales por equipo desde raw | 16.7 | Calcular team_home_over_0_5 etc. | Valores correctos por sumatoria sobre raw |
| TC-051 | Unit | Clean sheets y win to nil desde raw | 16.8, 16.9 | Calcular clean_sheet_* y win_to_nil_* | Coinciden con sumatorias definidas en el spec |
| TC-052 | Unit | low_scoring_risk fórmula exacta | 16.10 | Usar matriz raw conocida | low_scoring_risk = P(0,0)+P(1,0)+P(0,1)+P(1,1) |
| TC-053 | Acceptance | top_scorelines expone top 5 ordenado | 16.11, 23.2 | Matriz raw conocida con al menos 5 scorelines distintos | top_scorelines contiene 5 scorelines ordenados por probabilidad descendente |
| TC-054 | Schema | score_model_type persiste INDEPENDENT_POISSON | 14.3, 15.4 | Persistencia de internals | score_model_type = INDEPENDENT_POISSON |
| TC-055 | Property/Regression | Reconstrucción determinística desde persistencia mínima | 14.3, 25.4 | Usar lambda_home, lambda_away, score_model_type, matrix_max_goal, tail_mass_raw | Se reconstruyen raw_match_distribution y derivados raw sin divergencia |


## E. Calibración y decision policy

| ID | Tipo | Caso | Secciones del spec | Precondiciones / Input | Resultado esperado / criterio de PASS |
|---|---|---|---|---|---|
| TC-056 | Unit | Calibración isotónica OVR + renormalización | 17.1 | Entrenamiento de calibrador sobre fold histórico | Se produce calibrated_1x2_probs y suma 1 |
| TC-057 | Acceptance | Segmentación >= 1000 partidos | 17.2 | Segmento team_domain+competition_family con 1000+ partidos | Se usa calibración segmentada |
| TC-058 | Acceptance | Segmento 300-999 partidos | 17.2 | Segmento con 300-999 partidos | Se usa calibración intermedia solo si versionada/documentada; si no, fallback global explícito |
| TC-059 | Acceptance | Segmento < 300 partidos | 17.2 | Segmento con menos de 300 partidos | Se usa calibración global |
| TC-060 | Property | calibrated_1x2_probs en [0,1] y suma 1 | 17.1, 19.1 | Cualquier salida calibrada válida | Todas las clases en rango y suma = 1 ± epsilon_probability |
| TC-061 | Property | Doble oportunidad visible deriva del calibrado | 16.3, 19.3, 19.5 | Disponibles p_home_win/p_draw/p_away_win calibrados | home_or_draw, draw_or_away, home_or_away coinciden exactamente |
| TC-062 | Property | DNB visible deriva del calibrado | 16.4, 19.4, 19.5 | p_draw no extremo | dnb_home/dnb_away cumplen fórmula y suma 1 ± epsilon cuando aplica |
| TC-063 | Acceptance | predicted_result = TOO_CLOSE | 16.12 | decision_margin < too_close_margin_threshold | predicted_result = TOO_CLOSE; predicted_result_conflict = true |
| TC-064 | Acceptance | predicted_result = argmax | 16.12 | decision_margin >= too_close_margin_threshold | predicted_result = argmax(calibrated_1x2_probs); conflict = false |
| TC-065 | Unit | favorite_margin usa calibrado sin redondear | 16.13, 19.5 | Probabilidades calibradas conocidas | favorite_margin = top1 - top2 sin redondeo |
| TC-066 | Regression | Reconstrucción de predicted_result | 16.12, 16.13 | Persistir calibrated_1x2_probs, too_close_margin_threshold, decision_policy_version | predicted_result reconstruible determinísticamente |
| TC-067 | Acceptance | Corte temporal de calibración | 17.3, 3.6 | Fold de inferencia con datos posteriores disponibles | Calibrador solo usa datos anteriores al corte |


## F. PredictionResponse y exposición

| ID | Tipo | Caso | Secciones del spec | Precondiciones / Input | Resultado esperado / criterio de PASS |
|---|---|---|---|---|---|
| TC-068 | Schema/Acceptance | FULL_MODE expone core/secondary/explainability/internals | 21, 21.3, 22 | Partido FULL_MODE típico | Todos los bloques presentes salvo nulabilidad matemática explícita como DNB indefinido |
| TC-069 | Schema/Acceptance | LIMITED_MODE permite degradación parcial | 21.3 | Partido LIMITED_MODE | core presente; secondary/explainability parcial o nulo; reasons justifica ausencia |
| TC-070 | Schema/Acceptance | NOT_ELIGIBLE bloquea probabilidades visibles | 21.1, 21.2 | Partido NOT_ELIGIBLE | predictions=null; internals sin probabilidades/lambdas/scorelines |
| TC-071 | Acceptance | Etiquetado correcto de outputs calibrados vs raw | 19.5, 19.7 | Inspección de respuesta y docs de API | Solo outputs 1X2-consistentes se presentan como calibrados |
| TC-072 | Regression | No existe referencia residual a epsilon_display | 4, 16.12 | Búsqueda estática en repo/config/tests | Cero referencias a epsilon_display |
| TC-073 | Acceptance | Persistencia separada raw_1x2_probs y calibrated_1x2_probs | 15.4, 19.5 | Inspección de internals/persistencia | Ambos bloques existen por separado |
| TC-074 | Acceptance | Prioridades de exposición compatibles con outputs reales | 22, 23.2 | Comparar lista de prioridades con schema implementado | No hay métricas u outputs priorizados que no existan en la respuesta |


## G. Competition Engine

| ID | Tipo | Caso | Secciones del spec | Precondiciones / Input | Resultado esperado / criterio de PASS |
|---|---|---|---|---|---|
| TC-075 | Integration | Ranking de grupo clásico por orden rank_by | 8.2, 18.3 | Tabla de grupo con empates y rank_by definido | Standings siguen exactamente el orden de rank_by |
| TC-076 | Integration | Head-to-head aplicado solo si configurado | 8.2 | Escenario con empate donde use_head_to_head=true y luego false | La resolución cambia solo cuando la regla está activa |
| TC-077 | Integration | Best third ranking cross-group | 8.2, 18.3 | allow_cross_group_third_ranking=true, best_thirds_count definido | Ranking cruzado correcto de terceros |
| TC-078 | Integration | Bracket mapping THIRD_PLACE_DEPENDENT | 8.2, 18.3 | mapping_table presente y terceros clasificados variables | Bracket se construye usando mapping_table exacto |
| TC-079 | Integration | League phase single table | 8.2, 18.4 | league_phase_rules con posiciones de clasificación/playoff/eliminación | Tabla y transición seeding correctas |
| TC-080 | Integration | KNOCKOUT_TWO_LEG con aggregate_state y secuencia válida | 8.4, 18.2 | SECOND_LEG empatado/agregado y second_leg_resolution_order definida | Resolución usa aggregate_state_before_match y secuencia del perfil |
| TC-081 | Integration | KNOCKOUT_SINGLE_LEG empatado a 90 | 8.4 | single_leg_resolution_order definida | Resolución sigue la secuencia configurada |
| TC-082 | Integration | Final override aplicado | 8.4 | final_overrides_prior_round_rules=true con definición de final | La final usa la secuencia especial y no la de rondas previas |
| TC-083 | Regression | No se usa heurística por nombre del torneo | 7.6, 18.3 | Torneo conocido con nombre ambiguo | Las reglas salen del profile/catálogo, no del nombre |
| TC-084 | Integration | Transición entre fases | 5.2, 18 | Resultados/standings producen clasificados | Los clasificados y emparejamientos de siguiente fase son correctos |
| TC-085 | Integration | stage_id/group_id requeridos en standings y bracket | 7.7, 5.2 | Intentar resolver standings sin stage_id/group_id requerido | Error explícito o degradación según componente; nunca resultado silencioso |
| TC-086 | Integration | Cross-group third ranking deshabilitado | 8.2 | allow_cross_group_third_ranking=false con best_thirds_count definido | El engine no realiza ranking cruzado cuando la regla lo prohíbe |


## H. Temporalidad y anti-leakage

| ID | Tipo | Caso | Secciones del spec | Precondiciones / Input | Resultado esperado / criterio de PASS |
|---|---|---|---|---|---|
| TC-087 | Acceptance | Solo partidos completados antes de kickoff_utc | 3.6, 25.5 | Dataset con partidos antes y después de T | Solo se usan partidos con timestamp < T |
| TC-088 | Acceptance | Mismo día pero posterior no se usa | 3.6 | Partido posterior del mismo día disponible | Excluido del cálculo |
| TC-089 | Acceptance | Bloque temporal ambiguo excluido | 3.6 | Fuente con granularidad limitada y partidos simultáneos ambiguos | Se excluye el bloque ambiguo completo |
| TC-090 | Acceptance | Calibración no usa datos futuros | 17.3, 25.5 | Fold de calibración con datos posteriores mezclables | Sistema los excluye |
| TC-091 | Acceptance | Walk-forward es evaluación principal | 3.5, 25.5 | Pipeline de evaluación configurable | Main evaluation = walk-forward; random split no es primario |
| TC-092 | Regression | Ratings/standings/calibration no se reconstruyen con futuro | 3.6 | Backtest con snapshots temporales | Snapshots previos no cambian por datos futuros |
| TC-093 | Acceptance | Accuracy anormalmente alta dispara auditoría | 24.1, 24.4 | predicted_result_accuracy > 0.60 en STRONG | Se abre revisión técnica/auditoría |
| TC-094 | Integration | Simultaneous kickoff leakage guard | 3.6, 12 | Partidos con mismo kickoff en fuente de granularidad fina y gruesa | Guard se adapta a granularidad confiable y reporta leakage_guard_passed consistentemente |


## I. Métricas, reporting y aceptación

| ID | Tipo | Caso | Secciones del spec | Precondiciones / Input | Resultado esperado / criterio de PASS |
|---|---|---|---|---|---|
| TC-095 | Acceptance | Baseline A segmentado y con fallback | 23.1 | Dataset con segmentos >=300 y <300 | Baseline A usa segmentación team_domain+competition_family+neutral_venue con fallback documentado |
| TC-096 | Acceptance | Baseline B = Elo puro | 23.1 | Evaluación comparativa | Existe baseline B sin capa de goles ni calibración |
| TC-097 | Acceptance | Reporting completo de accuracy y cobertura | 23.2 | Pipeline de reporting | Reporta inclusive_accuracy, conditional_accuracy, too_close_rate, effective_prediction_coverage |
| TC-098 | Acceptance | Prohibido reportar solo conditional_accuracy | 23.2 | Forzar salida parcial de métricas | El reporte falla o se marca incompleto si falta cobertura |
| TC-099 | Acceptance | top_5_scoreline_coverage alineado con top_scorelines | 23.2, 16.11 | Salida expone top_scorelines | Métrica usa exactamente top 5 |
| TC-100 | Acceptance | Calibración por buckets solo con muestra suficiente | 24.1, 4.3 | Buckets con y sin min_bucket_sample_for_calibration_eval | Solo se evalúan/aceptan buckets con muestra suficiente |
| TC-101 | Acceptance | Thresholds STRONG | 24.1 | Evaluación en contexto STRONG | Cumple accuracy/log_loss/brier/coverage/scoreline/calibration o falla aceptación |
| TC-102 | Acceptance | Thresholds CAUTION | 24.2 | Evaluación en contexto CAUTION | Cumple accuracy/log_loss/brier/coverage/scoreline o falla aceptación |
| TC-103 | Acceptance | WEAK no se vende como benchmark principal | 24.3 | Evaluación en contexto WEAK | Outputs marcados débiles/degradados; no presentados como predicción fuerte |
| TC-104 | Acceptance | Triggers de auditoría adicionales | 24.4 | Escenarios: calibración empeora, Full cae a Limited, coverage cae, invariantes rotos | Sistema abre revisión técnica |
| TC-105 | Conformance | Consistencia cruzada schema + fórmulas + reglas | 21, 16, 19, 21.3, 26 | Auditoría de artefactos y tests | No hay contradicciones entre contrato de salida, fórmulas, invariantes y reglas operativas |


---

# 8. Gates de ejecución por fase

## Gate G1 — Contratos y validación estructural
Debe quedar probado con los casos:
- `TC-001` a `TC-024`
- `TC-025` a `TC-040`
- `TC-068` a `TC-074`

No se habilita implementación integrada si falla cualquier caso que permita estados imposibles o `NOT_ELIGIBLE` mal expuesto.

## Gate G2 — Motor predictivo raw + calibración visible
Debe quedar probado con los casos:
- `TC-041` a `TC-067`

No se habilita integración completa si:
- DNB o doble oportunidad salen de raw;
- overs/BTTS/scorelines salen del calibrado;
- la reconstrucción determinística falla;
- se renormaliza en silencio con `tail_mass_raw > max_tail_mass_raw`.

## Gate G3 — Competition Engine
Debe quedar probado con los casos:
- `TC-075` a `TC-086`

No se habilita release si `KnockoutResolutionRules` admite combinaciones ambiguas o si la lógica depende del nombre libre del torneo.

## Gate G4 — Temporalidad y métricas
Debe quedar probado con los casos:
- `TC-087` a `TC-105`

No se habilita freeze si:
- existe leakage temporal;
- la evaluación principal no es walk-forward;
- el reporting omite cobertura;
- el sistema incumple umbrales del spec en contextos STRONG/CAUTION.

---

# 9. Checklist final del auditor

El auditor final debe marcar **PASS** solo si puede confirmar todo esto:

- [ ] No queda ninguna referencia a `epsilon_display`.
- [ ] `p_home_win`, `p_draw`, `p_away_win`, dobles oportunidades y DNB derivan del calibrado visible.
- [ ] xG, totals, BTTS, team totals, clean sheets, win to nil, low scoring risk y scorelines derivan del raw.
- [ ] `KnockoutResolutionRules` es secuencial, sin flags ambiguos.
- [ ] `prior_rating` usa `prior_rating_max_age_days`, `prior_rating_min_updates_last_730d` y `prior_rating_cross_season_carry_allowed`.
- [ ] `PredictionResponse`, fórmulas, invariantes y reglas operativas dicen exactamente lo mismo.
- [ ] `NOT_ELIGIBLE` no expone probabilidades visibles.
- [ ] `top_scorelines` y `top_5_scoreline_coverage` están alineados.
- [ ] `predicted_result` es reconstruible desde `calibrated_1x2_probs`, `too_close_margin_threshold` y `decision_policy_version`.
- [ ] La evaluación principal es walk-forward y no usa datos futuros.

---

# 10. Criterio de cierre del proyecto de implementación

La implementación del motor predictivo v1.3 puede etiquetarse como:

**`SportPulse Predictive Engine v1.3 — Implementación conforme al spec congelado`**

solo si:
- todos los casos críticos pasan;
- no quedan bugs abiertos de severidad alta sobre contratos, matemática, temporalidad o competition rules;
- el auditor final emite **PASS** sin excepciones.

Si no se cumple eso, la implementación no está cerrada aunque compile.
