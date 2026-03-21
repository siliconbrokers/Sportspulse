---
artifact_id: SPEC-SPORTPULSE-CORE-REPO-STRUCTURE-AND-MODULE-BOUNDARIES
title: "Repo Structure and Module Boundaries"
artifact_class: spec
status: active
version: 1.2.0
project: sportpulse
domain: core
slug: repo-structure-and-module-boundaries
owner: team
created_at: 2026-03-15
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/core/spec.sportpulse.core.repo-structure-and-module-boundaries.md
---
# SportPulse — Repo Structure and Module Boundaries

Version: 1.2
Status: Authoritative repository/module boundary definition for MVP — amended to include packages/prediction (v1.1)  
Scope: Repository layout, module responsibilities, dependency rules, and boundary constraints for SportPulse MVP implementation  
Audience: Backend, Frontend, QA, Ops, AI-assisted development workflows

---

## 1. Purpose

This document defines:

- the canonical repository structure for SportPulse MVP
- module responsibilities and interfaces
- allowed and forbidden dependencies
- where domain truth lives
- how to prevent architectural drift in AI-assisted development

Its purpose is to make the codebase:

- deterministic and testable
- boundary-disciplined
- maintainable
- resistant to accidental coupling and legacy reintroduction

---

## 2. Authority

This document is authoritative for:

- directory structure
- module ownership rules
- dependency constraints
- test placement expectations
- build and runtime boundaries

If an implementation violates these rules, it is considered non-compliant even if feature behavior appears correct.

---

## 3. Repository layout (MVP)

This is the recommended MVP repository layout.

> Note: names are stable and should not be altered casually, because documentation and AI workflows will reference them.

```
sportpulse/
  README.md
  docs/
    _registry/
      document-registry.md
    core/
      spec.sportpulse.core.constitution.md
      spec.sportpulse.core.domain-glossary-and-invariants.md
      spec.sportpulse.core.mvp-execution-scope.md
      spec.sportpulse.core.non-functional-requirements.md
      spec.sportpulse.ops.operational-baseline.md
      spec.sportpulse.core.repo-structure-and-module-boundaries.md
      spec.sportpulse.shared.errors-and-warnings-taxonomy.md
      spec.sportpulse.qa.acceptance-test-matrix.md
      spec.sportpulse.qa.golden-snapshot-fixtures.md
      spec.sportpulse.qa.prediction-track-record-fixtures.md
      spec.sportpulse.core.implementation-backlog.md
      spec.sportpulse.core.ai-sdd-operating-protocol.md
      spec.sportpulse.core.subagents-definition.md
      spec.sportpulse.core.universal-case-intake-protocol.md
    qa/
      spec.sportpulse.qa.acceptance-gap-closure-update.md
    backend/
      spec.sportpulse.backend.frontend-integration-delta.md
      spec.sportpulse.backend.session-auth-contract.md
      spec.sportpulse.backend.shared-return-context-contract.md
      spec.sportpulse.backend.subscription-checkout-contract.md
      spec.sportpulse.backend.track-record-contract.md
    specs/
      pipeline/
        spec.sportpulse.signals.core.md
        spec.sportpulse.signals.metrics.md
        spec.sportpulse.scoring.policy.md
        spec.sportpulse.snapshot.engine.md
        spec.sportpulse.snapshot.dashboard-dto.md
        spec.sportpulse.server.matchday-cache.md
      api/
        spec.sportpulse.api.contract.md
        spec.sportpulse.api.refresh-optimization.md
      layout/
        spec.sportpulse.layout.treemap-algorithm.md
        spec.sportpulse.layout.stability.md
      portal/
        spec.sportpulse.web.ui.md
        spec.sportpulse.portal.interaction.md
        [additional portal specs]
      prediction/
        spec.sportpulse.prediction.engine.md
        spec.sportpulse.prediction.conformance-test-plan.md
        [additional prediction specs]
      competition/
      data/
    architecture/
      spec.sportpulse.server.backend-architecture.md
      spec.sportpulse.web.frontend-architecture.md
      spec.sportpulse.web.component-map.md
    data/
      spec.sportpulse.data.normalization.md
      spec.sportpulse.data.event-lifecycle.md
      spec.sportpulse.data.quality.md
    evolution/
      spec.sportpulse.product.feature-evolution.md
      spec.sportpulse.product.product-loop.md
    product/
      report.sportpulse.product.business-plan.2026-03-01.md  [active — v3.0]
      spec.sportpulse.product.mvp-strategic-brief.md         [superseded]
      spec.sportpulse.product.mvp-one-pager.md               [superseded]
    audits/
    plans/
    archive/
  packages/
    shared/
      src/
        domain/
        time/
        ids/
        errors/
        warnings/
        versioning/
        utils/
      test/
    canonical/
      src/
        ingest/
        normalize/
        model/
        lifecycle/
      test/
    signals/
      src/
        compute/
        registry/
        normalize/
      test/
    scoring/
      src/
        policies/
        execute/
        explain/
      test/
    layout/
      src/
        treemap/
        rounding/
        validate/
      test/
    prediction/
      src/
        contracts/
          types/
          constants.ts
          index.ts
        engine/
          elo-rating.ts
          lambda-computer.ts
          scoreline-matrix.ts
          raw-aggregator.ts
          derived-raw.ts
          derived-calibrated.ts
          decision-policy.ts
          scoreline-explainer.ts
          bridging.ts
        store/
          rating-pool.ts
        calibration/
          isotonic-calibrator.ts
          calibration-selector.ts
          version-metadata.ts
        validation/
          match-validator.ts
          competition-profile-validator.ts
          history-validator.ts
        competition/
          standings.ts
          group-ranking.ts
          bracket-mapper.ts
          knockout-resolver.ts
        persistence/
        metrics/
        response-builder.ts
      test/
    snapshot/
      src/
        build/
        store/
        cache/
        projections/
      test/
    api/
      src/
        ui/
        middleware/
        serialization/
      test/
    web/
      src/
        app/
        components/
        state/
        theme/
        api-client/
      test/
  tools/
    fixtures/
      golden/
      prediction/
      generators/
    scripts/
    ci/
  infra/
    docker/
    deploy/
  package.json
  tsconfig.json
```

---

## 4. Module responsibilities

## 4.1 packages/shared

Purpose:
- canonical shared types and utilities used across backend and frontend (where safe)

Owns:
- domain primitives: IDs, enums, small value objects
- time utilities: ISO parsing helpers, timezone utilities (NOT provider-specific logic)
- error and warning types and codes
- versioning primitives
- generic serialization helpers (canonical JSON formatting rules)

Must not own:
- provider ingestion logic
- scoring policy logic
- layout algorithms
- snapshot build orchestration
- anything that requires IO

---

## 4.2 packages/canonical

Purpose:
- ingest provider data and normalize into canonical domain objects.

Owns:
- provider ingestion adapters (football-data.org adapter)
- canonical models (Team, Match, Competition, Season)
- lifecycle classification
- normalization rules and mapping
- canonical storage representation interfaces

Must not own:
- scoring policy logic
- layout logic
- snapshot DTOs for frontend
- UI behavior assumptions

---

## 4.3 packages/signals

Purpose:
- compute canonical signals from canonical domain objects and `buildNowUtc`.

Owns:
- signal registry (keys and metadata)
- signal computation functions
- normalization into `[0..1]`
- missingness classification for signals
- signal explain strings (stable wording)

Must not own:
- weights
- scoring policies
- treemap layout
- provider ingestion

---

## 4.4 packages/scoring

Purpose:
- apply scoring policies to signals to produce score outputs and contributions.

Owns:
- policy definitions (key/version)
- weight sets and transforms
- contribution extraction
- mapping: rawScore -> attentionScore -> displayScore -> layoutWeight (as defined by policy)
- policy immutability enforcement checks (by design)

Must not own:
- provider ingestion
- canonical normalization
- treemap algorithm implementation
- snapshot caching logic
- frontend rendering logic

---

## 4.5 packages/layout

Purpose:
- deterministic treemap geometry generation from ordered entities and `layoutWeight`.

Owns:
- treemap algorithm implementations (squarified v1)
- canonical rounding rules
- residual distribution rules
- gutter/padding semantics
- geometry validation

Must not own:
- scoring or signals
- provider ingestion
- snapshot API logic
- frontend behavior

---

## 4.9 packages/prediction

Purpose:
- compute match outcome predictions using the Elo extended + Poisson independent model defined in `SportPulse_Predictive_Engine_Spec_v1.3_Final.md`.

Owns:
- domain contracts (types, enums, constants) — no logic
- Elo rating store and update rules per rating pool
- lambda_home / lambda_away computation per match
- raw_match_distribution (8×8 scoreline matrix) and tail_mass_raw
- raw_1x2_probs and all derived raw outputs (BTTS, totals, etc.)
- Isotonic calibration (one-vs-rest) producing calibrated_1x2_probs
- derived calibrated outputs (double chance, DNB, predicted_result)
- ValidationResult production and operating_mode assignment
- Competition structure resolution (standings, groups, brackets, knockout)
- PredictionResponse assembly

Must not own:
- attention scoring policy (belongs to packages/scoring)
- treemap geometry (belongs to packages/layout)
- snapshot artifact assembly (belongs to packages/snapshot)
- provider ingestion adapters (belongs to packages/canonical)
- UI rendering logic

Position in dependency chain: `canonical → prediction → snapshot`

---

## 4.6 packages/snapshot

Purpose:
- orchestrate snapshot building and persistence.

Owns:
- snapshot build pipeline
- snapshot identity keying
- snapshot schema assembly (DashboardSnapshotDTO and projections)
- snapshot caching and fallback logic
- projections (team detail projections derived from snapshot)
- layout diagnostics derivation (optional)

Must not own:
- provider ingestion adapters
- low-level treemap solver implementation
- UI rendering or web framework concerns

---

## 4.7 packages/api

Purpose:
- expose internal UI API endpoints and contract-compliant responses.

Owns:
- request validation
- routing/middleware
- response shaping and serialization rules
- error envelopes

Must not own:
- scoring logic
- layout logic
- signal computation
- provider calls on request path

---

## 4.8 packages/web

Purpose:
- frontend UI for the dashboard and detail surfaces.

Owns:
- rendering snapshot DTOs
- interactions and navigation state
- presentation and animation
- theming

Must not own:
- score computation
- treemap solving
- provider calls
- semantic inference beyond returned snapshot data

---

## 5. Allowed dependency graph

The intended dependency direction is:

`shared`
→ `canonical`
→ `signals`
→ `scoring`
→ `layout`
→ `snapshot`
→ `api`
→ `web`

With `prediction` inserted between `canonical` and `snapshot`:

`canonical` → `prediction` → `snapshot`

Full constraints:

- `web` may depend on `shared` types and the API client only.
- `api` depends on `snapshot`, `prediction` (PredictionResponse types only), and `shared`.
- `snapshot` may depend on `canonical`, `signals`, `scoring`, `layout`, `prediction`, `shared`.
- `prediction` depends on `canonical` (models only) and `shared`. Must NOT depend on `signals`, `scoring`, or `layout`.
- `layout` depends only on `shared` (and its own internal utilities).
- `scoring` depends on `shared` and consumes `signals` outputs.
- `signals` depends on `canonical` models and `shared`.
- `canonical` depends on `shared`.

---

## 6. Forbidden dependencies (hard prohibitions)

The following dependency edges are forbidden:

- `web -> scoring`
- `web -> layout`
- `web -> signals`
- `web -> canonical`
- `api -> canonical` (direct ingestion/normalization should not happen in API layer)
- `api -> signals` (signals should not be computed on request path)
- `api -> scoring` (scoring should not be computed on request path)
- `api -> layout` (layout should not be computed on request path)
- `layout -> scoring`
- `layout -> signals`
- `scoring -> canonical ingestion adapters` (policy must not depend on provider)
- `signals -> provider ingestion adapters` (signals consume canonical model only)
- `prediction -> scoring` (attention scoring and match prediction are separate concerns)
- `prediction -> signals` (prediction uses canonical models directly, not signal registry)
- `prediction -> layout` (prediction has no geometry concerns)
- `web -> prediction` (frontend never imports prediction logic directly)
- `api -> prediction engine internals` (api may import PredictionResponse type only via shared or snapshot)

If any of these appear, architecture is drifting in a way that will break determinism and testability.

---

## 7. Boundary interfaces

## 7.1 canonical -> signals

Signals consume:
- canonical Team/Match entities
- canonical lifecycle truth
- `buildNowUtc`
- canonical timezone context if required

Signals must not consume:
- provider raw payloads

---

## 7.2 signals -> scoring

Scoring consumes:
- normalized signal values
- signal quality metadata (missingness, confidence)
- policy identity

Scoring must not reach back into canonical data to “peek” additional context not represented as signals unless explicitly versioned.

---

## 7.3 scoring -> layout

Layout consumes:
- ordered entities with `layoutWeight`
- container configuration
- layout algorithm identity

Layout must not consume:
- signal values
- policy weights
- provider data

---

## 7.4 layout -> snapshot DTO

Snapshot consumes:
- geometry output (`rect`)
- ordering
- layout metadata and diagnostics
- score outputs and explainability

Snapshot is the integration layer that assembles the product artifact.

---

## 8. Test placement and expectations

Each package must have tests in its own scope.

Minimum expectations:

- canonical: normalization mapping tests + lifecycle tests
- signals: signal correctness tests + missingness tests
- scoring: policy execution tests + contribution tests
- layout: geometry determinism tests + rounding tests + overlap/bounds tests
- snapshot: pipeline integration tests + fallback tests + ordering tests
- api: contract tests + validation/error tests
- web: basic rendering tests + state restoration tests (does not test scoring)

Golden fixtures should live in:
- `tools/fixtures/golden`

---

## 9. Configuration boundaries

Configuration must be injectable into:
- canonical ingestion (provider config)
- snapshot engine (timezone defaults, cache policy)
- scoring policy selection (policyKey/version)
- layout container defaults and algorithm versioning

Configuration must not be hardcoded inside UI code.

---

## 10. AI-assisted development guardrails

AI-assisted development must:

- create code in the correct package for the responsibility
- respect dependency prohibitions
- avoid moving logic “upstream” into API or web for convenience
- avoid introducing ad-hoc provider logic outside `canonical`
- avoid introducing new signal/policy keys without updating specs and versioning rules
- avoid introducing legacy constructs (`SIZE_SCORE`, `PROXIMITY_BONUS`, `HOT_MATCH_SCORE`)

If AI proposes architecture changes, it must express them as explicit changes to this document and related specs first.

---

## 11. Definition of done for module boundaries

The repo/module boundaries are considered correctly implemented when:

- the repo structure matches this layout (or an explicitly approved variant)
- packages compile independently where appropriate
- dependency edges match allowed graph
- forbidden edges are prevented by tooling (lint rules or TS path rules)
- tests exist at each layer for its responsibility
- no UI code computes scoring/layout truth

---

## 12. One-paragraph summary

SportPulse MVP must be implemented as a layered system where provider ingestion and canonicalization live in `canonical`, signal derivation in `signals`, policy execution in `scoring`, geometry generation in `layout`, artifact assembly in `snapshot`, contract exposure in `api`, and rendering in `web`, all grounded by shared primitives in `shared`. The boundaries prevent semantic leakage, enable determinism and testing, and stop AI-assisted workflows from collapsing responsibilities into a fragile monolith.
