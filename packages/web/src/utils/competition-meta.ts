/** Metadatos visuales de cada competición — logos, colores, nombres */
export type TournamentPhase = 'previa' | 'grupos' | 'eliminatorias';

export interface CompetitionMeta {
  id: string;
  name: string;
  shortName: string;
  logoUrl: string;
  accent: string;
  season: string;
  /** Fecha ISO de inicio del torneo (solo torneos). Usada para banner pre-torneo. */
  startDate?: string;
  /**
   * Fases que tiene este torneo — determina qué tabs muestra TournamentView.
   * Si no se define, TournamentView infiere las fases a partir de los datos de la API.
   * DEBE definirse para que los tabs sean visibles incluso cuando la API no responde.
   */
  phases?: TournamentPhase[];
}

export const COMPETITION_META: CompetitionMeta[] = [
  {
    id: 'comp:thesportsdb:4432',
    name: 'Fútbol Uruguayo',
    shortName: 'Uruguay',
    logoUrl: 'https://r2.thesportsdb.com/images/media/league/badge/3p98xv1740672448.png',
    accent: '#3b82f6',
    season: '2026',
  },
  {
    id: 'comp:sportsdb-ar:4406',
    name: 'Liga Argentina',
    shortName: 'Argentina',
    logoUrl: 'https://r2.thesportsdb.com/images/media/league/badge/rk9xhx1768238251.png',
    accent: '#74b9ff',
    season: '2026',
  },
  {
    id: 'comp:football-data:PD',
    name: 'LaLiga',
    shortName: 'LaLiga',
    logoUrl: 'https://r2.thesportsdb.com/images/media/league/badge/ja4it51687628717.png',
    accent: '#f59e0b',
    season: '25/26',
  },
  {
    id: 'comp:football-data:PL',
    name: 'Premier League',
    shortName: 'Premier',
    logoUrl: 'https://r2.thesportsdb.com/images/media/league/badge/gasy9d1737743125.png',
    accent: '#a855f7',
    season: '25/26',
  },
  {
    id: 'comp:openligadb:bl1',
    name: 'Bundesliga',
    shortName: 'Bundesliga',
    logoUrl: 'https://r2.thesportsdb.com/images/media/league/badge/teqh1b1679952008.png',
    accent: '#ef4444',
    season: '25/26',
  },
  {
    id: 'comp:football-data-wc:WC',
    name: 'Mundial 2026',
    shortName: 'Mundial',
    logoUrl: 'https://r2.thesportsdb.com/images/media/league/badge/e7er5g1696521789.png',
    accent: '#22c55e',
    season: '2026',
    startDate: '2026-06-11',
    phases: ['grupos', 'eliminatorias'],
  },
  {
    id: 'comp:football-data-cli:CLI',
    name: 'Copa Libertadores',
    shortName: 'Libertadores',
    logoUrl: 'https://crests.football-data.org/CLI.svg',
    accent: '#eab308',
    season: '2026',
    phases: ['previa', 'grupos', 'eliminatorias'],
  },
];

export function getCompMeta(id: string): CompetitionMeta | undefined {
  return COMPETITION_META.find((c) => c.id === id);
}

// ── Orden de visualización de bloques de noticias / video ─────────────────────

/** Orden de bloques en NewsSection y feeds de noticias del home. */
export const NEWS_LEAGUE_ORDER = ['URU', 'LL', 'EPL', 'BUN'] as const;

/** Orden de bloques en VideoSection (incluye CLI una vez tenga soporte de video). */
export const VIDEO_LEAGUE_ORDER = ['URU', 'LL', 'EPL', 'BUN', 'CLI'] as const;
