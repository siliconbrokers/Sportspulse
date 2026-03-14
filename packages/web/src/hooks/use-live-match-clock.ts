import { useState, useEffect } from 'react';

/**
 * Retorna el texto de tiempo a mostrar en un partido en vivo.
 *
 * Estrategia:
 * - Si matchPeriod está disponible (TheSportsDB: 1H/HT/2H), se usa directamente.
 * - Si no está disponible (football-data IN_PLAY), se infiere por tiempo transcurrido.
 * - El contador se actualiza cada segundo para mostrar un reloj vivo.
 *
 * Formato de salida:
 *   FIRST_HALF  → "34'" (o "45+N'" si hay tiempo añadido)
 *   HALF_TIME   → "HT"
 *   SECOND_HALF → "67'" (o "90+N'")
 *   EXTRA_TIME  → "ET"
 *   PENALTIES   → "Pen"
 *   sin datos   → null (mostrar solo badge LIVE)
 */
export function useLiveMatchClock(
  kickoffUtc: string | null | undefined,
  matchPeriod: string | null | undefined,
  isLive: boolean,
): string | null {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!isLive || !kickoffUtc) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [isLive, kickoffUtc]);

  if (!isLive || !kickoffUtc) return null;

  // Períodos que no necesitan reloj
  if (matchPeriod === 'HALF_TIME') return 'HT';
  if (matchPeriod === 'EXTRA_TIME') return 'ET';
  if (matchPeriod === 'PENALTIES') return 'Pen';

  const elapsedMin = Math.floor((Date.now() - new Date(kickoffUtc).getTime()) / 60_000);
  if (elapsedMin < 0) return null;

  if (matchPeriod === 'FIRST_HALF') {
    const m = Math.min(Math.max(elapsedMin, 1), 52); // cap razonable con tiempo añadido
    return m <= 45 ? `${m}'` : `45+${m - 45}'`;
  }

  if (matchPeriod === 'SECOND_HALF') {
    // 2T empieza ~60 min después del kickoff (45 min 1T + ~15 min HT)
    const m2 = Math.min(Math.max(elapsedMin - 60, 1), 52);
    const display = m2 + 45;
    return display <= 90 ? `${display}'` : `90+${display - 90}'`;
  }

  // Sin matchPeriod: heurística por tiempo transcurrido
  if (elapsedMin <= 52) {
    // Probablemente 1T
    const m = Math.min(Math.max(elapsedMin, 1), 52);
    return m <= 45 ? `${m}'` : `45+${m - 45}'`;
  }
  if (elapsedMin <= 65) {
    // Probablemente HT (football-data PAUSED no llegó aún o lag de API)
    return 'HT';
  }
  // Probablemente 2T
  const m2 = Math.min(Math.max(elapsedMin - 60, 1), 52);
  const display = m2 + 45;
  return display <= 90 ? `${display}'` : `90+${display - 90}'`;
}
