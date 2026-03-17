---
artifact_id: SPEC-SPORTPULSE-RADAR-V2-UIUX
title: "Radar SportPulse — UI/UX Specification v2"
artifact_class: spec
status: draft
version: 2.0.0
project: sportpulse
domain: radar
slug: radar-v2-ui-ux-spec
owner: team
created_at: 2026-03-16
updated_at: 2026-03-16
canonical_path: docs/specs/prediction/radar/Version 2/spec.sportpulse.radar-v2-ui-ux-spec.md
---

# Radar SportPulse — UI/UX Specification v2

## 1. Purpose

This document defines how Radar v2 is placed and rendered in product UI.

## 2. Placement

Radar remains a module located above the standard match list for the selected competition and matchday.

Radar is not the page.
Radar is a high-value overlay block.

## 3. Visibility Rule

Radar is rendered only inside the currently selected scope.

No cross-matchday or cross-competition bleed is allowed.

## 4. Card Count Display

UI must support rendering:
- 0 cards
- 1 card
- 2 cards
- 3 cards

No placeholder cards may be generated just to preserve visual symmetry.

## 5. Card Anatomy

Each Radar card contains:

- primary badge
- optional secondary badges
- match reference block
- pre-match editorial text
- optional reasons preview or reason chips
- optional verdict block after match completion

## 6. Primary Badge Rule

Exactly one primary badge is visually dominant.

This is a UI rule.
It does not imply the backend had only one internal activation.

## 7. Secondary Badges Rule

Up to two secondary badges may be rendered.

They must be visually subordinate to the primary badge.

If they add clutter instead of meaning, render none.

## 8. Match State Behavior

### PRE_MATCH
Show pre-match text only.

### IN_PLAY
Continue showing the same pre-match text.
Do not live-edit the editorial reading.

### POST_MATCH
Continue showing the same pre-match text.
Append verdict if available.

## 9. Historical Honesty Rule

The UI must preserve visible separation between:
- what Radar said before the match
- what happened after the match

The verdict is contrast, not overwrite.

## 10. Empty State

If Radar snapshot is valid but has zero cards:
- show nothing, or
- show a minimal neutral empty state

Do not shame the user with useless filler messaging.

## 11. Degraded State

If Radar is degraded but still safe:
- render available cards
- avoid scary language
- do not imply systemic failure
- do not block navigation

## 12. Failed State

If Radar failed:
- the match list still renders normally
- Radar block may disappear or show a minimal unavailable placeholder

## 13. Readability Rules

Radar cards must prioritize:
- short text
- easy badge scanning
- mobile readability
- no dense walls of text

## 14. Badge Copy Rule

Badge labels must remain stable and recognizable.
Do not rename visible labels casually between releases.

## 15. Reasons Rendering

Reasons may appear as:
- small chips
- short inline support text
- expandable detail

Reasons must not dominate the card.

## 16. Verdict Rendering

Verdict block must be visually distinct from pre-match text.

Suggested pattern:
- heading: `Desenlace`
- one short verdict line
- no visual confusion with original copy

## 17. Accessibility

Badges, verdicts, and degraded states must remain understandable without relying only on color.

## 18. Mobile Rule

Cards must remain legible in mobile without requiring expanded panels for the main editorial reading.

## 19. Success Condition

UI/UX succeeds when Radar is noticeable, useful, compact, honest, and non-disruptive.
