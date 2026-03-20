/**
 * Computes a live time label from kickoffUtc and the current browser time.
 * Umbrales zombie alineados con match-status.ts (fuente única de verdad).
 */
import { ZOMBIE_THRESHOLD_MIN, AUTOFINISH_THRESHOLD_MIN } from './match-status.js';

export interface LiveTimeChip {
  icon: string;
  label: string;
  level: 'HOT' | 'OK' | 'INFO' | 'WARN' | 'UNKNOWN';
}

const TZ = 'America/Montevideo';

function toLocalDateKey(utc: string): string {
  return new Date(utc).toLocaleDateString('en-CA', { timeZone: TZ });
}

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
    if (kickoffUtc) {
      const elapsed = (Date.now() - new Date(kickoffUtc).getTime()) / 60_000;
      // Auto-terminado → tratarlo como finalizado
      if (elapsed > AUTOFINISH_THRESHOLD_MIN) {
        const dateStr = ` · ${fmtDate(kickoffUtc)}`;
        return { icon: '✅', label: `Finalizado${dateStr}`, level: 'INFO' };
      }
      // Zombie: fuera de la ventana normal pero sin confirmación oficial
      if (elapsed > ZOMBIE_THRESHOLD_MIN) {
        return { icon: '🕐', label: 'Confirmando resultado', level: 'WARN' };
      }
    }
    return { icon: '🔴', label: 'LIVE', level: 'HOT' };
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
    const minutesPast = -diffMs / 60_000;
    // Partido con kickoff pasado y API aún en SCHEDULED — heurístico LIVE
    if (minutesPast > ZOMBIE_THRESHOLD_MIN) {
      return { icon: '🕐', label: 'Confirmando resultado', level: 'WARN' };
    }
    if (minutesPast > AUTOFINISH_THRESHOLD_MIN) {
      const dateStr = ` · ${fmtDate(kickoffUtc)}`;
      return { icon: '✅', label: `Finalizado${dateStr}`, level: 'INFO' };
    }
    return { icon: '🔴', label: 'LIVE', level: 'HOT' };
  }
  if (hours < 1) {
    const mins = Math.ceil(hours * 60);
    return { icon: '⏳', label: `Hoy · ${time} (en ${mins} min)`, level: 'HOT' };
  }

  // Comparar por fecha local en timezone del portal — nunca por horas brutas.
  // Un partido a las 22:00 mañana hora local puede estar a < 24h en UTC pero es "Mañana".
  const kickoffDateKey = toLocalDateKey(kickoffUtc);
  const todayKey = toLocalDateKey(new Date().toISOString());
  const tomorrowKey = toLocalDateKey(new Date(Date.now() + 86_400_000).toISOString());

  if (kickoffDateKey === todayKey) {
    return { icon: '⏳', label: `Hoy · ${time}`, level: 'HOT' };
  }
  if (kickoffDateKey === tomorrowKey) {
    return { icon: '⏳', label: `Mañana · ${time}`, level: 'OK' };
  }
  return { icon: '📅', label: `${fmtDate(kickoffUtc)} · ${time}`, level: 'INFO' };
}
