# F4 — Partial Snapshot

## Purpose
Validates snapshot generation when one team has zero match history.

## What it validates
- Real Madrid: full 5-match history + upcoming match → normal
- Newly Promoted FC: 0 finished matches, 1 upcoming → MISSING_SIGNAL for form
- Snapshot still builds successfully
- Signal missingness propagated correctly

## Expected warnings
- MISSING_SIGNAL (entityId: team:football-data:200, signal: FORM_POINTS_LAST_5)
