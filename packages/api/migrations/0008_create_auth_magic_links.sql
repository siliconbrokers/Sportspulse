-- WP-17-b: auth_magic_links table
-- Single-use tokens for passwordless magic-link authentication. TTL: 15 minutes.
CREATE TABLE IF NOT EXISTS auth_magic_links (
  magic_link_id         uuid        PRIMARY KEY,
  email                 text        NOT NULL,
  token_hash            text        NOT NULL UNIQUE,
  return_context_json   jsonb       NULL,
  issued_at_utc         timestamptz NOT NULL,
  expires_at_utc        timestamptz NOT NULL,
  consumed_at_utc       timestamptz NULL,
  provider_message_id   text        NULL
);

CREATE INDEX IF NOT EXISTS auth_magic_links_email_idx
  ON auth_magic_links (email);

CREATE INDEX IF NOT EXISTS auth_magic_links_expires_at_utc_idx
  ON auth_magic_links (expires_at_utc);
