# Radar SportPulse — Editorial Policy

Version: 1.1 (copy library updated to v3)
Status: Consolidated
Scope: MVP  
Audience: Product, Backend, Frontend, QA

---

## 1. Editorial principle

Radar is not free-form writing.

It is a deterministic editorial layer built from:

- label
- subtype
- template
- sanitization rules
- evidence-backed reasons

Free-form generation is explicitly out of scope for MVP.

---

## 2. Allowed labels

Radar uses only these six labels:

- **En la mira**
- **Bajo el radar**
- **Señal de alerta**
- **Partido engañoso**
- **Partido abierto**
- **Duelo cerrado**

Each card gets exactly one label.

---

## 3. Label intent

### En la mira
Editorial-only. Used when a match deserves attention for its visible context or relevance within the matchday.

### Bajo el radar
Editorial-only. Used when a match looks secondary on the surface but carries a useful non-obvious signal.

### Señal de alerta
Analytical. Used when an apparent favorite shows meaningful vulnerability.

### Partido engañoso
Analytical. Used when surface appearance and recent signals point in different directions.

### Partido abierto
Analytical. Used when pre-match evidence suggests an open, exchange-heavy dynamic.

### Duelo cerrado
Analytical. Used when pre-match evidence suggests low margin and controlled amplitude.

---

## 4. Pre-match text rules

The `preMatchText`:

- must be **one single sentence**
- must be built from a closed template library
- must summarize the dominant reading
- must not duplicate reasons
- must not include team names
- should not include numbers in MVP
- must not include betting or predictive language

### Length limits

- ideal: 90–120 characters
- acceptable: 70–140 characters
- hard cap: 140 characters

### Forbidden language

Do not use:

- seguro
- garantizado
- apuesta
- pick
- cuota
- promete
- partidazo
- imperdible
- todo indica
- debería ganar
- probablemente
- se espera que

---

## 5. Pre-match text construction model

Pre-match text is built using:

`label -> subtype -> template -> render -> sanitize`

The system must first resolve the subtype, then render one valid template.

---

## 6. Subjects allowed in pre-match text

Use only generic editorial subjects such as:

- la tabla
- la previa
- la superficie
- el cruce
- el partido
- el favorito
- el local
- el visitante

Do not use:

- team names
- player names
- exact numbers
- explicit odds references

---

## 7. EN LA MIRA (→ `CRUCE_PESADO` en librería v3)

### Allowed subtypes

- `TOP_CONTEXT` → context `season_turning`
- `FORM_CONTEXT` → context `heat_of_matchday`
- `MATCHDAY_WEIGHT` → context `table_pressure`

### Templates

See `radar-editorial-copy-library-rioplatense-v3.json` → label `CRUCE_PESADO`.
Each context has 12 templates (tone: futbolero / venenoso / picante respectively).

### Restriction

Do not use contradiction, warning, open-game, or tight-game language here.

---

## 8. BAJO EL RADAR (→ `BAJO_EL_RADAR` en librería v3)

### Allowed subtypes

- `QUIET_COMPETITIVE_SIGNAL` → context `quiet_but_spicy`
- `LOW_VISIBILITY_CONTEXT` → context `hidden_signals`
- `NON_OBVIOUS_BALANCE` → context `steals_the_show`

### Templates

See `radar-editorial-copy-library-rioplatense-v3.json` → label `BAJO_EL_RADAR`.
Each context has 12 templates (tone: picante / futbolero / venenoso respectively).

### Restriction

If there is a strong contradiction between surface and signals, use **Partido engañoso** instead.

---

## 9. SEÑAL DE ALERTA (→ `SEÑAL_DE_ALERTA` en librería v3)

### Allowed subtypes

- `FAVORITE_DEFENSIVE_FRAGILITY` → context `favorite_concedes`
- `UNDERDOG_COMPETITIVE_RESISTANCE` → context `rival_bites`
- `FAVORITE_WEAK_LOCAL_EDGE` → context `favorite_shaky`

### Templates

See `radar-editorial-copy-library-rioplatense-v3.json` → label `SEÑAL_DE_ALERTA`.
Each context has 12 templates (tone: venenoso / futbolero / picante respectively).

### Restriction

A meaningful pre-match favorite must exist. Otherwise this label is invalid.

---

## 10. PARTIDO ENGAÑOSO (→ `PARTIDO_ENGAÑOSO` en librería v3)

### Allowed subtypes

- `TABLE_FORM_CONTRADICTION` → context `table_lies`
- `SURFACE_DISTANCE_OVERSOLD` → context `surface_trap`
- `FAVORITE_NOT_AS_COMFORTABLE` → context `favorite_inflated`

### Templates

See `radar-editorial-copy-library-rioplatense-v3.json` → label `PARTIDO_ENGAÑOSO`.
Each context has 12 templates (tone: picante / venenoso / futbolero respectively).

### Restriction

Do not use this label for simple parity. A true surface-vs-reality contrast must exist.

---

## 11. PARTIDO ABIERTO (→ `PARTIDO_ABIERTO` en librería v3)

### Allowed subtypes

- `BOTH_SCORE_AND_CONCEDE` → context `both_concede`
- `GOAL_EXCHANGE_SIGNAL` → context `both_score`
- `LOW_CONTROL_PROFILE` → context `chaos_profile`

### Templates

See `radar-editorial-copy-library-rioplatense-v3.json` → label `PARTIDO_ABIERTO`.
Each context has 12 templates (tone: venenoso / futbolero / picante respectively).

### Restriction

Do not use if the openness signal depends almost entirely on only one team.

---

## 12. DUELO CERRADO (→ `DUELO_CERRADO` en librería v3)

### Allowed subtypes

- `LOW_GOAL_VOLUME` → context `low_goal`
- `TIGHT_BALANCE` → context `tight_balance`
- `LOW_MARGIN_PROFILE` → context `rough_match`

### Templates

See `radar-editorial-copy-library-rioplatense-v3.json` → label `DUELO_CERRADO`.
Each context has 12 templates (tone: sobrio / futbolero / venenoso respectively).

### Restriction

Do not use if the match also carries strong open-game evidence.

---

## 13. Subtype resolution priority

### EN LA MIRA
1. `TOP_CONTEXT`
2. `FORM_CONTEXT`
3. `MATCHDAY_WEIGHT`

### BAJO EL RADAR
1. `QUIET_COMPETITIVE_SIGNAL`
2. `LOW_VISIBILITY_CONTEXT`
3. `NON_OBVIOUS_BALANCE`

### SEÑAL DE ALERTA
1. `FAVORITE_DEFENSIVE_FRAGILITY`
2. `UNDERDOG_COMPETITIVE_RESISTANCE`
3. `FAVORITE_WEAK_LOCAL_EDGE`

### PARTIDO ENGAÑOSO
1. `TABLE_FORM_CONTRADICTION`
2. `FAVORITE_NOT_AS_COMFORTABLE`
3. `SURFACE_DISTANCE_OVERSOLD`

### PARTIDO ABIERTO
1. `BOTH_SCORE_AND_CONCEDE`
2. `GOAL_EXCHANGE_SIGNAL`
3. `LOW_CONTROL_PROFILE`

### DUELO CERRADO
1. `LOW_GOAL_VOLUME`
2. `TIGHT_BALANCE`
3. `LOW_MARGIN_PROFILE`

---

## 14. Template rotation (v3 rules)

Within one matchday snapshot:

- do not repeat the exact same `preMatchText` (deduplication by text, not by id)
- use `matchId` as deterministic seed to select different templates per match across leagues
- no `remates_opcionales` — every phrase in v3 is self-contained and closed
- tone is fixed per context (no per-template tone selection needed)
- do not repeat an opening pattern of 4+ words within the same label in the same snapshot
- max 1 venenoso-tone phrase per label per snapshot when alternatives exist

### Implementation note (2026-03)

Deduplication by exact text is fully implemented. However, the following restrictions are **pending implementation**:
- Restriction of "max 1 venenoso per label per snapshot" — the selector does not validate tone preferences in runtime; the v3 template library was designed to minimize this conflict, but no enforcement gate exists.
- Opening pattern restriction (4+ words) — not validated by `radar-text-renderer.ts` during template selection.

Both restrictions are deferred to a future integration cycle. See plan item RADAR-TONE-DEDUP.

---

## 15. Sanitization rules for pre-match text

Before persisting `preMatchText`, validate:

- max 140 chars
- exactly one sentence
- no team names
- no numbers
- no forbidden words
- no contradiction with the label
- no near-duplication of one of the card reasons

If a candidate template fails, try the next valid template. If no valid template remains, try the next valid subtype. If none remain, the card must be rejected.

---

## 16. Reasons policy

Reasons are mandatory explanatory evidence.

### Nature of reasons

Reasons are not free-form prose. They come from a controlled template library and must be grounded in real data.

### Allowed reason classes

- `FORM_REASON`
- `DEFENSIVE_REASON`
- `OFFENSIVE_REASON`
- `HOME_AWAY_REASON`
- `TABLE_CONTEXT_REASON`
- `SEASON_CARRYOVER_REASON`
- `MATCHDAY_CONTEXT_REASON`
- `HIDDEN_VALUE_REASON`

### Global rules

Reasons must:

- support the label
- not contradict the pre-match text
- not repeat the same point in different words
- remain short and scannable
- avoid betting language

### Length

- ideal: 55–95 chars
- max: 120 chars

Numbers are allowed in reasons when useful.

---

## 17. Seasonal evidence and reasons count

### Bootstrap (`BOOTSTRAP`)
- minimum: **2 reasons**
- maximum: 3 reasons
- at least one reason should rely on comparable prior context or reliable split logic when current-season sample is weak

### Early (`EARLY`)
- preferred: 3 reasons
- acceptable: 2 strong reasons

### Stable (`STABLE`)
- exactly **3 reasons**

If the minimum required reasons cannot be produced honestly, the card must be excluded.

---

## 18. Reasons by label

### EN LA MIRA
Allowed classes:

- `MATCHDAY_CONTEXT_REASON`
- `TABLE_CONTEXT_REASON`
- `FORM_REASON`

Typical examples:

- `Es uno de los cruces con más contexto competitivo dentro de la jornada.`
- `La fecha lo deja entre los partidos con más peso relativo para seguir.`
- `Ambos llegan con contexto suficiente como para destacarlo en la jornada.`

### BAJO EL RADAR
Allowed classes:

- `HIDDEN_VALUE_REASON`
- `FORM_REASON`
- `HOME_AWAY_REASON`
- `SEASON_CARRYOVER_REASON`

Typical examples:

- `No es de los cruces más visibles, pero llega con señales competitivas útiles.`
- `El contexto reciente lo vuelve más interesante de lo que sugiere el fixture.`
- `Hay una lectura menos obvia en un partido que pasa bastante desapercibido.`

### SEÑAL DE ALERTA
Allowed classes:

- `DEFENSIVE_REASON`
- `HOME_AWAY_REASON`
- `FORM_REASON`
- `TABLE_CONTEXT_REASON`
- `SEASON_CARRYOVER_REASON`

Typical examples:

- `El favorito viene concediendo con más frecuencia de la que su posición sugiere.`
- `El rival compite mejor de lo que la diferencia aparente de tabla indica.`
- `La ventaja previa existe, pero la solidez reciente no termina de sostenerla.`
- `El favorito recibió gol en {x} de sus últimos {y} partidos.`
- `El rival sumó puntos en {x} de sus últimas {y} salidas.`

### PARTIDO ENGAÑOSO
Allowed classes:

- `TABLE_CONTEXT_REASON`
- `FORM_REASON`
- `HOME_AWAY_REASON`
- `SEASON_CARRYOVER_REASON`

Typical examples:

- `La tabla marca una diferencia que la forma reciente no acompaña del todo.`
- `El contexto aparente sugiere un cruce más simple del que muestran las señales.`
- `La distancia visible existe, pero el partido llega menos lineal de lo esperado.`
- `El split reciente reduce parte de la comodidad que la previa insinuaba.`

### PARTIDO ABIERTO
Allowed classes:

- `OFFENSIVE_REASON`
- `DEFENSIVE_REASON`
- `FORM_REASON`
- `SEASON_CARRYOVER_REASON`

Typical examples:

- `Ambos llegan marcando con frecuencia en la previa reciente.`
- `Los dos vienen concediendo lo suficiente como para abrir margen al intercambio.`
- `El contexto reciente deja más señales de ida y vuelta que de control.`
- `Ambos marcaron en {x} de sus últimos {y} partidos.`

### DUELO CERRADO
Allowed classes:

- `FORM_REASON`
- `OFFENSIVE_REASON`
- `HOME_AWAY_REASON`
- `SEASON_CARRYOVER_REASON`
- `TABLE_CONTEXT_REASON`

Typical examples:

- `La previa reciente deja poca amplitud y bastante margen corto.`
- `No aparecen demasiadas señales de gol alto en ninguno de los dos lados.`
- `El cruce llega con bastante equilibrio y poco espacio para una diferencia amplia.`
- `Los últimos partidos de ambos tuvieron poca amplitud de marcador.`

---

## 19. Mandatory reason composition rules

### EN LA MIRA
Use:
- 1 context reason
- 1 competitive weight or matchday reason
- 1 optional form reason

### BAJO EL RADAR
Use:
- 1 hidden-signal reason
- 1 split or form reason
- 1 optional support reason

### SEÑAL DE ALERTA
Use:
- 1 mandatory fragility reason
- 1 mandatory rival-resistance or weak-edge reason
- 1 support reason

If the first two are unavailable, reject the card.

### PARTIDO ENGAÑOSO
Use:
- 1 mandatory contradiction reason
- 1 support reason from form or split
- 1 contextual reason

If no explicit contradiction reason exists, reject the card.

### PARTIDO ABIERTO
Use:
- 1 mandatory goal/exchange reason
- 1 mandatory defensive-fragility or shared-volume reason
- 1 support reason

### DUELO CERRADO
Use:
- 1 mandatory low-amplitude reason
- 1 mandatory balance or low-margin reason
- 1 support reason

---

## 20. Incompatibility rules

Do not allow:

- strong open-game reasons under `Duelo cerrado`
- strong closed-game reasons under `Partido abierto`
- strong contradiction reasons under `En la mira`
- strong favorite fragility reasons under `Bajo el radar` if they truly justify `Señal de alerta`

If this happens, the match is misclassified.

---

## 21. Bootstrap restrictions

At the beginning of the season, Radar may still operate from matchday 1, but analytical labels require caution.

### Bootstrap restrictions

- `Partido engañoso` requires a defensible surface-vs-reality contrast using comparable evidence
- `Señal de alerta` requires a meaningful pre-match favorite and comparable vulnerability evidence
- `Partido abierto` and `Duelo cerrado` are easier to allow early when prior comparable split or carryover evidence exists
- promoted teams or teams without comparable history should not be forced into strong analytical labels

If evidence is insufficient, prefer:

- `En la mira`
- `Bajo el radar`

or reject the card entirely.

### Implementation note (2026-03)

The analytical label restrictions for BOOTSTRAP tier are **not currently enforced**. In the current implementation (radar-signal-evaluator.ts), labels like `SENAL_DE_ALERTA` and `PARTIDO_ENGANOSO` can appear in matchday 1-3 without additional guard logic beyond the standard signal thresholds.

The `evidenceTier=BOOTSTRAP` marker is persisted and signals to users that evidence is limited, but there is no additional algorithmic restriction on analytical label eligibility during bootstrap jornadas. This is a known pending clarification. See plan item RADAR-BOOTSTRAP-GUARD.

---

## 22. Post-match verdict policy

Only these labels may resolve to a verdict:

- Señal de alerta
- Partido engañoso
- Partido abierto
- Duelo cerrado

Allowed verdict values:

- `CONFIRMED`
- `PARTIAL`
- `REJECTED`

Editorial-only labels use no strong verdict.

---

## 23. Verdict logic by label

### SEÑAL DE ALERTA

#### Confirmed
- favorite does not win, or
- favorite wins by 1 goal and concedes

#### Partial
- favorite wins by 1 goal and keeps a clean sheet, or
- favorite wins by 2+ and concedes

#### Rejected
- favorite wins by 2+ and keeps a clean sheet

### PARTIDO ENGAÑOSO

#### Confirmed
- favorite does not win, or
- favorite wins by only 1 goal

#### Partial
- favorite wins by 2 and both teams score

#### Rejected
- favorite wins by 2+ with clean sheet, or
- favorite wins by 3+ even if it concedes one

### PARTIDO ABIERTO

#### Confirmed
- both teams score and total goals >= 3, or
- total goals >= 4

#### Partial
- both teams score and total goals = 2, or
- both teams do not score but total goals = 3

#### Rejected
- total goals <= 2 and both teams do not score

### DUELO CERRADO

#### Confirmed
- total goals <= 2 and goal difference <= 1

#### Partial
- total goals <= 2 and goal difference = 2, or
- total goals = 3 and goal difference <= 1

#### Rejected
- total goals >= 4, or
- goal difference >= 3

---

## 24. Verdict copy

### Standard titles

- `CONFIRMED` → **La lectura se confirmó**
- `PARTIAL` → **La lectura se cumplió a medias**
- `REJECTED` → **La lectura no se confirmó**

### Example explanatory texts

#### Señal de alerta
- `La lectura se confirmó: el favorito no resolvió el cruce con la solidez esperada.`
- `La lectura se cumplió a medias: hubo señales de alerta, pero no alcanzaron para torcer el desenlace.`
- `La lectura no se confirmó: el favorito resolvió el partido con autoridad.`

#### Partido engañoso
- `La lectura se confirmó: el cruce no fue tan simple como la superficie sugería.`
- `La lectura se cumplió a medias: hubo matices del engaño previo, aunque el resultado final se ordenó.`
- `La lectura no se confirmó: el resultado terminó alineado con la apariencia previa.`

#### Partido abierto
- `La lectura se confirmó: el partido dejó el intercambio que sugería la previa.`
- `La lectura se cumplió a medias: aparecieron señales de apertura, pero no de forma completa.`
- `La lectura no se confirmó: el cruce terminó mucho más contenido de lo esperado.`

#### Duelo cerrado
- `La lectura se confirmó: el partido se mantuvo corto y con poco margen.`
- `La lectura se cumplió a medias: hubo margen corto por momentos, pero no un cierre completo.`
- `La lectura no se confirmó: el cruce terminó más abierto de lo que sugería la previa.`

---

## 25. Editorial honesty rules

Radar must never claim:

- that it “predicted” the outcome
- that it “got it right” in betting terms
- that it is a tipster tool

Radar reads the pre-match context and then contrasts that reading against the final result.

