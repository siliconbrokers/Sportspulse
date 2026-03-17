/**
 * af-budget — Presupuesto diario compartido para API-Football v3.
 *
 * Plan: 20.000 req/mes ≈ 667 req/día promedio.
 * Uso estimado: 150–200 req/día en pico (matchday con T3 completo).
 *
 * Asignación de presupuesto:
 *   0–499 req  → operación normal para todos los consumidores
 *   500–599 req → LiveOverlay throttlea a 20 min; Incidents/CLI siguen con lo que queda
 *   600+ req   → cuota agotada (hard stop) hasta medianoche UTC
 *
 * La cuota agotada también se detecta por respuesta explícita de la API
 * (HTTP 200 con { errors: { requests: "You have reached the limit..." } }).
 *
 * Persistencia en disco: el contador sobrevive reinicios del servidor.
 * Archivo: cache/af-budget.json — escritura atómica (.tmp → rename).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const HARD_LIMIT  = 7500;
const BRAKE_LIVE  = 6500;  // LiveOverlay empieza a throttlear aquí

const BUDGET_FILE = path.join(process.cwd(), 'cache', 'af-budget.json');

interface BudgetDoc {
  date: string;           // YYYY-MM-DD UTC
  requestsToday: number;
  quotaExhaustedUntil: number; // timestamp ms, 0 si no está agotada
}

let _requestsToday       = 0;
let _dayUtc              = currentDayUtc();
let _quotaExhaustedUntil = 0;

// ── Disk persistence ──────────────────────────────────────────────────────────

function currentDayUtc(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

/** Reads the persisted budget from disk. Returns null if missing or stale day. */
function loadFromDisk(): BudgetDoc | null {
  try {
    const raw = fs.readFileSync(BUDGET_FILE, 'utf-8');
    const doc = JSON.parse(raw) as BudgetDoc;
    if (doc.date !== currentDayUtc()) return null; // different day → ignore
    return doc;
  } catch {
    return null;
  }
}

/** Writes current budget state to disk atomically (fire-and-forget). */
function persistToDisk(): void {
  const doc: BudgetDoc = {
    date: _dayUtc,
    requestsToday: _requestsToday,
    quotaExhaustedUntil: _quotaExhaustedUntil,
  };
  const tmp = `${BUDGET_FILE}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(BUDGET_FILE), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(doc), 'utf-8');
    fs.renameSync(tmp, BUDGET_FILE);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

// ── Startup: restore from disk ─────────────────────────────────────────────

(function initFromDisk() {
  const saved = loadFromDisk();
  if (saved) {
    _requestsToday       = saved.requestsToday;
    _quotaExhaustedUntil = saved.quotaExhaustedUntil;
    _dayUtc              = saved.date;
    console.log(
      `[AfBudget] Restaurado desde disco: ${_requestsToday}/${HARD_LIMIT} requests hoy (${_dayUtc})` +
      (_quotaExhaustedUntil > Date.now() ? ' — CUOTA AGOTADA' : ''),
    );
  }
})();

// ── Internal helpers ──────────────────────────────────────────────────────────

function resetIfNewDay(): void {
  const today = currentDayUtc();
  if (_dayUtc !== today) {
    _dayUtc              = today;
    _requestsToday       = 0;
    _quotaExhaustedUntil = 0;
    console.log('[AfBudget] Nuevo día UTC — contador de requests reseteado');
    persistToDisk();
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

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
  // Log at thresholds for visibility
  if (_requestsToday === 1000 || _requestsToday === 3000 || _requestsToday === 5000 || _requestsToday === BRAKE_LIVE) {
    console.warn(`[AfBudget] ${_requestsToday}/${HARD_LIMIT} requests hoy (brake: ${_requestsToday >= BRAKE_LIVE})`);
  }
  persistToDisk();
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
  persistToDisk(); // persist immediately (synchronous path already done above)
}

/** Estadísticas actuales para logging y respuestas de API. */
export function getBudgetStats(): {
  requestsToday: number;
  limit: number;
  exhausted: boolean;
  brakeActive: boolean;
  quotaExhaustedUntil: number;
} {
  resetIfNewDay();
  return {
    requestsToday: _requestsToday,
    limit: HARD_LIMIT,
    exhausted: isQuotaExhausted(),
    brakeActive: isLiveBrakeActive(),
    quotaExhaustedUntil: _quotaExhaustedUntil,
  };
}
