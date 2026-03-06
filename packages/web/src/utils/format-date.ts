/**
 * Locale-aware date/time formatting.
 *
 * Spanish-speaking timezones → DD/MM/YYYY - HH:MM
 * All others → YYYY-MM-DD HH:MM (ISO-like default)
 *
 * Detection is automatic based on the timezone string.
 */

const SPANISH_TIMEZONE_PREFIXES = [
  'America/Argentina',
  'America/Buenos_Aires',
  'America/Montevideo',
  'America/Mexico_City',
  'America/Mexico',
  'America/Bogota',
  'America/Lima',
  'America/Santiago',
  'America/Caracas',
  'America/Guayaquil',
  'America/Asuncion',
  'America/La_Paz',
  'America/Managua',
  'America/Tegucigalpa',
  'America/Guatemala',
  'America/El_Salvador',
  'America/Costa_Rica',
  'America/Panama',
  'America/Havana',
  'America/Santo_Domingo',
  'America/Hermosillo',
  'America/Chihuahua',
  'America/Monterrey',
  'America/Cancun',
  'America/Merida',
  'America/Mazatlan',
  'America/Tijuana',
  'Europe/Madrid',
  'Atlantic/Canary',
];

export function isSpanishTimezone(timezone: string): boolean {
  return SPANISH_TIMEZONE_PREFIXES.some(
    (prefix) => timezone === prefix || timezone.startsWith(prefix + '/'),
  );
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * Formats a UTC ISO string into the user's timezone.
 *
 * Spanish TZ → "05/03/2026 - 12:00"
 * Other TZ   → "2026-03-05 12:00"
 */
export function formatDateTime(utcIso: string, timezone: string): string {
  const date = new Date(utcIso);
  if (isNaN(date.getTime())) return utcIso;

  const parts = getDateParts(date, timezone);
  if (!parts) return utcIso;

  if (isSpanishTimezone(timezone)) {
    return `${pad(parts.day)}/${pad(parts.month)}/${parts.year} - ${pad(parts.hour)}:${pad(parts.minute)}`;
  }

  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

/**
 * Formats a UTC ISO string as date only.
 *
 * Spanish TZ → "05/03/2026"
 * Other TZ   → "2026-03-05"
 */
export function formatDate(utcIso: string, timezone: string): string {
  const date = new Date(utcIso);
  if (isNaN(date.getTime())) return utcIso;

  const parts = getDateParts(date, timezone);
  if (!parts) return utcIso;

  if (isSpanishTimezone(timezone)) {
    return `${pad(parts.day)}/${pad(parts.month)}/${parts.year}`;
  }

  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/**
 * Formats a local date string (YYYY-MM-DD) for display.
 *
 * Spanish TZ → "05/03/2026"
 * Other TZ   → "2026-03-05"
 */
export function formatLocalDate(dateLocal: string, timezone: string): string {
  const match = dateLocal.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateLocal;

  const [, year, month, day] = match;

  if (isSpanishTimezone(timezone)) {
    return `${day}/${month}/${year}`;
  }

  return dateLocal;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function getDateParts(date: Date, timezone: string): DateParts | null {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(date);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);

    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: get('hour'),
      minute: get('minute'),
    };
  } catch {
    return null;
  }
}
