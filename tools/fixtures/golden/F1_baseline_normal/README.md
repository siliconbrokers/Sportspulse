# F1 — Baseline Normal Snapshot

## Purpose
Validates the normal happy-path snapshot under complete, healthy conditions.

## What it validates
- Canonical entity mapping (4 teams, 20 finished + 2 scheduled matches)
- Standard signal computation (full 5-match form window for all teams)
- Scoring policy execution (MVP form+agenda weights)
- Deterministic ordering (layoutWeight desc, teamId asc)
- Geometry generation (all rects valid, non-overlapping)
- DTO completeness
- Absence of unnecessary warnings

## Teams
- Real Madrid: WWWDW = 13 pts (form 0.87)
- FC Barcelona: WWDWW = 13 pts (form 0.87)
- Atletico Madrid: WDWDW = 11 pts (form 0.73)
- Athletic Bilbao: DWDWL = 8 pts (form 0.53)

## Expected warnings
None (empty warnings array)

## Version sensitivity
- policyVersion: 1
- layoutAlgorithmVersion: 1
- snapshotSchemaVersion: 1
