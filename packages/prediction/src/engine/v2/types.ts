/**
 * types.ts — Motor Predictivo V2: tipos de dominio.
 *
 * Tipos autónomos del V2. Sin dependencia de tipos V1 de Elo.
 * Spec: §4, §6, §13, §14, §16
 */

// ── Datos de partidos ────────────────────────────────────────────────────────

/**
 * Partido terminado con goles. Comparte estructura con FinishedMatchRecord de V1
 * pero es un tipo local independiente para que V2 no acople a V1.
 */
export interface V2MatchRecord {
  homeTeamId: string;
  awayTeamId: string;
  /** ISO-8601 UTC kickoff. */
  utcDate: string;
  homeGoals: number;
  awayGoals: number;
}

// ── Stats del equipo (§4.1) ──────────────────────────────────────────────────

/** Stats acumulados de un equipo en una temporada. */
export interface TeamStats {
  teamId: string;
  pj_total: number;
  pj_home: number;
  pj_away: number;
  gf_total: number;
  gc_total: number;
  gf_home: number;
  gc_home: number;
  gf_away: number;
  gc_away: number;
}

// ── Tasas observadas (§5) ────────────────────────────────────────────────────

/** Goles por partido observados (raw, sin shrinkage). */
export interface ObservedRates {
  gf_pg_total: number;
  gc_pg_total: number;
  gf_pg_home: number;
  gc_pg_home: number;
  gf_pg_away: number;
  gc_pg_away: number;
}

// ── Baselines de liga (§4.3) ─────────────────────────────────────────────────

/** Tasas promedio de goles en la liga (necesarias para el prior y el modelo). */
export interface LeagueBaselines {
  league_home_goals_pg: number;
  league_away_goals_pg: number;
  league_goals_pg: number;
}

// ── Prior estructural (§6) ───────────────────────────────────────────────────

/** Calidad del prior. §6.2 */
export type PriorQuality = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

/** Fuente del prior. §6.3 */
export type PriorSource = 'PREV_SEASON' | 'PARTIAL' | 'LOWER_DIVISION' | 'LEAGUE_BASELINE';

/** Prior estructural completo de un equipo. §6.1 */
export interface TeamPrior {
  attack_prior_total: number;
  defense_prior_total: number;
  attack_prior_home: number;
  defense_prior_home: number;
  attack_prior_away: number;
  defense_prior_away: number;
  prior_quality: PriorQuality;
  prior_source: PriorSource;
}

// ── Señales por partido (§8) ─────────────────────────────────────────────────

/** Señal ofensiva/defensiva de un partido ajustada por rival. */
export interface MatchSignal {
  utcDate: string;
  attack_signal: number;
  defense_signal: number;
}

// ── Recencia (§9) ────────────────────────────────────────────────────────────

/** Deltas de forma reciente. Neutro = 1.0. */
export interface RecentFormDeltas {
  effective_recent_attack_delta: number;
  effective_recent_defense_delta: number;
  /** Número de partidos usados para la ventana de recencia (máx 5). */
  n_recent: number;
}

// ── Elegibilidad (§13) ───────────────────────────────────────────────────────

export type V2EligibilityStatus = 'ELIGIBLE' | 'LIMITED' | 'NOT_ELIGIBLE';

// ── Confianza (§14) ──────────────────────────────────────────────────────────

export type V2ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';

// ── Efecto de muestra (campo explicativo) ────────────────────────────────────

export type SampleSizeEffect = 'LOW' | 'MEDIUM' | 'HIGH';

// ── Output V2 (§16) ──────────────────────────────────────────────────────────

/**
 * Output completo del Motor Predictivo V2.
 * Todos los campos son obligatorios (spec §16).
 */
export interface V2PredictionOutput {
  engine_version: 'v2_structural_attack_defense';
  eligibility_status: V2EligibilityStatus;
  confidence_level: V2ConfidenceLevel;
  prior_quality: PriorQuality;
  prior_source: PriorSource;
  lambda_home: number;
  lambda_away: number;
  prob_home_win: number;
  prob_draw: number;
  prob_away_win: number;
  explanation: {
    effective_attack_home: number;
    effective_defense_home: number;
    effective_attack_away: number;
    effective_defense_away: number;
    recent_attack_delta_home: number;
    recent_defense_delta_home: number;
    recent_attack_delta_away: number;
    recent_defense_delta_away: number;
    sample_size_effect: SampleSizeEffect;
    rival_adjustment_used: boolean;
    recent_form_used: boolean;
    /** Per-team prior detail (§6). Top-level prior_quality/prior_source are aggregates. */
    prior_quality_home: PriorQuality;
    prior_quality_away: PriorQuality;
    prior_source_home: PriorSource;
    prior_source_away: PriorSource;
  };
}

// ── Input al motor V2 ────────────────────────────────────────────────────────

/**
 * Input al motor V2. La separación de temporadas es responsabilidad del caller.
 * Anti-lookahead: el caller debe pasar currentSeasonMatches sin el partido objetivo.
 */
export interface V2EngineInput {
  homeTeamId: string;
  awayTeamId: string;
  kickoffUtc: string;
  /** Partidos de la temporada actual (el caller garantiza utcDate < kickoffUtc). */
  currentSeasonMatches: V2MatchRecord[];
  /** Partidos de la temporada anterior (para prior). Puede estar vacío. */
  prevSeasonMatches: V2MatchRecord[];
}
