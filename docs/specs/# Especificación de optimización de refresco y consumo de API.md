\# Especificación de optimización de refresco y consumo de API  
\#\# Proyecto: Portal de resultados / competiciones de fútbol  
\#\# Objetivo: reducir al mínimo las llamadas inútiles a la API sin perder consistencia operativa

\---

\# 1\. Propósito

Este documento define la lógica de refresco, cacheo y revalidación de datos de competiciones y partidos para evitar llamadas innecesarias a la API.

La regla principal es simple:

\> \*\*No se refresca por costumbre. Se refresca solo lo que razonablemente puede cambiar.\*\*

El sistema no debe volver a consultar de forma repetitiva datos que son esencialmente estables durante una temporada.

\---

\# 2\. Problema actual

El patrón actual tiene un costo innecesario:

\- se hacen llamadas frecuentes sobre datos que no cambian;  
\- se vuelve a pedir una gran cantidad de partidos históricos o ya cerrados;  
\- se refresca metadata de competición y equipos más veces de las necesarias;  
\- se procesa una respuesta grande para terminar descartando casi todo por cache.

\#\# Ejemplo típico del problema

\- se llama a \`/competitions/{code}/matches\`  
\- la API devuelve toda la temporada  
\- el sistema procesa cientos de partidos  
\- el cache conserva solo unos pocos relevantes  
\- el resto fue una llamada inútil

Eso debe corregirse.

\---

\# 3\. Principio rector

La política de refresco debe estar basada en \*\*mutabilidad real del dato\*\*, no en un refresh global uniforme.

\#\# Regla operativa

Los datos se dividen en tres categorías:

\#\#\# A. Datos casi inmutables  
Cambian rara vez o prácticamente nunca durante una temporada.

Ejemplos:  
\- metadata de competición  
\- lista de equipos  
\- partidos históricos terminales  
\- jornadas cerradas hace tiempo

\#\#\# B. Datos lentamente mutables  
Pueden cambiar, pero no con alta frecuencia.

Ejemplos:  
\- próximos partidos  
\- horarios  
\- cambios de estado previos al inicio  
\- postergaciones

\#\#\# C. Datos altamente mutables  
Pueden cambiar seguido en ventanas cortas de tiempo.

Ejemplos:  
\- partidos en vivo  
\- partidos por comenzar en breve  
\- partidos recién finalizados  
\- partidos suspendidos o pausados

\---

\# 4\. Objetivos del rediseño

El sistema debe cumplir estos objetivos:

1\. evitar pedir toda la temporada en cada refresh;  
2\. no volver a consultar partidos terminales salvo excepción controlada;  
3\. no refrescar metadata de competición y equipos de forma frecuente;  
4\. refrescar seguido únicamente lo que esté vivo o cerca de cambiar;  
5\. actualizar standings solo cuando exista una causa real;  
6\. mantener una arquitectura simple, predecible y barata en llamadas.

\---

\# 5\. Alcance de esta optimización

Esta lógica aplica a:

\- metadata de competición;  
\- equipos participantes;  
\- calendario de partidos;  
\- estados de partido;  
\- resultados;  
\- standings/tablas.

\#\# No aplica a:

\- alineaciones en vivo;  
\- eventos play-by-play;  
\- estadísticas avanzadas en tiempo real;  
\- cálculos complejos de clasificación intertorneos.

Este sistema está orientado a mostrar:

\- partidos,  
\- resultados,  
\- tablas,  
\- fases y cruces.

No está orientado a seguimiento ultra fino en tiempo real.

\---

\# 6\. Política de cache por tipo de dato

\#\# 6.1 Competición (\`competition info\`)

Incluye:  
\- nombre  
\- código  
\- temporada  
\- área  
\- branding básico  
\- metadata estable

\#\#\# Política  
\- cargar en startup;  
\- persistir en cache local;  
\- no refrescar en cada ciclo;  
\- revalidar con TTL largo.

\#\#\# TTL recomendado  
\- entre 7 y 30 días

\#\#\# Motivo  
La metadata de competición no cambia operativamente durante una temporada en condiciones normales.

\---

\#\# 6.2 Equipos (\`teams\`)

Incluye:  
\- lista de equipos  
\- nombre  
\- sigla  
\- escudo  
\- país/área

\#\#\# Política  
\- cargar en startup o al detectar una nueva temporada;  
\- cache persistente;  
\- no refrescar en cada ciclo;  
\- revalidación esporádica.

\#\#\# TTL recomendado  
\- entre 7 y 30 días  
\- o 1 vez por temporada si el sistema lo soporta

\#\#\# Motivo  
Los equipos participantes de una edición no cambian continuamente. Refrescarlos a diario o por refresh operativo es desperdicio.

\---

\#\# 6.3 Partidos terminales

Estados terminales típicos:  
\- \`FINISHED\`  
\- \`AWARDED\`  
\- \`CANCELLED\`

\#\#\# Política  
\- almacenar localmente;  
\- no volver a consultarlos en refresh frecuente;  
\- solo permitir revalidación rara y controlada si se quiere proteger contra correcciones administrativas.

\#\#\# TTL recomendado  
\- largo, por ejemplo 30 días o más  
\- o “no refrescar automáticamente” tras consolidación

\#\#\# Nota  
No asumir que \`FINISHED\` es absolutamente eterno en todos los casos. Pero tampoco usar ese caso raro como excusa para martillar la API continuamente.

\---

\#\# 6.4 Partidos futuros lejanos

Ejemplo:  
\- partidos dentro de varios días o semanas

\#\#\# Política  
\- refresco ocasional;  
\- no deben formar parte del loop corto.

\#\#\# TTL recomendado  
\- varias horas o 1 vez al día

\#\#\# Motivo  
Pueden existir cambios de horario o postergación, pero no justifican polling agresivo.

\---

\#\# 6.5 Partidos próximos

Ejemplo:  
\- hoy  
\- mañana  
\- ventana cercana

\#\#\# Política  
\- refresco moderado;  
\- revisar si hay cambio de hora, estado o postergación.

\#\#\# TTL recomendado  
\- entre 15 y 60 minutos, según cercanía

\---

\#\# 6.6 Partidos en vivo o inminentes

Estados típicos:  
\- \`TIMED\`  
\- \`IN\_PLAY\`  
\- \`PAUSED\`  
\- \`SUSPENDED\`  
\- \`EXTRA\_TIME\`  
\- \`PENALTY\_SHOOTOUT\`

\#\#\# Política  
\- refresco corto;  
\- mientras dure su mutabilidad.

\#\#\# TTL recomendado  
\- entre 1 y 5 minutos

\---

\# 7\. Regla de diseño: no refrescar por jornada, refrescar por mutabilidad

\#\# Error a evitar

La lógica no debe estar acoplada rígidamente a:

\- “jornada actual”  
\- “jornada siguiente”

Eso es una heurística útil, pero insuficiente.

\#\#\# Falla en casos como:  
\- postergaciones;  
\- recuperaciones;  
\- adelantamientos;  
\- partidos fuera de su jornada original;  
\- reanudaciones.

\#\# Regla correcta

El sistema debe trabajar con una \*\*watchlist de partidos mutables\*\*.

\---

\# 8\. Watchlist de partidos mutables

\#\# Definición  
La watchlist es el conjunto de partidos que todavía pueden cambiar y que, por lo tanto, justifican nuevas consultas.

\#\# Deben entrar a watchlist

\- partidos no iniciados dentro de una ventana cercana;  
\- partidos en vivo;  
\- partidos pausados o suspendidos;  
\- partidos postergados;  
\- partidos recién terminados que aún podrían requerir consolidación;  
\- partidos con estado no terminal.

\#\# Deben salir de watchlist

\- partidos ya terminales y consolidados;  
\- partidos antiguos sin posibilidad razonable de cambio.

\---

\# 9\. Estrategia operativa recomendada

\#\# 9.1 Startup

Al iniciar el sistema:

1\. cargar metadata de competición;  
2\. cargar equipos;  
3\. cargar calendario base necesario;  
4\. cargar standings si corresponde;  
5\. construir watchlist inicial.

Esto establece una foto inicial del torneo.

\---

\#\# 9.2 Refresh operativo

Cada ciclo de refresh debe trabajar solo sobre:

\- partidos de la watchlist;  
\- o una ventana temporal corta configurada.

No debe volver a pedir la temporada completa.

\---

\#\# 9.3 Reconstrucción de watchlist

Después de cada refresh:

1\. actualizar estados de los partidos consultados;  
2\. remover partidos que ya quedaron terminales y consolidados;  
3\. agregar partidos que se acercan temporalmente;  
4\. mantener partidos anómalos (\`POSTPONED\`, \`SUSPENDED\`) bajo observación.

\---

\# 10\. Ventana temporal recomendada

Se recomienda que la lógica de consulta activa opere sobre una ventana temporal, no sobre toda la temporada.

\#\# Propuesta razonable

Consultar solo:

\- partidos de los últimos 2 días;  
\- partidos de los próximos 7 días;  
\- más cualquier partido que esté en watchlist por estado anómalo.

Esto cubre:

\- cierres recientes;  
\- partidos en vivo;  
\- próximos partidos;  
\- postergaciones;  
\- reanudaciones.

\---

\# 11\. Política de standings

\#\# Regla principal

La tabla no debe refrescarse por reloj.  
Debe refrescarse solo si hubo un cambio que razonablemente impacte standings.

\#\# Triggers válidos

Actualizar standings cuando ocurra alguno de estos eventos:

\- un partido cambia a estado terminal;  
\- cambia el score de un partido relevante;  
\- un partido suspendido se completa;  
\- una corrección administrativa altera resultado o estado;  
\- la API reporta una actualización material.

\#\# No refrescar standings si

\- no hubo cambios en partidos que afecten puntos, goles o posiciones;  
\- solo cambió metadata irrelevante;  
\- el sistema hizo refresh de rutina sin cambios reales.

\---

\# 12\. Política específica por escenario

\#\# Escenario A: fecha jugándose sábado y domingo

Supongamos:  
\- los partidos del sábado ya terminaron;  
\- los del domingo aún no se jugaron.

\#\#\# Regla correcta

Entre sábado noche y domingo antes del inicio:

\- no seguir refrescando cada 5 minutos los partidos del sábado ya cerrados;  
\- solo vigilar los del domingo y cualquier caso anómalo.

\#\#\# Lo incorrecto

Volver a pedir toda la fecha completa en loop corto.

\---

\#\# Escenario B: no hay partidos hoy

\#\#\# Regla correcta  
No llamar a la API o hacerlo con mínima frecuencia de mantenimiento.

\#\#\# Lo incorrecto  
Seguir disparando ciclos operativos como si hubiera actividad.

\---

\#\# Escenario C: partido postergado

\#\#\# Regla correcta  
Mantener el partido en watchlist con frecuencia baja/moderada hasta que cambie de estado o fecha.

\#\#\# Lo incorrecto  
Congelarlo como si ya estuviera muerto o pedir toda la temporada para detectarlo.

\---

\# 13\. Qué NO debe hacer el sistema

El sistema no debe:

\- pedir toda la temporada en cada refresh;  
\- refrescar equipos continuamente;  
\- refrescar metadata de competición continuamente;  
\- volver a consultar jornadas históricas cerradas sin motivo;  
\- recalcular o reprocesar cientos de partidos para actualizar dos;  
\- refrescar standings por mera rutina temporal;  
\- tratar igual un partido de hace 3 meses y uno en vivo.

\---

\# 14\. Qué SÍ debe hacer el sistema

El sistema sí debe:

\- cachear fuerte la información estable;  
\- separar datos por mutabilidad;  
\- usar watchlist de partidos vivos o cercanos;  
\- consultar solo ventana relevante;  
\- refrescar standings por disparadores reales;  
\- mantener trazabilidad sobre qué datos son cacheados y por qué.

\---

\# 15\. Arquitectura objetivo

\#\# Flujo deseado

\#\#\# Startup  
\- carga inicial amplia y controlada

\#\#\# Cache estable  
\- competición  
\- equipos  
\- partidos terminales  
\- standings consolidados

\#\#\# Refresh activo  
\- solo watchlist \+ ventana corta

\#\#\# Refresh de standings  
\- solo ante cambio material

\#\#\# Revalidación de metadata  
\- TTL largo, no operativa

\---

\# 16\. Especificación funcional resumida

\#\# Metadata de competición  
\- fetch en startup  
\- TTL largo  
\- sin polling frecuente

\#\# Equipos  
\- fetch en startup o por temporada  
\- TTL largo  
\- sin polling frecuente

\#\# Partidos terminales  
\- cache persistente  
\- no re-fetch operativo

\#\# Partidos futuros cercanos  
\- refresh moderado

\#\# Partidos en vivo/inminentes  
\- refresh corto

\#\# Standings  
\- refresh por trigger real

\---

\# 17\. Pseudoflujo de implementación

\`\`\`text  
1\. Boot del sistema  
  \- cargar competition info  
  \- cargar teams  
  \- cargar matches base  
  \- cargar standings  
  \- construir watchlist

2\. En cada ciclo operativo  
  \- identificar partidos mutables  
  \- pedir solo esos partidos o su ventana corta  
  \- actualizar cache local  
  \- detectar cambios materiales

3\. Si hubo cambio material  
  \- refrescar standings

4\. Reconstruir watchlist  
  \- remover partidos ya muertos  
  \- mantener postergados/suspendidos  
  \- agregar partidos próximos  
---

# **18\. Criterios de aceptación**

La implementación se considerará correcta si cumple esto:

1. no vuelve a pedir la temporada completa en cada refresh;

2. no refresca metadata de competición y equipos en loop operativo;

3. no reconsulta continuamente partidos terminales;

4. concentra las llamadas en partidos mutables;

5. standings solo se actualiza cuando hay un motivo real;

6. el sistema sigue detectando postergaciones, reanudaciones y cierres recientes;

7. el volumen total de llamadas baja de forma clara frente al comportamiento actual.

---

# **19\. Decisión de diseño final**

La lógica de actualización del sistema debe basarse en:

**mutabilidad del partido \+ cercanía temporal \+ estado del partido**

No debe basarse en:

* refresh global uniforme;

* temporada completa en cada ciclo;

* polling continuo sobre datos muertos;

* reglas rígidas de jornada que no soportan anomalías.

---

# **20\. Instrucción final de implementación**

Claude debe implementar esta optimización bajo estas restricciones:

* priorizar reducción fuerte de llamadas inútiles;

* no degradar consistencia operativa;

* no introducir complejidad excesiva;

* evitar recálculos globales;

* mantener la solución simple, explicable y medible.

## **Prioridad máxima**

Reducir llamadas innecesarias sobre datos repetitivos.

## **Prioridad secundaria**

Mantener correctamente actualizados:

* partidos vivos,

* partidos próximos,

* partidos con estado anómalo,

* standings afectados por cambios reales.

