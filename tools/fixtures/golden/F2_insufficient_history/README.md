# F2 — Insufficient History

## Purpose
Validates behavior when one team has fewer than 5 finished matches.

## What it validates
- Real Madrid: 5 matches (WWWDW = 13 pts) — full history
- FC Barcelona: 2 matches (WL = 3 pts) — insufficient history
- INSUFFICIENT_HISTORY warning for Barcelona
- Scoring still works with reduced window

## Expected warnings
- INSUFFICIENT_HISTORY (entityId: team:football-data:81)
