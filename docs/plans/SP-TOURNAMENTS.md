# Plan: Evolución del modelo de competiciones
## Refs: Spec 1 + Documento 2 (docs/specs/)
## Tier recomendado: Sonnet (implementación sigue patrones, plan ya aprobado)

---

## Contexto

Extender `packages/canonical` para soportar cuatro familias de formato:
- `LEAGUE_TABLE` (CONMEBOL)
- `GROUP_STAGE_PLUS_KNOCKOUT` (Libertadores)
- `GROUP_STAGE_PLUS_KNOCKOUT_WITH_BEST_THIRDS` (WC 2026, AFCON)
- `LEAGUE_PHASE_PLUS_KNOCKOUT` (Champions UCL)

**Principio:** extender el modelo existente, no reescribirlo. Todo nuevo campo es `?: T` (opcional) para no romper ligas actuales.

---

## Estado del modelo actual (auditado)

| Entidad Doc 2 | Equivalente actual | Estado |
|---|---|---|
| `CompetitionEdition` | `Competition` + `Season` | Parcial — `Season` = edición, sin `formatFamily` |
| `Participant` | `Team` | OK — renombrar no requerido, es alias semántico |
| `Stage` | No existe | ❌ Crear |
| `Group` | No existe | ❌ Crear |
| `StandingTable` | Implícito en `StandingEntry[]` | Formalizar como wrapper |
| `StandingRow` | `StandingEntry` | OK — extender con `groupId?`, `statusBadge?` |
| `Match` | `Match` | Extender con `groupId?`, `stageId?`, `tieId?`, scores ET/PKs, `winnerParticipantId?` |
| `Tie` | No existe | ❌ Crear |
| `TieSlot` | No existe | ❌ Crear |

---

## Fases de implementación

### FASE 1 — Enums + tipos base en canonical (Sonnet / backend-engineer)

**Archivo:** `packages/canonical/src/model/enums.ts`

Agregar:
```ts
export const FormatFamily = {
  LEAGUE_TABLE: 'LEAGUE_TABLE',
  GROUP_STAGE_PLUS_KNOCKOUT: 'GROUP_STAGE_PLUS_KNOCKOUT',
  GROUP_STAGE_PLUS_KNOCKOUT_WITH_BEST_THIRDS: 'GROUP_STAGE_PLUS_KNOCKOUT_WITH_BEST_THIRDS',
  LEAGUE_PHASE_PLUS_KNOCKOUT: 'LEAGUE_PHASE_PLUS_KNOCKOUT',
} as const;

export const StageType = {
  LEAGUE: 'LEAGUE',
  GROUP_STAGE: 'GROUP_STAGE',
  ROUND_OF_32: 'ROUND_OF_32',
  ROUND_OF_16: 'ROUND_OF_16',
  QUARTER_FINALS: 'QUARTER_FINALS',
  SEMI_FINALS: 'SEMI_FINALS',
  FINAL: 'FINAL',
  PLAYOFF: 'PLAYOFF',
  CUSTOM: 'CUSTOM',
} as const;

export const StandingScope = { STAGE: 'STAGE', GROUP: 'GROUP' } as const;
export const SlotRole = { A: 'A', B: 'B' } as const;
```

**Archivo:** `packages/canonical/src/model/entities.ts`

Agregar:
```ts
export interface Stage {
  stageId: string;                  // "stage:{editionId}:{orderIndex}"
  competitionEditionId: string;     // = seasonId del modelo actual
  name: string;
  stageType: StageType;
  orderIndex: number;
  hasStandings: boolean;
  hasBracket: boolean;
  metadataJson?: string | null;
}

export interface Group {
  groupId: string;                  // "group:{stageId}:{letter}"
  stageId: string;
  name: string;                     // "Group A"
  orderIndex: number;
  metadataJson?: string | null;
}

export interface StandingTable {
  standingTableId: string;
  competitionEditionId: string;
  stageId: string;
  groupId?: string | null;
  scope: StandingScope;
  updatedAt?: string | null;
}

export interface Tie {
  tieId: string;                    // "tie:{stageId}:{orderIndex}"
  competitionEditionId: string;
  stageId: string;
  name: string;                     // "Quarter-final 1"
  roundLabel: string;               // "QF"
  orderIndex: number;
  metadataJson?: string | null;
}

export interface TieSlot {
  slotId: string;                   // "slot:{tieId}:{role}"
  tieId: string;
  slotRole: SlotRole;               // A | B
  participantId?: string | null;    // teamId si ya está definido
  placeholderText?: string | null;  // "Winner Group A"
  sourceMatchId?: string | null;    // navegación interna
  metadataJson?: string | null;
}
```

Extender entidades existentes:
```ts
// Match — agregar campos opcionales
export interface Match {
  // ... campos existentes sin cambio ...
  stageId?: string | null;          // NUEVO
  groupId?: string | null;          // NUEVO
  tieId?: string | null;            // NUEVO
  scoreHomeExtraTime?: number | null; // NUEVO
  scoreAwayExtraTime?: number | null; // NUEVO
  scoreHomePenalties?: number | null; // NUEVO
  scoreAwayPenalties?: number | null; // NUEVO
  winnerTeamId?: string | null;     // NUEVO
}

// Season — agregar formatFamily
export interface Season {
  // ... campos existentes sin cambio ...
  formatFamily?: FormatFamily;      // NUEVO — undefined = LEAGUE_TABLE (compat)
}
```

**Extender StandingEntry** en `packages/snapshot/src/data/data-source.ts`:
```ts
export interface StandingEntry {
  // ... campos existentes sin cambio ...
  groupId?: string;                 // NUEVO — undefined para ligas
  statusBadge?: string | null;      // NUEVO — "CHAMPION", "UCL", "RELEGATED", etc.
}
```

**Extender DataSource interface:**
```ts
export interface DataSource {
  // ... métodos existentes sin cambio ...
  getStages?(competitionEditionId: string): Stage[];
  getGroups?(stageId: string): Group[];
  getTies?(stageId: string): Tie[];
  getTieSlots?(tieId: string): TieSlot[];
  getStandingTables?(competitionEditionId: string): StandingTable[];
  // getStandings extendido con groupId opcional:
  getStandings?(competitionId: string, groupId?: string): StandingEntry[];
}
```

**Entregable:** todo en `packages/canonical` + `packages/snapshot/src/data/data-source.ts`. Sin lógica nueva, solo tipos.

**Validación:** `pnpm build` debe pasar sin errores. Los sources existentes (FD, SDB, OLG) no tocan los nuevos métodos — TypeScript OK porque son `?` en la interface.

---

### FASE 2 — Exports en index.ts de canonical (Sonnet / backend-engineer)

Agregar exports de todos los tipos y enums nuevos en `packages/canonical/src/index.ts`.

---

### FASE 3 — Tests de tipos (Sonnet / backend-engineer)

Verificar que el modelo existente sigue pasando. No hay golden fixtures impactados (campos nuevos son opcionales).

---

### FASE 4 — Adapters por torneo (bloqueado hasta confirmar APIs)

Pendiente: confirmar fuente de datos para CONMEBOL, Libertadores, WC 2026, AFCON, UCL.

Cuando esté confirmado: crear `TournamentDataSource` base que implementa `DataSource` con soporte a `getStages`, `getGroups`, `getTies`, `getTieSlots`.

---

### FASE 5 — Proyección de mejores terceros (Sonnet / backend-engineer)

```ts
// packages/snapshot/src/derivation/best-thirds.ts
function computeBestThirds(
  standings: StandingEntry[],
  count: number
): StandingEntry[]
// Criterio: pts → GD → GF → alphabetical teamName (determinista)
```

---

### FASE 6 — API routes nuevas (Sonnet / backend-engineer)

- `GET /api/ui/stages?competitionId=` → `Stage[]`
- `GET /api/ui/groups?stageId=` → `Group[]`
- `GET /api/ui/bracket?stageId=` → `{ ties: Tie[], slots: TieSlot[] }`
- `GET /api/ui/standings?competitionId=&groupId=` → extender el existente

---

### FASE 7 — UI nueva (Sonnet / frontend-engineer)

- `GroupStandingsView` — N tablas una por grupo, responsive
- `KnockoutBracket` — cruces básicos con slots (TBD o equipo), responsive
- Extender `App.tsx` para renderizar vistas según `formatFamily`

---

## Agentes asignados

| Fase | Agente | Modelo | Archivos objetivo |
|---|---|---|---|
| 1 — Enums + tipos | `backend-engineer` | Sonnet | `packages/canonical/src/model/enums.ts`, `entities.ts`, `packages/snapshot/src/data/data-source.ts` |
| 2 — Exports | `backend-engineer` | Sonnet | `packages/canonical/src/index.ts` |
| 3 — Tests | `backend-engineer` | Sonnet | `packages/canonical/test/` |
| 4 — Adapters | `backend-engineer` | Sonnet | `server/tournament-source.ts` (nuevo) |
| 5 — Best thirds | `backend-engineer` | Sonnet | `packages/snapshot/src/derivation/best-thirds.ts` (nuevo) |
| 6 — API routes | `backend-engineer` | Sonnet | `packages/api/src/ui/` |
| 7 — UI | `frontend-engineer` | Sonnet | `packages/web/src/components/` |

---

## Reglas de implementación

1. Cada campo nuevo en tipos existentes es `?: T` — nunca romper tipos actuales
2. `pnpm build` debe pasar al final de cada fase
3. `pnpm -r test` al final de Fase 3
4. No implementar adapters sin confirmar API disponible
5. No tocar `packages/scoring`, `packages/signals`, `packages/layout` — no los afectan
6. `StandingEntry.groupId` undefined para ligas actuales — no hay que migrar datos (in-memory)

---

## Compatibilidad garantizada

Los sources actuales (FootballDataSource, TheSportsDbSource, OpenLigaDBSource) no implementan los métodos nuevos (`getStages`, `getGroups`, etc.) → TS OK porque son `?` en DataSource. La lógica del snapshot pipeline no cambia porque no llama a esos métodos todavía.
