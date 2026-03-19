---
name: SP-COMP-MODES — estado de implementación
description: Sistema de 3 estados de competencias (portal/shadow/disabled). IMPLEMENTADO 2026-03-20. Fases 0-6 completas.
type: project
---

# SP-COMP-MODES: Implementación Completa

Plan SP-COMP-MODES completamente implementado. Fases 0-6 done.

**Why:** Desacoplar portal display / data fetching / predicción en 3 estados, soportar cualquier liga sin tocar código de componentes, forzar que toda liga entre por `/add-league`.

**How to apply:** Feature completa. Para cambiar el modo de una liga existente: ir a `/admin` → selector de 3 estados. Para agregar una nueva liga: invocar `/add-league`.

## Estado final (2026-03-20)

- **Fase 0** ✅: `server/portal-config-store.ts` — CompetitionMode, migration-on-read, helpers
- **Fase 1** ✅: `server/index.ts` — 21 call-sites → isCompetitionActive
- **Fase 2** ✅: `server/admin-router.ts` — acepta mode + backward compat
- **Fase 3** ✅: `packages/web/src/admin/AdminPage.tsx` — segmented control 3-estados
- **Fase 4** ✅: `packages/web/src/hooks/use-portal-config.ts` — tipo + DEFAULT_CONFIG
- **Fase 5** ✅: `.claude/commands/add-league.md` — pregunta mode, TheSportsDB, capability declaration
- **Fase 6** ✅: `CLAUDE.md` — regla League Governance

## Archivos creados/actualizados

**Specs:**
- `docs/specs/portal/spec.sportpulse.portal.competition-modes.md` — spec oficial v1.0

**Backend:**
- `server/portal-config-store.ts` — CompetitionMode type + migration-on-read + helpers
- `server/index.ts` — reemplazar isCompetitionEnabled → isCompetitionActive (21 call-sites)
- `server/admin-router.ts` — acepta { mode } en PATCH + backward compat

**Frontend:**
- `packages/web/src/admin/AdminPage.tsx` — segmented control 3-estados por competencia
- `packages/web/src/hooks/use-portal-config.ts` — tipo CompetitionEntry con mode, DEFAULT_CONFIG

**Operaciones:**
- `.claude/commands/add-league.md` — skill updated: paso de modo, capability declaration, TheSportsDB integration
- `CLAUDE.md` — sección "League Governance" con regla de `/add-league`

## Próximas fases (no iniciadas)

- **Fase 7** (Objetivo B): Arquitectura extensible — archetype + competitionPhases[]
- **Fase 8** (Objetivo D): Eliminar hardcodes frontend (LiveCarousel, DailyHighlights, EventsSection)

## Capacidades por estado

| Estado | Visible | Data | Predicción | NEXUS | Uso |
|--------|---------|------|-----------|-------|-----|
| `portal` | ✅ | ✅ | ✅ | ✅ | Ligas en portal operacional |
| `shadow` | ❌ | ✅ | ✅ | ✅ | Ligas en evaluación interna |
| `disabled` | ❌ | ❌ | ❌ | ❌ | Ligas desactivadas |

## Artefactos

- **Plan:** `memory/plans/SP-COMP-MODES.md`
- **Spec:** `docs/specs/portal/spec.sportpulse.portal.competition-modes.md`
- **Index:** `memory/plans/PLAN-INDEX.md`
