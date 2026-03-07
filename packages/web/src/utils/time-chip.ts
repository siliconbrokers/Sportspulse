/**
 * Computes a live time label from kickoffUtc and the current browser time.
 * Replaces the stale backend-computed timeChip.label for display purposes.
 */
export interface LiveTimeChip {
  icon: string;
  label: string;
  level: 'HOT' | 'OK' | 'INFO' | 'WARN' | 'UNKNOWN';
}

export function computeLiveTimeChip(
  status: string | undefined,
  kickoffUtc: string | undefined,
): LiveTimeChip {
  if (status === 'LIVE') {
    return { icon: '🔴', label: 'En juego', level: 'HOT' };
  }
  if (status === 'FINISHED') {
    return { icon: '✅', label: 'Finalizado', level: 'INFO' };
  }
  if (!kickoffUtc) {
    return { icon: '⚠️', label: 'Sin fecha', level: 'UNKNOWN' };
  }

  const nowMs = Date.now();
  const kickoffMs = new Date(kickoffUtc).getTime();
  const diffMs = kickoffMs - nowMs;
  const hours = diffMs / (1000 * 60 * 60);

  if (hours <= 0) {
    const minutesPast = -diffMs / (1000 * 60);
    if (minutesPast > 110) {
      // El partido probablemente terminó pero el backend aún no actualizó el estado.
      return { icon: '🕐', label: 'Resultado pendiente', level: 'INFO' };
    }
    // Dentro de los 110 minutos: el partido está en juego
    return { icon: '🔴', label: 'En juego', level: 'HOT' };
  }
  if (hours < 1) {
    const mins = Math.ceil(hours * 60);
    return { icon: '⏳', label: `Hoy · en ${mins} min`, level: 'HOT' };
  }
  if (hours < 24) {
    return { icon: '⏳', label: `Hoy · en ${Math.ceil(hours)} h`, level: 'HOT' };
  }
  if (hours < 48) {
    return { icon: '⏳', label: `Mañana · en ${Math.ceil(hours)} h`, level: 'OK' };
  }
  if (hours <= 168) {
    return { icon: '📅', label: `En ${Math.round(hours / 24)} días`, level: 'INFO' };
  }
  return { icon: '🗓️', label: `En ${Math.round(hours / 24)} días`, level: 'INFO' };
}
