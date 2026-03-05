# F3 — No Upcoming Match

## Purpose
Validates behavior when a team has no valid upcoming match.

## What it validates
- Real Madrid: has scheduled match → normal
- Atletico Madrid: has NO scheduled match → missing next-match signal
- NO_UPCOMING_MATCH warning for Atletico
- MISSING_SIGNAL for NEXT_MATCH_HOURS on Atletico
- Atletico's nextMatch is undefined

## Expected warnings
- NO_UPCOMING_MATCH (entityId: team:football-data:78)
- MISSING_SIGNAL (entityId: team:football-data:78, signal: NEXT_MATCH_HOURS)
