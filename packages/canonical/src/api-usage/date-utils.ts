/**
 * date-utils.ts — Timezone-aware date helpers for quota ledger.
 * Spec: SPEC-SPORTPULSE-OPS-QUOTA-LEDGER-TIMEZONE-AWARENESS §5.1, §5.2
 *
 * Rules:
 * - Never use `.toISOString().slice(0, 10)` — that always returns UTC date.
 * - Always use `currentDayInTimezone(tz)` for per-provider date recording/querying.
 * - `'en-CA'` locale produces YYYY-MM-DD natively without external dependencies.
 */

/**
 * Returns the current date as YYYY-MM-DD in the given IANA timezone.
 * e.g. currentDayInTimezone('America/Montevideo') → '2026-03-20' even after midnight UTC
 * e.g. currentDayInTimezone('UTC') → identical to new Date().toISOString().slice(0, 10)
 */
export function currentDayInTimezone(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
  } catch {
    console.warn(`[ApiUsageLedger] Invalid timezone '${timezone}', falling back to UTC`);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date());
  }
}

/**
 * Returns the current month as YYYY-MM in the given IANA timezone.
 * Used for providers with monthly quota windows (e.g. The Odds API).
 * e.g. currentMonthInTimezone('UTC') → '2026-03'
 */
export function currentMonthInTimezone(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
    })
      .format(new Date())
      .slice(0, 7);
  } catch {
    console.warn(`[ApiUsageLedger] Invalid timezone '${timezone}', falling back to UTC`);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
    })
      .format(new Date())
      .slice(0, 7);
  }
}
