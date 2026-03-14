/**
 * af-budget — Presupuesto diario compartido para API-Football v3.
 *
 * Coordina los 3 consumidores (LiveOverlay, IncidentSource, CLIOverlay)
 * para que no agoten independientemente los 100 req/día del plan free.
 *
 * Asignación de presupuesto:
 *   0–79 req  → operación normal para todos los consumidores
 *   80–99 req → LiveOverlay throttlea a 20 min; Incidents/CLI siguen con lo que queda
 *   100+ req  → cuota agotada (hard stop) hasta medianoche UTC
 *
 * La cuota agotada también se detecta por respuesta explícita de la API
 * (HTTP 200 con { errors: { requests: "You have reached the limit..." } }).
 */

const HARD_LIMIT  = 100;
const BRAKE_LIVE  = 80;  // LiveOverlay empieza a throttlear aquí

let _requestsToday       = 0;
let _dayUtc              = currentDayUtc();
let _quotaExhaustedUntil = 0;

function currentDayUtc(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

function resetIfNewDay(): void {
  const today = currentDayUtc();
  if (_dayUtc !== today) {
    _dayUtc              = today;
    _requestsToday       = 0;
    _quotaExhaustedUntil = 0;
    console.log('[AfBudget] Nuevo día UTC — contador de requests reseteado');
  }
}

/** True si la cuota está agotada (por detección API o por límite contado). */
export function isQuotaExhausted(): boolean {
  resetIfNewDay();
  return Date.now() < _quotaExhaustedUntil || _requestsToday >= HARD_LIMIT;
}

/** True cuando LiveOverlay debe throttlear para dejar margen a otros consumidores. */
export function isLiveBrakeActive(): boolean {
  resetIfNewDay();
  return _requestsToday >= BRAKE_LIVE;
}

/** Registra una request consumida. Llamar DESPUÉS de cada llamada exitosa a la API. */
export function consumeRequest(): void {
  resetIfNewDay();
  _requestsToday++;
}

/**
 * Marca la cuota como agotada hasta medianoche UTC.
 * Llamar cuando la API responde con errors.requests.
 */
export function markQuotaExhausted(): void {
  const now = new Date();
  const nextMidnight = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1,
  ));
  _quotaExhaustedUntil = nextMidnight.getTime();
  console.warn(
    `[AfBudget] Cuota agotada — ${_requestsToday}/${HARD_LIMIT} requests hoy. ` +
    `Suspendido hasta ${nextMidnight.toISOString()}`,
  );
}

/** Estadísticas actuales para logging y respuestas de API. */
export function getBudgetStats(): {
  requestsToday: number;
  limit: number;
  exhausted: boolean;
  brakeActive: boolean;
} {
  resetIfNewDay();
  return {
    requestsToday: _requestsToday,
    limit: HARD_LIMIT,
    exhausted: isQuotaExhausted(),
    brakeActive: isLiveBrakeActive(),
  };
}
