# Radar SportPulse — UI/UX Specification

Version: 1.0  
Status: Consolidated  
Scope: MVP  
Audience: Product, Frontend, Design, QA

---

## 1. Visual role

Radar SportPulse is a secondary-but-prominent editorial section.

It must:

- look clearly distinct from the normal match list
- feel useful and curated
- not compete with the primary score/state hierarchy of the portal
- not look like an ad banner
- not look like a duplicate fixture list

---

## 2. Placement

### Closed decision

Radar appears:

- in the space currently occupied by the map, or
- directly below the primary top block of the selected matchday view if the map is still present

### Feature-flag behavior

- if `enableRadarSection = true`, Radar may render
- if `hideMapSection = true`, the map is hidden
- the map is not removed from the system

### Priority

Radar should appear **before** the regular match list.

---

## 3. Render context

Radar renders only when:

- a league is selected
- a matchday is selected
- a valid Radar snapshot exists or a controlled fallback state exists

### Supported module states in UI

- `READY_PRE_MATCH`
- `READY_MIXED`
- `READY_POST_MATCH`
- `EMPTY`
- `UNAVAILABLE`

---

## 4. Module structure

Radar has these visual parts:

1. module header
2. subtitle
3. card layout
4. empty or unavailable fallback when needed

---

## 5. Section header

### Title
**Radar SportPulse**

### Subtitle
**Lo que está en la mira hoy**

### Rules

- title is fixed
- subtitle is fixed in MVP
- do not vary them by league, state, or matchday

Consistency builds section identity.

---

## 6. Card layout by viewport

### Desktop
- up to 3 cards
- preferred layout: 3 columns
- 2 cards → 2 columns
- 1 card → single expanded width card

### Tablet
- 2 columns
- 3rd card wraps to second row

### Mobile
- 1 column
- vertical stack
- no horizontal carousel in MVP

### Strong rule
Do not use a hidden carousel to bury cards.

---

## 7. Card anatomy

Each Radar card must include, in this order:

1. light contextual header
2. match title
3. live state / kickoff / final score block
4. main label pill
5. pre-match content block
6. reasons list
7. CTA
8. post-match outcome block when applicable

---

## 8. Card contextual header

### Content
- competition name
- optional matchday reference
- match hour or live/final state

### Rule
This header must stay visually light and must not dominate the card.

---

## 9. Match title block

### Content
`{homeTeam} vs {awayTeam}`

### Rule
This should be one of the most visible text elements in the card, second only to the label or shared with it depending on visual hierarchy.

### Do not
- use oversized crests
- visually turn the Radar card into a classic fixture card clone

---

## 10. Live state and score behavior

Radar reuses the same match-state semantics already defined elsewhere in SportPulse.

### States
- Programado
- En juego
- Finalizado
- Estado desconocido

### Pre-match
Show scheduled time.

### In-play
Show live score and in-play state.

### Post-match
Show final score and final state.

### Rule
Radar must not invent a separate score or status language.

---

## 11. Main label pill

### Labels
- En la mira
- Bajo el radar
- Señal de alerta
- Partido engañoso
- Partido abierto
- Duelo cerrado

### Rules
- one primary badge only
- no multiple competing main badges
- color/style consistent by label category
- no aggressive glow or distracting effects
- no animation required in MVP

---

## 12. Pre-match content block

### In `PRE_MATCH`
Show:
- `preMatchText`
- reasons

### In `IN_PLAY`
Keep:
- main label
- `preMatchText`
- reasons

Add a small note:

**Lectura previa**

### In `POST_MATCH`
Keep:
- label
- original `preMatchText`
- original reasons

Add a separate block:

**Desenlace**
- `verdictTitle` if applicable
- `verdictText` or `postMatchNote`

### Critical rule
Post-match must never replace the original reading. It adds contrast, not overwrite.

---

## 13. Reasons block

### Quantity
- show up to 3 reasons
- if Bootstrap only supports 2, show 2
- do not fabricate a third reason

### Format
- bullet list
- short lines
- no numeric ordered list
- no heavy icons

### Rule
Reasons must be easy to scan. If they are visually too long, the copy is wrong or the card is overloaded.

---

## 14. CTA

### Text
**Ver partido**

### Action
Navigates to the existing match detail flow.

### Rule
Radar must reuse existing navigation. It should not create a separate Radar-only match screen in MVP.

---

## 15. Post-match outcome block

### Header
**Desenlace**

### Content
For analytical labels:
- `verdictTitle`
- `verdictText`

For editorial-only labels:
- optional neutral `postMatchNote`
- or simply no verdict section, depending on final frontend choice

### Rule
This block must feel like an append-only contrast section.

---

## 16. Editorial states in UI

### `PRE_MATCH`
Show:
- label
- scheduled time
- `preMatchText`
- reasons
- CTA

Do not show verdict.

### `IN_PLAY`
Show:
- label
- live score
- small `Lectura previa` marker
- `preMatchText`
- reasons
- CTA

Do not show verdict.

### `POST_MATCH`
Show:
- label
- final score
- original `preMatchText`
- original reasons
- `Desenlace` block
- CTA

---

## 17. Historical rendering

When the user views a past matchday:

- Radar renders the historical snapshot
- keeps original label, text, reasons
- shows the already-resolved post-match outcome when available

### Rule
No special giant historical badge is required, but the page context should already make it clear the user is browsing a past matchday.

---

## 18. Empty state

### Copy
**Radar SportPulse**  
**No hay señales claras para destacar en esta jornada**

Optional subtext:

**Los partidos de esta fecha no dejaron lecturas suficientemente fuertes para el Radar.**

### Rule
Do not lower thresholds just to avoid an empty state.

---

## 19. Unavailable state

### Copy
**Radar SportPulse**  
**No se pudo generar el Radar para esta jornada**

Optional subtext:

**Faltan datos o hubo un problema de integración.**

### Rule
Do not render half-broken editorial content.

---

## 20. Density and vertical space

Radar must not expand so much that it pushes the normal match list too far down.

### Practical limits
- label should fit in 1 line
- `preMatchText` ideally within 2 lines
- reasons max 3 bullets
- verdict text ideally within 2 lines

### If this breaks
Do not solve it with internal scroll containers. Fix the copy or the card layout.

---

## 21. Component reuse policy

Recommended reuse from existing UI:

- typography system
- spacing system
- existing match-status badge style if compatible
- existing navigation handling

### But
Do not force Radar into the existing fixture card if that damages readability.

---

## 22. Allowed interactions in MVP

### Required
- click on card → open existing match detail
- click on CTA → open existing match detail

### Optional
- expandable reasons on very small screens if needed

### Not required in MVP
- internal Radar filters
- tabs
- hover effects beyond basic affordance
- advanced animations

---

## 23. Responsive behavior summary

### Desktop
Three-card grid by default.

### Tablet
Two columns.

### Mobile
Single-column stack.

### Strong rule
Do not convert Radar into a horizontal swipe module in the first version.

---

## 24. Consistency rules

- one label per card
- pre-match reading persists across states
- verdict only appears post-match
- live score/status always comes from live data layer
- editorial text always comes from Radar snapshot layer
- Radar failure must not break the rest of the page

