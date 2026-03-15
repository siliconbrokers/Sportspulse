---
artifact_id: SPEC-SPORTPULSE-CORE-DOMAIN-GLOSSARY-AND-INVARIANTS
title: "Domain Glossary and Invariants"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: core
slug: domain-glossary-and-invariants
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/core/spec.sportpulse.core.domain-glossary-and-invariants.md
---
# SportPulse — Domain Glossary and Invariants

Version: 1.0  
Status: Authoritative domain reference  
Scope: Canonical vocabulary, semantic rules, and non-negotiable invariants for SportPulse MVP  
Audience: Product, Backend, Frontend, QA, Ops, AI-assisted development workflows

---

## 1. Purpose

This document defines the **canonical language** of the SportPulse system and the **invariants** that every implementation, specification, test suite, and AI-assisted development flow must respect.

Its purpose is to eliminate ambiguity around:

- what core entities mean
- what lifecycle states mean
- what counts as valid vs missing vs stale vs partial
- where semantic responsibility lives
- what must never change silently
- what assumptions all downstream documents and implementations may safely rely on

This document is not a low-level DTO catalog and not a strategic brief.  
It is the **semantic backbone** of the product.

---

## 2. Authority and scope

This document is authoritative for:

- domain terminology
- semantic distinctions
- cross-layer invariants
- interpretation rules used by:
  - snapshot building
  - scoring
  - layout
  - API payloads
  - UI rendering
  - QA validation
  - AI generation workflows

If any lower-level document uses a term in a contradictory way, this document wins unless the constitution explicitly supersedes it.

---

## 3. Domain boundary

SportPulse is a **snapshot-first football attention dashboard**.

The system operates on normalized football competition data and produces explainable dashboard artifacts.

This domain does **not** include, in MVP v1:

- betting semantics as core truth
- prediction semantics as core truth
- bookmaker data as canonical truth
- user-generated content as canonical truth
- provider-native schemas as frontend truth

---

## 4. Core domain objects

## 4.1 Competition

A **Competition** is the canonical representation of a football competition context within which teams, matches, and snapshots are interpreted.

Examples:
- a domestic league
- a cup competition
- another football competition type, if enabled in future versions

### Competition invariants
- `competitionId` is canonical and stable within the product.
- A competition is not identified by provider-native display names alone.
- A snapshot belongs to exactly one competition.
- The same `teamId` may exist across different competitions only if canonical identity rules allow it explicitly.

---

## 4.2 Season

A **Season** is the canonical competition period used to interpret match membership, standings context, and snapshot scope.

### Season invariants
- `seasonId` is canonical and stable.
- A snapshot belongs to exactly one season.
- A match belongs to one competition-season context.
- Season boundaries must not be inferred ad hoc in the frontend.

---

## 4.3 Team

A **Team** is a canonical participant entity used as the primary MVP dashboard tile entity.

A team is not merely a provider string label. It is a normalized domain entity with stable identity.

### Team invariants
- `teamId` is canonical and stable.
- `teamName` is a display property, not the identity.
- A team may appear in many snapshots across time.
- A team may have zero active signals in a snapshot and still be a valid domain entity.
- A team tile in MVP v1 represents a TEAM entity only; MATCH is not a treemap-sized entity in MVP v1.

---

## 4.4 Match

A **Match** is a canonical football event between participants with a defined lifecycle.

In MVP v1, a match is a domain entity and a detail/agenda context source, but not the primary treemap sizing entity.

### Match invariants
- `matchId` is canonical and stable.
- A match belongs to one competition and one season.
- A match has lifecycle state semantics (scheduled, live, finished, etc.) defined canonically.
- A match may be missing some provider fields and still exist canonically, provided quality state is explicit.
- A match is not treated as “upcoming” or “finished” based on UI heuristics.

---

## 4.5 Snapshot

A **Snapshot** is the primary product artifact: a materialized, deterministic view of a competition at a specific logical time.

A snapshot includes:
- metadata
- warnings
- ordered entities
- scores
- layout information
- optional explainability fields

### Snapshot invariants
- A snapshot is computed relative to an explicit `buildNowUtc`.
- A snapshot has explicit scoring identity:
  - `policyKey`
  - `policyVersion`
- A snapshot has explicit layout identity:
  - `layout.algorithmKey`
  - `layout.algorithmVersion`
- A snapshot is interpreted as a coherent whole.
- The frontend must not assemble a “synthetic snapshot” by combining unrelated API fragments.

---

## 4.6 Signal

A **Signal** is a normalized, deterministic measure used as input to scoring or explainability.

A signal is not raw provider data.  
A signal is derived or normalized into a stable product meaning.

Examples in MVP:
- recent form signal
- next match proximity signal

### Signal invariants
- A signal belongs to a specific entity.
- A signal has a key with stable semantic meaning.
- A signal value used in scoring must be normalized according to active spec.
- If a signal is missing, that fact must be explicit.
- The frontend must not derive signals from raw fields.

---

## 4.7 Metric

A **Metric** is a domain-level measured or derived quantity that may support scoring, explainability, or diagnostics.

In practice, SportPulse uses the term carefully:
- signals are normalized scoring/explainability inputs
- metrics may include raw or support values used to produce signals or diagnostics

### Metric invariants
- Metrics must not be treated as scoring truth unless active specs say so.
- Legacy constructs such as `SIZE_SCORE` are not active canonical metrics in MVP v1.
- A metric may exist for diagnostics without being a weighted scoring input.

---

## 4.8 Policy

A **Policy** is a versioned scoring contract that defines how signals become scoring outputs.

### Policy invariants
- Policy identity is always:
  - `policyKey`
  - `policyVersion`
- Policy versions are immutable once active.
- Any material scoring change requires a new `policyVersion`.
- `scoreVersion` as a generic identity term is not canonical.

---

## 4.9 Layout

**Layout** is the deterministic geometry and ordering model used to render the dashboard treemap.

### Layout invariants
- Layout is backend-owned in MVP v1.
- Layout is versioned independently from scoring.
- Tile geometry is part of the product artifact.
- Frontend must not solve treemap layout in MVP v1.
- `rect` is required for rendered treemap tiles in MVP v1.

---

## 4.10 Warning

A **Warning** is a structured product-level indication that something about the snapshot or its inputs requires visibility.

Warnings are not logs.  
Warnings are part of the domain contract.

### Warning invariants
- Warnings have stable codes.
- Warnings have explicit severity.
- Warnings do not silently mutate score semantics.
- Warnings may inform UI behavior and operator understanding.
- Missing data must surface through warnings and/or explicit missing flags, not disappear silently.

---

## 4.11 Quality

**Quality** expresses the trust condition of data or derived fields.

Quality may concern:
- freshness
- completeness
- consistency
- confidence
- missingness

### Quality invariants
- Quality is explicit, not implied.
- Missingness must be represented, not guessed around.
- A value marked missing must not masquerade as a true measured value.
- “Quality” does not permit silent semantic substitution.

---

## 4.12 Explainability

**Explainability** is the system’s ability to show why an entity received a given score or prominence.

### Explainability invariants
- Explainability must come from backend-produced signal/contribution data.
- Frontend may present explainability; it must not invent it.
- If an explanation cannot be grounded in returned data, it is not valid product truth.

---

## 5. Time semantics

## 5.1 buildNowUtc

`buildNowUtc` is the explicit logical time used to compute time-relative semantics.

This is one of the most important domain concepts in the system.

### buildNowUtc invariants
- Every snapshot has one and only one `buildNowUtc`.
- All time-relative signal semantics are evaluated against `buildNowUtc`.
- `buildNowUtc` is semantic truth.
- `computedAtUtc` is execution metadata only.
- A frontend must not reinterpret time-relative semantics using browser local time in place of `buildNowUtc`.

---

## 5.2 computedAtUtc

`computedAtUtc` is the actual execution timestamp of snapshot generation or related processing.

### computedAtUtc invariants
- It is metadata.
- It is not the semantic basis for time-relative scoring.
- Two snapshots may have the same `buildNowUtc` and different `computedAtUtc` while remaining semantically identical.

---

## 5.3 dateLocal

`dateLocal` is the local calendar date context used for snapshot requests and deterministic build-time derivation.

### dateLocal invariants
- `dateLocal` is not interchangeable with `buildNowUtc`.
- Its meaning depends on a corresponding timezone context.
- It is an input to build-time derivation rules, not itself a scoring timestamp.

---

## 5.4 Timezone

A **Timezone** is the canonical IANA timezone context used to interpret local date semantics.

### Timezone invariants
- Timezone must be explicit when local-date semantics matter.
- Frontend locale display concerns do not override backend semantic timezone rules.
- Timezone handling must occur in canonical normalization and snapshot rules, not ad hoc in UI logic.

---

## 6. Lifecycle semantics

## 6.1 Scheduled

A match is **Scheduled** when it is expected to occur in the future and is recognized as part of the valid canonical event set.

### Scheduled invariants
- A scheduled match is eligible for upcoming-match semantics.
- A scheduled match with missing kickoff time quality must be flagged explicitly.
- A scheduled match is not “live” or “finished”.

---

## 6.2 Live

A match is **Live** when it is currently in progress according to canonical lifecycle truth.

### Live invariants
- A live match is not treated as future upcoming in the same sense as a scheduled pre-kickoff match.
- If active specs define live-match treatment for proximity-related signals, that treatment must be backend-defined and versioned.
- The frontend must not infer “live” solely by comparing clock time to kickoff.

---

## 6.3 Finished

A match is **Finished** when it is canonically complete and eligible for result-dependent derivations such as form.

### Finished invariants
- Only finished matches count toward finished-match-derived signals such as recent form.
- A match with partial score data but no canonical finished truth must not be assumed finished.
- Finishedness is a lifecycle truth, not a UI convenience state.

---

## 6.4 Postponed / Cancelled / Invalid

A match may be canonically classified into non-standard states such as postponed or cancelled.

### Invariants
- Such states must be explicit.
- They must not be silently treated as scheduled or finished.
- Their effect on agenda, warnings, and signal missingness must be determined by canonical lifecycle rules.

---

## 7. Data state semantics

## 7.1 Missing

**Missing** means the value could not be computed or obtained as a valid semantic value for the relevant contract.

### Missing invariants
- Missing is not the same as zero.
- A missing field may use a fallback placeholder representation in payload shape, but missingness must remain explicit.
- If a signal is missing, downstream consumers must be able to detect that fact.
- A frontend must not convert missing into a fake semantic truth.

---

## 7.2 Zero

**Zero** is a real semantic value when the domain meaning genuinely equals zero.

### Zero invariants
- Zero must not be used as a disguised replacement for missing unless missingness is simultaneously explicit.
- Zero-valued signals or weights must be distinguishable from unknowns in the model.

---

## 7.3 Partial

**Partial** means the snapshot or its source data is incomplete but still usable.

### Partial invariants
- Partiality must be surfaced through warnings or quality indicators.
- Partial does not authorize silent fabrication.
- Partial snapshots remain valid only if they preserve contract integrity.

---

## 7.4 Stale

**Stale** means the snapshot or its underlying data is older than the freshness expectation for its intended use.

### Stale invariants
- Staleness must be explicit.
- A stale snapshot may still be served if policy allows, but must carry warning state.
- Stale is not the same as invalid.

---

## 7.5 Invalid

**Invalid** means the artifact or field cannot be treated as trustworthy product truth within the active contract.

### Invalid invariants
- Invalid data must not be rendered as if valid.
- Invalid snapshot build conditions must fail or degrade according to active rules.
- Invalidity must not be hidden behind UX smoothing.

---

## 8. Ownership semantics

## 8.1 Backend-owned truths

The following are backend-owned semantic truths in MVP v1:
- canonical normalization
- lifecycle classification
- signal derivation
- score computation
- display score mapping
- layout weight
- geometry generation
- warning generation
- snapshot identity

### Invariant
The frontend must not redefine any of the above.

---

## 8.2 Frontend-owned responsibilities

The frontend owns:
- presentation
- interaction
- route/share state
- animation
- visual rendering of returned geometry
- display of warnings and explainability

### Invariant
Frontend presentation must not mutate semantic truth.

---

## 9. Ordering semantics

## 9.1 Canonical ordering

Canonical snapshot ordering is the ordered sequence produced by backend according to active scoring/layout specs.

### Ordering invariants
- Frontend must preserve snapshot order unless a separate explicitly documented presentation rule says otherwise.
- Hidden ordering tie-breakers are forbidden.
- Hash-based ordering as silent product truth is forbidden in MVP v1.

---

## 9.2 Tie-breaker

Where ordering ties occur, the tie-breaker must be explicit and documented.

### Invariant
No ambiguous or implementation-accidental tie resolution is acceptable for canonical outputs.

---

## 10. Scoring semantics

## 10.1 AttentionScore

`attentionScore` is the backend-produced score representing entity attention according to the active scoring policy.

### Invariants
- `attentionScore` is policy-dependent.
- It must be explainable through contributions.
- Frontend must not derive it independently.

---

## 10.2 displayScore

`displayScore` is the UI-oriented score mapping produced by backend from attention semantics.

### Invariants
- `displayScore` is not a UI-owned transform.
- It may equal `attentionScore` in MVP v1, but that is a policy choice, not a frontend assumption.
- Changing its mapping materially requires explicit policy versioning.

---

## 10.3 layoutWeight

`layoutWeight` is the backend-produced quantity used to generate treemap geometry.

### Invariants
- `layoutWeight` is not a frontend formula result.
- `layoutWeight` may equal `displayScore` in MVP v1, but this is not a universal law.
- Geometry generation depends on `layoutWeight` plus layout algorithm rules.

---

## 11. Geometry semantics

## 11.1 rect

`rect` is the canonical geometry for a treemap tile.

It contains:
- x
- y
- width
- height

### rect invariants
- `rect` is backend-produced in MVP v1.
- `rect` is required for rendered dashboard treemap tiles in MVP v1.
- Frontend must render `rect`, not recompute it.
- Geometry without `rect` contradicts the active MVP contract.

---

## 11.2 Container

A **Container** defines the geometry frame against which `rect` values are interpreted.

### Invariants
- Rectangles are interpreted relative to declared container metadata.
- Geometry semantics depend on container dimensions plus layout algorithm configuration.
- Frontend must not reinterpret geometry against a different semantic container without an explicit responsive rule.

---

## 12. Identity semantics

## 12.1 Canonical ID

A **Canonical ID** is the stable internal product identifier for a domain entity or artifact.

### Invariants
- Canonical IDs are the primary product-level identifiers.
- Provider-native IDs may exist internally but do not define frontend contract identity.
- Human-readable labels are not identities.

---

## 12.2 Snapshot identity tuple

A snapshot is semantically anchored by:
- `competitionId`
- `seasonId`
- `buildNowUtc`
- `policyKey`
- `policyVersion`

### Invariants
- This identity must be explicit.
- A convenience `snapshotKey` may exist, but must be derivable from canonical identity semantics.
- Snapshot identity must not be reduced to ambiguous values such as just competition plus lastUpdated.

---

## 12.3 Schema version vs policy version vs layout version

These are different concepts and must never be conflated.

### Definitions
- `snapshotSchemaVersion`: payload shape version
- `policyVersion`: scoring behavior version
- `layoutAlgorithmVersion`: geometry behavior version

### Invariants
- They evolve independently.
- A schema change is not automatically a scoring change.
- A layout change is not automatically a schema change.
- Silent cross-version interpretation is forbidden.

---

## 13. AI-assisted development semantics

## 13.1 AI must treat these terms as fixed

Any AI system used to assist development must treat the definitions in this document as binding vocabulary.

### Invariants
- AI must not invent new meanings for established terms.
- AI must not revive deprecated semantic constructs unless explicitly instructed through a versioned design change.
- AI outputs must state assumptions when a value or term is not fully determined by active docs.

---

## 13.2 Deprecated legacy constructs

The following legacy constructs are not active semantic truth for the current MVP line:
- `SIZE_SCORE`
- `PROXIMITY_BONUS` as active weighted scoring primitive
- `HOT_MATCH_SCORE` as MVP base contract
- `scoreVersion` as scoring identity
- frontend-owned treemap solving
- frontend-owned urgency formulas
- hidden hash ordering

### Invariant
These terms may appear only in archived context or explicit “rejected legacy” sections, never as active implementation truth.

---

## 14. Cross-layer invariants

The following invariants apply across the full system:

### 14.1 Determinism invariant
Given the same canonical inputs, versions, and `buildNowUtc`, the semantic output must be reproducible.

### 14.2 Explainability invariant
Every scored prominence must be explainable through returned data.

### 14.3 No silent fabrication invariant
Missing or degraded truth must not be silently replaced with invented semantic values.

### 14.4 Separation-of-concerns invariant
Normalization, scoring, layout, API, and rendering must remain layer-distinct.

### 14.5 Backend-truth invariant
Frontend must not redefine product truth.

### 14.6 Provider-isolation invariant
Provider schema and semantics must not leak into frontend contract truth.

### 14.7 Version-explicit invariant
Material behavioral changes require explicit versioning.

### 14.8 Warning-visibility invariant
Degraded truth must be visible to the system and, when relevant, to the user.

---

## 15. Negative examples (explicit anti-definitions)

The following statements are false in the active system and must be treated as invalid:

- “Missing is basically the same as zero.”
- “Frontend can recompute tile size if backend forgot it.”
- “computedAtUtc is close enough to buildNowUtc.”
- “Provider ID is good enough as canonical identity.”
- “If a score looks weird, the UI can smooth it.”
- “If geometry is missing, the browser can improvise.”
- “Hash ordering is fine as long as it’s stable.”
- “A stale snapshot is the same as a broken snapshot.”
- “A label is enough to identify a team.”
- “If the payload shape changed, we probably also changed scoring.”
- “If the match kickoff time passed, the frontend can decide whether it is live or finished.”

All of the above are domain errors.

---

## 16. Acceptance use of this document

This document is successful if:
- engineers use the same terms the same way
- frontend and backend stop leaking unresolved semantics to each other
- QA can derive concrete checks from the invariants
- AI-assisted development stops inventing semantic shortcuts
- lower-level specs become easier to write and validate because key terms no longer drift

---

## 17. One-paragraph summary

SportPulse operates on canonical football entities and produces deterministic, explainable snapshots anchored by explicit identity, time, policy, and layout semantics. Teams and matches are stable domain objects; snapshots are coherent product artifacts; signals and scores are backend-owned truths; warnings and quality states are explicit; geometry is versioned and server-produced; missing is not zero; computed time is not logical time; and no frontend or AI workflow is allowed to improvise semantic truth outside these invariants.
