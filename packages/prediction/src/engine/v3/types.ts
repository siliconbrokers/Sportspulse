/**
 * types.ts — Motor Predictivo V3: tipos de dominio.
 *
 * Spec: SP-PRED-V3-Unified-Engine-Spec.md §3, §5, §7, §14, §15, §17
 *
 * Tipos autónomos del V3. Sin dependencia de tipos V1/V2.
 */

// ── Inputs (§3) ────────────────────────────────────────────────────────────

/**
 * Partido con resultado final. Usado tanto para temporada actual como anterior.
 * Solo partidos FINISHED con scores completos deben incluirse.
 */
export interface V3MatchRecord {
  homeTeamId: string;
  awayTeamId: string;
  /** ISO-8601 UTC kickoff */
  utcDate: string;
  homeGoals: number;
  awayGoals: number;
}

/**
 * Input completo al motor V3.
 * Anti-lookahead: el motor filtra internamente utcDate < kickoffUtc en currentSeasonMatches.
 */
export interface V3EngineInput {
  homeTeamId: string;
  awayTeamId: string;
  /** ISO-8601 UTC del partido a predecir */
  kickoffUtc: string;
  /** Anchor temporal (≤ kickoffUtc). Sin IO dentro del motor. */
  buildNowUtc: string;
  /** Partidos de la temporada actual. El motor aplica anti-lookahead internamente. */
  currentSeasonMatches: V3MatchRecord[];
  /** Partidos de la temporada anterior. Puede estar vacío si no hay datos. */
  prevSeasonMatches: V3MatchRecord[];
  /**
   * Partidos esperados por equipo en una temporada completa (hint de tamaño de liga).
   * Si se provee, el motor ajusta THRESHOLD_ELIGIBLE proporcional al largo de la liga.
   * Ejemplo: EPL=38, BL1=34, URU_Clausura=15, ARG_Apertura=19.
   * Si se omite, usa el valor fijo de constants.ts (THRESHOLD_ELIGIBLE=7).
   */
  expectedSeasonGames?: number;

  // ── T3: New optional fields (§MKT-T3-00) ──────────────────────────────

  /**
   * T3-01: Historical xG data for matches in currentSeasonMatches.
   * If provided, the engine uses xG instead of actual goals in
   * computeLeagueBaselines and resolveTeamStats.
   * Partial coverage is OK: matches without a corresponding XgRecord
   * fall back to actual goals.
   */
  historicalXg?: XgRecord[];

  /**
   * T3-02: Known player absences (injuries + suspensions) for the
   * match being predicted. Applies a multiplicative adjustment to
   * lambda_home / lambda_away post-lambda computation.
   */
  injuries?: InjuryRecord[];

  /**
   * T3-03: Confirmed XI for home and/or away team.
   * Available ~1h before kickoff. Complements injuries by detecting
   * last-minute absences of regular starters.
   * Array of 0, 1, or 2 entries (one per team).
   */
  confirmedLineups?: ConfirmedLineupRecord[];

  /**
   * T3-04: Market-implied 1X2 probabilities (de-vigged).
   * Enters the prior system as an optional third component,
   * blended with the model's own 1X2 via a configurable weight.
   */
  marketOdds?: MarketOddsRecord;

  /**
   * §Cal Phase 5: Isotonic calibration table for 1X2 probabilities.
   * Generated offline by tools/gen-calibration.ts.
   * When provided, the engine applies per-class calibration followed by
   * renormalization (§16.3) AFTER the market-blend step.
   * Backward-compatible: if omitted, the engine behaves exactly as before.
   */
  calibrationTable?: CalibrationTable;

  /**
   * §SP-V4-23: Logistic model coefficients for ensemble integration.
   * When provided and ENSEMBLE_ENABLED=true, overrides DEFAULT_LOGISTIC_COEFFICIENTS.
   * Loaded from cache/logistic-coefficients.json by the shadow runner.
   * If undefined and ENSEMBLE_ENABLED=true, DEFAULT_LOGISTIC_COEFFICIENTS are used.
   */
  logisticCoefficients?: import('./logistic-model.js').LogisticCoefficients;

  /**
   * §SP-V4-23: Override ensemble weights for this engine run.
   * When provided and ENSEMBLE_ENABLED=true, overrides ENSEMBLE_WEIGHTS_DEFAULT.
   * If undefined, ENSEMBLE_WEIGHTS_DEFAULT from constants.ts is used.
   */
  ensembleWeights?: import('./ensemble.js').EnsembleWeights;

  /**
   * Internal: override specific hyperparameters for walk-forward sweep experiments.
   * NOT for production use — only used by tools/sweep-hyperparams.ts.
   * All fields optional; unset values fall back to constants.ts.
   */
  _overrideConstants?: {
    K_SHRINK?: number;
    PRIOR_EQUIV_GAMES?: number;
    BETA_RECENT?: number;
    DC_RHO?: number;
    DRAW_AFFINITY_POWER?: number;
    DRAW_LOW_SCORING_BETA?: number;
    /** §SP-V4-05: override SOS_SENSITIVITY for sweep experiments. */
    SOS_SENSITIVITY?: number;
    /** §SP-V4-23: override ENSEMBLE_ENABLED feature flag for testing. */
    ENSEMBLE_ENABLED?: boolean;
    /** §SP-V4-11: override MARKET_WEIGHT for market-blend weight sweep experiments. */
    MARKET_WEIGHT?: number;
    /** Override DRAW_AFFINITY_ALPHA (intensity of draw boost) for draw-affinity sweep experiments. */
    DRAW_AFFINITY_ALPHA?: number;
    /** Override DRAW_FLOOR (minimum p_draw to activate floor rule) for sweep experiments. */
    DRAW_FLOOR?: number;
    /** Override DRAW_MARGIN (max leader − p_draw to force DRAW) for sweep experiments. */
    DRAW_MARGIN?: number;
    /** Override TOO_CLOSE_THRESHOLD (min margin to emit a predicted_result) for sweep experiments. */
    TOO_CLOSE_THRESHOLD?: number;
    /** fix #3: override DRAW_AFFINITY_ENABLED feature flag. */
    DRAW_AFFINITY_ENABLED?: boolean;
    /** fix #3: override DRAW_FLOOR_ENABLED feature flag. */
    DRAW_FLOOR_ENABLED?: boolean;
    /**
     * §SP-V4-34: override home advantage multiplier (bypass dynamic ratio computation).
     * When set, replaces the runtime-derived ratio (league_home/league_away) with this
     * fixed value. Used by sweep-home-advantage.ts to evaluate per-liga historical mults.
     * Range: [1.0, 1.3]. When undefined, the engine uses the dynamic ratio (current behavior).
     */
    HOME_ADV_MULT_OVERRIDE?: number;
  };

  /**
   * Código de liga (ej: 'PD', 'PL', 'BL1').
   * Cuando se provee, el motor busca en DC_RHO_PER_LEAGUE el rho óptimo para esa liga.
   * Si la liga no tiene entrada o se omite, cae al DC_RHO global como fallback.
   * Backward-compatible: omitir produce el comportamiento anterior.
   */
  leagueCode?: string;

  /**
   * Internal flag: skip DrawAffinity step.
   * Used exclusively by gen-calibration.ts to generate calibration tuples
   * from pre-affinity probabilities (Poisson + MarketBlend only).
   * This ensures calibration is trained on the same probability space it is
   * applied to at inference time (before DrawAffinity runs post-calibration).
   * NOT for production use.
   */
  _skipDrawAffinity?: boolean;

  /**
   * §SP-V4-20: Internal flag to collect intermediate pipeline values for logistic training.
   * When true, the engine populates V3PredictionOutput._intermediates with the
   * intermediate variables needed by extractLogisticFeatures.
   *
   * This is ONLY used by tools/train-logistic.ts.
   * In production the flag is always absent (undefined = false).
   * Enabling this flag has no effect on the main output shape — it only
   * adds the optional _intermediates field.
   * NOT for production use.
   */
  collectIntermediates?: boolean;
}

// ── League Baselines (§4) ──────────────────────────────────────────────────

/** Tasas promedio de goles de la liga. Usadas como prior y como referencia en lambdas. */
export interface LeagueBaselines {
  league_home_goals_pg: number;
  league_away_goals_pg: number;
  /** Media de las dos anteriores */
  league_goals_pg: number;
}

// ── Team Stats (§5) ─────────────────────────────────────────────────────────

/** Stats time-decay de un equipo. */
export interface TeamTDStats {
  /** Time-decay weighted goals scored per game */
  attack_td: number;
  /** Time-decay weighted goals conceded per game */
  defense_td: number;
  /** Total de partidos en la muestra */
  games: number;
  /** true si se usaron stats de venue específico (≥ MIN_GAMES_VENUE partidos en ese venue) */
  venueSplit: boolean;
}

// ── Shrinkage (§6) ──────────────────────────────────────────────────────────

export interface ShrunkStats {
  attack_shrunk: number;
  defense_shrunk: number;
}

// ── Prior (§7) ──────────────────────────────────────────────────────────────

/**
 * Calidad del prior de temporada anterior.
 * PREV_SEASON: ≥ 15 partidos del equipo en prevSeason
 * PARTIAL: 5–14 partidos
 * LEAGUE_BASELINE: < 5 partidos o prevSeason vacío
 */
export type PriorQuality = 'PREV_SEASON' | 'PARTIAL' | 'LEAGUE_BASELINE';

export interface PriorResult {
  effective_attack: number;
  effective_defense: number;
  prior_quality: PriorQuality;
}

// ── Rival Adjustment (§8) ──────────────────────────────────────────────────

/** Señal de un partido ajustada por la calidad del rival. */
export interface MatchSignalRA {
  utcDate: string;
  attack_signal: number;
  defense_signal: number;
  /**
   * Fuerza relativa del rival en este partido.
   * rival_strength = (opp_attack_eff + opp_defense_eff) / 2
   * undefined cuando el rival no tiene suficientes datos (< RA_MIN_RIVAL_GAMES).
   * Usado por computeRecencyDeltas para ponderar por SoS (§SP-V4-05).
   */
  rivalStrength?: number;
}

// ── Recency (§9) ───────────────────────────────────────────────────────────

export interface RecencyDeltas {
  delta_attack: number;
  delta_defense: number;
  /** false cuando games < MIN_GAMES_FOR_RECENCY — deltas son 1.0 */
  applied: boolean;
}

// ── Eligibility (§14) ──────────────────────────────────────────────────────

export type EligibilityStatus = 'ELIGIBLE' | 'LIMITED' | 'NOT_ELIGIBLE';

// ── Confidence (§15) ──────────────────────────────────────────────────────

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';

// ── T3 Input Types (§MKT-T3-00) ────────────────────────────────────────────

/**
 * xG data for a single historical match.
 * Keyed by the same (homeTeamId, awayTeamId, utcDate) triple as V3MatchRecord.
 * The engine joins XgRecord to V3MatchRecord by exact utcDate match.
 */
export interface XgRecord {
  /** Must match a V3MatchRecord.utcDate exactly */
  utcDate: string;
  homeTeamId: string;
  awayTeamId: string;
  /** Expected goals for the home team (>= 0) */
  xgHome: number;
  /** Expected goals for the away team (>= 0) */
  xgAway: number;
}

export type AbsenceType = 'INJURY' | 'SUSPENSION' | 'DOUBTFUL';

export type PlayerPosition = 'GK' | 'DEF' | 'MID' | 'FWD';

/**
 * A single player absence for an upcoming match.
 */
export interface InjuryRecord {
  teamId: string;
  /** Player name (for traceability only -- not used in computation) */
  playerName: string;
  /** Positional group */
  position: PlayerPosition;
  /** Type of absence */
  absenceType: AbsenceType;
  /**
   * Estimated importance weight of the player (0..1).
   * 1.0 = star/key player, 0.0 = squad depth.
   * Derived externally (e.g., from minutes played ratio or market value).
   * The engine does not compute this -- it is an input.
   */
  importance: number;
  /**
   * Minutes played by this player in the current season (§SP-V4-12).
   * When provided by injury-source.ts (fetched from player stats API),
   * it is used to derive importance = minutesPlayed / (teamGamesPlayed * 90).
   * Optional for backward compatibility — absence model works without it.
   */
  minutesPlayed?: number;
}

export interface LineupPlayer {
  playerName: string;
  position: PlayerPosition;
  /** true if this player is a regular starter (determined externally) */
  isRegularStarter: boolean;
}

/**
 * Confirmed XI for one team, available ~1h before kickoff.
 */
export interface ConfirmedLineupRecord {
  teamId: string;
  /** Exactly 11 players */
  players: LineupPlayer[];
}

// ── Calibration Table (§Cal Phase 5) ───────────────────────────────────────

/**
 * A single calibration point for piecewise-linear interpolation.
 * rawProb → calProb mapping, non-decreasing.
 */
export interface CalibrationPoint {
  rawProb: number;
  calProb: number;
}

/**
 * Isotonic calibration lookup table (one-vs-rest) for 1X2 probabilities.
 * Generated by tools/gen-calibration.ts and passed optionally to the engine.
 *
 * After per-class calibration the engine renormalizes so
 * p_home + p_draw + p_away = 1.0. §16.3
 */
export interface CalibrationTable {
  /** Calibration points for p_home (sorted by rawProb asc). */
  home: CalibrationPoint[];
  /** Calibration points for p_draw (sorted by rawProb asc). */
  draw: CalibrationPoint[];
  /** Calibration points for p_away (sorted by rawProb asc). */
  away: CalibrationPoint[];
  /** Number of matches used to fit the calibration. */
  nCalibrationMatches: number;
  /** ISO-8601 UTC timestamp when the table was generated. */
  fittedAt: string;
}

/**
 * Market-implied probabilities for 1X2, already de-vigged.
 * Must satisfy: probHome + probDraw + probAway = 1.0 (within 1e-4).
 */
export interface MarketOddsRecord {
  /** Implied probability of home win */
  probHome: number;
  /** Implied probability of draw */
  probDraw: number;
  /** Implied probability of away win */
  probAway: number;
  /** ISO-8601 UTC timestamp when these odds were captured */
  capturedAtUtc: string;
}

// ── Warnings (§17) ─────────────────────────────────────────────────────────

export type V3Warning =
  | 'TAIL_MASS_EXCEEDED'
  | 'NO_VENUE_SPLIT'
  | 'NO_PRIOR'
  | 'FALLBACK_BASELINE'
  // T3 warnings (§MKT-T3-00):
  | 'XG_PARTIAL_COVERAGE'    // xG provided but covers < XG_PARTIAL_COVERAGE_THRESHOLD of matches
  | 'MARKET_ODDS_INVALID'    // marketOdds provided but sum != 1.0
  | 'ABSENCE_DATA_STALE'     // reserved for future: injuries fetched > 24h ago
  ;

// ── Output (§17) ───────────────────────────────────────────────────────────

/**
 * Output completo del Motor Predictivo V3.
 * Si eligibility = NOT_ELIGIBLE, prob_* y lambda_* son null.
 */
export interface V3PredictionOutput {
  engine_id: 'v3_unified';
  engine_version: '4.5';

  // Elegibilidad y confianza
  eligibility: EligibilityStatus;
  confidence: ConfidenceLevel;

  // Probabilidades (null si NOT_ELIGIBLE)
  prob_home_win: number | null;
  prob_draw: number | null;
  prob_away_win: number | null;

  // Lambdas (null si NOT_ELIGIBLE)
  lambda_home: number | null;
  lambda_away: number | null;

  // Resultado predicho (null si TOO_CLOSE o NOT_ELIGIBLE)
  predicted_result: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null;
  /** |p_max − p_second| — null si NOT_ELIGIBLE */
  favorite_margin: number | null;

  // Texto editorial
  pre_match_text: string | null;

  // Mercados derivados (null si NOT_ELIGIBLE)
  markets: MarketsOutput | null;

  // Explicabilidad
  explanation: V3Explanation;

  // Warnings
  warnings: V3Warning[];

  /**
   * §SP-V4-20: Variables intermedias del pipeline para entrenamiento logístico.
   * Solo se popula cuando input.collectIntermediates = true.
   * Undefined en todos los demás casos — no afecta el output shape normal.
   * NOT for production use.
   */
  _intermediates?: V3PipelineIntermediates;
}

/**
 * Variables intermedias del pipeline necesarias para extractLogisticFeatures.
 * Solo para uso en tools/train-logistic.ts. §SP-V4-20.
 */
export interface V3PipelineIntermediates {
  /** Lambda home final (post-todos los ajustes del pipeline). */
  lambdaHome: number;
  /** Lambda away final (post-todos los ajustes del pipeline). */
  lambdaAway: number;
  /** Días desde último partido del equipo local (null si no hay datos). */
  restDaysHome: number;
  /** Días desde último partido del equipo visitante (null si no hay datos). */
  restDaysAway: number;
  /** Multiplicador H2H del equipo local (1.0 = neutral). */
  h2hMultHome: number;
  /** Multiplicador H2H del equipo visitante (1.0 = neutral). */
  h2hMultAway: number;
  /** Multiplicador de ausencia del equipo local (valor de AbsenceResult.mult_home). */
  absenceScoreHome: number;
  /** Multiplicador de ausencia del equipo visitante. */
  absenceScoreAway: number;
  /** Fracción [0,1] de partidos del historial con xG disponible. */
  xgCoverage: number;
  // §SP-DRAW-V1: draw-propensity signals
  /** Tasa de empate Bayesian-smoothed del local en rol local. */
  homeDrawRate: number;
  /** Tasa de empate Bayesian-smoothed del visitante en rol visitante. */
  awayDrawRate: number;
  /**
   * Fracción de empates en el H2H histórico.
   * undefined cuando hay < 2 partidos H2H (train-logistic usa default 0.25 en ese caso).
   */
  h2hDrawRate: number | undefined;
  /**
   * Diferencia normalizada de ppg: 1 - 1/(1+|ppgHome-ppgAway|) → ∈ [0,1).
   * 0 = equipos idénticos en ppg, 1 (asíntota) = diferencia extrema.
   */
  tableProximity: number;
}

export interface V3Explanation {
  effective_attack_home: number;
  effective_defense_home: number;
  effective_attack_away: number;
  effective_defense_away: number;
  delta_attack_home: number;
  delta_defense_home: number;
  delta_attack_away: number;
  delta_defense_away: number;
  home_advantage_applied: boolean;
  venue_split_home: boolean;
  venue_split_away: boolean;
  prior_quality_home: PriorQuality;
  prior_quality_away: PriorQuality;
  rival_adjustment_used: boolean;
  dc_correction_applied: boolean;
  league_home_goals_pg: number;
  league_away_goals_pg: number;
  games_home: number;
  games_away: number;
  /** Valor de ρ usado en la corrección Dixon-Coles. */
  dc_rho_used: number;
  /** true si ρ fue estimado desde datos históricos; false si se usó la constante DC_RHO. */
  dc_rho_estimated: boolean;

  // ── §T2-01: Rest adjustment ──────────────────────────────────────────────
  /** Días desde el último partido del equipo local (null si no hay datos). */
  rest_days_home: number | null;
  /** Días desde el último partido del equipo visitante (null si no hay datos). */
  rest_days_away: number | null;
  /** Multiplicador aplicado a lambda_home por descanso/fatiga (1.0 = neutro). */
  rest_mult_home: number;
  /** Multiplicador aplicado a lambda_away por descanso/fatiga (1.0 = neutro). */
  rest_mult_away: number;
  /** true si algún multiplicador de descanso difiere de 1.0. */
  rest_adjustment_applied: boolean;

  // ── §T2-02: H2H adjustment ───────────────────────────────────────────────
  /** Número de partidos H2H directos encontrados. */
  h2h_n_matches: number;
  /** Multiplicador H2H aplicado a lambda_home (1.0 = sin ajuste). */
  h2h_mult_home: number;
  /** Multiplicador H2H aplicado a lambda_away (1.0 = sin ajuste). */
  h2h_mult_away: number;
  /** true si se encontraron ≥ 3 partidos H2H. */
  h2h_adjustment_applied: boolean;

  // ── §T2-03: Goal form (informacional) ───────────────────────────────────
  /** Señales de forma ofensiva/defensiva del equipo local (null si < 1 partido). */
  goal_form_home: GoalFormStats | null;
  /** Señales de forma ofensiva/defensiva del equipo visitante (null si < 1 partido). */
  goal_form_away: GoalFormStats | null;

  // ── §T3-01: xG augmentation (§MKT-T3-00) ────────────────────────────────
  /** true if xG data was available and used in stats computation. */
  xg_used: boolean;
  /** Number of matches in currentSeason that had xG data. */
  xg_coverage_matches: number;
  /** Total matches in currentSeason (for coverage ratio). */
  xg_total_matches: number;

  // ── §T3-02 + §T3-03: Absence adjustment (§MKT-T3-00) ───────────────────
  /** Weighted absence score for home team (0 = no absences). */
  absence_score_home: number;
  /** Weighted absence score for away team. */
  absence_score_away: number;
  /** Multiplier applied to lambda_home (1.0 = no adjustment). */
  absence_mult_home: number;
  /** Multiplier applied to lambda_away (1.0 = no adjustment). */
  absence_mult_away: number;
  /** true if any absence data was provided and produced a non-1.0 multiplier. */
  absence_adjustment_applied: boolean;
  /** Number of absent players counted for home team. */
  absence_count_home: number;
  /** Number of absent players counted for away team. */
  absence_count_away: number;
  /** true if confirmed lineup was used to detect additional absences for home team. */
  lineup_used_home: boolean;
  /** true if confirmed lineup was used to detect additional absences for away team. */
  lineup_used_away: boolean;

  // ── §T3-04: Market blend (§MKT-T3-00) ───────────────────────────────────
  /** true if market odds were provided and blended into 1X2 probabilities. */
  market_blend_applied: boolean;
  /** Weight given to market odds in the blend (0 = pure model). */
  market_blend_weight: number;
  /** Model's raw 1X2 before blending (for traceability). */
  model_prob_home_pre_blend: number | null;
  model_prob_draw_pre_blend: number | null;
  model_prob_away_pre_blend: number | null;
  /** Market odds as received (for traceability). */
  market_prob_home: number | null;
  market_prob_draw: number | null;
  market_prob_away: number | null;

  // ── §SP-V4-23: Ensemble (§SP-V4-21 combinator) ───────────────────────────
  /**
   * Effective weights used in the ensemble blend.
   * Present only when ENSEMBLE_ENABLED=true for this run.
   * undefined when ensemble was not active (default, ENSEMBLE_ENABLED=false).
   */
  ensemble_weights_used?: { w_poisson: number; w_market: number; w_logistic: number };
  /**
   * Logistic model output probabilities before blending into the ensemble.
   * Present only when ENSEMBLE_ENABLED=true for this run.
   * Useful for debugging: shows the raw logistic signal before weighting.
   * undefined when ensemble was not active.
   */
  logistic_probs_raw?: { home: number; draw: number; away: number };
}

// ── Goal Form Stats (§T2-03) ────────────────────────────────────────────────

/** Señales de forma de gol de un equipo en sus últimos partidos. */
export interface GoalFormStats {
  goals_scored_form:   number;
  goals_conceded_form: number;
  clean_sheet_rate:    number;
  scoring_rate:        number;
  n_matches:           number;
}

// ── Poisson Matrix result (§13) ────────────────────────────────────────────

export interface PoissonMatrixResult {
  prob_home_win: number;
  prob_draw: number;
  prob_away_win: number;
  tailMassExceeded: boolean;
  /** Normalized scoreline matrix. matrix[h][a] = P(homeGoals=h, awayGoals=a). Sum ≈ 1. */
  matrix: number[][];
}

// ── Markets (§T1 — derived from Poisson matrix) ────────────────────────────

export interface OverUnderMarkets {
  over_0_5: number; under_0_5: number;
  over_1_5: number; under_1_5: number;
  over_2_5: number; under_2_5: number;
  over_3_5: number; under_3_5: number;
  over_4_5: number; under_4_5: number;
}

export interface BTTSMarket {
  /** P(homeGoals > 0 AND awayGoals > 0) */
  yes: number;
  /** 1 - yes */
  no: number;
}

export interface DoubleChanceMarkets {
  /** 1X = P(home win OR draw) */
  home_or_draw: number;
  /** X2 = P(draw OR away win) */
  draw_or_away: number;
  /** 12 = P(home win OR away win) = 1 − prob_draw */
  home_or_away: number;
}

export interface DNBMarkets {
  /** P(home win | no draw) */
  home: number;
  /** P(away win | no draw) */
  away: number;
}

export interface AsianHandicapMarkets {
  /** AH -0.5 home = P(home win by ≥1) */
  home_minus_half: number;
  /** AH +0.5 home = P(home win or draw) */
  home_plus_half: number;
  /** AH -0.5 away = P(away win by ≥1) */
  away_minus_half: number;
  /** AH +0.5 away = P(away win or draw) */
  away_plus_half: number;
}

export interface ExpectedGoalsMarkets {
  home: number;
  away: number;
  total: number;
  /** O/U threshold (0.5..4.5) where over_X is closest to 0.5 */
  implied_goal_line: number;
}

export interface TopScoreline {
  home: number;
  away: number;
  probability: number;
}

export interface MarketsOutput {
  over_under: OverUnderMarkets;
  btts: BTTSMarket;
  double_chance: DoubleChanceMarkets;
  dnb: DNBMarkets;
  asian_handicap: AsianHandicapMarkets;
  expected_goals: ExpectedGoalsMarkets;
  /** Top 5 scorelines sorted by probability descending. */
  top_scorelines: TopScoreline[];
}
