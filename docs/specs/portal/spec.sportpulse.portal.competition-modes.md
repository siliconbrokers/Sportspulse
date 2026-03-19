# spec.sportpulse.portal.competition-modes

**Version:** 1.0
**Status:** IMPLEMENTED (2026-03-20)
**Plan:** memory/plans/SP-COMP-MODES.md

---

## Scope

Este spec define el sistema de 3 estados de competencias para el portal SportPulse. Reemplaza el campo `enabled: boolean` por `mode: CompetitionMode` que desacopla cuatro concerns actualmente fusionados: portal display, data fetching, V3 prediction y NEXUS shadow.

---

## CompetitionMode

```typescript
type CompetitionMode = 'portal' | 'shadow' | 'disabled';
```

| Estado | Portal display | AF data fetching | V3 prediction | NEXUS shadow |
|--------|:-:|:-:|:-:|:-:|
| `portal` | SÍ | SÍ | SÍ | SÍ |
| `shadow` | NO | SÍ | SÍ | SÍ |
| `disabled` | NO | NO | NO | NO |

---

## API pública — `server/portal-config-store.ts`

```typescript
// Tipo exportado
type CompetitionMode = 'portal' | 'shadow' | 'disabled';

// Helpers
function getCompetitionMode(competitionId: string): CompetitionMode
function isCompetitionActive(competitionId: string): boolean   // mode !== 'disabled'
function isCompetitionPortal(competitionId: string): boolean   // mode === 'portal'
function getActiveCompetitions(): CompetitionConfig[]          // portal + shadow
function getEnabledCompetitions(): CompetitionConfig[]         // @deprecated alias de getActiveCompetitions
```

---

## Migration-on-read

Al leer `cache/portal-config.json` con formato viejo (`enabled: boolean`), convertir automáticamente:
- `enabled: true` → `mode: 'portal'`
- `enabled: false` → `mode: 'disabled'`

La primera escritura (admin save) persiste el nuevo formato. No se requiere script de migracion.

---

## Backward compatibility

El endpoint `GET /api/ui/portal-config` sigue devolviendo `enabled: boolean` como campo derivado (`enabled: mode === 'portal'`) para que el frontend funcione sin cambios en App.tsx.

El admin `PUT /api/admin/config` acepta tanto `{ id, mode }` (nuevo) como `{ id, enabled }` (backward compat).

---

## Invariantes

- Una competencia en `shadow` NUNCA aparece en el portal pero SÍ acumula datos y predicciones.
- Una competencia en `disabled` NO genera ningún request a AF ni a ningún proveedor.
- `isCompetitionActive()` (portal + shadow) se usa en todo el backend para data fetching y predicción.
- `isCompetitionPortal()` se usa exclusivamente para filtrar qué se muestra al usuario.

---

## Archivos afectados

| Archivo | Cambio |
|---------|--------|
| `server/portal-config-store.ts` | Tipo CompetitionMode + helpers + migration-on-read |
| `server/index.ts` | 21 call-sites: `isCompetitionEnabled` → `isCompetitionActive` |
| `server/admin-router.ts` | Acepta `mode` en PATCH + backward compat |
| `packages/web/src/admin/AdminPage.tsx` | Segmented control 3-estados |
| `packages/web/src/hooks/use-portal-config.ts` | Tipo + DEFAULT_CONFIG con `mode` |
| `.claude/commands/add-league.md` | Pregunta de modo + capability declaration |
| `CLAUDE.md` | Regla League Governance |

---

## Admin UI

El `/admin` muestra un selector de 3 estados por competencia:
- **Portal** (verde) — visible para usuarios
- **Shadow** (ámbar) — datos activos, no visible
- **Off** (gris) — completamente desactivado

---

## Governance

Toda adición de liga DEBE ejecutarse via `/add-league`. El skill pregunta el `mode` inicial en Step 4 y propaga el valor a todos los archivos necesarios.

---

## Feature: Capability Declaration

El skill `/add-league` declara qué features funcionan al nivel completo, qué features estarán degradadas, y cuáles no estarán disponibles para la liga que se está agregando. El usuario decide de todas formas si continuar. No hay bloqueos forzados salvo condiciones duras (sin datos históricos en AF).
