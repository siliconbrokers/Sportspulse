/**
 * team-display-name.ts — Normalización de nombres de display de equipos.
 *
 * Problema: las APIs externas devuelven nombres completos (ej: "Club Atlético de Madrid",
 * "Real Betis Balompié", "1. FC Union Berlin") que son demasiado largos para mostrar en pantalla.
 *
 * CUÁNDO ACTUALIZAR ESTE ARCHIVO:
 *   - Cuando un equipo tiene un nombre popular más corto que el nombre oficial de la API
 *   - Cuando se agrega una nueva competición con equipos que no están en el mapa
 *
 * PRECEDENCIA:
 *   1. Override manual en DISPLAY_NAME_MAP (máxima confianza)
 *   2. shortName de la API si es distinto del name completo y tiene más de 3 chars
 *   3. Stripping automático de sufijos/prefijos comunes
 *   4. Nombre original como fallback
 */

// ── Override manual ────────────────────────────────────────────────────────────
// Clave: nombre exacto tal como llega de la API (campo `name`)
// Valor: nombre de display que se muestra en la interfaz

const DISPLAY_NAME_MAP: Record<string, string> = {
  // ── LaLiga (football-data.org) ───────────────────────────────────────────────
  'Club Atlético de Madrid':       'Atlético de Madrid',
  'Real Betis Balompié':           'Real Betis',
  'Rayo Vallecano de Madrid':      'Rayo Vallecano',
  'Real Sociedad de Fútbol':       'Real Sociedad',
  'RC Celta de Vigo':              'Celta de Vigo',
  'RCD Espanyol de Barcelona':     'Espanyol',
  'RCD Mallorca':                  'Mallorca',
  'UD Las Palmas':                 'Las Palmas',
  'CA Osasuna':                    'Osasuna',
  'Getafe CF':                     'Getafe',
  'Levante UD':                    'Levante',
  'Villarreal CF':                 'Villarreal',
  'Valencia CF':                   'Valencia',
  'Sevilla FC':                    'Sevilla',
  'Real Madrid CF':                'Real Madrid',
  'FC Barcelona':                  'Barcelona',
  'UD Almería':                    'Almería',
  'Real Valladolid CF':            'Valladolid',
  'Girona FC':                     'Girona',
  'SD Eibar':                      'Eibar',
  'UD Logroñés':                   'Logroñés',
  'CD Leganés':                    'Leganés',
  'CD Espanyol':                   'Espanyol',
  'Deportivo Alavés':              'Alavés',
  'Club Deportivo Leganés':        'Leganés',

  // ── Premier League (football-data.org) ───────────────────────────────────────
  'Manchester City FC':            'Man City',
  'Manchester United FC':          'Man United',
  'Arsenal FC':                    'Arsenal',
  'Chelsea FC':                    'Chelsea',
  'Liverpool FC':                  'Liverpool',
  'Tottenham Hotspur FC':          'Tottenham',
  'Newcastle United FC':           'Newcastle',
  'West Ham United FC':            'West Ham',
  'Aston Villa FC':                'Aston Villa',
  'Brighton & Hove Albion FC':     'Brighton',
  'Wolverhampton Wanderers FC':    'Wolves',
  'Crystal Palace FC':             'Crystal Palace',
  'Brentford FC':                  'Brentford',
  'Fulham FC':                     'Fulham',
  'Nottingham Forest FC':          'Nottm Forest',
  'Everton FC':                    'Everton',
  'AFC Bournemouth':               'Bournemouth',
  'Luton Town FC':                 'Luton',
  'Burnley FC':                    'Burnley',
  'Sheffield United FC':           'Sheffield Utd',
  'Leicester City FC':             'Leicester',
  'Ipswich Town FC':               'Ipswich',
  'Southampton FC':                'Southampton',
  'Sunderland AFC':                'Sunderland',
  'Leeds United':                  'Leeds',
  'West Bromwich Albion FC':       'West Brom',
  'Middlesbrough FC':              'Middlesbrough',
  'Watford FC':                    'Watford',
  'Norwich City FC':               'Norwich',

  // ── Bundesliga (OpenLigaDB) ───────────────────────────────────────────────────
  'FC Bayern München':             'Bayern',
  'Borussia Dortmund':             'Dortmund',
  'Bayer 04 Leverkusen':           'Leverkusen',
  'RB Leipzig':                    'Leipzig',
  'Borussia Mönchengladbach':      'Mönchengladbach',
  'TSG 1899 Hoffenheim':           'Hoffenheim',
  'TSG Hoffenheim':                'Hoffenheim',
  '1. FSV Mainz 05':               'Mainz',
  'FSV Mainz 05':                  'Mainz',
  '1. FC Union Berlin':            'Union Berlin',
  '1. FC Heidenheim 1846':         'Heidenheim',
  '1. FC Heidenheim':              'Heidenheim',
  'SV Werder Bremen':              'Werder Bremen',
  'VfB Stuttgart':                 'Stuttgart',
  'VfL Wolfsburg':                 'Wolfsburg',
  'VfL Bochum 1848':               'Bochum',
  'VfL Bochum':                    'Bochum',
  'SC Freiburg':                   'Freiburg',
  'Eintracht Frankfurt':           'Frankfurt',
  'FC Augsburg':                   'Augsburg',
  'FC St. Pauli':                  'St. Pauli',
  'SV Darmstadt 98':               'Darmstadt',
  'Holstein Kiel':                 'Kiel',
  'Hamburger SV':                  'Hamburger SV',
  'FC Schalke 04':                 'Schalke',
  'Hertha BSC':                    'Hertha',
  'Fortuna Düsseldorf':            'Düsseldorf',

  // ── Liga Uruguaya (TheSportsDB) ───────────────────────────────────────────────
  'Nacional Montevideo':           'Nacional',
  'Liverpool Montevideo':          'Liverpool',
  'Montevideo City Torque':        'City Torque',
  'Montevideo Wanderers':          'Wanderers',
  'Racing Montevideo':             'Racing',
  'River Plate Montevideo':        'River Plate',
  'Juventud Las Piedras':          'Juventud',

  // ── Liga Argentina (TheSportsDB) ─────────────────────────────────────────────
  'Club Atlético Boca Juniors':    'Boca Juniors',
  'Club Atlético River Plate':     'River Plate',
  'Racing Club de Avellaneda':     'Racing Club',
  'Club Atlético Independiente':   'Independiente',
  'Club Atlético San Lorenzo':     'San Lorenzo',
  'Club Atlético Huracán':         'Huracán',
  'Club Atlético Vélez Sársfield': 'Vélez',
  'Club Atlético Lanús':           'Lanús',
  'Club Atlético Banfield':        'Banfield',
  'Estudiantes de La Plata':       'Estudiantes',
  'Club Gimnasia y Esgrima':       'Gimnasia',
  'Club Atletico Talleres':        'Talleres',
  'Defensa y Justicia':            'Defensa y Justicia',
};

// ── Sufijos a eliminar si no hay override ──────────────────────────────────────
const STRIP_SUFFIXES: RegExp[] = [
  /\s+Balompi[eé]$/i,
  /\s+de\s+Fútbol$/i,
  /\s+de\s+Futbol$/i,
  /\s+Football\s+Club$/i,
  /\s+Fútbol\s+Club$/i,
  /\s+\bFC\b$/i,
  /\s+\bCF\b$/i,
  /\s+\bAFC\b$/i,
  /\s+\bSC\b$/i,
  /\s+\bUD\b$/i,
  /\s+\bSD\b$/i,
  /\s+\bAC\b$/i,
];

// ── Prefijos a eliminar si no hay override ─────────────────────────────────────
const STRIP_PREFIXES_DISPLAY: RegExp[] = [
  /^Club\s+Atlético\s+/i,
  /^Club\s+Atletico\s+/i,
  /^Club\s+/i,
  /^RC\s+/i,
  /^RCD\s+/i,
  /^AFC\s+/i,
  /^CA\s+/i,
  /^SD\s+/i,
];

/**
 * Normaliza el nombre de display de un equipo para mostrarlo en la interfaz.
 *
 * Precedencia:
 * 1. Override manual en DISPLAY_NAME_MAP
 * 2. apiShortName si es diferente al name y tiene más de 3 caracteres
 * 3. Stripping automático de prefijos/sufijos comunes
 * 4. Nombre original (fallback)
 *
 * @param fullName     Nombre completo tal como llega de la API
 * @param apiShortName shortName provisto por la API (si existe)
 */
export function resolveDisplayName(fullName: string, apiShortName?: string | null): string {
  // 1. Override manual
  const override = DISPLAY_NAME_MAP[fullName];
  if (override) return override;

  // 2. shortName de la API si es distinto, más largo que un TLA y más corto que el nombre completo
  if (apiShortName && apiShortName !== fullName && apiShortName.length > 3 && apiShortName.length < fullName.length) {
    return apiShortName;
  }

  // 3. Stripping automático
  let name = fullName;
  for (const re of STRIP_PREFIXES_DISPLAY) {
    if (re.test(name)) {
      name = name.replace(re, '');
      break;
    }
  }
  for (const re of STRIP_SUFFIXES) {
    if (re.test(name)) {
      name = name.replace(re, '');
      break;
    }
  }
  const trimmed = name.trim();
  return trimmed || fullName;
}
