/**
 * server/auth/email-resend.ts — Resend email adapter for production (WP-04B)
 *
 * WP-04B — POST /api/auth/magic-link/start + /complete
 * Governing spec: magic-link-email-delivery v1.0.0, api.contract v1.1.0
 * Acceptance: K-06 (anonymous-first auth flow)
 * Version impact: none
 */

import type { EmailAdapter } from './email-sink.js';

export class ResendEmailAdapter implements EmailAdapter {
  constructor(private readonly apiKey: string) {}

  async sendMagicLink(params: {
    to: string;
    token: string;
    magicLinkUrl: string;
    returnContext: unknown;
  }): Promise<string | null> {
    const from = process.env['EMAIL_FROM'] ?? 'noreply@sportpulse.com';
    const replyTo = process.env['EMAIL_REPLY_TO'];

    const payload: Record<string, unknown> = {
      from,
      to: params.to,
      subject: 'Tu enlace de acceso a SportPulse',
      html: `<p>Haz click en el enlace para acceder: <a href="${params.magicLinkUrl}">${params.magicLinkUrl}</a></p><p>Expira en 15 minutos.</p>`,
      ...(replyTo ? { reply_to: replyTo } : {}),
    };

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Resend error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as { id?: string };
    return data.id ?? null;
  }
}
