export type LeagueKey = 'URU' | 'LL' | 'EPL' | 'BUN';

export interface LeagueVideoSourceConfig {
  leagueKey: LeagueKey;
  channelId: string;   // Canal principal (UCxxxxx...). Ignorado si searchOnly=true
  /**
   * Canales adicionales a consultar en orden, después del canal principal.
   * Para canales multi-deporte se aplica titleRequiredTerms automáticamente.
   * Si un canal devuelve geo-blocking, el filtro de región lo descarta sin romper el flujo.
   */
  extraChannelIds?: string[];
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
    // searchOnly: false → intenta AUFTV primero, si no alcanza cae a búsqueda libre
    fallbackSearchTerms: [
      'resumen goles Primera División Uruguay apertura clausura',
      'Peñarol Nacional resumen goles apertura clausura Uruguay',
      'ESPN resumen goles Primera División Uruguay',
      'highlights goles Campeonato Uruguayo fecha resumen',
      'DirecTV Sports resumen goles Uruguay Primera División',
    ],
    titleRequiredTerms: [
      'uruguay', 'uruguayo', 'uruguaya',
      'peñarol', 'nacional', 'auftv',
      'apertura', 'clausura', 'campeonato',
      'primera división', 'primera division',
      'goltv',
      'danubio', 'defensor', 'wanderers',
      'plaza colonia', 'rentistas', 'boston river',
    ],
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
    extraChannelIds: [
      'UCNAf1k0yIjyGu3k9BwAg3lg', // Sky Sports Football — puede geo-bloquear en UY, filtrado por región
    ],
    channelLabel: 'Premier League',
    enabled: true,
    fallbackSearchTerms: [
      'Premier League highlights matchday goals',
      'EPL goals highlights matchweek',
      'Premier League resumen goles jornada',
      'Premier League best goals this week',
      'premier league match highlights goals scored',
      'EPL matchday review all goals highlights',
      'premier league goals this week compilation',
    ],
    titleRequiredTerms: [
      'premier league', 'epl', 'matchweek', 'match week',
      'man city', 'man utd', 'manchester', 'manchester city', 'manchester united',
      'liverpool', 'arsenal', 'chelsea', 'tottenham', 'spurs',
      'newcastle', 'aston villa', 'brighton', 'west ham',
      'brentford', 'fulham', 'everton', 'crystal palace',
      'wolves', 'wolverhampton', 'bournemouth', 'leicester',
      'ipswich', 'southampton', 'nottingham forest', 'nottm forest',
    ],
  },
  BUN: {
    leagueKey: 'BUN',
    channelId: 'UC6UL29enLNe4mqwTfAyeNuw', // Bundesliga oficial (5.5M subs)
    // Sin canal extra por ahora — el canal oficial es de alta calidad y la búsqueda libre complementa
    channelLabel: 'Bundesliga',
    enabled: true,
    fallbackSearchTerms: [
      'Bundesliga Highlights Spieltag Tore',
      'Bundesliga Zusammenfassung Spieltag goals',
      'Bundesliga highlights goals matchday',
      'Bundesliga resumen goles jornada',
      'Bundesliga best goals this week spieltag highlights',
      'Bundesliga matchday all goals highlights compilation',
      'Bundesliga Spieltag Tore Zusammenfassung alle',
    ],
    titleRequiredTerms: [
      'bundesliga', 'spieltag', 'dfl',
      'Bayern', 'Bayern München', 'Dortmund', 'BVB', 'Leverkusen', 'Bayer',
      'wolfsburg', 'rb leipzig', 'leipzig', 'gladbach', 'mönchengladbach',
      'hoffenheim', 'freiburg', 'eintracht', 'frankfurt',
      'mainz', 'augsburg', 'bochum', 'werder', 'bremen',
      'köln', 'koln', 'heidenheim', 'stuttgart', 'st pauli', 'kiel',
    ],
  },
};
