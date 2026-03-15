# **SportPulse — Especificación de sección de noticias por liga**

**Versión:** 1.0  
 **Estado:** Aprobado para implementación MVP  
 **Idioma:** Español  
 **Objetivo:** Integrar una sección simple de noticias diarias en el portal de resultados, mostrando únicamente titulares relevantes por liga con imagen y enlace externo, sin guardar histórico y sin replicar contenido editorial.

---

# **1\. Objetivo funcional**

Agregar una sección **Noticias** al portal que muestre noticias del día para:

* Fútbol uruguayo  
* LaLiga  
* Premier League  
* Bundesliga

La sección debe ser **simple, clara y liviana**:

* mostrar imagen  
* mostrar título  
* mostrar fuente  
* mostrar fecha/hora  
* permitir abrir el enlace externo a la nota original

No se debe:

* copiar el contenido de la nota  
* resumir la nota con IA  
* guardar histórico de noticias  
* construir un portal editorial propio  
* mezclar noticias políticas o generales del país

---

# **2\. Alcance**

## **Incluido**

* Noticias del día por liga  
* Consumo de fuentes externas  
* Filtrado por relevancia básica  
* Deduplicación  
* Límite de noticias por liga  
* Actualización automática periódica  
* Vista simple de listado o tarjetas

## **Excluido**

* Histórico de noticias  
* Base de datos de archivo permanente  
* Sistema editorial interno  
* Noticias antiguas  
* Contenido completo de artículos  
* Resúmenes automáticos  
* Comentarios, likes o interacción social  
* AUF como fuente  
* Otras ligas no definidas en este documento

---

# **3\. Fuentes aprobadas**

## **3.1 Uruguay**

**Fuente única aprobada:** RSS de **El Observador**

Regla:

* Para Uruguay **solo** se consume RSS de El Observador  
* No se consume AUF  
* No se consume otra fuente local en esta versión  
* No se mezcla con GNews para Uruguay

## **3.2 LaLiga, Premier League y Bundesliga**

**Fuente única aprobada:** **GNews**

Regla:

* Para estas tres ligas se usa únicamente GNews  
* No se integran feeds oficiales de las ligas en esta versión  
* No se agregan otras APIs de noticias en esta etapa

---

# **4\. Prioridad de negocio**

La sección de noticias debe respetar este orden de importancia dentro del portal:

1. **Uruguay**  
2. **LaLiga**  
3. **Premier League**  
4. **Bundesliga**

Esto implica:

* el bloque de Uruguay debe aparecer primero  
* el bloque de LaLiga debe tener mayor relevancia visual que Premier y Bundesliga  
* no se debe mezclar todo en un solo feed sin separación por liga

---

# **5\. Reglas de contenido por liga**

## **5.1 Uruguay**

### **Cobertura**

Se deben mostrar **todas las noticias válidas del día** relacionadas con el fútbol uruguayo que vengan en el RSS de El Observador.

### **Cantidad**

* mostrar todas las noticias válidas del día  
* aplicar tope de seguridad de **10 noticias**

### **Restricción**

* no filtrar por clubes top  
* no limitar por posiciones de tabla  
* como el volumen es menor, se acepta cubrir todo el fútbol uruguayo del día

---

## **5.2 LaLiga**

### **Cobertura**

Se deben mostrar noticias del día relacionadas con:

* la competencia LaLiga en general  
* equipos priorizados de la liga

### **Cantidad**

* máximo **5 noticias**

### **Priorización**

* priorizar noticias de la liga o de equipos en posiciones **1 a 5**  
* excluir noticias del resto de equipos en esta versión, salvo que la noticia sea claramente de interés general de la competencia

---

## **5.3 Premier League**

### **Cobertura**

Se deben mostrar noticias del día relacionadas con:

* la competencia Premier League en general  
* equipos priorizados de la liga

### **Cantidad**

* máximo **5 noticias**

### **Priorización**

* priorizar noticias de la liga o de equipos en posiciones **1 a 5**

---

## **5.4 Bundesliga**

### **Cobertura**

Se deben mostrar noticias del día relacionadas con:

* la competencia Bundesliga en general  
* equipos priorizados de la liga

### **Cantidad**

* máximo **5 noticias**

### **Priorización**

* priorizar noticias de la liga o de equipos en posiciones **1 a 5**

---

# **6\. Regla de priorización por standings**

Para LaLiga, Premier League y Bundesliga, la lista de equipos priorizados debe definirse usando la tabla actual de cada liga.

## **Regla principal**

Tomar equipos ubicados en posiciones:

* 1  
* 2  
* 3  
* 4  
* 5

## **Motivo**

Esto evita hardcodear “equipos grandes” de forma arbitraria y mantiene el criterio alineado con la competición actual.

## **Implementación**

La lista de equipos priorizados debe resolverse en backend usando la tabla de posiciones ya disponible en el sistema.

**No debe resolverse en frontend.**

---

# **7\. Excepción por inicio de torneo**

La tabla puede ser engañosa cuando se jugaron muy pocas fechas.

## **Regla de excepción**

Si una liga tiene **menos de 5 fechas jugadas**, no se debe depender exclusivamente de la tabla actual.

En ese caso, usar una lista fija de 5 equipos prioritarios por liga.

## **Listas fijas temporales sugeridas**

### **LaLiga**

* Real Madrid  
* Barcelona  
* Atlético de Madrid  
* Sevilla  
* Real Sociedad

### **Premier League**

* Manchester City  
* Liverpool  
* Arsenal  
* Chelsea  
* Manchester United

### **Bundesliga**

* Bayern München  
* Borussia Dortmund  
* Bayer Leverkusen  
* RB Leipzig  
* Stuttgart

## **Regla de cambio**

A partir de la **fecha 5 inclusive**, el sistema pasa automáticamente a la lógica dinámica por standings.

---

# **8\. Filtro anti-política obligatorio**

La sección de noticias **no debe mostrar noticias de elecciones nacionales, gobierno ni política general** del país.

Esto aplica especialmente a GNews, que puede devolver ruido no deportivo.

## **Regla**

Si el título o el snippet contiene términos políticos bloqueados, la noticia debe ser excluida.

## **Blacklist mínima obligatoria**

* elecciones  
* elecciones nacionales  
* presidenciales  
* candidato  
* campaña electoral  
* parlamento  
* congreso  
* senado  
* diputado  
* senador  
* gobierno  
* ministerio  
* ministro  
* partido político  
* coalición  
* intendencia  
* alcalde  
* presidente de la república

## **Observación**

No bloquear la palabra **presidente** sola, porque puede aparecer en contexto deportivo de clubes o federaciones.

---

# **9\. Regla de inclusión de noticias**

Una noticia entra en el feed solo si cumple todas estas condiciones:

1. fue publicada hoy  
2. pertenece a la liga correcta  
3. menciona la liga o un equipo priorizado  
4. no contiene términos políticos bloqueados  
5. no está duplicada  
6. tiene título y enlace válidos

---

# **10\. Definición de “noticias del día”**

## **Regla**

Una noticia se considera válida si su fecha de publicación es:

* mayor o igual a `hoy 00:00:00`  
* menor o igual a `ahora`

La comparación debe hacerse en la zona horaria del sistema definida para el portal.

## **Recomendación**

Normalizar siempre fechas a UTC internamente y convertir para visualización según la zona configurada del sistema.

---

# **11\. Deduplicación**

Las fuentes pueden devolver noticias repetidas o casi repetidas.

## **Regla mínima**

Deduplicar por:

* `normalizedTitle`  
* dominio de origen

## **Normalización sugerida**

* pasar a minúsculas  
* eliminar tildes  
* colapsar espacios  
* quitar puntuación irrelevante

## **Comportamiento**

Si hay dos noticias duplicadas:

* conservar la más reciente  
* o conservar la que tenga imagen válida si una de ellas no tiene imagen

---

# **12\. Ordenamiento**

## **Dentro de cada liga**

Ordenar por:

1. fecha de publicación descendente  
2. relevancia de coincidencia con liga/equipo priorizado  
3. existencia de imagen

## **Entre ligas**

Mantener bloques separados con este orden fijo:

1. Uruguay  
2. LaLiga  
3. Premier League  
4. Bundesliga

---

# **13\. Límite de cantidad por liga**

## **Uruguay**

* todas las noticias válidas del día  
* máximo **10**

## **LaLiga**

* máximo **5**

## **Premier League**

* máximo **5**

## **Bundesliga**

* máximo **5**

---

# **14\. Modelo de datos canónico**

El backend debe transformar todas las fuentes a un formato interno común.

## **NewsHeadline**

```ts
type NewsHeadline = {
  id: string
  leagueKey: 'URU' | 'LL' | 'EPL' | 'BUN'
  title: string
  url: string
  imageUrl: string | null
  sourceName: string
  publishedAtUtc: string
  teamKeys?: string[]
  competitionLabel: string
}
Campos obligatorios
id

leagueKey

title

url

sourceName

publishedAtUtc

competitionLabel

Campos opcionales
imageUrl

teamKeys

15. Mapeo de fuentes al modelo canónico
El Observador RSS → NewsHeadline
Mapear:

título del item → title

link del item → url

imagen del item o media asociada → imageUrl

nombre de fuente fijo → sourceName = "El Observador"

fecha de publicación → publishedAtUtc

leagueKey = "URU"

competitionLabel = "Fútbol uruguayo"

GNews → NewsHeadline
Mapear:

title → title

url → url

image → imageUrl

source.name → sourceName

publishedAt → publishedAtUtc

liga consultada → leagueKey

etiqueta visible de liga → competitionLabel

16. Queries base sugeridas para GNews
Estas queries son base. El backend puede refinarlas sin alterar la lógica funcional.

LaLiga
("LaLiga" OR "Liga española" OR "LALIGA EA SPORTS" OR "Real Madrid" OR "Barcelona" OR "Atlético de Madrid")
Premier League
("Premier League" OR "Manchester City" OR "Liverpool" OR "Arsenal" OR "Chelsea" OR "Manchester United")
Bundesliga
("Bundesliga" OR "Bayern München" OR "Borussia Dortmund" OR "Bayer Leverkusen" OR "RB Leipzig")
Regla adicional
Cuando la tabla ya esté disponible y supere la fecha 5, reemplazar los equipos fijos por los equipos top 5 reales de esa liga.

17. Caché y actualización
La sección no debe construir histórico, pero sí necesita caché temporal para no castigar las fuentes.

Regla
caché por liga: 30 a 60 minutos

refresco automático al vencer caché

no guardar noticias viejas al día siguiente

Comportamiento al cambio de día
Al comenzar un nuevo día:

invalidar resultados del día anterior

reconstruir desde fuente

18. Fallbacks
Si falla GNews en una liga
devolver lista vacía para esa liga

no bloquear el resto del portal

mostrar estado de vacío controlado en frontend

Si falla El Observador RSS
devolver lista vacía para Uruguay

no intentar AUF ni otra fuente en esta versión

Si una noticia no tiene imagen
permitir mostrar tarjeta con imagen placeholder

no descartar la noticia solo por falta de imagen

19. Reglas de frontend
Vista
La UI puede ser grid o lista, pero cada item debe incluir:

imagen

título

fuente

fecha/hora

enlace externo

Restricciones
no mostrar resumen largo

no mostrar contenido del artículo

no abrir contenido embebido

preferible abrir enlace en nueva pestaña

Bloques
El frontend debe presentar las noticias agrupadas por liga, no mezcladas en un solo stream continuo.

20. Estados de interfaz
Estado con datos
Mostrar noticias agrupadas por liga.

Estado vacío de una liga
Mostrar texto simple:

“No hay noticias disponibles hoy para esta liga.”

Estado de error parcial
Si falla una fuente:

mostrar mensaje discreto en ese bloque

no afectar el resto de las ligas

Estado de carga
skeleton simple o placeholder

no bloquear toda la pantalla

21. Requisitos no funcionales
Simplicidad
La solución debe ser sencilla de mantener y entender.

Aislamiento
La lógica de noticias debe vivir separada de la lógica de resultados, fixtures o standings.

Tolerancia a fallos
La caída de una fuente no debe impactar las otras.

Escalabilidad controlada
La arquitectura debe permitir agregar más fuentes en el futuro sin romper el modelo canónico.

Licenciamiento
Solo se deben mostrar metadatos mínimos y el enlace al contenido original.

22. Fuera de alcance en esta versión
No implementar en esta versión:

histórico

bookmarking

compartir

noticias por jugador

noticias por partido individual

ranking de popularidad por clics

panel editorial

curación manual

IA para resumen o clasificación semántica compleja

mezcla de más fuentes por liga

23. Criterio de aceptación
La funcionalidad se considera aceptada cuando:

existe una sección Noticias visible en el portal

Uruguay consume exclusivamente El Observador RSS

LaLiga, Premier y Bundesliga consumen exclusivamente GNews

solo aparecen noticias del día

no aparecen noticias políticas o de elecciones nacionales

LaLiga, Premier y Bundesliga muestran solo noticias de la liga o equipos priorizados

Uruguay muestra todas las noticias válidas del día hasta un máximo de 10

LaLiga, Premier y Bundesliga muestran como máximo 5 noticias cada una

las noticias se muestran con imagen, título, fuente, fecha/hora y link

no existe histórico persistente de noticias

24. Resumen ejecutivo final
Decisión cerrada
Uruguay: El Observador RSS

LaLiga: GNews

Premier League: GNews

Bundesliga: GNews

Reglas clave
solo noticias del día

sin histórico

sin AUF

sin política nacional

Uruguay muestra todo el fútbol uruguayo válido del día

el resto de las ligas muestra solo noticias de la liga y equipos top 5

máximo 5 noticias por liga, excepto Uruguay con máximo 10

Prioridad visual y de negocio
Uruguay

LaLiga

Premier League

Bundesliga
```

