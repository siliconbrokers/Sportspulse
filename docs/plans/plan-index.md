# Plan Index — SportPulse MVP Implementation Hierarchy

## Phase Map

```
Phase 1 — Foundations           ✅ DONE
  SP-0001  Scaffold repo
  SP-0002  Boundary enforcement
  SP-0003  Canonical JSON serializer

Phase 2 — Canonical Models      ✅ DONE
  SP-0101  Domain models (Competition, Season, Team, Match)
  SP-0102  Lifecycle classifier
  SP-0103  Football-data adapter
  SP-0104  Canonical normalization

Phase 3 — Signals               ✅ DONE
  SP-0201  Signal registry + SignalDTO
  SP-0202  FORM_POINTS_LAST_5
  SP-0203  NEXT_MATCH_HOURS
  SP-0204  PROXIMITY_BUCKET helper

Phase 4 — Scoring + Layout      ✅ DONE
  SP-0301  Policy registry + identity
  SP-0302  MVP policy execution
  SP-0303  Legacy resistance guards
  SP-0401  Treemap squarified v1
  SP-0402  All-zero fallback + warning
  SP-0403  Geometry validation

Phase 5 — Snapshot Engine       ✅ DONE
  SP-0501  Snapshot identity + header assembly
  SP-0502  Build pipeline orchestration
  SP-0503  Warning aggregation
  SP-0504  Layout diagnostics (optional)
  SP-0505  Cache/store + stale fallback

Phase 6 — API Layer             ✅ DONE
  SP-0601  GET /api/ui/dashboard
  SP-0602  GET /api/ui/team projection
  SP-0603  Error envelope + codes

Phase 7 — Frontend              ⬜ PENDING
  SP-0701  Dashboard page rendering      → depends on SP-0601
  SP-0702  Treemap rendering with rect   → depends on SP-0701
  SP-0703  Team selection + detail panel  → depends on SP-0702, SP-0602
  SP-0704  Degraded state visuals        → depends on SP-0701

Phase 8 — Degraded State QA     ⬜ PENDING
  SP-0801  Degraded-state fixture harness → depends on SP-0505, SP-0601
  SP-0802  All-zero layout e2e           → depends on SP-0702

Phase 9 — Golden Fixtures       ⬜ PENDING
  SP-0901  Fixture directories + inputs   → depends on SP-0502, SP-0601
  SP-0902  Golden fixture runner          → depends on SP-0901
  SP-0903  Version bump regression gates  → depends on SP-0902
```

## Dependency Critical Paths

```
Backend (complete):
  canonical → signals → scoring → layout → snapshot → api

Frontend:
  api → SP-0701 → SP-0702 → SP-0703
  api → SP-0701 → SP-0704

QA/Fixtures:
  snapshot+api → SP-0801 → SP-0802
  snapshot+api → SP-0901 → SP-0902 → SP-0903
```

## Plan Files Index

| Task | Plan File | Status |
|------|-----------|--------|
| SP-0204 | SP-0204-proximity-bucket.md | ✅ Implemented |
| SP-0303 | SP-0303-legacy-guards.md | ✅ Implemented |
| SP-0501 | SP-0501-snapshot-identity.md | ✅ Implemented |
| SP-0502 | SP-0502-build-pipeline.md | ✅ Implemented |
| SP-0503 | SP-0503-warning-aggregation.md | ✅ Implemented |
| SP-0505 | SP-0505-cache-store.md | ✅ Implemented |
| SP-0601 | SP-0601-api-dashboard.md | ✅ Implemented |
| SP-0602 | SP-0602-api-team.md | ✅ Implemented |
| SP-0603 | SP-0603-error-envelope.md | ✅ Implemented |
| SP-0701 | SP-0701-dashboard-page.md | 📋 Ready |
| SP-0702 | SP-0702-treemap-render.md | 📋 Ready |
| SP-0703 | SP-0703-team-detail-panel.md | 📋 Ready |
| SP-0704 | SP-0704-degraded-visuals.md | 📋 Ready |
| SP-0801 | SP-0801-degraded-fixture-harness.md | 📋 Ready |
| SP-0802 | SP-0802-allzero-e2e.md | 📋 Ready |
| SP-0901 | SP-0901-golden-fixtures.md | 📋 Ready |
| SP-0902 | SP-0902-fixture-runner.md | 📋 Ready |
| SP-0903 | SP-0903-version-bump-gates.md | 📋 Ready |
