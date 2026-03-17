import { fetchObservadorNews } from './observador-source.js';
import { fetchRssLeague, RSS_CONFIG } from './rss-source.js';
import { NewsCache } from './news-cache.js';
import { getTop5Teams } from './priority-resolver.js';
import { deduplicate } from './filter.js';
import { isCompetitionEnabled } from '../portal-config-store.js';
import type { LeagueKey, NewsHeadline, NewsLeagueBlock, NewsFeedDTO, StandingsProvider } from './types.js';

// spec §13: límites por liga
const LIMITS: Record<LeagueKey, number> = { URU: 10, AR: 8, LL: 5, EPL: 5, BUN: 5, WC: 8, CA: 6, CLI: 6 };

// Maps LeagueKey → canonical competition ID for portal-config gate check.
// URU uses the API-Football registry ID; other leagues pull from RSS_CONFIG.
const LEAGUE_KEY_TO_COMPETITION_ID: Record<LeagueKey, string> = {
  URU: 'comp:apifootball:268',
  AR:  RSS_CONFIG.AR.competitionId,
  LL:  RSS_CONFIG.LL.competitionId,
  EPL: RSS_CONFIG.EPL.competitionId,
  BUN: RSS_CONFIG.BUN.competitionId,
  WC:  RSS_CONFIG.WC.competitionId,
  CA:  RSS_CONFIG.CA.competitionId,
  CLI: RSS_CONFIG.CLI.competitionId,
};

// spec §12: orden fijo entre ligas
const LEAGUE_ORDER: LeagueKey[] = ['URU', 'AR', 'LL', 'EPL', 'BUN', 'WC', 'CA', 'CLI'];

const COMPETITION_LABELS: Record<LeagueKey, string> = {
  URU: 'Fútbol uruguayo',
  AR: 'Liga Profesional Argentina',
  LL: 'LaLiga',
  EPL: 'Premier League',
  BUN: 'Bundesliga',
  WC: 'Mundial 2026',
  CA: 'Copa América 2027',
  CLI: 'Copa Libertadores',
};

// spec §12: ordenamiento dentro de cada liga
function sortHeadlines(items: NewsHeadline[], priorityTeams: string[]): NewsHeadline[] {
  return items.slice().sort((a, b) => {
    // 1. Fecha descendente
    const dateDiff =
      new Date(b.publishedAtUtc).getTime() - new Date(a.publishedAtUtc).getTime();
    if (dateDiff !== 0) return dateDiff;
    // 2. Menciona equipo prioritario
    const aTeam = priorityTeams.some((t) => a.title.toLowerCase().includes(t.toLowerCase()));
    const bTeam = priorityTeams.some((t) => b.title.toLowerCase().includes(t.toLowerCase()));
    if (bTeam !== aTeam) return bTeam ? 1 : -1;
    // 3. Tiene imagen
    return (b.imageUrl ? 1 : 0) - (a.imageUrl ? 1 : 0);
  });
}

export class NewsService {
  private cache = new NewsCache();

  constructor(private readonly standings: StandingsProvider) {}

  async getNewsFeed(): Promise<NewsFeedDTO> {
    const blocks = await Promise.all(LEAGUE_ORDER.map((k) => this.getBlock(k)));
    return { blocks, fetchedAtUtc: new Date().toISOString() };
  }

  private async getBlock(leagueKey: LeagueKey): Promise<NewsLeagueBlock> {
    // Skip fetch for competitions disabled in portal config.
    const competitionId = LEAGUE_KEY_TO_COMPETITION_ID[leagueKey];
    if (!isCompetitionEnabled(competitionId)) {
      return {
        leagueKey,
        competitionLabel: COMPETITION_LABELS[leagueKey],
        headlines: [],
      };
    }

    const cached = this.cache.get(leagueKey);
    if (cached) {
      return {
        leagueKey,
        competitionLabel: COMPETITION_LABELS[leagueKey],
        headlines: cached.headlines,
        error: cached.error,
      };
    }

    try {
      let raw: NewsHeadline[];

      if (leagueKey === 'URU') {
        raw = await fetchObservadorNews();
      } else {
        raw = await fetchRssLeague(leagueKey);
      }

      const rssEntry = leagueKey !== 'URU' ? RSS_CONFIG[leagueKey] : undefined;
      const afCanonical = process.env.AF_CANONICAL_ENABLED === 'true';
      const competitionIdForStandings =
        leagueKey === 'URU' || !rssEntry
          ? ''
          : (afCanonical && rssEntry.afCompetitionId) ? rssEntry.afCompetitionId : rssEntry.competitionId;
      const priorityTeams =
        leagueKey === 'URU'
          ? []
          : getTop5Teams(competitionIdForStandings, this.standings);

      const processed = sortHeadlines(deduplicate(raw), priorityTeams).slice(0, LIMITS[leagueKey]);

      this.cache.set(leagueKey, processed);
      return {
        leagueKey,
        competitionLabel: COMPETITION_LABELS[leagueKey],
        headlines: processed,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[NewsService] Error fetching ${leagueKey}:`, msg);
      // spec §18: fallo aislado — no bloquea el resto
      this.cache.set(leagueKey, [], 'No disponible');
      return {
        leagueKey,
        competitionLabel: COMPETITION_LABELS[leagueKey],
        headlines: [],
        error: 'No disponible',
      };
    }
  }
}
