# Radar editorial copy library rioplatense — versión expandida (DEPRECATED — v2)

> **Esta versión está deprecada.** La versión activa es v3.
> Ver `radar-editorial-copy-v3-dev-notes.md` y `radar-editorial-copy-library-rioplatense-v3.json`.

---

# Radar editorial copy library rioplatense — versión expandida

## Qué cambia respecto a la versión anterior

La librería anterior tenía **102 frases base** y se estaba quedando corta en implementación real: demasiada repetición de cadencia, pocos contextos y poco margen de rotación.

Esta versión nueva sube a **264 frases base** y agrega:

- más contextos por etiqueta
- más rotación por tono (`sobrio`, `picante`, `venenoso`)
- más maldad e ironía
- más remates opcionales
- más aire para no sonar al mismo locutor cada tres cards

## Conteo por etiqueta

- **senal_de_alerta**: **44** frases
- **partido_enganoso**: **44** frases
- **partido_abierto**: **44** frases
- **duelo_cerrado**: **44** frases
- **bajo_el_radar**: **44** frases
- **cruce_pesado**: **44** frases

### Total
- **264 frases base**
- **16 remates opcionales**

## Estructura recomendada de selección

1. Resolver `label`
2. Resolver `context`
3. Elegir `tone` según partido o configuración
4. Filtrar templates no usados recientemente
5. Renderizar template base
6. Inyectar remate opcional solo cuando convenga

## Reglas prácticas

- No repetir el mismo template dentro de la misma jornada.
- No repetir el mismo template en las últimas 24 generaciones.
- Si se repite la misma etiqueta, preferir cambiar de `context`.
- No abusar del tono `venenoso`; funciona mejor como puñalada selectiva.
- El remate es condimento, no obligación.

## Recomendación brutal

Todavía esto se puede ampliar más si el producto vive meses y querés evitar desgaste. Pero esta base ya debería dejar de sonar repetitiva en un proyecto chico y te da bastante más variedad que la primera versión.
