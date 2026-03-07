/**
 * Human-readable labels for technical identifiers used across the UI.
 */

/** Competition code → display name */
const COMPETITION_NAMES: Record<string, string> = {
  PD: '🇪🇸 La Liga',
  PL: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 Premier League',
  BL1: '🇩🇪 Bundesliga',
  SA: '🇮🇹 Serie A',
  FL1: '🇫🇷 Ligue 1',
  CL: '🇪🇺 Champions League',
  EC: '🇪🇺 Euro Cup',
  WC: '🌍 World Cup',
  '4432': '🇺🇾 Liga Uruguaya',
};

export function competitionDisplayName(competitionId: string): string {
  const code = competitionId.split(':').pop()?.toUpperCase() ?? '';
  return COMPETITION_NAMES[code] ?? code;
}

/** Signal key → user-friendly label */
const SIGNAL_LABELS: Record<string, string> = {
  FORM_POINTS_LAST_5: 'Forma (últimos 5)',
  NEXT_MATCH_HOURS: 'Comienza en',
  PROXIMITY_BUCKET: 'Proximidad temporal',
  STREAK_WIN: 'Racha de victorias',
  STREAK_LOSS: 'Racha de derrotas',
  GOALS_SCORED_LAST_5: 'Goles a favor (últimos 5)',
  GOALS_CONCEDED_LAST_5: 'Goles en contra (últimos 5)',
  HOME_ADVANTAGE: 'Ventaja de local',
};

export function signalLabel(key: string): string {
  return (
    SIGNAL_LABELS[key] ??
    key
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/^\w/, (c) => c.toUpperCase())
  );
}

/** Format a signal's rawValue into a human-readable string */
export function signalValueLabel(key: string, rawValue: number): string {
  switch (key) {
    case 'NEXT_MATCH_HOURS': {
      const h = Math.round(rawValue);
      if (h < 1) return 'Menos de 1 hora';
      if (h < 24) return `En ${h}h`;
      const days = Math.floor(h / 24);
      const rem = h % 24;
      return rem > 0 ? `En ${days}d ${rem}h` : `En ${days}d`;
    }
    case 'FORM_POINTS_LAST_5':
      return `${Math.round(rawValue)} de 15 pts`;
    default:
      return String(Math.round(rawValue * 100) / 100);
  }
}

/** Venue code → display */
const VENUE_LABELS: Record<string, string> = {
  HOME: 'Local',
  AWAY: 'Visitante',
  NEUTRAL: 'Neutral',
  UNKNOWN: 'Por definir',
};

export function venueLabel(venue: string): string {
  return VENUE_LABELS[venue] ?? venue;
}

/** Score field labels */
export const SCORE_LABELS = {
  attentionScore: 'Atención',
  displayScore: 'Puntuación',
  rawScore: 'Puntaje base',
  layoutWeight: 'Peso visual',
} as const;

/** Warning labels */
export const WARNING_LABELS: Record<string, string> = {
  STALE_DATA: 'Los datos pueden estar desactualizados',
  PARTIAL_DATA: 'Algunos datos están incompletos',
  LAYOUT_DEGRADED: 'Diseño en modo de respaldo',
  PROVIDER_ERROR: 'Error en la fuente de datos',
};
