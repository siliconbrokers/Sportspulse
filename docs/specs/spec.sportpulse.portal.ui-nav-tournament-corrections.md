---
artifact_id: SPEC-SPORTPULSE-PORTAL-UI-NAV-TOURNAMENT-CORRECTIONS
title: "UI Nav and Tournament Corrections Technical Spec"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: portal
slug: ui-nav-tournament-corrections
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/specs/spec.sportpulse.portal.ui-nav-tournament-corrections.md
---
\# TECH SPEC — Correcciones de UI, navegación y estructura de torneos

\#\# 1\. Propósito

Implementar un conjunto de correcciones en front-end y lógica de resolución de vistas para asegurar:

\- legibilidad correcta en desktop,  
\- eliminación de redundancias visuales,  
\- navegación consistente desde listados hacia detalle de partido,  
\- representación completa de estructuras de torneo,  
\- integridad del fixture en torneos con grupos.

Este documento debe ser tratado como spec implementable, no como lista informal de mejoras.

\---

\#\# 2\. Alcance técnico

\#\#\# Incluye  
\- componentes de Home relacionados con tarjetas de partidos del día,  
\- componentes de detalle de partido,  
\- componentes de Pronósticos,  
\- componentes de Tabla,  
\- componentes de Partidos,  
\- lógica de routing o navegación al detalle,  
\- lógica de resolución de partido seleccionado,  
\- lógica de filtrado por fase / grupo,  
\- lógica de composición estructural de torneos,  
\- validaciones de integridad del fixture en fase de grupos.

\#\#\# No incluye  
\- rediseño completo del sistema visual,  
\- cambios en el modelo predictivo,  
\- cambios de negocio en scoring o probabilidad,  
\- cambios de proveedor de datos,  
\- cambios de copy fuera de lo explicitado en este spec.

\---

\#\# 3\. Objetivos de implementación

1\. Evitar truncamiento innecesario de nombres de equipos en desktop.  
2\. Eliminar duplicación de labels ya visibles en cabecera.  
3\. Hacer que cada navegación a detalle abra el partido exacto clickeado.  
4\. Evitar detalles vacíos cuando existe data mínima suficiente.  
5\. Restaurar vistas estructurales de torneos previamente soportadas.  
6\. Completar la navegación de Mundial 2026 en Pronósticos.  
7\. Garantizar que cada grupo muestre todos sus cruces esperados en Partidos.

\---

\#\# 4\. Invariantes obligatorios

Las siguientes reglas son invariantes del sistema y no deben romperse durante la implementación.

\#\#\# 4.1. Identidad del partido  
Toda navegación a detalle debe estar anclada a una identidad única de partido.

\*\*Prohibido\*\* resolver detalle por:  
\- nombre de equipo,  
\- próximo partido del equipo,  
\- partido más reciente del equipo,  
\- primer match compatible encontrado.

\#\#\# 4.2. Render mínimo válido del detalle  
Si existe data mínima del partido, el detalle nunca debe quedar vacío.

Un detalle mínimo válido debe poder renderizar al menos:  
\- equipo local,  
\- equipo visitante,  
\- escudos si existen,  
\- score si existe,  
\- estado del partido.

\#\#\# 4.3. Coherencia entre listado y detalle  
Una tarjeta de listado no puede abrir un detalle de otra entidad distinta.

\#\#\# 4.4. Coherencia estructural de torneo  
Si un torneo soporta:  
\- fase previa,  
\- grupos,  
\- eliminatorias,

la UI debe poder representar esas capas cuando existan en la estructura de datos.

\#\#\# 4.5. Integridad de grupos  
Si un grupo tiene 4 equipos, el fixture esperado es de 6 partidos.    
No se acepta render parcial como si fuera correcto.

\---

\#\# 5\. Suposiciones técnicas explícitas

Estas son suposiciones aceptables para implementar. Si alguna no se cumple, el agente debe adaptar sin romper el comportamiento requerido.

1\. Existe una entidad \`match\` o equivalente.  
2\. Puede existir un \`matchId\` nativo o una combinación de campos suficiente para construir identidad estable.  
3\. El sistema ya distingue contextos como:  
   \- Home,  
   \- Partidos,  
   \- Tabla,  
   \- Pronósticos,  
   \- Detalle de partido.  
4\. El sistema ya soporta al menos parcialmente:  
   \- torneos con grupos,  
   \- torneos con eliminatorias,  
   \- Copa Libertadores,  
   \- Mundial 2026\.  
5\. La desaparición de vistas previamente funcionales debe tratarse como regresión.

\---

\#\# 6\. Reglas de implementación por área

\---

\#\# 6.1. Home — tarjetas de “Partidos de hoy”

\#\#\# Problema  
Los nombres largos de equipos se truncán en desktop por restricción artificial de ancho.

\#\#\# Requisito funcional  
En desktop, la tarjeta debe usar mejor el ancho disponible para mostrar nombres completos.

\#\#\# Reglas técnicas  
\- Revisar restricciones de \`width\`, \`max-width\`, \`flex-basis\`, \`grid-template-columns\`, \`overflow\`, \`text-overflow\`, \`white-space\`.  
\- Priorizar layout adaptable antes que truncamiento.  
\- No resolver el problema agregando saltos de línea innecesarios si hay ancho horizontal suficiente.  
\- Mantener consistencia con el resto de tarjetas de Home.

\#\#\# Resultado esperado  
En desktop, nombres largos deben verse completos salvo límite real de viewport.

\#\#\# Aceptación  
\- Nombres como “Club Independiente Medellín” y “Juventud de las Piedras” no deben cortarse arbitrariamente.  
\- La tarjeta no debe desalinear la grilla general.

\---

\#\# 6.2. Detalle de partido — cabecera

\#\#\# Problema  
Los nombres de equipos debajo del escudo también se truncán en desktop.

\#\#\# Requisito funcional  
Ambos nombres deben mostrarse completos en desktop.

\#\#\# Reglas técnicas  
\- Ajustar contenedores de nombre y layout de cabecera.  
\- No degradar mobile.  
\- No reducir escudos ni jerarquía visual solo para esconder el problema.

\#\#\# Aceptación  
\- Ambos nombres se leen completos en desktop.  
\- La cabecera mantiene equilibrio visual.

\---

\#\# 6.3. Detalle de partido — bloque de forma reciente

\#\#\# Problema A  
Se repite el nombre del equipo arriba del bloque de forma, aunque ya está visible en cabecera.

\#\#\# Requisito  
Eliminar ese nombre.

\#\#\# Problema B  
Cada caja de forma necesita contexto del rival sin meter texto redundante.

\#\#\# Requisito  
Mostrar arriba de cada caja el \*\*escudo del rival correspondiente\*\*, sin texto.

\#\#\# Reglas técnicas  
\- Cada item de forma debe resolverse contra un rival específico.  
\- El bloque debe renderizar:  
  \- escudo del rival,  
  \- resultado abreviado (\`G\`, \`E\`, \`P\` o equivalente).  
\- Si no hay escudo, usar fallback visual neutro y consistente.  
\- No renderizar nombre textual del rival en esa caja.

\#\#\# Aceptación  
\- No aparece encabezado redundante del equipo.  
\- Cada caja de forma muestra el escudo del rival correcto.  
\- La secuencia sigue siendo legible en ambos lados del detalle.

\---

\#\# 6.4. Detalle de partido — bloque de pronóstico

\#\#\# Problema  
Debajo de los porcentajes se muestran nombres de equipos redundantes.

\#\#\# Requisito  
Eliminar esos labels.

\#\#\# Reglas técnicas  
\- Mantener semántica visual:  
  \- izquierda \= equipo 1,  
  \- centro \= empate,  
  \- derecha \= equipo 2\.  
\- No agregar reemplazos innecesarios de texto.  
\- No romper alineación ni comprensión del componente.

\#\#\# Aceptación  
\- No se muestran nombres debajo de porcentajes.  
\- El componente sigue siendo claro.

\---

\#\# 6.5. Pronósticos — apertura de detalle desde tarjeta

\#\#\# Problema A  
Algunas tarjetas abren detalle vacío o semivacío.

\#\#\# Problema B  
Algunas tarjetas abren el detalle de otro partido, típicamente un próximo partido del mismo equipo.

\#\#\# Requisito funcional  
Toda tarjeta de Pronósticos debe abrir el detalle del partido exacto clickeado.

\#\#\# Reglas técnicas  
\- Usar \`matchId\` estable si existe.  
\- Si no existe, construir clave compuesta robusta, por ejemplo:  
  \- tournamentId / slug,  
  \- stage / phase,  
  \- round,  
  \- kickoffAt,  
  \- homeTeamId / name-normalized,  
  \- awayTeamId / name-normalized.  
\- La clave compuesta debe ser estable y suficientemente discriminante.  
\- No usar como fallback principal búsquedas por equipo.

\#\#\# Fallback permitido  
Si el match existe pero el dataset enriquecido no está completo:  
\- renderizar detalle mínimo válido,  
\- ocultar bloques que no tengan información suficiente,  
\- jamás sustituir por otro partido.

\#\#\# Casos a cubrir  
\- partidos finalizados,  
\- partidos con penales,  
\- partidos históricos de fase previa,  
\- partidos con data mínima,  
\- partidos con data completa.

\#\#\# Aceptación  
\- Desde Pronósticos, el detalle siempre corresponde al partido clickeado.  
\- No se abre el próximo partido del equipo salvo que ese sea el partido elegido.  
\- Si faltan datos secundarios, igual hay una ficha mínima coherente.

\---

\#\# 6.6. Tabla — restauración de Fase Previa

\#\#\# Problema  
En torneos como Copa Libertadores desapareció la vista de Fase Previa, aunque antes estaba disponible.

\#\#\# Requisito funcional  
Restaurar render de Fase Previa en Tabla cuando el torneo tenga esa estructura.

\#\#\# Reglas técnicas  
\- Revisar condiciones de render de secciones de Tabla.  
\- Revisar mapping de estructura del torneo.  
\- Revisar lógica de tabs/subsecciones si Grupos o Eliminatorias están desplazando Fase Previa.  
\- No hardcodear una solución solo para un torneo si el sistema ya maneja fases genéricas.

\#\#\# Comportamiento esperado  
Para torneos aplicables, Tabla debe contemplar:  
1\. Fase Previa  
2\. Grupos  
3\. Eliminatorias

\#\#\# Aceptación  
\- En Copa Libertadores vuelve a aparecer Fase Previa.  
\- La progresión entre Fase Previa 1, 2 y 3 es visible y entendible.

\---

\#\# 6.7. Pronósticos — Mundial 2026: filtro principal de Grupos

\#\#\# Problema  
Pronósticos del Mundial 2026 muestra knockout, pero no expone Grupos como fase navegable principal.

\#\#\# Requisito funcional  
Agregar \`Grupos\` como filtro principal de fase.

\#\#\# Reglas técnicas  
\- Debe convivir con:  
  \- Ronda de 32  
  \- Ronda de 16  
  \- Cuartos  
  \- Semifinales  
  \- Tercer puesto  
  \- Final  
\- Puede quedar seleccionado por defecto al entrar.  
\- Debe habilitar segunda capa de filtros por grupo cuando esté activo.

\#\#\# Segunda capa requerida  
\- Todos  
\- Grupo A  
\- Grupo B  
\- ...  
\- Grupo L

\#\#\# Reglas de comportamiento  
\- Los filtros de grupo solo aparecen cuando la fase activa es \`Grupos\`.  
\- No mostrar esos filtros en fases knockout.  
\- El filtrado debe depender de asociación estructural del partido a un grupo, no de parsing textual débil.

\#\#\# Aceptación  
\- Existe el filtro principal \`Grupos\`.  
\- Al activarlo aparecen filtros de grupo A-L más \`Todos\`.  
\- Seleccionar un grupo muestra solo sus partidos.

\---

\#\# 6.8. Partidos — Mundial 2026: integridad del fixture por grupo

\#\#\# Problema  
Algunos grupos muestran los 6 partidos esperados y otros solo 3, quedando incompletos.

\#\#\# Requisito funcional  
Cada grupo debe mostrar su fixture completo.

\#\#\# Regla estructural  
Para grupos de 4 equipos:  
\- cantidad esperada de partidos \= 6\.

\#\#\# Reglas técnicas  
\- Validar composición real de cada grupo.  
\- Derivar cantidad esperada de cruces a partir de combinatoria de participantes.  
\- Detectar faltantes.  
\- Detectar duplicados.  
\- Detectar asignaciones incorrectas de partidos a grupo.  
\- No maquillar la UI con relleno falso.

\#\#\# Validaciones mínimas por grupo  
\- \`teamCount\`  
\- \`expectedMatchCount\`  
\- \`actualMatchCount\`  
\- \`missingMatches\`  
\- \`duplicateMatches\`  
\- \`cross-group contamination\`

\#\#\# Aceptación  
\- Todos los grupos equivalentes muestran la cantidad esperada de partidos.  
\- No hay duplicados usados para “completar”.  
\- No hay partidos asignados al grupo incorrecto.

\---

\#\# 7\. Modelo de resolución de identidad de partido

Si el sistema no tiene un ID único confiable y homogéneo para todos los contextos, implementar una estrategia de identidad compuesta.

\#\# 7.1. Prioridad de resolución  
1\. \`matchId\` nativo del proveedor o del dominio local.  
2\. \`externalMatchId\` normalizado si existe.  
3\. Clave compuesta estable.

\#\# 7.2. Clave compuesta sugerida  
La clave compuesta puede incluir:  
\- \`tournament\`  
\- \`stage\`  
\- \`round\`  
\- \`group\`  
\- \`kickoffAt\`  
\- \`homeTeam\`  
\- \`awayTeam\`

\#\# 7.3. Restricciones  
\- Evitar campos demasiado volátiles.  
\- Evitar resolución solo por nombre de equipo.  
\- Evitar resolución solo por fecha.  
\- Evitar resolución solo por score.

\---

\#\# 8\. Contratos de fallback

\#\#\# 8.1. Detalle de partido  
Si faltan datos:  
\- renderizar lo mínimo disponible,  
\- ocultar widgets secundarios,  
\- no dejar layout roto,  
\- no inventar otro partido.

\#\#\# 8.2. Escudos de rivales en forma reciente  
Si falta el escudo:  
\- mostrar placeholder neutro,  
\- no romper alineación,  
\- no reemplazar por texto largo.

\#\#\# 8.3. Estructuras de torneo  
Si una fase existe en datos del torneo, debe ser visible.  
Si no existe, no debe renderizarse una sección vacía.

\---

\#\# 9\. No objetivos

Esto no debe terminar derivando en:  
\- refactor visual total,  
\- rediseño de sistema de tabs global,  
\- reescritura completa del dominio de torneos,  
\- inventar data faltante no respaldada,  
\- hardcodes específicos como solución principal.

\---

\#\# 10\. Plan de implementación sugerido

\#\#\# Fase 1 — Correcciones locales de UI  
\- Home: ancho de tarjetas  
\- Detalle: cabecera  
\- Detalle: forma reciente  
\- Detalle: pronóstico

\#\#\# Fase 2 — Corrección de navegación al detalle  
\- revisar origen de evento click  
\- revisar payload de navegación  
\- revisar resolución del match en el detalle  
\- introducir identidad estable de partido  
\- introducir fallback mínimo válido

\#\#\# Fase 3 — Estructura de torneo  
\- restaurar Fase Previa en Tabla  
\- agregar Grupos en Pronósticos Mundial 2026  
\- agregar segunda capa de filtros por grupo

\#\#\# Fase 4 — Integridad del fixture  
\- validar cantidad esperada de partidos por grupo  
\- detectar faltantes  
\- corregir construcción o consumo del dataset de grupos

\---

\#\# 11\. Checklist de validación manual

\#\#\# Home  
\- \[ \] En desktop, nombres largos en “Partidos de hoy” se leen completos.  
\- \[ \] La grilla no queda rota.

\#\#\# Detalle  
\- \[ \] Nombres de equipos en cabecera se leen completos en desktop.  
\- \[ \] No aparece nombre redundante sobre la forma reciente.  
\- \[ \] Cada caja de forma muestra escudo del rival correcto.  
\- \[ \] No aparece nombre redundante bajo porcentajes del pronóstico.

\#\#\# Pronósticos  
\- \[ \] Toda tarjeta abre el detalle del partido correcto.  
\- \[ \] No hay casos en que se abra el próximo partido del equipo.  
\- \[ \] Si faltan datos secundarios, el detalle sigue siendo usable.  
\- \[ \] El bug queda corregido en múltiples fases, no solo un caso puntual.

\#\#\# Tabla  
\- \[ \] Copa Libertadores vuelve a mostrar Fase Previa.  
\- \[ \] La progresión entre Fase Previa 1, 2 y 3 es visible.

\#\#\# Mundial 2026 — Pronósticos  
\- \[ \] Existe filtro principal \`Grupos\`.  
\- \[ \] Al activarlo aparecen filtros \`Todos\`, \`Grupo A\` ... \`Grupo L\`.  
\- \[ \] Cada grupo filtra correctamente sus partidos.

\#\#\# Mundial 2026 — Partidos  
\- \[ \] Cada grupo muestra todos sus cruces esperados.  
\- \[ \] No hay grupos equivalentes con cantidades arbitrarias distintas.  
\- \[ \] No hay duplicados ni contaminación entre grupos.

\---

\#\# 12\. Criterios de aceptación global

La implementación queda aceptada solo si:

1\. Los problemas visuales de truncamiento en desktop desaparecen sin romper layout.  
2\. Se eliminan las redundancias visuales definidas en detalle de partido.  
3\. La navegación desde Pronósticos al detalle queda anclada al partido exacto.  
4\. No existen detalles vacíos cuando había data suficiente para render mínimo.  
5\. La Fase Previa vuelve a ser visible en Tabla cuando corresponde.  
6\. Pronósticos del Mundial 2026 incorpora Grupos como fase navegable principal.  
7\. El filtrado por grupo en Pronósticos funciona de forma consistente.  
8\. La sección Partidos del Mundial muestra fixtures completos por grupo.  
9\. No se resuelve nada con hardcodes frágiles ni fallbacks engañosos.  
10\. Mobile y responsive general no quedan degradados.

\---

\#\# 13\. Riesgos de implementación a evitar

\- corregir solo ejemplos puntuales en vez de corregir la lógica,  
\- resolver detalle por heurística débil basada en equipo,  
\- mostrar otro partido “parecido” para evitar vista vacía,  
\- reintroducir Fase Previa mediante hardcode exclusivo,  
\- agregar filtros de grupo sin soporte real de asociación de datos,  
\- completar grupos con duplicados,  
\- arreglar visualmente mientras los datos siguen mal.

\---

\#\# 14\. Entregables esperados del agente

El agente debe entregar:

1\. implementación de los cambios,  
2\. resumen técnico de qué se tocó,  
3\. explicación de cómo se resuelve la identidad única de partido,  
4\. listado de componentes / archivos afectados,  
5\. validación manual realizada contra los criterios de aceptación,  
6\. nota explícita de cualquier limitación real de datos si existiera.  
