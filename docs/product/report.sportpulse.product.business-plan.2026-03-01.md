---
artifact_id: REPORT-SPORTPULSE-PRODUCT-BUSINESS-PLAN-2026-03
title: "Business Plan v3.0 (March 2026) — Versión Canónica"
artifact_class: report
status: active
version: 3.0.0
project: sportpulse
domain: product
slug: business-plan
owner: team
created_at: 2026-03-15
updated_at: 2026-03-16
supersedes: ["SPEC-SPORTPULSE-PRODUCT-MVP-STRATEGIC-BRIEF", "SPEC-SPORTPULSE-PRODUCT-MVP-ONE-PAGER"]
superseded_by: []
related_artifacts: []
canonical_path: docs/product/report.sportpulse.product.business-plan.2026-03-01.md
---
# SportsPulse — Plan de Negocio
**Versión 3.0 — Marzo 2026**

> **Nota metodológica:** Este plan separa explícitamente hechos verificados, supuestos plausibles e inferencias especulativas. Cada cifra económica material tiene fórmula y fuente identificada. Las líneas de ingresos están ordenadas por nivel de certeza. El caso base descansa únicamente en suscripción Pro — ninguna línea secundaria lo sostiene.

---

> **VERSIÓN CANÓNICA — 2026-03-16**
> Este documento es la versión canónica vigente del business plan de SportsPulse. Reemplaza todas las iteraciones previas, borradores mergeados y versiones parciales generadas durante el proceso de revisión de marzo 2026. Ninguna versión anterior tiene validez de referencia para trabajo futuro.
>
> **Freeze de alcance:**
> — El caso base descansa en suscripción Pro. Ninguna otra línea lo sostiene.
> — Creator/API, afiliación a streaming no-betting y B2B/media son extensiones plausibles o upside condicional. No entran al caso base.
> — Este documento no debe reinterpretarse para reabrir líneas betting-adjacent, prediction-market, exchange-like o props monetizados sin un análisis estratégico nuevo y explícito que lo autorice.

---

## 1. Resumen Ejecutivo

### Qué es SportsPulse

SportsPulse es una plataforma de análisis predictivo de fútbol para el fanático hispanohablante. Combina un dashboard de atención (qué equipos merecen seguimiento hoy y por qué) con predicciones de partido respaldadas por track record histórico verificable. El modelo es freemium: probabilidades 1X2 libres, profundidad analítica (scoreline, xG, explicación del modelo, historial por equipo) en plan Pro.

### Qué problema resuelve

El mercado de predicciones deportivas hispanohablante está dominado por apps genéricas sin capa analítica, tipsters sin historial verificable, y plataformas que financian predicciones con afiliación a casas de apuestas. No existe una fuente independiente, en español, con track record público auditable. Ese vacío estructural es la oportunidad.

### Para quién

Tres perfiles con diferente disposición a pagar: (1) el fanático analítico quemado por tipsters, que convierte cuando verifica que el modelo acertó algo que siguió; (2) el fanático casual que quiere relevancia editorial rápida; (3) el usuario que apuesta con seriedad y busca señal independiente del mercado. El tercero probablemente tiene la mayor tasa de conversión a Pro.

### El activo central — lo que no se puede fabricar con dinero

No es la UI ni el volumen de datos. Es el **track record acumulado por liga**: predicciones con timestamp anterior al partido, historial de aciertos y errores verificable públicamente, metodología auditable. Ese historial solo existe si se empezó a construir antes. Cada partido evaluado fortalece una ventaja competitiva acumulativa que no puede construirse rápidamente desde cero. FlashScore con 155M usuarios no puede comprar tres años de predicciones verificadas en Copa Libertadores.

### Lógica económica

**[HECHO]** El modelo principal es freemium SaaS — suscripción Pro. Es la única línea con sustento externo suficiente para sostener el caso base.

**[HECHO]** Break-even: ~200 suscriptores Pro × USD 4.75 neto = USD 950/mes vs USD 500-700 de costos operativos actuales.

**[SUPUESTO — plausible, no validado]** Conversión 2.5-5% de usuarios registrados a Pro. Fuente: RevenueCat 2025 (mediana industria 2.18%). La conversión específica de SportsPulse no está medida aún.

**[SUPUESTO — especulativo]** 35.000-80.000 usuarios registrados a 18 meses. No hay modelo de adquisición validado. Depende de tracción orgánica, SEO y efecto Copa del Mundo.

### Proyecciones — fórmula explícita

`MRR = Usuarios_Reg × P_conversion × ARPPU_neto`

Donde `ARPPU_neto` = precio ponderado bruto (~$5.20) × (1 − fee_efectivo_Stripe ~8.5%) ≈ **$4.75/mes**

> **Nota metodológica — supuesto de fees:** el 8.5% es un supuesto blended prudente para planificación. Refleja una mezcla de cobros web (Stripe: ~2.9% + $0.30/tx, equivalente a ~5-7% en tickets $4-8) y una fracción de pagos vía iOS/Android (30% store fee). Mientras el volumen sea mayoritariamente web, el neto real podría ser levemente superior ($4.95-5.05). A medida que aumente el mix móvil, el neto podría comprimirse. El 8.5% es el supuesto conservador unificado para todo el plan.

| Escenario | Usuarios Reg. | Conversión | Suscriptores Pro | MRR neto |
|-----------|--------------|-----------|-----------------|----------|
| Conservador | 35.000 | 2.5% | 875 | **USD 4.156** |
| Base | 55.000 | 3.5% | 1.925 | **USD 9.144** |
| Optimista | 80.000 | 5.0% | 4.000 | **USD 19.000** |

> Versiones anteriores usaban $5.50 ARPPU sin deducción de fees. Los valores corregidos son ~14% menores. El negocio sigue siendo rentable — el break-even no cambia.

> **Sensibilidad crítica:** si conversión cae de 3.5% a 2.5% (−29%), MRR base cae a $4.156. Si usuarios registrados quedan en 20.000 en lugar de 55.000 (escenario pesimista), MRR base a 3.5% = $3.325. Ambos escenarios siguen siendo rentables, pero con escala pequeña.

### Qué NO es SportsPulse

- No es app de scores en tiempo real (no compite en eso)
- No es plataforma de apuestas, ni tipster, ni genera ingresos por afiliación a casas de apuestas
- No es red social deportiva ni portal de noticias
- No es exchange ni prediction market con dinero real
- No está diseñado para Brasil en esta etapa

---

## 2. El Problema

### 2.1 El fanático de fútbol hispanohablante está mal servido

El fanático moderno enfrenta una paradoja: nunca hubo tanta información disponible sobre fútbol, y sin embargo encontrar **lo que importa ahora** es cada vez más difícil.

Las apps existentes ofrecen resultados en tiempo real, estadísticas históricas sin contexto de relevancia, noticias sin filtro de importancia, y predicciones opacas cuando existen — a menudo influenciadas por afiliación a casas de apuestas.

Lo que no existe en el mercado, especialmente en español:
- Un sistema que diga explícitamente **qué equipo merece atención hoy y por qué**
- Un motor predictivo que muestre su **accuracy histórico real**
- Alertas que den **contexto**, no solo notificaciones de gol
- Un producto que trate al fanático como alguien inteligente, no como un objetivo de apuestas

Las mejores herramientas analíticas deportivas (Opta, StatsBomb, la capa analítica de SofaScore) están diseñadas en inglés para mercados angloparlantes. No existe el equivalente de The Athletic en datos para el fanático hispanohablante. Ese vacío es la oportunidad.

### 2.2 El problema de las casas de apuestas como árbitro de predicciones

La mayoría de las plataformas de predicción deportiva están financiadas o influenciadas por casas de apuestas. Esto crea un conflicto de interés estructural. SportsPulse puede ocupar el espacio de **fuente independiente y verificable** — un activo que, una vez establecido, es difícil de replicar.

### 2.3 El problema del registro sin propuesta de valor

Las apps que piden registro al llegar pierden entre el 60% y el 80% de los usuarios antes de que experimenten el producto. La solución es **demorar el pedido de registro hasta que el usuario haya visto algo que vale la pena guardar**.

---

## 3. Usuarios Objetivo — Tres Personas

### Persona 1 — El analítico quemado por tipsters

**Perfil:** 25-40 años. Sigue fútbol con seriedad. Ha pagado por picks de tipsters en Twitter/X y fue defraudado. Desconfía de cualquier predicción que no muestra su historial. Cuando ve "90% de accuracy" en cualquier plataforma, cierra la pestaña.

**Motivación:** quiere señal verificable, no opinión. Le importa el intervalo de confianza tanto como el resultado predicho. Lee el error explicado del lunes y lo valora más que 10 aciertos en fila.

**Comportamiento:** sesiones largas en DetailPanel. Navega el historial de accuracy. Comparte las predicciones contraintuitivas que salen bien. Es el usuario que genera boca a boca de calidad.

**Conversión:** convierte después del Acto 2 del aha moment — cuando verificó que el modelo acertó algo que siguió. El track record público es el gatillo. Alta retención post-conversión.

### Persona 2 — El fanático casual

**Perfil:** 20-45 años. Sigue a su equipo y a la liga local. No le interesan los modelos ni la estadística — le interesa saber qué va a pasar este fin de semana y por qué su equipo merece atención hoy.

**Motivación:** relevancia editorial rápida. El treemap le dice en 3 segundos a qué partido vale la pena prestarle atención. El resultado más probable le da un marco para el partido. No necesita más profundidad que eso.

**Comportamiento:** sesiones cortas y frecuentes. Alta correlación con días de partido. Retención difícil en semanas sin partidos relevantes de su equipo.

**Conversión:** más difícil. Convierte si el partido de su equipo favorito tiene algo en juego y el modelo dice algo que lo sorprende. El "lunes de accuracy" no le interesa. La alerta de contexto pre-partido sí.

### Persona 3 — El usuario apostador que busca señal independiente

**Perfil:** 25-50 años. Apuesta con cierta seriedad — no recreativo, no profesional. Usa múltiples fuentes antes de cada decisión. Desconfía de las casas de apuestas como fuente de señal porque sabe que el precio está diseñado para capturar dinero, no para predecir bien.

**Motivación:** quiere saber si un modelo independiente ve algo diferente al mercado. La divergencia entre SportsPulse y las odds es exactamente la señal que busca. No le importa si SportsPulse "recomienda apostar" — le importa si el modelo ve algo que el mercado no está viendo.

**Comportamiento:** los patrones de uso más intensos de los tres perfiles. Más sesiones por semana, más tiempo en DetailPanel, mayor ratio de conversión a Pro. Revisa predicciones antes de cada jornada. Vuelve post-partido a verificar.

**Conversión:** la más alta de los tres perfiles. Tiene motivación económica directa y disposición a pagar establecida. El flag de divergencia con el mercado (feature free) es el gancho. El historial de divergencias con resultados (feature Pro) es el gatillo de conversión.

**Nota de posicionamiento:** SportsPulse no es una plataforma de apuestas ni se posiciona como tal. No hay afiliación, no hay links a casas de apuestas, no hay publicidad de apuestas. Persona 3 usa el producto por su propio criterio. La posición ética es sobre cómo se financia el negocio — no sobre quién puede usarlo.

**Guardrail de producto:** SportsPulse acepta que algunos usuarios utilicen la plataforma como insumo en sus propias decisiones de apuesta. No se diseña el producto ni la comunicación para maximizar apuestas, volumen apostado o frecuencia de juego. La optimización del producto se hace sobre credibilidad del modelo, retención de usuarios y conversión a suscripción Pro. Cualquier feature, copy o incentivo que implique "apostá más" o "apostá ahora" viola este guardrail.

---

## 4. Visión del Producto

### 4.1 Definición

SportsPulse es una **plataforma de atención deportiva personalizada** que combina:

1. **Dashboard de atención** — treemap visual que muestra qué equipos merecen atención ahora, con señales explicables
2. **Motor predictivo con track record público** — probabilidades 1X2, scoreline esperado, xG, con historial de accuracy verificable
3. **Alertas inteligentes personalizadas** — no "gol de Boca", sino "Boca perdiendo 0-2 en el minuto 80, partido de alta relevancia según el modelo"
4. **Resumen post-partido** — "qué me perdí": goles, minuto, contexto editorial vinculado al partido
5. **Perfil de usuario** — favoritos, historial de predicciones propias, accuracy personal acumulado
6. **Briefs contextuales** — no noticias de fútbol genéricas, sino fragmentos editoriales cortos subordinados a un partido, equipo o señal del motor. Explican en lenguaje humano por qué algo importa hoy. Efímeros por diseño (TTL 24–48h), sin archivo. Viven dentro de la ficha de partido, no como destino propio. Ver Anexo D para la decisión estratégica completa y las reglas de producto.

### 4.2 El diferencial central

**La honestidad sobre el modelo es el producto.**

Ningún competidor muestra su accuracy histórico de forma abierta. SportsPulse puede hacerlo porque el motor predictivo ya existe con arquitectura verificable, la infraestructura de evaluación (Track A/B) ya está operativa, y el compromiso de no afiliación con casas de apuestas es una decisión estratégica.

Un elemento adicional de diferenciación: SportsPulse muestra sus probabilidades **en comparación con las probabilidades implícitas del mercado de apuestas** (Bet365/Pinnacle). Cuando el modelo diverge significativamente del mercado, esa divergencia es la predicción más interesante — y la más honesta. Ningún competidor hace esa comparación pública porque depende del ingreso de afiliación de esas mismas casas de apuestas. SportsPulse puede hacerla precisamente porque no depende de ellas.

### 4.3 Lo que SportsPulse NO es

- No es una app de resultados en tiempo real (no compite con SofaScore en eso)
- No es una plataforma de apuestas ni de tipsters
- No es una red social deportiva
- **No es un portal de noticias ni un agregador de contenido deportivo.** La distinción es estructural: SportsPulse puede tener briefs contextuales vinculados a partidos, pero no una home editorial, no scroll infinito de noticias, no archivo de contenido, no pestaña de noticias como destino. El contenido existe para explicar señales del motor — nunca como razón de visita independiente.
- No está diseñado para Brasil en esta etapa — requiere localización en portugués y competir con un ecosistema de medios locales consolidado

---

## 5. Análisis de Mercado

### 5.1 Contexto competitivo — tamaño real del mercado

Los competidores existentes dan escala al mercado total:
- **FlashScore:** 155M MAU, 400M descargas acumuladas (octubre 2025) ¹
- **SofaScore:** 28M MAU (2025) ²
- **FotMob:** 20M usuarios activos, EUR 11M de revenue en 2024 (+47% interanual) ³

Estos son jugadores globales con años de historia. SportsPulse no busca reemplazarlos — busca un segmento que ellos no priorizan: el fanático hispanohablante que quiere análisis de calidad en su idioma.

### 5.2 El mercado hispanohablante — datos verificados

**Comunidad latina en USA (dato más sólido del plan):**
- 62M+ hispanos en USA ⁴
- Los fans hispanos gastan **15% más** que el promedio en tickets, streaming, merchandise y suscripciones ⁵
- Liga MX es la **liga de club más vista en USA en 2025**, con crecimiento del +19% interanual ⁶
- La final de Copa América 2024 atrajo **12M viewers en USA, 53% hispanos** ⁷
- McKinsey: los latinos representarán **un tercio del crecimiento** del ecosistema deportivo de USD 300B en USA hasta 2035 ⁸

**LATAM hispanohablante:**
- Penetración de internet: Chile 90%+, Argentina 85%+, Colombia 85%+ ⁹
- Argentina: **30% paga SportsVOD** — el más alto de LATAM — a pesar de que 74% declara no poder pagar todos los servicios que desea ¹⁰
- México: 39% paga suscripciones digitales activamente ¹⁰
- El mercado de apps deportivas en LATAM tiene hábito de pago establecido (Netflix, Spotify operan en toda la región)

### 5.3 SAM estimado

Los siguientes números son **estimaciones derivadas** (penetración de internet × tasa estimada de uso de apps deportivas), no cifras de mercado publicadas. Se presentan como orden de magnitud.

| Segmento | Usuarios de apps deportivas (est.) | Base de estimación |
|----------|------------------------------------|--------------------|
| Argentina | 8.000.000 | 45M hab., 85% internet, alta densidad futbolística |
| México | 18.000.000 | 128M hab., 89% uso móvil, Liga MX dominante |
| Colombia | 6.000.000 | 52M hab., 85% internet, cultura futbolística intensa |
| Chile | 4.000.000 | 19M hab., 90% internet, alta disposición a pagar |
| Uruguay | 600.000 | 3.4M hab., mercado natural de arranque |
| Perú + Ecuador + otros | 4.000.000 | Menor volumen, zero competencia analítica |
| España | 12.000.000 | 47M hab., mercado maduro, LaLiga |
| Latinos en USA | 20.000.000 | 62M hispanos; asume ~32% activos en apps deportivas |
| **Total SAM estimado** | **~73.000.000** | |

### 5.4 Comparable más útil — FotMob

FotMob: bootstrapped, crecimiento orgánico, 20M usuarios, EUR 11M revenue en 2024. Sin motor predictivo, sin foco hispanohablante. Demuestra que una app deportiva de nicho puede ser rentable y sostenible sin escala masiva y sin depender de apuestas.

FotMob funciona como benchmark de existencia de categoría — prueba que el modelo de negocio es viable. No es un objetivo operativo directo: la viabilidad de SportsPulse depende de conversión, retención y track record, no de capturar un porcentaje de la escala de FotMob.

### 5.5 Geografía y secuencia de entrada

**Oleada 1 (meses 0-6):** Uruguay + Argentina — mercado natural, producto ya funcionando.

**Oleada 2 (meses 6-12):** México — mayor mercado de LATAM. Cubrir Liga MX activa simultáneamente México y el segmento latino en USA.

**Oleada 3 (meses 12-18):** Colombia + Chile + comunidad latina en USA — se activa orgánicamente una vez que Liga MX y Copa Libertadores están cubiertos.

**España** — paralelo desde día 1 como mercado de credibilidad. LaLiga ya cubierta.

**Brasil** — fuera del alcance inicial. Se evalúa a 24+ meses.

---

## 6. Análisis Competitivo

### 6.1 Mapa competitivo

| Plataforma | MAU / Escala | Modelo de revenue | Debilidad explotable |
|------------|-------------|------------------|----------------------|
| **FlashScore** | 155M MAU ¹ | Ads + apuestas afiliadas | Sin capa editorial, sin predicciones propias, adquirió BeSoccer (señal de que nota la oportunidad hispanohablante) |
| **SofaScore** | 28M MAU ² | Ads + in-app | Predicciones opacas, en inglés, influenciado por apuestas |
| **FotMob** | 20M usuarios ³ | Ads + FotMob Pro | Sin motor predictivo, sin foco hispanohablante |
| **OneFootball** | Escala incierta | Ads + streaming | USD 320M recaudados, aún con problemas de rentabilidad ¹¹ |
| **Mediotiempo** (MX) | No publicado | Ads | Cobertura local Liga MX, cero analytics |
| **ESPN Deportes / TUDN** | Broadcast masivo | Ads / cable | Broadcast-first, no analytics, no personalización |

**Alerta de mercado:** FlashScore adquirió BeSoccer en 2025 para fortalecer su posición en España, Brasil, Italia y Francia. Alguien ya notó el mercado hispanohablante. La ventana no es permanente.

### 6.2 Ventajas competitivas sostenibles

1. **Track record acumulado por liga** — el moat más duro. No se puede fabricar con dinero ni velocidad. Solo existe si empezaste a acumularlo antes.
2. **Motor predictivo con metodología pública** — requiere años de datos forward para ser creíble
3. **Independencia editorial** — sin afiliación a casas de apuestas, sostenible solo si no se compromete nunca
4. **Español nativo** — no una traducción de un producto angloparlante, sino un producto diseñado para esta cultura futbolística

---

## 7. Posicionamiento Estratégico

### 7.1 Qué posición ocupa SportsPulse

SportsPulse ocupa el espacio de **fuente analítica independiente en español con track record verificable**. No es una app de scores, no es un medio deportivo, no es una plataforma de predicciones financiada por casas de apuestas. Es una herramienta de análisis con accountability pública.

El posicionamiento no es cosmético. Es la consecuencia directa de una decisión estructural: no recibir ingresos de afiliación de casas de apuestas. Esa decisión tiene un costo (CPM de publicidad menor, sin subsidio de gambling) y un beneficio (credibilidad sostenible, posibilidad de comparar predicciones propias vs. odds sin conflicto de interés).

### 7.2 Por qué el track record importa más que el algoritmo

Un modelo que acierta el 55% sin historial verificable vale exactamente lo mismo que un tipster que dice acierta el 90%: cero credibilidad. Un modelo que acierta el 52% con 200 partidos auditados, curva de calibración visible y errores publicados vale más que cualquier competidor en el mercado hispanohablante.

El track record no es una feature. Es el activo estratégico central. Tiene tres propiedades únicas:
- **Acumulativo** — crece con el tiempo, no se puede fabricar retroactivamente
- **Verificable públicamente** — cualquier usuario puede auditar partido a partido
- **Incompatible con el modelo de afiliación** — ningún competidor que dependa de casas de apuestas puede publicar comparaciones honestas con el mercado de odds

### 7.3 Riesgos que se evitan deliberadamente

| Riesgo | Por qué se descarta |
|--------|---------------------|
| Afiliación a casas de apuestas | Destruye el posicionamiento de independencia; CPM alto a corto plazo, credibilidad destruida a largo |
| Exchange / prediction market real | Regulación compleja, cambiante, zona sensible en múltiples mercados LATAM; cambiaría radicalmente el tipo de empresa |
| Tipster marketplace | Convierte SportsPulse en agregador de exactamente lo que critica; contamina el moat |
| B2B temprano | Requiere sales motion, distrae del core, no viable antes de tener track record consolidado |
| Social / fantasy layer | Riesgo de Frankenstein — mezclar contextos sin dominar ninguno |

---

## 8. Tesis de Producto — Core, Palancas, Extensiones

### 8.1 Motor de valor (core)

Lo que crea el diferencial. Sin esto, no hay negocio:

| Componente | Qué hace | Por qué es core |
|------------|----------|-----------------|
| Track record público | Historial verificable de predicciones por liga | Es el activo estratégico acumulativo |
| Motor predictivo Elo | Predicciones 1X2, scoreline, xG, confianza | Genera el output que se monetiza |
| Dashboard de atención | Señala qué merita seguimiento hoy | Diferencial editorial de entrada |
| Página de accuracy | Muestra aciertos y errores sin filtro | Construye credibilidad; activa conversión |
| Comparación vs mercado de odds | Divergencia como señal editorial | Solo posible sin afiliación; diferencia real |

### 8.2 Palancas de activación y conversión

> **Nota metodológica:** si una iniciativa no genera caja por sí misma sino que mejora conversión, retención o distribución, se clasifica como palanca operativa y no como línea de ingresos del modelo. Esta distinción rige en todo el plan — una palanca que mejora el MRR no es ingreso; es condición habilitante del ingreso.

Features que no monetizan directas pero son condición para que el usuario llegue al gate de pago:

| Feature | Función | Métrica objetivo |
|---------|---------|-----------------|
| Gate de registro contextual | Captura email en momento de intención alta | Tasa de registro / sesión activa |
| Micro-pantalla post-registro | Ancla valor en el partido que trajo al usuario | Retención D1 |
| Preview de features Pro (estructuras bloqueadas) | El usuario ve qué hay detrás sin verlo | CTR al CTA Pro |
| Lunes de accuracy (contenido) | Hábito semanal, shareworthy | Retención D7, apertura newsletter |
| Divergencia vs mercado (flag libre) | Gancho para Persona 3 | Sesiones por usuario / semana |

### 8.3 Palancas de retención y hábito

Features que no generan ingreso directo pero reducen churn y aumentan LTV:

| Feature | Función | Cuándo implementar |
|---------|---------|-------------------|
| Favoritos + liga favorita | Personalización mínima | Fase II (con registro) |
| Alertas de resultado | Notificación básica | Fase II |
| Alertas inteligentes con contexto | Retención activa | Fase III (con paywall) |
| Lunes de accuracy automatizado | Hábito semanal estructural | Fase III |
| Dashboard personalizado | Retención media-alta | Fase III |

### 8.4 Extensiones de segunda ola

Plausibles, coherentes, **no validadas aún**, fuera del caso base:

- **App mobile nativa** — requerida para push en USA, pero es un canal de distribución, no una línea de ingresos
- **Creator plan / API** — plausible cuando haya track record consolidado y demanda demostrada; hoy no existe señal de demanda
- **Newsletter propio** — canal de distribución, no ingreso

### 8.5 Fuera del alcance — deliberadamente

- Exchange / prediction market con dinero real
- Afiliación a casas de apuestas como fuente de ingresos
- Home editorial propia de noticias (viola el posicionamiento)
- Pestaña de noticias como destino independiente
- B2B antes de tener suscriptores Pro consolidados

---

## 9. Modelo de Negocio

### 9.1 Ingresos primarios — Suscripción freemium

La frontera free/Pro está diseñada con un principio único: **free prueba que el modelo existe y funciona — Pro explica cómo funciona y lo conecta con lo que le importa específicamente al usuario.** El gate no está en los datos básicos sino en la profundidad y la personalización.

**Free (siempre gratis)**

| Feature | Detalle |
|---------|---------|
| Dashboard de atención | Treemap completo + señales |
| Resultados y calendario | Todos los partidos de ligas cubiertas |
| Probabilidades 1X2 completas | Los tres porcentajes visibles (ej. 68% / 18% / 14%) |
| Resultado más probable | Consecuencia directa de los porcentajes |
| Comparación vs mercado (flag) | Indicador de divergencia alta/baja — sin historial |
| Track record global por liga | Página de accuracy pública, todos los partidos, todas las ligas |
| Briefs contextuales | Vinculados al partido en DetailPanel, TTL 24–48h |
| Alertas básicas de resultado | Gol, resultado final |
| 1 liga favorita | Seguimiento básico |
| **Publicidad display** | Slots de banner estándar en dashboard y DetailPanel. Anunciantes: streaming deportivo, merchandise, ticketing — sin publicidad de casas de apuestas (ver §7.2). Se elimina completamente en Pro. |

**Pro — ver pricing §7.3**

| Feature | Detalle |
|---------|---------|
| Scoreline esperado | Distribución de los marcadores más probables con probabilidades |
| xG esperado | Goles esperados por equipo en función del historial de oportunidades |
| Intervalo de confianza | Rango de certeza de cada predicción — diferencia un modelo calibrado de una opinión |
| Explicación del modelo | Las señales específicas que determinaron la predicción (Elo diferencial, forma reciente, ventaja local) |
| Track record por equipo | Accuracy del modelo sobre los partidos de un equipo específico, partido a partido |
| Historial de divergencias con mercado | Cuándo el modelo discrepó del mercado y qué pasó en cada caso |
| Alertas inteligentes con contexto | "Boca perdiendo 0-2 en el 80', partido de alta relevancia. Scoreline esperado actual: 0-2 (62%)" |
| Resumen post-partido enriquecido | Qué predijo el modelo, qué pasó, en qué minuto cambió la dinámica |
| Accuracy personal del usuario | Historial de predicciones propias con accuracy acumulado |
| Favoritos ilimitados, sin publicidad | — |

### 9.2 Ingresos secundarios — Jerarquía y nivel de certeza

**[PLAUSIBLE — baja certeza] Publicidad display (activa desde el free tier inicial)**

Slots de banner estándar en dashboard y DetailPanel, visibles únicamente para usuarios free. Política de anunciantes: streaming deportivo, merchandise oficial, ticketing — sin publicidad de casas de apuestas bajo ninguna forma.

Fórmula: `Rev_ads = MAU × sesiones_día × páginas_sesión × 30 × CPM × fill_rate / 1000`
- MAU = ~60-70% de usuarios registrados
- Páginas/sesión ≈ 3; sesiones/día activo ≈ 1.5
- CPM ≈ USD 2-3 (sports apps sin apuestas; fuente: IAB benchmarks)
- Fill rate sitio nuevo sin DMP propio ≈ 30-50%
- **Estimado a 10K MAU: USD 200-600/mes** — modesto, pre-paywall, no en caso base

**[ESPECULATIVO — sin programa activo] Afiliación a streaming no-betting**

Comisión por conversión a servicios como DAZN, ESPN+ o VTV Play. Hoy no existe ningún programa de afiliados activo con términos verificados en LATAM. Sin CPA verificable, el ingreso modelable es USD 0.

La cifra "15-25% del ingreso total" que aparecía en versiones anteriores de este plan **no tiene base**. No existe programa activo, no hay tasa de comisión verificable, y el volumen de usuarios requerido para que la afiliación a streaming sea relevante excede la escala proyectada en el caso base. Esta línea se mueve a upside condicional — solo ingresa al modelo si se firma un programa con términos concretos.

**Condición de activación:** acuerdo de afiliación firmado con términos verificables + suficiente MAU para que el volumen justifique la integración. No antes de Fase IV (Post-Mundial).

### 9.3 Pricing por segmento

| Segmento | Pro mensual | Pro anual | Notas |
|----------|------------|----------|-------|
| USA + España | USD / EUR 7.99 | 59.99 | Poder adquisitivo alto, moneda fuerte |
| Argentina | USD 4.99 | 39.99 | USD estándar para SaaS; requiere Mercado Pago como alternativa |
| México | USD 4.99 | 39.99 | Stripe disponible; considerar OXXO Pay para usuarios sin tarjeta |
| Colombia / Chile / Perú | USD 3.99 | 29.99 | Penetración digital creciente |

**Precio promedio ponderado estimado (mix de mercados):** USD 5.50/mes

### 9.4 Conversión freemium — supuesto central y sus rangos

La conversión free→Pro es el supuesto más sensible del modelo. Los benchmarks de la industria (RevenueCat State of Subscription Apps 2025, First Page Sage 2026) son:

| Percentil | Conversión | Contexto |
|-----------|-----------|----------|
| Mediana industria | 2.18% | Apps freemium generales |
| Bueno | 3–5% | Nicho con alta retención y diferenciación clara |
| Excelente | 6–8% | Producto muy diferenciado con paywall bien ejecutado |
| Hard paywall | 12% | Sin tier gratuito, requiere pago desde el inicio |

SportsPulse tiene factores a favor de conversión superior a la mediana: alta diferenciación, audiencia de nicho con disposición a pagar verificada, y un feature Pro (track record del modelo) que no existe en el mercado. Aun así, la mediana de la industria es el punto de partida honesto para proyectar.

### 9.5 Onboarding — flujo de registro

**Principio:** el usuario tiene que experimentar el producto antes de que se le pida nada. El registro se pide en el momento de mayor intención demostrada — cuando el usuario ya intentó acceder a algo que vale la pena.

**Flujo:**

1. **Primer contacto — sin fricción.** El dashboard es completamente visible sin registro. 1X2 con porcentajes libres para todos los partidos.

2. **Gate contextual — en el momento correcto.** Cuando el usuario abre el DetailPanel de un partido y toca cualquier elemento bloqueado (scoreline, xG, confianza, explicación del modelo), aparece: *"¿Querés ver el análisis completo? Registrate — es gratis."* Los elementos bloqueados son visibles en estructura pero no en contenido: el usuario ve que existen tres cards de scoreline con los números tapados. Entiende qué hay detrás sin necesidad de texto explicativo.

3. **Registro — sin fricción.** Email o Google/X OAuth. Un solo paso. Sin formulario largo, sin verificación de edad, sin pasos intermedios.

4. **Post-registro — micro-pantalla contextual.** No una pantalla de bienvenida genérica. Una pantalla que ancla el valor en el partido que trajo al usuario: *"Ya sos parte de SportsPulse. Ahora podés ver el scoreline esperado, xG, nivel de confianza y las señales que determinaron la predicción."* Botón: *"Ver análisis de [nombre del partido]."* El usuario vuelve exactamente donde estaba, con el contenido desbloqueado.

**Lo que no se hace:** tour de onboarding, wizard de configuración, pantalla de selección de ligas al entrar. La personalización (equipo favorito, ligas de interés) se propone progresivamente durante el uso, no como barrera de entrada.

### 9.7 Descubrimiento de valor Pro

Un paywall invisible no convierte. Cada feature Pro debe ser percibida antes de ser accesible: el usuario ve que existe, entiende qué contiene, y siente el gap entre lo que tiene y lo que podría tener.

**Preview por feature:**

| Feature Pro | Qué ve el usuario free |
|-------------|------------------------|
| Scoreline esperado | Cards de los 3 marcadores más probables con probabilidades bloqueadas — estructura visible, números ocultos |
| Intervalo de confianza | Debajo del porcentaje: *"¿Qué tan seguro está el modelo? →"* con el rango bloqueado |
| Explicación del modelo | Lista de señales con texto bloqueado: el usuario ve que hay un razonamiento, no cuál es |
| Track record por equipo | *"Accuracy del modelo sobre River Plate: [🔒 Pro]"* — el nombre del equipo ya está visible |
| Historial de divergencias | El flag de divergencia es free; debajo: *"Ver historial de divergencias y sus resultados → Pro"* |
| xG esperado | Número bloqueado con descripción visible de qué es y por qué importa |

**Los tres momentos de conversión de mayor impacto:**

1. **Partido de alto impacto del equipo favorito (pre-partido):** máxima atención emocional, máxima disposición a pagar. El CTA *"Ver análisis completo → Pro"* tiene el contexto correcto.
2. **Después de que el modelo acertó algo que el usuario siguió:** el usuario vuelve, ve la validación, quiere saber qué predice el modelo para el próximo partido. Es el instante de mayor disposición a pagar en todo el funnel.
3. **Divergencia alta con el mercado:** el flag es free: *"El modelo ve algo diferente al mercado."* El análisis de por qué diverge está en Pro. El usuario que quiere entender esa divergencia ya está convencido.

**Trial de 7 días:**

Algunos features Pro necesitan ser experimentados para crear deseo — una descripción textual no genera lo mismo que ver la distribución real de un partido que importa. La primera vez que el usuario toca un feature Pro: *"Probá Pro 7 días gratis."* Al día 5: recordatorio con resumen de lo que usó. Al vencimiento: paywall real. El trial resuelve el problema de que el usuario no puede evaluar lo que no ha visto.

---

### 9.8 Página de accuracy público — principios de diseño

> Esta sección define principios y decisiones. El diseño visual y el copy requieren iteración de producto antes de implementar.

**El problema central:** todos los competidores publican números imposibles (90–99% accuracy). Mostrar un 55% honesto sin contexto genera el efecto contrario: el usuario asume incompetencia. La página tiene que resolver este problema de percepción antes de cualquier otra cosa.

**Principio 1 — La comparación es el producto, no el número:**

| Referencia | Accuracy 1X2 | Por qué importa |
|------------|-------------|----------------|
| Elegir al azar | ~38% | El piso. Predecir fútbol es difícil. |
| Tipsters de Twitter | ~43% | Cobran por picks y aciertan menos que el azar. |
| Casas de apuestas (Pinnacle argmax) | ~54% | El techo de referencia público. |
| SportsPulse V4.4 (walk-forward auditado) | ~55% | Por encima del mercado. Empates: único en el mercado. |
| SportsPulse target aspiracional | ~57% | Objetivo de largo plazo sin fecha fija — no es un umbral de lanzamiento. |
| SportsPulse alta confianza | ~62–65% | Subconjunto donde el modelo es más seguro (forward validation pendiente). |

**Principio 2 — For dummies arriba, profundidad abajo:**

Arriba del fold: conteo visual (●●●●●●○○○● = 7/10) y la tabla de comparación. Sin porcentajes globales, sin jerga estadística. Debajo del fold: historial completo filtrable, accuracy por nivel de confianza, errores con contexto, track record por equipo (gate Pro).

**Principio 3 — La verificabilidad es el diferenciador, no el número:**

En un mercado donde todos mienten, la afirmación correcta no es "somos más precisos" — es "somos los únicos que no podemos mentir porque cada predicción tiene timestamp anterior al partido y cualquiera puede verificarla." Eso va prominente, no como nota al pie.

**Principio 4 — Los errores tan visibles como los aciertos:**

La credibilidad de largo plazo depende de no esconder los errores. El lunes de accuracy empieza por los partidos que el modelo erró, con contexto. La página muestra las pérdidas sin filtro. Eso es lo que ningún competidor hace — y es exactamente lo que construye confianza sostenible.

---

## 10. Cobertura de Ligas — Estrategia y Roadmap

### 10.1 El modelo y las ligas están acoplados

El track record público es el diferencial central. **Umbral de credibilidad: ≥ 200 partidos evaluados por liga** antes de publicar el accuracy de esa liga. Mostrar un número pequeño es peor que no mostrarlo.

### 10.2 Secuencia por liga

La secuencia tiene dos etapas diferenciadas. La evaluación histórica permite demostrar metodología rápidamente; la validación forward genera el track record definitivo.

```
Datos históricos disponibles → Backfill Elo (mínimo 3 temporadas)
→ Walk-forward histórico: evaluar ≥200 partidos pasados sin lookahead
→ [Demostración metodológica publicada con disclosure de origen histórico]
→ Forward validation activa (cada partido nuevo desde hoy)
→ Umbral ≥200 partidos live → Track record verificado completo
```

El walk-forward histórico no reemplaza la validación forward — es un puente que permite mostrar credibilidad metodológica antes de tener masa suficiente de partidos live. Ver Anexo B §B.6 para el detalle de qué se puede publicar en cada etapa y cuál es el lenguaje de disclosure apropiado.

> **Regla de publicación:** el walk-forward histórico puede publicarse como demostración metodológica. Nunca se presenta como equivalente al track record forward/live. Todo historial retrospectivo debe estar rotulado explícitamente como "evaluación walk-forward histórica sin lookahead — no es historial operativo en tiempo real". La distinción debe ser visible al usuario, no enterrada en un disclaimer.

### 10.3 Estado actual y roadmap

| Liga | Mercado | Producto | Modelo | Prioridad |
|------|---------|----------|--------|-----------|
| Liga Profesional Argentina | Argentina | ✅ | ✅ En validación | — |
| LaLiga | España | ✅ | ✅ En validación | — |
| Liga Uruguaya | Uruguay | ✅ | ✅ En validación | — |
| Premier League | Global | ✅ | ✅ En validación | — |
| Bundesliga | Global | ✅ | ✅ En validación | — |
| Copa Libertadores | TODO LATAM | Parcial | ❌ Pendiente | **Muy alta** |
| Liga MX | México + USA | ❌ | ❌ Pendiente | **Muy alta** |
| Eliminatorias CONMEBOL | TODO LATAM | ❌ | ❌ Pendiente | Alta |
| Copa América | TODO LATAM | Parcial | ❌ Pendiente | Alta |
| Liga BetPlay Colombia | Colombia | ❌ | ❌ Pendiente | Media |
| Primera División Chile | Chile | ❌ | ❌ Pendiente | Media |

### 10.4 El track record como moat competitivo

Un competidor puede copiar la UI en semanas y comprar los mismos datos en días. No puede fabricar tres años de predicciones verificadas en Liga MX y Copa Libertadores. Ese historial solo existe si se empezó antes. Cada mes de forward validation activo en una liga nueva es ventaja competitiva irreplicable que se acumula.

---

## 11. Estrategia de Go-to-Market

### 11.1 Principio: producto primero, marketing después

El producto convence a los primeros 1.000 usuarios sin marketing pagado. Con tracción orgánica demostrable, se activa adquisición pagada. El error clásico es gastar en adquisición antes de que el producto retenga.

### 11.2 SEO — estrategia y roadmap de implementación

**Cobertura objetivo:** una URL indexable por partido, por liga y por torneo cubierto. Cada URL es una entrada orgánica independiente con alta intención de búsqueda. Las búsquedas objetivo son exactamente las que generan el tráfico más valioso: "predicción Boca River hoy", "pronóstico Copa Libertadores semifinal", "tabla LaLiga jornada 35".

**Estado ideal (mundo perfecto):** SSR con páginas estáticas generadas por partido/liga/torneo, `<title>` + `<meta description>` + `<og:image>` dinámicos por página, sitemap XML automático, datos estructurados `schema.org/SportsEvent` para resultados ricos en la SERP (fecha, equipos, predicción visible sin entrar al sitio).

**Implementación pragmática en dos etapas:**

| Etapa | Qué | Cuándo | Esfuerzo |
|-------|-----|--------|----------|
| **Mínimo viable** | Sitemap XML automático + `<title>` y `<meta description>` dinámicos (React Helmet) + prerendering estático para los 64 partidos del Mundial | Fase Sprint — antes del 11 junio | 3-5 días |
| **SSR completo** | Migración a Next.js o framework SSR equivalente — páginas estáticas para todo el catálogo de partidos/ligas/torneos | Fase Post-Mundial | Sprint dedicado |

**Por qué el mínimo viable importa ahora:** Google tarda 3-6 meses en rankear páginas nuevas. Lo que se indexa en abril-mayo 2026 rankea justo para el Mundial. Las páginas de los 64 partidos del torneo indexadas antes del 11 de junio capturan tráfico orgánico de alta intención durante todo el torneo — sin costo de adquisición.

### 11.3 Fase 1 — Tracción orgánica (meses 1-6) — Uruguay + Argentina

**Objetivo conservador:** 8.000 usuarios. **Objetivo optimista:** 15.000 usuarios.

- **Contenido en Twitter/X:** dashboard de atención como imagen compartible diaria. "Los 3 equipos a los que prestarle atención esta jornada — explicado."
- **Accuracy público semanal:** publicar cada lunes el accuracy real de la semana anterior, incluyendo los errores. Nadie más lo hace. Es shareworthy precisamente porque es honesto.
- **Copa Libertadores como gancho regional:** genera conversación en todos los países de LATAM simultáneamente desde el día 1.
- **SEO de cola larga:** "predicción Boca River este sábado", "pronóstico Copa Libertadores". Volumen real, baja competencia en análisis independiente en español.
- **Outreach a comunidades de análisis:** acceso Pro gratuito a cuentas de análisis en Twitter/X, podcasts, blogs a cambio de mención honesta.

### 11.4 Fase 2 — México (meses 7-12)

**Objetivo conservador:** 25.000 usuarios acumulados. **Objetivo optimista:** 45.000.

- Activación Liga MX con track record publicado desde el primer partido registrado
- Clásico Nacional (Chivas vs América) como momento de alto impacto — predicción pública días antes, seguimiento en vivo, resultado del modelo publicado post-partido
- TikTok y YouTube en español (más relevantes que Twitter/X en México)
- US Latinos: se activan orgánicamente al tener Liga MX cubierta; asegurar que el producto funciona en timezone USA y que USD 7.99 está disponible en App Store / Play Store

### 11.5 Fase 3 — Colombia, Chile, consolidación (meses 13-18)

**Objetivo conservador:** 35.000 usuarios. **Objetivo optimista:** 80.000.

- Liga BetPlay + Primera Chile: misma secuencia que México
- Newsletter semanal propio con análisis del modelo — ancla el lunes de accuracy como evento de contenido recurrente
- Programa de referidos: un mes Pro gratis por cada amigo que convierte
- App mobile nativa: requerida para desbloquear push notifications en USA

### 11.6 Estrategia de contenido — ritmo semanal

El contenido no es marketing separado del producto — es el producto distribuido en dosis digeribles. El objetivo es que SportsPulse tenga presencia en el feed del fanático incluso en días sin partido.

**Principio operativo: el contenido es el sistema, no un proceso editorial separado.**

El calendario de contenido no requiere redacción manual. Las predicciones ya existen, los resultados entran automáticamente, el accuracy se calcula en el motor. El pipeline de contenido es un entregable técnico que formatea datos existentes en piezas distribuibles — texto estructurado + imagen generada — listas para publicar con revisión mínima del fundador. Costo operativo: cero.

**Ritmo semanal base:**

| Día | Pieza | Origen de datos | Canal |
|-----|-------|-----------------|-------|
| Lunes | Accuracy de la semana: qué acertó, qué erró, con qué margen. **Empezar por los errores.** | Track A — predicciones + resultados de la semana anterior | Twitter/X + newsletter |
| Miércoles | Predicción del partido más relevante + divergencia vs mercado ("el modelo ve X, el mercado ve Y") | Motor predictivo + The Odds API | Twitter/X + TikTok |
| Viernes | Preview fin de semana: los 3 partidos de mayor atención del treemap + predicciones resumidas | Dashboard treemap + motor predictivo | Twitter/X + Instagram |

**Por qué este ritmo:**

- **Lunes de accuracy** ancla el hábito semanal. Es el único contenido de este tipo en el mercado hispanohablante. Empezar por los errores construye credibilidad más rápido que empezar por los aciertos — y es exactamente lo que ningún tipster de Twitter hace.
- **Miércoles de predicción** captura búsqueda orgánica pre-partido y da visibilidad a la divergencia con el mercado. La divergencia es el diferencial editorial que ningún competidor puede replicar sin modelo independiente.
- **Viernes de preview** es shareworthy orgánico: los usuarios lo comparten con amigos antes del fin de semana. Genera adquisición sin costo.

**Ventana Copa del Mundo (11 junio → 19 julio 2026):**

El ritmo se intensifica adaptado al calendario del torneo:
- **Antes de cada ronda eliminatoria:** predicciones para todos los partidos de la fase publicadas simultáneamente con comparación vs mercado
- **Después de cada jornada:** resumen de accuracy publicado dentro de las 2 horas post-partido
- **Post-Mundial:** primer reporte de accuracy agregado del torneo — el mayor activo de credibilidad acumulable en el corto plazo

**Medición de contenido:**

El KPI no es alcance. Es usuarios que llegan desde contenido, ven el producto, y se registran. Métrica de corte a los 90 días: ¿qué día de la semana y qué tipo de pieza genera más registros por impresión? Las piezas que no generan registros se eliminan o reformatean — no se acumula por inercia.

---

## 12. Roadmap por Fases — Secuencia Económica

> **Marco de lectura:** cada fase es una unidad de validación económica, no una lista de features. Las fases no monetizan todas — algunas son condición habilitante de las siguientes. Eso está explicitado en cada tabla. Fecha de referencia: 16 de marzo de 2026. Copa del Mundo 2026: 11 de junio — 87 días.

### Estado actual del producto (16 de marzo 2026)

| Componente | Estado |
|-----------|--------|
| Dashboard de atención, motor predictivo, ligas (LaLiga, PL, BL1, ARG, URU) | ✅ Producción |
| Arquitectura para selecciones nacionales + WC | ✅ Lista — sin perfil world-cup.ts ni fuente activa |
| Página de accuracy / track record | ✅ Implementada — detrás de flag interno. Horas de trabajo para hacerla pública. |
| Comparación vs mercado de odds (The Odds API v4) | ✅ Implementada — desactivada por falta de API key |
| WC como competición en football-data.org | ✅ TIER_ONE con token actual — sin bloqueante de proveedor |
| Registro / login | ❌ No existe |
| Paywall Pro | ❌ No existe |
| Alertas, push, app mobile | ❌ No existen |

---

### Fase 0 — Credibilidad (ahora → 1 junio 2026)

| Campo | Detalle |
|-------|---------|
| **Objetivo** | Llegar al inicio del Mundial con track record público visible, registro operativo y predicciones del torneo activas |
| **Qué se construye** | Accuracy público (flag off), walk-forward histórico ≥200 partidos/liga, The Odds API activada, world-cup.ts profile, registro/login (email + OAuth), pipeline de contenido automatizado (lunes/miércoles/viernes), SEO mínimo viable (sitemap + meta tags + prerendering 64 partidos WC) |
| **Qué problema resuelve** | Sin track record público no hay credibilidad. Sin registro no hay base de usuarios capturable. Sin predicciones del Mundial no hay gancho en la ventana más grande del año. |
| **Valor estratégico** | Establece el activo central (historial verificable). Captura la primera audiencia con email. Posiciona para el Mundial. |
| **Ingreso directo** | **Ninguno.** Esta fase no monetiza. |
| **Ingreso que habilita** | Toda la monetización posterior. Sin track record no hay argumento de conversión Pro. Sin registro no hay base a la cual facturar. |
| **KPIs de validación** | ≥200 partidos walk-forward publicados por liga; página de accuracy pública con timestamp visible; ≥500 usuarios registrados antes del 11 de junio |
| **Criterio de cierre** | Accuracy público operativo + registro funcional + perfil WC listo + antes del 11 de junio |
| **Riesgo principal** | Tiempo — 87 días con 6 entregables técnicos. Si el registro llega tarde, la ventana del Mundial construye tráfico anónimo irrecuperable. |
| **Orden de prioridad si hay recorte** | Si hay que sacrificar algún entregable por tiempo: **(1)** Registro/login → **(2)** Accuracy público visible → **(3)** Predicciones del Mundial activas → **(4)** Comparación vs mercado de odds → **(5)** SEO mínimo viable → **(6)** Pipeline de contenido automatizado. **Regla:** se sacrifica distribución antes que credibilidad. Se sacrifica automatización antes que captura de usuarios. |

---

### Fase I — Activación (11 junio → 19 julio 2026 — Copa del Mundo)

| Campo | Detalle |
|-------|---------|
| **Objetivo** | Adquisición orgánica máxima. Convertir el tráfico del Mundial en base de usuarios registrados. |
| **Qué se opera** | Predicciones para 64 partidos con comparación vs mercado; pipeline de contenido activo (accuracy por jornada en ≤2h post-partido); captura de registros con gate contextual |
| **Qué NO se construye** | Paywall Pro, alertas push, app mobile — esta ventana es adquisición pura, no monetización |
| **Valor estratégico** | Los 39 días del torneo son la mayor concentración de búsqueda orgánica de fútbol del año. Cada usuario que se registra es un email capturable para monetizar después. |
| **Ingreso directo** | **Ninguno.** Cualquier publicidad display potencial en esta fase es marginal y no se usa para evaluar la fase. Esta es una fase de adquisición pura. |
| **Ingreso que habilita** | Base de usuarios para Fase III (paywall Pro). Primer volumen de partidos evaluados en selecciones nacionales. |
| **KPIs de validación** | N° de usuarios registrados durante el torneo; tasa de registro / visita única; accuracy del modelo en WC publicado post-torneo |
| **Criterio de cierre** | Fin del torneo (19 julio) con base de emails capturada y accuracy WC documentado |
| **Riesgo principal** | Que el modelo tenga accuracy bajo en WC (selecciones con pocos datos históricos). Mitigación: disclosure explícito de muestra limitada para selecciones nacionales vs. ligas con historial. |

---

### Fase II — Identidad y hábito (agosto → septiembre 2026)

| Campo | Detalle |
|-------|---------|
| **Objetivo** | Convertir usuarios anónimos/registrados en usuarios con identidad en el producto. Reducir churn antes de activar el paywall. |
| **Qué se construye** | Favoritos (equipo + liga), dashboard personalizado, alertas básicas de resultado, historial de predicciones por usuario, lunes de accuracy automatizado |
| **Por qué antes del paywall** | Un usuario que no tiene favoritos guardados tiene menos razón para pagar Pro que uno que ya volvió 5 veces a ver su equipo. La personalización es condición previa a la conversión. |
| **Ingreso directo** | **Ninguno.** Display ads potencialmente activos son flujo marginal e irrelevante para evaluar el éxito de esta fase. |
| **Ingreso que habilita** | Mayor ratio de conversión a Pro al activar el paywall en Fase III. Menor churn post-conversión. |
| **KPIs de validación** | DAU/MAU > 25%; retención D30 > 35%; % de usuarios con ≥1 favorito guardado > 40% |
| **Criterio de cierre** | Métricas de hábito alcanzadas antes de activar paywall. No se activa el paywall hasta tener D30 > 35%. |
| **Riesgo principal** | Activar el paywall antes de tener hábito establecido — penaliza la conversión y se dificulta recuperar a los usuarios que rechazan el gate. |

---

### Fase III — Monetización núcleo Pro (octubre → diciembre 2026)

| Campo | Detalle |
|-------|---------|
| **Objetivo** | Activar el primer ingreso recurrente. Alcanzar el break-even. |
| **Qué se construye** | Paywall freemium con trial 7 días, predicciones detalladas Pro (scoreline, xG, confianza, explicación del modelo), alertas inteligentes con contexto (dos tipos, medidos separado), SSR completo para SEO |
| **Pricing** | Ver §7.3. Stripe para todo LATAM + España desde el inicio. |
| **Ingreso directo** | **Suscripción Pro — línea principal.** MRR objetivo mes 3: ≥USD 950 (200 subs × $4.75). |
| **Ingreso que habilita** | Escalado — cada nuevo usuario registrado tiene un camino definido hacia Pro. |
| **KPIs de validación** | ≥200 suscriptores Pro activos; conversión free→Pro ≥2%; churn mensual <5%; MRR creciente mes a mes |
| **Criterio de cierre** | MRR > USD 2.000/mes durante 2 meses consecutivos (indica que el modelo de conversión funciona) |
| **Riesgo principal** | Conversión real por debajo de la mediana de industria (2.18%). Si a los 90 días hay <100 subs, revisar el gate, el onboarding y el trial antes de escalar adquisición. |

---

### Fase IV — Expansión de alto valor (enero → junio 2027)

| Campo | Detalle |
|-------|---------|
| **Objetivo** | Ampliar el TAM útil y el moat. Entrar a México — el mercado más grande del plan. |
| **Qué se construye** | Liga MX (API-Football, CompetitionProfile, walk-forward histórico, forward validation desde Clausura 2027); Copa Libertadores con predicciones; adaptación operativa a México + timezone USA; Colombia + Chile (misma secuencia) |
| **Por qué México es una decisión económica, no editorial** | Liga MX es la liga de club más vista en USA (+19% interanual). Activarla abre simultáneamente México y los 62M hispanos en USA. Ese segmento tiene el LTV más alto del plan (USD 7.99/mes vs USD 3.99-4.99 en el resto). Sin Liga MX, el plan no llega al segmento de mayor valor. |
| **Nota técnica Liga MX** | Engine soporta Apertura/Clausura (sin reset Elo, solo corte julio) y liguilla (stage_type=PLAYOFF). Pendiente: CompetitionProfile. API-Football en free tier (100 req/día) puede ser insuficiente para backfill — upgrade básico USD 10-15/mes. |
| **Ingreso directo** | Suscripción Pro en mercados nuevos. |
| **Ingreso que habilita** | Escala del MRR. Mayor LTV por usuario en USA. Moat irreplicable en Liga MX y Copa Libertadores. |
| **KPIs de validación** | ≥200 partidos Liga MX evaluados; accuracy publicado; primeros suscriptores Pro desde México/USA |
| **Criterio de cierre** | Track record ≥200 partidos en Liga MX + Copa Libertadores publicado |
| **Riesgo principal** | Calidad de datos históricos de API-Football para Liga MX. Validar antes de publicar accuracy. |

---

### Fase V — Distribución ampliada (segundo semestre 2027)

| Campo | Detalle |
|-------|---------|
| **Objetivo** | Reducir churn, aumentar LTV, bajar costo de adquisición por referido. |
| **Qué se construye** | App mobile nativa (push notifications en USA + canal nativo iOS/Android); newsletter propio; programa de referidos (1 mes Pro por conversión); Mercado Pago Argentina (cuando volumen lo justifique) |
| **Clasificación** | Estas features son palancas de retención y distribución — NO son líneas de ingresos. La app mobile no monetiza directamente; reduce churn y abre el canal USA. |
| **Ingreso directo** | **Indirecto** — menor churn = mayor LTV por suscriptor. |
| **Ingreso que habilita** | Mayor eficiencia del MRR existente. |
| **KPIs de validación** | Churn mensual < 3%; referral rate > 5% de nuevos registros; % activación mobile > 30% |
| **Criterio de cierre** | No tiene fecha fija — se activa cuando Fase III y IV tienen tracción probada |
| **Riesgo principal** | Costo de desarrollo de la app (USD 2.000-5.000 único) antes de tener MRR que lo justifique. |

---

### Fase VI — Segunda línea de ingresos: Creator/API (2027+)

| Campo | Detalle |
|-------|---------|
| **Objetivo** | Monetizar el track record y la distribución más allá del usuario final. |
| **Qué se construye** | Creator plan (acceso API, exportación de datos, cards compartibles); pricing por tier; documentación pública |
| **Condición de activación** | Track record consolidado ≥3 ligas con ≥200 partidos cada una + demanda demostrada (usuarios que piden acceso API) + capacidad de soporte |
| **Ingreso directo** | [ESPECULATIVO] — sin demanda validada hoy. Comparable: sports data API en RapidAPI USD 9-99/mes. Con 50 creators × USD 29 = USD 1.450/mes — posible, no planeable. |
| **Clasificación de certeza** | **Especulativa.** No entra al caso base. |
| **Riesgo principal** | Construir antes de validar demanda. Un developer tier sin usuarios es costo de infraestructura sin retorno. |

---

### Fase VII — B2B selectivo (2028+)

| Campo | Detalle |
|-------|---------|
| **Objetivo** | Tickets altos, institucionalización del moat. |
| **Qué se explora** | Widgets para medios hispanohablantes, dashboards privados para periodistas, licencias de datos a ligas o federaciones |
| **Condición de activación** | Base de usuarios Pro consolidada (>2.000), track record en ≥5 ligas, reputación establecida, capacidad de sales motion |
| **Ingreso directo** | [ESPECULATIVO] — no modelable hoy. |
| **Clasificación de certeza** | **Especulativa.** No entra al caso base. |
| **Riesgo principal** | Sales motion consume tiempo del fundador antes de tener el core validado.

---

## 13. Métricas Clave

### 13.1 Métricas de producto

| Métrica | Meta 6 meses | Meta 18 meses |
|---------|--------------|----------------|
| MAU | 6.000–12.000 | 20.000–55.000 |
| DAU/MAU ratio | > 25% | > 35% |
| Retención D30 | > 40% | > 50% |
| Predicciones vistas/usuario/mes | > 5 | > 8 |
| Visitas en días sin partido del equipo favorito | > 2/semana | > 3/semana |
| CTR alerta "predicción actualizada" | baseline (60 días) | > 20% |
| CTR alerta "alta relevancia detectada" | baseline (60 días) | > 15% |
| Apertura lunes de accuracy | — | > 30% de MAU activos |
| Registros atribuidos a contenido / semana | baseline (90 días) | KPI de corte por pieza y día |

> **Nota:** Las dos métricas de alertas arrancan en baseline durante los primeros 60 días. El objetivo no es un número predefinido sino determinar cuál de los dos tipos genera retorno real y con qué margen de diferencia, para priorizar o eliminar en consecuencia.

### 13.2 Proyecciones financieras — dos escenarios

Las proyecciones se basan en los benchmarks de conversión freemium verificados por RevenueCat (2025) y First Page Sage (2026).

**Fórmula:** `MRR = Usuarios_Reg × P_conversion × ARPPU_neto`
**ARPPU_neto = ~$5.20 precio bruto ponderado × (1 − 8.5% fee Stripe) ≈ $4.75/mes**

> Versiones anteriores de este documento usaban ARPPU $5.50 sin deducción de fees. Los valores corregidos son ~14% menores. El break-even (~200 suscriptores) no cambia.

#### Escenario Conservador — conversión 2.5%

| Período | Usuarios reg. | Pro | MRR neto ($4.75) |
|---------|--------------|-----|----------|
| 6 meses | 8.000 | 200 | **USD 950** |
| 12 meses | 18.000 | 450 | **USD 2.138** |
| 18 meses | 35.000 | 875 | **USD 4.156** |

#### Escenario Base — conversión 3.5%

| Período | Usuarios reg. | Pro | MRR neto ($4.75) |
|---------|--------------|-----|----------|
| 6 meses | 12.000 | 420 | **USD 1.995** |
| 12 meses | 30.000 | 1.050 | **USD 4.988** |
| 18 meses | 55.000 | 1.925 | **USD 9.144** |

#### Escenario Optimista — conversión 5%

| Período | Usuarios reg. | Pro | MRR neto ($4.75) |
|---------|--------------|-----|----------|
| 6 meses | 15.000 | 750 | **USD 3.563** |
| 12 meses | 45.000 | 2.250 | **USD 10.688** |
| 18 meses | 80.000 | 4.000 | **USD 19.000** |

> El escenario optimista requiere conversión en el percentil 75 de la industria para apps freemium de nicho. Es posible con un producto muy diferenciado, pero no es la base de planificación.

> **Base de planificación recomendada:** escenario conservador para costos y escenario base para inversión en crecimiento. El optimista como referencia de upside, no como expectativa.

> **Publicidad display — flujo complementario pre-paywall:** los tres escenarios anteriores modelan solo ingresos de suscripción. La publicidad display (§7.2) agrega un flujo independiente estimado en USD 200–600/mes con 10K MAU, escalando a USD 800–2.000/mes con 30K MAU (CPM USD 2–3, sin apuestas). Es pre-paywall — se genera sin requerir que el usuario convierta. No forma parte de los escenarios porque no es la palanca de valor del negocio, pero sí reduce el tiempo hasta el break-even.

> **Nota sobre churn:** Los escenarios anteriores muestran suscriptores activos en un momento dado, no acumulados. Con churn del 3% mensual (base de industria), mantener 1.925 suscriptores activos a los 18 meses requiere adquirir y retener continuamente — no solo convertir. El cálculo de usuarios registrados necesarios ya incorpora este efecto: con churn 3%/mes, steady-state de 1.925 subs requiere ~58 nuevas conversiones/mes para compensar la pérdida de ~58/mes.

### 13.3 Métricas de credibilidad del modelo

| Métrica | Umbral mínimo |
|---------|--------------|
| Accuracy 1X2 general | > 52% |
| Accuracy en alta confianza (p > 65%) | > 60% |
| Brier Score promedio | < 0.22 |
| Partidos evaluados por liga activa | ≥ 200 |
| Ligas con track record público | 3 a 6 meses / 6 a 18 meses |

Estas métricas se publican tal cual, incluyendo malos resultados. El compromiso con la transparencia no es negociable una vez iniciado el track record público.

---

---

## 14. Matriz de Supuestos — Mapa de Certeza por Línea de Ingreso

> Esta sección explicita cada supuesto material del modelo económico. Distingue hechos verificados de supuestos plausibles y de inferencias especulativas. Solo las líneas con nivel de confianza alto/medio entran al caso base. Las demás son upside condicional.

| Línea de ingreso | Fórmula | Variable crítica | Benchmark | Fuente | Rango conservador / base / agresivo | Confianza | Clasificación | ¿Caso base? | Comentario |
|---|---|---|---|---|---|---|---|---|---|
| **Suscripción Pro** | Usuarios_Reg × P_conv × ARPPU_neto | P_conversión | 2.18% mediana industria; 3–5% bueno | RevenueCat 2025 | 2.5% / 3.5% / 5.0% | **Alta** | Hecho + supuesto plausible | **SÍ** | El modelo es freemium SaaS verificado. La conversión específica de SportsPulse no está medida. ARPPU corregido a $4.75 neto. |
| **ARPPU neto** | $5.20 × (1 − 8.5%) | Fee efectivo Stripe | 2.9% + $0.30/tx → ~8.5% en tickets bajos LATAM | Stripe pricing + IAP rates | $4.50 / $4.75 / $5.10 | **Alta** | Hecho calculable | **SÍ** | El 8.5% refleja la mezcla de precios $3.99–$7.99 más IAP en iOS/Android (30% Apple/Google fee). |
| **Usuarios registrados (18m)** | Sin fórmula interna — supuesto de adquisición | Tracción orgánica + efecto Mundial | SofaScore: años para 28M global; FotMob: bootstrapped, 20M | — | 20.000 / 35.000–55.000 / 80.000 | **Baja** | Supuesto especulativo | **SÍ** (como rango) | El número más difícil de modelar. Depende de SEO, tracción orgánica y efecto Copa del Mundo. No existe modelo de adquisición validado. |
| **Publicidad display** | MAU × ses/día × páginas × 30 × CPM × fill / 1000 | CPM real (no-apuestas) | IAB: $2–3 CPM sports sin gambling | IAB + AdMob benchmarks | $150 / $400 / $800 /mes a 10K MAU | **Media** | Supuesto plausible | **NO** (complementario, no sostiene el caso base) | Existe el mecanismo; la incertidumbre es CPM real y fill rate de un sitio nuevo sin DMP. Reduce tiempo al break-even pero no es palanca de valor. |
| **Afiliación streaming** | Conversiones × CPA | CPA real (sin contrato) | Sin programa activo en LATAM | — | $0 / $0 / variable según acuerdo | **Ninguna** | Especulativo | **NO** | Sin programa firmado, sin CPA verificable. Ingresa al modelo solo si existe contrato activo con términos concretos (Fase IV+). |
| **Creator/API** | Creadores × precio/tier | Demanda real | RapidAPI sports APIs: $9–99/mes | RapidAPI marketplace | $0 / $0 / $1.500/mes (50 creators) | **Ninguna** | Especulativo | **NO** | Sin señal de demanda hoy. Condición: track record ≥3 ligas consolidado y usuarios que pidan API activamente. |
| **B2B (licencias, widgets)** | Contratos × ticket | Sales motion | No modelable sin pipeline | — | $0 / $0 / variable | **Ninguna** | Especulativo | **NO** | Requiere base Pro consolidada, reputación establecida, capacidad de sales motion. No antes de 2028. |

**Resumen de certeza:**

| Nivel | Líneas que lo tienen |
|-------|---------------------|
| Alta | Suscripción Pro (mecanismo), ARPPU neto (calculable) |
| Media | Publicidad display (mecanismo existe, magnitud incierta) |
| Baja | Usuarios registrados (supuesto central no validado) |
| Ninguna | Afiliación streaming, Creator/API, B2B |

---

## 15. Caso Base vs Upside — Separación Explícita

> El caso base descansa en una sola línea: **suscripción Pro**. Todas las demás líneas son upside condicional. Esta separación no es conservadurismo — es la única forma honesta de evaluar la viabilidad del negocio sin que líneas especulativas distorsionen el análisis.

### 15.1 Caso base (lo que se planifica)

El caso base descansa **exclusivamente en suscripción Pro**. La publicidad display, si existiera, es un flujo complementario de baja certeza que no entra al total del caso base.

| Línea | Escenario conservador | Escenario base |
|-------|----------------------|----------------|
| Suscripción Pro | 875 subs × $4.75 = **USD 4.156/mes** | 1.925 subs × $4.75 = **USD 9.144/mes** |
| **Total caso base** | **USD 4.156/mes** | **USD 9.144/mes** |

> **Nota metodológica:** La publicidad display (§7.2) puede agregar un flujo complementario de ~USD 200-600/mes a 10K MAU, pero su magnitud es incierta (CPM, fill rate sin DMP propio) y no es la palanca de valor del negocio. Incluirla en el total del caso base inflaría la viabilidad percibida con una línea de baja certeza. Si se materializa, acorta el tiempo al break-even — no justifica la tesis central.

### 15.2 Upside condicional (lo que se activa si se cumplen condiciones)

| Línea | Condición de activación | Upside estimado (si se activa) |
|-------|------------------------|-------------------------------|
| Afiliación streaming | Acuerdo firmado con términos concretos (DAZN, ESPN+) + Fase IV | +$500–2.000/mes |
| Creator/API | Demanda demostrada + track record ≥3 ligas | +$500–3.000/mes |
| B2B | Base Pro >2.000 + reputación establecida + sales motion | +$2.000–10.000/contrato |

### 15.3 Lo que este plan NO hace

- No promediar caso base y upside para llegar a proyecciones más atractivas
- No asumir que un acuerdo de afiliación se va a cerrar solo porque es lógico que exista
- No planificar capacidad operativa en función de líneas especulativas
- No presentar la suma de todos los escenarios upside como el "caso base verdadero"

El negocio funciona sin el upside. Si el upside se activa, es aceleración — no rescate.

---

## 16. Estructura de Costos

### 16.1 Costos operativos actuales

| Item | Costo mensual |
|------|--------------|
| Render (hosting) | USD 20-50 |
| APIs de datos | USD 0-30 |
| Dominio + SSL | USD 2 |
| **Total actual** | **USD 22-82** |

### 16.2 Costos adicionales al escalar

| Item | Cuándo | Costo est. |
|------|--------|-----------|
| API-Football upgrade (Liga MX + LATAM) | Oleada 2 si free tier insuficiente | USD 10-50/mes |
| Stripe fees | Al activar Pro | 2.9% + USD 0.30/transacción |
| Auth provider (Clerk/Auth0) | Al activar registro | USD 0-25/mes hasta 10K MAU |
| Email (Resend/Postmark) | Al activar alertas | USD 20-50/mes |
| Producción de contenido semanal | Fase Sprint (automatizado) | USD 0 — pipeline técnico sobre datos existentes |
| Push notifications | Fase D-E | USD 0-50/mes |
| Infraestructura adicional | >30K MAU | USD 150-400/mes |
| App mobile nativa | Fase E | USD 2.000-5.000 (único) |
| **Total a escala (18 meses)** | | **USD 400-700/mes** |

### 16.3 Punto de equilibrio

`200 suscriptores Pro × USD 4.75 (ARPPU neto unificado) = USD 950/mes vs USD 500-700 de costos operativos.`

> Se usa el ARPPU neto unificado de USD 4.75 consistente con el resto del plan (precio bruto ponderado ~$5.20 × (1−8.5% fee blended)). El modelo es rentable desde muy temprano. El riesgo financiero no es la estructura de costos — es llegar a los primeros 200 suscriptores.

---

## 17. Riesgos Estratégicos

> Esta sección identifica los riesgos materiales ordenados por impacto potencial sobre la viabilidad del negocio. Se distinguen riesgos de supuesto (que afectan la lógica del modelo) de riesgos de ejecución (que afectan la operación) y riesgos estructurales (que afectan la posición a largo plazo).

### 17.1 Riesgo 1 — Conversión freemium inferior a la mediana de industria [IMPACTO ALTO]

**Supuesto en riesgo:** conversión free→Pro de 2.5-3.5%.

**Escenario adverso:** conversión real del 1-1.5% (debajo de la mediana industria de 2.18%) por cualquier combinación de: paywall mal diseñado, track record insuficiente al momento del lanzamiento Pro, falta de aha moment efectivo.

**Impacto cuantificado:** Con 55.000 usuarios registrados y conversión 1.5%, MRR = 825 × $4.75 = $3.919 — por encima del break-even, pero con poco margen para crecer. Con 35.000 registrados y 1.5%, MRR = $2.494 — operable pero estrecho.

**Indicadores de alarma:** si a 90 días del paywall activo la conversión está por debajo de 1.5%, investigar en este orden: (1) gate de registro funciona pero trial no convierte → revisar features Pro; (2) registro bajo → el aha moment no ocurre → revisar página de accuracy; (3) conversión cero → el paywall no está siendo alcanzado → revisar distribución de usuarios por etapa del funnel.

**Mitigación:** no activar el paywall hasta tener D30 > 35% demostrado. Trial de 7 días para reducir la barrera percibida. No proyectar con escenario optimista en planificación operativa.

---

### 17.2 Riesgo 2 — No llegar a masa crítica de usuarios registrados antes del paywall [IMPACTO ALTO]

**Supuesto en riesgo:** 35.000–55.000 usuarios registrados a 18 meses.

**Escenario adverso:** 10.000–15.000 usuarios registrados por tracción orgánica débil o falta de efecto Mundial. Con conversión 3.5%, MRR = 525 × $4.75 = $2.494 — operable, pero el modelo no escala.

**Por qué este riesgo es el más difícil de modelar:** no existe modelo de adquisición validado. El efecto Copa del Mundo es una ventana extraordinaria pero no garantizada — depende de que el producto esté listo antes del 11 de junio y de que la tracción orgánica arranque bien en la Fase 0.

**Mitigación:** SEO activado antes del Mundial (sitemap + prerendering 64 partidos). Pipeline de contenido semanal desde Fase 0. No gastar en paid acquisition antes de tener retención D30 demostrada. El break-even no requiere 35.000 usuarios — requiere 200 subs Pro.

---

### 17.3 Riesgo 3 — Accuracy insuficiente para sostener la propuesta de valor [IMPACTO CRÍTICO]

**Naturaleza del riesgo:** si el motor predictivo tiene accuracy sistemáticamente inferior a las casas de apuestas (benchmark: 53-54%) en ligas con historial suficiente, el diferencial central del producto colapsa.

**Por qué es crítico:** todo el posicionamiento descansa en que SportsPulse es verificablemente honesto sobre su modelo. Si el modelo es mediocre y se publica el historial de todos modos (como lo requiere el principio de transparencia), la credibilidad se destruye más rápido que si no se hubiera publicado nada.

**Escenario adverso:** accuracy general de 48-50% en ligas con ≥200 partidos — plausible si el modelo no está suficientemente calibrado para la dispersión de resultados en ciertas ligas (ej. Copa Libertadores con muchos equipos pequeños).

**Mitigación:** no publicar el accuracy de ninguna liga antes de tener ≥200 partidos evaluados y una curva de calibración revisada. Si el accuracy es bajo en una liga específica, no publicar esa liga — no intentar esconder el número. El disclosure honesto ("el modelo tiene accuracy del X% en esta liga — aquí está el historial completo") siempre es mejor que no publicar nada.

---

### 17.4 Riesgo 4 — FlashScore / BeSoccer cubre el segmento hispanohablante con predicciones [IMPACTO MEDIO-ALTO]

**Señal existente:** FlashScore adquirió BeSoccer en 2024 — señal explícita de interés en el mercado hispanohablante. Con 155M MAU, tienen distribución masiva.

**Escenario adverso:** FlashScore/BeSoccer lanza predicciones propias con track record fabricado retroactivamente (no walk-forward, sino backtest presentado como historial).

**Por qué el moat aguanta:** el track record walk-forward es el activo que no se puede fabricar. Un historial de predicciones retroactivo no tiene timestamps anteriores al partido — cualquier usuario que sepa hacer esa pregunta lo detecta. La ventaja de SportsPulse no es el modelo matemático (que pueden comprar) — es el historial verificable acumulado mes a mes.

**Mitigación:** acelerar la acumulación de partidos en Copa Libertadores y Liga MX — son las ligas donde FlashScore/BeSoccer tienen menos datos históricos confiables y más dificultad para construir un track record creíble.

---

### 17.5 Riesgo 5 — Churn elevado post-conversión Pro [IMPACTO MEDIO]

**Supuesto en riesgo:** churn mensual < 3% (base de industria para SaaS de nicho).

**Escenario adverso:** churn del 6-8% mensual si los features Pro no generan hábito post-pago o el trial de 7 días no crea retención real.

**Impacto cuantificado:** con churn 6%/mes en vez de 3%/mes, para mantener 1.925 subs activos se necesitan ~115 nuevas conversiones por mes (vs ~58). Eso aumenta la presión sobre adquisición y duplica el costo efectivo de cada suscriptor.

**Indicadores de alarma:** si el churn en los primeros 90 días post-paywall supera el 5%, revisar: (1) si el trial de 7 días está creando dependencia real o solo curiosidad transitoria; (2) si las alertas inteligentes están operativas (son la palanca de retención más fuerte); (3) si el lunes de accuracy está creando hábito semanal.

---

### 17.6 Riesgo 6 — Regulación de predicciones deportivas por mercado [IMPACTO BAJO — gestionable]

**Naturaleza del riesgo:** en México, la regulación de juegos online es compleja. Argentina tiene cambios recurrentes. En España aplica regulación de publicidad de predicciones.

**Por qué no es bloqueante:** SportsPulse publica estadísticas — funcionalmente equivalente a un periódico que publica pronósticos en su sección deportiva. No opera como plataforma de apuestas, no procesa apuestas, no tiene skin in the game. La pregunta legal no es "¿necesita licencia de juego?" — es "¿cómo se clasifica la suscripción a análisis estadísticos bajo el marco local?".

**Mitigación:** consulta legal amplia en México y Argentina durante Fase 0 (paralelo al desarrollo, no bloqueante). Activar pagos en agosto 2026 con opinión legal obtenida. No framing de "señales para apostar" en ningún material. Para España: cumplir regulación de publicidad de pronósticos desde el lanzamiento.

---

## 18. Consideraciones Éticas y Legales

### 18.1 Posición respecto a apuestas

SportsPulse produce probabilidades estadísticas equivalentes a lo que publica un periódico en su sección de pronósticos. No es una plataforma de apuestas.

- España: publicidad de predicciones deportivas está regulada. Evitar cualquier framing de "señales para apostar".
- México: regulación de juegos es compleja. Revisión legal antes de activar pagos.
- USA: sports analytics sin apuestas es permisivo a nivel federal. CCPA aplica en California.
- Argentina: sin restricciones específicas sobre predicciones estadísticas.

### 18.2 Privacidad

Con usuarios en España aplica GDPR. Con usuarios en California aplica CCPA. Requisitos: política de privacidad en español, consentimiento explícito para marketing, derecho al olvido, no venta de datos a terceros.

### 18.3 Derechos de datos

Football-data.org, TheSportsDB y API-Football permiten uso comercial bajo sus planes de pago. Verificar que los planes contratados cubren uso comercial y los volúmenes proyectados antes de escalar.

---

## 19. Equipo y Recursos

### 19.1 Estado actual

Producto construido por equipo mínimo. Arquitectura coherente, sin deuda técnica de múltiples visiones.

### 19.2 Lo que se necesita por fase

| Rol | Cuándo | Notas |
|-----|--------|-------|
| Diseñador UI/UX | Fase C (registro, onboarding) | El onboarding bien diseñado puede duplicar la conversión |
| Community manager / creador de contenido | Fase A | Clave para la estrategia de Twitter/X, TikTok y newsletter |
| Asesor legal | Antes de activar pagos | GDPR, CCPA, regulación predicciones por mercado |
| Contador / fiscal | Antes de activar pagos | Estructura para recibir ingresos en múltiples monedas |

### 19.3 Lo que NO se necesita ahora

- Equipo de ventas, equipo de data science separado, inversores externos.

---

## 20. Financiamiento

### 20.1 Postura recomendada: bootstrapped

Costos de USD 400-700/mes, break-even a ~200 suscriptores. Rentable sin inversión externa. La independencia editorial que es el diferencial central del producto es incompatible con inversores que traigan presión por monetización vía apuestas.

### 20.2 Si se busca financiamiento

Se activa cuando: >30K MAU con retención D30 > 40% demostrada, >1.000 Pro activos, tracción orgánica documentada.

Perfil de inversor: angels o fondos en SaaS / medios deportivos hispanohablantes. No: fondos ligados a industria de apuestas.

### 20.3 Copa del Mundo 2026 como ventana de adquisición inmediata

Copa del Mundo 2026 arranca el **11 de junio de 2026** — 87 días desde la fecha de este plan. Se juega en USA, México y Canadá. Es la mayor ventana de exposición posible para un producto hispanohablante con foco en LATAM y US Latinos.

**La postura correcta:** el Mundial llega antes de que el paywall Pro y el sistema de usuarios estén completamente construidos. No es una falla — es la secuencia correcta si se ejecuta bien. El Mundial construye la base de usuarios; la monetización viene después con esa base.

**Lo que tiene que estar listo antes del 11 de junio:** accuracy público, registro de usuario, predicciones del Mundial, comparación vs mercado activa. Todo esto es técnicamente alcanzable con el producto existente.

**Lo que no va a estar listo para el Mundial:** paywall Pro completo, alertas push, app mobile. Eso no impide aprovechar el torneo — impide monetizarlo directamente. La monetización viene en agosto–diciembre 2026 con la base construida durante el torneo.

El riesgo real no es llegar sin paywall. Es llegar sin registro de usuario y perder audiencia anónima irrecuperable.

---

## 21. Veredicto Estratégico

### 21.1 Qué está validado

| Elemento | Estado |
|----------|--------|
| Modelo freemium SaaS como mecanismo de monetización | **Validado externamente** (RevenueCat, FotMob, Spotify, Duolingo — el modelo existe y funciona) |
| Break-even alcanzable con escala mínima | **Calculable** — 200 subs Pro a $4.75 neto = $950/mes vs $500-700 de costos |
| Track record como activo irreplicable | **Validado conceptualmente** — el historial walk-forward con timestamps no se fabrica |
| Motor predictivo con arquitectura verificable | **Hecho técnico** — el motor existe, está en producción |
| Vacío de mercado real en análisis independiente hispanohablante | **Verificado empíricamente** — ningún competidor activo con track record público en español |
| Copa del Mundo 2026 como ventana de adquisición real | **Hecho estructural** — 11 junio, 64 partidos, 87 días desde ahora |

### 21.2 Qué no está validado (supuestos que el negocio requiere)

| Supuesto | Nivel de incertidumbre | ¿Puede validarse antes de escalar? |
|----------|-----------------------|------------------------------------|
| Conversión free→Pro ≥ 2.5% | Alta | Sí — se mide a 90 días del paywall activo |
| 35.000–55.000 usuarios registrados a 18 meses | Muy alta | Parcialmente — tracción en Fase 0/I da señal temprana |
| Retención D30 > 35% | Alta | Sí — se mide antes de activar el paywall |
| Churn mensual < 5% post-conversión | Alta | Sí — se mide en primeros 90 días de Pro |
| Efecto Copa del Mundo en adquisición orgánica | Incierta | Solo en el momento — sin evidencia previa para SportsPulse |

### 21.3 Veredicto por dimensión

**Viabilidad financiera en caso base:** ✅ **VIABLE**

El caso base (escenario conservador a 18 meses: $4.156 MRR) cubre costos operativos con margen. El break-even no requiere escala extraordinaria ni un evento extraordinario — solo ejecución competente del paywall con la base de usuarios que el producto ya tiene potencial de generar.

**Ventana de timing:** ✅ **FAVORABLE Y ACOTADA**

Copa del Mundo 2026 es el mayor evento de búsqueda orgánica de fútbol de la década. Los 87 días hasta el inicio del torneo son suficientes para tener registro, track record público y predicciones activas — si se ejecuta bien. Esta ventana no se repite.

**Moat competitivo:** ✅ **REAL, PERO ACUMULATIVO**

El track record walk-forward es el único activo del plan que no puede ser comprado ni fabricado retroactivamente. Es real — pero solo existe en la medida en que se acumula. Hoy el moat es frágil. A 12 meses con Copa Libertadores y Liga MX activas, es sólido.

**Modelo de revenue:** ✅ **LIMPIO Y COHERENTE**

Un solo mecanismo principal (suscripción Pro), honesto sobre su nivel de certeza, sin líneas secundarias que sostengan el caso base de forma ficticia. Las líneas especulativas están correctamente etiquetadas como upside condicional.

**Riesgo central:** ⚠️ **LA CONVERSIÓN**

Todo el modelo depende de que usuarios gratuitos paguen. Esa conversión no está medida para SportsPulse. La mediana de industria es 2.18% — posiblemente alcanzable dado el nivel de diferenciación, pero no garantizada. El plan es viable si la conversión es 1.5%+. Si está por debajo del 1%, el modelo necesita revisión profunda del gate de pago.

### 21.4 Recomendación de prioridades

1. **Antes del 11 de junio (87 días):** registro de usuario + accuracy público + predicciones del Mundial + pipeline de contenido automatizado. Todo lo demás es secundario.

2. **No activar el paywall antes de tener retención D30 medida.** Intentar monetizar con baja retención penaliza la conversión y es difícil de recuperar.

3. **El primer número que hay que validar es la conversión real** — no el tráfico total, no los registros totales. El KPI de cierre de Fase III es conversión ≥ 2% y churn ≤ 5% durante 60 días consecutivos.

4. **Copa Libertadores y Liga MX tienen prioridad de desarrollo después del Mundial** — son las ligas donde el moat es más urgente de construir y donde FlashScore tiene menor historial verificable.

5. **No escalar paid acquisition antes de validar retención.** El costo de adquirir usuarios que no retienen es dinero perdido — y la señal más cara para aprender algo que debería haberse medido antes.

---

*SportsPulse tiene el producto, el motor y la ventana de timing. Lo que no tiene todavía es la evidencia de conversión. Ese es el único número que convierte este plan de "plausible" a "validado". Todo el roadmap hasta Fase III está diseñado para obtener esa evidencia lo antes posible.*

---

## Fuentes

1. [FlashScore: 155M MAU, 400M descargas — iGamingToday, oct 2025](https://www.igamingtoday.com/flashscore-hits-record-growth-with-155-million-monthly-users/)
2. [SofaScore: top apps 2026 — SofaScore.com](https://www.sofascore.com/news/sofascore-among-top-sports-apps-in-2026/)
3. [FotMob: revenue y crecimiento 2024 — Mainsights](https://www.mainsights.io/ma-news/fotball-app-fotmob-explores-acquisition-opportunities-amidst-strong-financial-growth)
4. [US Hispanic population — McKinsey Institute for Economic Mobility, 2025](https://www.mckinsey.com/institute-for-economic-mobility/our-insights/unlocking-the-growing-power-of-latino-fans-building-a-stronger-sports-economy)
5. [Latinos gastan 15% más en deportes — Nielsen, 2024](https://www.nielsen.com/news-center/2024/hispanic-sports-fans-record-viewership-brand-loyalty-audiences-sports-media-engagement-2024-diverse-numerical-series-report/)
6. [Liga MX más vista en USA 2025 — Goal.com](https://www.goal.com/en-us/lists/liga-mx-remains-the-most-watched-soccer-league-on-u-s-television/blt2eb5436af5948721)
7. [Copa América final 2024: 12M viewers, 53% hispanos — beIN Sports](https://www.beinsports.com/en-us/soccer/copa-america/articles-video/the-records-broken-by-the-2024-copa-am%C3%A9rica-2024-07-28)
8. [Latinos = 1/3 del crecimiento deportivo en USA hasta 2035 — McKinsey](https://www.mckinsey.com/institute-for-economic-mobility/our-insights/unlocking-the-growing-power-of-latino-fans-building-a-stronger-sports-economy)
9. [Penetración de internet LATAM — DataReportal Digital 2025](https://datareportal.com/reports/digital-2025-global-overview-report)
10. [Suscripciones en LATAM: Argentina y México — Bango Subscription Wars Latin America, 2024](https://bango.com/reports/subscription-wars-latin-america/)
11. [OneFootball: USD 320M recaudados, reducción de workforce — Tracxn](https://tracxn.com/d/companies/one-football/__J5H-jsh0u6URE-WFtfI0mxAM8DydkceA0WExSHlrdfc)
12. [Benchmarks conversión freemium — RevenueCat State of Subscription Apps 2025](https://www.revenuecat.com/state-of-subscription-apps-2025/)
13. [Benchmarks freemium SaaS — First Page Sage 2026](https://firstpagesage.com/seo-blog/saas-freemium-conversion-rates/)
14. [Sports App Market size 2034 — Precedence Research](https://www.precedenceresearch.com/sport-app-market)

---

## Anexo A — Cómo generan ingresos los competidores existentes

> Análisis realizado en marzo 2026 con datos verificados de fuentes públicas. Sirve de referencia para entender el ecosistema de monetización en el que opera SportsPulse y justifica la decisión estratégica de no depender de afiliación de apuestas.

### A.1 El patrón dominante: tráfico de apuestas disfrazado de app de resultados

Casi todas las apps de resultados deportivos son gratuitas para el usuario, pero su audiencia tiene un valor enorme para las casas de apuestas. El fanático que sigue partidos en tiempo real es exactamente el usuario que las casas de apuestas quieren capturar. Ese es el negocio real de la mayoría.

### A.2 SofaScore — Publicidad in-app con sesgo hacia apuestas

**Escala:** ~35M MAU. **Revenue estimado:** ~USD 16M anuales. **= USD 0.46 por usuario por año.**

El modelo es publicidad in-app (IAA). Pero el 80% de los banners son de Bet365, Betway, Bwin y similares — no por casualidad. Los anunciantes de apuestas pagan CPMs muy superiores a cualquier otro sector en apps deportivas. Un CPM estándar en apps de entretenimiento es USD 2–5. En una app deportiva con perfil de apostador: USD 10–30+.

SofaScore no tiene suscripción Pro relevante. Sin el subsidio de apuestas, el CPM colapsa y el modelo no financia la operación.

### A.3 FlashScore — Apuestas como negocio central, no como publicidad lateral

**Escala:** 155M MAU, 400M descargas. **Revenue:** no divulgado, claramente mayor que SofaScore por escala.

FlashScore ganó el **SBC Affiliate Leaders Award junto a Bet365 Partners** en Lisboa — eso no es publicidad lateral, es afiliación directa. El modelo:

- El usuario hace clic en un link de odds dentro de FlashScore
- Abre cuenta en Bet365, deposita EUR 100
- Bet365 paga a FlashScore un **30% de las pérdidas netas del usuario — para siempre** (revenue share)
- Si ese usuario pierde EUR 500 en un año, FlashScore cobró EUR 150 por haberlo referido

Adicionalmente: licencia su base de datos de partidos a plataformas de apuestas y medios.

**La adquisición de BeSoccer (España, Brasil, Italia, Francia) en 2024 se entiende en este contexto:** más usuarios hispanohablantes = más afiliación en mercados con casas de apuestas reguladas.

### A.4 FotMob — El más honesto: ads + suscripción "propina"

**Escala:** 20M MAU. **Revenue:** EUR 11M en 2024 (+47% interanual). **Ganancia:** EUR 5.4M. **= EUR 0.55 por usuario por año.**

Revenue mix documentado:
1. **Display ads** (mayoría): partners incluyen Paramount+, Apple TV+, TNT — no solo apuestas. Venden inventario directamente.
2. **Affiliate commissions**: también tienen afiliación de apuestas, menos central que FlashScore.
3. **FotMob Pro**: suscripción que quita ads y da features adicionales. El propio equipo la describe como "tip jar" — los usuarios la pagan más para apoyar el producto que por los features. No es fuente de revenue significativa.

FotMob es un negocio rentable y bootstrapped. Pero EUR 0.55/usuario/año implica que la escala de 20M usuarios es necesaria para sostener el negocio.

### A.5 OneFootball — El experimento de streaming que casi los hunde

**Financiamiento:** USD 320M recaudados. **Rentabilidad:** no alcanzada de forma sostenida.

OneFootball apostó a un modelo completamente diferente: plataforma de distribución directa (DTC) para ligas. Las ligas que no consiguen derechos de TV en ciertos mercados usan OneFootball para vender pases de temporada y pay-per-view directamente al fan. OneFootball cobra comisión por transacción.

Ejemplos reales:
- **Bundesliga Pass** en India, Vietnam, Sudáfrica — todos los partidos via PPV
- **Serie A en UK** — compensar un deal de TV reducido a la mitad con PPV via OneFootball

El problema: requiere adquirir derechos (costoso), infraestructura de streaming (muy costoso) y escalar usuarios pagantes (lento). USD 320M recaudados, 250 personas despedidas en 2023, aún buscando equilibrio.

### A.6 Cuadro comparativo

| App | Revenue principal | Rol de las apuestas | Revenue/usuario/año | Suscripción propia |
|-----|------------------|---------------------|--------------------|--------------------|
| FlashScore | Afiliación apuestas + ads | **Central** — ganó award de afiliación con Bet365 | No divulgado | No existe |
| SofaScore | Publicidad in-app (CPM) | **Dominante** — casi todos los ads son de apuestas | ~USD 0.46 | No relevante |
| FotMob | Display ads + algo de afiliación | Presente, no central | ~EUR 0.55 | Existe, es "propina" |
| OneFootball | Streaming PPV + comisión DTC | Ninguno | Negativo (aún) | No (es PPV) |

### A.7 Implicación para SportsPulse

La industria entera está subsidizada por apuestas. Sin ese subsidio, el CPM de publicidad estándar en una app deportiva no financia el desarrollo ni la infraestructura.

SportsPulse rechaza ese modelo. El costo: no podés financiarte con CPM de apuestas, el revenue por usuario gratuito será bajo (USD 0.20–0.50/año si se usan ads estándar). La ventaja: el revenue por suscriptor Pro es radicalmente superior.

| | FotMob | SportsPulse (escenario base 18 meses) |
|--|--------|---------------------------------------|
| Usuarios totales | 20M | 55K |
| Revenue/año | EUR 11M | ~USD 127K |
| Revenue/usuario/año | EUR 0.55 | ~USD 2.30 |
| Modelo | Ads + "propina" | Suscripción |

A 55K usuarios SportsPulse genera menos revenue total — obviamente. Pero genera **4x más por usuario** porque el modelo es suscripción. Y el break-even no requiere 20M usuarios. Requiere 200 suscriptores Pro.

### A.8 Fuentes de este anexo

- [FlashScore: SBC Affiliate Leaders Award con Bet365 — Sports Betting Operator](https://sportsbettingoperator.com/news/bet365-partners-clever-advertising-and-flashscore-shine-at-inaugural-sbc-affiliate-leaders-awards-in-lisbon/)
- [FlashScore: modelo de negocio — TechGropse](https://www.techgropse.com/blog/flashscore-business-model/)
- [SofaScore revenue ~USD 16M — Owler](https://www.owler.com/company/sofascore)
- [FotMob: revenue EUR 11M, ganancia EUR 5.4M 2024 — Mainsights](https://www.mainsights.io/ma-news/fotball-app-fotmob-explores-acquisition-opportunities-amidst-strong-financial-growth)
- [FotMob: modelo "tip jar" — iGamingToday](https://www.igamingtoday.com/fotmob-the-norwegian-success-story-youve-probably-never-heard-of/)
- [OneFootball: Bundesliga Pass DTC — Bundesliga.com](https://www.bundesliga.com/en/bundesliga/news/dfl-launches-bundesliga-ott-offering-with-onefootball-to-reach-millions-of-fans-across-international-markets-30130)
- [OneFootball: Serie A UK experiment — SportBusiness Media](https://media.sportbusiness.com/2024/09/serie-a-seeks-to-offset-uk-shortfall-in-onefootball-experiment/)
- [Betting affiliate commissions: Bet365 30% revenue share — Business of Apps](https://www.businessofapps.com/affiliate/betting/)
- [Global sports betting revenue USD 44.2B en 2024 — Business of Apps](https://www.businessofapps.com/data/sports-betting-app-market/)

---

## Anexo B — Precisión del predictor y umbral de conversión

> Análisis realizado en marzo 2026. Define qué nivel de accuracy es necesario para que el usuario pague, cómo percibe ese valor, y cuál es el diseño del "aha moment" que convierte un usuario gratuito en suscriptor Pro.

### B.1 El benchmark de referencia: no el azar, sino las casas de apuestas

El error común es medir el predictor contra el azar. El benchmark correcto es el mejor predictor público disponible: las casas de apuestas.

| Método | Accuracy 1X2 | Fuente |
|--------|-------------|--------|
| Selección aleatoria | ~38% | Graham Kendall, Sports Forecasting |
| Modelo naïve (siempre predice victoria local) | ~50% | Ibid. |
| **Tipsters** (influencers de predicciones con millones de seguidores) | **~43%** | Ibid. — peor que el modelo naïve |
| Modelos ML en investigación académica | 51–63% | ScienceDirect, arXiv |
| **Casas de apuestas / mercados de predicción** | **~53–54%** | Graham Kendall — el mejor predictor público |

Las casas de apuestas, con toda su infraestructura y capital, aciertan el 53–54% de las predicciones 1X2. Ese es el techo de referencia para cualquier modelo independiente en condiciones reales.

El motor de SportsPulse tiene como target >52% general y >60% en predicciones de alta confianza (p>65%). Eso implica:
- En predicciones generales: al nivel del mejor predictor público disponible
- En predicciones de alta confianza: **por encima de las casas de apuestas en ese subconjunto**

### B.2 El problema de percepción: 53% suena a poco

Si le decís a un usuario "nuestro modelo acierta el 53% de los partidos", probablemente piense: *"prácticamente una moneda"*. Y tiene razón si no entiende el contexto.

El usuario no compara contra el azar. Compara contra su intuición, que es peor de lo que cree. Los tipsters profesionales en Twitter/X — los que tienen millones de seguidores y cobran por sus picks — aciertan el 43% según los datos. Peor que un modelo naïve.

El framing correcto no es:
> *"Nuestro modelo acierta el 53% de los partidos."*

Sino:
> *"Nuestro modelo acierta más que las casas de apuestas en los partidos donde tiene alta confianza — y podés verificarlo vos mismo, partido por partido, semana por semana."*

Tres elementos que construyen confianza: comparación con el benchmark correcto, condición de activación (alta confianza), y verificabilidad total.

### B.3 La calibración es más importante que el accuracy crudo

El número que realmente importa no es cuántas predicciones acertó en total. Es si el nivel de confianza predice correctamente la frecuencia de aciertos.

Un modelo bien calibrado dice:
- "Predigo victoria local con 70% de confianza" → gana el local ~70% de las veces en esos partidos
- "Predigo empate con 40% de confianza" → hay empate ~40% de las veces en esos partidos

Eso diferencia un modelo honesto de uno que infla confianzas para parecer más seguro. El usuario analítico (Persona 1) reconoce esa diferencia de inmediato. La página de accuracy pública tiene que mostrar la **curva de calibración**, no solo el porcentaje de aciertos. Es la prueba más dura y la más convincente.

### B.4 El "aha moment" — cuándo el usuario entiende y paga

Para SportsPulse el aha moment no puede ser "acertó este partido" — un acierto aislado no prueba nada, ni siquiera el azar aleatorio. El aha moment es una **secuencia en tres actos**:

**Acto 1 — Llegada (sin registro):**
El usuario llega, ve el dashboard, hay un partido de su equipo. El modelo dice "victoria visitante con 65% de confianza, alta relevancia del partido". El usuario no registra nada, solo lo anota mentalmente o sigue el partido.

**Acto 2 — Verificación (día siguiente, sin registro):**
El partido terminó como el modelo predijo. El usuario vuelve, ve que acertó. Busca el historial. Encuentra la página de accuracy. Ve 3 meses de predicciones con resultados verificados: 58% de acierto general, 67% en confianza >65%. Puede hacer clic en cualquier partido y ver la predicción original — incluyendo los que el modelo erró.

**Acto 3 — Conversión:**
El usuario tiene un partido importante este fin de semana. Quiere el scoreline esperado, el xG, el intervalo de confianza. Eso está en Pro. Paga USD 4.99.

El tiempo entre Acto 1 y Acto 3 puede ser 48 horas. Pero requiere que el Acto 2 funcione perfectamente: la página de accuracy disponible sin registro, con datos reales, sin cherry-picking, con errores tan visibles como aciertos.

### B.5 Volumen mínimo para que el track record sea creíble

| Muestra visible para el usuario | Percepción | Realidad estadística |
|--------------------------------|-----------|----------------------|
| 3 aciertos seguidos | "Increíble" | Completamente aleatorio |
| 10 partidos, 6 acertados | "Parece bueno" | Insuficiente para concluir nada |
| 30 partidos, 18 acertados (60%) | "Esto es real" | Empieza a ser significativo |
| 100 partidos, 55 acertados (55%) | "Confiable" | Estadísticamente robusto |
| 200+ partidos con calibración visible | "Pago" | Umbral del plan — correcto |

**Implicación de diseño:** la página de accuracy necesita mostrar mínimo 30 partidos recientes antes de que se promueva públicamente. Si el producto arranca con 5 partidos en el historial no hay aha moment posible. Hay que esperar a tener masa suficiente — o mostrar solo las ligas donde ya se tiene volumen.

### B.6 Validación histórica walk-forward: acelerar el umbral de credibilidad

El plan requiere ≥200 partidos evaluados por liga antes de publicar el track record. El problema práctico: en una liga con 30 jornadas de ~9 partidos, llegar a 200 partidos forward desde hoy toma entre 6 y 8 meses de operación continua. Eso es una ventana ciega larga — el producto existe, funciona, pero no puede mostrar evidencia.

**La alternativa: evaluación histórica walk-forward.**

La diferencia entre un backtest puro y un walk-forward histórico es metodológica pero crucial:

| Método | Qué hace | Problema |
|--------|----------|---------|
| **Backtest puro** | Ajusta el modelo sobre todos los datos disponibles y mide retroactivamente | El modelo "vio el futuro" — contamina todos los resultados |
| **Walk-forward histórico** | Usa solo datos disponibles antes de cada partido para predecir; avanza cronológicamente | No hay lookahead — es metodológicamente honesto |

El motor Elo de SportsPulse es **inherentemente walk-forward** por diseño: los ratings se actualizan partido a partido en orden cronológico, y cada predicción solo usa información que existía en ese momento. No existe contaminación posible, no porque se decidió evitarla sino porque la arquitectura del modelo no tiene otro modo de funcionar.

**Qué se puede publicar en cada etapa:**

| Etapa | Origen de los datos | Qué se puede decir | Disclosure requerido |
|-------|--------------------|--------------------|----------------------|
| Pre-launch | 3+ temporadas históricas, evaluación walk-forward | "Demostración metodológica: el modelo evaluado sobre datos históricos alcanzó X% de accuracy" | "Evaluado sobre datos históricos — no es un track record live" |
| Launch + primeros meses | Mix histórico + forward live | "Track record metodológico (histórico) + N partidos live verificados" | Separar claramente las dos fuentes |
| ≥200 partidos live | 100% forward live | "Track record verificado: N partidos desde [fecha de activación]" | Sin restricción adicional |

**Implicación estratégica: 4–6 meses de ventaja.**

Con walk-forward histórico, la página de accuracy puede publicarse en semanas después del lanzamiento con cientos de predicciones evaluadas — incluyendo las ligas ya cubiertas (LaLiga, Premier, Liga Argentina). El usuario llega el día 1 y encuentra evidencia, no una promesa.

La validación forward se acumula en paralelo desde el momento en que el sistema arranca. Cuando alcanza los 200 partidos live, el disclosure de "demostración metodológica" se convierte en "track record verificado" — sin rediseñar nada, sin cambiar la infraestructura.

**El riesgo a gestionar: degradación entre condiciones históricas y live.**

El walk-forward histórico puede mostrar accuracy superior al que el modelo tendrá en condiciones live. Las razones son conocidas: cambios en la calidad de los datos, eventos no modelados (VAR, cambios de entrenador), y el simple hecho de que el modelo todavía no fue expuesto a sorpresas futuras. No es un problema si se gestiona con honestidad:

- Publicar siempre el período evaluado con su fecha de inicio
- Cuando los primeros partidos live difieren del promedio histórico, no editar retroactivamente — explicarlos (Mecanismo 4, §C.3)
- Definir internamente un umbral de alerta: si el accuracy live cae más de 5 puntos porcentuales por debajo del histórico en el primer trimestre, revisar el modelo antes de activar el paywall

La clave es que el disclosure de origen no es una debilidad del argumento — es la prueba de que SportsPulse opera con honestidad metodológica. Ningún competidor hace esa distinción.

### B.7 Cuotas de mercado: benchmark externo y señal de producto

El mercado de apuestas (específicamente Pinnacle, que atrae al capital sharp y tiene los spreads más ajustados de la industria) es el mejor predictor público disponible con ~53–54% de accuracy 1X2. No porque las casas de apuestas sean brillantes, sino porque agregan la opinión de miles de apostadores con capital en juego — incluyendo los profesionales. Esa agregación es difícil de superar de forma consistente.

La pregunta estratégica es cómo usar esa información.

**Como comparación pública: sí, con valor de producto real.**

Mostrar la probabilidad del modelo de SportsPulse junto a la probabilidad implícita del mercado partido a partido produce tres efectos concretos:

1. **Señal de alta confianza:** cuando el modelo diverge del mercado más de 10–15 puntos porcentuales, eso es una predicción genuinamente contraintuitiva. Es el partido más interesante de destacar — el modelo ve algo que el consenso no está viendo. Que salga bien o mal, la divergencia es información.

2. **Benchmark honesto en la página de accuracy:** en lugar de un porcentaje abstracto, el usuario puede ver: "en los partidos donde SportsPulse y el mercado coincidían, acertamos tanto. En los partidos donde divergíamos, acertamos tanto." Eso mide si el modelo agrega valor real por encima del consenso — el test más duro y el más convincente.

3. **Contenido shareworthy:** el post semanal de accuracy tiene un eje narrativo natural — "los tres partidos donde el modelo discrepó del mercado, y qué pasó." Es más interesante que una tabla de porcentajes. Y es posible solo porque SportsPulse no depende de las casas de apuestas para generar ingresos.

El dato técnico: convertir cuota decimal a probabilidad implícita es trivial (p = 1/cuota, luego normalizar por el margen de la casa). La fuente recomendada es Pinnacle (sharp market, margen ~2%) o The Odds API (agrega múltiples casas, más práctico para integración). Ambas tienen acceso via API en planes accesibles.

**Como input al motor predictivo: no recomendado.**

Usar odds como feature del modelo tiene dos problemas de fondo:

*Problema de independencia:* si las odds son un feature, el modelo SportsPulse se convierte en un derivado del mercado. En ese momento, el argumento de "fuente independiente sin afiliación a apuestas" se debilita — no porque SportsPulse esté afiliado a una casa, sino porque su output depende implícitamente del trabajo de todas ellas. Para el usuario sofisticado, eso importa.

*Problema de aporte real:* las odds ya incorporan la mayoría de la información pública disponible — forma reciente, lesiones conocidas, H2H, y el flujo de dinero sharp. Un modelo que aprende a re-derivar lo que el mercado ya procesó no está generando señal nueva, está replicando consenso. El motor Elo de SportsPulse basado en rendimiento histórico estructural (strengths relativas, ventaja de local, tendencias de jornada) puede encontrar ineficiencias que el mercado subpondera. Eso solo es posible si el modelo es independiente del mercado.

**Como herramienta interna de control de calidad: sí.**

La divergencia sistemática entre el modelo y el mercado es una señal de salud del modelo. Si en una liga SportsPulse diverge del mercado en más de 20 puntos porcentuales en el 80% de los partidos, hay dos posibilidades: el modelo está encontrando ineficiencias reales (bueno) o tiene un problema de calibración (malo). Monitorear esa divergencia offline, antes de publicar, es parte del protocolo de validación del modelo — no un feature de producto.

**Resumen operativo:**

| Uso | Decisión | Razón |
|-----|----------|-------|
| Comparación pública partido a partido | ✅ Implementar en Fase B | Benchmark honesto, señal de producto, contenido |
| Input del motor predictivo | ❌ No usar | Compromete independencia, no agrega señal real |
| Control de calidad offline | ✅ Usar internamente | Detecta problemas de calibración antes de publicar |

### B.8 Señales de evento estructuradas: lo que sí vale explorar y sus condiciones

El sentiment de redes sociales como input del modelo no tiene respaldo suficiente — la señal es redundante con el Elo, el mercado de odds ya la incorpora antes de que sea procesable, y la calidad de los datos en comunidades futbolísticas latinoamericanas es demasiado ruidosa para justificar el costo. Esa puerta está cerrada.

Hay un caso distinto, más estrecho y más honesto: **detección de eventos específicos de alta señal a partir de fuentes de noticias estructuradas.** No un score de positividad/negatividad, sino un flag binario o categórico sobre hechos verificables.

Los eventos que tienen evidencia empírica de impacto en probabilidades:

| Evento | Evidencia de impacto | Fuente de detección |
|--------|---------------------|---------------------|
| Lesión confirmada de titular (especialmente portero, delantero centro) | Alta — los modelos de mercado ajustan odds en 5–15 puntos en estas situaciones | Noticias oficiales del club + feeds RSS |
| Cambio de entrenador reciente (últimas 2–4 jornadas) | Moderada — existe efecto "rebote del nuevo DT" documentado en literatura | Dato estructurado de la liga |
| Jugador clave recuperado después de ausencia prolongada | Moderada | Noticias oficiales del club |
| Partido de motivación asimétrica (uno ya clasificado/descendido, el otro no) | Moderada — capturable parcialmente con datos de tabla | Datos de standings existentes |

**Las condiciones para que esto valga la pena:**

1. **Solo eventos verificables, no rumores.** Un tweet no es una fuente. Una nota oficial del club o una confirmación de los medios cubiertos por el RSS existente, sí. La diferencia no es de grado — es de tipo. Un modelo que incorpora rumores no verificados pierde calibración y credibilidad simultáneamente.

2. **Solo si se detecta antes de que el mercado lo ajuste.** La ventana de utilidad es estrecha: desde que el evento se confirma hasta que las odds lo reflejan. En eventos de alto perfil (lesión de Vinicius Jr. antes de un Clásico), esa ventana es de minutos. En eventos de menor perfil (titular de Liga Uruguaya fuera de la lista), puede ser de horas. Si el sistema no puede actuar en esa ventana, el evento no aporta señal incremental — solo confirma lo que el mercado ya sabe.

3. **Como flag explícito, no como feature opaco.** Si se incorpora, tiene que aparecer en el output del modelo como señal nombrada: "predicción ajustada por ausencia confirmada de titular en las últimas 6 horas." Eso mantiene la explicabilidad que es parte del diferencial y permite que el usuario — y el equipo — auditen si el ajuste fue correcto.

4. **Timing: no antes de Fase D-E.** Esto requiere entity resolution confiable (¿de qué jugador y de qué equipo habla esta noticia?), vinculación con el lineup del partido, y validación de que el ajuste mejora la calibración. Es trabajo de ingeniería no trivial. Antes de tener track record público consolidado y paywall Pro funcionando, priorizar esto sería invertir en precisión marginal cuando el problema de credibilidad todavía no está resuelto.

### B.9 La trampa del sesgo de confirmación

El usuario va a recordar los aciertos y olvidar los errores. Eso parece una ventaja — en el corto plazo lo es. Pero es exactamente lo que hacen todos los tipsters fraudulentos. Si SportsPulse construye credibilidad sobre el sesgo de confirmación, el modelo colapsa en la primera racha mala.

La única estrategia sostenible es la opuesta: **publicar los errores tan visiblemente como los aciertos.** El post de accuracy del lunes tiene que empezar por los partidos que el modelo erró, con contexto de por qué. Eso es lo que ningún competidor hace. Eso es lo que hace creíble el track record cuando es bueno.

### B.10 Conclusión: el predictor no es el producto. El track record es el producto.

Un modelo que acierta el 55% sin prueba verificable vale lo mismo que un tipster que dice que acierta el 90% — cero credibilidad. Un modelo que acierta el 52% con 200 partidos auditados, curva de calibración visible y errores publicados vale más que cualquier competidor en el mercado hispanohablante.

El objetivo no es construir el modelo más preciso del mundo. Es construir el **primero con track record público verificable en español**. Se construye con tiempo, no con algoritmos.

### B.11 Fuentes de este anexo

- [Sports Forecasting: betting odds vs tipsters vs prediction markets — Graham Kendall](https://graham-kendall.com/blog/sports-forecasting-a-comparison-of-the-forecast-accuracy-of-prediction-markets-betting-odds-and-tipsters/)
- [Football prediction accuracy modelos ML — ScienceDirect](https://www.sciencedirect.com/science/article/pii/S2772662224001413)
- [Machine learning football prediction — arXiv](https://arxiv.org/pdf/2403.16282)
- [Aha moment y activación de usuario — Appcues](https://www.appcues.com/blog/aha-moment-guide)
- [User trust in prediction platforms — Ruthless Reviews](https://www.ruthlessreviews.com/featured-posts/a-ruthless-review-of-sports-prediction-platforms/)
- [AI sports prediction accuracy 60–85% — The AISurf](https://theaisurf.com/ai-sports-predictions-tools/)

---

## Anexo C — Por qué nadie muestra el track record y cómo hacerlo legible

> Análisis realizado en marzo 2026. Responde a la pregunta crítica: si mostrar el track record es el diferencial central del negocio, ¿por qué nadie lo hace y cómo puede un usuario normal entenderlo? Este anexo es fundamento del diseño del producto, no solo de la estrategia.

### C.1 Por qué nadie muestra el track record

No es ingenuidad — es una decisión racional. Publicar el track record crea tres problemas que la mayoría prefiere evitar:

**1. Crea un estándar medible.**
Una vez que publicás "somos 55% precisos", cada predicción errónea es un evento público y verificable. Vivir en la ambigüedad de "nuestro modelo usa IA avanzada" es más cómodo y no tiene consecuencias.

**2. Requiere infraestructura que casi nadie construyó.**
Para que un track record sea creíble, las predicciones tienen que estar bloqueadas antes del partido — con timestamp, sin posibilidad de edición retroactiva. Eso requiere un sistema técnico que la mayoría no tiene porque nunca tuvo intención de publicar los resultados.

**3. Los modelos reales son mediocres en términos absolutos.**
Un modelo que acierta el 54% se ve patético si no tenés el contexto de que las casas de apuestas aciertan el 53–54% con toda su infraestructura. Sin ese contexto, publicar el número hunde la credibilidad en lugar de construirla.

SportsPulse tiene resuelto el punto 2 — Track A graba predicciones forward con timestamp antes de cada partido. Los puntos 1 y 3 son un problema de diseño, no de tecnología.

### C.2 El problema central: los números no comunican

Una página que dice *"Accuracy últimos 90 días: 54.2% — Brier Score: 0.218 — Calibración: 0.91"* no le dice nada a ningún usuario normal. Es estadísticamente correcto y emocionalmente muerto.

El track record tiene que ser diseñado como comunicación, no como reporte:

| Reporte (no funciona) | Comunicación (funciona) |
|----------------------|------------------------|
| "54.2% de accuracy" | "Acertamos 6 de los últimos 10 partidos de alto impacto" |
| "Brier Score 0.218" | "Cuando decimos 70%, acertamos el 70% de las veces" |
| "Calibración: 0.91" | "No inflamos confianzas para parecer más seguros" |
| Tabla de 200 predicciones | "Esta semana erramos 3 — acá explicamos por qué" |

### C.3 Los cinco mecanismos de comunicación

#### Mecanismo 1 — La ventana de los últimos 10

El mecanismo más simple y efectivo. Una fila de 10 íconos — verde si acertó, rojo si erró — siempre visible, por liga o por equipo. El usuario no necesita entender probabilidades. Ve 7 verdes y confía. Imita el lenguaje visual que ya usa para evaluar a un jugador en forma.

```
Últimas 10 predicciones de LaLiga:  ● ● ○ ● ● ● ○ ● ● ●  (8/10)
```

#### Mecanismo 2 — El comparador concreto

El contexto que siempre falta: *¿comparado con qué?* Hay que dárselo explícitamente, con referencias que el usuario ya conoce y tiene una opinión formada sobre ellas.

> *"En los últimos 3 meses hicimos 247 predicciones.*
> *Si hubieses elegido al azar: ~94 aciertos.*
> *Los tipsters más seguidos en Twitter: ~105 aciertos.*
> *Las casas de apuestas: ~132 aciertos.*
> *SportsPulse: 139 aciertos — y podés ver cada uno."*

Ahora el 56% tiene sentido. No porque el usuario entendió estadística, sino porque tiene una escala de referencia que ya le importa. Los tipsters de Twitter son el enemigo natural de la Persona 1 — usuarios que fueron quemados por picks falsos con cero accountability.

#### Mecanismo 3 — El partido que recuerda

El momento más poderoso no es el porcentaje global. Es el partido específico que el usuario siguió, donde el modelo dijo algo contraintuitivo, y tuvo razón.

> *"Hace 3 semanas el modelo daba 71% de probabilidad a River ante Boca, cuando la mayoría esperaba empate o victoria de Boca. River ganó 2-0."*

Un acierto con historia vale más que cien aciertos en una tabla. El diseño tiene que identificar las predicciones contraintuitivas que salieron bien y presentarlas como narrativa, no como fila de una tabla.

#### Mecanismo 4 — El error explicado

El mecanismo más contraintuitivo pero el más poderoso para construir confianza a largo plazo. Cuando el modelo falla en un partido de alto perfil, la respuesta no es silencio ni enterrarlo en una tabla. Es una nota breve y honesta:

> *"Predijimos 68% de probabilidad de victoria local. Ganó el visitante 0-1. El gol llegó en el minuto 89 de pelota parada — un evento de baja frecuencia que ningún modelo captura bien. El modelo sigue calibrado."*

Esto es lo que ningún tipster hace. Es exactamente lo que diferencia una fuente de confianza de un vendedor de picks. El usuario que lee esto no pierde confianza en el modelo — la gana, porque entiende que el modelo no pretende ser infalible.

#### Mecanismo 5 — La perspectiva del equipo favorito

El track record global es abstracto. El track record sobre el equipo de uno es personal e inmediato.

> *"En los últimos 20 partidos de Boca, predijimos correctamente 13 (65%). Ver cada uno."*

El usuario que sigue a Boca desde hace 20 años recuerda esos 20 partidos. Puede verificar partido por partido si el modelo tuvo razón. Esa verificación personal es el acto de confianza más fuerte posible — el usuario convierte los datos del modelo en su propia experiencia, y esa experiencia es la que justifica pagar.

### C.4 El requisito técnico que hace creíble todo lo anterior

Los cinco mecanismos se derrumban si no hay una garantía de que las predicciones fueron hechas antes del partido. Sin eso, cualquier competidor puede publicar un "track record" retroactivo que es pura ficción. La credibilidad técnica requiere tres cosas:

1. **Timestamp público en cada predicción** — fecha y hora de generación, anterior al kickoff, visible para cualquier usuario
2. **Inmutabilidad** — ninguna predicción puede editarse una vez publicada
3. **Auditoría abierta** — cualquier usuario puede ver la predicción original con su timestamp, sin necesidad de registro

SportsPulse ya tiene los puntos 1 y 2 resueltos en la infraestructura del motor (Track A genera y persiste snapshots forward con timestamp). El punto 3 es diseño de producto: hacer esa información visible y navegable en la UI sin fricción.

Esta infraestructura es parte del moat competitivo. Un competidor que quisiera replicar el track record tendría que empezar a gravar predicciones hoy — y esperar meses antes de tener una muestra creíble.

### C.5 El volumen mínimo antes de comunicar

No se puede diseñar un track record legible con 10 partidos. Hay un piso mínimo por debajo del cual mostrar datos hace más daño que no mostrarlos:

| Muestra disponible | Acción recomendada |
|-------------------|--------------------|
| < 20 partidos | No publicar. Gravar en silencio. |
| 20–50 partidos | Mostrar solo a usuarios que pregunten explícitamente. Framing: "modelo en período de validación". |
| 50–100 partidos | Publicar con disclaimer de muestra limitada. Activar los mecanismos 1 y 2. |
| 100–200 partidos | Publicar con confianza. Activar los cinco mecanismos. |
| 200+ partidos | Track record público completo. Activar paywall Pro con este respaldo. |

La implicación para el roadmap: **el paywall Pro no debe activarse antes de tener 200 partidos evaluados en al menos una liga.** Pedir dinero por predicciones sin track record verificable coloca a SportsPulse en la misma categoría que los tipsters de Twitter — exactamente el posicionamiento que hay que evitar.

### C.6 Por qué esto justifica el negocio

La razón por la que nadie muestra el track record — incomodidad con la accountability, falta de infraestructura, modelos mediocres — es exactamente la razón por la que SportsPulse puede diferenciarse.

El mercado de predicciones deportivas está lleno de promesas sin evidencia. El usuario analítico (Persona 1) lo sabe. Ha sido quemado por tipsters. Desconfía de cualquier número que no puede verificar. Para ese usuario, un track record honesto con errores publicados vale más que cualquier porcentaje de acierto que no puede auditar.

No se trata de ser el modelo más preciso. Se trata de ser el **único modelo que muestra lo que hace y no esconde lo que falla**. En un mercado donde todos mienten por omisión, la transparencia radical es el producto.

---

---

## Anexo D — Capa de contenido contextual: decisión estratégica y reglas de producto

> Análisis realizado en marzo 2026 a partir de la evaluación de incorporar una capa interna de contenido/contexto que reemplace el comportamiento actual de noticias (RSS + redirección externa). Establece la postura del producto, las reglas operativas y la decisión de timing.

### D.1 El problema real que se quiere resolver

El fallo del comportamiento actual no es que el usuario salga del portal al hacer clic en una noticia. Es que las noticias están estructuralmente desconectadas del resto del producto: un artículo sobre una lesión de un jugador clave aparece en una pestaña sin relación visible con la relevancia de ese equipo en el treemap, con su predicción de partido o con la señal que el motor ya está emitiendo.

La pregunta correcta no es "¿cómo mantenemos al usuario dentro del portal?" sino "¿cómo convierte el contenido editorial en una explicación de por qué algo importa hoy?" Son preguntas distintas con respuestas distintas.

### D.2 La distinción que define la decisión

| Concepto | Definición | Relación con el core | Decisión |
|----------|-----------|---------------------|----------|
| **Noticias como destino** | Pestaña o sección navegable de contenido deportivo reciente, con home editorial propia | Compite con el motor de atención — crea una razón de visita alternativa e independiente | ❌ Prohibido — viola §3.3 |
| **Briefs contextuales** | Fragmento corto (2–4 líneas) vinculado a un partido/equipo específico, que aparece dentro de la ficha de ese partido y explica algo relevante al modelo | Subordinado al motor — amplifica la señal de atención con lenguaje humano | ✅ Aprobado con reglas |

Esta distinción no es semántica. Si el contenido puede navegarse independientemente del partido al que pertenece, dejó de ser un brief contextual y se convirtió en un portal de noticias. La arquitectura del producto debe hacer esa distinción imposible de violar.

### D.3 Reglas de producto (no negociables)

**Qué entra:**
- Noticias vinculables a un equipo que juega en las próximas 48h o jugó en las últimas 24h
- Fuente: feeds RSS ya configurados (Tenfield, Infobae Deportes, Marca, etc.)
- Contenido: headline + primer párrafo del feed tal como viene — sin resumen LLM, sin reescritura editorial
- Máximo 2–3 briefs por partido, seleccionados por proximidad temporal y relevancia de entidad

**Qué no entra:**
- Noticias sin vínculo identificable con un partido activo en el dashboard
- Noticias de más de 48h de antigüedad
- Resúmenes generados por LLM (riesgo de marca — ver §D.5)
- Imágenes reproducidas sin licencia explícita
- Cualquier contenido que no pueda vincularse a un equipo o torneo cubierto

**TTL:** 24–48h. Después desaparece. Sin archivo, sin historial de briefs, sin búsqueda.

**Visibilidad:** exclusivamente dentro del DetailPanel de partido, sección "Contexto". No en home, no en pestaña propia, no en cards de listado.

**Link externo:** se preserva siempre. El brief no reemplaza el artículo original — lo contextualiza. El usuario que quiere leer el artículo completo sigue teniendo el link visible.

**Fuente:** siempre visible y prominente en la card. Sin excepción.

### D.4 Impacto en el funnel

Los briefs contextuales no son un driver de activación ni de conversión directa. Su función es:

1. **Enriquecer el aha moment** cuando están vinculados a la señal del modelo: si el motor asigna alta relevancia a un partido y hay un brief que explica por qué (retorno de lesionado, racha de 5 derrotas, partido de eliminación), el usuario entiende que el motor sabe algo que él no tenía. Eso refuerza la confianza en el modelo.

2. **Aumentar tiempo en DetailPanel** cuando ese panel es Pro-activado, con predicciones detalladas y accuracy histórico. En ese contexto, el brief es parte de un panel completo que justifica el valor Pro.

Fuera de ese contexto (sin Pro activado, sin predicciones detalladas visibles), los briefs son UX de completitud — mejoran la experiencia sin mover métricas de conversión de forma material.

### D.5 Riesgo crítico: summarización LLM

La tentación de resumir artículos con LLM para producir briefs más limpios o más curados introduce un riesgo directo al activo más importante del producto: la credibilidad.

SportsPulse se posiciona sobre honestidad verificable. Un resumen LLM que inventa, distorsiona o malinterpreta el estado físico de un jugador clave, o una declaración de un entrenador, es exactamente el tipo de error que destruye esa credibilidad. El usuario que confía en SportsPulse para decirle la verdad sobre un partido no puede recibir un brief inventado sobre ese mismo partido.

La regla es permanente: **no summarización LLM para briefs contextuales**. El headline y el primer párrafo del RSS son suficientes y verificablemente exactos.

### D.6 Lo que no aporta al moat

Los briefs contextuales son una feature commodity. Cualquier competidor puede replicarlos en días con el mismo stack de RSS + keyword matching. No contribuyen al track record acumulado, no aportan a la independencia editorial en el sentido que importa, y no crean ventaja competitiva sostenible.

Su valor es de completitud y experiencia — hacen el producto más completo — pero no son parte del argumento de por qué SportsPulse gana a largo plazo. El moat sigue siendo el track record por liga, la metodología pública y la independencia de apuestas.

### D.7 Timing y prioridad

| Fase | Decisión | Razón |
|------|----------|-------|
| Fase A (hoy) | Pestaña "Noticias" existente se mantiene sin cambios | No está en el camino crítico hacia el primer suscriptor Pro |
| Fase B-C | Sin cambios en noticias | Liga MX, Copa Libertadores, registro y accuracy público son prioritarios |
| Fase D | Implementar briefs contextuales en DetailPanel | El DetailPanel Pro activo es el contexto correcto; antes de eso, el brief no tiene un rol en conversión claro |
| Nunca | Pestaña editorial propia, home de noticias, archivo, scroll de contenido | Viola el posicionamiento del producto y no contribuye al moat |

### D.8 Criterios de evaluación post-lanzamiento (Fase D)

Si los briefs se implementan en Fase D, evaluarlos con estas métricas antes de expandir el scope:

- CTR sobre headline de brief > 15% de las sesiones que abren DetailPanel con brief visible
- Tiempo en DetailPanel con brief vs sin brief: diferencia > 20 segundos promedio
- Noticias no relacionadas con el partido detectadas: < 5% de los casos (manual audit mensual)
- Si alguno de estos criterios falla en los primeros 60 días → reducir scope o eliminar la feature

---

---

## Out-of-Scope / Explicitly Excluded for Current Plan

Las siguientes líneas y modelos de negocio quedan **explícitamente fuera del alcance del plan actual**. Su exclusión no es accidental ni revisable sin un análisis estratégico nuevo. Cualquier trabajo futuro que proponga reintroducirlas requiere una decisión explícita del fundador con razonamiento documentado.

| Elemento | Razón de exclusión |
|----------|--------------------|
| Afiliación a casas de apuestas (cualquier forma) | Destruye el posicionamiento de independencia. Incompatible con el moat central. Exclusión permanente mientras el modelo de negocio sea el actual. |
| Prediction market real (con dinero) | Regulación compleja y cambiante en múltiples mercados LATAM. Cambiaría el tipo de empresa radicalmente. Fuera del alcance a cualquier plazo sin análisis legal específico. |
| Exchange / order book / matching P2P | Mismo razonamiento que prediction market. Requiere licencias, estructura legal y capital no contemplados. |
| Props monetizados | Zona sensible entre apuestas y analytics. Sin marco legal claro en LATAM. No entra sin revisión estratégica y legal por mercado. |
| B2B como motor temprano del caso base | Requiere sales motion, distrae del core, no viable antes de tener track record consolidado y base Pro activa. No entra al caso base en ningún escenario de planificación actual. |
| Creator/API como soporte del caso base | Sin señal de demanda. Sin track record suficiente para monetizar. Plausible como upside futuro, no como línea de planificación. |
| Cualquier modelado financiero apoyado en líneas no validadas | Si una proyección de ingresos requiere que una línea especulativa se materialice para que el negocio funcione, esa proyección viola la metodología de este plan. |

---

## Control de Versiones — Regla de Trabajo Futuro

Esta versión (v3.0, 2026-03-16) es la base única para cualquier iteración futura del business plan.

- Si se generan nuevas versiones, deben partir de este documento con delta explícito.
- No se deben reintroducir secciones, cifras, formulaciones o líneas de negocio de versiones anteriores sin una revisión explícita que las valide contra los criterios de este plan.
- Cualquier cambio material al caso base (nueva línea de ingresos, cambio de ARPPU, nuevo supuesto central) requiere actualizar la §14 (Matriz de Supuestos) y la §15 (Caso Base vs Upside) antes de propagarse al resto del documento.

---

*SportsPulse Business Plan v3.0 — Marzo 2026 — Versión Canónica*
