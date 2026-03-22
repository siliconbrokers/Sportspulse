/**
 * server/auth/email-sink.ts — Email adapter interface + dev log sink (WP-04B)
 *
 * WP-04B — POST /api/auth/magic-link/start + /complete
 * Governing spec: magic-link-email-delivery v1.0.0, api.contract v1.1.0
 * Acceptance: K-06 (anonymous-first auth flow)
 * Version impact: none
 */

export interface EmailAdapter {
  /**
   * Sends a magic-link email to the given address.
   * Returns the provider message ID (string) or null if the provider
   * does not supply one. Throws on delivery failure.
   */
  sendMagicLink(params: {
    to: string;
    token: string;
    magicLinkUrl: string;
    returnContext: unknown;
  }): Promise<string | null>;
}

/**
 * LogSinkEmailAdapter — Used in local dev and tests.
 * Logs the magic link to stdout instead of sending an email.
 * Always returns a deterministic fake message ID.
 */
export class LogSinkEmailAdapter implements EmailAdapter {
  async sendMagicLink(params: {
    to: string;
    token: string;
    magicLinkUrl: string;
    returnContext: unknown;
  }): Promise<string | null> {
    console.log('[AUTH DEV] Magic link:', params.magicLinkUrl);
    return 'dev-message-id';
  }
}
