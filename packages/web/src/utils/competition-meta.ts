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
export const NEWS_LEAGUE_ORDER = ['URU', 'AR', 'LL', 'EPL', 'BUN'] as const;

/** Mapa competition ID → league key usado en noticias/videos */
export const COMP_ID_TO_NEWS_KEY: Record<string, string> = {
  'comp:thesportsdb:4432': 'URU',
  'comp:sportsdb-ar:4406': 'AR',
  'comp:football-data:PD': 'LL',
  'comp:football-data:PL': 'EPL',
  'comp:openligadb:bl1': 'BUN',
};

/** Mapa competition ID → normalizedLeague (usado en TV, LiveCarousel, etc.) */
export const COMP_ID_TO_NORMALIZED_LEAGUE: Record<string, string> = {
  'comp:thesportsdb:4432': 'URUGUAY_PRIMERA',
  'comp:sportsdb-ar:4406': 'ARGENTINA_PRIMERA',
  'comp:football-data:PD': 'LALIGA',
  'comp:football-data:PL': 'PREMIER_LEAGUE',
  'comp:openligadb:bl1': 'BUNDESLIGA',
  'comp:football-data-cli:CLI': 'COPA_LIBERTADORES',
  'comp:football-data-wc:WC': 'MUNDIAL',
};

/** Todas las ligas gestionadas (pueden deshabilitarse desde el Back Office) */
export const MANAGED_NORMALIZED_LEAGUES = new Set(Object.values(COMP_ID_TO_NORMALIZED_LEAGUE));

/** Orden de bloques en VideoSection (incluye CLI una vez tenga soporte de video). */
export const VIDEO_LEAGUE_ORDER = ['URU', 'AR', 'LL', 'EPL', 'BUN', 'CLI'] as const;

/**
 * Mapa competition ID → URL de canal en futbollibretv.su.
 * Solo para competiciones cuya señal está disponible en ese sitio.
 * Se usa en DetailPanel para ofrecer link de stream para partidos EN VIVO.
 */
/**
 * Canales con stream en futbollibretv.su.
 * sourcePageUrl = URL estable del canal (no cambia). El backend extrae el embed activo en tiempo real.
 * fallbackUrl = link directo para el usuario si el embed no está disponible.
 */
export const COMP_ID_TO_FLTV_CHANNEL: Record<
  string,
  { label: string; sourcePageUrl: string; fallbackUrl: string }
> = {
  'comp:thesportsdb:4432': {
    label: 'VTV',
    sourcePageUrl: 'https://futbollibretv.su/vtv/',
    fallbackUrl: 'https://futbollibretv.su/vtv/',
  },
};
