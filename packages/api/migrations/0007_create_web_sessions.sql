-- WP-17-b: web_sessions table
-- Stores authenticated user sessions. Revocation sets revoked_at_utc; records are never deleted.
CREATE TABLE IF NOT EXISTS web_sessions (
  session_id        uuid        PRIMARY KEY,
  user_id           text        NOT NULL,
  email             text        NOT NULL,
  tier              text        NOT NULL,
  is_pro            boolean     NOT NULL DEFAULT false,
  issued_at_utc     timestamptz NOT NULL,
  last_seen_at_utc  timestamptz NOT NULL,
  expires_at_utc    timestamptz NOT NULL,
  revoked_at_utc    timestamptz NULL
);

CREATE INDEX IF NOT EXISTS web_sessions_user_id_idx
  ON web_sessions (user_id);

CREATE INDEX IF NOT EXISTS web_sessions_expires_at_utc_idx
  ON web_sessions (expires_at_utc);
