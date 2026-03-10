import { fetchObservadorNews } from './observador-source.js';
import { fetchGNewsLeague, LEAGUE_CONFIG } from './gnews-source.js';
import { NewsCache } from './news-cache.js';
import { getTop5Teams } from './priority-resolver.js';
import { deduplicate } from './filter.js';
import type { LeagueKey, NewsHeadline, NewsLeagueBlock, NewsFeedDTO, StandingsProvider } from './types.js';

// spec §13: límites por liga
const LIMITS: Record<LeagueKey, number> = { URU: 10, LL: 5, EPL: 5, BUN: 5, WC: 8, CA: 6, CLI: 6 };

// spec §12: orden fijo entre ligas
const LEAGUE_ORDER: LeagueKey[] = ['URU', 'LL', 'EPL', 'BUN', 'WC', 'CA', 'CLI'];

const COMPETITION_LABELS: Record<LeagueKey, string> = {
  URU: 'Fútbol uruguayo',
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

  constructor(
    private readonly gnewsApiKey: string,
    private readonly standings: StandingsProvider,
  ) {}

  async getNewsFeed(): Promise<NewsFeedDTO> {
    const blocks = await Promise.all(LEAGUE_ORDER.map((k) => this.getBlock(k)));
    return { blocks, fetchedAtUtc: new Date().toISOString() };
  }

  private async getBlock(leagueKey: LeagueKey): Promise<NewsLeagueBlock> {
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
        const competitionId = LEAGUE_CONFIG[leagueKey].competitionId;
        const top5 = getTop5Teams(competitionId, this.standings);
        raw = await fetchGNewsLeague(leagueKey, top5, this.gnewsApiKey);
      }

      const priorityTeams =
        leagueKey === 'URU'
          ? []
          : getTop5Teams(LEAGUE_CONFIG[leagueKey].competitionId, this.standings);

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
