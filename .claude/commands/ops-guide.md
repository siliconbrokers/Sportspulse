# /ops-guide — SportsPulse League Operations Quick Reference

When this skill is invoked, show the full operational guide from `docs/guides/league-operations-guide.md`.

## Behavior

1. Read `docs/guides/league-operations-guide.md`
2. Present its content to the user
3. Ask: "¿Querés ir directo a alguna sección? (1=Agregar liga, 2=Calibrar V3, 3=Calibrar NEXUS, 4=Activar todo, 5=Ver métricas, 6=Interpretar métricas, 7=Gate de promoción, 8=Flujo completo)"
4. If the user picks a section, scroll to it and expand with context from the current project state (read competition-registry.ts, .env, etc. if relevant)
5. If the user asks "¿cómo está ahora?", read the current `.env` and `server/competition-registry.ts` to show the live state

## Quick links

- Agregar liga → `/add-league`
- Calibrar → `/calibrate-league`
- Gobernanza → `/governance`
- Guía completa → `docs/guides/league-operations-guide.md`
