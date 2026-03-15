---
artifact_id: REPORT-SPORTPULSE-PRODUCT-BUSINESS-PLAN-2026-03
title: "Business Plan v1.0 (March 2026)"
artifact_class: report
status: active
version: 1.0.0
project: sportpulse
domain: product
slug: business-plan
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/product/report.sportpulse.product.business-plan.2026-03-01.md
---
# SportsPulse — Plan de Negocio
**Versión 1.0 — Marzo 2026**

---

## 1. Resumen Ejecutivo

SportsPulse es una plataforma de inteligencia deportiva que transforma datos de fútbol en señales accionables para el fanático moderno. A diferencia de las apps de resultados existentes (SofaScore, FlashScore, OneFootball), SportsPulse no compite en volumen de datos — compite en **relevancia editorial y predicción honesta**.

El producto responde a una pregunta que ninguna app actual responde bien: **¿a qué partido vale la pena prestarle atención hoy, y por qué?**

La propuesta de valor se construye sobre tres pilares:
- Un motor de atención determinista y explicable (ya construido)
- Un motor predictivo con track record público y verificable (ya construido)
- Una capa de personalización que conecta ambos con los equipos y ligas que le importan a cada usuario

El modelo de negocio es freemium con monetización principal vía suscripción Pro, con afiliación selectiva como ingreso secundario no comprometedor de la credibilidad editorial.

**Mercado objetivo inicial:** fanáticos de fútbol en Uruguay, Argentina y España — mercados de alta intensidad futbolística, baja penetración de herramientas de análisis sofisticadas, y fuerte disposición a pagar por contenido deportivo premium.

**Meta a 18 meses:** 50.000 usuarios registrados, 2.500 suscriptores Pro, MRR de USD 10.000.

---

## 2. El Problema

### 2.1 El fanático de fútbol está mal servido

El fanático moderno enfrenta una paradoja: nunca hubo tanta información disponible sobre fútbol, y sin embargo encontrar **lo que importa ahora** es cada vez más difícil.

Las apps existentes ofrecen:
- Resultados en tiempo real → disponibles en cualquier lado, gratis
- Estadísticas históricas → abundantes pero sin contexto de relevancia
- Noticias → ruido masivo sin filtro de importancia
- Predicciones → cuando existen, son opacas, sin track record, a menudo influenciadas por afiliación a casas de apuestas

Lo que no existe en el mercado:
- Un sistema que diga explícitamente **qué equipo merece atención hoy y por qué**
- Un motor predictivo que muestre su **accuracy histórico real** en lugar de ocultarlo
- Alertas que den **contexto**, no solo notificaciones de gol
- Un producto que trate al fanático como alguien inteligente, no como un objetivo de apuestas

### 2.2 El problema de las casas de apuestas como árbitro de predicciones

La mayoría de las plataformas de predicción deportiva están financiadas o influenciadas por casas de apuestas. Esto crea un conflicto de interés estructural que los usuarios perciben aunque no lo articulen explícitamente.

SportsPulse puede ocupar el espacio de **fuente independiente y verificable** — un activo que, una vez establecido, es muy difícil de replicar por competidores con modelos de negocio dependientes de afiliación.

### 2.3 El problema del registro sin propuesta de valor

Las apps que piden registro al llegar pierden entre el 60% y el 80% de los usuarios antes de que experimenten el producto. La solución no es eliminar el registro — es **demorar el pedido de registro hasta que el usuario haya visto algo que vale la pena guardar**.

---

## 3. La Solución — Visión del Producto

### 3.1 Definición

SportsPulse es una **plataforma de atención deportiva personalizada** que combina:

1. **Dashboard de atención** — treemap visual que muestra qué equipos merecen atención ahora, con señales explicables (forma, agenda, relevancia del partido)
2. **Motor predictivo con track record público** — probabilidades 1X2, scoreline esperado, xG, con historial de accuracy verificable por cualquier usuario
3. **Alertas inteligentes personalizadas** — no "gol de Boca", sino "Boca está perdiendo 0-2 en el minuto 80, partido de alta relevancia según el modelo"
4. **Resumen post-partido** — "qué me perdí": goles, minuto, contexto, sin necesidad de haber visto el partido
5. **Perfil de usuario** — favoritos, historial de predicciones propias, accuracy personal acumulado

### 3.2 El diferencial central

**La honestidad sobre el modelo es el producto.**

Ningún competidor muestra su accuracy histórico de forma abierta porque la mayoría tienen modelos malos o modelos influenciados por odds de apuestas. SportsPulse puede hacerlo porque:
- El motor predictivo ya existe y tiene arquitectura verificable
- La infraestructura de evaluación (Track A/B) ya está operativa
- El compromiso de no afiliación directa con casas de apuestas es una decisión estratégica, no una limitación

Cuando un usuario ve que el modelo predijo correctamente 7 de los últimos 10 partidos de su equipo con probabilidad > 65%, y puede verificarlo él mismo, está dispuesto a pagar por el detalle.

### 3.3 Lo que SportsPulse NO es

- No es una app de resultados en tiempo real (no compite con SofaScore en eso)
- No es una plataforma de apuestas ni de tipsters
- No es una red social deportiva
- No es un portal de noticias
- No pretende tener todos los deportes ni todas las ligas del mundo

La disciplina sobre lo que no se hace es tan importante como la visión de lo que se hace.

---

## 4. Análisis de Mercado

### 4.1 Tamaño del mercado

**Mercado total direccionable (TAM):**
El mercado global de aplicaciones deportivas de análisis y estadísticas fue estimado en USD 3.200 millones en 2025, con crecimiento proyectado del 12% anual hasta 2030. El segmento de plataformas de predicción deportiva no ligadas a apuestas es emergente y sin líder claro.

**Mercado disponible (SAM) — foco inicial:**
- Uruguay: ~600.000 usuarios activos de apps deportivas estimados
- Argentina: ~8.000.000 usuarios activos de apps deportivas
- España: ~12.000.000 usuarios activos de apps deportivas

**Mercado alcanzable (SOM) — primeros 18 meses:**
0.25% del SAM combinado Uruguay+Argentina+España = ~51.500 usuarios registrados. Meta conservadora: 50.000 usuarios registrados, 5% de conversión a Pro = 2.500 suscriptores.

### 4.2 Tendencias del mercado que favorecen a SportsPulse

- **Fatiga de información**: los usuarios tienen más datos que nunca pero menos capacidad de procesarlos. La curaduría con criterio explícito tiene valor creciente.
- **Desconfianza en casas de apuestas**: regulaciones crecientes en España, Argentina y Uruguay sobre publicidad de apuestas. Los usuarios buscan alternativas no comprometidas.
- **Cultura de datos en el fútbol**: el éxito de "Moneyball" en baseball se replicó en fútbol. El fanático moderno entiende y valora el xG, las métricas de presión, el análisis de datos.
- **Disposición a pagar por contenido deportivo**: el crecimiento de DAZN, el éxito de ESPN+ y el mercado de newsletters deportivos de pago muestran que el fanático paga si el valor es claro.

### 4.3 Geografía inicial y por qué

**Uruguay** — mercado pequeño pero estratégico:
- Alta penetración de fútbol como conversación cultural
- Liga local (Primera División) sin cobertura analítica sofisticada
- Menor competencia local que Argentina o España
- Base de testing natural con feedback directo accesible

**Argentina** — mercado de escala:
- 45 millones de habitantes, altísima densidad futbolística
- Liga Profesional sin plataforma de análisis dominante local
- Mercado de suscripción digital en crecimiento post-pandemia
- Fuerte cultura de debate táctico y estadístico (seguimiento masivo de cuentas de análisis en Twitter/X)

**España** — credibilidad internacional:
- LaLiga como liga de clase mundial da contexto premium al producto
- Mercado maduro pero sin líderes locales en el segmento de predicción independiente
- Acceso a medios y comunidades de análisis futbolístico sofisticado

---

## 5. Usuarios Objetivo — Personas

### Persona 1: El fanático analítico (segmento principal)

**Perfil:** Hombre, 25-40 años, urbano, universitario. Ve 2-4 partidos por semana, sigue una liga principal y una o dos secundarias. Usa Twitter/X para análisis post-partido. Conoce el xG. Le parece que SofaScore da datos pero no le dice qué hacer con ellos.

**Necesidad:** Quiere entender rápido si vale la pena ver un partido esta noche. Quiere contexto, no solo score.

**Disposición a pagar:** Media-alta. Ya paga DAZN o ESPN+. Pagaría USD 4-6/mes por algo que le ahorre tiempo y le dé ventaja en conversaciones con amigos.

**Canal de adquisición:** Twitter/X, comunidades de Reddit deportivo, newsletters deportivos.

### Persona 2: El fanático de un equipo específico (segmento de volumen)

**Perfil:** Hombre o mujer, 20-45 años. Sigue principalmente a su equipo — Boca, River, Nacional, Peñarol, Barcelona, Real Madrid. No le importa analizar ligas enteras, solo quiere saber todo sobre su equipo: cuándo juega, cómo está la forma, qué probabilidad tiene el próximo partido.

**Necesidad:** Notificaciones relevantes sobre su equipo. Resumen de lo que se perdió. Predicción del próximo partido.

**Disposición a pagar:** Media. Pagaría si la personalización es real y las alertas son útiles.

**Canal de adquisición:** Comunidades de fans en Instagram, grupos de WhatsApp de hinchas, SEO sobre su equipo.

### Persona 3: El creador de contenido deportivo (segmento de nicho premium)

**Perfil:** Periodista deportivo, blogger, creador de contenido en TikTok/YouTube/Twitter. Necesita datos para respaldar sus análisis. Busca fuentes que no sean SofaScore porque todos las usan.

**Necesidad:** Datos verificables, predicciones con sustento metodológico, gráficos compartibles.

**Disposición a pagar:** Alta. Lo usa como herramienta profesional. Pagaría USD 10-15/mes por acceso API o exportación de datos.

**Canal de adquisición:** Comunidades de creadores, LinkedIn, outreach directo.

### Persona 4: El apostador ocasional no profesional (segmento sensible)

**Perfil:** Usuario que apuesta ocasionalmente por diversión, no como fuente de ingresos. Busca información antes de apostar, no señales de compra.

**Nota estratégica:** Este segmento existe y usará el producto, pero SportsPulse no lo apunta directamente ni diseña para él. La plataforma no da señales de apuesta — da probabilidades con contexto metodológico. La distinción es importante para regulación y posicionamiento.

---

## 6. Análisis Competitivo

### 6.1 Competidores directos

| Plataforma | Fortaleza | Debilidad | Diferencia con SportsPulse |
|------------|-----------|-----------|---------------------------|
| **SofaScore** | Datos exhaustivos, UX pulida, global | No dice qué importa, predicciones opacas, influenciado por apuestas | SportsPulse filtra y prioriza; predicciones verificables |
| **FlashScore** | Rapidez de resultados en vivo, cobertura total | Interfaz densa, sin editorial, sin predicciones propias | SportsPulse tiene capa editorial y predictiva |
| **OneFootball** | Noticias + resultados, buena UX | Sin predicciones, sin análisis de relevancia | SportsPulse tiene motor de atención |
| **FotMob** | UX excelente, foco en mobile | Sin predicciones, sin personalización profunda | SportsPulse tiene personalización + predicción |
| **Opta/StatsBomb** | Datos de alta calidad | B2B, muy caro, sin producto consumer | SportsPulse es accesible para el fanático común |

### 6.2 Competidores indirectos

- **Tipsters en Twitter/X**: alta audiencia, cero accountability. SportsPulse compite ofreciendo lo opuesto — accountability total y metodología pública.
- **Newsletters deportivos de pago** (The Athletic, Panenka): texto editorial de calidad pero sin datos en tiempo real ni personalización.
- **Casas de apuestas con análisis**: Bet365, Codere tienen secciones de estadísticas. Conflicto de interés estructural que el usuario percibe.

### 6.3 Ventajas competitivas sostenibles

1. **Motor predictivo con metodología pública** — difícil de replicar porque requiere años de datos para que el track record sea creíble
2. **Arquitectura de atención** (treemap + señales) — diferencial visual y conceptual que requiere inversión técnica significativa
3. **Independencia editorial** — no afiliación directa a casas de apuestas como posicionamiento estratégico
4. **Foco regional** — conocimiento profundo de Uruguay, Argentina, España que las plataformas globales no tienen incentivo de desarrollar

---

## 7. Modelo de Negocio

### 7.1 Ingresos primarios — Suscripción freemium

**Free (siempre gratis)**
- Dashboard de atención completo (treemap + señales)
- Resultados y calendario
- Predicciones básicas (1X2 sin detalle de confianza)
- Noticias y highlights
- 1 liga a elección como favorita
- Alertas de resultado (gol, final del partido) para equipo favorito

**Pro — USD 4.99/mes o USD 39.99/año**
- Todo lo anterior
- Predicciones detalladas: scoreline esperado, xG, intervalos de confianza, explicación del modelo
- Historial de accuracy del modelo por liga y equipo
- Historial personal de predicciones del usuario con accuracy propio
- Alertas inteligentes con contexto del modelo (no solo gol — sino "tu equipo perdiendo en minuto 80, alta relevancia")
- Resumen post-partido "qué me perdí"
- Favoritos ilimitados (equipos + ligas)
- Sin publicidad

**Pro Anual** — descuento del 33% sobre mensual. Incentivo principal de conversión.

### 7.2 Ingresos secundarios — Afiliación selectiva

Afiliación a servicios complementarios **no de apuestas**:
- Plataformas de streaming deportivo (DAZN, ESPN+, VTV Play)
- Merchandising oficial de equipos
- Entradas a partidos (vía ticketing partners)

**Criterio de inclusión**: el servicio afiliado debe ser editorialmente compatible con la posición de independencia de SportsPulse. Las casas de apuestas quedan fuera en la etapa inicial. Si en el futuro se considera incluirlas, debe ser con disclosure total y separación clara del contenido editorial.

**Revenue estimado**: 15-25% del ingreso total a escala, nunca la fuente primaria.

### 7.3 Ingresos terciarios — API/B2B (horizonte 24+ meses)

Licencia de acceso a datos y predicciones para:
- Portales de medios deportivos regionales
- Periodistas y creadores de contenido
- Plataformas de fantasy sports

Precio: USD 99-499/mes según volumen. No es prioridad en el horizonte de 18 meses.

### 7.4 Por qué este modelo funciona

- **Freemium con barrera de valor bien ubicada**: el dashboard gratuito es genuinamente valioso — no es una versión castrada. La propuesta Pro agrega profundidad, no funcionalidad básica. Esto maximiza la base de usuarios gratuitos (que construyen el track record y la credibilidad) sin comprometer la conversión.
- **Precio accesible para el mercado regional**: USD 4.99/mes está bien debajo del umbral de dolor en Argentina y Uruguay para un producto de uso diario.
- **Modelo anual como ancla**: el precio anual USD 39.99 convierte usuarios inciertos en comprometidos y reduce churn dramáticamente.

---

## 8. Estrategia de Go-to-Market

### 8.1 Principio rector: producto primero, marketing después

El error más común en apps de nicho es gastar en adquisición antes de que el producto sea lo suficientemente bueno como para retener. La secuencia correcta es:

1. El producto convence a los primeros 1.000 usuarios sin marketing pagado
2. Esos usuarios hablan del producto porque resuelve algo real
3. Con tracción orgánica demostrable, se activa adquisición pagada

### 8.2 Fase 1 — Tracción orgánica (meses 1-6)

**Objetivo**: 10.000 usuarios registrados, 0 gasto en ads.

**Tácticas:**

- **Contenido en Twitter/X**: publicar diariamente el dashboard de atención como imagen compartible. "Los 3 equipos a los que prestarle atención esta jornada de LaLiga — explicado". Sin link de pago, sin registro requerido para ver el contenido. El objetivo es que el formato sea reconocible y se asocie a SportsPulse.

- **Accuracy público semanal**: publicar cada lunes el accuracy de las predicciones de la semana anterior. Formato simple: "La semana pasada predijimos 23 partidos. 16 correctos (70%). Los 7 que fallamos: [lista con contexto]". Esto construye credibilidad y es shareworthy.

- **Outreach a comunidades de análisis**: contactar directamente a cuentas de análisis futbolístico en Twitter/X, bloggers deportivos, podcasts de fútbol en Argentina/Uruguay/España. Ofrecerles acceso Pro gratuito a cambio de mención honesta (no post patrocinado).

- **SEO de cola larga**: artículos y páginas optimizadas para búsquedas como "predicción Boca River este sábado", "pronóstico LaLiga jornada 28", "análisis forma Peñarol". Estas búsquedas tienen volumen real y baja competencia en el segmento de análisis independiente.

- **Presencia en Reddit**: r/soccer, r/Argentina, r/futbol, r/laliga. No spam — contribución genuina con análisis derivados del modelo, con mención del producto cuando es natural.

### 8.3 Fase 2 — Crecimiento acelerado (meses 7-12)

**Objetivo**: 35.000 usuarios registrados, 1.500 Pro, MRR USD 7.500.

**Tácticas:**

- **Ads pagados en Meta e Instagram**: targeting por interés en ligas específicas. Creativo basado en el accuracy track record — "Predijimos 7 de los últimos 10 clásicos correctamente. Mirá cómo". CTA a free, no a Pro.

- **Partnerships con podcasts deportivos**: sponsorship de podcasts de fútbol en Argentina y España. Formato: el host menciona naturalmente el dashboard de la semana como fuente de análisis. USD 200-500/episodio, altamente medible.

- **Newsletter propio**: resumen semanal de lo que el modelo vio en la última jornada + preview de la próxima. Gratuito, con call-to-action a Pro para detalle. Objetivo: 5.000 suscriptores en 6 meses.

- **Programa de referidos**: un mes de Pro gratis por cada amigo que convierte a Pro. Bajo costo de adquisición, alto valor del usuario referido (ya viene con contexto de confianza).

### 8.4 Fase 3 — Escala (meses 13-18)

**Objetivo**: 50.000 usuarios registrados, 2.500 Pro, MRR USD 12.500.

**Tácticas:**

- **Expansión a nuevas ligas**: Bundesliga ya está. Champions League, Serie A como siguiente expansión. Cada nueva liga es una nueva audiencia y un nuevo ángulo de contenido.
- **Producto mobile nativo**: la app web responsive es suficiente para las fases 1 y 2, pero para escalar en mobile es necesaria la presencia en App Store y Play Store. Esto desbloquea notificaciones push nativas, que son el canal de retención más efectivo.
- **PR especializado**: buscar cobertura en medios deportivos especializados. No mass media — medios donde la audiencia ya es el usuario objetivo.

---

## 9. Roadmap de Producto

### 9.1 Principio: construir credibilidad antes de cobrar

El registro y el freemium no se activan desde el día 1. El producto necesita demostrar valor antes de pedir compromiso al usuario.

### Fase A — Fundación (ya completo en gran parte)
- ✅ Dashboard de atención (treemap + señales)
- ✅ Motor predictivo
- ✅ Resultados en vivo
- ✅ Noticias y highlights
- ✅ Eventos y streaming
- 🔲 **Accuracy público** — página que muestra el historial de predicciones del modelo, verificable por cualquiera. Este es el primer paso antes del registro.

### Fase B — Identidad de usuario (meses 1-3)
- 🔲 Registro/login (email o Google OAuth)
- 🔲 Equipos y ligas favoritas
- 🔲 Dashboard personalizado según favoritos
- 🔲 Historial de predicciones del usuario (sus propias predicciones)
- 🔲 Notificaciones web básicas (resultado de partido)

### Fase C — Propuesta Pro (meses 3-6)
- 🔲 Paywall freemium — activar suscripción Pro
- 🔲 Predicciones detalladas para Pro (scoreline, xG, confianza, explicación)
- 🔲 Alertas inteligentes para Pro (con contexto del modelo)
- 🔲 Resumen post-partido "qué me perdí"
- 🔲 Historial de accuracy personal (Pro)

### Fase D — Escala (meses 6-12)
- 🔲 App mobile nativa (React Native o PWA avanzada)
- 🔲 Expansión de ligas
- 🔲 Newsletter integrado
- 🔲 Programa de referidos
- 🔲 API pública (beta) para creadores de contenido

### Fase E — Horizonte (12+ meses)
- 🔲 Champions League / Copa del Mundo
- 🔲 Módulo B2B para medios
- 🔲 Fantasy light (predicciones colectivas, sin dinero)
- 🔲 Integración con plataformas de streaming (deeplinking a partido en vivo)

---

## 10. Métricas Clave

### 10.1 Métricas de producto

| Métrica | Descripción | Meta 6 meses | Meta 18 meses |
|---------|-------------|--------------|----------------|
| MAU (Monthly Active Users) | Usuarios únicos activos por mes | 8.000 | 35.000 |
| DAU/MAU ratio | Stickiness del producto | > 25% | > 35% |
| Sesiones por usuario/semana | Engagement | > 3 | > 4 |
| Retención D30 | % usuarios activos al día 30 | > 40% | > 50% |
| Predicciones vistas/usuario/mes | Core feature engagement | > 5 | > 8 |
| Alertas configuradas/usuario Pro | Feature adoption | > 3 | > 5 |

### 10.2 Métricas de negocio

| Métrica | Meta 6 meses | Meta 12 meses | Meta 18 meses |
|---------|--------------|----------------|----------------|
| Usuarios registrados | 10.000 | 30.000 | 50.000 |
| Suscriptores Pro | 300 | 1.200 | 2.500 |
| MRR | USD 1.500 | USD 6.000 | USD 12.500 |
| Churn mensual Pro | < 8% | < 6% | < 5% |
| CAC (costo adquisición) | < USD 3 | < USD 5 | < USD 8 |
| LTV / CAC ratio | > 5x | > 7x | > 8x |

### 10.3 Métricas de credibilidad del modelo

| Métrica | Descripción | Umbral mínimo aceptable |
|---------|-------------|------------------------|
| Accuracy 1X2 general | % predicciones correctas | > 52% (baseline aleatorio ~33%) |
| Accuracy en partidos de alta confianza (p > 65%) | Calibración del modelo | > 60% |
| Brier Score promedio | Calidad probabilística | < 0.22 |
| Partidos evaluados (muestra pública) | Tamaño de muestra creíble | > 200 por liga activa |

**Nota crítica**: estas métricas se publican tal cual, incluyendo los malos resultados. El compromiso con la transparencia es no editable una vez que comienza el track record público.

---

## 11. Estructura de Costos

### 11.1 Costos operativos actuales (estado base)

| Item | Costo mensual estimado |
|------|----------------------|
| Render (hosting) | USD 20-50 |
| APIs de datos (football-data, TheSportsDB, API-Football) | USD 0-30 |
| YouTube API | USD 0 (dentro de cuota gratuita) |
| Dominio + SSL | USD 2 |
| **Total actual** | **USD 22-82/mes** |

### 11.2 Costos adicionales al escalar

| Item | Cuándo se activa | Costo estimado |
|------|-----------------|----------------|
| Procesador de pagos (Stripe) | Al activar Pro | 2.9% + USD 0.30 por transacción |
| Auth provider (Clerk/Auth0) | Al activar registro | USD 0-25/mes hasta 10K MAU |
| Email (Resend/Postmark) | Al activar registro y alertas | USD 20-50/mes |
| Push notifications (web) | Fase C | USD 0-30/mes |
| Infraestructura adicional | Al superar 20K MAU | USD 100-300/mes |
| App mobile nativa | Fase D | USD 1.000-3.000 (desarrollo único) |
| **Total a escala (18 meses)** | | **USD 300-500/mes** |

### 11.3 Proyección de rentabilidad

Con 2.500 suscriptores Pro a USD 4.99/mes:
- **Ingresos brutos**: USD 12.475/mes
- **Stripe fees** (~3%): -USD 374
- **Costos operativos**: -USD 400
- **Ingresos afiliación estimados**: +USD 1.000
- **Resultado neto**: ~**USD 12.700/mes**

El modelo es rentable mucho antes de los 2.500 suscriptores. El punto de equilibrio operativo está alrededor de los 200 suscriptores Pro (~USD 1.000 MRR vs ~USD 300-500 costos).

---

## 12. Riesgos y Mitigaciones

### 12.1 Riesgos de producto

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| El modelo predictivo tiene accuracy bajo y se hace público | Media | Crítico | No lanzar el track record público hasta tener mínimo 200 partidos evaluados con métricas sólidas. Si las métricas son malas, trabajar el modelo antes de publicar. |
| Las APIs de datos se caen o cambian de precio | Alta | Alto | Arquitectura multi-proveedor ya implementada. Diversificar antes de escalar. |
| Un competidor grande (SofaScore) lanza features similares | Baja a mediano plazo | Medio | La ventaja competitiva del track record requiere años de datos. No se puede replicar de un mes al otro. |
| Cambios regulatorios en predicciones deportivas | Media | Medio | No operar como plataforma de apuestas. Las predicciones son análisis estadístico, no señales de compra. Consultar con asesor legal en Argentina y España. |

### 12.2 Riesgos de negocio

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Baja conversión Free→Pro | Media | Alto | Iteración rápida del paywall. Testear cuál feature Pro genera más conversión. |
| Churn alto en Pro | Media | Alto | Onboarding activo. Emails de retención basados en engagement. Survey de cancelación. |
| Dependencia de un solo mercado (Uruguay) | Alta si no se expande | Medio | Argentina como mercado paralelo desde el inicio. |
| Dificultad para procesar pagos en Argentina | Alta (restricciones cambiarias) | Medio | Stripe + precio en USD. En Argentina el mercado de USD es normal para SaaS. Alternativa: Mercado Pago. |

### 12.3 Riesgos técnicos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Escalabilidad de la arquitectura actual | Media (>50K usuarios) | Medio | La arquitectura snapshot-first escala bien. El cuello de botella sería DB de usuarios, no el pipeline de datos. |
| Seguridad de datos de usuarios | Baja si se implementa bien | Alto | Usar auth provider probado (Clerk/Auth0). No almacenar passwords propios. GDPR compliance. |
| Latencia de alertas (el gol ya pasó cuando llega la notificación) | Alta | Medio | Alertas de "contexto" en lugar de tiempo real puro. El valor no es ser primero — es ser el más relevante. |

---

## 13. Consideraciones Éticas y Legales

### 13.1 Posición respecto a apuestas

SportsPulse produce probabilidades estadísticas. Esto es legalmente equivalente a lo que publica un periódico deportivo en su sección de pronósticos. No es una plataforma de apuestas y no debe registrarse ni operar como tal.

Sin embargo:
- En algunos mercados (principalmente España), la publicidad de predicciones deportivas está regulada
- El producto no debe presentarse como "señales para apostar" en ningún material de marketing
- Si en el futuro se incorpora afiliación a casas de apuestas, se requiere revisión legal por mercado

### 13.2 GDPR y privacidad

Con usuarios en España, aplica GDPR. Requisitos mínimos:
- Política de privacidad clara
- Consentimiento explícito para emails de marketing
- Derecho al olvido implementable (borrado de cuenta)
- No venta de datos de usuarios a terceros

### 13.3 Derechos de datos deportivos

Los datos de resultados y estadísticas son en general públicos o disponibles bajo licencias libres. Los proveedores actuales (football-data.org, TheSportsDB) permiten uso comercial bajo sus términos. Verificar que los planes de las APIs cubran uso comercial antes de escalar.

---

## 14. Equipo y Recursos

### 14.1 Estado actual

El producto fue construido por un equipo mínimo (en esencia, un solo desarrollador con asistencia de IA). Esto es una fortaleza — la arquitectura es coherente, no tiene deuda técnica de múltiples visiones.

### 14.2 Lo que se necesita para las siguientes fases

| Rol | Cuándo | Cómo |
|-----|--------|------|
| **Diseñador UI/UX** | Fase B (registro, onboarding) | Freelance o contratación part-time. El onboarding bien diseñado puede duplicar la conversión. |
| **Community manager / creador de contenido** | Fase A | Puede ser el propio fundador inicialmente. Clave para la estrategia de Twitter/X y newsletters. |
| **Asesor legal** | Antes de activar pagos | Revisar términos, GDPR, regulación de predicciones por mercado. |
| **Contador / fiscal** | Antes de activar pagos | Estructura jurídica para recibir ingresos internacionales. |

### 14.3 Lo que NO se necesita ahora

- Equipo de ventas (el producto se vende solo o no se vende)
- Equipo de data science separado (el motor predictivo ya existe)
- Inversores externos (el modelo es rentable a escala muy pequeña)

---

## 15. Financiamiento

### 15.1 Postura recomendada: bootstrapped

Con costos operativos de USD 300-500/mes y punto de equilibrio a ~200 suscriptores Pro, SportsPulse puede ser rentable sin inversión externa. Esto es una ventaja enorme — preserva control total del producto y del posicionamiento.

La independencia editorial que es el diferencial central del producto es incompatible con inversores que traigan presión por crecimiento a cualquier costo o por monetización vía apuestas.

### 15.2 Si se busca financiamiento

El caso para inversión externa se activa si:
- El crecimiento orgánico es demostrable (>30K MAU, >1.000 Pro)
- Se necesita escalar el equipo para acelerar el roadmap
- Se identifica una ventana de mercado que requiere movimiento rápido

En ese caso, el perfil de inversor adecuado sería:
- Angels especializados en SaaS o medios deportivos
- Fondos regionales (Uruguay, Argentina, España) con portfolio en digital media
- No: fondos ligados a industria de apuestas o betting

---

## 16. Resumen — La Apuesta

SportsPulse tiene algo que ningún competidor tiene: **un motor de atención y predicción con arquitectura verificable, construido sin conflicto de interés con las apuestas, en mercados donde ese conflicto de interés es cada vez más visible y problemático.**

La apuesta de negocio es simple:
1. Construir la credibilidad del modelo publicando su accuracy honestamente
2. Dejar que esa credibilidad construya la base de usuarios
3. Convertir una fracción de esa base en suscriptores Pro
4. Escalar desde una posición de diferenciación real, no de competencia en precio con SofaScore

Los riesgos son reales pero manejables. El mayor riesgo no es técnico ni de mercado — es de ejecución: que el accuracy del modelo no sea lo suficientemente bueno como para ser publicado con orgullo. Si ese riesgo se materializa, hay que trabajar el modelo antes de comprometer el posicionamiento.

**La honestidad sobre el modelo es el producto. La honestidad sobre el negocio es la estrategia.**

---

*SportsPulse Business Plan v1.0 — Marzo 2026*
*Estado: Borrador para revisión — no vinculante hasta aprobación del fundador*
