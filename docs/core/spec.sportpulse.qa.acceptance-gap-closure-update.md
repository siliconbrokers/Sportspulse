---
artifact_id: SPEC-SPORTPULSE-QA-ACCEPTANCE-GAP-CLOSURE-UPDATE
title: "Acceptance Gap Closure Update"
artifact_class: spec
status: draft
version: 0.2.1
project: sportpulse
domain: qa
slug: acceptance-gap-closure-update
owner: team
created_at: 2026-03-21
updated_at: 2026-03-21
supersedes: []
superseded_by: []
related_artifacts:
  - SPEC-SPORTPULSE-QA-ACCEPTANCE-TEST-MATRIX
  - SPEC-SPORTPULSE-QA-PREDICTION-TRACK-RECORD-FIXTURES
  - SPEC-SPORTPULSE-BACKEND-SESSION-AUTH-CONTRACT
  - SPEC-SPORTPULSE-BACKEND-SUBSCRIPTION-CHECKOUT-CONTRACT
  - SPEC-SPORTPULSE-BACKEND-TRACK-RECORD-CONTRACT
  - SPEC-SPORTPULSE-WEB-AUTH-AND-FREEMIUM-SURFACE
  - SPEC-SPORTPULSE-WEB-FRONTEND-EXECUTION-BACKLOG
  - SPEC-SPORTPULSE-WEB-FRONTEND-MODERNIZATION
canonical_path: docs/core/spec.sportpulse.qa.acceptance-gap-closure-update.md
---

# SportPulse — Acceptance Gap Closure Update

Version: 0.2.1  
Status: Draft  
Scope: Formal acceptance additions and alignment rules required to close the current web/frontend integration gap after introduction of auth/session, Pro checkout behavior, ad suppression by tier, and Level B style-propagation claims  
Audience: QA, Backend, Frontend, Product

---

## 1. Purpose

This document does two things:

1. formalizes the missing acceptance additions for the new web/frontend surface,
2. resolves the K-series namespace collision between the active acceptance matrix and the prediction fixture document.

Without both actions, the corpus remains internally contradictory.

---

## 2. Mandatory corpus alignment rule

The active acceptance matrix currently uses:

- `K-04` = Pro depth paywall gate,
- `K-05` = Pro subscription flow,
- `K-06` = Registration deferral.

The prediction fixture document currently still maps:

- `K-04` = PF-04 calibration shape,
- `K-05` = PF-05 operating mode integrity,
- `K-06` = PF-06 pre-kickoff timestamp discipline.

That collision is forbidden. The corpus must not keep two different meanings for the same active acceptance IDs.

### 2.1 Required correction to the fixture document

`spec.sportpulse.qa.prediction-track-record-fixtures.md` must be updated concurrently so that its K-series mapping becomes:

| Acceptance ID | Covered by fixture(s) |
|---|---|
| K-01 | supporting evidence only as applicable to prediction display correctness |
| K-02 | supporting evidence only as applicable to unavailability correctness |
| K-03 | PF-03 (track record threshold gate) |

And PF-04 / PF-05 / PF-06 must stop claiming ownership of active K-04 / K-05 / K-06 IDs.

### 2.2 Replacement wording for the fixture document

Replace any sentence equivalent to “PF-* fixtures are the backing evidence for Acceptance Matrix series K (K-01 through K-06)” with:

> PF-* fixtures are an independent prediction-fixture family. PF-03 backs active acceptance K-03 directly. Other PF fixtures provide supporting property evidence for prediction correctness and must not redefine active K-series acceptance identifiers.

This correction is required before merge.

---

## 3. Acceptance additions to insert after K-06

### K-07 — Pro commercial ad suppression

**Precondition (free tier):** at least one active commercial display ad slot is configured for the tested surface.  
**Expected:** the configured commercial display ad slot **must render** for anonymous or authenticated free users.

**Precondition (Pro tier):** authenticated user with active Pro subscription on the same tested surface.  
**Expected:** configured commercial display ad slot **must not** render.

**Invariant:** the system must preserve semantic distinction between:
- commercial ads,
- operational notices,
- degraded-state warnings,
- mandatory legal/compliance notices,
- product-owned informational notices.

**Must not:**
- suppress operational notices for Pro,
- suppress system warnings for Pro,
- leave broken placeholder chrome where a Pro-suppressed ad would have rendered,
- reclassify an ad as an “announcement” to evade suppression.

**Pass gate:**
- free/anonymous DOM contains configured commercial ad slot output,
- Pro DOM contains no commercial ad output,
- operational/system notices remain visible when active,
- layout remains structurally intact after ad suppression.

### K-08 — Level B style-propagation readiness

**Precondition:**
- Level A critical-surface style safety has already been reached,
- the active product surface inventory for the current release is explicitly listed,
- at least two approved theme states are available for verification,
- any temporary exceptions are documented.

**Expected:** a theme swap propagates across the full active product surface inventory without per-surface manual patching.

**Invariant:** the following semantic distinctions remain intact under theme change:
- operational warnings vs editorial/product announcements,
- Pro paywall vs error/degraded states,
- free vs Pro surfaces,
- primary vs secondary information hierarchy,
- text/icon contrast for important numeric and state content.

**Must not:**
- rely on undocumented raw visual values in active product surfaces,
- require one-off surface rewrites to complete the verified theme swap,
- collapse warning/promotional/premium styling into visually ambiguous states,
- claim full product-wide propagation while undocumented exceptions still exist.

**Pass gate:**
- every active product surface is either style-safe or an explicitly documented exception,
- a verified theme swap passes across the active product surface inventory,
- notices, warnings, paywall, auth/session, loading/empty/error/degraded, and free-vs-Pro surfaces retain semantic distinction,
- no undocumented raw style leakage remains in active product surfaces,
- the stronger Level B claim can be asserted honestly.

---

## 4. Interpretation rules

### 4.1 K-07 is not an ad-tech test

K-07 verifies tier-based commercial suppression works without mutating operational truth. A product-owned notice is not an ad. Sponsorship or partner display inventory must not be mislabeled to bypass Pro suppression.

### 4.2 K-08 is not a visual taste test

K-08 is a structural style-safety test. It proves the stronger “Level B propagation” claim is honest enough to ship.

---

## 5. Surface inventory minimum for K-08

The minimum active-surface inventory for K-08 verification must include, at minimum:

- dashboard / resumen,
- predictions list and detail,
- track record,
- Pro surface,
- auth/session shell state,
- paywall,
- loading / empty / error / degraded states,
- notices / announcement bar.

If any of these are out of release scope, that exception must be explicitly documented for the tested release.

---

## 6. Merge instructions

To merge this update cleanly:

1. insert K-07 after K-06 in the acceptance matrix,
2. insert K-08 after K-07,
3. update the prediction fixture document per Section 2 in the same change set,
4. stop using “K-08 or equivalent” once K-08 is adopted formally.

---

## 7. Summary

K-07 closes the monetization semantics gap.  
K-08 closes the style-propagation honesty gap.  
The fixture-mapping correction closes the K-series namespace collision that would otherwise leave the corpus internally inconsistent.
