---
artifact_id: SPEC-SPORTPULSE-SHARED-ERRORS-AND-WARNINGS-TAXONOMY
title: "Errors and Warnings Taxonomy"
artifact_class: spec
status: active
version: 1.0.0
project: sportpulse
domain: shared
slug: errors-and-warnings-taxonomy
owner: team
created_at: 2026-03-15
updated_at: 2026-03-15
supersedes: []
superseded_by: []
related_artifacts: []
canonical_path: docs/core/spec.sportpulse.shared.errors-and-warnings-taxonomy.md
---
# SportPulse — Errors and Warnings Taxonomy

Version: 1.0  
Status: Authoritative taxonomy for MVP  
Scope: Stable error and warning codes, semantics, severity rules, emission conditions, and handling expectations across backend, API, snapshot, QA, and frontend  
Audience: Backend, Frontend, QA, Ops, Product, AI-assisted development workflows

---

## 1. Purpose

This document defines the **canonical taxonomy** of errors and warnings for SportPulse MVP.

Its purpose is to prevent drift and ambiguity in how the system communicates:

- degraded data
- failed operations
- semantic uncertainty
- fallback behavior
- validation problems
- operational failures

Without a stable taxonomy, the product becomes inconsistent across:
- snapshot generation
- API responses
- logs
- UI warning surfaces
- QA verification
- AI-generated implementations

---

## 2. Authority

This document is authoritative for:

- warning codes
- error codes
- severity semantics
- emission conditions
- payload expectations
- handling intent

If any implementation invents new codes or redefines the meaning of existing ones without updating this document, it is non-compliant.

---

## 3. Taxonomy principles

The taxonomy follows these principles:

1. **stable codes**
2. **clear semantic boundaries**
3. **machine-readability**
4. **human interpretablity**
5. **no silent degradation**
6. **warnings are not logs**
7. **errors are not UI guesses**
8. **code meaning does not depend on implementation mood**

---

## 4. Distinction between errors and warnings

## 4.1 Error

An **Error** indicates that a request, process, or operation could not be completed as required.

Errors generally affect:
- request success/failure
- snapshot build success/failure
- endpoint response class (non-2xx)
- operational diagnosis

### Error invariant
Errors represent failure of an operation, not merely degraded truth.

---

## 4.2 Warning

A **Warning** indicates that a valid artifact can still be produced or served, but some condition requires visibility.

Warnings generally affect:
- snapshot metadata
- UI indicators
- operator awareness
- QA interpretation

### Warning invariant
Warnings may accompany valid responses and valid snapshots.

---

## 5. Severity model

Warnings and operational conditions use the following severity levels:

- `INFO`
- `WARN`
- `ERROR`

### Severity meaning

#### INFO
Visible condition that may matter for interpretation but does not imply major degradation.

#### WARN
Material degradation or non-ideal condition that should be visible.

#### ERROR
Severe condition indicating major degradation or fallback cause, even if a valid artifact is still being served.

### Severity invariants
- Severity is explicit.
- Severity does not replace code semantics.
- Same code should not change meaning wildly between severities without explicit documentation.

---

## 6. Canonical warning payload

Warnings included in snapshot or projection payloads must follow this shape:

```ts
type WarningDTO = {
  code: string;
  severity: "INFO" | "WARN" | "ERROR";
  message?: string | null;
  entityId?: string; // optional related entity reference
};
```

### Warning payload invariants
- `code` is required.
- `severity` is required.
- `message` is optional human-readable context.
- `entityId` is optional and only used when the warning concerns a specific entity.
- Clients must key behavior on `code`, not free-text message.

---

## 7. Canonical error envelope

API-level errors must use the standard error envelope:

```ts
type ErrorEnvelope = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};
```

### Error payload invariants
- `code` is required and stable.
- `message` is human-readable.
- `details` is optional and must not be used as the only carrier of semantic meaning.
- Frontend behavior must not depend on free-form parsing of `message`.

---

## 8. Warning taxonomy (active MVP set)

## 8.1 STALE_DATA

### Meaning
The snapshot or its source data is older than freshness expectations, but a usable artifact is still being served.

### Severity
Default: `WARN`

### Emission conditions
Emit when:
- the served snapshot is not fresh enough according to configured freshness policy
- or a fallback snapshot is served in place of a fresh rebuild

### Notes
- `STALE_DATA` does not mean invalid.
- It means “usable, but old enough that the user/operator should know.”

---

## 8.2 PARTIAL_DATA

### Meaning
The snapshot was built or served successfully, but some required or expected source inputs were missing or incomplete.

### Severity
Default: `WARN`

### Emission conditions
Emit when:
- some entities or derivations are incomplete
- some provider fields were unavailable
- some non-fatal canonical normalization gaps remain
- snapshot truth is materially incomplete but still renderable

### Notes
- `PARTIAL_DATA` is broader than a single missing signal.
- It applies to the snapshot-level integrity state.

---

## 8.3 MISSING_SIGNAL

### Meaning
A required or expected signal for an entity could not be computed.

### Severity
Default: `INFO` or `WARN` depending on impact

### Emission conditions
Emit when:
- a team or match is present, but a signal required by active explainability/scoring expectations is missing
- signal quality is explicitly missing and materially relevant

### Notes
- This warning may be snapshot-level or entity-scoped.
- Prefer `entityId` when relevant.

---

## 8.4 PROVIDER_ERROR

### Meaning
A provider-related failure affected ingestion or snapshot freshness/build availability.

### Severity
Default: `ERROR` when fallback was required, otherwise `WARN`

### Emission conditions
Emit when:
- provider fetch failed
- provider returned unusable or malformed data that materially affected the build
- stale fallback is served because provider path failed

### Notes
- `PROVIDER_ERROR` does not automatically mean the user gets a failed request.
- A valid snapshot may still be returned with this warning.

---

## 8.5 LAYOUT_DEGRADED

### Meaning
Layout generation required a deterministic fallback or degraded mode.

### Severity
Default: `WARN`

### Emission conditions
Emit when:
- all-zero `layoutWeight` fallback is applied
- geometry had to be generated under degraded-but-valid fallback behavior
- some expected layout assumption could not be applied, but valid geometry still exists

### Notes
- This warning is about geometry quality/state, not score correctness.
- It must not be used to hide invalid geometry.

---

## 8.6 LAYOUT_SHIFT

### Meaning
The current snapshot exhibits a materially large layout change versus the previous comparable snapshot.

### Severity
Default: `INFO` or `WARN` by configured policy

### Emission conditions
Emit when:
- layout diagnostics indicate movement above configured threshold

### Notes
- `LAYOUT_SHIFT` is informational/diagnostic.
- It does not imply bug or invalidity by itself.

---

## 8.7 NO_UPCOMING_MATCH

### Meaning
An entity has no qualifying upcoming match available for agenda/proximity semantics.

### Severity
Default: `INFO`

### Emission conditions
Emit when:
- a team exists in snapshot context but has no next valid scheduled match in range/available data

### Notes
- This may coexist with signal missingness.
- It should not be treated as a provider outage by default.

---

## 8.8 INSUFFICIENT_HISTORY

### Meaning
A form/history-based derivation had fewer valid finished matches than the ideal target window.

### Severity
Default: `INFO`

### Emission conditions
Emit when:
- history window target is 5 and fewer than 5 finished matches were available
- but at least one match exists and derivation proceeds in reduced form

### Notes
- This is not necessarily a failure.
- It is a transparency aid.

---

## 9. Error taxonomy (active MVP set)

## 9.1 BAD_REQUEST

### Meaning
Request parameters are invalid, malformed, or semantically unacceptable.

### HTTP
`400`

### Examples
- invalid `dateLocal`
- invalid timezone format
- invalid enum values
- structurally invalid request body

---

## 9.2 UNAUTHORIZED

### Meaning
The caller is not authenticated for a protected endpoint.

### HTTP
`401`

---

## 9.3 FORBIDDEN

### Meaning
The caller is authenticated but not permitted to perform the requested action.

### HTTP
`403`

---

## 9.4 NOT_FOUND

### Meaning
The requested canonical resource does not exist or is not enabled in the requested context.

### HTTP
`404`

### Examples
- unknown `competitionId`
- team not found in competition context

---

## 9.5 CONFLICT

### Meaning
The request conflicts with current state or operation constraints.

### HTTP
`409`

### Examples
- unsupported duplicate mutation
- impossible operation under current state

---

## 9.6 RATE_LIMITED

### Meaning
The caller exceeded allowed request rate or quota.

### HTTP
`429`

---

## 9.7 INTERNAL_ERROR

### Meaning
Unexpected internal server error with no more specific stable classification available.

### HTTP
`500`

### Notes
Use sparingly. Prefer more specific errors when possible.

---

## 9.8 SERVICE_UNAVAILABLE

### Meaning
A service dependency or internal subsystem is temporarily unavailable.

### HTTP
`503`

### Notes
May be used when the system cannot serve the operation even with fallback.

---

## 9.9 SNAPSHOT_BUILD_FAILED

### Meaning
A requested snapshot could not be built and no valid fallback snapshot could be served.

### HTTP
`503`

### Emission conditions
Use when:
- snapshot build failed materially
- fallback artifact unavailable or unusable
- request cannot be satisfied with a valid product artifact

### Notes
This is one of the most important MVP-specific error codes.

---

## 10. Distinction rules (critical)

## 10.1 STALE_DATA vs PROVIDER_ERROR

- `STALE_DATA` means a stale but usable artifact is being served.
- `PROVIDER_ERROR` means provider failure materially affected freshness or build.

They may coexist.

### Example
If provider fetch fails and the system serves yesterday’s snapshot:
- `STALE_DATA`
- `PROVIDER_ERROR`

Both should be present.

---

## 10.2 PARTIAL_DATA vs MISSING_SIGNAL

- `PARTIAL_DATA` is snapshot-level incompleteness.
- `MISSING_SIGNAL` is specific signal-level absence.

They may coexist.

---

## 10.3 LAYOUT_DEGRADED vs SNAPSHOT_BUILD_FAILED

- `LAYOUT_DEGRADED` means geometry is still valid under fallback.
- `SNAPSHOT_BUILD_FAILED` means the artifact could not be validly served.

They must not be confused.

---

## 10.4 INFO vs WARN for MISSING_SIGNAL

The severity may vary by impact, but the meaning of the code remains the same:
- signal absence

Severity should reflect impact on product interpretation, not arbitrary developer preference.

---

## 11. Emission rules by layer

## 11.1 Canonical/ingestion layer

May contribute root causes for:
- `PROVIDER_ERROR`
- `PARTIAL_DATA`

Must not emit frontend-facing payloads directly.

---

## 11.2 Signals layer

May contribute:
- `MISSING_SIGNAL`
- `NO_UPCOMING_MATCH`
- `INSUFFICIENT_HISTORY`

---

## 11.3 Scoring layer

May contribute:
- entity/scoring-related missingness propagation
- but should not invent provider-level warnings

---

## 11.4 Layout layer

May contribute:
- `LAYOUT_DEGRADED`
- `LAYOUT_SHIFT` diagnostics (if computed here or passed through snapshot layer)

---

## 11.5 Snapshot layer

Responsible for assembling snapshot-level warnings and deciding which warnings surface in the final artifact.

This is the canonical warning aggregation layer.

---

## 11.6 API layer

Responsible for:
- emitting error envelopes
- preserving snapshot warnings in payload responses
- not inventing semantic warning meanings beyond active taxonomy

---

## 11.7 Frontend layer

Responsible for:
- rendering warnings
- mapping warnings to UI indicators
- not inventing new warning codes
- not upgrading/downgrading semantic meaning ad hoc

---

## 12. Logging vs payload taxonomy

Not every log event becomes a user-facing warning.  
Not every warning must be treated as a fatal error.

### Invariants
- Logs are operational traces.
- Warnings are product contract signals.
- Errors are operation failure signals.

The same underlying cause may appear in all three channels, but with different purposes.

---

## 13. AI-assisted development rules

AI-assisted implementations must:

- use only active codes from this taxonomy unless explicitly extending it
- not invent near-duplicate variants like:
  - `STALE_SNAPSHOT`
  - `SNAPSHOT_STALE_WARNING`
  - `NO_MATCH_FOUND_WARNING`
- not substitute free-text for code
- not collapse distinct conditions into a vague generic warning

If a new condition is real and stable, it must be proposed as a documented taxonomy addition.

---

## 14. Acceptance criteria

This taxonomy is correctly implemented when:

- same condition yields same code consistently
- snapshot warnings are stable and structured
- API errors use the canonical error envelope
- frontend rendering keys off stable codes
- QA can predict warning/error behavior from fixtures
- no legacy or ad hoc codes leak into active implementation

---

## 15. One-paragraph summary

SportPulse MVP uses a stable taxonomy in which warnings communicate degraded but still usable truth and errors communicate failed operations. Snapshot-facing warnings such as `STALE_DATA`, `PARTIAL_DATA`, `MISSING_SIGNAL`, `PROVIDER_ERROR`, `LAYOUT_DEGRADED`, `LAYOUT_SHIFT`, `NO_UPCOMING_MATCH`, and `INSUFFICIENT_HISTORY` must remain semantically stable, while API failures use canonical error codes such as `BAD_REQUEST`, `NOT_FOUND`, and `SNAPSHOT_BUILD_FAILED`. This taxonomy prevents the system, the UI, QA, and AI-assisted workflows from assigning inconsistent meanings to degraded states.
