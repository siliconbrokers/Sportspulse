export type LeagueKey = 'URU' | 'LL' | 'EPL' | 'BUN' | 'WC' | 'CA' | 'CLI';

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
  WC: {
    leagueKey: 'WC',
    channelId: 'UCpcTrCXblq78GThrequest9A', // placeholder — FIFA no tiene canal YouTube abierto
    channelLabel: 'FIFA / Mundial 2026',
    enabled: true,
    searchOnly: true, // sin canal oficial disponible, búsqueda libre
    fallbackSearchTerms: [
      'Copa del Mundo 2026 resumen goles highlights',
      'FIFA World Cup 2026 highlights goals',
    ],
    titleRequiredTerms: [
      'world cup', 'mundial', 'copa del mundo', 'fifa 2026',
      'wc 2026', 'world cup 2026',
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
  CA: {
    leagueKey: 'CA',
    channelId: 'UCxxxxxxxxxxxxxxxxxxxxxx', // placeholder — sin canal oficial CONMEBOL abierto en YouTube
    channelLabel: 'Copa América 2027',
    enabled: true,
    searchOnly: true,
    fallbackSearchTerms: [
      'Copa América 2027 goles highlights resumen',
      'Copa America 2027 goals highlights CONMEBOL',
    ],
    titleRequiredTerms: [
      'copa américa', 'copa america', 'conmebol', 'copa america 2027',
    ],
  },
  CLI: {
    leagueKey: 'CLI',
    channelId: 'UClgFf9mS1mZI2D_vo-ZTpmQ', // CONMEBOL Libertadores canal oficial (@Libertadores)
    channelLabel: 'Copa Libertadores',
    enabled: true,
    searchOnly: false,
    fallbackSearchTerms: [
      'Copa Libertadores 2026 goles highlights resumen',
      'Copa Libertadores highlights goals CONMEBOL 2026',
    ],
    titleRequiredTerms: [
      'libertadores', 'copa libertadores', 'conmebol libertadores',
    ],
  },
};
