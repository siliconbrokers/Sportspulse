\# Motor Predictivo V2 — Spec Final Congelada

\#\# 1\. Objetivo

Estimar para cada partido:

\- \`lambda\_home\`  
\- \`lambda\_away\`  
\- \`P(home\_win)\`  
\- \`P(draw)\`  
\- \`P(away\_win)\`

usando un modelo basado en:

\- ataque / defensa separados  
\- contexto local / visitante  
\- prior estructural del club  
\- fallback robusto cuando falta historia  
\- ajuste por rival  
\- recencia  
\- shrinkage dinámico  
\- Poisson independiente como generador de probabilidades

\---

\#\# 2\. Alcance

\#\#\# Entra al core del modelo  
\- GF y GC por partido  
\- separación total / local / visitante  
\- prior ofensivo y defensivo del club  
\- baseline de liga  
\- ajuste por fuerza del rival  
\- recencia como desviación reciente  
\- tamaño de muestra  
\- localía a través del baseline contextual de liga

\#\#\# No entra al core  
\- posición en tabla  
\- flag manual de “equipo grande”  
\- Elo  
\- puntos como driver principal  
\- rachas visuales  
\- clean sheets  
\- failed to score  
\- features de UI

\---

\#\# 3\. Universo de datos válido

Para un partido objetivo, solo se pueden usar partidos:

\- de la \*\*misma competencia\*\*  
\- de la \*\*misma temporada\*\*  
\- \*\*anteriores\*\* al kickoff del partido objetivo

\#\#\# Excepción permitida  
Para construir el \*\*prior estructural\*\*, se puede usar:

\- temporada anterior de la misma competencia  
\- fuente equivalente explícitamente degradada  
\- baseline neutro de liga si no existe historia útil

\#\#\# Prohibido  
\- usar partidos futuros  
\- mezclar competencias distintas en el core actual  
\- mezclar temporadas sin política explícita de prior  
\- usar strings visuales de forma como input crudo

\---

\#\# 4\. Inputs mínimos requeridos

\#\#\# 4.1 Para cada equipo  
\- \`PJ\_total\`  
\- \`PJ\_home\`  
\- \`PJ\_away\`  
\- \`GF\_total\`  
\- \`GC\_total\`  
\- \`GF\_home\`  
\- \`GC\_home\`  
\- \`GF\_away\`  
\- \`GC\_away\`

\#\#\# 4.2 Para el histórico reciente de partidos  
\- fecha  
\- rival  
\- condición local / visitante  
\- goles a favor  
\- goles en contra

\#\#\# 4.3 Para la competencia  
\- \`league\_home\_goals\_pg\`  
\- \`league\_away\_goals\_pg\`  
\- \`league\_goals\_pg\`

\---

\#\# 5\. Tasas observadas base

Para cada equipo:

\`\`\`text  
gf\_pg\_total \= GF\_total / PJ\_total  
gc\_pg\_total \= GC\_total / PJ\_total

gf\_pg\_home \= GF\_home / PJ\_home  
gc\_pg\_home \= GC\_home / PJ\_home

gf\_pg\_away \= GF\_away / PJ\_away  
gc\_pg\_away \= GC\_away / PJ\_away

Interpretación

* `gf` mide capacidad ofensiva

* `gc` mide debilidad defensiva

Conceder más goles \= peor defensa.

---

6\. Prior estructural del club

Este componente existe para evitar el error de tratar a todos los equipos como si arrancaran iguales al inicio del torneo.

6.1 Variables de prior

Para cada equipo, mantener:

* `attack_prior_total`

* `defense_prior_total`

* `attack_prior_home`

* `defense_prior_home`

* `attack_prior_away`

* `defense_prior_away`

6.2 Calidad del prior

* `HIGH`

* `MEDIUM`

* `LOW`

* `NONE`

6.3 Fuente del prior

* `PREV_SEASON`

* `PARTIAL`

* `LOWER_DIVISION`

* `LEAGUE_BASELINE`

6.4 Regla fundamental

La ausencia de temporada anterior **no invalida el modelo**.  
 Solo degrada el prior y baja la confianza.

6.5 Construcción del prior si hay temporada previa utilizable  
attack\_prior\_total \=  
 alpha\_prev \* prev\_attack\_total \+  
 (1 \- alpha\_prev) \* league\_goals\_pg

defense\_prior\_total \=  
 alpha\_prev \* prev\_defense\_total \+  
 (1 \- alpha\_prev) \* league\_goals\_pg

Para home / away se mezcla contra el baseline contextual correspondiente:

* `attack_prior_home` con `league_home_goals_pg`

* `defense_prior_home` con `league_away_goals_pg`

* `attack_prior_away` con `league_away_goals_pg`

* `defense_prior_away` con `league_home_goals_pg`

6.6 Valor inicial recomendado  
alpha\_prev \= 0.70

6.7 Equipos ascendidos

Si el prior viene de división inferior:

prior\_promoted \=  
 d\_promoted \* prior\_lower\_division \+  
 (1 \- d\_promoted) \* league\_baseline\_top\_division

Valor inicial recomendado:

d\_promoted \= 0.40

6.8 Sin historia útil

Si no hay prior:

attack\_prior\_\*  \= baseline de liga correspondiente  
defense\_prior\_\* \= baseline de liga correspondiente  
prior\_quality \= NONE  
prior\_source \= LEAGUE\_BASELINE

El modelo sigue funcionando. No inventa jerarquía.

---

7\. Shrinkage dinámico de tres niveles

La lógica correcta es:

contexto \-\> total equipo \-\> prior club \-\> baseline liga

7.1 Pesos dinámicos por muestra  
w\_total \= PJ\_total / (PJ\_total \+ K\_total)  
w\_home  \= PJ\_home  / (PJ\_home  \+ K\_home)  
w\_away  \= PJ\_away  / (PJ\_away  \+ K\_away)

Valores iniciales recomendados:

K\_total \= 5  
K\_home  \= 4  
K\_away  \= 4

7.2 Tasas ofensivas efectivas

Para el local

obs\_attack\_home \=  
 w\_home \* gf\_pg\_home \+  
 (1 \- w\_home) \* gf\_pg\_total  
effective\_attack\_home \=  
 w\_total \* obs\_attack\_home \+  
 (1 \- w\_total) \* attack\_prior\_home

Para el visitante

obs\_attack\_away \=  
 w\_away \* gf\_pg\_away \+  
 (1 \- w\_away) \* gf\_pg\_total  
effective\_attack\_away \=  
 w\_total \* obs\_attack\_away \+  
 (1 \- w\_total) \* attack\_prior\_away

7.3 Tasas defensivas efectivas

Para el local

obs\_defense\_home \=  
 w\_home \* gc\_pg\_home \+  
 (1 \- w\_home) \* gc\_pg\_total  
effective\_defense\_home \=  
 w\_total \* obs\_defense\_home \+  
 (1 \- w\_total) \* defense\_prior\_home

Para el visitante

obs\_defense\_away \=  
 w\_away \* gc\_pg\_away \+  
 (1 \- w\_away) \* gc\_pg\_total  
effective\_defense\_away \=  
 w\_total \* obs\_defense\_away \+  
 (1 \- w\_total) \* defense\_prior\_away  
---

8\. Ajuste por rival

Sin esto, las métricas quedan sesgadas por calendario.

8.1 Idea

Cada partido reciente debe evaluarse contra lo esperable del rival.

Señal ofensiva por partido

attack\_signal\_match \=  
 goals\_scored / opponent\_defense\_baseline\_relevant

Señal defensiva por partido

defense\_signal\_match \=  
 goals\_conceded / opponent\_attack\_baseline\_relevant

8.2 Qué baseline del rival usar

Usar el mejor disponible en este orden:

1. tasa efectiva del rival en la temporada actual

2. prior del rival

3. baseline de liga

Esto permite robustez aun cuando el rival también tenga poca muestra.

---

9\. Recencia

La forma no entra como “últimos 5 goles crudos”.  
 Entra como **desviación reciente respecto a expectativa**.

9.1 Ventana

Usar los últimos 5 partidos válidos previos del equipo.

9.2 Pesos

Del más reciente al más viejo:

5, 4, 3, 2, 1

9.3 Construcción

Ajuste ofensivo reciente

recent\_attack\_delta \=  
 weighted\_avg(attack\_signal\_match)

Ajuste defensivo reciente

recent\_defense\_delta \=  
 weighted\_avg(defense\_signal\_match)

9.4 Interpretación

* `1.00` \= rinde como esperado

* `> 1.00` \= mejor ofensivamente / más débil defensivamente, según contexto

* `< 1.00` \= peor ofensivamente / más sólida defensivamente, según contexto

9.5 Shrinkage de recencia  
w\_form \= N\_recent / (N\_recent \+ K\_form)

Valor inicial recomendado:

K\_form \= 6  
effective\_recent\_attack\_delta \=  
 w\_form \* recent\_attack\_delta \+ (1 \- w\_form) \* 1.0

effective\_recent\_defense\_delta \=  
 w\_form \* recent\_defense\_delta \+ (1 \- w\_form) \* 1.0

El valor neutro es `1.0`.

---

10\. Construcción final de fuerzas efectivas

Local

* ataque base \= `effective_attack_home`

* defensa base \= `effective_defense_home`

* recencia ofensiva \= `effective_recent_attack_delta_home`

* recencia defensiva \= `effective_recent_defense_delta_home`

Visitante

* ataque base \= `effective_attack_away`

* defensa base \= `effective_defense_away`

* recencia ofensiva \= `effective_recent_attack_delta_away`

* recencia defensiva \= `effective_recent_defense_delta_away`

---

11\. Formulación de lambdas

La construcción debe ser multiplicativa y coherente con escala log.

11.1 Fórmula  
lambda\_home \=  
 league\_home\_goals\_pg  
 \* (effective\_attack\_home / league\_home\_goals\_pg) ^ beta\_attack  
 \* (effective\_defense\_away / league\_home\_goals\_pg) ^ beta\_defense  
 \* (effective\_recent\_attack\_delta\_home) ^ beta\_recent\_attack  
 \* (effective\_recent\_defense\_delta\_away) ^ beta\_recent\_defense  
lambda\_away \=  
 league\_away\_goals\_pg  
 \* (effective\_attack\_away / league\_away\_goals\_pg) ^ beta\_attack  
 \* (effective\_defense\_home / league\_away\_goals\_pg) ^ beta\_defense  
 \* (effective\_recent\_attack\_delta\_away) ^ beta\_recent\_attack  
 \* (effective\_recent\_defense\_delta\_home) ^ beta\_recent\_defense

11.2 Parámetros iniciales recomendados  
beta\_attack \= 1.00  
beta\_defense \= 1.00  
beta\_recent\_attack \= 0.35  
beta\_recent\_defense \= 0.35

11.3 Guardrail final  
lambda\_min \= 0.15  
lambda\_max \= 3.50

Aplicar clamp final.  
 Si el modelo vive tocando el clamp, el problema está aguas arriba.

---

12\. Probabilidades 1X2

Usar Poisson independiente.

12.1 Matriz de scores

Calcular probabilidad para:

* goles local `0..8`

* goles visitante `0..8`

12.2 Agregación  
P(home\_win) \= suma de celdas donde h \> a  
P(draw)     \= suma de celdas donde h \= a  
P(away\_win) \= suma de celdas donde h \< a

12.3 Normalización

Si la truncación de la grilla pierde masa, renormalizar.

---

13\. Elegibilidad

La elegibilidad no depende del prior.

NOT\_ELIGIBLE

* alguno de los equipos tiene menos de 3 partidos actuales

* o faltan baselines de liga

* o faltan datos estructurales básicos

LIMITED

* algún equipo tiene 3 o 4 partidos actuales

* hay baselines suficientes

* el modelo puede correr, pero con baja base empírica

ELIGIBLE

* ambos equipos tienen 5 o más partidos actuales

* baselines presentes

* datos estructurales completos

---

14\. Confianza

Debe ser continua en lógica, aunque la salida final sea categórica.

Factores que la componen

* muestra actual total

* muestra local / visitante

* calidad del prior

* cobertura de recencia

* calidad del ajuste por rival

Salida mínima

* `HIGH`

* `MEDIUM`

* `LOW`

* `INSUFFICIENT`

Regla conceptual

Un partido puede ser:

* `ELIGIBLE`

* pero `confidence = LOW`

Y eso es válido.

---

15\. Política de arranque de temporada

No usar reglas tontas del tipo “a partir de la fecha 5 ya está”.

Política

* `< 3 partidos`: no elegible

* `3–4`: limitado

* `5+`: elegible

Después, el peso del observado sigue creciendo dinámicamente con:

w \= n / (n \+ K)

Entonces:

* al principio manda más prior y liga

* luego manda más el observado

* sin saltos artificiales

---

16\. Output obligatorio

{  
 "engine\_version": "v2\_structural\_attack\_defense",  
 "eligibility\_status": "ELIGIBLE | LIMITED | NOT\_ELIGIBLE",  
 "confidence\_level": "HIGH | MEDIUM | LOW | INSUFFICIENT",  
 "prior\_quality": "HIGH | MEDIUM | LOW | NONE",  
 "prior\_source": "PREV\_SEASON | PARTIAL | LOWER\_DIVISION | LEAGUE\_BASELINE",  
 "lambda\_home": 0.0,  
 "lambda\_away": 0.0,  
 "prob\_home\_win": 0.0,  
 "prob\_draw": 0.0,  
 "prob\_away\_win": 0.0,  
 "explanation": {  
   "effective\_attack\_home": 0.0,  
   "effective\_defense\_home": 0.0,  
   "effective\_attack\_away": 0.0,  
   "effective\_defense\_away": 0.0,  
   "recent\_attack\_delta\_home": 0.0,  
   "recent\_defense\_delta\_home": 0.0,  
   "recent\_attack\_delta\_away": 0.0,  
   "recent\_defense\_delta\_away": 0.0,  
   "sample\_size\_effect": "LOW | MEDIUM | HIGH",  
   "rival\_adjustment\_used": true,  
   "recent\_form\_used": true  
 }  
}  
---

17\. Validación obligatoria

Si se implementa sin medir, sigue siendo religión.

Métricas mínimas

* Log Loss 1X2

* Brier Score 1X2

* calibración por buckets

* draw rate predicho vs draw rate real

* promedio de `lambda_home + lambda_away` vs promedio real de goles

* accuracy del outcome principal

Tipo de validación

* walk-forward temporal

* siempre entrenar / calibrar con pasado y evaluar en futuro

* cero leakage

---

18\. Limitaciones aceptadas de esta V2

Para ser explícitos:

* usa Poisson independiente

* no corrige todavía correlación fina de goles

* no implementa Dixon-Coles todavía

* no usa xG, lesiones, cuotas, alineaciones ni mercado

Eso no invalida V2. Solo define su techo actual.

---

19\. Criterios de aceptación

La V2 queda aceptada solo si:

* no usa Elo en el core

* no usa “equipo grande” como bonus manual

* usa ataque y defensa separados

* usa local / visitante separados

* usa prior estructural con fallback

* si falta temporada anterior, no rompe el modelo

* usa shrinkage dinámico

* ajusta por rival

* usa recencia como desviación, no como duplicado bruto

* genera `lambda_home` y `lambda_away` asimétricas

* separa predicción, elegibilidad y confianza

* devuelve `prior_quality` y `prior_source`

* pasa validación temporal básica

