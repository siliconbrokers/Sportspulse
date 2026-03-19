# Plan Files Index

Central registry of all plan files in `memory/plans/`. Updated as plans are created or transitioned.

---

## Phase Index (MVP Phase 0-15)

| Phase | Feature | Status | Plan File |
|-------|---------|--------|-----------|
| Phase 0-10 | Portal core + UI Polish | ✅ DONE | (archived) |
| Phase 11 | Noticias (NEWS-01 to NEWS-05) | ✅ DONE | (archived) |
| Phase 12 | Video Highlights (VIDEO-01) | ✅ DONE | (archived) |
| Phase 13 | Eventos (EVENT-01 to EVENT-04) | ✅ DONE | (archived) |
| Phase 14 | Matchday File Cache (v1.1) | ✅ DONE | (archived) |
| Phase 15 | **SP-COMP-MODES** — 3 estados competencias | ✅ DONE (2026-03-20) | `SP-COMP-MODES.md` |

---

## Active Plans by Task ID

| Task ID | Description | Plan File | Status |
|---------|-------------|-----------|--------|
| SP-COMP-MODES | Sistema 3 estados (portal/shadow/disabled) | `SP-COMP-MODES.md` | ✅ Fases 0-6 DONE |
| SP-NEXUS | Predictive Engine V2 (NEXUS) | `SP-NEXUS.md` | ✅ DONE |
| SP-PRED-V3 | Predictive Engine V3 (frozen) | `SP-PRED-V3.md` | ✅ FROZEN (acc=55.7%) |
| PE-fix-prob-win-floor | Apply 1% probability floor to 1X2 outcomes | `PE-fix-prob-win-floor.md` | ⏳ Stage 2 (design) |
| SP-CALIBRATE-LEAGUE | Generic league calibration workflow | `SP-CALIBRATE-LEAGUE.md` | ⏳ Stage 2 (design) |

---

## Pending Objectives (SP-COMP-MODES future phases)

| Phase | Objective | Description | Target |
|-------|-----------|-------------|--------|
| Phase 7 | **Objetivo B** — Arquitectura extensible de formatos | Reemplazar flags hardcodeados (`isTournament`, `hasSubTournaments`) por `archetype` + `competitionPhases[]` | post-Phase 6 |
| Phase 8 | **Objetivo D** — Eliminar hardcodes de frontend | Derivar colores, labels, órdenes desde portal-config en lugar de mapas locales | post-Phase 7 |

---

## Observation Plans

| Name | File | Status |
|------|------|--------|
| Track A (Runtime PE observation) | `pe-observation-plan.md` | ✅ OPEN (cron 10min) |
| PE-CTI Forward Validation | `pe-cti-forward-validation.md` | ✅ OPEN |

---

## Archive Refs (legacy, non-authoritative for implementation)

- `memory/task-graph.md` — Dependency graph for Phases 0-9 (legacy)
- `memory/subagent-prompts.md` — Reference prompts for governance + implementation agents
- `.claude/commands/governance.md` — Governance audit + correction wizard
