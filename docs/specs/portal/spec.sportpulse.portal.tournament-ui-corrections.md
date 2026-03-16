---
artifact_id: SPEC-SPORTPULSE-PORTAL-TOURNAMENT-UI-CORRECTIONS
title: "Tournament UI Corrections Specification"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: portal
slug: tournament-ui-corrections
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/specs/spec.sportpulse.portal.tournament-ui-corrections.md
---
\# Documento 2 — Especificación técnica de implementación  
\#\# Proyecto: Portal de resultados  
\#\# Dependencia normativa: subordinado a \*\*Spec 1 — Auditoría y evolución del modelo de competiciones\*\*  
\#\# Estado: base técnica cerrada para implementación por fases

\---

\# 1\. Relación con Spec 1

Este documento implementa lo definido en \*\*Spec 1\*\*.

\#\# 1.1 Jerarquía  
\- \*\*Spec 1 manda\*\* sobre:  
  \- alcance,  
  \- prioridades,  
  \- límites de complejidad,  
  \- no objetivos,  
  \- decisiones arquitectónicas.  
\- \*\*Documento 2 manda\*\* sobre:  
  \- entidades,  
  \- campos,  
  \- relaciones,  
  \- constraints,  
  \- reglas técnicas por familia,  
  \- mapping API → modelo interno,  
  \- migración,  
  \- pruebas.

\#\# 1.2 Regla de conflicto  
Si una decisión técnica de este documento contradice a Spec 1:  
\- prevalece \*\*Spec 1\*\*,  
\- este documento debe corregirse.

\---

\# 2\. Objetivo técnico

Definir el modelo mínimo implementable para soportar, de forma incremental y sin romper el soporte actual de ligas:

\- \`LEAGUE\_TABLE\`  
\- \`GROUP\_STAGE\_PLUS\_KNOCKOUT\`  
\- \`GROUP\_STAGE\_PLUS\_KNOCKOUT\_WITH\_BEST\_THIRDS\`  
\- \`LEAGUE\_PHASE\_PLUS\_KNOCKOUT\`

El modelo debe ser lo bastante genérico para representar:  
\- Eliminatorias CONMEBOL,  
\- Mundial 2026,  
\- Libertadores,  
\- AFCON,  
\- Champions actual,

sin introducir un motor global de clasificación intertorneos.

\---

\# 3\. Principios técnicos obligatorios

\#\# 3.1 No romper ligas actuales  
La implementación debe mantener compatibilidad con el caso actual de campeonato tipo liga.

\#\# 3.2 Agregar, no reescribir todo  
Se deben introducir extensiones mínimas sobre el modelo actual.

\#\# 3.3 Dominio antes que UI  
No resolver ausencias del dominio con hacks de visualización.

\#\# 3.4 Derivación interna limitada  
Se permite derivar lógica \*\*solo dentro de una misma competición\*\* y solo para:  
\- organizar bracket,  
\- resolver mejores terceros,  
\- poblar slots internos del torneo,  
\- simulación/test interno.

No se permite derivar clasificación desde otras competiciones.

\#\# 3.5 API como fuente principal  
Si la API ya trae el dato resuelto:  
\- ese dato manda.  
No recalcular localmente algo que ya vino confirmado.

\---

\# 4\. Modelo técnico mínimo

\#\# 4.1 Enumeraciones mínimas

\#\#\# \`FormatFamily\`  
\- \`LEAGUE\_TABLE\`  
\- \`GROUP\_STAGE\_PLUS\_KNOCKOUT\`  
\- \`GROUP\_STAGE\_PLUS\_KNOCKOUT\_WITH\_BEST\_THIRDS\`  
\- \`LEAGUE\_PHASE\_PLUS\_KNOCKOUT\`

\#\#\# \`StageType\`  
\- \`LEAGUE\`  
\- \`GROUP\_STAGE\`  
\- \`ROUND\_OF\_32\`  
\- \`ROUND\_OF\_16\`  
\- \`QUARTER\_FINALS\`  
\- \`SEMI\_FINALS\`  
\- \`FINAL\`  
\- \`PLAYOFF\`  
\- \`CUSTOM\`

\#\#\# \`MatchStatus\`  
La lista exacta debe mapearse desde la API existente, pero como mínimo debe soportar:  
\- \`SCHEDULED\`  
\- \`TIMED\`  
\- \`IN\_PLAY\`  
\- \`PAUSED\`  
\- \`EXTRA\_TIME\`  
\- \`PENALTY\_SHOOTOUT\`  
\- \`FINISHED\`  
\- \`POSTPONED\`  
\- \`SUSPENDED\`  
\- \`CANCELLED\`  
\- \`AWARDED\`  
\- \`UNKNOWN\`

\#\#\# \`StandingScope\`  
\- \`STAGE\`  
\- \`GROUP\`

\#\#\# \`SlotRole\`  
\- \`A\`  
\- \`B\`

\---

\# 5\. Entidades y campos mínimos

\#\# 5.1 \`CompetitionEdition\`

Representa una edición concreta de una competición.

\#\#\# Campos mínimos  
\- \`id\` — requerido  
\- \`externalCompetitionId\` — nullable  
\- \`name\` — requerido  
\- \`seasonLabel\` — requerido  
\- \`formatFamily\` — requerido  
\- \`status\` — requerido  
\- \`startDate\` — nullable  
\- \`endDate\` — nullable  
\- \`metadataJson\` — nullable

\#\#\# Constraints  
\- \`id\` único  
\- \`(name, seasonLabel)\` recomendable como clave lógica  
\- \`formatFamily\` obligatorio

\---

\#\# 5.2 \`Participant\`

Representa un equipo o selección.

\#\#\# Campos mínimos  
\- \`id\` — requerido  
\- \`externalParticipantId\` — nullable  
\- \`name\` — requerido  
\- \`shortName\` — nullable  
\- \`tla\` — nullable  
\- \`crestUrl\` — nullable  
\- \`countryCode\` — nullable  
\- \`participantType\` — requerido (\`club\` / \`national\_team\`)  
\- \`metadataJson\` — nullable

\#\#\# Constraints  
\- \`id\` único  
\- \`name\` obligatorio  
\- no usar placeholder como \`Participant\` en esta fase

\---

\#\# 5.3 \`Stage\`

Representa una fase dentro de una edición.

\#\#\# Campos mínimos  
\- \`id\` — requerido  
\- \`competitionEditionId\` — requerido  
\- \`name\` — requerido  
\- \`stageType\` — requerido  
\- \`orderIndex\` — requerido  
\- \`hasStandings\` — requerido  
\- \`hasBracket\` — requerido  
\- \`metadataJson\` — nullable

\#\#\# Constraints  
\- \`id\` único  
\- \`competitionEditionId\` FK obligatorio  
\- \`orderIndex\` único dentro de \`competitionEditionId\`  
\- \`stageType\` obligatorio

\#\#\# Reglas  
\- un torneo puede tener uno o más \`Stage\`  
\- \`LEAGUE\_TABLE\` puede tener un solo \`Stage\`  
\- \`GROUP\_STAGE\_PLUS\_KNOCKOUT\` debe tener al menos:  
  \- un \`Stage\` de grupos,  
  \- uno o más \`Stage\` de knockout

\---

\#\# 5.4 \`Group\`

Representa un grupo dentro de una fase.

\#\#\# Campos mínimos  
\- \`id\` — requerido  
\- \`stageId\` — requerido  
\- \`name\` — requerido  
\- \`orderIndex\` — requerido  
\- \`metadataJson\` — nullable

\#\#\# Constraints  
\- \`id\` único  
\- \`stageId\` FK obligatorio  
\- \`name\` obligatorio  
\- \`orderIndex\` único dentro de \`stageId\`

\#\#\# Reglas  
\- solo existe para fases que usan grupos  
\- no aplica a \`LEAGUE\_TABLE\`  
\- no aplica a \`LEAGUE\_PHASE\_PLUS\_KNOCKOUT\`

\---

\#\# 5.5 \`StandingTable\`

Representa una tabla de posiciones.

\#\#\# Campos mínimos  
\- \`id\` — requerido  
\- \`competitionEditionId\` — requerido  
\- \`stageId\` — requerido  
\- \`groupId\` — nullable  
\- \`scope\` — requerido (\`STAGE\` / \`GROUP\`)  
\- \`updatedAt\` — nullable

\#\#\# Constraints  
\- \`id\` único  
\- \`stageId\` FK obligatorio  
\- si \`scope \= GROUP\`, entonces \`groupId\` es obligatorio  
\- si \`scope \= STAGE\`, entonces \`groupId\` debe ser null

\---

\#\# 5.6 \`StandingRow\`

Representa una fila de tabla.

\#\#\# Campos mínimos  
\- \`id\` — requerido  
\- \`standingTableId\` — requerido  
\- \`participantId\` — requerido  
\- \`rank\` — requerido  
\- \`played\` — requerido  
\- \`wins\` — requerido  
\- \`draws\` — requerido  
\- \`losses\` — requerido  
\- \`goalsFor\` — requerido  
\- \`goalsAgainst\` — requerido  
\- \`goalDifference\` — requerido  
\- \`points\` — requerido  
\- \`statusBadge\` — nullable  
\- \`metadataJson\` — nullable

\#\#\# Constraints  
\- \`id\` único  
\- \`(standingTableId, participantId)\` único  
\- \`(standingTableId, rank)\` único  
\- \`participantId\` FK obligatorio

\#\#\# Regla  
\`statusBadge\` es visual/semántico, no motor de clasificación global.

\---

\#\# 5.7 \`Tie\`

Representa un cruce eliminatorio.

\#\#\# Campos mínimos  
\- \`id\` — requerido  
\- \`competitionEditionId\` — requerido  
\- \`stageId\` — requerido  
\- \`name\` — requerido  
\- \`roundLabel\` — requerido  
\- \`orderIndex\` — requerido  
\- \`metadataJson\` — nullable

\#\#\# Constraints  
\- \`id\` único  
\- \`stageId\` FK obligatorio  
\- \`(stageId, orderIndex)\` único

\#\#\# Reglas  
\- solo existe en fases con bracket  
\- un \`Tie\` representa una unidad visual/lógica del cuadro  
\- puede existir aunque los participantes aún no estén definidos

\---

\#\# 5.8 \`TieSlot\`

Representa cada lado de un cruce.

\#\#\# Campos mínimos  
\- \`id\` — requerido  
\- \`tieId\` — requerido  
\- \`slotRole\` — requerido (\`A\` / \`B\`)  
\- \`participantId\` — nullable  
\- \`placeholderText\` — nullable  
\- \`sourceMatchId\` — nullable  
\- \`metadataJson\` — nullable

\#\#\# Constraints  
\- \`id\` único  
\- \`(tieId, slotRole)\` único  
\- \`tieId\` FK obligatorio

\#\#\# Reglas cerradas  
\- no crear entidad placeholder aparte en esta fase  
\- \`participantId\` puede ser null  
\- \`placeholderText\` puede ser null  
\- casos válidos:  
  \- \`participantId\` definido y \`placeholderText\` null  
  \- \`participantId\` null y \`placeholderText\` definido  
  \- ambos null si el slot todavía no fue resuelto ni proyectado  
\- \`sourceMatchId\` es opcional y solo sirve para navegación/derivación interna dentro del mismo torneo

\---

\#\# 5.9 \`Match\`

Representa un partido.

\#\#\# Campos mínimos  
\- \`id\` — requerido  
\- \`externalMatchId\` — nullable  
\- \`competitionEditionId\` — requerido  
\- \`stageId\` — requerido  
\- \`groupId\` — nullable  
\- \`tieId\` — nullable  
\- \`utcDate\` — nullable  
\- \`status\` — requerido  
\- \`homeParticipantId\` — nullable  
\- \`awayParticipantId\` — nullable  
\- \`homeScore\` — nullable  
\- \`awayScore\` — nullable  
\- \`homeScoreExtraTime\` — nullable  
\- \`awayScoreExtraTime\` — nullable  
\- \`homeScorePenalties\` — nullable  
\- \`awayScorePenalties\` — nullable  
\- \`winnerParticipantId\` — nullable  
\- \`matchday\` — nullable  
\- \`metadataJson\` — nullable

\#\#\# Constraints  
\- \`id\` único  
\- \`competitionEditionId\` FK obligatorio  
\- \`stageId\` FK obligatorio  
\- \`groupId\` nullable  
\- \`tieId\` nullable

\#\#\# Reglas  
\- un \`Match\` puede pertenecer a:  
  \- una fase de liga/tabla,  
  \- un grupo,  
  \- un tie de knockout  
\- \`groupId\` y \`tieId\` no deberían coexistir salvo caso muy excepcional; por defecto, considerar que son mutuamente excluyentes

\---

\# 6\. Relaciones mínimas

\#\# Relaciones obligatorias  
\- \`CompetitionEdition 1 \-\> N Stage\`  
\- \`CompetitionEdition 1 \-\> N Match\`  
\- \`Stage 1 \-\> N Group\`  
\- \`Stage 1 \-\> N StandingTable\`  
\- \`StandingTable 1 \-\> N StandingRow\`  
\- \`Stage 1 \-\> N Tie\`  
\- \`Tie 1 \-\> N TieSlot\`  
\- \`Tie 1 \-\> N Match\` (para partidos que pertenecen a un cruce)

\#\# Reglas de integridad  
\- no crear \`Group\` fuera de un \`Stage\`  
\- no crear \`Tie\` fuera de un \`Stage\`  
\- no crear \`StandingTable\` sin \`Stage\`  
\- no crear \`StandingRow\` sin \`StandingTable\`  
\- no crear \`TieSlot\` sin \`Tie\`

\---

\# 7\. Reglas por familia de formato

\#\# 7.1 \`LEAGUE\_TABLE\`

\#\#\# Estructura mínima  
\- 1 \`CompetitionEdition\`  
\- 1 \`Stage\` de tipo \`LEAGUE\`  
\- 1 \`StandingTable\` con \`scope \= STAGE\`  
\- N \`Match\`  
\- 0 \`Group\`  
\- 0 \`Tie\`

\#\#\# Casos objetivo  
\- Eliminatorias CONMEBOL

\#\#\# Regla  
El modelo actual debe seguir funcionando aquí sin degradación.

\---

\#\# 7.2 \`GROUP\_STAGE\_PLUS\_KNOCKOUT\`

\#\#\# Estructura mínima  
\- 1 \`Stage\` de tipo \`GROUP\_STAGE\`  
\- N \`Group\`  
\- 1 \`StandingTable\` por grupo  
\- N \`Match\` en grupos  
\- uno o más \`Stage\` de knockout  
\- N \`Tie\`  
\- N \`TieSlot\`  
\- N \`Match\` knockout

\#\#\# Casos objetivo  
\- Libertadores desde fase de grupos en adelante

\#\#\# Regla  
La transición grupos → knockout puede venir de API o derivarse mínimamente dentro de la misma competición si la API no da el bracket listo.

\---

\#\# 7.3 \`GROUP\_STAGE\_PLUS\_KNOCKOUT\_WITH\_BEST\_THIRDS\`

\#\#\# Estructura mínima  
\- igual que \`GROUP\_STAGE\_PLUS\_KNOCKOUT\`  
\- más capacidad de ranking cruzado de terceros

\#\#\# Casos objetivo  
\- Mundial 2026  
\- AFCON

\#\#\# Regla cerrada  
El ranking de mejores terceros se resuelve inicialmente como \*\*proyección derivada\*\* a partir de \`StandingRow\`.

\#\#\# Regla adicional  
La derivación de mejores terceros solo puede operar \*\*dentro de la misma competición\*\*.

\---

\#\# 7.4 \`LEAGUE\_PHASE\_PLUS\_KNOCKOUT\`

\#\#\# Estructura mínima  
\- 1 \`Stage\` de tipo \`LEAGUE\`  
\- 1 \`StandingTable\` con \`scope \= STAGE\`  
\- N \`Match\`  
\- cero grupos  
\- luego uno o más \`Stage\` de knockout / playoff  
\- N \`Tie\`  
\- N \`TieSlot\`

\#\#\# Caso objetivo  
\- Champions actual

\#\#\# Regla crítica  
El modelo no debe asumir que una tabla única implica round-robin completo entre todos los participantes.

\---

\# 8\. Derivación permitida y derivación prohibida

\#\# 8.1 Derivación permitida  
Se permite derivar:  
\- \`Stage\` desde datos de API si no vienen como entidad explícita pero sí como atributo de partido  
\- \`Group\` desde datos de API si vienen como atributo de partido o standing  
\- \`Tie\` agrupando matches de una misma ronda de knockout  
\- \`TieSlot.placeholderText\` cuando el equipo aún no está definido  
\- ranking de mejores terceros dentro de la misma competición  
\- estructura visual del bracket

\#\# 8.2 Derivación prohibida  
No se permite derivar:  
\- clasificados al Mundial desde todas las confederaciones  
\- representantes al repechaje intercontinental desde otras competiciones  
\- seeds globales entre torneos  
\- poblado automático de un torneo desde otro si la API no lo trae

\---

\# 9\. Mapping API → modelo interno

\#\# 9.1 Regla general  
Cada campo del modelo debe clasificarse como:  
\- \`DIRECTO\` — viene de la API  
\- \`DERIVADO\` — se construye localmente desde datos de la misma competición  
\- \`MANUAL/CONFIG\` — se define internamente por configuración

\#\# 9.2 Matriz mínima

| Campo interno | Fuente | Regla |  
|---|---|---|  
| \`CompetitionEdition.name\` | API | DIRECTO |  
| \`CompetitionEdition.seasonLabel\` | API | DIRECTO |  
| \`CompetitionEdition.formatFamily\` | CONFIG | MANUAL/CONFIG |  
| \`Participant.\*\` | API | DIRECTO |  
| \`Stage.name\` | API / derivado | DIRECTO si la API lo entrega; si no, DERIVADO desde \`stage\` de partidos |  
| \`Stage.stageType\` | API / derivado | DERIVADO |  
| \`Group.name\` | API / derivado | DIRECTO si existe; si no, DERIVADO desde códigos de grupo |  
| \`StandingTable\` | API / derivado | DIRECTO si la API entrega standings; si no, DERIVADO según fase |  
| \`StandingRow.\*\` | API | DIRECTO |  
| \`Match.\*\` | API | DIRECTO |  
| \`Tie\` | derivado | DERIVADO desde rondas knockout |  
| \`TieSlot.participantId\` | API / derivado | DIRECTO si el match ya viene resuelto; si no, null |  
| \`TieSlot.placeholderText\` | derivado | DERIVADO |

\#\# 9.3 Regla crítica  
Si la API ya entrega el fixture del knockout con equipos resueltos, \*\*ese dato manda\*\*.    
No recalcular cruces ya definidos.

\---

\# 10\. Auditoría obligatoria del sistema actual

Claude debe responder, con evidencia del código, estas preguntas antes de implementar.

\#\# 10.1 Soporte de \`LEAGUE\_TABLE\`  
\- ¿Existe hoy una abstracción equivalente a \`CompetitionEdition\`?  
\- ¿Existe ya soporte estable de standings?  
\- ¿Existe ya relación clara partido ↔ competición?  
\- ¿La UI de liga depende de supuestos que romperían si se agrega \`Stage\`?

\#\# 10.2 Soporte de grupos  
\- ¿Existe hoy algo equivalente a \`Group\`?  
\- ¿\`StandingTable\` puede scopearse por grupo o hay una sola tabla por campeonato?  
\- ¿los fixtures pueden filtrarse por grupo?

\#\# 10.3 Soporte de knockout  
\- ¿Existe hoy algo equivalente a \`Tie\`?  
\- ¿un partido puede estar asociado a un cruce?  
\- ¿la UI soporta renderizar rondas separadas?

\#\# 10.4 Soporte de placeholders  
\- ¿la UI ya soporta texto en lugar de equipo?  
\- ¿hay campos actuales reutilizables o hay que agregarlos?

\#\# 10.5 Soporte de Champions  
\- ¿la lógica actual asume que una tabla única implica round-robin completo?  
\- ¿se puede soportar tabla única con calendario parcial por equipo?

\---

\# 11\. Estrategia de migración

\#\# 11.1 Regla general  
La migración debe ser incremental y no romper el soporte actual de ligas.

\#\# 11.2 Orden de migración

\#\#\# Paso 1  
Agregar \`Stage\` sin romper la lógica actual.  
\- los torneos actuales de liga pueden quedar con un único \`Stage\`

\#\#\# Paso 2  
Agregar \`Group\`  
\- solo usado por torneos que lo necesiten

\#\#\# Paso 3  
Agregar \`Tie\` y \`TieSlot\`  
\- no debe afectar el caso de liga

\#\#\# Paso 4  
Agregar derivación de mejores terceros  
\- sin persistencia adicional al inicio

\#\#\# Paso 5  
Agregar soporte a \`LEAGUE\_PHASE\_PLUS\_KNOCKOUT\`

\#\# 11.3 Regla de compatibilidad  
Todo torneo existente del portal debe seguir funcionando aunque no use:  
\- grupos,  
\- ties,  
\- placeholders.

\---

\# 12\. Casos de prueba obligatorios

\#\# Caso 1 — Eliminatorias CONMEBOL  
Debe soportar:  
\- tabla única  
\- standings  
\- partidos por fecha  
\- estados  
\- badges simples si vienen de API

\#\# Caso 2 — Libertadores  
Debe soportar:  
\- grupos  
\- standings por grupo  
\- partidos por grupo  
\- knockout desde fase de grupos en adelante  
\- final

\#\# Caso 3 — Mundial 2026  
Debe soportar:  
\- 12 grupos  
\- standings por grupo  
\- ranking derivado de mejores terceros  
\- Round of 32  
\- Round of 16  
\- Quarter-finals  
\- Semi-finals  
\- Final  
\- placeholders donde falten equipos definidos

\#\# Caso 4 — AFCON  
Debe soportar:  
\- 6 grupos  
\- standings por grupo  
\- mejores terceros  
\- octavos y fases posteriores

\#\# Caso 5 — Champions actual  
Debe soportar:  
\- league phase sin grupos  
\- tabla única  
\- calendario parcial por equipo  
\- playoff / knockout posterior

\---

\# 13\. Fases de implementación

\#\# Fase 1 — Validar y endurecer \`LEAGUE\_TABLE\`  
Entregables:  
\- auditoría del modelo actual  
\- lista de riesgos  
\- ajustes mínimos para consolidar el caso liga

\#\# Fase 2 — Implementar \`Stage\` \+ \`Group\`  
Entregables:  
\- nuevas entidades o estructuras equivalentes  
\- standings por grupo  
\- fixtures por grupo

\#\# Fase 3 — Implementar \`Tie\` \+ \`TieSlot\`  
Entregables:  
\- dominio de knockout  
\- placeholders mínimos en slots  
\- base para bracket visual

\#\# Fase 4 — Implementar mejores terceros derivados  
Entregables:  
\- lógica derivada dentro del mismo torneo  
\- ranking cruzado de terceros  
\- llenado de slots internos de knockout

\#\# Fase 5 — Implementar \`LEAGUE\_PHASE\_PLUS\_KNOCKOUT\`  
Entregables:  
\- soporte a tabla única no round-robin completa  
\- soporte a playoff y knockout posterior

\---

\# 14\. Prioridades

\#\# Máxima  
\- consolidar \`LEAGUE\_TABLE\`

\#\# Alta  
\- \`Stage\`  
\- \`Group\`  
\- \`Tie\`  
\- \`TieSlot\`

\#\# Media  
\- placeholders en \`TieSlot\`  
\- bracket visual

\#\# Posterior  
\- mejores terceros derivados  
\- support completo de \`LEAGUE\_PHASE\_PLUS\_KNOCKOUT\`

\---

\# 15\. No objetivos de esta fase

No se aprueba:  
\- motor universal de torneos globales  
\- clasificación intertorneos automática  
\- repechajes intercontinentales derivados  
\- seeds globales automáticos  
\- sorteo universal  
\- placeholder como entidad compleja  
\- persistencia nueva para mejores terceros sin necesidad demostrada

\---

\# 16\. Criterios de aceptación

La implementación se considera correcta si:

1\. no rompe el soporte actual de ligas;  
2\. agrega soporte nativo a grupos;  
3\. agrega soporte nativo a knockout;  
4\. soporta placeholders mínimos en slots;  
5\. soporta Mundial 2026 sin hacks grotescos;  
6\. soporta Libertadores desde grupos en adelante;  
7\. soporta AFCON con mejores terceros;  
8\. deja el terreno listo para Champions sin romper lo anterior.

\---

\# 17\. Instrucciones obligatorias para Claude

Claude debe:

1\. auditar el código actual antes de cambiar nada;  
2\. tratar la matriz del Spec 1 como hipótesis de auditoría;  
3\. proponer cambios mínimos y justificados;  
4\. separar dominio, derivación y UI;  
5\. implementar por fases;  
6\. documentar cualquier desviación obligatoria respecto a esta spec.

Claude no debe:

\- rediseñar todo desde cero,  
\- implementar lógica intertorneos global,  
\- inflar el dominio sin necesidad,  
\- esconder agujeros del modelo detrás de la UI.  
