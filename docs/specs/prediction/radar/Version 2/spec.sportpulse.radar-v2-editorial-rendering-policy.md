---
artifact_id: SPEC-SPORTPULSE-RADAR-V2-RENDERING
title: "Radar SportPulse — Editorial Rendering Policy v2"
artifact_class: policy
status: draft
version: 2.0.0
project: sportpulse
domain: radar
slug: radar-v2-editorial-rendering-policy
owner: team
created_at: 2026-03-16
updated_at: 2026-03-16
canonical_path: docs/specs/prediction/radar/Version 2/spec.sportpulse.radar-v2-editorial-rendering-policy.md
---

# Radar SportPulse — Editorial Rendering Policy v2

## 1. Purpose

This document defines how Radar v2 turns resolved labels into final editorial copy.

It governs tone, structure, allowed language, forbidden language, determinism, sanitization, and repetition control.

It does not define the core ontology.
It does not define integration with prediction.

## 2. Rendering Chain

Rendering must follow this chain:

`label -> subtype -> template -> render -> sanitize`

Free-form generation is forbidden in production rendering.

## 3. Tone

Radar must sound:

- football-native
- concise
- controlled
- readable
- slightly editorial
- never pompous
- never probabilistic-jargon heavy
- never bookmaker-like

## 4. Language Rules

Allowed:
- natural football phrasing
- compact editorial framing
- hints of tension, contrast, rhythm, fragility, exposure

Forbidden:
- betting calls
- certainty claims
- promises
- odds language
- gambler slang
- fake precision
- pseudo-statistical showing off

## 5. Text Structure

Each card has:

- `preMatchText`
- optional `verdictText`

`preMatchText` should be short.
Default target: one sentence.
A second short clause is acceptable if necessary for clarity.

## 6. Team Naming Rule

By default, `preMatchText` should not require team names to make sense.
If team names are included in future extensions, they must remain optional and controlled.

## 7. Numerical Frugality Rule

Do not inject visible numbers into Radar editorial copy unless the rendering policy is explicitly upgraded to allow them.

Radar v2 standalone should remain mostly non-numeric in visible editorial copy.

## 8. Reasons Discipline

Reasons are not raw debug logs.
Reasons must be compact, truthful, and support the reading without pretending full causal proof.

## 9. Subtypes

Each label may have multiple subtypes.
Subtype choice must be deterministic and bounded.

Subtype libraries must be versioned.

## 10. Template Library Rule

Templates must live in closed, versioned libraries.

No unbounded runtime text invention.

## 11. Deterministic Selection

Template selection must be deterministic.
A stable seed strategy is required, such as `matchId`-based deterministic rotation.

The same snapshot must always render the same final copy.

## 12. Deduplication

Within one scope, avoid obvious repetition of:
- identical openings
- identical closings
- identical sentence skeletons

Deduplication should improve readability without sacrificing determinism.

## 13. Sanitization

After rendering, the final text must be sanitized for:
- duplicate spaces
- malformed punctuation
- repeated commas
- broken accents if applicable
- accidental double endings
- illegal terms

## 14. Label Voice Guidance

### EN_LA_MIRA
Voice: important, visible, impossible to ignore.

### BAJO_EL_RADAR
Voice: quiet interest, hidden edge of attention.

### PARTIDO_ABIERTO
Voice: movement, exchange, rhythm, looseness.

### DUELO_CERRADO
Voice: friction, compression, caution, narrow margins.

### SENAL_DE_ALERTA
Voice: caution, fragility, instability, hidden risk.

### PARTIDO_ENGANOSO
Voice: surface lie, misleading simplicity, deceptive framing.

## 15. Verdict Tone

Verdict text must:
- acknowledge result-facing reality
- remain short
- avoid triumphalism
- avoid self-congratulation
- avoid overexplaining

## 16. Honesty Law

Radar copy must never claim more than the label actually supports.

If the underlying reading is conservative, the copy must stay conservative.

## 17. Standalone Rule

No rendering rule in v2 may assume predictor fields exist.

## 18. Success Condition

Rendering policy succeeds when Radar sounds sharp and football-native without becoming noisy, repetitive, arrogant, or dishonest.
