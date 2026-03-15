\[MOTOR\_PREDICTIVO\_V2\_SPEC\_FINAL\_CONGELADA.md\]

Tu tarea NO es extender el modelo, ni mejorarlo, ni rediseñarlo. Tu tarea es detectar si la implementación realmente respeta la spec o si hay desviaciones, atajos, omisiones, errores conceptuales o incoherencias matemáticas.

Tienes que actuar como auditor técnico hostil. Asume que la implementación puede parecer correcta por fuera pero estar mal por dentro.

\#\# Objetivo

Verificar si la implementación del motor predictivo V2:

\- respeta la spec  
\- no introdujo drift conceptual  
\- no simplificó partes importantes sin declararlo  
\- no reintrodujo Elo o heurísticas prohibidas  
\- no mezcla explicación con señal predictiva  
\- no usa datos futuros  
\- no hace leakage temporal  
\- no dejó partes críticas como pseudocódigo disfrazado  
\- produce outputs coherentes y auditables

\#\# Modo de trabajo

No me des una reseña amable.  
No me digas que “en general está bien”.  
Quiero una auditoría destructiva y precisa.

Primero busca fallos.  
Después inconsistencias.  
Después riesgos.  
Después recién di qué está correcto.

\#\# Qué debes auditar

\#\#\# 1\. Fidelidad a la spec  
Verifica punto por punto si se implementó realmente:

\- tasas observadas base  
\- prior estructural del club  
\- fallback cuando no hay temporada anterior  
\- prior\_quality  
\- prior\_source  
\- shrinkage dinámico  
\- ajuste por rival  
\- recencia como desviación reciente  
\- lambdas asimétricas  
\- Poisson independiente  
\- elegibilidad  
\- confianza  
\- output final completo  
\- validación mínima y tests

Marca explícitamente:  
\- IMPLEMENTADO  
\- PARCIAL  
\- NO IMPLEMENTADO  
\- IMPLEMENTADO PERO MAL

\#\#\# 2\. Drift conceptual  
Busca si la implementación se apartó de la spec en cosas como:

\- volvió a meter Elo en el core  
\- agregó bonus por “equipo grande”  
\- usó posición en tabla o puntos como driver principal  
\- convirtió recencia en goles crudos recientes  
\- omitió ajuste por rival  
\- redujo shrinkage a una forma demasiado simplificada  
\- hizo simétricas las lambdas  
\- mezcló prior con observed de forma inconsistente  
\- hizo binaria una política que debía ser dinámica

\#\#\# 3\. Calidad matemática  
Revisa si la formulación realmente respeta la intención matemática:

\- construcción multiplicativa / log-coherente de lambdas  
\- uso correcto de tasas ofensivas y defensivas  
\- sentido correcto de GC como debilidad defensiva  
\- shrinkage con pesos bien aplicados  
\- fallback de prior robusto  
\- recent deltas centrados en 1.0  
\- Poisson bien implementada  
\- renormalización si la grilla truncada pierde masa  
\- clamp final solo como guardrail, no como muleta constante

\#\#\# 4\. Calidad de datos y causalidad temporal  
Revisa si hay errores como:

\- usar partidos posteriores al objetivo  
\- leakage temporal  
\- mezclar temporadas sin control  
\- mezclar competencias en el core  
\- usar baseline rival contaminado con información futura  
\- construir forma con partidos no válidos

\#\#\# 5\. Integración real  
Verifica si el motor V2 quedó realmente integrado o si solo agregaron código muerto.

Busca:  
\- funciones no conectadas  
\- paths que siguen usando V1 por defecto  
\- outputs nuevos no consumidos  
\- contratos rotos  
\- outputs incompletos  
\- ramas que nunca se ejecutan  
\- código sin tests reales

\#\#\# 6\. Tests  
Audita si los tests realmente cubren lo importante o si son maquillaje.

Verifica cobertura real de:  
\- fallback sin temporada anterior  
\- prior\_quality y prior\_source  
\- promoted / lower division si aplica  
\- shrinkage dinámico  
\- recencia con pesos 5,4,3,2,1  
\- rival adjustment  
\- cálculo de lambdas  
\- probabilidades que sumen \~1  
\- ELIGIBLE / LIMITED / NOT\_ELIGIBLE  
\- casos edge  
\- ausencia de Elo en el core path

\#\# Cómo debes reportar

Quiero la salida en este formato exacto:

\#\#\# A. Resumen ejecutivo  
\- juicio general: APROBABLE / NO APROBABLE / APROBABLE CON RIESGOS SERIOS  
\- motivo breve

\#\#\# B. Top 10 fallos más graves  
Lista priorizada de los principales problemas encontrados.  
Para cada uno, indica:  
\- severidad: CRÍTICO / ALTO / MEDIO / BAJO  
\- qué parte rompe  
\- por qué importa  
\- cómo corregirlo

\#\#\# C. Matriz de cumplimiento de spec  
Para cada bloque relevante de la spec, marca:  
\- IMPLEMENTADO  
\- PARCIAL  
\- NO IMPLEMENTADO  
\- IMPLEMENTADO PERO MAL

Y explica en 1–3 líneas por bloque.

\#\#\# D. Hallazgos de drift conceptual  
Lista explícita de cualquier desviación de diseño.

\#\#\# E. Hallazgos matemáticos  
Errores de formulación, incoherencias, doble conteo, mala escala, etc.

\#\#\# F. Hallazgos de datos / temporalidad  
Fugas, mezclas indebidas, contaminación temporal, etc.

\#\#\# G. Hallazgos de integración  
Código muerto, rutas no usadas, contratos inconsistentes, etc.

\#\#\# H. Hallazgos de testing  
Tests ausentes, superficiales o engañosos.

\#\#\# I. Veredicto final  
Una conclusión clara:  
\- si esto puede aceptarse tal como está,  
\- si requiere correcciones obligatorias,  
\- o si debe rechazarse.

\#\#\# J. Lista exacta de correcciones obligatorias  
Checklist accionable, priorizado.

\#\# Reglas duras de auditoría

\- No asumas que algo está bien solo porque el nombre de la función suena correcto.  
\- Si una parte crítica está escondida detrás de abstracciones, ábrela y verifícala.  
\- Si algo parece correcto pero no está testeado, considéralo de riesgo.  
\- Si hay ambigüedad entre intención y código, manda el código real.  
\- Si detectas una simplificación no declarada, trátala como incumplimiento.  
\- Si una parte de la spec no existe en código ejecutable, es NO IMPLEMENTADO.  
\- Si hay código agregado pero no conectado, cuenta como NO IMPLEMENTADO a efectos prácticos.

\#\# Criterio de severidad

\#\#\# CRÍTICO  
Rompe la lógica del modelo, viola la spec central o contamina el resultado.

\#\#\# ALTO  
No rompe todo, pero compromete seriamente calidad, robustez o fidelidad.

\#\#\# MEDIO  
Desviación relevante, pero corregible sin rediseñar todo.

\#\#\# BAJO  
Detalle menor, naming, claridad, o mejora no estructural.

\#\# Qué está explícitamente prohibido aprobar por alto

No apruebes si ocurre cualquiera de estas:

\- Elo sigue influyendo en el core V2  
\- hay “big club bonus” manual o equivalente  
\- no existe fallback real sin temporada anterior  
\- no existe ajuste por rival real  
\- la recencia es solo goles crudos recientes  
\- las lambdas no son realmente asimétricas  
\- hay leakage temporal  
\- el output obligatorio está incompleto  
\- la implementación es mayormente pseudocódigo o wiring sin uso real

Empieza ahora auditando:  
1\. estructura de archivos tocados,  
2\. contrato real del motor,  
3\. core path de cálculo,  
4\. tests,  
y luego produce el informe completo.  
