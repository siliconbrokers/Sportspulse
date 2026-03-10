/**
 * tla-overrides.ts — TLA (Three Letter Abbreviation) para fuentes que no las proveen.
 *
 * CUÁNDO ACTUALIZAR ESTE ARCHIVO:
 *   - Cuando un equipo nuevo entra a BL1 o URU y el algoritmo genera un TLA confuso
 *   - Cuando un equipo conocido tiene un TLA oficial distinto al derivado
 *   - Nunca para LL/EPL/BUN: esas ligas usan football-data.org que provee TLA nativo
 *
 * CÓMO AGREGAR UN EQUIPO:
 *   Agregar: '"Nombre exacto como viene de la API": "XYZ"'
 *   El nombre exacto lo ves en los logs: [OpenLigaDBSource] o [TheSportsDbSource]
 *
 * ADAPTACIÓN AUTOMÁTICA:
 *   Si llega un equipo nuevo no listado aquí, `deriveTla()` genera un TLA razonable
 *   automáticamente. Solo agregar override si el resultado es incorrecto.
 */

// ── Override map ──────────────────────────────────────────────────────────────
// Clave: nombre exacto del equipo tal como llega de la API
// Valor: TLA de 3 letras en mayúsculas

const TLA_MAP: Record<string, string> = {
  // ── Bundesliga (OpenLigaDB) — solo para casos donde el shortName de OLG no es ideal
  'Borussia Dortmund':          'BVB',
  'FC Bayern München':          'FCB',
  'Bayer 04 Leverkusen':        'B04',
  'RB Leipzig':                 'RBL',
  'Borussia Mönchengladbach':   'BMG',
  'TSG 1899 Hoffenheim':        'TSG',
  'TSG Hoffenheim':             'TSG',
  '1. FSV Mainz 05':            'M05',
  'FSV Mainz 05':               'M05',
  '1. FC Union Berlin':         'FCU',
  '1. FC Heidenheim 1846':      'FCH',
  '1. FC Heidenheim':           'FCH',
  'SV Werder Bremen':           'SVW',
  'VfB Stuttgart':              'VFB',
  'VfL Wolfsburg':              'WOB',
  'VfL Bochum 1848':            'BOC',
  'VfL Bochum':                 'BOC',
  'SC Freiburg':                'SCF',
  'Eintracht Frankfurt':        'SGE',
  'FC Augsburg':                'FCA',
  'FC St. Pauli':               'STP',
  'Hamburger SV':               'HSV',
  'SV Darmstadt 98':            'SVD',
  'Holstein Kiel':              'KIE',

  // ── Liga Uruguaya (TheSportsDB)
  'Nacional Montevideo':        'NAC',
  'Peñarol':                    'PEN',
  'Defensor Sporting':          'DSP',
  'Danubio':                    'DAN',
  'Liverpool Montevideo':       'LIV',
  'Montevideo City Torque':     'MCT',
  'Montevideo Wanderers':       'MWA',
  'Cerro':                      'CER',
  'Cerro Largo':                'CLF',
  'Racing Montevideo':          'RAC',
  'Central Español':            'CES',
  'Deportivo Maldonado':        'MAL',
  'Albion':                     'ALB',
  'Boston River':               'BOS',
  'Progreso':                   'PRO',
  'Juventud Las Piedras':       'JUV',
  'Fénix':                      'FEN',
  'River Plate Montevideo':     'RIV',
  'Sud América':                'SUD',
  'Rampla Juniors':             'RAM',
  'Rentistas':                  'REN',
};

// ── Prefijos comunes a ignorar en la derivación automática ────────────────────
// Ordenados de mayor a menor longitud para evitar matches parciales
const STRIP_PREFIXES = [
  /^1\.\s+FSV\s+/i,
  /^1\.\s+FC\s+/i,
  /^2\.\s+FC\s+/i,
  /^FC\s+/i,
  /^SV\s+/i,
  /^VfB\s+/i,
  /^VfL\s+/i,
  /^TSG\s+/i,
  /^FSV\s+/i,
  /^SSV\s+/i,
  /^SC\s+/i,
  /^RB\s+/i,
  /^AC\s+/i,
  /^AS\s+/i,
  /^SS\s+/i,
  /^CF\s+/i,
  /^CD\s+/i,
  /^UD\s+/i,
  /^RC\s+/i,
  /^GD\s+/i,
  /^CA\s+/i,
  /^Club\s+/i,
  /^Fútbol\s+Club\s+/i,
  /^Football\s+Club\s+/i,
];

/**
 * Deriva un TLA de 3 letras a partir del nombre del equipo.
 * Elimina prefijos comunes (FC, SV, RB, etc.) antes de tomar las primeras 3 letras.
 * Usado como fallback cuando no hay override ni TLA de la API.
 */
function deriveTla(name: string): string {
  let stripped = name.trim();
  for (const prefix of STRIP_PREFIXES) {
    stripped = stripped.replace(prefix, '');
    if (stripped !== name.trim()) break; // solo eliminar el primero que aplique
  }
  // Tomar primeras 3 letras significativas (ignorar espacios y dígitos iniciales)
  const meaningful = stripped.replace(/^[\s\d.]+/, '').trim();
  return (meaningful || stripped).slice(0, 3).toUpperCase();
}

/**
 * Resuelve el TLA para un equipo dado.
 *
 * Precedencia:
 *   1. Override manual en TLA_MAP (más confiable para casos conocidos)
 *   2. TLA de la API (si la fuente lo provee, ej. OpenLigaDB shortName o football-data.org tla)
 *   3. Derivación automática por nombre (fallback para equipos nuevos no listados)
 *
 * @param name       Nombre exacto del equipo tal como viene de la API
 * @param apiTla     TLA que provee la API (si existe). Ej: OLG shortName truncado.
 */
export function resolveTla(name: string, apiTla?: string): string {
  return TLA_MAP[name] ?? apiTla ?? deriveTla(name);
}
