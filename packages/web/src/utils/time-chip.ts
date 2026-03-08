/**
 * Computes a live time label from kickoffUtc and the current browser time.
 * Replaces the stale backend-computed timeChip.label for display purposes.
 */
export interface LiveTimeChip {
  icon: string;
  label: string;
  level: 'HOT' | 'OK' | 'INFO' | 'WARN' | 'UNKNOWN';
}

const TZ = 'America/Montevideo';

function fmtTime(utc: string): string {
  return new Intl.DateTimeFormat('es-UY', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(utc));
}

function fmtDate(utc: string): string {
  return new Intl.DateTimeFormat('es-UY', {
    timeZone: TZ,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(utc));
}

export function computeLiveTimeChip(
  status: string | undefined,
  kickoffUtc: string | undefined,
): LiveTimeChip {
  if (status === 'LIVE') {
    return { icon: '🔴', label: 'En juego', level: 'HOT' };
  }
  if (status === 'FINISHED') {
    const dateStr = kickoffUtc ? ` · ${fmtDate(kickoffUtc)}` : '';
    return { icon: '✅', label: `Finalizado${dateStr}`, level: 'INFO' };
  }
  if (!kickoffUtc) {
    return { icon: '⚠️', label: 'Sin fecha', level: 'UNKNOWN' };
  }

  const nowMs = Date.now();
  const kickoffMs = new Date(kickoffUtc).getTime();
  const diffMs = kickoffMs - nowMs;
  const hours = diffMs / (1000 * 60 * 60);
  const time = fmtTime(kickoffUtc);

  if (hours <= 0) {
    const minutesPast = -diffMs / (1000 * 60);
    if (minutesPast > 110) {
      return { icon: '🕐', label: 'Resultado pendiente', level: 'INFO' };
    }
    return { icon: '🔴', label: 'En juego', level: 'HOT' };
  }
  if (hours < 1) {
    const mins = Math.ceil(hours * 60);
    return { icon: '⏳', label: `Hoy · ${time} (en ${mins} min)`, level: 'HOT' };
  }
  if (hours < 24) {
    return { icon: '⏳', label: `Hoy · ${time}`, level: 'HOT' };
  }
  if (hours < 48) {
    return { icon: '⏳', label: `Mañana · ${time}`, level: 'OK' };
  }
  return { icon: '📅', label: `${fmtDate(kickoffUtc)} · ${time}`, level: 'INFO' };
}
