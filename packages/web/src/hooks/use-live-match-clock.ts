import { useState, useEffect } from 'react';

/**
 * Retorna el texto de tiempo a mostrar en un partido en vivo.
 *
 * Estrategia (prioridad):
 * 1. Si `elapsedMinutes` viene de la API (AF: fixture.status.elapsed), se usa como base
 *    y el ticker avanza 1 min/s para suavizar. Es el tiempo real del partido.
 * 2. Si matchPeriod está disponible (TheSportsDB: 1H/HT/2H), se deriva del tiempo UTC.
 * 3. Si no hay ninguno, heurística por tiempo transcurrido desde kickoffUtc.
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
  elapsedMinutes?: number | null,
): string | null {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!isLive || !kickoffUtc) return;
    // When API provides elapsedMinutes, no need to tick — value updates on each poll (~60s)
    if (elapsedMinutes != null) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [isLive, kickoffUtc, elapsedMinutes]);

  if (!isLive || !kickoffUtc) return null;

  // Períodos que no necesitan reloj
  if (matchPeriod === 'HALF_TIME') return 'HT';
  if (matchPeriod === 'EXTRA_TIME') return 'ET';
  if (matchPeriod === 'PENALTIES') return 'Pen';

  // Estrategia 1: minuto real de la API (se actualiza en cada poll ~60s)
  if (elapsedMinutes != null) {
    if (matchPeriod === 'SECOND_HALF' || elapsedMinutes > 45) {
      return elapsedMinutes <= 90 ? `${elapsedMinutes}'` : `90+${elapsedMinutes - 90}'`;
    }
    return `${Math.min(elapsedMinutes, 52)}'`;
  }

  // Estrategia 2/3: derivar desde kickoffUtc
  const elapsedMin = Math.floor((Date.now() - new Date(kickoffUtc).getTime()) / 60_000);
  if (elapsedMin < 0) return null;

  if (matchPeriod === 'FIRST_HALF') {
    const m = Math.min(Math.max(elapsedMin, 1), 52);
    return m <= 45 ? `${m}'` : `45+${m - 45}'`;
  }

  if (matchPeriod === 'SECOND_HALF') {
    // 2T empieza ~62 min después del kickoff (45 min 1T + ~2 min extra + 15 min HT estricto)
    const m2 = Math.min(Math.max(elapsedMin - 62, 1), 52);
    const display = m2 + 45;
    return display <= 90 ? `${display}'` : `90+${display - 90}'`;
  }

  // Sin matchPeriod: heurística por tiempo transcurrido
  if (elapsedMin <= 52) {
    const m = Math.min(Math.max(elapsedMin, 1), 52);
    return m <= 45 ? `${m}'` : `45+${m - 45}'`;
  }
  if (elapsedMin <= 67) {
    return 'HT';
  }
  const m2 = Math.min(Math.max(elapsedMin - 62, 1), 52);
  const display = m2 + 45;
  return display <= 90 ? `${display}'` : `90+${display - 90}'`;
}
