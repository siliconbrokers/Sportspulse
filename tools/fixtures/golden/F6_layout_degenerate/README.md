# F6 — Layout Degenerate Case

## Purpose
Validates layout fallback and geometry determinism under all-zero weight conditions.

## What it validates
- All teams have 0 finished matches + 0 upcoming → all layoutWeight = 0
- LAYOUT_DEGRADED warning present
- Equal synthetic layout fallback (all tiles approximately equal area)
- Valid rect generation (positive dimensions, within bounds)
- MISSING_SIGNAL warnings for both signals on all teams

## Expected warnings
- LAYOUT_DEGRADED (severity: WARN)
- MISSING_SIGNAL x6 (2 signals x 3 teams)
- NO_UPCOMING_MATCH x3
