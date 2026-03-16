---
artifact_id: SPEC-SPORTPULSE-DATA-LUTA-URUGUAY-MULTISOURCE-INTEGRATION
title: "LUTA Uruguay Multi-Source Integration Requirements"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: data
slug: luta-uruguay-multisource-integration
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/specs/spec.sportpulse.data.luta-uruguay-multisource-integration.md
---
# Requerimiento de Integración Multifuente para Liga Uruguaya

## 1. Objetivo

Se requiere integrar una segunda fuente de datos de fútbol al sistema actual para que:

- **la Liga Uruguaya** consuma datos desde **Football DB**
- **el resto de las ligas** continúe consumiendo datos desde la **API actual ya integrada en el sistema**

El objetivo es **incorporar la Liga Uruguaya sin descontrolar la arquitectura existente**, evitando cambios improvisados, lógica duplicada o condiciones dispersas en frontend, backend o persistencia.

---

## 2. Problema a resolver

El sistema actual ya consume una API principal para obtener información de ligas, partidos y resultados. Esa integración funciona para las ligas actualmente soportadas, pero **no cubre la Liga Uruguaya**.

Para resolver esto, se necesita incorporar **Football DB** como proveedor alternativo **únicamente para la Liga Uruguaya**, sin romper el comportamiento actual para las demás ligas.

El error sería resolverlo con condiciones sueltas del tipo:

- `if liga == uruguay` en múltiples pantallas
- transformaciones diferentes por cada endpoint
- diferencias de estructura filtrándose al frontend
- cambios manuales en componentes ya estables

Eso generaría deuda técnica, fragilidad y errores difíciles de rastrear.

---

## 3. Criterio rector

La integración debe realizarse de forma que **el sistema mantenga una estructura interna única**, independientemente del proveedor externo.

Esto implica que:

- el **frontend no debe saber** qué API está respondiendo
- el **modelo interno del sistema debe seguir siendo el mismo**
- la lógica de negocio debe trabajar con un **contrato común normalizado**
- la selección del proveedor debe ocurrir en una **capa controlada de resolución/routing**
- Football DB debe usarse **solo para la Liga Uruguaya**
- la API actual debe seguir siendo la fuente para **todas las demás ligas**

---

## 4. Alcance

Este requerimiento incluye:

1. incorporación de **Football DB** como proveedor secundario
2. mantenimiento de la **API actual** como proveedor principal para las ligas ya existentes
3. coexistencia controlada entre ambos proveedores
4. adaptación y transformación de respuestas externas a la **estructura actual del sistema**
5. selección automática del proveedor según la liga consultada
6. manejo de errores, cache y trazabilidad para evitar fallas innecesarias

Este requerimiento **no** implica rediseñar toda la plataforma ni reemplazar la API actual para el resto de las competiciones.

---

## 5. Requerimiento principal

El sistema deberá permitir que, al consultar información de la **Liga Uruguaya**, los datos sean obtenidos desde **Football DB**, mientras que para cualquier otra liga ya soportada actualmente se deberá seguir utilizando la **API principal actual**, sin modificar el contrato interno ni provocar regresiones funcionales.

La integración deberá buscar la forma de:

- obtener los datos desde Football DB
- mapearlos correctamente
- adaptarlos al formato actual esperado por el sistema
- mantener consistencia con el resto de las ligas
- evitar errores por diferencias entre estructuras externas

---

## 6. Reglas de negocio de coexistencia

### Regla 1. Liga Uruguaya
Cuando la competición seleccionada corresponda a la **Liga Uruguaya**, el sistema deberá consultar **Football DB**.

### Regla 2. Resto de ligas
Cuando la competición seleccionada corresponda a cualquier otra liga ya soportada, el sistema deberá seguir utilizando la **API actual**.

### Regla 3. Transparencia para la UI
El frontend no deberá recibir estructuras diferentes según el proveedor.

### Regla 4. Contrato interno único
Ambas fuentes deberán converger a un mismo contrato de salida interno.

### Regla 5. Sin lógica dispersa
La decisión sobre qué proveedor usar no deberá distribuirse en múltiples módulos. Debe quedar centralizada.

---

## 7. Requerimientos funcionales

### RF-01. Resolución de proveedor por liga
El sistema deberá contar con una regla centralizada que permita determinar qué proveedor corresponde a cada liga.

Ejemplo inicial:

- `Liga Uruguaya -> Football DB`
- `Premier League -> API actual`
- `Bundesliga -> API actual`
- `otras ligas ya soportadas -> API actual`

### RF-02. Integración no disruptiva
La incorporación de Football DB no deberá alterar el funcionamiento actual de las ligas ya integradas.

### RF-03. Normalización obligatoria
Toda respuesta proveniente de Football DB deberá transformarse al mismo formato interno que ya utiliza el sistema.

### RF-04. Soporte mínimo de datos para Liga Uruguaya
La integración deberá permitir obtener como mínimo:

- datos básicos de la competición
- listado de equipos
- próximos partidos
- resultados recientes
- partidos/fixtures de temporada
- marcador y estado del partido cuando corresponda
- fecha y hora del evento
- local y visitante

### RF-05. Compatibilidad con la estructura actual
Los datos integrados desde Football DB deberán insertarse en la misma estructura, contratos, DTOs o modelos internos que actualmente utiliza el sistema para las demás ligas.

### RF-06. Manejo de errores controlado
Si Football DB falla o responde incompleto, el sistema no deberá desestabilizarse. Deberá:

- registrar el error
- responder de forma controlada
- usar cache si existe dato válido previo
- evitar caídas globales del módulo

### RF-07. Identificadores internos estables
La liga, equipos y partidos deberán seguir manejándose con identificadores internos del sistema. Los IDs externos de las APIs deberán ser tratados como referencias de integración, no como claves de negocio principales.

---

## 8. Requerimientos técnicos

### RT-01. Capa Adapter por proveedor
Se deberá implementar una capa de adaptación por proveedor.

Ejemplo conceptual:

- `CurrentApiAdapter`
- `FootballDbAdapter`

Ambos deberán exponer una interfaz interna homogénea.

### RT-02. Provider Router
Se deberá implementar un componente central encargado de resolver qué adapter usar según la liga solicitada.

Ejemplo conceptual:

- `CompetitionProviderRouter`
- `LeagueSourceResolver`

### RT-03. Contrato interno común
El sistema deberá definir o respetar un contrato interno común para entidades como:

- Competition
- Team
- Match
- Fixture
- Result
- Season
- MatchStatus

### RT-04. Mapeo explícito de campos
La integración deberá definir un mapeo explícito entre los campos que devuelve Football DB y los campos esperados por la estructura actual del sistema.

No se debe improvisar el mapeo en cada endpoint.

### RT-05. Cache
Se deberá aplicar cache para minimizar llamadas innecesarias y reducir errores por dependencia externa.

Sugerencia mínima:

- catálogos de liga/equipos: cache largo
- próximos partidos/resultados: cache corto
- temporada: cache medio

### RT-06. Logs y trazabilidad
Cada consulta deberá poder registrar al menos:

- liga consultada
- proveedor resuelto
- endpoint consumido
- tiempo de respuesta
- hit/miss de cache
- error si lo hubo

### RT-07. Backend como punto único de integración
La integración con Football DB no deberá ser consumida directamente desde el frontend. Toda consulta deberá pasar por backend para permitir:

- control del proveedor
- normalización
- cache
- manejo de errores
- desacople del frontend

---

## 9. Diseño propuesto

### 9.1. Enfoque recomendado

La solución debe implementarse con una arquitectura de este tipo:

1. el frontend solicita datos de una liga usando el contrato actual
2. el backend recibe la solicitud con el identificador interno de liga
3. un router interno determina qué proveedor corresponde
4. el adapter del proveedor consulta la API externa
5. la respuesta externa se transforma al modelo interno actual
6. el backend devuelve un resultado uniforme al frontend

### 9.2. Beneficio de este enfoque

Este diseño evita:

- contaminar la UI con excepciones por liga
- duplicar lógica por proveedor
- romper componentes existentes
- propagar estructuras distintas según origen
- meter condiciones arbitrarias en todos lados

### 9.3. Lo que no hay que hacer

No se debe:

- consultar Football DB directo desde la UI
- mezclar nombres de campos externos en dominio interno
- usar condicionales por liga en múltiples módulos
- tratar IDs externos como IDs principales del sistema
- crear una versión paralela del flujo solo para Uruguay

---

## 10. Adaptación a la estructura actual

La clave de esta integración no es solo consumir Football DB, sino **adaptar correctamente sus datos a la estructura actual del sistema sin errores**.

Por lo tanto, el equipo deberá identificar cómo el sistema representa hoy:

- ligas
- temporadas
- equipos
- partidos
- resultados
- estado del partido
- fechas
- marcadores
- local/visitante

Y luego deberá construir un mapeo estable entre la respuesta de Football DB y esas estructuras existentes.

### Requisitos de adaptación

- respetar nombres internos ya existentes
- respetar enums y estados internos
- respetar formato de fechas y horas ya utilizado por el sistema
- respetar claves y relaciones ya definidas
- contemplar campos faltantes o nulos sin romper el flujo
- definir defaults controlados cuando un dato no exista en Football DB

### Regla crítica

**La API nueva se adapta al sistema. El sistema no debe deformarse para parecerse a la API nueva.**

---

## 11. Casos de uso esperados

### Caso 1. Consulta de Premier League
- usuario selecciona Premier League
- sistema resuelve proveedor actual
- respuesta se comporta igual que hoy

### Caso 2. Consulta de Bundesliga
- usuario selecciona Bundesliga
- sistema resuelve proveedor actual
- respuesta se comporta igual que hoy

### Caso 3. Consulta de Liga Uruguaya
- usuario selecciona Liga Uruguaya
- sistema resuelve Football DB
- adapter transforma la respuesta al modelo actual
- frontend recibe la misma estructura que recibe para otras ligas

### Caso 4. Error del proveedor de Uruguay
- usuario selecciona Liga Uruguaya
- Football DB falla o no responde
- sistema registra el error
- si existe cache válida, responde con cache
- si no existe cache, devuelve error controlado sin afectar otras ligas

---

## 12. Criterios de aceptación

### CA-01
La Liga Uruguaya debe obtener sus datos desde Football DB.

### CA-02
El resto de las ligas debe seguir obteniendo sus datos desde la API actual, sin cambios regresivos.

### CA-03
El frontend no debe requerir lógica especial por proveedor.

### CA-04
Los datos de Football DB deben adaptarse correctamente a la estructura actual del sistema.

### CA-05
No deben generarse errores por diferencias de formato entre proveedores.

### CA-06
La decisión de proveedor debe estar centralizada y no dispersa.

### CA-07
El sistema debe registrar errores y permitir trazabilidad de qué proveedor respondió cada consulta.

### CA-08
La integración no debe degradar ni desordenar el comportamiento actual del sistema.

---

## 13. Riesgos principales

### Riesgo 1. Parche rápido mal hecho
Resolver esto con excepciones sueltas puede funcionar al principio y pudrir todo después.

### Riesgo 2. Mapeo inconsistente
Si cada endpoint adapta datos de manera distinta, vas a terminar con incoherencias entre pantallas.

### Riesgo 3. Dependencia externa sin control
Si no hay cache ni manejo de errores, un problema en Football DB va a pegarle a la experiencia completa de Uruguay.

### Riesgo 4. Contaminación del dominio
Si los nombres y formatos externos se filtran al sistema, después cada proveedor nuevo será un dolor adicional.

### Riesgo 5. Uso incorrecto de IDs
Si se usan IDs externos como IDs internos, cualquier cambio futuro de proveedor puede romper relaciones y consistencia.

---

## 14. Recomendación de implementación

Se recomienda implementar esta mejora en las siguientes capas:

1. **configuración de ligas y proveedor asignado**
2. **router central de proveedor por liga**
3. **adapter para Football DB**
4. **adapter actual para la API ya existente**
5. **normalizador hacia DTO/modelo interno común**
6. **cache y observabilidad**

Esto permite que en el futuro se puedan agregar otras ligas o proveedores sin volver a desordenar el sistema.

---

## 15. Resumen ejecutivo

Se requiere integrar **Football DB** como fuente exclusiva para la **Liga Uruguaya**, manteniendo la **API actual** para el resto de las ligas ya soportadas. La solución debe implementarse de forma controlada, mediante una capa central de resolución de proveedor y adaptación de datos, evitando que diferencias entre APIs externas afecten la estructura actual del sistema.

La integración deberá obtener los datos desde Football DB y transformarlos al formato interno ya existente, de modo que el sistema continúe funcionando de forma estable, uniforme y sin errores visibles para el usuario.

---

## 16. Versión breve para pasar al equipo

**Se debe integrar Football DB únicamente para la Liga Uruguaya y mantener la API actual para el resto de las ligas. La decisión del proveedor debe resolverse en backend mediante una capa centralizada por competición. Las respuestas de Football DB deben ser adaptadas a la estructura actual del sistema, sin modificar el contrato que hoy consume el frontend. La implementación debe evitar condicionales dispersos, contemplar cache, manejo de errores y mantener consistencia total entre ambas fuentes.**
