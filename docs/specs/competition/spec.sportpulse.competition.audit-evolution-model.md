---
artifact_id: SPEC-SPORTPULSE-COMPETITION-AUDIT-EVOLUTION-MODEL
title: "Auditoría y Evolución del Modelo de Competiciones"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: competition
slug: audit-evolution-model
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/specs/spec.sportpulse.competition.audit-evolution-model.md
---
\# Spec 1 — Auditoría y evolución del modelo de competiciones  
\#\# Proyecto: Portal de resultados  
\#\# Estado: Cerrado para pasar a Documento 2  
\#\# Propósito  
Definir el alcance, las decisiones rectoras y la hoja de ruta de evolución del modelo de competiciones del portal, sin sobrediseño y sin mezclar dominio con UI.

\---

\# 1\. Rol de este documento

Este documento es el \*\*marco rector\*\* de la línea de trabajo.

Define:

\- qué problema se resuelve,  
\- qué formatos de torneo entran en alcance,  
\- qué queda explícitamente fuera,  
\- qué piezas del modelo son obligatorias,  
\- en qué orden deben auditarse e implementarse,  
\- y qué restricciones no se pueden violar.

Este documento \*\*no\*\* baja al detalle completo de campos, relaciones, constraints, migraciones ni mapping API→modelo interno.    
Eso le corresponde al \*\*Documento 2 — Especificación técnica de implementación\*\*.

\---

\# 2\. Relación normativa con el Documento 2

\#\# 2.1 Jerarquía documental

Este Spec 1 manda sobre:

\- alcance,  
\- prioridades,  
\- decisiones de diseño,  
\- no objetivos,  
\- y límites de complejidad.

El Documento 2 manda sobre:

\- entidades concretas,  
\- campos,  
\- nullables,  
\- constraints,  
\- mapping API→modelo,  
\- migración,  
\- casos de prueba.

\#\# 2.2 Regla de conflicto

Si aparece una contradicción entre Spec 1 y Documento 2:

\- \*\*Spec 1 prevalece\*\* en alcance y decisiones arquitectónicas.  
\- Documento 2 debe corregirse para alinearse con Spec 1\.

\#\# 2.3 Dependencia obligatoria

El Documento 2 debe declarar explícitamente que:  
\- implementa este Spec 1,  
\- no redefine el alcance,  
\- y no puede introducir complejidad fuera de lo aprobado aquí.

\---

\# 3\. Problema que se resuelve

El portal actual soporta correctamente un modelo orientado a ligas o campeonatos tipo tabla, pero no está preparado de forma suficiente para representar torneos internacionales modernos con:

\- fases,  
\- grupos,  
\- cruces eliminatorios,  
\- placeholders,  
\- mejores terceros,  
\- o league phase sin grupos.

La meta no es construir un motor universal del fútbol mundial.    
La meta es evolucionar el modelo para que el portal pueda \*\*ingerir, normalizar, persistir y mostrar\*\* correctamente ciertos formatos de torneo alimentados por APIs externas.

\---

\# 4\. Qué estamos construyendo

Estamos construyendo un sistema que:

\- consume datos de APIs externas,  
\- los normaliza a un modelo interno consistente,  
\- los persiste,  
\- y los presenta en el portal.

Esto incluye:

\- competición / edición,  
\- participantes,  
\- fases,  
\- grupos,  
\- standings,  
\- partidos,  
\- cruces,  
\- placeholders.

No incluye, en esta fase:

\- cálculo global entre torneos,  
\- clasificación automática desde eliminatorias continentales al Mundial,  
\- repechajes intercontinentales derivados automáticamente,  
\- motor universal de sorteo,  
\- lógica completa de seeds y plazas globales.

Si la API ya trae los datos resueltos, el sistema los refleja.    
Si la API no los trae, el sistema solo deriva lo mínimo \*\*dentro de la misma competición\*\* y solo cuando esté explícitamente aprobado en este spec.

\---

\# 5\. Familias de formato que entran en alcance

El modelo debe soportar inicialmente estas cuatro familias.

\#\# 5.1 \`LEAGUE\_TABLE\`

Caso objetivo principal:

\- Eliminatorias CONMEBOL

Las eliminatorias CONMEBOL al Mundial 2026 se juegan como una tabla única de diez selecciones en formato de liga. :contentReference\[oaicite:0\]{index=0}

\#\#\# Características  
\- una sola fase,  
\- una sola tabla,  
\- sin grupos,  
\- sin knockout.

\---

\#\# 5.2 \`GROUP\_STAGE\_PLUS\_KNOCKOUT\`

Caso objetivo principal:

\- Copa Libertadores

Para esta fase del proyecto, \*\*Libertadores se considera soportada desde fase de grupos en adelante\*\*.

\#\#\# Alcance adoptado para Libertadores  
Incluye:  
\- fase de grupos,  
\- clasificación a llaves,  
\- fases eliminatorias,  
\- final.

No obliga, en esta etapa, a soportar completamente:  
\- fases preliminares,  
\- rutas complejas previas a grupos,  
\- mecanismos detallados de acceso previos a la fase principal.

\---

\#\# 5.3 \`GROUP\_STAGE\_PLUS\_KNOCKOUT\_WITH\_BEST\_THIRDS\`

Casos objetivo:

\- FIFA World Cup 2026  
\- AFCON

El Mundial 2026 usa 48 selecciones, 12 grupos de 4 y clasifica a la fase eliminatoria a los 2 primeros de cada grupo más los 8 mejores terceros. :contentReference\[oaicite:1\]{index=1}

AFCON 2025/26 usa 24 selecciones, 6 grupos de 4 y clasifica a la fase eliminatoria a los 2 primeros de cada grupo más los 4 mejores terceros. :contentReference\[oaicite:2\]{index=2}

\#\#\# Regla cerrada  
AFCON pertenece \*\*solo\*\* a esta familia.    
No debe quedar modelada como \`GROUP\_STAGE\_PLUS\_KNOCKOUT\` simple.

\---

\#\# 5.4 \`LEAGUE\_PHASE\_PLUS\_KNOCKOUT\`

Caso objetivo:

\- UEFA Champions League actual

La Champions actual usa una league phase de 36 equipos, donde cada club juega 8 partidos, seguida de knockout phase play-offs y round of 16 en adelante. No es una liga clásica todos contra todos. :contentReference\[oaicite:3\]{index=3}

\#\#\# Regla cerrada  
Champions no puede resolverse modelándola como:  
\- grupos,  
\- ni como tabla única round-robin completa.

\---

\# 6\. Regla principal de diseño

No diseñar por nombre de torneo.

No hacer lógica del tipo:  
\- \`if tournament \== world\_cup\`  
\- \`if tournament \== libertadores\`  
\- \`if tournament \== champions\`

La lógica debe basarse en:  
\- \*\*familias de formato\*\*,  
\- \*\*componentes mínimos del dominio\*\*,  
\- y \*\*capacidad de la API de alimentar esos componentes\*\*.

\---

\# 7\. Estado actual del sistema: hipótesis de auditoría

\#\# 7.1 Naturaleza de esta sección

Todo lo que sigue en esta sección es una \*\*hipótesis de auditoría\*\*, no un hecho del código.

Claude debe verificarlo contra el sistema real antes de proponer o implementar cambios.

\#\# 7.2 Hipótesis razonables

Se asume que hoy el portal ya soporta:

\- competición / edición básica,  
\- participantes / equipos,  
\- partidos / fixtures,  
\- estados de partido,  
\- standings de tipo liga,  
\- vista tipo campeonato / tabla.

\#\# 7.3 Carencias probables

Se asume que hoy el portal todavía no soporta bien:

\- \`Stage\`,  
\- \`Group\`,  
\- \`Tie\`,  
\- \`TieSlot\`,  
\- placeholders,  
\- ranking de mejores terceros,  
\- league phase sin grupos,  
\- bracket visual estructurado.

\#\# 7.4 Regla obligatoria

Claude no debe construir sobre estas hipótesis como si fueran hechos.    
Debe validarlas primero.

\---

\# 8\. Separación obligatoria entre dominio y presentación

Ésta es una regla cerrada.

\#\# 8.1 Dominio / persistencia

Pertenecen al dominio:

\- \`CompetitionEdition\`  
\- \`Participant\`  
\- \`Stage\`  
\- \`Group\`  
\- \`StandingTable\`  
\- \`StandingRow\`  
\- \`Match\`  
\- \`Tie\`  
\- \`TieSlot\`

\#\# 8.2 Presentación / UI

Pertenecen a UI/presentación:

\- vista de grupos,  
\- vista de standings,  
\- vista de bracket,  
\- orden visual de los cruces,  
\- badges visuales,  
\- labels decorativos de placeholders.

\#\# 8.3 Regla de implementación

Claude debe resolver primero el dominio.    
Después puede resolver visualización.    
No debe tapar agujeros del dominio con hacks de UI.

\---

\# 9\. Componentes mínimos obligatorios del modelo objetivo

\#\# 9.1 Componentes base esperables o ya existentes

\- \`CompetitionEdition\`  
\- \`Participant\`  
\- \`Match\`  
\- \`StandingTable\`  
\- \`StandingRow\`

\#\# 9.2 Componentes nuevos obligatorios

\- \`Stage\`  
\- \`Group\`  
\- \`Tie\`  
\- \`TieSlot\`

\#\# 9.3 Componentes especiales, pero sin sobrediseño inicial

\- capacidad de ranking de mejores terceros,  
\- capacidad de league phase sin grupos.

\---

\# 10\. Modelo funcional mínimo objetivo

\#\# 10.1 \`CompetitionEdition\`  
Representa una edición concreta de una competición.

Debe permitir:  
\- nombre de edición,  
\- temporada,  
\- estado,  
\- formato asociado.

\#\# 10.2 \`Stage\`  
Representa una fase del torneo.

Ejemplos:  
\- league stage,  
\- group stage,  
\- round of 32,  
\- round of 16,  
\- quarter-finals,  
\- semi-finals,  
\- final.

Campos mínimos esperados en Documento 2:  
\- identificador,  
\- vínculo con edición,  
\- nombre,  
\- orden,  
\- tipo de fase,  
\- bandera de standings,  
\- bandera de bracket.

\#\# 10.3 \`Group\`  
Representa un grupo dentro de una fase.

Ejemplos:  
\- Group A,  
\- Group B.

\#\# 10.4 \`StandingTable\`  
Representa una tabla asociada a:  
\- una fase de tabla única,  
\- o a un grupo.

\#\# 10.5 \`Match\`  
Representa un partido concreto.

Debe poder asociarse opcionalmente a:  
\- fase,  
\- grupo,  
\- cruce.

\#\# 10.6 \`Tie\`  
Representa un cruce eliminatorio.

Ejemplos:  
\- Round of 32 Match 1,  
\- Quarter-final 2,  
\- Semi-final 1\.

\#\# 10.7 \`TieSlot\`  
Representa un slot de un cruce.

Debe soportar:  
\- participante ya confirmado,  
\- placeholder textual,  
\- slot aún no resuelto.

\---

\# 11\. Decisión cerrada sobre placeholders

\#\# 11.1 Decisión adoptada

En esta fase, los placeholders se resuelven dentro de \`TieSlot\`, no como entidad independiente.

\#\# 11.2 Regla

\`TieSlot\` debe permitir, como mínimo:  
\- \`participantId\` nullable,  
\- \`placeholderText\` nullable.

\#\# 11.3 Lo que NO entra ahora

No se aprueba en esta fase:  
\- una entidad independiente de placeholder,  
\- una jerarquía de placeholder participant,  
\- modelado profundo de winners/losers intertorneos.

\---

\# 12\. Decisión cerrada sobre mejores terceros

\#\# 12.1 Problema

Mundial 2026 y AFCON exigen ranking cruzado de terceros. :contentReference\[oaicite:4\]{index=4}

\#\# 12.2 Decisión adoptada

En esta fase, el ranking de mejores terceros se debe resolver \*\*como proyección derivada\*\* a partir de standings ya existentes dentro de la misma competición.

\#\# 12.3 Regla

No se aprueba todavía persistir una entidad nueva para ranking cruzado, salvo que la auditoría del código demuestre que una proyección derivada no alcanza.

\---

\# 13\. Decisión cerrada sobre Champions

\#\# 13.1 Aclaración obligatoria

Champions no puede modelarse como:  
\- grupos clásicos,  
\- ni como tabla única de round-robin completo.

\#\# 13.2 Pregunta de auditoría obligatoria

Claude debe responder:

\> ¿La lógica actual de standings y fixtures soporta una tabla única sin grupos y sin round-robin completo?

Si la respuesta es no, entonces el modelo actual no soporta Champions todavía.

\---

\# 14\. Decisión cerrada sobre Libertadores

\#\# 14.1 Alcance adoptado

Para esta fase, Libertadores se soporta \*\*desde fase de grupos en adelante\*\*.

\#\# 14.2 No objetivo específico para Libertadores

No se exige ahora modelar completamente:  
\- fases preliminares,  
\- accesos complejos previos a grupos,  
\- seeds o sorteos detallados anteriores a la fase principal.

\---

\# 15\. Matriz de compatibilidad inicial  
\#\# Herramienta de auditoría, no verdad cerrada

\#\#\# Leyenda  
\- \`✅\` soportado  
\- \`🟡\` soportado con ajuste razonable  
\- \`❌\` no soportado / agujero real  
\- \`N/A\` no aplica

| Capacidad / pieza | Eliminatorias CONMEBOL | Mundial 2026 | Libertadores | Champions actual | Diagnóstico inicial |  
|---|---:|---:|---:|---:|---|  
| Competición / edición | ✅ | 🟡 | 🟡 | 🟡 | Probablemente existe, pero muy ligado a “liga” |  
| Participantes / equipos | ✅ | ✅ | ✅ | ✅ | Base estable |  
| Partidos / fixtures | ✅ | ✅ | ✅ | ✅ | Existe, pero sin suficiente contexto estructural |  
| Estados de partido | ✅ | ✅ | ✅ | ✅ | Base estable |  
| Tabla única | ✅ | ❌ | ❌ | 🟡 | Sirve para CONMEBOL; para Champions solo si no asume round-robin completo |  
| Tabla por grupo | ❌ | 🟡 | 🟡 | N/A | Requiere grupos |  
| Fases / stages | 🟡 | ❌ | ❌ | ❌ | Agujero real |  
| Grupos | ❌ | ❌ | ❌ | N/A | Agujero real |  
| Knockout / llaves | ❌ | ❌ | ❌ | ❌ | Agujero real |  
| Cruce individual (\`Tie\`) | ❌ | ❌ | ❌ | ❌ | Agujero real |  
| Slots del cruce (\`TieSlot\`) | ❌ | ❌ | ❌ | ❌ | Agujero real |  
| Placeholders | ❌ | ❌ | 🟡 | 🟡 | Muy importante |  
| Ranking de mejores terceros | N/A | ❌ | N/A | N/A | Especial Mundial / AFCON |  
| League phase sin grupos | N/A | N/A | N/A | ❌ | Especial Champions |  
| Bracket visual | ❌ | ❌ | ❌ | ❌ | Agujero real |  
| Simulación interna de resultados | 🟡 | ❌ | 🟡 | 🟡 | Posible, pero no madura |  
| Reglas internas de avance dentro del torneo | N/A | ❌ | 🟡 | 🟡 | Faltan para Mundial y Champions |

\---

\# 16\. Qué debe auditar Claude en el sistema actual

Claude debe responder, con evidencia del código, estas preguntas.

\#\# 16.1 Para \`LEAGUE\_TABLE\`  
\- ¿el sistema ya soporta una tabla única?  
\- ¿el sistema ya soporta standings correctamente?  
\- ¿el sistema ya soporta partidos por fecha/jornada?  
\- ¿el sistema ya soporta estados de partido?  
\- ¿el sistema ya puede mostrar badges tipo:  
  \- clasificado,  
  \- repechaje,  
  \- eliminado,  
  si vienen de la API?

\#\# 16.2 Para grupos  
\- ¿existe una estructura clara de \`Group\`?  
\- ¿los standings pueden scopearse por grupo?  
\- ¿los partidos pueden filtrarse y persistirse por grupo?

\#\# 16.3 Para knockout  
\- ¿existe una estructura clara de \`Tie\`?  
\- ¿un partido puede pertenecer a un cruce?  
\- ¿la UI puede representar bracket o solo listas?

\#\# 16.4 Para placeholders  
\- ¿el sistema soporta slots indefinidos?  
\- ¿puede mostrar \`TBD\`, \`Winner Group A\`, \`Winner Match 5\`, etc.?  
\- ¿eso vive en dominio o solo en UI?

\#\# 16.5 Para mejores terceros  
\- ¿hoy existe forma de comparar standings entre grupos?  
\- ¿puede resolverse primero como proyección derivada?  
\- ¿haría falta persistencia explícita o no?

\#\# 16.6 Para Champions  
\- ¿la lógica de standings actual asume round-robin completo?  
\- ¿soporta tabla única sin grupos?  
\- ¿soporta calendario parcial por equipo dentro de una misma tabla?

\---

\# 17\. Fases de implementación aprobadas

\#\# Fase 1 — endurecer \`LEAGUE\_TABLE\`  
Objetivo:  
\- dejar impecable el soporte de Eliminatorias CONMEBOL.

Entregables:  
\- validación del modelo actual,  
\- corrección de inconsistencias,  
\- soporte claro a tabla única y standings.

\#\# Fase 2 — agregar \`Stage\` \+ \`Group\`  
Objetivo:  
\- habilitar grupos.

Impacta:  
\- Mundial,  
\- Libertadores,  
\- AFCON.

Entregables:  
\- persistencia de grupos,  
\- standings por grupo,  
\- fixtures por grupo.

\#\# Fase 3 — agregar \`Tie\` \+ \`TieSlot\`  
Objetivo:  
\- habilitar knockout real.

Impacta:  
\- Libertadores,  
\- Mundial,  
\- AFCON,  
\- Champions knockout.

Entregables:  
\- cruces,  
\- slots confirmados o pendientes,  
\- bracket base.

\#\# Fase 4 — agregar ranking derivado de mejores terceros  
Objetivo:  
\- habilitar formatos tipo Mundial 2026 / AFCON.

Entregables:  
\- comparación cruzada derivada,  
\- llenado de knockout según ranking.

\#\# Fase 5 — agregar \`league\_phase\`  
Objetivo:  
\- habilitar Champions actual.

Entregables:  
\- tabla única sin grupos,  
\- soporte a calendario parcial por equipo,  
\- playoff / knockout posterior.

\---

\# 18\. Prioridades cerradas

\#\# Prioridad máxima  
\- validar y dejar sólido \`LEAGUE\_TABLE\`.

\#\# Prioridad alta  
\- \`Stage\`  
\- \`Group\`  
\- \`Tie\`  
\- \`TieSlot\`

\#\# Prioridad media  
\- placeholders en \`TieSlot\`  
\- bracket visual

\#\# Prioridad posterior  
\- mejores terceros derivados  
\- \`league\_phase\`

\---

\# 19\. No objetivos cerrados de esta fase

No se aprueba en esta etapa:

\- cálculo intertorneos global,  
\- clasificación automática desde eliminatorias al Mundial,  
\- repechajes intercontinentales derivados automáticamente,  
\- motor universal de sorteo,  
\- reglas completas FIFA/UEFA/CONMEBOL de seeds y acceso,  
\- sobreingeniería de placeholders,  
\- persistencias innecesarias para mejores terceros si una proyección derivada alcanza.

\---

\# 20\. Criterios de aceptación

La evolución del modelo se considera correcta si:

1\. el modelo actual queda validado o corregido para \`LEAGUE\_TABLE\`;  
2\. el sistema puede representar grupos de forma nativa;  
3\. el sistema puede representar un knockout con cruces y slots;  
4\. el sistema puede mostrar placeholders donde falten equipos;  
5\. el sistema puede soportar un torneo tipo Mundial 2026 sin hacks grotescos;  
6\. el sistema puede soportar Libertadores desde fase de grupos en adelante sin hacks grotescos;  
7\. el sistema puede soportar AFCON dentro de la familia con mejores terceros;  
8\. el sistema puede, en una fase posterior, soportar Champions sin romper lo anterior.

\---

\# 21\. Instrucciones explícitas para Claude

Claude debe trabajar en este orden:

1\. \*\*Auditar el código actual\*\* antes de cambiar nada.  
2\. Confirmar qué piezas del modelo ya existen y cuáles no.  
3\. Tratar la matriz como \*\*hipótesis de auditoría\*\*, no como verdad cerrada.  
4\. Proponer cambios mínimos, no una reinvención total.  
5\. Mantener compatibilidad con el comportamiento actual de ligas.  
6\. Extender el modelo por fases, no de una sola vez.  
7\. Separar claramente:  
   \- dominio/persistencia,  
   \- lógica derivada,  
   \- UI/presentación.

Claude no debe:  
\- rediseñar todo desde cero sin necesidad,  
\- introducir un motor global de torneos,  
\- implementar complejidad intertorneos fuera del alcance definido.

\---

\# 22\. Resultado esperado

Al terminar esta línea de trabajo, el proyecto debe quedar con una base suficiente para soportar:

\- Eliminatorias CONMEBOL  
\- Mundial 2026  
\- Libertadores  
\- AFCON  
\- Champions actual

No necesariamente con todos los detalles finos implementados de una vez, pero sí con un modelo que no obligue a romper todo cada vez que se agregue uno de estos formatos.  
