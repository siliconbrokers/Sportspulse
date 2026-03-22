-- WP-17-b: subscription_entitlements table
-- Authoritative record of a user's current subscription tier and state.
CREATE TABLE IF NOT EXISTS subscription_entitlements (
  user_id                   text        PRIMARY KEY,
  tier                      text        NOT NULL,
  state                     text        NOT NULL,
  provider_customer_id      text        NULL,
  provider_subscription_id  text        NULL,
  effective_at_utc          timestamptz NOT NULL,
  refreshed_at_utc          timestamptz NOT NULL,
  expires_at_utc            timestamptz NULL
);
