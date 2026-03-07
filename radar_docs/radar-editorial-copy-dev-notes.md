# Radar editorial copy library — notas de desarrollo (DEPRECATED — v1)

> **Esta versión está deprecada.** La versión activa es v3.
> Ver `radar-editorial-copy-v3-dev-notes.md` y `radar-editorial-copy-library-rioplatense-v3.json`.

---

## Qué incluye
Esta librería trae copy editorial rioplatense para Radar SportPulse en dos formatos:
- YAML
- JSON

## Estructura
- `labels[label_key].contexts[]`: contextos jugables por etiqueta
- `templates[]`: frases listas para render
- `tone`: `sobrio`, `picante`, `venenoso`
- `remate_fragments`: cierres opcionales para mezclar de forma controlada

## Uso recomendado

### 1. Resolver señal y contexto
Primero el motor decide:
- `label`
- `context`
- `toneLevel`

Ejemplo:
- `label = partido_enganoso`
- `context = table_lies`
- `toneLevel = picante`

### 2. Buscar templates compatibles
Filtrar:
- `labels[label].contexts[key=context].templates`
- `tone == toneLevel` o fallback de tono cercano

### 3. Aplicar rotación
Bloquear:
- mismo template en la misma jornada
- mismo template dentro de las últimas 12 generaciones
- exceso de remates

### 4. Mezcla opcional
Para no sonar mecánico:
- 65% usar template base tal cual
- 35% usar template base + remate compatible

Ejemplo:
- Base: `Lo venden como trámite y tiene pinta de embarrarse rápido.`
- Remate: `Y eso en fútbol casi nunca sale gratis.`

Render:
- `Lo venden como trámite y tiene pinta de embarrarse rápido. Y eso en fútbol casi nunca sale gratis.`

## Reglas sanas
- no usar remate en todas las cards
- no meter `venenoso` en masa en jornadas normales
- reservar `venenoso` para señales fuertes
- no mezclar humor negro con partidos que no tengan tensión real

## Mapeo rápido de tono
- `sobrio`: partidos normales o secciones más limpias
- `picante`: default recomendado
- `venenoso`: para contradicción fuerte, favorito flojo, partido traicionero o duelo muy áspero

## Recomendación de producto
- `senal_de_alerta` y `partido_enganoso` toleran mejor `venenoso`
- `partido_abierto` tolera `picante` y `venenoso`
- `duelo_cerrado` tolera humor negro de sufrimiento
- `bajo_el_radar` funciona mejor en `picante`
- `cruce_pesado` conviene no exagerarlo salvo que el contexto lo justifique
