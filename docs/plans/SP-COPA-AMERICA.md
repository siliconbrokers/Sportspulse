# Plan: Copa América — Primer torneo PE-nativo
## Tier recomendado: Sonnet (implementación sigue patrones, plan aprobado)
## Estado: DISEÑADO, pendiente implementación

---

## Contexto

Copa América es el segundo torneo en el portal después del WC 2026.
Diferencia clave: mientras WC usa lógica de ranking propia en `server/`,
Copa América inaugurará el uso del **PE competition engine** como fuente
de verdad para rankings de grupos y bracket.

Las 4 ligas y el WC no se tocan.

---

## Datos del torneo

- **Próxima edición**: Copa América 2027 (fecha exacta por confirmar)
- **football-data.org competition code**: `'CA'` (verificar: puede ser `'COPA_AMERICA'`)
- **Formato**: 4 grupos × 4 equipos → top 2 por grupo → cuartos → semis → final + tercer puesto
- **bestThirdsCount**: 0 (no hay mejores terceros, solo top 2 de cada grupo)
- **Partidos**: todos a partido único (no hay ida y vuelta)
- **Equipos**: 16 (CONMEBOL + invitados CONCACAF)

---

## Decisiones arquitectónicas

### 1. Configuración de torneos (`TournamentConfig`)

Crear `server/tournament-config.ts` con una interfaz que parametriza
todo lo que hoy está hardcodeado en `FootballDataTournamentSource`:

```typescript
export interface TournamentConfig {
  competitionCode: string;   // código football-data.org ('WC', 'CA', ...)
  providerKey: string;       // para canonical IDs (ej: 'football-data-wc', 'football-data-ca')
  formatFamily: string;      // string para el frontend (GroupStandingsView)
  bestThirdsCount: number;   // 0 = ningún tercero, 8 = WC 2026
  usePERanking: boolean;     // true = usar PE rankGroup(), false = standings API
  startDate?: string;        // ISO date, para banner pre-torneo ('2027-XX-XX')
  nameEs: string;            // nombre para logs ('Copa del Mundo 2026', 'Copa América 2027')
}

export const WC_CONFIG: TournamentConfig = {
  competitionCode: 'WC',
  providerKey: 'football-data-wc',
  formatFamily: 'GROUP_STAGE_PLUS_KNOCKOUT_WITH_BEST_THIRDS',
  bestThirdsCount: 8,
  usePERanking: false,   // WC usa standings API (ya funciona, no tocar)
  startDate: '2026-06-11',
  nameEs: 'Copa del Mundo 2026',
};

export const CA_CONFIG: TournamentConfig = {
  competitionCode: 'CA',
  providerKey: 'football-data-ca',
  formatFamily: 'GROUP_STAGE_PLUS_KNOCKOUT',
  bestThirdsCount: 0,
  usePERanking: true,    // CA usa PE rankGroup() como fuente de verdad
  startDate: '2027-XX-XX',  // actualizar cuando esté confirmado
  nameEs: 'Copa América 2027',
};
```

### 2. Refactor de `FootballDataTournamentSource` (backward-compatible)

Cambiar el constructor para aceptar `TournamentConfig` como segundo parámetro.
El WC en `server/index.ts` pasa `WC_CONFIG` explícitamente → mismo comportamiento que hoy.

```typescript
constructor(apiToken: string, config: TournamentConfig, baseUrl?: string) {
  this.config = config;
  this.competitionId = canonicalCompId(config.providerKey, config.competitionCode);
  // ...
}
```

`getGroupView()` usa `config.formatFamily` y `config.bestThirdsCount` en lugar de valores hardcodeados.

Cuando `config.usePERanking === true`, el método de derivación de standings
llama a PE en lugar de usar la standings API de football-data.org.

### 3. Integración PE para Copa América

Flujo cuando `usePERanking: true`:

```
football-data.org /matches (raw)
       ↓
  extraer MatchResult[] por grupo
       ↓
  PE: rankGroup(groupData, caCompetitionProfile)
       ↓
  StandingEntry[] → cache → getGroupView()
```

**Contratos PE que se usan** (NO se pasa CompetitionProfile completo a rankGroup):

```typescript
// rankGroup toma GroupData + GroupRankingRules (NO CompetitionProfile completo)
// Firma: rankGroup(group: GroupData, rules: GroupRankingRules, seed?: number)

// GroupData (input por grupo):
interface GroupData {
  group_id: string;          // opaque, ej: 'group:stage:ca:0'
  team_ids: readonly string[];
  matches: readonly MatchResult[];  // match_id, home_team_id, away_team_id, home_score|null, away_score|null
}

// GroupRankingRules para Copa América (CONMEBOL tiebreaker estándar):
const CA_GROUP_RANKING_RULES: GroupRankingRules = {
  points_win: 3,
  points_draw: 1,
  points_loss: 0,
  // Orden CONMEBOL: puntos → H2H pts → H2H GD → H2H GF → GD global → GF global → sorteo
  rank_by: [
    'POINTS',
    'HEAD_TO_HEAD_POINTS',
    'HEAD_TO_HEAD_GOAL_DIFFERENCE',
    'HEAD_TO_HEAD_GOALS_FOR',
    'GOAL_DIFFERENCE',
    'GOALS_FOR',
    'DRAW_LOT',
  ] as const,
};

// TieBreakRules (campos exactos del tipo — distintos a GroupRankingRules):
const CA_TIE_BREAK_RULES: TieBreakRules = {
  use_head_to_head: true,
  use_goal_difference: true,
  use_goals_for: true,
  use_fair_play: false,
  final_fallback: 'DRAW_LOT',
};

// QualificationRules para grupos CA:
const CA_QUALIFICATION_RULES: QualificationRules = {
  qualified_count_per_group: 2,
  best_thirds_count: 0,
  allow_cross_group_third_ranking: false,
  bracket_mapping_definition: null,
};
```

**CompetitionProfile completo** (usado por el predictor de partidos, no por rankGroup):
```typescript
// packages/prediction/src/competition/profiles/copa-america.ts
export const CA_GROUP_STAGE_PROFILE: CompetitionProfile = {
  competition_profile_version: '1.0.0-ca-group',
  team_domain: 'NATIONAL_TEAM',
  competition_family: 'NATIONAL_TEAM_TOURNAMENT',
  stage_type: 'GROUP_STAGE',
  format_type: 'GROUP_CLASSIC',
  leg_type: 'SINGLE',
  neutral_venue: false,           // ← campo correcto (no 'is_neutral_venue')
  group_ranking_rules: CA_GROUP_RANKING_RULES,
  qualification_rules: CA_QUALIFICATION_RULES,
  tie_break_rules: CA_TIE_BREAK_RULES,
  knockout_resolution_rules: null,
};

export const CA_KNOCKOUT_PROFILE: CompetitionProfile = {
  competition_profile_version: '1.0.0-ca-knockout',
  team_domain: 'NATIONAL_TEAM',
  competition_family: 'NATIONAL_TEAM_TOURNAMENT',
  stage_type: 'QUARTER_FINAL',    // se instancia por ronda; reusar con stage_type variable
  format_type: 'KNOCKOUT_SINGLE_LEG',
  leg_type: 'SINGLE',
  neutral_venue: true,            // Copa América en sede única → venue neutral
  knockout_resolution_rules: {
    single_leg_resolution_order: ['EXTRA_TIME', 'PENALTIES'],
    final_overrides_prior_round_rules: false,
  },
};
```

Este perfil es el **catálogo inaugural** — el primer `CompetitionProfile` real
que existe en el codebase fuera de los tests del PE.

---

## Incompatibilidades encontradas y corregidas (vs plan original)

| # | Error en plan original | Corrección |
|---|---|---|
| 1 | `TEAM_ID_ASC` en `rank_by` | No existe ese criterio — usar `DRAW_LOT` como último paso |
| 2 | `head_to_head_applicable_from_rank` en GroupRankingRules | Campo inexistente — no está en el tipo |
| 3 | `apply_head_to_head`, `min_teams_for_h2h`, `max_teams_for_h2h` en TieBreakRules | Campos incorrectos — los correctos son `use_head_to_head`, `use_goal_difference`, `use_goals_for`, `use_fair_play`, `final_fallback` |
| 4 | `is_neutral_venue` en CompetitionProfile | El campo se llama `neutral_venue` |
| 5 | `competition_id`, `season_id`, `group_id` en CompetitionProfile | Esos campos NO existen en CompetitionProfile — van en MatchInput y GroupData respectivamente |

### 4. Parametrizar banner pre-torneo

`GroupStandingsView` recibe `startDate?: string` como prop (nuevo campo opcional).
Si no hay `startDate`, no muestra el banner (safe default).
`competition-meta.ts` agrega `startDate` a la entrada CA y WC.
`TournamentView` pasa `startDate` a `GroupStandingsView`.

---

## Archivos a crear

| Archivo | Qué hace |
|---|---|
| `server/tournament-config.ts` | TournamentConfig interface + WC_CONFIG + CA_CONFIG |
| `packages/prediction/src/competition/profiles/copa-america.ts` | CompetitionProfile CA (catálogo inaugural) |

---

## Archivos a modificar

| Archivo | Cambio |
|---|---|
| `server/football-data-tournament-source.ts` | Constructor acepta TournamentConfig; usa config.formatFamily/bestThirdsCount; branch usePERanking |
| `server/index.ts` | WC usa WC_CONFIG; crear CASource con CA_CONFIG; registrar rutas CA; COMP_LEAGUE_KEY[CA] |
| `packages/web/src/App.tsx` | Agregar CA a COMPETITIONS |
| `packages/web/src/utils/competition-meta.ts` | Agregar CA + campo startDate en interfaz |
| `packages/web/src/components/TournamentView.tsx` | Recibe startDate prop, pasa a GroupStandingsView |
| `packages/web/src/components/GroupStandingsView.tsx` | Recibe startDate prop; banner condicional usa startDate en lugar de "11 Jun 2026" |
| `packages/web/src/components/home/LiveCarousel.tsx` | LEAGUE_ACCENT + LEAGUE_LABEL + CANONICAL_LEAGUES para 'COPA_AMERICA' |
| `server/news/types.ts` | Agregar 'CA' a LeagueKey |
| `server/news/gnews-source.ts` | Config CA |
| `server/news/news-service.ts` | LIMITS + LEAGUE_ORDER + COMPETITION_LABELS para CA |
| `server/news/news-cache.ts` | TTL_MS para CA |
| `server/video/video-sources-config.ts` | Extender LeagueKey + config CA (searchOnly) |
| `server/video/video-service.ts` | LEAGUE_ORDER para CA |

---

## Fases de implementación

### Fase 1 — TournamentConfig + refactor backward-compatible (no PE)
- Crear `server/tournament-config.ts`
- Modificar `FootballDataTournamentSource` para aceptar config
- WC en server/index.ts pasa WC_CONFIG (mismos valores → sin cambio de comportamiento)
- Build + test

### Fase 2 — CompetitionProfile CA (catálogo PE)
- Crear `packages/prediction/src/competition/profiles/copa-america.ts`
- Exportar desde `packages/prediction/src/index.ts` (o competition/index.ts)
- Tests unitarios del perfil (validador PE)

### Fase 3 — Integración PE ranking en footbal-data-tournament-source
- Implementar el branch `usePERanking: true` en el source
- Convertir MatchResult[] de football-data.org al formato `GroupData` del PE
- Llamar `rankGroup()` del PE, convertir resultado a `StandingEntry[]`
- El fallback cuando los partidos no están jugados: standings vacías (todos 0)

### Fase 4 — Portal: registrar CA + UI parametrizada
- server/index.ts: CASource + rutas + COMP_LEAGUE_KEY
- App.tsx, competition-meta (+ startDate), TournamentView, GroupStandingsView
- LiveCarousel, news, video

---

## Invariantes de seguridad

1. **WC no se toca en comportamiento** — solo se le pasa WC_CONFIG explícitamente
2. **Las 4 ligas son inaccesibles** desde este flujo — no hay paths compartidos
3. **usePERanking=false para WC** — si PE da problemas en CA, el fallback es obvio
4. **Catálogo PE es read-only** — `copa-america.ts` exporta un objeto frozen, no hay mutación
5. **`startDate` es opcional** — `GroupStandingsView` no muestra banner si `undefined`

---

## Verificar antes de implementar

- [ ] Confirmar competition code CA en football-data.org (puede ser `'CA'` o `'COPA_AMERICA'` o ID numérico `2016`)
- [ ] Verificar que TIER_ONE incluye Copa América en football-data.org
- [ ] Confirmar fecha de Copa América 2027 para `startDate`
- [ ] Verificar si Copa América 2027 tendrá el mismo formato que 2024 (4 grupos × 4)

---

## Nota sobre SP-TOURNAMENTS.md

El plan anterior (`SP-TOURNAMENTS.md`) diseñó la evolución de `packages/canonical`
con nuevas entidades (Stage, Group, Tie, etc.). Eso sigue siendo válido a largo plazo,
pero **no es prerequisito** para Copa América. Copa América puede implementarse
manteniendo el approach actual de `FootballDataTournamentSource` refactorizado,
con PE como source de verdad para rankings. La migración a canonical entities
es trabajo futuro independiente.
