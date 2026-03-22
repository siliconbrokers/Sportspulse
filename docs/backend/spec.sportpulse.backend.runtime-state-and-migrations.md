---
artifact_id: SPEC-SPORTPULSE-BACKEND-RUNTIME-STATE-AND-MIGRATIONS
title: "Runtime State and Migrations"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: backend
slug: runtime-state-and-migrations
owner: backend
created_at: 2026-03-21
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-OPS-OPERATIONAL-BASELINE
  - SPEC-SPORTPULSE-BACKEND-SESSION-PERSISTENCE-AND-STATE-STORAGE
canonical_path: docs/backend/spec.sportpulse.backend.runtime-state-and-migrations.md
---
# Runtime State and Migrations

Version: 1.0.0  
Status: Active

## Purpose
Defines the minimal durable schema and migration policy required for session/auth and subscription checkout flows.

## Tables

### `web_sessions`
- `session_id` uuid pk
- `user_id` text not null
- `email` text not null
- `tier` text not null
- `is_pro` boolean not null
- `issued_at_utc` timestamptz not null
- `last_seen_at_utc` timestamptz not null
- `expires_at_utc` timestamptz not null
- `revoked_at_utc` timestamptz null

### `auth_magic_links`
- `magic_link_id` uuid pk
- `email` text not null
- `token_hash` text unique not null
- `return_context_json` jsonb null
- `issued_at_utc` timestamptz not null
- `expires_at_utc` timestamptz not null
- `consumed_at_utc` timestamptz null
- `provider_message_id` text null

### `subscription_entitlements`
- `user_id` text pk
- `tier` text not null
- `state` text not null
- `provider_customer_id` text null
- `provider_subscription_id` text null
- `effective_at_utc` timestamptz not null
- `refreshed_at_utc` timestamptz not null
- `expires_at_utc` timestamptz null

### `checkout_reconciliations`
- `checkout_session_id` text pk
- `user_id` text not null
- `status` text not null
- `return_context_json` jsonb null
- `paid_at_utc` timestamptz null
- `reconciled_at_utc` timestamptz null
- `last_error_code` text null

## Migration policy
- numbered migrations in `packages/api/migrations/`
- additive-first changes
- no mutation of applied migrations
- production deploy runs migrations before app boot

## Initial migration set
- `0007_create_web_sessions`
- `0008_create_auth_magic_links`
- `0009_create_subscription_entitlements`
- `0010_create_checkout_reconciliations`
