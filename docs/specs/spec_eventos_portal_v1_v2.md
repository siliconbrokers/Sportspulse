# Portal Resultados — Especificación funcional y técnica
## Módulo **Eventos** (V1 + V2)

**Estado:** Draft listo para implementación  
**Objetivo:** incorporar una sección **Eventos** en el portal para detectar, clasificar, listar y abrir partidos del día de las ligas objetivo, con foco inicial en Uruguay y con reproducción en flujo de prueba controlado.

---

# 1. Propósito

El portal debe incorporar una nueva opción de menú llamada **Eventos**, ubicada a la derecha de **Videos**.

La sección **Eventos** debe permitir:

1. detectar eventos del día desde una fuente externa de eventos,
2. parsear y normalizar la competición,
3. filtrar por las ligas objetivo del portal,
4. mostrar inicialmente los partidos relevantes de forma usable,
5. permitir abrir la reproducción en una pestaña separada para pruebas,
6. registrar telemetría suficiente para estimar impacto operativo y consumo de recursos.

Esta primera versión **no** busca resolver una integración de reproducción definitiva ni una experiencia final pulida. Busca validar:

- calidad del parseo,
- calidad del filtrado,
- comportamiento horario,
- comportamiento de la reproducción,
- impacto de consumo al abrir el reproductor.

---

# 2. Alcance

## 2.1 Incluido en alcance

- nueva entrada de menú **Eventos**
- vista de eventos del día
- parseo del texto del proveedor
- normalización de competición
- filtrado para 4 ligas objetivo:
  - Uruguay Primera
  - LaLiga
  - Premier League
  - Bundesliga
- fila principal inicial de **Fútbol uruguayo hoy**
- apertura de reproducción en **nueva pestaña**
- modo de prueba para medir consumo
- bloque de debug de parseo en modo test
- tratamiento explícito de desfase horario del proveedor
- reglas preventivas para reducir popups en reproducción embebida de prueba

## 2.2 Fuera de alcance en esta fase

- hosting propio de video
- reemplazo del player externo por proveedor autorizado
- catálogo histórico de eventos
- soporte multi-deporte amplio
- UX final de producción para reproducción integrada
- taxonomía rica desde el origen externo
- garantías de limpieza del reproductor de terceros

---

# 3. Contexto y premisas operativas

## 3.1 Premisa de origen

La fuente externa de eventos no debe considerarse una fuente con taxonomía limpia por liga.  
Debe considerarse una fuente de **texto de evento + estado + hora**, que luego será interpretada por el portal.

## 3.2 Modelo de confianza

El sistema debe asumir que:

- el nombre de la competición puede venir como texto libre,
- la misma competición puede venir con variantes de nombre,
- algunas competiciones no objetivo deben excluirse,
- la hora del proveedor puede no estar en zona horaria local del portal,
- la reproducción de terceros puede incluir comportamiento intrusivo o popups,
- el contenido interno del reproductor de terceros no es controlable por el portal cuando vive en un iframe cross-origin.

## 3.3 Ligas objetivo

El producto debe trabajar inicialmente solo con:

- **URUGUAY_PRIMERA**
- **LALIGA**
- **PREMIER_LEAGUE**
- **BUNDESLIGA**

Toda otra competición deberá clasificarse como:

- `OTRA`, o
- `EXCLUIDA`

según las reglas de normalización.

---

# 4. Objetivos por versión

## 4.1 V1 — Prueba operativa controlada

V1 debe resolver:

- ingesta y parseo de eventos del día,
- identificación de ligas objetivo,
- visualización principal de eventos uruguayos,
- filtros visibles para las 4 ligas,
- apertura de reproducción en nueva pestaña,
- página intermedia de prueba para medir consumo,
- bloque técnico de validación del parseo,
- control preventivo razonable contra popups al embeber el player en página aislada.

## 4.2 V2 — Orden y consolidación

V2 debe resolver:

- filas separadas por liga,
- filtros totalmente funcionales,
- detalle de evento,
- ocultamiento del debug fuera de modo test,
- fortalecimiento del parser,
- exclusión más precisa de copas y torneos no objetivo,
- mejor priorización por estado (`EN_VIVO` primero).

---

# 5. Arquitectura funcional

## 5.1 Flujo de alto nivel

1. El usuario entra a **Eventos**.
2. El portal obtiene eventos del día desde el origen externo.
3. El portal parsea cada evento.
4. El portal normaliza liga, estado y hora.
5. El portal filtra por ligas objetivo.
6. El portal renderiza la vista.
7. El usuario abre la reproducción en una nueva pestaña.
8. El portal registra telemetría de apertura y comportamiento.

## 5.2 Principio de diseño

El portal **no** debe diseñarse alrededor de la UI del proveedor externo.  
El portal debe diseñarse alrededor de su **modelo interno de evento normalizado**.

El proveedor externo es solo un insumo.

---

# 6. Modelo de datos

```ts
export type EventStatus = 'EN_VIVO' | 'PROXIMO' | 'DESCONOCIDO'

export type NormalizedLeague =
  | 'URUGUAY_PRIMERA'
  | 'LALIGA'
  | 'PREMIER_LEAGUE'
  | 'BUNDESLIGA'
  | 'OTRA'
  | 'EXCLUIDA'

export type PlaybackOpenMode = 'DIRECT' | 'EMBED_TEST'

export type ParsedEvent = {
  id: string
  rawText: string
  sourceUrl: string
  sourceLanguage: 'ES' | 'EN' | 'PT' | 'UNKNOWN'

  sourceTimeText: string | null
  sourceCompetitionText: string | null
  sourceStatusText: string | null

  homeTeam: string | null
  awayTeam: string | null

  normalizedLeague: NormalizedLeague
  normalizedStatus: EventStatus

  sourceTimezoneOffsetMinutes: number | null
  startsAtSource: string | null
  startsAtPortalTz: string | null

  isTodayInPortalTz: boolean
  isDebugVisible: boolean

  openUrl: string | null
}
```

---

# 7. Ingesta y fuente externa

## 7.1 Regla general

La implementación debe extraer de la fuente externa únicamente lo que sea necesario para construir el modelo interno.

Debe ignorarse todo lo que no aporte a:

- hora,
- competición,
- equipos,
- estado,
- URL operativa de apertura.

## 7.2 No depender de categorías nativas del proveedor

El sistema no debe depender de que el proveedor entregue un campo limpio de liga.

La clasificación de liga debe hacerse en el portal mediante parsing + normalización.

---

# 8. Parsing del evento

## 8.1 Patrón base esperado

Patrón de texto esperado:

`HH:MM - COMPETICION: LOCAL vs VISITANTE`

## 8.2 Expresión base sugerida

```regex
^(?<time>\d{2}:\d{2})\s*-\s*(?<competition>[^:]+):\s*(?<home>.+?)\s+vs\s+(?<away>.+?)$
```

## 8.3 Comportamiento si no matchea

Si el evento no matchea el patrón esperado:

- el sistema debe conservar `rawText`,
- marcar `normalizedLeague = OTRA`,
- marcar `normalizedStatus = DESCONOCIDO`,
- registrar el caso en debug,
- no mostrarlo en filas de ligas objetivo.

---

# 9. Normalización de competición

## 9.1 Reglas iniciales

### Clasificar como Bundesliga
- `Bundesliga`
- `German Bundesliga`
- `Bundesliga 1`

### Clasificar como LaLiga
- `LaLiga`
- `Spanish La Liga`
- `LaLiga EA Sports`

### Clasificar como Premier League
- `Premier League`
- `EPL`
- `English Premier League`

### Clasificar como Uruguay Primera
- `Primera División`
- `Liga AUF Uruguaya`
- `Apertura AUF`

pero **solo** si además pasa la validación por equipos uruguayos.

## 9.2 Reglas de exclusión

Clasificar como `EXCLUIDA` si la competición coincide con cualquiera de estas:

- `FA Cup`
- `Copa del Rey`
- `DFB Pokal`
- `Carabao Cup`
- `Champions League`
- `Europa League`
- `Conference League`
- `Copa Libertadores`
- `Copa Sudamericana`

## 9.3 Regla por defecto

Toda competición no reconocida y no excluida debe clasificarse como `OTRA`.

---

# 10. Regla especial para Uruguay

## 10.1 Problema

La etiqueta `Primera División` es demasiado ambigua para asumir que siempre corresponde a Uruguay.

## 10.2 Regla obligatoria

Un evento solo podrá clasificarse como `URUGUAY_PRIMERA` si se cumple:

1. la competición coincide con una etiqueta compatible con Uruguay, **y**
2. al menos uno de los equipos pertenece a la whitelist uruguaya.

## 10.3 Whitelist inicial mínima

- Peñarol
- Nacional
- Danubio
- Progreso
- Albion
- Defensor Sporting
- Liverpool Montevideo
- Montevideo Wanderers
- Cerro Largo
- Racing Montevideo
- Boston River
- Plaza Colonia
- Cerro
- River Plate UY
- Miramar Misiones
- Juventud

## 10.4 Regla conservadora

Si `Primera División` aparece pero los equipos no validan Uruguay, el evento debe clasificarse como `OTRA`, nunca como `URUGUAY_PRIMERA`.

---

# 11. Normalización de estado

## 11.1 Estados soportados

- `EN_VIVO`
- `PROXIMO`
- `DESCONOCIDO`

## 11.2 Reglas

### EN_VIVO
Si el texto del proveedor indica cualquiera de estas variantes:
- `En Vivo`
- `Live`
- `LIVE`

### PROXIMO
Si el texto del proveedor indica cualquiera de estas variantes:
- `Pronto`
- `Soon`
- `Upcoming`

### DESCONOCIDO
Si no existe texto de estado usable.

## 11.3 Regla de orden visual

Ordenar eventos así:

1. `EN_VIVO`
2. `PROXIMO`
3. `DESCONOCIDO`

Dentro de cada grupo, ordenar por hora ascendente en zona horaria del portal.

---

# 12. Manejo horario

## 12.1 Problema

La hora publicada por el proveedor no debe asumirse como hora local del portal.

## 12.2 Requisito funcional

El sistema debe almacenar:

- la hora cruda del proveedor,
- el offset de origen asumido,
- la hora convertida a la zona horaria del portal.

## 12.3 Zona horaria del portal

La zona horaria por defecto del portal debe ser configurable y, para esta implementación, debe inicializarse en:

`America/Montevideo`

## 12.4 Zona horaria del proveedor

El proveedor debe tratarse como una fuente con **offset configurable**.

Valor inicial de trabajo:

`sourceTimezoneOffsetMinutes = -300`  
(UTC-5)

## 12.5 Conversión

Dada una hora del proveedor `HH:MM`, el sistema debe:

1. construir datetime de origen usando la fecha del día consultado,
2. aplicar el offset configurado del proveedor,
3. convertir a `America/Montevideo`,
4. mostrar la hora convertida en UI.

## 12.6 Debug horario obligatorio

En modo test, cada evento debe mostrar:

- `source_time_raw`
- `source_timezone_offset`
- `display_time_portal_tz`

## 12.7 Validación cruzada recomendada

Si existe una fuente interna o principal de fixtures en el portal, el sistema debe comparar horario del proveedor contra horario oficial y registrar alerta cuando la diferencia supere el umbral configurado.

Umbral sugerido inicial:

- 20 minutos

---

# 13. UI — Sección Eventos

## 13.1 Menú

Agregar nueva opción de menú:

- **Eventos**

Ubicación:

- a la derecha de **Videos**

## 13.2 Vista principal V1

### Encabezado
- Título: `Eventos`
- Subtítulo: `Partidos de hoy`

### Chips / filtros visibles
- `Uruguay`
- `LaLiga`
- `Premier`
- `Bundesliga`

En V1 los filtros pueden estar visibles desde el inicio, aunque el bloque principal completo sea el de Uruguay.

## 13.3 Fila principal V1

Bloque principal:

- `Fútbol uruguayo hoy`

Cada card debe incluir:

- badge de estado (`EN VIVO`, `PRÓXIMO`, `DESCONOCIDO`)
- hora local del portal
- local vs visitante
- etiqueta de competición normalizada
- botón `Ver partido`
- botón opcional `Abrir prueba`

## 13.4 Fila secundaria opcional V1

Puede incluirse una lista compacta de resultados de parseo para las otras ligas objetivo, sin necesidad de desarrollo visual completo.

---

# 14. Debug de parseo

## 14.1 Objetivo

Permitir validar rápidamente si el sistema está parseando y normalizando bien.

## 14.2 Alcance

Visible solo en `modo_test` o `debug = true`.

## 14.3 Campos por fila

- `raw_event`
- `parsed_time`
- `parsed_competition`
- `normalized_league`
- `parsed_home`
- `parsed_away`
- `parsed_status`
- `source_url`
- `display_time_portal_tz`

## 14.4 Regla

El debug no debe mostrarse a usuario final fuera de entorno de prueba.

---

# 15. Flujo de reproducción

## 15.1 Regla general V1

La reproducción **no** debe abrirse dentro de la página principal de Eventos.

Debe abrirse en una **nueva pestaña**.

## 15.2 Motivo

Separar:

- experiencia principal del portal,
- pruebas de consumo,
- comportamiento del proveedor externo,
- posibles popups o navegación intrusiva.

## 15.3 Modos de apertura

### DIRECT
Abre directamente la URL externa.

### EMBED_TEST
Abre una página interna del portal tipo:

`/eventos/player-test/:id`

que embebe el origen en un iframe aislado.

## 15.4 Botones

### En tarjeta principal
- `Ver partido` → modo `DIRECT`
- `Abrir prueba` → modo `EMBED_TEST`

---

# 16. Página interna de prueba de reproducción

## 16.1 Ruta sugerida

`/eventos/player-test/:id`

## 16.2 Objetivo

Medir comportamiento y consumo del reproductor externo dentro de un contenedor controlado.

## 16.3 UI mínima

Debe mostrar:

- título del evento
- hora local
- liga normalizada
- estado
- fuente externa
- botón `Abrir origen`
- iframe de prueba
- mensaje de fallback si el player no funciona bajo sandbox

---

# 17. Prevención de popups y navegación intrusiva

## 17.1 Hecho técnico base

El portal no puede controlar completamente el comportamiento interno de un player de terceros dentro de un iframe cross-origin.

## 17.2 Objetivo realista

No se busca control total. Se busca **reducir daño** y **aislar impacto**.

## 17.3 Regla obligatoria

En `EMBED_TEST`, el iframe debe usar `sandbox` restrictivo por defecto.

## 17.4 Configuración inicial recomendada

```html
<iframe
  src="..."
  sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
  allow="autoplay; fullscreen"
  referrerpolicy="no-referrer"
  loading="lazy"
></iframe>
```

## 17.5 Restricciones iniciales

No habilitar por defecto:

- `allow-popups`
- `allow-popups-to-escape-sandbox`
- `allow-top-navigation`
- `allow-top-navigation-by-user-activation`

## 17.6 Perfil alternativo de compatibilidad

Solo si el player falla completamente bajo el perfil estricto, se podrá probar un perfil alternativo más permisivo en entorno de test.

## 17.7 Regla de fallback

Si el sandbox bloquea el funcionamiento del player:

- mostrar aviso claro,
- ofrecer botón `Abrir origen en nueva pestaña`.

## 17.8 Regla de producto

Nunca embeber reproducción de terceros sin aislamiento dentro de la home principal de Eventos.

---

# 18. Telemetría y medición

## 18.1 Objetivo

Estimar:

- cuántas aperturas se producen,
- qué modo de apertura funciona mejor,
- cuántos fallos hay,
- qué costo aparente genera la reproducción.

## 18.2 Eventos de telemetría mínimos

### event_list_loaded
- cantidad total parseada
- cantidad por liga
- cantidad excluida

### event_open_clicked
- event_id
- normalized_league
- open_mode
- source_url
- timestamp

### event_player_loaded
- event_id
- open_mode
- success = true/false
- load_duration_ms

### event_player_failed
- event_id
- open_mode
- reason

### event_player_closed
- event_id
- visible_duration_ms

## 18.3 Métricas recomendadas en EMBED_TEST

Si el navegador lo permite:

- tiempo de navegación
- cantidad de requests
- tamaño estimado descargado
- uso de memoria disponible vía APIs del navegador
- errores de carga del iframe

---

# 19. V1 — Requisitos funcionales detallados

## 19.1 Carga inicial

Al abrir Eventos, el sistema debe cargar eventos del día.

## 19.2 Filtrado inicial

El sistema debe calcular internamente las 4 ligas objetivo, aunque visualmente priorice Uruguay.

## 19.3 Render principal

Debe mostrarse un bloque principal de `Fútbol uruguayo hoy` con cards por evento.

## 19.4 Reproducción

Cada card debe permitir abrir la reproducción en nueva pestaña.

## 19.5 Debug

Debe existir bloque técnico visible solo en modo test.

## 19.6 Hora local

La hora visible para el usuario debe ser la hora convertida a la zona del portal, no la hora cruda del proveedor.

## 19.7 Exclusiones

Eventos clasificados como `EXCLUIDA` no deben aparecer en filas principales.

---

# 20. V2 — Requisitos funcionales detallados

## 20.1 Filas separadas por liga

La vista Eventos debe tener bloques separados para:

- Uruguay
- LaLiga
- Premier League
- Bundesliga

## 20.2 Filtros activos

Los chips de filtro deben funcionar para:

- `Todas`
- `Uruguay`
- `LaLiga`
- `Premier`
- `Bundesliga`

## 20.3 Página de detalle

Cada evento debe poder abrir una página de detalle con:

- hora
- estado
- liga
- equipos
- fuente
- botón `Ver partido`
- botón `Abrir prueba`

## 20.4 Debug oculto

El bloque de debug solo debe verse con flag de prueba.

## 20.5 Parser reforzado

V2 debe ampliar diccionario de aliases y blacklist de torneos no objetivo.

## 20.6 Priorización

La vista debe priorizar `EN_VIVO` por encima de `PROXIMO`.

---

# 21. Criterios de aceptación — V1

V1 se considera aceptable si:

1. existe nueva opción de menú `Eventos`,
2. la vista carga eventos del día,
3. el parser identifica correctamente eventos compatibles con Uruguay, LaLiga y Bundesliga en los casos esperados,
4. eventos `FA Cup` no entran como Premier League,
5. `Primera División` no entra como Uruguay sin validación por equipos,
6. la UI muestra una fila funcional de `Fútbol uruguayo hoy`,
7. cada evento ofrece apertura en nueva pestaña,
8. existe modo `EMBED_TEST`,
9. la hora visible está convertida a la zona horaria del portal,
10. existe bloque de debug utilizable en modo test.

---

# 22. Criterios de aceptación — V2

V2 se considera aceptable si:

1. las 4 ligas objetivo tienen render por bloques o filtros completos,
2. el detalle de evento existe,
3. el debug queda oculto fuera de test,
4. los torneos excluidos no contaminan los filtros,
5. la priorización por estado funciona,
6. la normalización tolera variantes de nombre de competición.

---

# 23. Casos límite

## 23.1 Evento sin `vs`
Debe ir a debug y no a filas objetivo.

## 23.2 Evento con competición vacía
Debe clasificarse como `OTRA`.

## 23.3 Evento con hora inválida
Debe mantenerse en debug y ocultarse de la UI principal.

## 23.4 Evento con `Primera División` pero equipos desconocidos
No clasificar como Uruguay.

## 23.5 Evento con nombre de copa de equipo inglés
No clasificar como Premier.

## 23.6 Player externo bloqueado por sandbox
Mostrar fallback con apertura al origen.

---

# 24. Decisiones explícitas del producto

1. **El proveedor externo no define la taxonomía del portal.**
2. **La reproducción no va en la home principal de Eventos.**
3. **El parseo es responsabilidad del portal.**
4. **Uruguay requiere validación por equipos.**
5. **Las copas no deben contaminar filtros de liga.**
6. **La hora del proveedor debe tratarse como configurable.**
7. **La apertura en nueva pestaña es parte del diseño de prueba, no un accidente.**
8. **El aislamiento del player externo es obligatorio en modo embed de prueba.**

---

# 25. Recomendación de implementación

## Orden sugerido

### Paso 1
Construir parser + normalizador + debug list.

### Paso 2
Construir vista `Eventos` con fila `Fútbol uruguayo hoy`.

### Paso 3
Agregar apertura `DIRECT` y `EMBED_TEST`.

### Paso 4
Agregar telemetría mínima.

### Paso 5
Agregar conversión horaria configurable.

### Paso 6
Expandir a V2 con filas por liga y detalle.

---

# 26. Anexo — Supuestos externos validados para esta spec

Los siguientes supuestos deben quedar como memoria de diseño:

1. El proveedor externo expone eventos como texto libre y estados visibles tipo `En Vivo` / `Pronto`, no como taxonomía limpia por liga.
2. La home operativa del proveedor distingue rutas de reproducción manual y automática.
3. La hora del proveedor mostró desfase respecto a Uruguay en las validaciones hechas para esta fase, por lo que debe tratarse como offset configurable.
4. Los iframes sandboxed permiten reducir navegación intrusiva y popups, pero no permiten controlar internamente un player cross-origin.

Estos supuestos no deben codificarse como verdades rígidas; deben implementarse como configuración y reglas observables.

