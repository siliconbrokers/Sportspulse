export type LeagueKey = 'URU' | 'LL' | 'EPL' | 'BUN';

export interface LeagueVideoSourceConfig {
  leagueKey: LeagueKey;
  channelId: string;   // YouTube channel ID (UCxxxxx...). Ignorado si searchOnly=true
  channelLabel: string;
  enabled: boolean;
  /**
   * Si true: omite la búsqueda por canal y va directo a search.list.
   * Usar cuando el canal oficial geo-bloquea la región objetivo.
   * El throttle se controla por TTL de caché (no por límite diario).
   */
  searchOnly?: boolean;
  fallbackSearchTerms: string[];
  // Al menos uno de estos términos debe aparecer en el título para aceptar el video
  titleRequiredTerms: string[];
}

// spec §10: allowlist manual de canales por liga
// IMPORTANTE: verificar IDs en youtube.com/@canal → URL del canal → "Acerca de"
export const VIDEO_SOURCES: Record<LeagueKey, LeagueVideoSourceConfig> = {
  URU: {
    leagueKey: 'URU',
    channelId: 'UC0jQd1_qQAT4an-dDaG1Sww', // AUFTV — canal oficial de la AUF (137K subs)
    channelLabel: 'AUFTV',
    enabled: true,
    fallbackSearchTerms: ['AUFTV resumen partido Campeonato Uruguayo', 'Peñarol Nacional goles apertura clausura'],
    titleRequiredTerms: ['uruguay', 'uruguayo', 'uruguaya', 'peñarol', 'nacional', 'auftv', 'apertura', 'clausura', 'campeonato'],
  },
  LL: {
    leagueKey: 'LL',
    channelId: '',   // sin canal fijo — geo-blocking en UY; se usa searchOnly
    channelLabel: 'LaLiga',
    enabled: true,
    searchOnly: true,
    fallbackSearchTerms: [
      'resumen goles LaLiga jornada',
      'LaLiga highlights jornada goles resumen',
      'highlights LaLiga goals today',
    ],
    titleRequiredTerms: ['laliga', 'la liga', 'liga española', 'real madrid', 'barcelona', 'atletico', 'sevilla', 'primera division', 'liga espanola'],
  },
  EPL: {
    leagueKey: 'EPL',
    channelId: 'UCG5qGWdu8nIRZqJ_GgDwQ-w', // Premier League oficial (9.3M subs)
    channelLabel: 'Premier League',
    enabled: true,
    fallbackSearchTerms: ['Premier League highlights matchday goals', 'EPL goals matchday highlights'],
    titleRequiredTerms: ['premier league', 'epl', 'man city', 'man utd', 'manchester', 'liverpool', 'arsenal', 'chelsea', 'tottenham'],
  },
  BUN: {
    leagueKey: 'BUN',
    channelId: 'UC6UL29enLNe4mqwTfAyeNuw', // Bundesliga oficial (5.5M subs)
    channelLabel: 'Bundesliga',
    enabled: true,
    fallbackSearchTerms: ['Bundesliga Highlights Spieltag Tore', 'Bundesliga Zusammenfassung Spieltag'],
    titleRequiredTerms: ['bundesliga', 'spieltag', 'dfl', 'Bayern', 'Dortmund', 'Leverkusen'],
  },
};
