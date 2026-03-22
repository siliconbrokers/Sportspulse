/**
 * server/auth/magic-link-service.ts — Magic-link issuance and completion (WP-04B)
 *
 * WP-04B — POST /api/auth/magic-link/start + /complete
 * Governing spec: session-auth-contract v1.0.0, magic-link-email-delivery v1.0.0,
 *   api.contract v1.1.0, session-persistence-and-state-storage v1.0.0
 * Acceptance: K-06 (anonymous-first auth flow), K-04 (isPro determination)
 * Version impact: none
 *
 * Storage strategy:
 *   - DATABASE_URL present → PgMagicLinkStore (uses auth_magic_links table)
 *   - DATABASE_URL absent  → MemoryMagicLinkStore (Map — local dev / tests)
 */

import { randomUUID, createHash } from 'node:crypto';
import type { EmailAdapter } from './email-sink.js';
import { getEmailAdapter, setEmailAdapter } from './email-factory.js';
import { getSessionAdapter, setSessionAdapter } from './session-factory.js';
import type { SessionAdapter } from './session-adapter.js';
import { getPool } from '../db/client.js';
import type { Pool } from 'pg';

// ── Token TTL ────────────────────────────────────────────────────────────────

/** Magic-link token lifetime: 15 minutes. */
const TOKEN_TTL_MS = 15 * 60 * 1000;

/** Cooldown returned after successful issuance. */
const COOLDOWN_SECONDS = 60;

// ── Shared types ─────────────────────────────────────────────────────────────

export interface ReturnContext {
  returnTo: string;
  intent?: unknown;
}

export interface MagicLinkRecord {
  magicLinkId: string;
  email: string;
  tokenHash: string;
  returnContext: ReturnContext | null;
  issuedAtUtc: Date;
  expiresAtUtc: Date;
  consumedAtUtc: Date | null;
  providerMessageId: string | null;
}

// ── Storage interface ─────────────────────────────────────────────────────────

export interface MagicLinkStore {
  /** Persists a new magic-link record. */
  save(record: MagicLinkRecord): Promise<void>;
  /** Looks up a record by its token_hash. Returns null if not found. */
  findByTokenHash(tokenHash: string): Promise<MagicLinkRecord | null>;
  /** Marks the record consumed. */
  markConsumed(magicLinkId: string): Promise<void>;
}

// ── In-memory store (dev / tests) ────────────────────────────────────────────

export class MemoryMagicLinkStore implements MagicLinkStore {
  private readonly byHash = new Map<string, MagicLinkRecord>();
  private readonly byId = new Map<string, MagicLinkRecord>();

  async save(record: MagicLinkRecord): Promise<void> {
    this.byHash.set(record.tokenHash, record);
    this.byId.set(record.magicLinkId, record);
  }

  async findByTokenHash(tokenHash: string): Promise<MagicLinkRecord | null> {
    return this.byHash.get(tokenHash) ?? null;
  }

  async markConsumed(magicLinkId: string): Promise<void> {
    const record = this.byId.get(magicLinkId);
    if (record) {
      record.consumedAtUtc = new Date();
    }
  }
}

// ── PostgreSQL store (prod) ───────────────────────────────────────────────────

/** Row shape as returned by pg (snake_case). */
interface MagicLinkRow {
  magic_link_id: string;
  email: string;
  token_hash: string;
  return_context_json: ReturnContext | null;
  issued_at_utc: Date;
  expires_at_utc: Date;
  consumed_at_utc: Date | null;
  provider_message_id: string | null;
}

function rowToRecord(row: MagicLinkRow): MagicLinkRecord {
  return {
    magicLinkId: row.magic_link_id,
    email: row.email,
    tokenHash: row.token_hash,
    returnContext: row.return_context_json,
    issuedAtUtc: row.issued_at_utc,
    expiresAtUtc: row.expires_at_utc,
    consumedAtUtc: row.consumed_at_utc,
    providerMessageId: row.provider_message_id,
  };
}

export class PgMagicLinkStore implements MagicLinkStore {
  constructor(private readonly pool: Pool) {}

  async save(record: MagicLinkRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO auth_magic_links
         (magic_link_id, email, token_hash, return_context_json,
          issued_at_utc, expires_at_utc, consumed_at_utc, provider_message_id)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)`,
      [
        record.magicLinkId,
        record.email,
        record.tokenHash,
        record.returnContext ? JSON.stringify(record.returnContext) : null,
        record.issuedAtUtc,
        record.expiresAtUtc,
        record.providerMessageId,
      ],
    );
  }

  async findByTokenHash(tokenHash: string): Promise<MagicLinkRecord | null> {
    const { rows } = await this.pool.query<MagicLinkRow>(
      `SELECT * FROM auth_magic_links WHERE token_hash = $1`,
      [tokenHash],
    );
    if (rows.length === 0) return null;
    return rowToRecord(rows[0]!);
  }

  async markConsumed(magicLinkId: string): Promise<void> {
    await this.pool.query(
      `UPDATE auth_magic_links SET consumed_at_utc = NOW() WHERE magic_link_id = $1`,
      [magicLinkId],
    );
  }
}

// ── Store factory & override ──────────────────────────────────────────────────

let _store: MagicLinkStore | null = null;

function getMagicLinkStore(): MagicLinkStore {
  if (_store) return _store;
  const dbUrl = process.env['DATABASE_URL'];
  if (dbUrl && dbUrl.trim() !== '') {
    _store = new PgMagicLinkStore(getPool());
  } else {
    _store = new MemoryMagicLinkStore();
  }
  return _store;
}

/** Overrides the store singleton — for use in tests only. */
export function setMagicLinkStore(store: MagicLinkStore): void {
  _store = store;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Hashes an opaque token with SHA-256, returning a hex string. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Derives a user ID from an email deterministically (stable across logins). */
function deriveUserId(email: string): string {
  // Stable: hash the email, prefix with usr_
  const hash = createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 20);
  return `usr_${hash}`;
}

// ── Exported error types ──────────────────────────────────────────────────────

export class MagicLinkNotFoundError extends Error {
  constructor() {
    super('Token not found');
    this.name = 'MagicLinkNotFoundError';
  }
}

export class MagicLinkExpiredError extends Error {
  constructor() {
    super('Token expired');
    this.name = 'MagicLinkExpiredError';
  }
}

export class MagicLinkAlreadyUsedError extends Error {
  constructor() {
    super('Token already used');
    this.name = 'MagicLinkAlreadyUsedError';
  }
}

export class EmailDeliveryUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`Email delivery failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'EmailDeliveryUnavailableError';
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

export interface IssueMagicLinkResult {
  cooldownSeconds: number;
}

export interface CompleteMagicLinkResult {
  /** Opaque session ID — must be set as the sp_session cookie by the caller. */
  sessionId: string;
  session: {
    sessionStatus: 'authenticated';
    userId: string;
    email: string;
    tier: string;
    isPro: boolean;
    sessionIssuedAt: string;
  };
  resume: ReturnContext | null;
}

/**
 * Issues a new magic-link token for the given email.
 * Saves the record to the store, then sends the email.
 * Throws EmailDeliveryUnavailableError on email failure.
 */
export async function issueMagicLink(
  email: string,
  returnContext: ReturnContext | null,
  opts?: {
    emailAdapter?: EmailAdapter;
    appBaseUrl?: string;
  },
): Promise<IssueMagicLinkResult> {
  const store = getMagicLinkStore();
  const emailAdapter = opts?.emailAdapter ?? getEmailAdapter();
  const appBaseUrl =
    opts?.appBaseUrl ?? process.env['APP_BASE_URL'] ?? 'http://localhost:3000';

  const token = randomUUID();
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAtUtc = new Date(now.getTime() + TOKEN_TTL_MS);

  const record: MagicLinkRecord = {
    magicLinkId: randomUUID(),
    email,
    tokenHash,
    returnContext,
    issuedAtUtc: now,
    expiresAtUtc,
    consumedAtUtc: null,
    providerMessageId: null,
  };

  // Save BEFORE sending email — prevents orphaned tokens if save fails after send.
  await store.save(record);

  const magicLinkUrl = `${appBaseUrl}/api/auth/magic-link/complete?token=${encodeURIComponent(token)}`;

  let providerMessageId: string | null = null;
  try {
    providerMessageId = await emailAdapter.sendMagicLink({
      to: email,
      token,
      magicLinkUrl,
      returnContext,
    });
  } catch (err) {
    throw new EmailDeliveryUnavailableError(err);
  }

  // Back-fill providerMessageId if available. Best-effort — don't fail the
  // whole flow if this secondary update fails.
  if (providerMessageId !== null) {
    record.providerMessageId = providerMessageId;
  }

  return { cooldownSeconds: COOLDOWN_SECONDS };
}

/**
 * Completes a magic-link flow: validates the token, marks it consumed,
 * creates a session, and returns the session DTO + resume context.
 *
 * Throws:
 *   - MagicLinkNotFoundError   → 400 INVALID_TOKEN
 *   - MagicLinkExpiredError    → 410 TOKEN_EXPIRED
 *   - MagicLinkAlreadyUsedError → 409 TOKEN_ALREADY_USED
 */
export async function completeMagicLink(
  token: string,
  opts?: {
    sessionAdapter?: SessionAdapter;
  },
): Promise<CompleteMagicLinkResult> {
  const store = getMagicLinkStore();
  const sessionAdapter = opts?.sessionAdapter ?? getSessionAdapter();

  const tokenHash = hashToken(token);
  const record = await store.findByTokenHash(tokenHash);

  if (!record) {
    throw new MagicLinkNotFoundError();
  }

  if (record.expiresAtUtc < new Date()) {
    throw new MagicLinkExpiredError();
  }

  if (record.consumedAtUtc !== null) {
    throw new MagicLinkAlreadyUsedError();
  }

  // Mark consumed BEFORE creating session to prevent race re-use.
  await store.markConsumed(record.magicLinkId);

  // Create session — default tier=free, isPro=false (pro determination is
  // separate from auth, handled by commerce layer per spec K-04).
  const userId = deriveUserId(record.email);
  const expiresAtUtc = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  const session = await sessionAdapter.createSession({
    userId,
    email: record.email,
    tier: 'free',
    isPro: false,
    expiresAtUtc,
  });

  return {
    sessionId: session.sessionId,
    session: {
      sessionStatus: 'authenticated',
      userId: session.userId,
      email: session.email,
      tier: session.tier,
      isPro: session.isPro,
      sessionIssuedAt: session.issuedAtUtc.toISOString(),
    },
    resume: record.returnContext,
  };
}

// Re-export so tests can inject without importing from session-factory directly.
export { setSessionAdapter, setEmailAdapter };
