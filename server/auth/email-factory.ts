/**
 * server/auth/email-factory.ts — Email adapter factory (WP-04B)
 *
 * Returns ResendEmailAdapter when RESEND_API_KEY is set (production/staging),
 * otherwise falls back to LogSinkEmailAdapter (dev/test).
 *
 * WP-04B — POST /api/auth/magic-link/start + /complete
 * Governing spec: magic-link-email-delivery v1.0.0
 * Acceptance: K-06 (anonymous-first auth flow)
 * Version impact: none
 */

import type { EmailAdapter } from './email-sink.js';
import { LogSinkEmailAdapter } from './email-sink.js';
import { ResendEmailAdapter } from './email-resend.js';

let _adapter: EmailAdapter | null = null;

/**
 * Returns the shared EmailAdapter instance, creating it on first call.
 * In production (RESEND_API_KEY set) this is ResendEmailAdapter.
 * In dev / tests this is LogSinkEmailAdapter.
 */
export function getEmailAdapter(): EmailAdapter {
  if (_adapter) return _adapter;
  const apiKey = process.env['RESEND_API_KEY'];
  if (apiKey && apiKey.trim() !== '') {
    _adapter = new ResendEmailAdapter(apiKey);
  } else {
    _adapter = new LogSinkEmailAdapter();
  }
  return _adapter;
}

/**
 * Overrides the adapter singleton — for use in tests only.
 * Call this before issuing any magic links under test.
 */
export function setEmailAdapter(adapter: EmailAdapter): void {
  _adapter = adapter;
}
