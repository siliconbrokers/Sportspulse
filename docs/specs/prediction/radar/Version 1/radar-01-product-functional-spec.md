# Radar SportPulse — Product Functional Specification

Version: 1.0  
Status: Consolidated  
Scope: MVP  
Audience: Product, Backend, Frontend, QA

---

## 1. Purpose

Radar SportPulse is an editorial insight section that sits on top of the existing match experience without replacing it.

Its role is to detect and surface a small number of matches within the selected league and selected matchday that deserve attention for one of these reasons:

- they carry strong contextual weight within the matchday
- they hide a non-obvious signal
- they contradict the surface reading of the fixture
- they suggest a clear open or tight game dynamic

Radar must make SportPulse feel interpretive, not just descriptive.

---

## 2. Non-goals

Radar MVP does **not** aim to:

- replace the match list
- replace standings
- replace the existing match detail
- predict final results
- behave as a betting product
- depend on paid APIs
- depend on a database
- introduce a third mandatory provider
- recalculate historical editorial output silently

---

## 3. Closed scope

Radar operates only on:

- the **league currently selected in filters**
- the **matchday currently selected**

Radar does **not**:

- mix leagues
- mix matchdays
- compute a global daily ranking across competitions
- show matches outside the active filter scope

### Historical rule

When the user navigates to past matchdays, Radar must show the snapshot that existed for that league and matchday at the time, including post-match resolution if available.

It must **not** silently rebuild history from current context and present that as original editorial output.

---

## 4. Relationship with the existing product

Radar is additive and reversible.

Radar must not change:

- the current match list order
- the current match state logic
- the standings experience
- the existing team/match detail experience
- the existing navigation to match detail

The map section may be hidden behind a feature flag, but not removed from the system.

---

## 5. Core unit

The canonical persistence and rendering unit for Radar is:

`competitionKey + seasonKey + matchday`

Radar is therefore matchday-centric, not calendar-day-centric.

---

## 6. Module states

Radar supports these module states:

- `READY_PRE_MATCH`
- `READY_MIXED`
- `READY_POST_MATCH`
- `EMPTY`
- `UNAVAILABLE`

### Meaning

- `READY_PRE_MATCH`: snapshot exists and cards are available before full resolution
- `READY_MIXED`: snapshot exists and some cards are already resolved while others are not
- `READY_POST_MATCH`: all Radar cards for that matchday are resolved or final
- `EMPTY`: no match passed Radar thresholds for that league+matchday
- `UNAVAILABLE`: Radar could not be generated because of missing data or technical failure

---

## 7. Card count

Radar shows:

- maximum **3 cards**
- minimum **0 cards**

No artificial filler is allowed.

If only one strong card exists, Radar shows one card. If no valid card exists, Radar falls back to `EMPTY`.

---

## 8. Selection goal

Radar does not seek “the best matches” in a generic sense.

It seeks matches that, within the selected matchday, express at least one of the following:

- obvious competitive relevance worth highlighting
- hidden value not obvious in the raw fixture list
- contradiction between surface and recent signals
- open-game tendency
- tight-game tendency

---

## 9. Eligibility

A match enters the Radar candidate pool only if all of the following are true:

- it belongs to the selected league
- it belongs to the selected matchday
- it is not cancelled
- it is not postponed
- both teams are resolved in the canonical model
- standings context exists for the league
- current live data is usable enough to classify the match
- the match is not duplicated across providers

---

## 10. Evidence policy by season phase

A fixed rule like “minimum 4 current-season matches” is rejected because it breaks Radar at the start of a season.

Radar uses an evidence policy by phase:

### Bootstrap phase
Applies to matchdays 1–3.

Allowed evidence, in this order:

1. current-season data, even if small
2. final stretch of previous season in the same competition, if comparable
3. recent home/away split from previous season, if comparable
4. previous season finishing context, if comparable

### Early phase
Applies to matchdays 4–6.

Current season is primary. Previous season may be used as supporting evidence.

### Stable phase
Applies from matchday 7 onward.

Current season is primary and sufficient. Previous season should no longer be functionally required.

---

## 11. Evidence tier

Each Radar card must carry an internal `evidenceTier`:

- `BOOTSTRAP`
- `EARLY`
- `STABLE`

This tier affects:

- allowed evidence sources
- required number of reasons
- strictness of strong analytical labels early in a season

---

## 12. Signal family

Radar evaluates each candidate match across these six signal families:

- `ATTENTION_CONTEXT`
- `HIDDEN_VALUE`
- `FAVORITE_VULNERABILITY`
- `SURFACE_CONTRADICTION`
- `OPEN_GAME`
- `TIGHT_GAME`

Each family produces an internal `0..100` score.

---

## 13. Final labels

Radar cards may only use these six labels:

- **En la mira**
- **Bajo el radar**
- **Señal de alerta**
- **Partido engañoso**
- **Partido abierto**
- **Duelo cerrado**

Each card has exactly **one** primary label.

---

## 14. Editorial vs. analytical labels

### Editorial-only labels

- En la mira
- Bajo el radar

These do **not** get a strong post-match verdict.

### Analytical / post-match-validable labels

- Señal de alerta
- Partido engañoso
- Partido abierto
- Duelo cerrado

These may receive `CONFIRMED`, `PARTIAL`, or `REJECTED` after the match finishes.

---

## 15. Label precedence

If multiple labels qualify for a given match, use this priority order:

1. Partido engañoso
2. Señal de alerta
3. Partido abierto
4. Duelo cerrado
5. Bajo el radar
6. En la mira

This precedence prevents unstable classification.

---

## 16. Minimum thresholds by signal

Initial MVP minimum thresholds:

- `surfaceContradictionScore >= 68`
- `favoriteVulnerabilityScore >= 64`
- `openGameScore >= 63`
- `tightGameScore >= 63`
- `hiddenValueScore >= 60`
- `attentionScore >= 58`

These thresholds may evolve later under `policyVersion` control.

---

## 17. Radar ranking

Each candidate match gets:

- a `dominantSignal`
- a `dominantSignalScore`
- a `radarScore`

`radarScore` is used only for selection priority, never for UI.

Conceptually, Radar ranks by:

- dominant signal strength
- clarity of interpretation
- stability of the reading
- slight contextual boost for matchday relevance

The final selection is ordered by `radarScore` descending.

---

## 18. Diversity rules

Radar should not become visually repetitive.

Rules:

- no more than **2 cards with the same label** in one Radar section
- if the top 3 pure ranking produces 3 nearly identical readings, the third card may be replaced by the next valid card with a different reading, provided the score gap is not too large
- do not force diversity if it meaningfully lowers quality

---

## 19. Textual structure

Every Radar card is built from three layers:

1. **Primary label**
2. **Pre-match text**
3. **Reasons**

### Function of each layer

- label = editorial classification
- pre-match text = one-sentence summary of the dominant reading
- reasons = concrete evidence explaining the reading

---

## 20. Post-match structure

For analytical labels, post-match adds:

- verdict title
- verdict text

But must preserve:

- original label
- original pre-match text
- original reasons

Radar must contrast the original reading against the result. It must not rewrite the original reading after the fact.

---

## 21. Lifecycle

### Pre-match
Generate and freeze editorial reading.

### In-play
Keep the original reading visible. Update only live match state and score from the live data layer.

### Post-match
Add verdict if applicable. Do not rewrite the original reading.

---

## 22. Historical behavior

For past matchdays, Radar must show the persisted snapshot for that specific league+season+matchday.

If no snapshot exists, the system must either:

- show a controlled fallback, or
- explicitly mark a rebuild as historical reconstruction

It must never pretend a reconstructed editorial output is the original one.

---

## 23. Feature flags

Recommended flags:

- `enableRadarSection`
- `hideMapSection`
- `enableRadarPostMatchVerdict`

---

## 24. Product integrity rules

Radar must never:

- predict outcomes explicitly
- use betting language
- fake historical output
- generate narrative in the frontend
- override live match truth from providers
- replace core navigation

---

## 25. Final MVP product decision

Radar SportPulse MVP is a league-filtered, matchday-scoped, snapshot-based editorial module that:

- highlights up to 3 matches
- uses only current integrated sources plus derived logic
- works from matchday 1 through a season-phase evidence policy
- persists historical editorial output by league+season+matchday
- preserves the original pre-match reading and later contrasts it with the final result

