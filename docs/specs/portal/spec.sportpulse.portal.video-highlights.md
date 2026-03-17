---
artifact_id: SPEC-SPORTPULSE-PORTAL-VIDEO-HIGHLIGHTS
title: "Video Highlights Specification"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: portal
slug: video-highlights
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/specs/portal/spec.sportpulse.portal.video-highlights.md
---
# SportPulse — Especificación de video destacado por liga en panel de noticias

**Versión:** 1.0  
**Estado:** Aprobado para implementación MVP  
**Idioma:** Español  
**Objetivo:** Integrar un bloque simple de video destacado dentro del panel de noticias, mostrando como máximo un video relevante por liga, reproducible mediante embed, sin construir una videoteca ni agregar complejidad innecesaria.

---

# 1. Objetivo funcional

Agregar dentro del panel de noticias una sección de **Video destacado** por liga para:

- Fútbol uruguayo
- LaLiga
- Premier League
- Bundesliga

La funcionalidad debe ser:

- simple
- clara
- visualmente atractiva
- legalmente prudente
- fácil de mantener

La solución debe complementar la sección de noticias ya existente, no reemplazarla.

Cada bloque de liga podrá mostrar:

- un único video destacado
- thumbnail
- título
- fuente/canal
- fecha/hora
- acción para reproducir el video

No se debe:

- construir una videoteca
- mostrar múltiples videos por liga en esta versión
- guardar histórico
- mezclar múltiples plataformas
- hacer scraping de sitios de ligas
- abrir alcance a clips no controlados

---

# 2. Alcance

## Incluido

- Video destacado por liga
- Integración con YouTube como fuente única
- Allowlist de canales aprobados por liga
- Reproducción embebida dentro del portal
- Filtrado por relevancia
- Caché temporal
- Fallbacks por ausencia de video o error de fuente
- Diseño responsive

## Excluido

- Histórico de videos
- Galería de videos
- Carruseles
- Más de un video por liga
- Autoplay
- Audio automático
- Panel de administración editorial
- Curación manual desde UI
- Métricas de views/likes
- Múltiples plataformas de video
- Scraping de portales oficiales
- Shorts como formato prioritario
- IA para resumen o clasificación avanzada

---

# 3. Fuente aprobada

## 3.1 Fuente única

**YouTube** es la única fuente aprobada para la sección de video destacado.

## 3.2 Regla técnica principal

La resolución de videos debe basarse en:

- **allowlist manual de canales por liga**
- lectura de uploads recientes del canal
- filtrado por fecha y relevancia

## 3.3 Restricción

No usar como fuente principal:

- sitios oficiales de ligas
- players externos
- Vimeo
- TikTok
- X
- Twitch
- Facebook Video
- scraping HTML de sitios de terceros

---

# 4. Prioridad de negocio

La prioridad dentro del portal debe respetar el mismo orden que noticias:

1. **Uruguay**
2. **LaLiga**
3. **Premier League**
4. **Bundesliga**

Esto aplica a:

- orden visual de los bloques
- prioridad de resolución si hay restricciones de cuota
- importancia funcional dentro del panel

---

# 5. Regla de producto

Cada liga puede mostrar **como máximo 1 video destacado**.

Si no existe un video válido para una liga:

- no inventar reemplazos
- no abrir a plataformas externas
- no mostrar una lista alternativa
- devolver `null`
- ocultar el bloque de video o mostrar estado vacío simple, según la decisión de UI

---

# 6. Estrategia de obtención

## 6.1 Estrategia principal

Para cada liga:

1. obtener configuración de canal permitido
2. resolver playlist de uploads del canal
3. traer uploads recientes
4. filtrar por fecha válida
5. filtrar por relevancia temática
6. excluir elementos no deseados
7. seleccionar el mejor candidato
8. devolver un único video destacado

## 6.2 Estrategia secundaria

La búsqueda libre en YouTube solo se permite como **fallback excepcional y controlado**.

### Condiciones para usar fallback

- falla la lectura del canal
- el canal no devuelve resultados válidos
- no hay videos que cumplan la ventana de tiempo y relevancia

### Restricciones del fallback

- restringir a tipo `video`
- restringir a videos embebibles
- restringir a videos sindicables/reproducibles fuera de YouTube cuando aplique
- aplicar la misma lógica de filtrado y exclusión
- devolver como máximo un único candidato final

## 6.3 Regla de simplicidad

La búsqueda libre no debe ser el camino normal de operación.

---

# 7. Ventana temporal

## Regla principal

Priorizar videos publicados:

- hoy

## Regla secundaria

Si no hay videos válidos de hoy, aceptar videos publicados en las últimas:

- 48 horas

## Regla final

Si no hay videos válidos dentro de esa ventana:

- no mostrar video para esa liga

---

# 8. Relevancia del contenido

## 8.1 Debe priorizar

- highlights
- goles
- resumen de jornada
- previa de fecha
- análisis oficial corto
- contenido claramente vinculado a la liga correspondiente

## 8.2 Debe evitar

- lives viejos
- promociones genéricas del canal
- contenido institucional irrelevante
- videos políticos
- contenido fuera de la liga
- videos ambiguos o de baja relación temática
- piezas de duración excesiva sin contexto
- clips genéricos no vinculados a la competición

## 8.3 Shorts

No se prohíben por definición, pero **no deben ser prioritarios**.

Si el sistema tiene que elegir entre:

- un resumen estándar relevante
- un short menos informativo

se debe elegir el resumen estándar.

---

# 9. Filtro anti-política obligatorio

La sección de videos no debe mostrar contenido vinculado a política nacional, elecciones o gobierno.

## Regla

Si el título o metadatos disponibles contienen términos políticos bloqueados, el video debe ser excluido.

## Blacklist mínima obligatoria

- elecciones
- elecciones nacionales
- presidenciales
- candidato
- campaña electoral
- parlamento
- congreso
- senado
- diputado
- senador
- gobierno
- ministerio
- ministro
- partido político
- coalición
- intendencia
- alcalde
- presidente de la república

## Observación

No bloquear la palabra `presidente` sola, por el mismo motivo aplicado en noticias.

---

# 10. Allowlist de canales

La resolución de videos debe depender de una configuración manual y explícita de canales aprobados.

## Estructura requerida

```ts
export type LeagueVideoSourceConfig = {
  leagueKey: 'URU' | 'LL' | 'EPL' | 'BUN'
  channelId: string
  channelLabel: string
  enabled: boolean
  fallbackSearchTerms: string[]
}
```

## Reglas

- debe existir exactamente una configuración principal por liga
- la configuración debe vivir en backend
- no debe estar hardcodeada en frontend
- debe poder ajustarse sin cambiar lógica de UI

## Nota

Los valores concretos de `channelId` deben definirse en configuración del proyecto antes de despliegue.

---

# 11. Lógica de selección del mejor video

Para cada candidato, el backend debe calcular una prioridad basada en señales simples.

## Señales positivas sugeridas

- coincidencia con nombre de la liga
- coincidencia con equipos priorizados de esa liga
- presencia de términos como:
  - highlights
  - goles
  - resumen
  - jornada
  - previa
  - fecha
  - matchday
- publicación más reciente
- canal permitido correcto

## Señales negativas sugeridas

- términos políticos
- título demasiado genérico
- título no deportivo
- live antiguo
- promo genérica
- duración excesiva sin contexto, si ese dato está disponible
- contenido claramente fuera de la liga

## Regla final

Se debe seleccionar un único candidato con mejor score relativo dentro del conjunto filtrado.

---

# 12. Relación con standings y equipos priorizados

Si el portal ya tiene lógica de equipos priorizados por liga para noticias, esa lógica debe reutilizarse también para video.

## Reglas

- usar `leagueKey` común
- reutilizar helpers de standings si existen
- reutilizar lista de equipos priorizados si ya fue implementada para noticias
- no duplicar reglas sin necesidad

## Motivo

Mantener consistencia entre noticia destacada y video destacado.

---

# 13. Modelo de datos canónico

Todo video debe transformarse a una estructura común antes de llegar al frontend.

```ts
type LeagueVideoHighlight = {
  id: string
  leagueKey: 'URU' | 'LL' | 'EPL' | 'BUN'
  title: string
  videoId: string
  videoUrl: string
  embedUrl: string
  thumbnailUrl: string | null
  channelTitle: string
  publishedAtUtc: string
  sourceName: string
}
```

## Campos obligatorios

- `id`
- `leagueKey`
- `title`
- `videoId`
- `videoUrl`
- `embedUrl`
- `channelTitle`
- `publishedAtUtc`
- `sourceName`

## Campo opcional

- `thumbnailUrl`

---

# 14. Contrato backend → frontend

El frontend debe recibir un contrato limpio, listo para renderizar.

## Respuesta sugerida por bloque

```ts
type LeagueNewsPanelBlock = {
  leagueKey: 'URU' | 'LL' | 'EPL' | 'BUN'
  leagueLabel: string
  featuredVideo: LeagueVideoHighlight | null
  headlines: NewsHeadline[]
}
```

## Regla

La resolución de `featuredVideo` ocurre completamente en backend.

El frontend:

- no busca videos
- no decide relevancia
- no aplica filtros editoriales
- no mezcla plataformas

---

# 15. Caché

## Regla

Usar caché temporal simple.

### TTL sugerido

- 30 a 60 minutos por liga

## Comportamiento

- no persistir histórico
- no almacenar snapshots permanentes
- si vence caché, rehacer resolución
- si cambia el día, el refresco se resuelve de forma natural por expiración de caché

## Restricción

No sobredimensionar con colas, workers o pipelines innecesarios.

---

# 16. Fallbacks

## Si falla YouTube para una liga

- devolver `featuredVideo = null`
- no romper el resto del panel
- seguir mostrando noticias normalmente

## Si no hay video válido

- devolver `null`
- el frontend decide ocultar el bloque o mostrar vacío discreto

## Si falta thumbnail

- usar placeholder visual
- no descartar el video solo por eso

## Si el embed falla

- ofrecer link externo al video
- no bloquear la interacción completa

---

# 17. Reglas de UI

## 17.1 Posición dentro del bloque de liga

El video destacado debe convivir con las noticias de la misma liga.

Opciones válidas:

- debajo del encabezado de la liga y antes del grid de noticias
- al costado del grid en desktop y arriba en mobile

## Regla de decisión

Elegir la opción más simple y visualmente clara sin complicar innecesariamente el layout existente.

## 17.2 Contenido visual mínimo del bloque de video

Cada bloque debe mostrar:

- thumbnail grande
- título
- canal/fuente
- fecha/hora
- acción clara para reproducir

## 17.3 Interacción

Opciones válidas:

- abrir modal con reproductor embebido
- expandir inline el iframe

## Regla

Elegir la opción que implique:

- menor impacto en performance
- menor complejidad técnica
- mejor claridad de uso

---

# 18. Reglas de UX

## Obligatorio

- no autoplay
- no sonido automático
- no cargar múltiples iframes al abrir la página
- lazy load del embed
- mantener experiencia limpia en mobile
- no competir visualmente con el grid de noticias

## No deseado

- sliders
- carruseles
- tabs complejas
- masonry caótico
- grillas de miniaturas múltiples
- efectos excesivos

---

# 19. Responsive

## Desktop

- el bloque de video puede convivir con el grid de noticias si el layout lo soporta
- no debe romper el orden visual por liga

## Tablet

- simplificar layout
- priorizar legibilidad

## Mobile

- ancho completo
- thumbnail proporcionado
- interacción simple
- no saturar verticalmente el bloque

## Regla general

La integración de video debe sentirse como parte del panel de noticias, no como un módulo separado y pesado.

---

# 20. Estructura de módulos sugerida

## Backend

- `videoSourcesConfig.ts`
- `youtubeVideoService.ts`
- `videoRelevance.ts`
- `videoFilters.ts`
- `videoNormalizer.ts`
- `videoCache.ts`
- `getLeagueFeaturedVideo.ts`

## Frontend

- `LeagueFeaturedVideoCard.tsx`
- `VideoPlayTrigger.tsx`
- `VideoEmbedModal.tsx` o equivalente inline
- integración en bloque existente de noticias por liga

---

# 21. Reglas de implementación

## Backend

Debe encargarse de:

- resolver fuente
- leer uploads del canal
- aplicar fallback si corresponde
- filtrar por fecha
- filtrar por blacklist
- filtrar por relevancia
- seleccionar el mejor video
- normalizar al modelo canónico
- cachear el resultado

## Frontend

Debe encargarse de:

- renderizar el video destacado si existe
- mostrar placeholder si falta thumbnail
- abrir modal o expandir embed
- mantener responsive
- no aplicar inteligencia editorial

---

# 22. Requisitos no funcionales

## Simplicidad

La solución debe ser pequeña, entendible y mantenible.

## Robustez

La caída del módulo de video no debe romper noticias ni el portal.

## Bajo acoplamiento

El bloque de video debe acoplarse al panel de noticias sin contaminar otras áreas.

## Performance

Evitar iframes activos innecesarios al cargar la página.

## Escalabilidad controlada

La arquitectura debe permitir cambiar canales o ampliar filtros sin rehacer el sistema.

---

# 23. Fuera de alcance en esta versión

No implementar:

- múltiples videos por liga
- playlist navegable
- selección manual desde admin
- métricas de popularidad
- guardado de favoritos
- comentarios
- resumen IA del video
- extracción de transcript
- recomendación personalizada
- mezcla con highlights de otras plataformas
- ranking por engagement

---

# 24. Criterios de aceptación

La funcionalidad se considera aceptada cuando:

1. existe un bloque de video destacado dentro del panel de noticias por liga
2. la fuente única usada es YouTube
3. la resolución principal se hace desde canales aprobados por liga
4. como máximo se muestra 1 video por liga
5. se priorizan videos de hoy y, si no hay, últimas 48 horas
6. si no hay video válido, la liga puede quedar sin video sin romper la UI
7. el video se puede reproducir embebido o abrirse de forma controlada
8. no existe autoplay
9. no se cargan múltiples iframes pesados al iniciar la página
10. el frontend recibe un contrato limpio con `featuredVideo`
11. no se altera la funcionalidad ya existente de noticias
12. no se incorporan otras plataformas de video
13. no aparecen videos políticos o fuera de la liga
14. el layout funciona en desktop, tablet y mobile

---

# 25. Resumen ejecutivo final

## Decisión cerrada

- **Fuente única:** YouTube
- **Resolución principal:** allowlist de canales por liga
- **Resolución secundaria:** búsqueda controlada como fallback excepcional
- **Cantidad:** 1 video máximo por liga
- **Ventana temporal:** hoy, o hasta 48 horas si no hay contenido del día
- **Integración:** dentro del panel de noticias ya existente
- **UX:** thumbnail + título + fuente + fecha + reproducción embebida bajo demanda

## Criterios clave

- simple
- controlado
- sin problemas de licencias por scraping extraño
- sin complejidad innecesaria
- sin transformar el portal en una videoteca

## Prioridad visual y funcional

1. Uruguay
2. LaLiga
3. Premier League
4. Bundesliga
