# F5 — Stale Fallback Snapshot

## Purpose
Validates behavior when a fresh build cannot succeed and the system serves the last valid snapshot.

## What it validates
- Stale snapshot serving (cached prior build returned)
- STALE_DATA warning injected on fallback
- Payload remains valid DTO shape under fallback mode

## Test approach
This is a runtime behavior test, not a static fixture comparison.
The golden fixture runner (SP-0902) handles F5 specially:
1. Build fresh snapshot from input.canonical.json
2. Cache it
3. Simulate build failure
4. Verify stale fallback returns cached + STALE_DATA warning

## Expected warnings (on stale serve)
- STALE_DATA (severity: WARN)
