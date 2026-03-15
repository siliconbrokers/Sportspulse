\# SPEC — Back Office simple para habilitación de torneos y features de menú

\#\# 1\. Objetivo

Implementar un back office simple que permita controlar, sin tocar código, qué competiciones están disponibles en el portal y qué opciones opcionales del menú principal deben mostrarse al usuario.

La finalidad no es solo de UI. El control debe impactar también en backend para evitar consumo innecesario de créditos/API sobre competiciones deshabilitadas.

\---

\#\# 2\. Problema a resolver

Hoy el portal expone competiciones y features de forma estática o acoplada a la implementación actual.

Se necesita un mecanismo administrativo para:

1\. \*\*Habilitar o deshabilitar competiciones específicas\*\* en el portal.  
2\. \*\*Habilitar o deshabilitar opciones opcionales del menú principal\*\*, al menos:  
  \- TV  
  \- Pronósticos  
3\. Garantizar que las competiciones deshabilitadas:  
  \- no aparezcan en el frontend,  
  \- no puedan ser accedidas indirectamente,  
  \- y \*\*no disparen consumo de APIs, noticias, videos, ni procesos asociados\*\*.

\---

\#\# 3\. Alcance funcional

\#\#\# 3.1 Gestión de competiciones  
El back office debe mostrar una lista de competiciones disponibles en el sistema, por ejemplo:

\- Fútbol Uruguayo  
\- Liga Argentina  
\- Premier League  
\- La Liga  
\- Bundesliga  
\- Copa del Mundo  
\- Copa Libertadores

Para cada competición, el administrador debe poder marcarla como:

\- \*\*Habilitada\*\*  
\- \*\*Deshabilitada\*\*

\#\#\# 3.2 Gestión de features opcionales del menú  
El back office debe permitir configurar al menos dos toggles independientes:

\- Mostrar/ocultar opción \*\*TV\*\*  
\- Mostrar/ocultar opción \*\*Pronósticos\*\*

\#\#\# 3.3 Efecto transversal de deshabilitación  
Cuando una competición está deshabilitada, el sistema debe aplicar esa decisión en todos los niveles relevantes:

\- Selector de competiciones / ligas / torneos  
\- Navegación y acceso directo  
\- Endpoints de datos del portal  
\- Procesos automáticos de fetch/sync  
\- Noticias relacionadas  
\- Videos relacionados  
\- Cualquier proceso que consuma créditos/API para esa competición

\---

\#\# 4\. Regla de negocio principal

\#\#\# 4.1 Regla base  
Una competición deshabilitada debe quedar en estado \*\*inactivo para exposición y consumo\*\*.

Eso significa simultáneamente:

1\. \*\*No visible\*\* en el portal.  
2\. \*\*No seleccionable\*\* por el usuario.  
3\. \*\*No accesible\*\* por rutas o parámetros manuales.  
4\. \*\*No elegible\*\* para procesos backend que consuman recursos externos.

\#\#\# 4.2 Regla de no consumo  
El sistema \*\*no debe ejecutar fetch, sync, refresh, enrichments ni carga de contenido\*\* para competiciones deshabilitadas.

Esto incluye, como mínimo:

\- fixtures / partidos,  
\- standings / tablas,  
\- estadísticas,  
\- noticias,  
\- videos,  
\- predicciones o cálculos asociados,  
\- tareas programadas,  
\- warmups de cache,  
\- refrescos automáticos.

\#\#\# 4.3 Regla de persistencia  
Deshabilitar una competición \*\*no implica borrar sus datos históricos\*\*.

Comportamiento esperado:  
\- los datos existentes pueden permanecer almacenados,  
\- pero no deben seguir siendo expuestos ni refrescados mientras la competición esté deshabilitada.

Si en el futuro se requiere borrar datos, eso debe ser otra feature separada.

\---

\#\# 5\. Definiciones

\#\#\# 5.1 Competición  
Entidad concreta que representa un torneo/liga visible y operable dentro del portal.

Ejemplos:  
\- Premier League  
\- Bundesliga  
\- Copa Libertadores  
\- World Cup 2026

\#\#\# 5.2 Competición habilitada  
Competición autorizada para:  
\- ser visible en frontend,  
\- ser consultada por endpoints públicos,  
\- participar en procesos de actualización de datos y contenido.

\#\#\# 5.3 Competición deshabilitada  
Competición excluida de:  
\- UI,  
\- navegación,  
\- fetch de backend,  
\- contenido relacionado,  
\- consumo de créditos/API.

\#\#\# 5.4 Feature toggle de menú  
Configuración booleana que controla la visibilidad de una opción completa del menú principal.

En esta versión:  
\- \`tv\_enabled\`  
\- \`predictions\_enabled\`

\---

\#\# 6\. Requerimientos funcionales

\#\# RF-01 — Pantalla de back office para competiciones  
El sistema debe ofrecer una pantalla simple de administración donde se liste el catálogo de competiciones conocidas por el portal.

Cada fila debe mostrar como mínimo:  
\- nombre visible,  
\- identificador interno / slug,  
\- estado actual (habilitada/deshabilitada),  
\- acción para cambiar estado.

\#\# RF-02 — Persistencia de estado por competición  
El sistema debe persistir el estado habilitada/deshabilitada por competición.

El estado no puede depender de variables temporales en memoria ni de cambios manuales en código.

\#\# RF-03 — Selector del frontend filtrado  
El selector de ligas/torneos del frontend debe incluir únicamente competiciones habilitadas.

Una competición deshabilitada no debe aparecer:  
\- en dropdowns,  
\- tabs,  
\- filtros,  
\- buscadores internos,  
\- vistas iniciales,  
\- navegación derivada.

\#\# RF-04 — Bloqueo de acceso indirecto  
Si un usuario intenta acceder manualmente a una competición deshabilitada por:  
\- URL directa,  
\- slug,  
\- query param,  
\- ID interno,  
el sistema debe rechazar el acceso de forma controlada.

Comportamiento aceptable:  
\- 404  
\- 403  
\- redirección a una vista segura  
\- respuesta vacía controlada

Lo importante es que \*\*no exponga datos\*\*.

\#\# RF-05 — Pantalla de back office para menú opcional  
El sistema debe ofrecer una segunda sección o bloque de configuración general con toggles para:

\- TV  
\- Pronósticos

\#\# RF-06 — Visibilidad del menú principal  
Si \`tv\_enabled \= false\`, la opción TV no debe aparecer en el menú principal ni en accesos derivados.

Si \`predictions\_enabled \= false\`, la opción Pronósticos no debe aparecer en el menú principal ni en accesos derivados.

\#\# RF-07 — Bloqueo funcional de módulos opcionales  
No alcanza con ocultar el ítem del menú.

Si una feature está deshabilitada:  
\- sus rutas no deben quedar operativas hacia el usuario final,  
\- sus cargas automáticas no deben ejecutarse,  
\- sus componentes no deben montarse ni pedir datos innecesariamente.

\#\# RF-08 — Exclusión de competiciones en jobs/backend  
Todo proceso backend que trabaje por competición debe filtrar exclusivamente competiciones habilitadas antes de consumir APIs externas.

Esto aplica a:  
\- sincronización de partidos,  
\- standings,  
\- estadísticas,  
\- noticias,  
\- videos,  
\- módulos de predicción,  
\- generación de cache,  
\- procesos batch o cron.

\#\# RF-09 — Exclusión de noticias y videos por competición  
Los módulos que obtienen noticias y videos deben respetar el estado de habilitación de la competición asociada.

Si una competición está deshabilitada:  
\- no deben buscarse noticias de esa competición,  
\- no deben buscarse videos de esa competición,  
\- no deben enriquecerse resultados relacionados,  
\- no deben consumirse créditos/API para ese contenido.

\#\# RF-10 — Consistencia total entre front y back  
La fuente de verdad del estado habilitado/deshabilitado debe ser única.

No se admite:  
\- una lista hardcodeada en frontend,  
\- otra distinta en backend,  
\- o filtros divergentes entre módulos.

Debe existir una única configuración efectiva que gobierne todo el sistema.

\#\# RF-11 — Aplicación casi inmediata del cambio  
Cuando el administrador cambia el estado de una competición o feature:  
\- el cambio debe reflejarse en el sistema sin necesidad de deploy,  
\- y con impacto visible en el portal en un plazo razonable.

Ideal:  
\- inmediato o tras invalidación de cache.

\#\# RF-12 — Auditoría mínima  
El sistema debe registrar al menos:  
\- qué configuración cambió,  
\- valor anterior,  
\- valor nuevo,  
\- fecha/hora,  
\- usuario administrador que realizó el cambio.

\---

\#\# 7\. Requerimientos de UI del back office

\#\# 7.1 Diseño general  
La interfaz debe ser simple, administrativa y de baja fricción.

No se busca un CMS complejo. Se busca un panel operativo mínimo.

\#\# 7.2 Secciones sugeridas

\#\#\# Sección A — Competiciones disponibles  
Tabla o lista con:  
\- Nombre  
\- Slug / ID  
\- Estado  
\- Toggle habilitar/deshabilitar

\#\#\# Sección B — Opciones del menú  
Bloque con switches:  
\- Mostrar TV  
\- Mostrar Pronósticos

\#\#\# Sección C — Acción de guardado  
Dependiendo de arquitectura:  
\- guardado automático al cambiar toggle, o  
\- botón “Guardar cambios”

Si hay botón de guardado, debe existir feedback claro de éxito/error.

\#\# 7.3 Feedback visual  
Cada cambio debe informar:  
\- guardado correcto,  
\- error al persistir,  
\- eventual necesidad de refresco de cache si aplica.

\---

\#\# 8\. Requerimientos de arquitectura

\#\# 8.1 Fuente única de verdad  
Debe existir una fuente central de configuración, por ejemplo:

\- tabla de base de datos,  
\- servicio de configuración,  
\- store persistente centralizado.

No debe depender de:  
\- flags hardcodeados,  
\- constantes en frontend,  
\- listas manuales separadas por módulo.

\#\# 8.2 Catálogo formal de competiciones  
Cada competición debe tener una identidad formal única.

Ejemplo mínimo:

\- \`id\`  
\- \`slug\`  
\- \`display\_name\`  
\- \`enabled\`

Idealmente también:  
\- \`provider\_competition\_id\`  
\- \`provider\_name\`  
\- \`content\_mapping\_key\`  
\- \`sort\_order\`

\#\# 8.3 Gate central de elegibilidad  
Debe existir una lógica central reutilizable del tipo:

\- \`isCompetitionEnabled(competitionId | slug)\`  
\- \`getEnabledCompetitions()\`  
\- \`isFeatureEnabled(featureKey)\`

Todos los módulos deben consultar esa capa antes de actuar.

\#\# 8.4 Prohibición de filtros dispersos  
No se debe resolver con \`if\` locales repetidos por módulo del tipo:  
\- “si es Bundesliga, no traer”  
\- “si el slug es premier, esconder”

Eso rompe mantenibilidad y genera inconsistencias.

\---

\#\# 9\. Modelo de datos sugerido

\#\# 9.1 Tabla/configuración de competiciones

\`\`\`ts  
CompetitionConfig {  
 id: string  
 slug: string  
 display\_name: string  
 enabled: boolean  
 provider\_name?: string  
 provider\_competition\_id?: string  
 content\_mapping\_key?: string  
 sort\_order?: number  
 updated\_at: datetime  
 updated\_by?: string  
}

## **9.2 Tabla/configuración de features globales**

PortalFeatureConfig {  
 tv\_enabled: boolean  
 predictions\_enabled: boolean  
 updated\_at: datetime  
 updated\_by?: string  
}

## **9.3 Alternativa**

También puede existir una tabla genérica de feature flags, por ejemplo:

FeatureFlag {  
 key: string  
 enabled: boolean  
 scope: 'global' | 'competition'  
 scope\_id?: string  
 updated\_at: datetime  
 updated\_by?: string  
}

Pero para este MVP no es obligatorio si complica de más.

---

## **10\. Reglas backend obligatorias**

## **RB-01 — Los jobs deben arrancar desde competiciones habilitadas**

Todo job que hoy recorra el catálogo de competiciones debe hacerlo sobre `enabled = true`.

## **RB-02 — No se debe consultar proveedor externo para competiciones deshabilitadas**

El filtro debe aplicarse **antes** de la llamada externa, no después.

Filtrar después de recibir la respuesta ya es consumir crédito. Eso no sirve.

## **RB-03 — Noticias y videos deben mapearse por competición formal**

Los módulos de contenido no deben depender solo de texto visible.

Debe existir una forma formal de relación entre contenido y competición:

* `competition_id`

* `competition_slug`

* `content_mapping_key`

* o equivalente

## **RB-04 — Endpoints públicos deben validar habilitación**

Cualquier endpoint tipo:

* `/competitions`

* `/matches`

* `/standings`

* `/news`

* `/videos`

* `/predictions`  
   debe validar que la competición objetivo esté habilitada antes de responder.

## **RB-05 — Cache coherente**

Si existen caches por competición o por feature:

* deben invalidarse,

* o no reutilizarse si la competición/feature quedó deshabilitada.

No puede ocurrir que algo quede oculto en una parte pero aparezca por cache en otra.

---

## **11\. Reglas frontend obligatorias**

## **RFNT-01 — Menú principal condicionado por feature flags**

El render del menú principal debe depender de configuración efectiva y no de una lista fija.

## **RFNT-02 — Selector de competiciones condicionado por catálogo habilitado**

El selector de ligas/torneos debe poblarse solo desde competiciones habilitadas.

## **RFNT-03 — Vistas vacías controladas**

Si una competición se deshabilita y el usuario quedó posicionado en ella:

* no debe romper la pantalla,

* debe redirigirse o resolverse con un estado vacío controlado.

## **RFNT-04 — No hacer fetch inútil**

El frontend no debe disparar requests de módulos deshabilitados:

* si TV está off, no se monta ni carga,

* si Pronósticos está off, no se monta ni carga.

---

## **12\. Casos de uso**

## **CU-01 — Habilitar solo algunas competiciones**

**Dado** que el admin habilita:

* Fútbol Uruguayo

* La Liga

* Copa Libertadores

**Y deshabilita**:

* Premier League

* Bundesliga

**Entonces** en el portal:

* solo deben verse las tres habilitadas,

* Premier y Bundesliga no deben aparecer en selector ni navegación,

* no deben ejecutarse syncs ni fetches para Premier/Bundesliga,

* no deben cargarse noticias/videos de esas dos.

## **CU-02 — Ocultar TV del menú**

**Dado** que `tv_enabled = false`

**Entonces**:

* la opción TV no debe renderizarse en menú,

* sus rutas no deben quedar operativas al usuario,

* no deben ejecutarse cargas relacionadas con TV desde frontend.

## **CU-03 — Ocultar Pronósticos del menú**

**Dado** que `predictions_enabled = false`

**Entonces**:

* la opción Pronósticos no debe renderizarse en menú,

* sus pantallas no deben ser accesibles al usuario final,

* no deben correr cálculos ni cargas innecesarias para ese módulo desde el portal.

## **CU-04 — Deshabilitación posterior de una competición ya visible**

**Dado** que Bundesliga estaba habilitada y luego se deshabilita

**Entonces**:

* desaparece del selector,

* deja de aceptar acceso directo,

* deja de consumir APIs externas,

* su histórico puede seguir guardado internamente, sin exposición pública.

---

## **13\. Criterios de aceptación**

## **CA-01**

Existe una pantalla de back office donde un administrador puede ver y modificar el estado habilitada/deshabilitada de cada competición.

## **CA-02**

Existe una configuración de menú donde un administrador puede habilitar/deshabilitar TV y Pronósticos.

## **CA-03**

Tras deshabilitar una competición, esta deja de aparecer en el frontend sin necesidad de deploy.

## **CA-04**

Tras deshabilitar una competición, no se realizan nuevas llamadas a proveedores externos para esa competición.

## **CA-05**

Tras deshabilitar una competición, tampoco se consultan noticias ni videos vinculados a esa competición.

## **CA-06**

Los endpoints públicos rechazan o no exponen información de competiciones deshabilitadas.

## **CA-07**

Tras deshabilitar TV o Pronósticos, esos ítems desaparecen del menú y sus rutas dejan de ser usables para usuario final.

## **CA-08**

Los cambios quedan persistidos y auditados.

## **CA-09**

No se pierden datos históricos por el simple hecho de deshabilitar una competición.

## **CA-10**

La configuración aplicada en frontend y backend proviene de una única fuente de verdad.

---

## **14\. Casos borde**

## **CB-01 — Todas las competiciones deshabilitadas**

El sistema debe soportarlo sin romper UI.

Resultado esperado:

* selector vacío o mensaje controlado,

* portal estable.

## **CB-02 — TV y Pronósticos ambos deshabilitados**

El menú debe seguir funcionando sin dejar huecos rotos ni rutas colgando.

## **CB-03 — Competición deshabilitada con datos cacheados**

La cache no debe seguir exponiendo información pública de esa competición.

## **CB-04 — Competición con contenido asociado ambiguo**

Si noticias/videos no pueden asociarse de forma confiable a una competición, el sistema debe priorizar no consumir ni mostrar antes que mezclar contenido erróneo.

---

## **15\. No alcance / fuera de scope**

Este feature no incluye, salvo decisión posterior:

* borrado físico de datos históricos,

* parametrización granular por temporada,

* permisos complejos por rol más allá de admin básico,

* scheduler avanzado por ventana horaria,

* pricing/cupos por proveedor,

* un CMS completo de contenidos.

---

## **16\. Recomendación técnica clave**

La implementación correcta no es “un toggle en la UI”.

La implementación correcta es:

1. **catálogo persistido de competiciones**,

2. **feature flags persistidos**,

3. **gate central de elegibilidad**,

4. **backend filtrando antes de consumir APIs**,

5. **frontend renderizando solo desde configuración efectiva**.

Si no se hace así, vas a tener una ilusión de control en la interfaz, pero el sistema va a seguir gastando créditos por debajo.

---

## **17\. Resultado esperado del MVP**

Al finalizar este feature, el administrador debe poder controlar desde un back office simple:

* qué competiciones están operativas en el portal,

* si TV aparece o no,

* si Pronósticos aparece o no,

y el sistema debe garantizar que lo deshabilitado:

* no se ve,

* no se usa,

* no consume.

