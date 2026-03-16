# SP-RADAR-V2 -- Radar v2 Standalone Implementation

## Scope Statement
Implement Radar v2 as a standalone module in `server/radar-v2/` with new ontology (3 families, 6 labels), v2 JSON contracts, lifecycle management, editorial rendering, and validation. No predictor integration. No v1 history overwrite. Coexists with v1.

## Authoritative Spec References
1. spec.sportpulse.radar-v2-package-index.md -- package scope
2. spec.sportpulse.radar-v2-core.md -- ontology, families, labels, resolution logic
3. spec.sportpulse.radar-v2-json-contracts-and-lifecycle.md -- JSON shapes, lifecycle, validation
4. spec.sportpulse.radar-v2-editorial-rendering-policy.md -- rendering chain, tone, sanitization
5. spec.sportpulse.radar-v2-ui-ux-spec.md -- card anatomy, placement, states
6. spec.sportpulse.radar-v2-qa-acceptance-and-edge-cases.md -- acceptance criteria, edge cases
7. spec.sportpulse.radar-v2-implementation-guide.md -- module split, delivery sequence
8. spec.sportpulse.radar-v2-migration-and-rollout-plan.md -- rollout phases, migration rules

## V1 Reusability
- REUSE: evidence-tier, candidate-builder, diversity-filter, verdict logic, signal computations, text renderer (wrapped)
- REPLACE: types/contracts, service orchestrator, snapshot reader, API adapter
- NEW: family-resolver, card-resolver, validator

## Family Scoring
- CONTEXT = max(attentionScore, hiddenValueScore)
- DYNAMICS = max(openGameScore, tightGameScore)
- MISALIGNMENT = max(favoriteVulnerabilityScore, surfaceContradictionScore)
- Family precedence for ties: MISALIGNMENT > DYNAMICS > CONTEXT

## Implementation Order
1. Types 2. Validator 3. Writer 4. Reader 5. Scope loader 6. Candidate evaluator
7. Family resolver 8. Card resolver 9. Text renderer 10. Verdict resolver
11. Service 12. API adapter 13. Route+wiring 14. Tests

## Top 3 Risks
1. Signal threshold calibration shift under family-first resolution
2. Text renderer coupling to v1 copy library
3. Disk space doubling during v1/v2 coexistence

## Feature Flag
`RADAR_V2_ENABLED=true` in .env to activate v2 endpoint

## Endpoint
`GET /api/ui/radar/v2?competitionId=X&matchday=N`
