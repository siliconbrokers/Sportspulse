# SP-COMP-MODES: Sistema de 3 estados de competencias + Arquitectura extensible de ligas

**Fecha:** 2026-03-19
**Estado:** Stage 2 -- Design Proposal APROBADO. Fase 5-6 completadas (2026-03-20).
**Tier:** opus (design) -> sonnet (implementation) -> haiku (configs/git)

---

## 1. Scope Statement

Este plan cubre tres objetivos relacionados:

**Objetivo A — Sistema de 3 estados:**
Reemplazar el boolean `enabled: boolean` en la configuracion de competencias del portal por un campo `mode: 'portal' | 'shadow' | 'disabled'` que desacopla cuatro concerns actualmente fusionados: portal display, data fetching, V3 prediction y NEXUS shadow.

| Estado     | Portal display | AF data fetching | V3 prediction | NEXUS shadow |
|------------|:-:|:-:|:-:|:-:|
| `portal`   | SI | SI | SI | SI |
| `shadow`   | NO | SI | SI | SI |
| `disabled` | NO | NO | NO | NO |

**Objetivo B — Arquitectura extensible de formatos:**
Eliminar las asunciones de formato hardcodeadas en el registry (seasonKind binario, hasSubTournaments boolean, isTournament boolean) y reemplazarlas por descriptores de formato expresivos que soporten cualquier liga o torneo sin requerir cambios de codigo.

**Objetivo D — Eliminar hardcodes de frontend:**
Hacer que los componentes de frontend deriven colores, labels y clasificaciones de competencias directamente del registry/portal-config. Una liga agregada al registry debe aparecer correctamente en todos los componentes sin necesidad de tocar ningún archivo de componente. El skill `/add-league` deja de necesitar editar archivos frontend para ligas en modo portal.

**Objetivo C — Gobernanza via skill `/add-league`:**
Toda adicion de liga o torneo debe pasar por el skill `/add-league`. El skill debe (1) auditar capacidades del sistema para esa liga, (2) declarar que features funcionan a nivel completo/degradado/no-disponible, y (3) tocar todos los archivos necesarios segun el modo elegido.

---

## 1b. Auditoria de linea base del skill — COMPLETADA (2026-03-19)

**El skill fue leído directamente en esta sesión.** No se requiere agente `Explore` — la baseline está documentada aquí.

### Estado actual del skill (`.claude/commands/add-league.md`)

**Pasos existentes:** Step 1 → Step 2 → Step 3 → **Step 3.5** → Step 4 → Step 5 → Step 6 → Step 7 → Step 8 → Step 9 → Step 9b → Step 10

**Step 3.5 ya existe y funciona** — detección automática de formato desde AF fixtures:
- Lee `APIFOOTBALL_KEY` del `.env` via bash
- Fetchea últimas/próximas 20 fixtures de AF con curl + jq
- Detecta automáticamente via Rules A/B/C/D: `hasSubTournaments`, `aperturaSeason`, `isTournament`, `totalMatchdays`, `expectedSeasonGames`
- No pregunta al usuario — solo permite override si dice explícitamente que el resultado es incorrecto
- Muestra resultado antes de Step 4

**Archivos que toca el skill hoy (3 fijos):**
| Archivo | Qué escribe |
|---------|------------|
| `server/competition-registry.ts` | Nueva entrada con `isTournament`, `seasonKind`, `hasSubTournaments`, `aperturaSeason` |
| `server/prediction/xg-source.ts` | Nueva entrada en `AF_LEAGUE_IDS` |
| `packages/web/src/hooks/use-portal-config.ts` | Nueva entrada en `DEFAULT_CONFIG.competitions` con `enabled: false` |

**Lo que el skill pregunta al usuario en Step 4:**
- `accentColor` — pregunta explícita (aún no auto-resuelve)
- `logoUrl` — pregunta explícita (aún no auto-resuelve)
- `slug`, `displayName`, `shortName`, `normalizedLeague`, `seasonLabel`, `seasonKind`, `expectedSeasonGames`, `totalMatchdays` — propone y deja corregir

**Lo que el skill NO hace todavía (gaps a cerrar en Fase 5):**
- No pregunta `mode` — usa `enabled: false` hardcodeado
- No auto-resuelve `logoUrl` ni `accentColor` desde TheSportsDB
- No genera `archetype` ni `competitionPhases[]` (pendiente hasta Fase 7e)
- No muestra Capability Declaration con features disponibles/degradadas
- No escribe `defaultMode` en el registry

**Post-activación checklist:** ✅ Ya existe en Step 10 — bien implementado, no cambia.

**Conclusión:** La pre-tarea queda resuelta. Las Fases 0–6 pueden implementarse. La Fase 7e actualiza las detection rules existentes (Rules A/B/C/D) para producir `archetype`+`competitionPhases[]` en lugar de flags, una vez que Fase 7a haya extendido el registry.

---

## 2. Authoritative Spec References

- **Constitution (doc #1):** Principio de provider isolation -- portal-config es el contrato entre backend y frontend.
- **Repo Structure (doc #6):** `server/` es composition root, `packages/api` no importa de canonical/scoring, `packages/web` no importa de scoring/layout.
- **MVP Execution Scope (doc #3):** Competitions se definen en `COMPETITION_REGISTRY`; no se agregan sin spec.
- **Backend Architecture (doc #10):** `portal-config-store.ts` como store atomico; admin-router como unico punto de mutacion.
- **AI SDD Operating Protocol (doc #11):** Nuevas features requieren spec change request si alteran semantica.

---

## 2b. Diseño de arquitectura extensible de formatos

### Principio rector

**Ninguna liga bloquea. Toda liga se puede agregar. Las features declaran su compatibilidad y degradan solas.**

El skill deja de ser un gate que bloquea y pasa a ser un **declarador de capacidades**: informa al usuario qué va a funcionar al nivel completo, qué va a funcionar degradado, y qué no va a estar disponible — y el usuario decide si continuar.

### Modelo de competencia basado en fases (reemplaza flags globales)

El cambio fundamental: en lugar de flags globales (`isTournament`, `hasStandings`, `legsPerTie`, `hasSubTournaments`), el registry describe cada competición como un **conjunto de fases**, cada una con su propia estructura. El discovery detecta el arquetipo y genera las fases automáticamente desde AF.

#### Arquetipos detectados automáticamente

El sistema soporta 8 arquetipos + 1 fallback genérico. Cualquier competición en AF puede clasificarse en uno de estos formatos sin requerir código nuevo.

| # | Archetype | Ligas/torneos reales | Señal en AF rounds |
|---|-----------|---------------------|--------------------|
| 1 | `league` | LaLiga, Premier League, Bundesliga, Serie A, Ligue 1, Liga MX (round-robin puro), Eliminatorias CONMEBOL/CONCACAF | Único hilo secuencial, sin grupos ni playoff — incluyendo "Qualifiers - N" (fallback genérico) |
| 2 | `league-subtournaments` | Liga Uruguaya (Apertura/Intermedio/Clausura), Liga Argentina (ambos torneos), Liga Chilena | 2+ prefijos de sub-torneos secuenciales del mismo nivel |
| 3 | `league-playoffs` | MLS, Brasileirão Série A, Ekstraklasa (Polonia), A-League (Australia), Liga Pro (Ecuador) | "Regular Season - Round N" + "Play-offs / Semi-final / Final" sin grupos |
| 4 | `groups-knockout` | Copa Libertadores, Copa Sudamericana, Champions pre-2024, Europa League, Recopa Sudamericana | "Group Stage" + knockout con pares home/away (ida y vuelta) |
| 5 | `league-phase-knockout` | Champions League 2024+, Conference League 2024+ | "League Phase" (tabla global) + knockout |
| 6 | `groups-singleleg-knockout` | Copa América, Eurocopa, Copa África de Naciones, Copa del Mundo, Copa Oro CONCACAF | "Group Stage" + knockout partido único + Final neutral |
| 7 | `pure-knockout` | Copa del Rey, FA Cup, Copa Italia, Copa de Francia, fases avanzadas de copas nacionales | Solo rondas eliminatorias, sin fase de grupos previa |
| 8 | `single-match` | Supercopa de España, Community Shield, Supercopa de Europa, Recopa (partido único) | Un único fixture por edición de la competición |
| fallback | `league` | Cualquier liga o clasificatoria con formato desconocido y un solo hilo de partidos | Ningún patrón conocido detectado — degradación graceful a liga genérica |

**Cobertura geográfica estimada:** Europa (5 grandes ligas + copas nacionales + Champions/Europa), Sudamérica (Copa Libertadores, Copa Sudamericana, clasificatorias, ligas nacionales con playoffs), Norteamérica (MLS), selecciones (Copa América, Mundial, Eurocopa, clasificatorias de todas las confederaciones).

#### Shape propuesto en `CompetitionRegistryEntry`

```typescript
// REEMPLAZA: isTournament, hasStandings, legsPerTie, hasSubTournaments, phases: string[]

archetype: CompetitionArchetype;
// Auto-detectado desde AF. Determina rendering de standings, bracket, selector de fase.

competitionPhases: CompetitionPhase[];
// Array de fases, cada una con su propia estructura. Auto-generado desde AF.
// Para leagues simples: un solo elemento. Para torneos complejos: múltiples.

seasonResolver: 'european' | 'calendar' | 'af-native';
// 'af-native': usa el campo season que AF devuelve en cada fixture — no computar localmente.
```

#### `CompetitionPhase` — estructura por fase

```typescript
interface CompetitionPhase {
  id: string;                           // slug: 'regular-season' | 'group-stage' | 'round-of-16' | 'final'
  name: string;                         // nombre visible derivado de AF
  afRoundPrefix: string;                // para asignar fixtures a esta fase via startsWith()
  hasStandings: boolean;                // ¿esta fase tiene tabla?
  standingsScope: 'global' | 'group';  // tabla única o por grupo
  legsPerTie: 1 | 2;                   // legs para ESTA fase específica
  neutralVenue?: boolean;               // final en sede neutral
}
```

#### Ejemplos auto-detectados

**LaLiga** → `archetype: 'league'`
```typescript
competitionPhases: [
  { id: 'regular-season', name: 'Regular Season', afRoundPrefix: 'Regular Season',
    hasStandings: true, standingsScope: 'global', legsPerTie: 1 }
]
```

**Liga Uruguaya** → `archetype: 'league-subtournaments'`
```typescript
competitionPhases: [
  { id: 'apertura',   name: 'Torneo Apertura',   afRoundPrefix: 'Torneo Apertura',
    hasStandings: true, standingsScope: 'global', legsPerTie: 1 },
  { id: 'intermedio', name: 'Torneo Intermedio', afRoundPrefix: 'Torneo Intermedio',
    hasStandings: true, standingsScope: 'global', legsPerTie: 1 },
  { id: 'clausura',   name: 'Torneo Clausura',   afRoundPrefix: 'Torneo Clausura',
    hasStandings: true, standingsScope: 'global', legsPerTie: 1 },
]
```

**Champions League 2024+** → `archetype: 'league-phase-knockout'`
```typescript
competitionPhases: [
  { id: 'league-phase',    name: 'League Phase',    afRoundPrefix: 'League Phase',
    hasStandings: true,  standingsScope: 'global', legsPerTie: 1 },
  { id: 'round-of-16',    name: 'Round of 16',     afRoundPrefix: 'Round of 16',
    hasStandings: false, standingsScope: 'global', legsPerTie: 2 },
  { id: 'quarter-finals', name: 'Quarter-Finals',  afRoundPrefix: 'Quarter-Finals',
    hasStandings: false, standingsScope: 'global', legsPerTie: 2 },
  { id: 'semi-finals',    name: 'Semi-Finals',     afRoundPrefix: 'Semi-Finals',
    hasStandings: false, standingsScope: 'global', legsPerTie: 2 },
  { id: 'final',          name: 'Final',           afRoundPrefix: 'Final',
    hasStandings: false, standingsScope: 'global', legsPerTie: 1, neutralVenue: true },
]
```

**MLS / Brasileirão** → `archetype: 'league-playoffs'`
```typescript
competitionPhases: [
  { id: 'regular-season', name: 'Regular Season', afRoundPrefix: 'Regular Season',
    hasStandings: true,  standingsScope: 'global', legsPerTie: 1 },
  { id: 'playoffs',       name: 'Playoffs',       afRoundPrefix: 'Play-offs',
    hasStandings: false, standingsScope: 'global', legsPerTie: 1 },
  // legsPerTie se auto-detecta por par home/away: MLS=1, Brasileirão=2
]
```
> Nota: la fase `playoffs` puede tener `legsPerTie: 1` (MLS) o `legsPerTie: 2` (Brasileirão).
> El detector lo resuelve desde pares home/away en los fixtures de play-off.

**Copa América** → `archetype: 'groups-singleleg-knockout'`
```typescript
competitionPhases: [
  { id: 'group-stage',    name: 'Group Stage',    afRoundPrefix: 'Group Stage',
    hasStandings: true,  standingsScope: 'group', legsPerTie: 1 },
  { id: 'quarter-finals', name: 'Quarter-Finals', afRoundPrefix: 'Quarter-finals',
    hasStandings: false, standingsScope: 'global', legsPerTie: 1 },
  { id: 'semi-finals',    name: 'Semi-Finals',    afRoundPrefix: 'Semi-finals',
    hasStandings: false, standingsScope: 'global', legsPerTie: 1 },
  { id: 'final',          name: 'Final',          afRoundPrefix: 'Final',
    hasStandings: false, standingsScope: 'global', legsPerTie: 1, neutralVenue: true },
]
```

#### Algoritmo de detección (discovery interno)

```
1. GET /fixtures?league={id}&season={current} → rounds únicos

2. Extraer prefijo de cada round string (FIX #3):
   afRoundPrefix = round.replace(/ - \d+$/, '').trim()
   Ejemplo: "Qualifiers - 1" → "Qualifiers"
            "Regular Season - Week 5" → "Regular Season - Week" [INCORRECTO]
   Regla más precisa: eliminar SOLO el sufijo numérico final (pattern: / - \d+$/)
   Si el round NO tiene sufijo numérico → usar el string completo como prefijo.

3. Clasificar rounds en grupos por prefijo extraído

4. Para cada grupo: analizar si hay pares home/away dentro del MISMO round → legsPerTie
   (nota: un equipo que juega de local en Fecha 1 y de visitante en Fecha 9 NO es two-leg)

5. Detectar "Group Stage" en algún prefijo → standingsScope: 'group'
6. Detectar "League Phase" en algún prefijo → standingsScope: 'global' con tabla
7. Detectar "Final" sin par home/away + sede no pertenece a equipos → neutralVenue: true

8. Asignar archetype por combinación de patrones detectados (orden de evaluación estricto):

   KEYWORDS de detección:
   - REGULAR_SERIES: prefijos que contienen "Regular Season", "Qualifiers", o equivalente
     (único hilo secuencial sin grupos ni knockout)
   - GROUP_KW: prefijos que contienen "Group Stage", "Grupo", "Group"
   - LEAGUE_PHASE_KW: prefijos que contienen "League Phase", "League Stage"
   - KNOCKOUT_KW: prefijos que contienen "Round of 16", "Round of 32", "Quarter",
                  "Semi", "Final", "Play-off", "Playoff", "Semifinal", "Copa"
   - SUBTOURNAMENT_KW: múltiples prefijos con estructura "Torneo X", "Apertura", "Clausura"

   Reglas (en orden — la primera que aplique gana):
   1. LEAGUE_PHASE_KW + KNOCKOUT_KW presentes → league-phase-knockout
   2. GROUP_KW + KNOCKOUT_KW presentes:
      → con pares home/away en rondas KNOCKOUT_KW → groups-knockout
      → sin pares home/away en rondas KNOCKOUT_KW → groups-singleleg-knockout
   3. SUBTOURNAMENT_KW (2+ prefijos distintos de mismo nivel) → league-subtournaments
   4. REGULAR_SERIES + KNOCKOUT_KW presentes (sin grupos):
      → league-playoffs
      (fase regular con tabla + play-offs eliminatorios: MLS, Brasileirão, Ligue 1, etc.)
   5. Solo KNOCKOUT_KW sin ningún REGULAR_SERIES ni GROUP_KW → pure-knockout
   6. Total de fixtures = 1 → single-match
   7. FALLBACK (FIX #1) — ninguno de los anteriores aplica:
      → archetype: 'league' (single-series genérica)
      Cubre: clasificatorias (Qualifiers - N), ligas exóticas, qualifiers continentales,
      y cualquier competición de formato desconocido con un único hilo y tabla global.

9. Generar competitionPhases[] completo usando los prefijos y atributos detectados
```

#### Impacto en UI

El UI determina qué renderizar por **fase activa**, no por flags globales:
- `activePhase.hasStandings` → mostrar/ocultar tabla
- `activePhase.standingsScope === 'group'` → selector de grupo
- `activePhase.legsPerTie === 2` → mostrar aggregate score
- `archetype === 'league-subtournaments'` → selector de sub-torneo
- `archetype === 'league-playoffs'` → selector de fase (Regular Season / Playoffs)
- `activePhase.neutralVenue` → ocultar labels local/visitante

#### Backward compatibility

Entradas existentes del registry (`isTournament`, `phases: string[]`, `hasSubTournaments`) se migran automáticamente a `archetype` + `competitionPhases` en startup, con la misma estrategia migration-on-read usada para `enabled → mode`.

### `resolveAfSeason()` — extension para af-native

```typescript
export function resolveAfSeason(
  kickoffUtc: string,
  seasonResolver: 'european' | 'calendar' | 'af-native',
  afSeasonFromFixture?: number, // campo season de la respuesta AF
): number | string {
  if (seasonResolver === 'af-native' && afSeasonFromFixture !== undefined) {
    return afSeasonFromFixture; // AF es fuente de verdad
  }
  if (seasonResolver === 'european') {
    const d = new Date(kickoffUtc);
    return d.getUTCMonth() < 6 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
  }
  return new Date(kickoffUtc).getUTCFullYear(); // calendar
}
```

**Backward compat:** `seasonKind: 'european' | 'calendar'` sigue siendo valido — se mapea a `seasonResolver` en la migracion. Solo nuevas ligas usan `seasonResolver`.

#### Criterio de detección automática de `af-native` en el discovery (FIX #2)

El discovery (Step 3.5) determina `seasonResolver` desde los metadatos de AF antes de computar nada localmente:

```
Criterio af-native — aplicar si CUALQUIERA de estas condiciones se cumple:

  A. La diferencia entre la fecha del primer y último fixture de la temporada es > 12 meses
     (indica un ciclo multi-año como clasificatorias mundialistas o torneos de 18+ meses)

  B. El nombre de la liga contiene keywords de qualification:
     "Qualification", "Qualifiers", "Clasificatorias", "Eliminatorias"

  C. AF devuelve un campo coverage.seasons[n].current=true para una season cuyo año
     difiere del año local en más de ±1 año
     (ej: en 2024, AF dice current_season=2026 → la lógica local de 'calendar' fallaría)

Si af-native se activa:
  - seasonLabel = String(season) tal como lo devuelve AF
  - currentSeason = el season de AF marcado como current (no computar desde Date.now())
  - La app usa el campo season de cada fixture directamente — no lo deriva del kickoffUtc

Fallback si ningún criterio aplica:
  - Fechas de temporada dentro de un año calendario (±1 mes de margen) → 'calendar'
  - Temporada empieza en ago/sep y termina en may/jun → 'european'
```

**Ejemplo Eliminatorias CONMEBOL**: criterios A + B + C aplican → `seasonResolver: 'af-native'`, `seasonLabel: '2026'`.

### Tabla de capacidades por feature

Cada feature declara su condicion de activacion. Si la condicion no se cumple, la feature degrada gracefulmente:

| Feature | Condicion de activacion | Degradacion si no aplica |
|---------|------------------------|--------------------------|
| Standings | `activePhase.hasStandings: true` | Ruta `/standings` retorna `[]` sin error |
| Sub-torneo selector | `archetype: 'league-subtournaments'` con 2+ fases | Selector no aparece en UI |
| Prediction engine | Tiene partidos historicos en AF | Corre con Elo bootstrap neutro (K inicial alto) |
| xG signal | AF provee xG para la liga | Signal omitida del ensemble, log warning |
| Track 4 odds | AF provee odds para la liga | Track peso cero, ensemble recalibra |
| Track 1B lineups | AF provee lineups para la liga | Signal omitida del ensemble |
| Fases de torneo (tabs) | archetype knockout/groups + entrada en `tournament-config.ts` | Tabs de fases no aparecen |
| Two-leg reconciliation | `activePhase.legsPerTie: 2` | No aplica para ligas con partido unico |

### Skill: Compatibility Gate como declarador (no bloqueante)

El Step 3.5 del skill agrega una **Capability Declaration** al final. No bloquea, declara.

**Regla de continuación (FIX #5):**
- Si hay ⚠️ warnings → mostrar declaración + preguntar `¿Continuamos? (s/n)`
- Si todo es ✅ (sin warnings ni ℹ️ pendientes) → mostrar declaración + continuar automáticamente sin pregunta
- Si hay bloqueante duro → abortar (ver tabla de bloqueantes)

```
## Capacidades para {displayName}

✅ Formato de temporada: af-native — compatible
✅ Tabla de posiciones: sí — standings disponibles
✅ Datos históricos: 4 temporadas — Elo confiable
✅ Lineups: disponibles — Track 1B activo
⚠️  xG: no disponible en AF — signal omitida del ensemble (degradación media)
⚠️  Odds: no disponibles — Track 4 con peso cero (degradación media)
ℹ️  Archetype knockout/groups — requiere entrada manual en tournament-config.ts post-wizard

Modo seleccionado: shadow

Esta liga funcionará con las capacidades indicadas.
¿Continuamos sabiendo que xG y odds estarán degradados? (s/n)
```

Ejemplo sin warnings (Eliminatorias CONMEBOL con odds+xG disponibles):
```
## Capacidades para FIFA World Cup Qualification - CONMEBOL

✅ Formato de temporada: af-native — compatible
✅ Tabla de posiciones: sí — standings disponibles
✅ Datos históricos: 2 ciclos completos — Elo confiable
✅ xG: disponible
✅ Odds: disponibles — Track 4 activo
✅ Lineups: disponibles — Track 1B activo

Modo seleccionado: shadow
Archetype detectado: league (clasificatoria single-series)

Configuración lista. Continuando...  ← sin pregunta al usuario
```

Solo en un caso el skill puede sugerir abortar: cuando AF no tiene **ningún** dato historico y el modo es `shadow` — porque el motor predictivo no tiene nada con que trabajar. Pero incluso ahi es una sugerencia, no un bloqueo forzado.

### Orden de implementacion de Objetivo B

Objetivo B se implementa como **Fase 7** (despues de Fases 0-6):

```
Fase 7a: Extender CompetitionRegistryEntry — agregar archetype + competitionPhases[] (backward compat: migrar isTournament/hasSubTournaments/phases/legsPerTie al nuevo modelo on-read)
Fase 7b: Extender resolveAfSeason() para af-native
Fase 7c: Actualizar standings-route.ts — leer hasStandings desde competitionPhases[activePhase] en lugar de campo global
Fase 7d: Refactorizar selector UI — N tabs dinámicas desde competitionPhases[] donde archetype='league-subtournaments', resolución por afRoundPrefix
Fase 7e: Actualizar skill Step 3.5 — reemplazar Rules A/B/C/D (producen isTournament/hasSubTournaments) por el algoritmo de detección de archetype+competitionPhases[] del plan §2b. La infraestructura curl/jq/AF ya existe — solo cambia qué produce.
```

Fases 7a-7e son independientes de Fases 0-6 pero se ejecutan despues para no mezclar cambios.

---

## 2c. Diseño de Objetivo D — Eliminar hardcodes de frontend

### El problema

Los componentes de frontend mantienen mapas locales de colores, labels y clasificaciones que duplican informacion ya disponible en el registry. Agregar una liga nueva requiere editar estos componentes manualmente. Si se omite, la liga aparece con datos incorrectos o ausentes.

**Hardcodes actuales a eliminar:**

| Archivo | Hardcode | Dato disponible en registry |
|---------|----------|----------------------------|
| `LiveCarousel.tsx` | `LEAGUE_ACCENT[normalizedLeague]` | `accentColor` en portal-config |
| `LiveCarousel.tsx` | `LEAGUE_LABEL[normalizedLeague]` | `shortName` en portal-config |
| `DailyHighlights.tsx` | `LEAGUE_ACCENT[newsKey]` | `accentColor` en portal-config |
| `EventsSection.tsx` | `CANONICAL_LEAGUES` (Set hardcodeado) | todas las competencias activas en portal-config |
| `EventsSection.tsx` | `ACCENT[normalizedLeague]` | `accentColor` en portal-config |
| `competition-meta.ts` | `NEWS_LEAGUE_ORDER` | orden de competencias en portal-config |
| `competition-meta.ts` | `VIDEO_LEAGUE_ORDER` | orden de competencias en portal-config |

### La solucion

El hook `usePortalConfig()` ya retorna todas las competencias con sus metadatos completos (`accentColor`, `displayName`, `shortName`, `normalizedLeague`, `newsKey`, `archetype`, `logoUrl`). Los componentes deben consumir esos datos en lugar de mantener mapas locales.

**Patron de reemplazo:**

```typescript
// HOY — mapa local hardcodeado
const LEAGUE_ACCENT: Record<string, string> = {
  URUGUAY_PRIMERA: '#3b82f6',
  LALIGA: '#f59e0b',
  // ...nueva liga → no está → fallback genérico
}
const accent = LEAGUE_ACCENT[normalizedLeague] ?? '#6b7280';

// PROPUESTO — derivado de portal-config
const { competitions } = usePortalConfig();
const compMap = useMemo(() =>
  new Map(competitions.map(c => [c.normalizedLeague, c])),
  [competitions]
);
const accent = compMap.get(normalizedLeague)?.accentColor ?? '#6b7280';
```

**Para `CANONICAL_LEAGUES`:**
```typescript
// HOY — Set hardcodeado de ligas que usan datos canónicos
const CANONICAL_LEAGUES = new Set(['URUGUAY_PRIMERA', 'LALIGA', ...]);

// PROPUESTO — todas las competencias activas en portal-config son canónicas
const { competitions } = usePortalConfig();
const canonicalLeagues = useMemo(() =>
  new Set(competitions.filter(c => c.mode === 'portal').map(c => c.normalizedLeague)),
  [competitions]
);
```

**Para órdenes de lista (`NEWS_LEAGUE_ORDER`, `VIDEO_LEAGUE_ORDER`):**
El orden lo determina el array `competitions` de portal-config, que ya viene ordenado desde el backend (orden del registry). Se elimina el orden hardcodeado.

### Degradacion graceful para news/video

Si una liga no tiene `newsKey` configurado (`newsKey: null`), los servicios de noticias y video simplemente no generan un bloque para esa liga — sin error, sin bloque vacío visible. Esto ya es la semantica correcta y no requiere cambio de codigo en news/video-service — solo asegurarse de que el frontend no intente renderizar un bloque para `newsKey: null`.

### Impacto en el skill (Objetivo C revisado)

Con Objetivo D implementado, el skill en modo `portal` **ya no necesita editar archivos de componentes frontend**. Los componentes se adaptan solos. El skill queda reducido a:

**Para cualquier modo:**
- `server/competition-registry.ts` — entrada al registry
- `server/prediction/xg-source.ts` — xG coverage
- `packages/web/src/hooks/use-portal-config.ts` — DEFAULT_CONFIG fallback

**Solo si archetype es knockout/groups** (groups-knockout, league-phase-knockout, groups-singleleg-knockout, pure-knockout):
- `server/tournament-config.ts` — configuracion de fases del torneo

**Solo si mode=portal y newsKey != null:**
- `server/news/rss-source.ts` — feeds RSS (o marcar como TODO)
- `server/video/video-sources-config.ts` — canales YouTube (o marcar como TODO)

Colores, labels, orden de lista y clasificacion de ligas canonicas: **automaticos**.

### Orden de implementacion de Objetivo D

Objetivo D se implementa como **Fase 8** (despues de Fase 7):

```
Fase 8a: Extender portal-config API response para incluir accentColor, shortName, normalizedLeague
         (si no estan ya en el DTO que recibe el frontend)
Fase 8b: Refactorizar LiveCarousel.tsx — LEAGUE_ACCENT y LEAGUE_LABEL desde usePortalConfig()
Fase 8c: Refactorizar DailyHighlights.tsx — LEAGUE_ACCENT desde usePortalConfig()
Fase 8d: Refactorizar EventsSection.tsx — CANONICAL_LEAGUES y ACCENT desde usePortalConfig()
Fase 8e: Simplificar competition-meta.ts — eliminar NEWS_LEAGUE_ORDER y VIDEO_LEAGUE_ORDER hardcodeados
Fase 8f: Actualizar skill — remover steps de edicion de componentes frontend para modo portal
```

**Prerequisito:** Fase 4 (use-portal-config.ts con campo `mode`) debe estar completa antes de Fase 8.

### Garantia post-Objetivo D

Una vez implementados los Objetivos A+B+C+D, agregar cualquier liga al registry (incluyendo la Liga Mongolesa) produce automaticamente:

- ✅ Color correcto en LiveCarousel, DailyHighlights, EventsSection
- ✅ Label correcto en carrusel
- ✅ Incluida en ligas canonicas si esta activa
- ✅ Orden determinado por posicion en registry
- ✅ Data fetching + prediccion segun modo
- ✅ Standings disponibles si `activePhase.hasStandings: true`
- ✅ Selector de sub-torneos si `archetype === 'league-subtournaments'`
- ⚙️  Noticias: solo si `newsKey != null` y feeds RSS configurados (intencional — requiere fuente real)
- ⚙️  Videos: solo si canal YouTube configurado (intencional — requiere fuente real)

---

## 3. Assumptions

1. **No hay portal-config.json en disco con formato viejo en produccion que no sea migrable.** El archivo existente en Render tiene `{ competitions: [{ enabled: boolean, ... }], features: {...} }`. La migracion es un rename de campo.
2. **El skill `/add-league` existe en `.claude/commands/add-league.md`.** Se actualiza, no se crea. La auditoria de linea base (§1b) documenta su estado actual antes de modificarlo.
3. **No hay ligas en modo shadow actualmente.** Todas las ligas existentes en COMPETITION_REGISTRY son de portal. La migracion convierte todas de `enabled: true` a `mode: 'portal'`.
4. **No hay tests unitarios dedicados para `portal-config-store.ts`.** La migracion no rompe tests existentes porque la cobertura es indirecta (smoke tests).
5. **El campo `enabled` en el frontend (`use-portal-config.ts` / `App.tsx`) se consume como filtro booleano.** Post-migracion, el frontend recibe un `enabled` derivado (`mode === 'portal'`) para backward compat.

---

## 4. Implementation Plan

### Fase 0: Migracion del store (backend, zero-downtime)

**Objetivo:** Cambiar la forma interna del dato sin alterar el comportamiento observable.

#### 4.0.1 `server/portal-config-store.ts`

**Cambios:**

1. **Tipo `CompetitionConfig`:** Agregar campo `mode: CompetitionMode` donde:
   ```typescript
   type CompetitionMode = 'portal' | 'shadow' | 'disabled';
   ```
   Eliminar `enabled: boolean` del tipo.

2. **`CATALOG_DEFAULTS`:** Cambiar `enabled: true` -> `mode: 'portal'` como default para todas las competencias.

3. **Funcion `readConfig()` -- migracion in-situ:** Al leer un archivo existente, detectar si usa `enabled: boolean` (formato viejo) y convertir:
   - `enabled: true` -> `mode: 'portal'`
   - `enabled: false` -> `mode: 'disabled'`

   Esto es un migration-on-read: la primera lectura convierte; la primera escritura persiste el formato nuevo. No se necesita script de migracion separado.

4. **Nueva API publica:**
   ```typescript
   // Reemplaza isCompetitionEnabled()
   function getCompetitionMode(competitionId: string): CompetitionMode;

   // Helpers derivados
   function isCompetitionActive(competitionId: string): boolean;   // mode !== 'disabled' (portal + shadow)
   function isCompetitionPortal(competitionId: string): boolean;   // mode === 'portal'

   // Backward compat (deprecated, a eliminar en futuro)
   function isCompetitionEnabled(competitionId: string): boolean;  // alias de isCompetitionActive()
   ```

5. **`PortalConfigPatch`:** Cambiar el shape del patch:
   ```typescript
   competitions?: { id: string; mode: CompetitionMode }[];
   ```
   Backward compat: si el patch llega con `{ id, enabled }` (formato viejo del admin), convertir a mode.

6. **Audit entries:** El campo del audit cambia de `competition.{id}.enabled` a `competition.{id}.mode`, y los valores from/to son `CompetitionMode` strings.

7. **`getEnabledCompetitions()`:** Renombrar a `getActiveCompetitions()`. Retorna competencias con `mode !== 'disabled'` (portal + shadow). Mantener alias deprecated `getEnabledCompetitions()` que llama `getActiveCompetitions()`.

#### 4.0.2 Migracion en produccion (Render)

**Escenario:** En Render hay un `cache/portal-config.json` con formato viejo (boolean `enabled`).

**Estrategia:** Migration-on-read. El nuevo codigo lee el archivo viejo, detecta `enabled` en lugar de `mode`, convierte en memoria, y persiste el formato nuevo en la siguiente escritura (admin save). Mientras nadie toque el admin, el archivo viejo persiste en disco pero se lee correctamente.

**Deteccion del formato viejo:**
```typescript
// En readConfig(), despues de parsear:
for (const comp of parsed.competitions) {
  if ('enabled' in comp && !('mode' in comp)) {
    (comp as any).mode = comp.enabled ? 'portal' : 'disabled';
    delete (comp as any).enabled;
  }
}
```

**Riesgo mitigado:** Si por alguna razon se hace rollback al codigo viejo (sin `mode`), el archivo nuevo tiene `mode` sin `enabled`. El codigo viejo no reconoceria `mode` y trataria a todas como `enabled: true` (default del codigo viejo). Esto es aceptable como fallback: muestra todo, no pierde nada.

### Fase 1: Rewire server/index.ts

**Objetivo:** Crear dos conjuntos de IDs explicitos.

#### 4.1.1 Cambios en `server/index.ts`

1. **Reemplazar todas las llamadas a `isCompetitionEnabled()` por `isCompetitionActive()`.** Estas son las 15+ ocurrencias que controlan data fetching, prediccion, NEXUS, polling, crest maps, etc. Todo lo que no es portal display necesita `active` (portal + shadow).

2. **Crear `portalCompIds` para el frontend:**
   ```typescript
   // Para el frontend: solo mode=portal
   const portalCompIds = ALL_COMP_IDS.filter(isCompetitionPortal);
   ```
   Usar `portalCompIds` en:
   - `getEnrichedPortalConfig()` -- filtrar competencias a enviar al frontend? **NO**: enviar TODAS con su `mode`, para que el admin pueda verlas. El frontend filtra por `mode === 'portal'` localmente.

3. **`ALL_COMP_IDS` queda igual pero usa `isCompetitionActive()`** en su `.filter()`:
   ```typescript
   const ALL_COMP_IDS = [...].filter(isCompetitionActive);
   ```

4. **`getEnrichedPortalConfig()`:** Cambiar `enabled: c.enabled` a `mode: c.mode`. Agregar `enabled: c.mode === 'portal'` como campo derivado para backward compat temporal del frontend.

5. **Inline scheduler (linea ~929):** `AF_COMP_IDS.filter(isCompetitionEnabled)` -> `AF_COMP_IDS.filter(isCompetitionActive)`.

6. **`competitionIds` pasado a `buildApp()`:** Actualmente filtra con `isCompetitionEnabled`. Cambiar a `isCompetitionActive` (el API sirve datos de portal+shadow para status, health, etc.).

#### 4.1.2 Puntos de consumo en server/index.ts (inventario completo)

Basado en el grep, estas son TODAS las ocurrencias de `isCompetitionEnabled` en server/index.ts:

| Linea | Uso | Nuevo helper |
|-------|-----|--------------|
| 135 | Startup fetch FD competitions | `isCompetitionActive` |
| 163 | Startup fetch UY | `isCompetitionActive` |
| 179 | Startup fetch AR | `isCompetitionActive` |
| 192 | Startup fetch OLG | `isCompetitionActive` |
| 207 | Startup fetch WC | `isCompetitionActive` |
| 238 | Startup fetch CLI | `isCompetitionActive` |
| 284 | Startup fetch AF canonical | `isCompetitionActive` |
| 440 | `FD_COMP_IDS` filter | `isCompetitionActive` |
| 455 | `ALL_COMP_IDS` filter | `isCompetitionActive` |
| 609 | `liveCompIds` (upcomingService) | `isCompetitionActive` |
| 761 | `competitionIds` in buildApp | `isCompetitionActive` |
| 929 | AF scheduler | `isCompetitionActive` |
| 1015 | FD polling | `isCompetitionActive` |
| 1036 | UY polling | `isCompetitionActive` |
| 1049 | AR polling | `isCompetitionActive` |
| 1062 | OLG polling | `isCompetitionActive` |
| 1076 | WC polling | `isCompetitionActive` |
| 1090 | CLI polling | `isCompetitionActive` |
| 1117 | V3 shadow | `isCompetitionActive` |
| 1123 | V3 FD shadow | `isCompetitionActive` |
| 1148 | V3 non-FD shadow | `isCompetitionActive` |
| 1178 | Forward validation | `isCompetitionActive` |

**Regla:** Buscar-y-reemplazar `isCompetitionEnabled` -> `isCompetitionActive` en server/index.ts. No hay caso donde se necesite la semantica antigua (solo portal) en el backend.

### Fase 2: Admin back-office (backend)

#### 4.2.1 `server/admin-router.ts`

1. **PUT /api/admin/config:** Aceptar el nuevo shape del patch:
   ```typescript
   competitions?: { id: string; mode: CompetitionMode }[];
   ```
   Backward compat: si llega `{ id, enabled }`, convertir a mode.

2. **Logica de invalidacion de snapshot cache:** Actualmente invalida cuando una competencia pasa de enabled a disabled. Con el nuevo modelo, invalidar cuando cambia a `disabled` desde cualquier otro estado. Cuando cambia de `portal` a `shadow`, tambien invalidar (la competencia desaparece del portal).

### Fase 3: Admin back-office (frontend)

#### 4.3.1 `packages/web/src/admin/AdminPage.tsx`

1. **Reemplazar el `Toggle` por un selector de 3 estados** (segmented control o dropdown). Opciones:
   - **Portal** (verde) -- visible para usuarios, datos activos
   - **Shadow** (amarillo/ambar) -- no visible, pero datos activos (prediccion, acumulacion NEXUS)
   - **Deshabilitado** (gris) -- completamente apagado

2. **Tipo `CompetitionConfig` local:** Agregar `mode: 'portal' | 'shadow' | 'disabled'`. Mantener `enabled` como opcional para backward compat transitoria.

3. **Funcion `patch()`:** Enviar `{ competitions: [{ id, mode }] }` en lugar de `{ id, enabled }`.

4. **UI sugerida:** Un grupo de 3 botones por competencia (segmented control):
   ```
   [La Liga]  PD · comp:apifootball:140    [ Portal | Shadow | Off ]
   [Premier]  PL · comp:apifootball:39     [ Portal | Shadow | Off ]
   ```
   El boton activo tiene color (verde/ambar/gris), los otros son outline.

### Fase 4: Frontend portal (consumo)

#### 4.4.1 `packages/web/src/hooks/use-portal-config.ts`

1. **Tipo `CompetitionEntry`:** Agregar `mode?: 'portal' | 'shadow' | 'disabled'`.
2. **Mantener `enabled: boolean`** como campo derivado. El backend lo envia; el frontend lo consume.
3. **`DEFAULT_CONFIG`:** Agregar `mode: 'portal'` a todas las entradas existentes (todas tienen `enabled: true`).

#### 4.4.2 `packages/web/src/App.tsx`

**Sin cambios necesarios.** Actualmente filtra por `.enabled`. El backend sigue enviando `enabled: c.mode === 'portal'`. El frontend sigue funcionando igual.

**Cambio futuro (no en este PR):** Migrar a `.mode === 'portal'` y eliminar `enabled` del DTO.

### Fase 5: Actualizar `.claude/commands/add-league.md`

El skill YA EXISTE y tiene Step 3.5 funcionando. Esta fase aplica **cambios quirúrgicos** sobre el skill actual — no reescritura.

#### Cambios puntuales sobre el skill existente:

**Cambio 1 — Step 3.5: Extender con TheSportsDB + capability declaration**

Agregar al final de Step 3.5 (después de las Rules A/B/C/D existentes), dos bloques nuevos:

*Bloque A — TheSportsDB resolution (reemplaza la pregunta de logo/color en Step 4):*
```
GET https://www.thesportsdb.com/api/v1/json/3/search_all_leagues.php?l={displayName}
→ strBadge → logoUrl
→ extraer color dominante del badge → accentColor
→ si no encuentra: logoUrl='', accentColor='#6b7280' (warning en consola, no interrumpir)
```

*Bloque B — Capability declaration (nuevo output al usuario):*
```
## Capacidades para {displayName}

✅/⚠️  Formato de temporada: {seasonResolver} — {compatible | incompatible}
✅/⚠️  Tabla de posiciones: {sí/no}
✅/⚠️  Datos históricos: {N temporadas} — {Elo confiable | degradado}
✅/⚠️  xG: {disponible | no disponible en AF}
✅/⚠️  Odds: {disponibles | no disponibles}
✅/⚠️  Lineups: {disponibles | no disponibles}

Si hay ⚠️ → preguntar "¿Continuamos sabiendo que X estará degradado? (s/n)"
Si todo ✅ → continuar automáticamente sin preguntar
```

Para detectar xG/odds/lineups: usar los endpoints curl que ya tiene Step 3.5 como modelo — misma estructura, distinto endpoint.

**Cambio 2 — Step 4: Remover preguntas de `accentColor` y `logoUrl`, agregar `mode`**

- Eliminar de "Always ask": `accentColor` y `logoUrl` (ya auto-resueltos en Step 3.5)
- Agregar como única pregunta nueva:
  ```
  ¿En qué modo querés agregar esta liga?
    portal   — visible para usuarios, datos y predicciones activos
    shadow   — no visible en portal, datos y predicciones activos internamente
    disabled — completamente desactivada
  ```
- `accentColor` y `logoUrl` pasan a "Show as detected facts" junto a hasSubTournaments/isTournament/aperturaSeason

**Cambio 3 — Step 5 (final confirmation): Agregar `mode` al bloque de resumen**
```
  mode:             {mode}
  accentColor:      {auto-detectado}  ← TheSportsDB
  logoUrl:          {auto-detectado}  ← TheSportsDB
```

**Cambio 4 — Step 6 (competition-registry.ts): Agregar `defaultMode`**
```typescript
    defaultMode:         '{mode}',
```
Los demás campos del entry shape no cambian en esta fase (siguen usando `isTournament`, `seasonKind`, etc. — eso cambia en Fase 7a).

**Cambio 5 — Step 8 (use-portal-config.ts): Cambiar `enabled` por `mode`**

- Reemplazar `enabled: false` por `mode: '{mode}'`
- Nota en el skill: el campo `enabled` desaparece del DEFAULT_CONFIG después de SP-COMP-MODES Fase 0.

**Cambio 6 — Step 10 (next steps): Actualizar mención del admin**

Reemplazar "activar la liga con el toggle" por:
"Ir a `/admin` → el selector de 3 estados mostrará la liga con el modo configurado. Cambiar a `portal` cuando corresponda."

**Cambio 7 — Constraints: Actualizar regla de `enabled`**
- Eliminar: `"Do NOT set enabled: true — activation is always admin-only"`
- Agregar: `"El modo inicial lo define el wizard. El admin puede cambiarlo en cualquier momento desde /admin."`

**Sin cambios:** Step 1, Step 2, Step 3, Step 3.5 Rules A/B/C/D (detection logic), Step 7, Step 9, Step 9b, checklist de Step 10.

**Regla de gobernanza (sin cambio):** Si la liga ya existe en el registry, el skill se limita a informar — no sobreescribe.

---

#### Step 3.5 — Discovery automático (YA EXISTE — extender, no reescribir)

El skill ya tiene Step 3.5 con detección de `hasSubTournaments`, `aperturaSeason`, `isTournament` via curl+jq sobre AF fixtures. **No se reescribe** — se extiende con TheSportsDB resolution y capability declaration (Fase 5), y se migran las detection rules a archetype+competitionPhases (Fase 7e).

**Principio:** AF es la fuente de verdad para la estructura. El sistema se adapta a lo que AF devuelve. El usuario no gestiona complejidad estructural.

##### Checks de compatibilidad

**BLOQUEANTES DUROS** — el skill aborta si alguno se cumple:

| Check | Condición de bloqueo | Mensaje al usuario |
|-------|---------------------|-------------------|
| **Formato de temporada** | La liga no encaja en `european` (ago-may) ni `calendar` (año-año) — ej: ligas con fases múltiples de distinto año calendario que no son Apertura/Clausura | "Este formato de temporada no es compatible con la arquitectura actual (solo european/calendar). No se puede agregar hasta extender el modelo." |
| **Archetype irresoluble** | AF devuelve fixtures pero los `round` values no encajan en ningún archetype conocido | "No se puede determinar el formato de esta competición desde AF. Requiere clasificación manual — abortar wizard." |
| **Sin datos en AF** | API-Football no tiene fixtures históricos para esta liga (0 temporadas disponibles) | "API-Football no tiene datos históricos para esta liga. Sin datos históricos el motor predictivo no puede calibrar Elo. No se puede agregar." |
| **AF sin campo round** | Se detecta archetype multi-fase pero AF no incluye campo `round` en los fixtures de esa liga | "No se puede generar afRoundPrefix para las fases. Las fases del torneo no podrán resolverse desde AF. Abortar wizard." |

**ADVERTENCIAS SOFT** — el skill muestra el impacto y pide `confirmar de todas formas? (s/n)`:

| Check | Condición | Impacto declarado |
|-------|-----------|-----------------|
| **Historia insuficiente** | AF tiene menos de 2 temporadas completas de datos históricos | "Elo inicial será poco confiable (< 2 temporadas de historia). Predicciones degradadas hasta acumular más partidos." |
| **Sin odds en AF** | AF no provee cuotas para esta liga | "NEXUS Track 4 (odds) no tendrá señal para esta liga. Ensemble corre sin esa feature — menor confianza en predicciones." |
| **Sin lineups en AF** | AF no provee alineaciones confirmadas para esta liga | "NEXUS Track 1B (lineups/lesiones) no tendrá señal. Predicciones sin ajuste por alineación." |
| **Sin xG en AF** | AF no provee xG para esta liga | "Motor predictivo usa goles reales como proxy. xG backfill no disponible para esta liga." |
| **Archetype con knockout sin tournament-config** | Se detecta archetype `groups-knockout` / `pure-knockout` / `league-phase-knockout` pero `tournament-config.ts` no tiene entrada para esta liga | "Requiere agregar manualmente a `server/tournament-config.ts` después del wizard. Las fases del torneo no renderizarán hasta hacerlo." |

##### Cómo ejecutar los checks — Discovery automático desde AF

El skill consulta directamente la API de AF (usando la `APIFOOTBALL_KEY` disponible en el entorno) para descubrir la estructura de la liga. No pregunta al usuario lo que AF puede responder.

**Consultas de discovery (todas internas, transparentes al usuario):**

```
AF API:
1. GET /leagues?id={leagueId}
   → seasons disponibles → seasonResolver ('calendar'|'european'|'af-native'), expectedSeasonGames
   → si la liga no tiene fixture regulares sino eliminación directa → candidato archetype 'pure-knockout'

2. GET /fixtures?league={leagueId}&season={currentSeason}
   → round values únicos → detectar archetype:
     • valores tipo "Apertura - Regular Season - Week N" → 'league-subtournaments'
     • valores tipo "League Stage - Week N" + "Round of 16" → 'league-phase-knockout'
     • valores tipo "Group Stage - 1" + "Round of 16" (con ida/vuelta) → 'groups-knockout'
     • valores tipo "Group Stage - 1" + "Round of 16" (sin vuelta) → 'groups-singleleg-knockout'
     • valores tipo "Round of 16", "Quarter-finals", "Final" sin grupos → 'pure-knockout'
     • valores tipo "Regular Season - Week N" solo → 'league'
   → pares home/away por ronda → legsPerTie por fase (1 o 2)
   → conteo de fixtures/equipos → expectedSeasonGames, totalMatchdays

3. GET /standings?league={leagueId}&season={currentSeason}
   → presencia y estructura de standings → hasStandings: true/false por fase
   → si standings.response[0][0].group !== undefined → standingsScope: 'group', else 'global'

4. GET /odds?league={leagueId}&season={currentSeason}&bookmaker=6
   → Track 4 disponible: true/false

5. GET /fixtures/statistics?fixture={sampleFixtureId}
   → xG disponible: true/false

6. GET /fixtures/lineups?fixture={sampleFixtureId}
   → Track 1B disponible: true/false

TheSportsDB API:
7. GET /search_all_leagues.php?l={displayName}
   → badge URL → logoUrl
   → extraer color dominante del badge → accentColor
   → si no encuentra: logoUrl='', accentColor='#6b7280' (fallback neutro, warning en consola)
```

**Output del discovery:** interno, no se presenta al usuario. El skill simplemente escribe la configuración descubierta en los archivos correspondientes. Si algún endpoint AF falla o retorna vacío, el sistema registra un warning en consola y usa el valor por defecto más seguro (ej: `archetype: 'league'`, `competitionPhases: [{ id: 'regular', name: 'Regular Season', afRoundPrefix: 'Regular Season', hasStandings: true, standingsScope: 'global', legsPerTie: 1 }]`).

##### Output del gate

```
## Compatibilidad arquitectónica

✅ Formato de temporada: calendar — compatible
✅ Tiene tabla de posiciones: sí — compatible
✅ Datos históricos: 4 temporadas disponibles — ok
⚠️  Odds en AF: no disponibles — NEXUS Track 4 sin señal
⚠️  xG en AF: no disponibles — predicciones sin xG
✅ Lineups: disponibles

BLOQUEANTES: ninguno
ADVERTENCIAS: 2 (odds, xG)

¿Querés continuar sabiendo que Track 4 y xG estarán degradados? (s/n)
```

Solo después de `s` el wizard continúa al Step 4.

### Fase 6: Regla de gobernanza en CLAUDE.md

Agregar la siguiente seccion despues de "Git & Deploy":

```markdown
## League Governance -- Regla CRITICA

**Toda adicion de liga o torneo al portal DEBE ejecutarse via el skill `/add-league`.**
No se permite agregar ligas por instruccion directa en chat. Si el usuario pide agregar
una liga, el agente DEBE invocar el skill `/add-league` que guia el proceso paso a paso.

**Motivo:** El proceso de agregar una liga toca 4+ archivos y requiere campos especificos
(leagueId, seasonKind, mode, etc.). El skill garantiza que no se olvide ningun paso.

**Excepciones:** Modificar el `mode` de una liga existente SI se puede hacer directamente
via admin back-office o instruccion directa (es un cambio de configuracion, no de schema).
```

---

## 5. Archivos a crear/modificar

| Archivo | Accion | Fase |
|---------|--------|------|
| `server/portal-config-store.ts` | Modificar: agregar `CompetitionMode`, migration-on-read, nuevos helpers | 0 |
| `server/index.ts` | Modificar: reemplazar `isCompetitionEnabled` -> `isCompetitionActive` (20+ ocurrencias) | 1 |
| `server/admin-router.ts` | Modificar: aceptar `mode` en patch, logica de invalidacion | 2 |
| `packages/web/src/admin/AdminPage.tsx` | Modificar: reemplazar Toggle por segmented control 3-estados | 3 |
| `packages/web/src/hooks/use-portal-config.ts` | Modificar: agregar `mode` al tipo, actualizar DEFAULT_CONFIG | 4 |
| `packages/api/src/ui/portal-config-route.ts` | Sin cambios (pass-through de lo que devuelve `getPortalConfig()`) | -- |
| `packages/web/src/App.tsx` | Sin cambios (sigue filtrando por `.enabled`) | -- |
| `.claude/commands/add-league.md` | Modificar: agregar pregunta de modo, actualizar Steps 4-6-8-10 y Constraints | 5 |
| `CLAUDE.md` | Modificar: agregar seccion League Governance | 6 |

---

## 6. Tests y Acceptance Mapping

| Test | Descripcion | Matrix ID |
|------|-------------|-----------|
| Migration-on-read: archivo con `enabled:true` -> `mode:'portal'` | Unit test para `readConfig()` | N/A (infra) |
| Migration-on-read: archivo con `enabled:false` -> `mode:'disabled'` | Unit test para `readConfig()` | N/A (infra) |
| `isCompetitionActive()` retorna true para portal y shadow | Unit test | N/A (infra) |
| `isCompetitionPortal()` retorna true solo para portal | Unit test | N/A (infra) |
| Admin PATCH con `{ mode: 'shadow' }` persiste correctamente | Integration test | N/A (infra) |
| Admin PATCH con formato viejo `{ enabled: false }` se convierte a `mode: 'disabled'` | Integration test backward compat | N/A (infra) |
| Frontend recibe `enabled: true` solo para `mode === 'portal'` | Smoke test | N/A (infra) |
| Competencia en `shadow` no aparece en el portal pero sus datos se fetchean | E2E | N/A (infra) |
| Competencia en `disabled` no aparece ni se fetchea | E2E | N/A (infra) |

No se afectan acceptance matrix IDs existentes (A-01 a J-02) porque esta feature es de infraestructura de configuracion, no de pipeline/snapshot/scoring.

---

## 7. Versioning Impact Analysis

| Version | Impacto |
|---------|---------|
| `policyVersion` | Sin cambio -- no altera scoring semantics |
| `layoutAlgorithmVersion` | Sin cambio -- no altera geometry |
| `snapshotSchemaVersion` | Sin cambio -- el snapshot no incluye config de competencias |
| Portal config schema | **Cambio material:** `enabled: boolean` -> `mode: CompetitionMode`. Version implicitamente manejada por migration-on-read. |

---

## 8. Golden Fixture Impact

Sin impacto. Las golden fixtures testean el pipeline canonical->snapshot. La configuracion de portal no afecta el pipeline de datos ni el output de los snapshots.

---

## 9. Top 5 Riesgos

| # | Riesgo | Severidad | Mitigacion |
|---|--------|-----------|------------|
| 1 | **Rollback a codigo viejo:** Si se hace rollback despues de que el archivo ya fue migrado a `mode`, el codigo viejo no reconoce `mode` y trata todo como enabled. | Media | El comportamiento default del codigo viejo es `enabled: true` si el campo no existe. Peor caso: todo visible. Preferible a perder competencias. |
| 2 | **Admin no recarga pagina:** El admin tiene la version vieja cacheada en browser con boolean toggles. Envia patch con `{ enabled }` al backend nuevo. | Media | Backward compat en admin-router: detectar formato viejo y convertir. Ademas, el admin carga config fresca del server en cada mount. |
| 3 | **Shadow compete consume quota AF sin beneficio visible:** Una liga en shadow consume API calls sin que el usuario vea el beneficio. | Baja | El admin es quien decide poner en shadow; es una decision consciente. El panel /admin/ops muestra consumo. |
| 4 | **Migration-on-read no se dispara:** Si el servidor nunca lee el config file (crash temprano), el archivo viejo persiste. | Baja | `readConfig()` se llama en `getConfig()` que se invoca en startup (isCompetitionEnabled). La migracion ocurre inevitablemente. |
| 5 | **Inconsistencia DEFAULT_CONFIG frontend vs backend:** El DEFAULT_CONFIG del frontend es un fallback hardcodeado. Si queda desincronizado con el backend, el usuario ve datos incorrectos durante el boot. | Baja | El DEFAULT_CONFIG ya es best-effort (solo se usa hasta que el server responde). Agregar `mode` al fallback. |

---

## 10. Definition of Done

1. `server/portal-config-store.ts` exporta `CompetitionMode`, `getCompetitionMode()`, `isCompetitionActive()`, `isCompetitionPortal()`.
2. Migration-on-read: archivo con formato viejo (`enabled`) se convierte transparentemente a `mode`.
3. `server/index.ts` usa `isCompetitionActive()` en todas las ocurrencias (20+). Ningun `isCompetitionEnabled()` no-deprecated queda.
4. Admin PUT acepta `{ competitions: [{ id, mode }] }` y backward compat con `{ id, enabled }`.
5. AdminPage muestra selector de 3 estados (Portal / Shadow / Off) en lugar de toggle.
6. Frontend recibe `enabled: boolean` derivado de `mode === 'portal'` -- App.tsx funciona sin cambios.
7. Skill `.claude/commands/add-league.md` actualizado: pregunta de modo, rama portal (toca 10 archivos) vs rama shadow/disabled (toca 3 archivos), checklist TODO en Step 10 si faltan RSS/YouTube.
8. CLAUDE.md tiene seccion "League Governance" con regla de `/add-league`.
9. `pnpm build` pasa sin errores.
10. `pnpm -r test` pasa sin regresiones.
11. Smoke test post-deploy: `/api/ui/portal-config` retorna `mode` en cada competencia + `enabled` derivado.
12. Las 7 competencias existentes mantienen su comportamiento actual exacto.

---

## 11. Orden de implementacion (fases con dependencias)

```
Fase 0: portal-config-store.ts (tipos, migration, helpers)
  |
  v
Fase 1: server/index.ts (rewire isCompetitionEnabled -> isCompetitionActive)
  |
  v
Fase 2: admin-router.ts (aceptar mode en patch)
  |                                |
  v                                v
Fase 3: AdminPage.tsx          Fase 4: use-portal-config.ts
  (3-state selector)             (tipo + DEFAULT_CONFIG)
  |                                |
  +--------------------------------+
  |
  v
Fase 5: .claude/skills/add-league.md (skill)
  |
  v
Fase 6: CLAUDE.md (governance rule)
```

Fases 3 y 4 son independientes y pueden ejecutarse en paralelo.
Fases 5 y 6 son independientes del codigo y pueden ejecutarse en paralelo con 3-4.

**Agentes recomendados:**
- Fases 0-2: `backend-engineer` (Sonnet)
- Fase 3-4: `frontend-engineer` (Sonnet)
- Fases 5-6: `git-ops` (Haiku)

---

## 12. Nota sobre el skill add-league

El skill existe en `.claude/commands/add-league.md`. Tiene 10 pasos (Step 1–10) y ya cubre el flujo de agregar una liga. Los cambios de Fase 5 son quirúrgicos: agregar la pregunta de modo en Step 4, propagarla en Steps 5-6-8, actualizar Step 10 y Constraints. No reescribir el skill completo.

---

## 13. Hallazgo crítico: archivos con hardcodes fuera del skill

El skill actual toca 3 archivos. Hay **12 archivos adicionales con hardcodes** que pueden fallar silenciosamente al agregar una nueva liga. El modo determina cuáles son obligatorios.

### Archivos adicionales por modo

| Archivo | Qué hardcodea | Portal | Shadow | Disabled |
|---------|--------------|--------|--------|----------|
| `server/news/rss-source.ts` | `RSS_CONFIG[leagueKey]` — feeds RSS | **CRÍTICO** | NO aplica | NO aplica |
| `server/news/news-service.ts` | `LEAGUE_ORDER`, `LEAGUE_KEY_TO_COMPETITION_ID` | **CRÍTICO** | NO aplica | NO aplica |
| `server/video/video-sources-config.ts` | `VIDEO_SOURCES[leagueKey]` — canales YouTube | **CRÍTICO** | NO aplica | NO aplica |
| `server/video/video-service.ts` | `LEAGUE_ORDER` | Media | NO aplica | NO aplica |
| `packages/web/src/components/home/LiveCarousel.tsx` | `LEAGUE_ACCENT`, `LEAGUE_LABEL` por normalizedLeague | **CRÍTICO** | NO aplica | NO aplica |
| `packages/web/src/components/home/DailyHighlights.tsx` | `LEAGUE_ACCENT[leagueKey]` | **CRÍTICO** | NO aplica | NO aplica |
| `packages/web/src/components/eventos/EventsSection.tsx` | `CANONICAL_LEAGUES`, `ACCENT` | Media | NO aplica | NO aplica |
| `packages/web/src/utils/competition-meta.ts` | `NEWS_LEAGUE_ORDER`, `VIDEO_LEAGUE_ORDER` | Baja | NO aplica | NO aplica |
| `packages/web/src/labs/PredictionsLabPage.tsx` | Lista de competitionIds habilitadas | Media | Media | NO aplica |
| `server/tournament-config.ts` | `TournamentConfig` (solo si archetype knockout/groups) | Condicional | Condicional | NO aplica |

**Regla:** En modo `shadow`, la liga no aparece en el portal. No se necesitan RSS, videos, colores UI ni orden de listas. Solo importan los datos de predicción — y esos se generan automáticamente desde el registry.

### Consecuencias de omitir (modo portal)

- Sin `RSS_CONFIG`: noticias completamente ausentes — **falla silenciosa**
- Sin `VIDEO_SOURCES`: bloque de video vacío — **falla silenciosa**
- Sin `LEAGUE_ACCENT` en LiveCarousel: colores genéricos — **degradación visual**
- Sin `LEAGUE_ACCENT` en DailyHighlights: sin color de tema — **degradación visual**
- Sin `CANONICAL_LEAGUES` en EventsSection: eventos solo desde streamtp10 — **datos incompletos**
- Sin `tournament-config.ts` (si es torneo): fases no funcionan — **falla funcional**

### Impacto en el skill add-league (Fase 5 actualizada)

Los cambios al skill deben contemplar **dos ramas según el modo**:

**Si mode = shadow o disabled:**
- El skill toca los mismos 3 archivos actuales (registry + xg-source + use-portal-config)
- NO tocar RSS, videos, colores UI — la liga no se muestra
- Step 10 (next steps): no mencionar activación en portal

**Si mode = portal:**
- El skill debe ampliar su scope para cubrir también:
  1. `server/news/rss-source.ts` — preguntar feeds RSS (o marcar como pendiente si no se tienen)
  2. `server/video/video-sources-config.ts` — preguntar canal YouTube (o marcar como pendiente)
  3. `packages/web/src/components/home/LiveCarousel.tsx` — solo si Objetivo D no implementado (post-D: auto)
  4. `packages/web/src/components/home/DailyHighlights.tsx` — solo si Objetivo D no implementado
  5. `packages/web/src/components/eventos/EventsSection.tsx` — solo si Objetivo D no implementado
  6. `packages/web/src/utils/competition-meta.ts` — solo si Objetivo D no implementado
  7. Si archetype knockout/groups: `server/tournament-config.ts`

Si el usuario no tiene los datos de RSS/YouTube al momento de ejecutar el skill, el skill puede marcar esos pasos como **TODO** y generar un checklist explícito en el report final (Step 10), para que no queden olvidados.

### Archivos que se auto-derivan del registry (NO requieren edición manual)

- `server/api-football-canonical-source.ts` → `AF_COMPETITION_CONFIGS` (auto)
- `server/incidents/apifootball-incident-source.ts` → `AF_CANONICAL_LEAGUE_MAP` (auto)
- `server/portal-config-store.ts` → `CATALOG_DEFAULTS` (auto)
- `packages/web/src/utils/competition-meta.ts` → mapas de compId→newsKey, compId→normalizedLeague (auto desde DEFAULT_CONFIG)
