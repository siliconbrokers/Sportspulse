-- WP-17-b: checkout_reconciliations table
-- Tracks Stripe checkout sessions and their reconciliation state.
CREATE TABLE IF NOT EXISTS checkout_reconciliations (
  checkout_session_id   text        PRIMARY KEY,
  user_id               text        NOT NULL,
  status                text        NOT NULL,
  return_context_json   jsonb       NULL,
  paid_at_utc           timestamptz NULL,
  reconciled_at_utc     timestamptz NULL,
  last_error_code       text        NULL
);

CREATE INDEX IF NOT EXISTS checkout_reconciliations_user_id_idx
  ON checkout_reconciliations (user_id);
