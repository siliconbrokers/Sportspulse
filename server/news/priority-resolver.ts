import type { StandingsProvider } from './types.js';

// ── Static fallback lists (spec §7) ──────────────────────────────────────────
// Used when lastPlayedMatchday < 5 or standings unavailable

const STATIC_FALLBACK: Record<string, string[]> = {
  'comp:football-data:PD': [
    'Real Madrid', 'Barcelona', 'Atlético de Madrid', 'Sevilla', 'Real Sociedad',
  ],
  'comp:football-data:PL': [
    'Manchester City', 'Liverpool', 'Arsenal', 'Chelsea', 'Manchester United',
  ],
  'comp:football-data:BL1': [
    'Bayern München', 'Borussia Dortmund', 'Bayer Leverkusen', 'RB Leipzig', 'Stuttgart',
  ],
};

// Common name overrides: canonical name → search-friendly name
const OVERRIDES: Record<string, string> = {
  'Real Madrid CF': 'Real Madrid',
  'FC Barcelona': 'Barcelona',
  'Club Atlético de Madrid': 'Atlético de Madrid',
  'Atlético Madrid': 'Atlético de Madrid',
  'FC Bayern München': 'Bayern München',
  'FC Bayern Munich': 'Bayern München',
  'Bayer 04 Leverkusen': 'Bayer Leverkusen',
  'RasenBallsport Leipzig': 'RB Leipzig',
  'VfB Stuttgart': 'Stuttgart',
  'Manchester City FC': 'Manchester City',
  'Liverpool FC': 'Liverpool',
  'Arsenal FC': 'Arsenal',
  'Chelsea FC': 'Chelsea',
  'Manchester United FC': 'Manchester United',
  'Real Sociedad de Fútbol': 'Real Sociedad',
  'Sevilla FC': 'Sevilla',
};

function normalizeName(name: string): string {
  if (OVERRIDES[name]) return OVERRIDES[name];
  return name
    .replace(/^(FC|CF|SC|RC|CD|UD|SL|Real Club|Club)\s+/i, '')
    .replace(/\s+(FC|CF|SC|SAD|SL)$/i, '')
    .trim();
}

// spec §6 + §7: use standings top-5 if lastPlayedMatchday >= 5, else static fallback
export function getTop5Teams(competitionId: string, provider: StandingsProvider): string[] {
  const lastPlayed = provider.getLastPlayedMatchday(competitionId) ?? 0;
  if (lastPlayed >= 5) {
    const names = provider.getTop5TeamNames(competitionId);
    if (names.length > 0) return names.slice(0, 5).map(normalizeName);
  }
  return STATIC_FALLBACK[competitionId] ?? [];
}
