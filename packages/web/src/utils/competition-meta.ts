/** Metadatos visuales de cada competición — logos, colores, nombres */
export interface CompetitionMeta {
  id: string;
  name: string;
  shortName: string;
  logoUrl: string;
  accent: string;
  season: string;
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
];

export function getCompMeta(id: string): CompetitionMeta | undefined {
  return COMPETITION_META.find((c) => c.id === id);
}
