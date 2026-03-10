/**
 * TournamentConfig — configuración parametrizada por torneo.
 *
 * Reemplaza los valores hardcodeados en FootballDataTournamentSource
 * (formatFamily, bestThirdsCount, providerKey). Cada torneo tiene su
 * propia instancia de TournamentConfig.
 *
 * WC_CONFIG y CA_CONFIG son los dos torneos registrados actualmente.
 * Para agregar un torneo nuevo: crear una nueva constante aquí y
 * registrarla en server/index.ts.
 */

export interface TournamentConfig {
  /** Código de la competición en football-data.org (ej: 'WC', 'CA'). */
  competitionCode: string;
  /**
   * Provider key para construir IDs canónicos.
   * Debe ser único por torneo para evitar colisiones de ID.
   * Formato: 'football-data-<código>' (ej: 'football-data-wc').
   */
  providerKey: string;
  /**
   * FormatFamily string que recibe el frontend (GroupStandingsView).
   * Valores válidos definidos en packages/web/src/types/tournament.ts.
   */
  formatFamily: string;
  /**
   * Cuántos mejores terceros clasifican (0 = ninguno, top 2 solo).
   * WC 2026: 8 de 12 grupos. Copa América: 0 (top 2 por grupo).
   */
  bestThirdsCount: number;
  /**
   * Si true, el source usa PE competition engine (rankGroup) para
   * computar standings de grupo a partir de resultados de partidos.
   * Si false, usa la standings API de football-data.org directamente.
   * WC usa false (ya funciona). Torneos nuevos deben usar true (PE-native).
   */
  usePERanking: boolean;
  /**
   * Fecha ISO de inicio del torneo (fase de grupos).
   * Usada por el frontend para el banner pre-torneo.
   * Opcional — sin startDate no se muestra el banner.
   */
  startDate?: string;
  /** Nombre del torneo en español, para logs. */
  nameEs: string;
}

/** Copa del Mundo 2026 — configuración original, sin cambios de comportamiento. */
export const WC_CONFIG: TournamentConfig = {
  competitionCode: 'WC',
  providerKey: 'football-data-wc',
  formatFamily: 'GROUP_STAGE_PLUS_KNOCKOUT_WITH_BEST_THIRDS',
  bestThirdsCount: 8,
  usePERanking: false,
  startDate: '2026-06-11',
  nameEs: 'Copa del Mundo 2026',
};

/**
 * Copa América 2027 — primer torneo PE-nativo.
 * Usa PE competition engine para rankings de grupos.
 * Competition code en football-data.org: confirmar ('CA' tentativo).
 * startDate: actualizar cuando la CONMEBOL confirme fecha.
 */
export const CA_CONFIG: TournamentConfig = {
  competitionCode: 'CA',
  providerKey: 'football-data-ca',
  formatFamily: 'GROUP_STAGE_PLUS_KNOCKOUT',
  bestThirdsCount: 0,
  usePERanking: true,
  startDate: undefined, // actualizar al confirmar fecha oficial
  nameEs: 'Copa América 2027',
};

/**
 * Copa Libertadores 2026 — torneo CONMEBOL con fase preliminar + grupos + eliminatorias.
 * Actualmente en fases previas (ROUND_1-3); fase de grupos comienza ~marzo/abril.
 * standings API no disponible durante fases preliminares → fallback a vacío.
 */
export const CLI_CONFIG: TournamentConfig = {
  competitionCode: 'CLI',
  providerKey: 'football-data-cli',
  formatFamily: 'GROUP_STAGE_PLUS_KNOCKOUT',
  bestThirdsCount: 0,
  usePERanking: true,
  startDate: undefined,
  nameEs: 'Copa Libertadores 2026',
};
