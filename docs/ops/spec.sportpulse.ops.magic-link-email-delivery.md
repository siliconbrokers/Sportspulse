---
artifact_id: SPEC-SPORTPULSE-OPS-MAGIC-LINK-EMAIL-DELIVERY
title: "Magic-Link Email Delivery"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: ops
slug: magic-link-email-delivery
owner: ops
created_at: 2026-03-21
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-BACKEND-SESSION-AUTH-CONTRACT
  - SPEC-SPORTPULSE-SERVER-BACKEND-ARCHITECTURE
canonical_path: docs/ops/spec.sportpulse.ops.magic-link-email-delivery.md
---
# Magic-Link Email Delivery

Version: 1.0.0  
Status: Active

## Provider decision

MVP provider: **Resend** via HTTP API.  
Fallbacks:
- local development: log sink / test mailbox adapter
- emergency operational fallback: SMTP adapter behind the same mail interface

Frontend has zero provider awareness.

## Required environment variables
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `EMAIL_REPLY_TO` (optional)
- `APP_BASE_URL`

## Delivery rules
- one template family: `magic_link_sign_in`
- token is embedded in a single CTA URL
- email subject is stable and product-branded
- no marketing content in auth email
- no attachment support

## Reliability rules
- backend stores provider message id when available
- start endpoint is rate-limited by email and IP
- delivery failure surfaces as `EMAIL_DELIVERY_UNAVAILABLE`
- backend never reveals whether the email corresponds to an existing account
