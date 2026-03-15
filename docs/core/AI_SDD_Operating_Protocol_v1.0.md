# SportPulse — AI SDD Operating Protocol

Version: 1.0  
Status: Authoritative protocol for AI-assisted development under Spec-Driven Development (SDD)  
Scope: Rules, workflow, deliverables, gates, and constraints for AI-assisted development of SportPulse MVP  
Audience: Engineers, QA, Product, Ops, AI agents and orchestration systems

---

## 1. Purpose

This protocol defines **how AI is allowed to participate** in SportPulse development under a Spec-Driven Development (SDD) methodology.

It exists to enforce:

- documentary authority and conflict resolution
- scope discipline (no AI-driven scope creep)
- semantic invariants (no shortcut semantics)
- version discipline (no silent policy/layout/schema mutation)
- fixture-based truth protection (golden fixtures are law)
- deterministic, explainable, snapshot-first implementation behavior

Without this protocol, AI output will tend toward:
- “reasonable” but incorrect interpretations
- accidental legacy reintroduction
- architectural boundary violations
- silent semantic drift

This protocol is intentionally strict.

---

## 2. Operating stance

AI is not permitted to “invent” product truth.  
AI is permitted to:

- propose designs consistent with authoritative specs
- implement code consistent with those specs
- create tests that enforce those specs
- detect inconsistencies and propose spec corrections
- generate structured documentation when explicitly requested

AI is not permitted to:
- broaden scope beyond MVP execution scope without explicit approval
- reinterpret domain terms contrary to glossary/invariants
- move scoring/layout truth into the frontend
- bypass canonical normalization
- change policy/layout/schema semantics without versioning
- update golden fixtures as a convenience to make tests pass

---

## 3. Definitions (protocol-local)

### 3.1 “Authoritative”
A document is authoritative if it is listed as active canonical in the constitution and not marked archived.

### 3.2 “Material change”
A change is material if it alters:
- scoring outcomes
- ordering outcomes
- warning emission semantics
- geometry semantics
- snapshot schema shape
- lifecycle interpretation
- signal semantics

Material changes require version discipline.

### 3.3 “Golden truth”
Golden fixtures define expected truth under controlled inputs.  
If golden fixtures fail, the default assumption is: regression until proven otherwise.

---

## 4. Authoritative corpus and precedence

### 4.1 Highest-level governance
1. `SportPulse_Constitution_v2.0_Master.md`

### 4.2 Domain truth backbone
2. `Domain_Glossary_and_Invariants_v1.0.md`

### 4.3 Execution boundaries
3. `MVP_Execution_Scope_v1.0.md`

### 4.4 Non-functional baseline
4. `Non_Functional_Requirements_v1.0.md`

### 4.5 Architecture boundaries
5. `Repo_Structure_and_Module_Boundaries_v1.0.md`

### 4.6 Taxonomy
6. `Errors_and_Warnings_Taxonomy_v1.0.md`

### 4.7 Acceptance truth and fixtures
7. `Acceptance_Test_Matrix_v1.0.md`  
8. `Golden_Snapshot_Fixtures_v1.0.md`

### 4.8 Active core technical specs (corrected)
9. `signals-spec-corrected.md`  
10. `metrics-spec-corrected.md`  
11. `scoring-policy-spec-corrected.md`  
12. `snapshot-engine-spec-corrected.md`  
13. `dashboard-snapshot-dto-corrected-v1.2.md`  
14. `api-contract-corrected.md`  
15. `treemap-algorithm-spec-corrected.md`  
16. `layout-stability-spec-corrected.md`  
17. `frontend-architecture-corrected.md`  
18. `ui-spec-corrected.md`

### 4.9 Strategic inputs (non-binding for implementation details)
19. `SportPulse_MVP_Strategic_Brief_v1.0.md`  
20. `SportPulse_MVP_One_Pager_v1.0.md`

### 4.10 Archive (non-authoritative)
Any document in `docs/archive/` is non-authoritative and must not be used for implementation truth.

---

## 5. Conflict resolution rules

When the AI detects a conflict between documents, it must:

1. Identify the conflict explicitly (quote section names, not just opinions)
2. Determine which document has precedence using section 4
3. Propose one of:
   - a correction to the lower-precedence document
   - a versioned change request if the higher-precedence document is intended to change
4. Stop implementation that depends on ambiguous truth until the conflict is resolved

### Prohibition
AI must not “pick a reasonable interpretation” and continue silently when a conflict exists.

---

## 6. SDD workflow stages (mandatory)

AI-assisted development must follow these stages in order.

### Stage 0 — Intake and classification
AI must classify the task as:
- spec change
- implementation task
- test task
- refactor with no semantic change
- bug fix

### Stage 1 — Spec alignment check
Before writing code, AI must:
- identify which authoritative specs govern the task
- list the relevant invariants
- list affected versions (policy/layout/schema)

### Stage 2 — Proposed design and acceptance criteria
AI must produce:
- proposed approach
- module placement per repo boundaries
- expected outputs
- acceptance checks (link to matrix cases)
- fixture impact analysis

### Stage 3 — Implementation
Only after Stage 2 is complete may AI produce code.

### Stage 4 — Verification
AI must:
- run or specify the test suite required by acceptance matrix
- verify deterministic behavior where applicable
- ensure no forbidden dependencies introduced

### Stage 5 — Delivery package
AI must output:
- list of files changed
- summary of behavior
- tests added/updated
- version changes (if any)
- fixture impact and whether golden fixtures pass

---

## 7. Required output format per task

Every AI deliverable must include:

1. **Scope statement** (what is being changed, what is not)
2. **Authoritative spec references** (which docs control this)
3. **Assumptions** (only if unavoidable)
4. **Implementation plan** (brief)
5. **Files to be created/modified**
6. **Tests to be created/modified** (mapped to acceptance matrix IDs)
7. **Versioning impact analysis**
8. **Golden fixture impact analysis**
9. **Risk list** (top 3)
10. **Definition of done**

This is non-negotiable.

---

## 8. Versioning gates

AI must apply versioning discipline.

### 8.1 Policy changes
If scoring semantics change materially:
- bump `policyVersion`
- update scoring policy spec
- update golden fixtures as needed
- update acceptance expectations

### 8.2 Layout changes
If geometry behavior changes materially:
- bump `layoutAlgorithmVersion`
- update treemap spec or layout stability spec
- update golden fixtures for geometry
- update acceptance expectations

### 8.3 Schema changes
If DTO shape changes materially:
- bump `snapshotSchemaVersion`
- update snapshot DTO spec
- update API contract tests
- update golden snapshot outputs

### 8.4 Prohibition
AI must not change expected golden outputs without classifying which version bump (if any) is required and why.

---

## 9. Golden fixture discipline

Golden fixtures are treated as **truth locks**.

### 9.1 If a golden fixture fails
AI must:

1. Identify which fixture(s) failed
2. Identify which layer changed:
   - canonical normalization
   - signals
   - scoring policy
   - layout
   - snapshot assembly
   - API projection
3. Classify the change as:
   - bug
   - intentional change requiring version bump
   - fixture defect
4. Propose the correction path

### 9.2 Prohibition
AI must not “fix” golden failures by updating expected outputs unless:
- the change is intentional and versioned
- or the fixture is proven incorrect

---

## 10. Legacy resistance rules (hard)

AI must not reintroduce legacy constructs as active behavior.

Hard-prohibited active constructs:
- `SIZE_SCORE`
- `PROXIMITY_BONUS` (as weighted scoring primitive)
- `HOT_MATCH_SCORE` as MVP truth
- `scoreVersion` as identity
- client-side treemap solving
- UI-derived urgency bonuses
- hash-based hidden ordering

If these appear in new code, the change is rejected.

---

## 11. Boundary enforcement rules

AI must respect module boundaries as defined in:
- `Repo_Structure_and_Module_Boundaries_v1.0.md`

Minimum enforcement:
- scoring logic stays in `packages/scoring`
- layout logic stays in `packages/layout`
- snapshot assembly stays in `packages/snapshot`
- API layer does not compute signals/scoring/layout
- frontend does not compute semantic truth

If boundaries must be revised, AI must propose a doc change first.

---

## 12. Safety checks for determinism

For any change affecting scoring/layout/snapshot:

AI must ensure:
- stable ordering rules remain intact
- tie-breakers remain explicit
- rounding rules remain deterministic
- buildNowUtc is always the semantic time anchor

AI must add tests if determinism could be threatened.

---

## 13. Handling ambiguity

If necessary input is missing, AI must:

1. explicitly state what is missing
2. propose the minimal safe assumption
3. state the risk of that assumption
4. proceed only if the assumption does not alter core semantic truth
5. otherwise stop and request resolution

### Prohibition
AI must not fill unknowns with confident-sounding invention.

---

## 14. Change request format (when AI proposes spec changes)

When proposing a spec change, AI must provide:

- change description
- rationale
- affected documents
- version impacts
- acceptance matrix impacts
- golden fixture impacts
- migration notes (if required)

No “drive-by” spec edits.

---

## 15. PR / delivery checklist (mandatory)

Any AI-generated delivery must satisfy:

- [ ] scope matches MVP execution scope
- [ ] terms align with domain glossary/invariants
- [ ] non-functional baseline respected
- [ ] module boundaries respected
- [ ] warnings/errors taxonomy respected
- [ ] acceptance tests mapped and passing
- [ ] golden fixtures passing or intentionally updated with version discipline
- [ ] version bumps applied where required
- [ ] no legacy constructs reintroduced
- [ ] documentation updated if behavior changed

---

## 16. Minimal operating loop (how to use this protocol)

For each feature/ticket:

1. Identify authoritative documents and invariants
2. Map to acceptance matrix IDs
3. Check golden fixture impact
4. Implement in correct module
5. Add/adjust tests
6. Verify determinism and contracts
7. Deliver with version discipline

This loop is the SDD operating cadence for SportPulse.

---

## 17. One-paragraph summary

This protocol constrains AI-assisted development of SportPulse to a strict SDD workflow governed by authoritative documents, explicit conflict resolution, non-functional requirements, module boundaries, stable warning/error taxonomy, acceptance test mapping, and golden fixture truth locks. AI may implement and test within these constraints but must not broaden scope, invent semantics, bypass canonicalization, move scoring/layout to the frontend, silently change policy/layout/schema behavior, or update golden outputs without explicit versioning and justification.
