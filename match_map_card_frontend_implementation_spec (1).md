# MatchMapCard — Especificación de implementación frontend completa

Versión: 1.0  
Estado: Ready for implementation  
Componente: `MatchMapCard`  
Contexto: vista de mapa / cards compactas de partido

---

# 1. Objetivo

`MatchMapCard` representa un único partido dentro de la interfaz de mapa y debe permitir lectura inmediata, escaneo rápido y consistencia visual en un contexto con múltiples tarjetas simultáneas.

La tarjeta debe comunicar, en este orden:

1. quién juega de local,
2. quién juega de visitante,
3. el enfrentamiento visual entre ambos,
4. el score o resultado proyectado,
5. el estado resumido del partido,
6. cuándo se juega,
7. qué tan relevante/interesante está siendo el partido.

No es una card de equipo. Es una card de partido.

---

# 2. Alcance

Esta especificación cubre:

- props del componente,
- reglas de contenido,
- layout,
- jerarquía visual,
- spacing tokens,
- tamaños,
- tipografía,
- responsive behavior,
- estados visuales,
- accesibilidad,
- fallbacks,
- reglas de interacción,
- criterios de aceptación,
- criterios de prueba UI,
- casos borde.

Esta especificación no cubre:

- lógica de negocio para calcular `interestPercent`,
- algoritmo que define `formLabel`,
- estrategia de clustering en mapa,
- fetching de datos,
- animaciones avanzadas fuera de hover/focus/select.

---

# 3. Reglas conceptuales innegociables

1. La tarjeta representa un partido, no un equipo.
2. Deben verse siempre ambos equipos en la cabecera.
3. Deben verse siempre ambos escudos en la zona central.
4. El nombre del local va arriba a la izquierda.
5. El nombre del visitante va arriba a la derecha.
6. El escudo visitante va a la izquierda del bloque central.
7. El escudo local va a la derecha del bloque central.
8. El score va debajo de los escudos.
9. El estado textual va debajo del score.
10. El timeline va abajo a la izquierda.
11. El porcentaje de interés va abajo a la derecha.
12. No se puede volver a usar la lógica de “equipo más buscado” como encabezado.

---

# 4. API del componente

## 4.1 Tipos

```ts
export type MatchFormLabel = 'VIENE_BIEN' | 'VIENE_PICANTE' | 'NORMAL';

export type MatchMapCardTeam = {
  id: string;
  name: string;
  shortName?: string;
  crestUrl?: string | null;
};

export type MatchMapCardScore = {
  home: number | null;
  away: number | null;
  display?: string;
};

export type MatchMapCardKickoff = {
  utc: string;
  relativeLabel?: string;
};

export type MatchMapCardProps = {
  matchId: string;

  homeTeam: MatchMapCardTeam;
  awayTeam: MatchMapCardTeam;

  score?: MatchMapCardScore | null;
  formLabel?: MatchFormLabel | null;
  kickoff?: MatchMapCardKickoff | null;
  interestPercent?: number | null;

  onClick?: () => void;
  isSelected?: boolean;
  isLoading?: boolean;
  disabled?: boolean;

  className?: string;
  testId?: string;
};
```

---

## 4.2 Semántica de props

### `matchId`
Identificador único del partido. Obligatorio.

### `homeTeam`
Equipo local. Obligatorio.

### `awayTeam`
Equipo visitante. Obligatorio.

### `score`
Score visible o proyección visible.

Resolución:
1. Si existe `score.display`, usarlo.
2. Si no existe `display` y existen `home` y `away`, usar `${home} - ${away}`.
3. Si no existe score usable, renderizar `vs`.

### `formLabel`
Label resumido del partido.

Valores permitidos:
- `VIENE_BIEN`
- `VIENE_PICANTE`
- `NORMAL`

Fallback:
- si falta, usar `NORMAL`

### `kickoff`
Contiene fecha UTC y label relativo.
El componente no debe recalcular el label si ya viene resuelto.

Fallback:
- si falta `relativeLabel`, mostrar `Próximamente`

### `interestPercent`
Entero de `0` a `100`.

Reglas:
- redondear si llega decimal,
- clamplear si llega fuera de rango,
- mostrar como `%`,
- fallback `—%` si falta.

### `onClick`
Si existe, la tarjeta completa debe ser interactiva.

### `isSelected`
Marca visualmente una tarjeta seleccionada.

### `isLoading`
Renderiza skeleton UI.

### `disabled`
Desactiva interacción.

### `testId`
Permite instrumentación de tests.

---

# 5. Selectores y estructura DOM recomendada

```tsx
<article
  data-testid={testId ?? 'match-map-card'}
  data-match-id={matchId}
  data-selected={isSelected ? 'true' : 'false'}
  data-loading={isLoading ? 'true' : 'false'}
  data-disabled={disabled ? 'true' : 'false'}
>
  <header data-testid="match-map-card-header">
    <div data-testid="match-map-card-home-name">...</div>
    <div data-testid="match-map-card-away-name">...</div>
  </header>

  <section data-testid="match-map-card-crests">
    <div data-testid="match-map-card-away-crest">...</div>
    <div data-testid="match-map-card-home-crest">...</div>
  </section>

  <section data-testid="match-map-card-score">...</section>

  <section data-testid="match-map-card-status">...</section>

  <footer data-testid="match-map-card-footer">
    <div data-testid="match-map-card-kickoff">...</div>
    <div data-testid="match-map-card-interest">...</div>
  </footer>
</article>
```

---

# 6. Modelo de contenido visible

## 6.1 Nombres de equipos

Resolver así:

```ts
const homeName = homeTeam.shortName ?? homeTeam.name ?? '—';
const awayName = awayTeam.shortName ?? awayTeam.name ?? '—';
```

Reglas:
- preferir `shortName`,
- una línea,
- truncado con ellipsis,
- nunca salto de línea,
- nunca ocultar uno de los equipos.

---

## 6.2 Escudos

Resolver así:
- `awayTeam.crestUrl` a la izquierda,
- `homeTeam.crestUrl` a la derecha,
- si falta uno o ambos, usar placeholder neutral.

No debe romperse el layout si falta un escudo.

---

## 6.3 Score visible

Resolver así:

```ts
function resolveScoreDisplay(score?: MatchMapCardScore | null): string {
  if (score?.display && score.display.trim()) return score.display.trim();
  if (
    typeof score?.home === 'number' &&
    typeof score?.away === 'number'
  ) {
    return `${score.home} - ${score.away}`;
  }
  return 'vs';
}
```

---

## 6.4 Label visible

```ts
const FORM_LABEL_TEXT: Record<MatchFormLabel, string> = {
  VIENE_BIEN: 'Viene bien',
  VIENE_PICANTE: 'Viene picante',
  NORMAL: 'Normal',
};
```

No admitir variantes libres.

---

## 6.5 Timeline visible

Resolver así:

```ts
const kickoffLabel = kickoff?.relativeLabel?.trim() || 'Próximamente';
```

---

## 6.6 Porcentaje visible

Resolver así:

```ts
function resolveInterestDisplay(value?: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—%';
  const normalized = Math.max(0, Math.min(100, Math.round(value)));
  return `${normalized}%`;
}
```

---

# 7. Layout exacto

## 7.1 Estructura vertical

Orden obligatorio:

1. Header row
2. Crest row
3. Score row
4. Status row
5. Footer row

No insertar bloques intermedios.

---

## 7.2 Header row

Contenido:
- izquierda: `homeName`
- derecha: `awayName`

Layout:
- una única fila,
- justify-content: space-between,
- align-items: center,
- ambos nombres sobre la misma línea.

Regla crítica:
- no centrar ambos nombres,
- no apilarlos,
- no ocultar el visitante.

---

## 7.3 Crest row

Contenido:
- crest visitante izquierda
- crest local derecha

Layout:
- fila centrada,
- ambos escudos alineados verticalmente,
- separación fija y controlada.

---

## 7.4 Score row

Contenido:
- score visible

Layout:
- centrado,
- una sola línea,
- alto impacto visual.

---

## 7.5 Status row

Contenido:
- label visible

Layout:
- centrado,
- debajo del score,
- no debe competir visualmente con el score.

---

## 7.6 Footer row

Contenido:
- izquierda: timeline
- derecha: percentage

Layout:
- una sola fila,
- justify-content: space-between,
- align-items: center.

---

# 8. Dimensiones y tokens

## 8.1 Tamaño base de tarjeta

Para uso en mapa, definir como componente compacto.

### Default
- width: `248px`
- min-height: `156px`
- max-width: `248px`

### Responsive narrow
- width: `220px`
- min-height: `148px`

### Large map card
- width: `264px`
- min-height: `164px`

Si el sistema ya usa tokens de card width, mapear estos valores a tokens equivalentes.

---

## 8.2 Padding interno

### Default
- padding-inline: `12px`
- padding-block: `10px`

### Compact
- padding-inline: `10px`
- padding-block: `8px`

No bajar de eso o el componente pierde aire y legibilidad.

---

## 8.3 Border radius
- border-radius: `14px`

## 8.4 Border
- `1px solid var(--border-subtle)`

## 8.5 Shadow
- `0 2px 10px rgba(0,0,0,0.08)` en estado default
- `0 4px 16px rgba(0,0,0,0.12)` en hover/select si corresponde al sistema

---

# 9. Spacing interno exacto

## Vertical spacing recomendado
- Header → Crests: `10px`
- Crests → Score: `8px`
- Score → Status: `4px`
- Status → Footer: `10px`

## Horizontal spacing recomendado
- Entre escudos: `12px`
- Entre nombre izquierdo y borde interno: por padding del card
- Entre nombre derecho y borde interno: por padding del card

---

# 10. Tamaños de elementos

## 10.1 Escudos
Default:
- container width: `36px`
- container height: `36px`

Large:
- `40px x 40px`

Compact:
- `32px x 32px`

Reglas:
- ambos escudos con mismo contenedor,
- object-fit: contain,
- centrar asset dentro del contenedor.

---

## 10.2 Score
- font-size: `20px`
- line-height: `24px`
- font-weight: `700`

Compact:
- font-size: `18px`
- line-height: `22px`

---

## 10.3 Status
- font-size: `12px`
- line-height: `16px`
- font-weight: `500`

---

## 10.4 Footer
Timeline:
- font-size: `11px`
- line-height: `14px`
- font-weight: `500`

Interest:
- font-size: `12px`
- line-height: `16px`
- font-weight: `700`

---

## 10.5 Team names
- font-size: `12px`
- line-height: `16px`
- font-weight: `600`

Compact:
- `11px / 14px`

Large:
- `13px / 17px`

---

# 11. Tipografía y jerarquía visual

Orden de peso visual:

1. Score
2. Team names
3. Crests
4. Status
5. Interest percent
6. Timeline

Regla:
- el porcentaje no debe competir con el score,
- el estado no debe parecer título,
- el timeline debe ser claramente metadata secundaria.

---

# 12. Colores recomendados

Usar tokens del sistema. No hardcodear salvo prototipo.

## Surface
- background: `var(--surface-card)`
- border: `var(--border-subtle)`

## Text
- nombres: `var(--text-primary)`
- score: `var(--text-primary)`
- status: `var(--text-secondary)`
- timeline: `var(--text-tertiary)`
- interest: `var(--text-primary)`

## Selected
- border: `var(--accent-strong)`
- ring / outline opcional: `var(--accent-soft)`

## Hover
- elevar levemente contraste del borde o sombra
- no cambiar jerarquía ni color semántico del contenido

---

# 13. Responsive behavior

## 13.1 Breakpoints sugeridos

### `>= 768px`
Usar default card.

### `560px – 767px`
Puede mantenerse default si el mapa lo soporta.

### `< 560px`
Usar compact variant.

---

## 13.2 Comportamiento responsive

En pantallas más pequeñas:
- reducir padding,
- reducir escudos,
- reducir font-size de nombres y score levemente,
- mantener la misma jerarquía,
- no apilar header,
- no mover footer a dos líneas salvo emergencia extrema del contenedor padre.

---

## 13.3 Restricción importante
El componente no debe depender de multiline wrapping para sobrevivir.  
Si necesita dos líneas para nombres, el ancho de tarjeta está mal definido o faltan `shortName`.

---

# 14. Estados visuales

## 14.1 Default
- contenido completo,
- borde base,
- shadow base,
- cursor default o pointer según clickable.

## 14.2 Hover
Solo si `onClick` y no `disabled`.

Cambios permitidos:
- ligera elevación,
- leve énfasis de borde,
- transición suave `120–180ms`.

Cambios prohibidos:
- reflow,
- resize,
- mover contenido,
- escalar score o escudos.

## 14.3 Focus visible
Si clickable:
- outline visible accesible,
- no depender solo de color,
- respetar contraste.

## 14.4 Selected
Cambios permitidos:
- borde más fuerte,
- sombra algo más marcada,
- leve cambio de fondo si el sistema lo permite.

Cambios prohibidos:
- alterar posiciones,
- alterar orden,
- ocultar footer,
- cambiar tamaño del card.

## 14.5 Disabled
- opacidad reducida moderada,
- sin hover,
- sin interacción,
- cursor not-allowed opcional según sistema.

## 14.6 Loading
Skeleton con estructura equivalente al contenido real.

Debe haber skeleton para:
- header left/right
- crest left/right
- score
- status
- footer left/right

No usar spinner en reemplazo del layout.

---

# 15. Fallbacks y datos faltantes

## 15.1 Missing home team name
Mostrar `—`

## 15.2 Missing away team name
Mostrar `—`

## 15.3 Missing crest
Mostrar placeholder neutral.

## 15.4 Missing score
Mostrar `vs`

## 15.5 Missing formLabel
Mostrar `Normal`

## 15.6 Missing kickoff label
Mostrar `Próximamente`

## 15.7 Missing interest percent
Mostrar `—%`

## 15.8 Valores corruptos
- `interestPercent < 0` → `0%`
- `interestPercent > 100` → `100%`
- `interestPercent = 78.7` → `79%`

---

# 16. Accesibilidad

## 16.1 Semántica
- usar `article` para la card,
- `header` y `footer` donde aplique,
- si la tarjeta es clickable, considerar `button` semantics o `role="button"` según contexto.

## 16.2 Navegación por teclado
Si clickable:
- debe recibir foco,
- Enter y Space deben activar `onClick` si se implementa con role/button.

## 16.3 Labels accesibles
Agregar `aria-label` consolidado.

Ejemplo:

```ts
`Partido ${homeName} contra ${awayName}. Score ${scoreDisplay}. Estado ${statusText}. ${kickoffLabel}. Interés ${interestDisplay}.`
```

## 16.4 Contraste
Debe cumplir al menos contraste AA para:
- nombres,
- score,
- footer,
- focus outline.

---

# 17. Reglas de implementación CSS

## 17.1 Reglas obligatorias
- `box-sizing: border-box`
- truncado con `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`
- escudos con contenedor fijo
- footer en una sola fila
- score y status centrados

## 17.2 Reglas prohibidas
- usar posicionamiento absoluto para layout principal,
- hacer overlap de footer con el contenido,
- usar transform scale en hover que altere anchura efectiva,
- multiline wrapping en nombres como solución principal.

---

# 18. Subcomponentes recomendados

```tsx
<MatchMapCard>
  <MatchMapCardHeader />
  <MatchMapCardCrests />
  <MatchMapCardScore />
  <MatchMapCardStatus />
  <MatchMapCardFooter />
</MatchMapCard>
```

## Responsabilidades

### `MatchMapCardHeader`
- renderiza `homeName` izquierda
- renderiza `awayName` derecha
- aplica truncado

### `MatchMapCardCrests`
- renderiza crest visitante izquierda
- renderiza crest local derecha
- normaliza tamaños

### `MatchMapCardScore`
- renderiza `scoreDisplay`

### `MatchMapCardStatus`
- renderiza `statusText`

### `MatchMapCardFooter`
- renderiza `kickoffLabel` izquierda
- renderiza `interestDisplay` derecha

---

# 19. Reglas de testeo visual

## 19.1 Casos base
1. render completo con datos correctos,
2. score desde `display`,
3. score desde `home/away`,
4. score fallback `vs`,
5. nombres largos con ellipsis,
6. escudo faltante local,
7. escudo faltante visitante,
8. `interestPercent` faltante,
9. `interestPercent` decimal,
10. `interestPercent` fuera de rango,
11. `formLabel` faltante,
12. `kickoff.relativeLabel` faltante,
13. estado loading,
14. estado selected,
15. estado disabled.

---

## 19.2 Assertions recomendadas
- header siempre contiene dos nombres,
- local a la izquierda, visitante a la derecha,
- crest local a la derecha del visitante,
- footer siempre tiene timeline y porcentaje,
- no aparece nunca “equipo más buscado”,
- no aparece nunca solo un nombre de equipo si ambos existen.

---

# 20. Casos borde

## Caso A — nombres muy largos
Ejemplo:
- `Club Deportivo Atlético Metropolitano de no sé qué`
- `Asociación Deportiva Internacional de no sé cuánto`

Resultado esperado:
- truncado con ellipsis,
- layout intacto,
- footer intacto.

## Caso B — score no disponible
Resultado esperado:
- `vs`,
- sin huecos raros,
- status y footer siguen presentes.

## Caso C — faltan ambos escudos
Resultado esperado:
- placeholders simétricos,
- score sigue presente,
- layout no colapsa.

## Caso D — label inválido
Si llega un valor fuera de enum desde capa insegura:
- fallback a `Normal`.

## Caso E — tarjeta no clickable
- sin hover interactivo,
- sin cursor pointer,
- sin role button.

---

# 21. Criterios de aceptación funcionales

## CA-01
La tarjeta muestra siempre ambos nombres de equipos en la fila superior.

## CA-02
El nombre del local está arriba a la izquierda.

## CA-03
El nombre del visitante está arriba a la derecha.

## CA-04
Los escudos de ambos equipos se muestran en la zona central.

## CA-05
El escudo del visitante se renderiza a la izquierda y el del local a la derecha.

## CA-06
El score aparece debajo del bloque de escudos.

## CA-07
El status aparece debajo del score.

## CA-08
El timeline aparece abajo a la izquierda.

## CA-09
El porcentaje aparece abajo a la derecha.

## CA-10
El porcentaje representa interés del partido y no reemplaza identidad del match.

## CA-11
La tarjeta no usa el criterio “equipo más buscado” para definir la cabecera.

## CA-12
La tarjeta conserva legibilidad con nombres largos mediante truncado.

## CA-13
La tarjeta conserva estructura cuando faltan score, escudos o interés.

## CA-14
La tarjeta tiene focus visible cuando es interactiva.

## CA-15
La tarjeta mantiene el layout estable entre estados default, hover, selected y loading.

---

# 22. Ejemplo de props válidos

```ts
const exampleProps: MatchMapCardProps = {
  matchId: 'match_001',
  homeTeam: {
    id: 'atm',
    name: 'Atlético Madrid',
    shortName: 'Atlético',
    crestUrl: '/crests/atm.png',
  },
  awayTeam: {
    id: 'sev',
    name: 'Sevilla',
    shortName: 'Sevilla',
    crestUrl: '/crests/sev.png',
  },
  score: {
    home: 2,
    away: 1,
  },
  formLabel: 'VIENE_PICANTE',
  kickoff: {
    utc: '2026-03-08T20:00:00Z',
    relativeLabel: 'Hoy en 5 horas',
  },
  interestPercent: 78,
  isSelected: false,
  isLoading: false,
};
```

---

# 23. Ejemplo de render esperado

```txt
Atlético                    Sevilla
[escudo sevilla] [escudo atlético]
                2 - 1
           Viene picante
Hoy en 5 horas                 78%
```

---

# 24. Pseudocódigo de implementación

```ts
const homeName = homeTeam.shortName ?? homeTeam.name ?? '—';
const awayName = awayTeam.shortName ?? awayTeam.name ?? '—';

const scoreDisplay = resolveScoreDisplay(score);

const safeFormLabel: MatchFormLabel =
  formLabel === 'VIENE_BIEN' ||
  formLabel === 'VIENE_PICANTE' ||
  formLabel === 'NORMAL'
    ? formLabel
    : 'NORMAL';

const statusText = FORM_LABEL_TEXT[safeFormLabel];

const kickoffLabel = kickoff?.relativeLabel?.trim() || 'Próximamente';
const interestDisplay = resolveInterestDisplay(interestPercent);
```

---

# 25. Checklist para QA

- [ ] Se ven ambos nombres arriba.
- [ ] Local izquierda, visitante derecha.
- [ ] Escudos en orden correcto.
- [ ] Score debajo de escudos.
- [ ] Status debajo del score.
- [ ] Timeline abajo izquierda.
- [ ] Porcentaje abajo derecha.
- [ ] Nombres largos no rompen layout.
- [ ] Sin score muestra `vs`.
- [ ] Sin interés muestra `—%`.
- [ ] Sin kickoff label muestra `Próximamente`.
- [ ] Loading conserva estructura.
- [ ] Focus visible funciona.
- [ ] Selected no rompe layout.
- [ ] Disabled no responde a click.
- [ ] No queda rastro de lógica “most searched team”.

---

# 26. Diagnóstico final

El error original era mezclar una card de partido con una card de equipo. Esa confusión genera decisiones visuales arbitrarias, cabecera inconsistente y pruebas frágiles.

Con esta especificación:
- la semántica queda cerrada,
- el layout queda estable,
- los fallbacks quedan definidos,
- QA tiene superficie concreta para validar,
- frontend tiene menos espacio para interpretar mal.

