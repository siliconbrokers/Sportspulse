/**
 * competition-registry.ts — Fuente única de verdad de todas las competencias del portal.
 *
 * TODO lo demás en el backend deriva de este archivo:
 *   - AF_COMPETITION_CONFIGS (api-football-canonical-source.ts)
 *   - COMP_LEAGUE_MAP (incidents/apifootball-incident-source.ts)
 *   - CATALOG_DEFAULTS (portal-config-store.ts)
 *   - AF_V3_COMPS descriptors (server/index.ts)
 *   - portal-config API response (enriquecido en index.ts)
 *
 * El frontend recibe todos los metadatos visuales vía /api/ui/portal-config.
 * No debe tener hardcodeados IDs de proveedor ni colores.
 */

export type SeasonKind = 'european' | 'calendar';
export type TournamentPhase = 'previa' | 'grupos' | 'eliminatorias';

export interface CompetitionRegistryEntry {
  /** Canonical competition ID — comp:apifootball:{leagueId} */
  id: string;
  /** API-Football league ID */
  leagueId: number;
  /** Short slug used in URLs, .env, and news keys (PD, PL, BL1, URU, AR, CLI, WC) */
  slug: string;
  /** User-facing full name */
  displayName: string;
  /** Short display name for constrained UI */
  shortName: string;
  /** Normalized league key for frontend filtering (stable semantic key) */
  normalizedLeague: string;
  /** Key for news/video section grouping (null = no dedicated feed) */
  newsKey: string | null;
  /** UI accent color */
  accentColor: string;
  /** Logo image URL */
  logoUrl: string;
  /** Season display label (e.g. '25/26' or '2026') */
  seasonLabel: string;
  /** Season calendar model */
  seasonKind: SeasonKind;
  /** True for knockout tournaments (not a standard league table) */
  isTournament: boolean;
  /** Expected games per team per season — prediction engine adaptive threshold */
  expectedSeasonGames?: number;
  /** Total matchdays in a full season — league progress display */
  totalMatchdays?: number;
  /** True if season splits into named sub-tournaments (Apertura/Clausura) */
  hasSubTournaments?: boolean;
  /**
   * Which calendar half maps to "Apertura".
   * H1 = Apertura runs Jan–Jun (Argentina style, default).
   * H2 = Apertura runs Jul–Dec (Liga MX style — Clausura is Jan–May).
   * Only relevant when hasSubTournaments=true.
   */
  aperturaSeason?: 'H1' | 'H2';
  /** Tournament phases (determines tab visibility). Only for isTournament=true. */
  phases?: TournamentPhase[];
  /** ISO date of tournament start — used for pre-tournament banner */
  startDate?: string;
}

export const COMPETITION_REGISTRY: CompetitionRegistryEntry[] = [
  {
    id:                  'comp:apifootball:268',
    leagueId:            268,
    slug:                'URU',
    displayName:         'Fútbol Uruguayo',
    shortName:           'Uruguay',
    normalizedLeague:    'URUGUAY_PRIMERA',
    newsKey:             'URU',
    accentColor:         '#3b82f6',
    logoUrl:             'https://r2.thesportsdb.com/images/media/league/badge/3p98xv1740672448.png',
    seasonLabel:         '2026',
    seasonKind:          'calendar',
    isTournament:        false,
    expectedSeasonGames: 15,
    hasSubTournaments:   true,
  },
  {
    id:                  'comp:apifootball:128',
    leagueId:            128,
    slug:                'AR',
    displayName:         'Liga Argentina',
    shortName:           'Argentina',
    normalizedLeague:    'ARGENTINA_PRIMERA',
    newsKey:             'AR',
    accentColor:         '#74b9ff',
    logoUrl:             'https://r2.thesportsdb.com/images/media/league/badge/rk9xhx1768238251.png',
    seasonLabel:         '2026',
    seasonKind:          'calendar',
    isTournament:        false,
    expectedSeasonGames: 19,
    hasSubTournaments:   true,
  },
  {
    id:                  'comp:apifootball:140',
    leagueId:            140,
    slug:                'PD',
    displayName:         'La Liga',
    shortName:           'LaLiga',
    normalizedLeague:    'LALIGA',
    newsKey:             'LL',
    accentColor:         '#f59e0b',
    logoUrl:             'https://r2.thesportsdb.com/images/media/league/badge/ja4it51687628717.png',
    seasonLabel:         '25/26',
    seasonKind:          'european',
    isTournament:        false,
    expectedSeasonGames: 38,
    totalMatchdays:      38,
  },
  {
    id:                  'comp:apifootball:39',
    leagueId:            39,
    slug:                'PL',
    displayName:         'Premier League',
    shortName:           'Premier',
    normalizedLeague:    'PREMIER_LEAGUE',
    newsKey:             'EPL',
    accentColor:         '#a855f7',
    logoUrl:             'https://r2.thesportsdb.com/images/media/league/badge/gasy9d1737743125.png',
    seasonLabel:         '25/26',
    seasonKind:          'european',
    isTournament:        false,
    expectedSeasonGames: 38,
    totalMatchdays:      38,
  },
  {
    id:                  'comp:apifootball:78',
    leagueId:            78,
    slug:                'BL1',
    displayName:         'Bundesliga',
    shortName:           'Bundesliga',
    normalizedLeague:    'BUNDESLIGA',
    newsKey:             'BUN',
    accentColor:         '#ef4444',
    logoUrl:             'https://r2.thesportsdb.com/images/media/league/badge/teqh1b1679952008.png',
    seasonLabel:         '25/26',
    seasonKind:          'european',
    isTournament:        false,
    expectedSeasonGames: 34,
    totalMatchdays:      34,
  },
  {
    id:               'comp:apifootball:13',
    leagueId:         13,
    slug:             'CLI',
    displayName:      'Copa Libertadores',
    shortName:        'Libertadores',
    normalizedLeague: 'COPA_LIBERTADORES',
    newsKey:          'CLI',
    accentColor:      '#eab308',
    logoUrl:          'https://crests.football-data.org/CLI.svg',
    seasonLabel:      '2026',
    seasonKind:       'calendar',
    isTournament:     true,
    phases:           ['previa', 'grupos', 'eliminatorias'],
  },
  {
    id:               'comp:apifootball:1',
    leagueId:         1,
    slug:             'WC',
    displayName:      'Copa del Mundo 2026',
    shortName:        'Mundial',
    normalizedLeague: 'MUNDIAL',
    newsKey:          'WC',
    accentColor:      '#22c55e',
    logoUrl:          'https://r2.thesportsdb.com/images/media/league/badge/e7er5g1696521789.png',
    seasonLabel:      '2026',
    seasonKind:       'calendar',
    isTournament:     true,
    phases:           ['grupos', 'eliminatorias'],
    startDate:        '2026-06-11',
  },
  {
    id:                  'comp:apifootball:262',
    leagueId:            262,
    slug:                'MX',
    displayName:         'Liga MX',
    shortName:           'Liga MX',
    normalizedLeague:    'LIGA_MX',
    newsKey:             null,
    accentColor:         '#1a1a6e',
    logoUrl:             'https://r2.thesportsdb.com/images/media/league/badge/mav5rx1686157960.png',
    seasonLabel:         '25/26',
    seasonKind:          'european',
    isTournament:        false,
    expectedSeasonGames: 17,
    totalMatchdays:      17,
    hasSubTournaments:   true,
    aperturaSeason:      'H2',
  },
];

/** O(1) lookup por competition ID */
export const REGISTRY_BY_ID = new Map<string, CompetitionRegistryEntry>(
  COMPETITION_REGISTRY.map((e) => [e.id, e]),
);

/**
 * Devuelve el año de temporada AF dado un kickoff UTC y el tipo de calendario.
 * european: PD, PL, BL1 — la temporada 25/26 empieza en julio 2025.
 * calendar: URU, AR, CLI, WC — año calendario del partido.
 */
export function resolveAfSeason(kickoffUtc: string, seasonKind: SeasonKind): number {
  const d = new Date(kickoffUtc);
  if (seasonKind === 'european') {
    return d.getUTCMonth() < 6 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
  }
  return d.getUTCFullYear();
}
