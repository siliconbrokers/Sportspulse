# **Match Detail Persistent Prediction Module Specification**

**Version:** 1.0  
 **Status:** Final  
 **Scope:** Match detail UI and prediction lifecycle behavior  
 **Audience:** Backend, Frontend, QA, Product  
 **Type:** Closed functional \+ UI technical specification

---

# **1\. Purpose**

This specification defines the required behavior for the **prediction module inside the match detail view**.

The module must remain visible across the full lifecycle of the match whenever prediction data exists.

The system must:

* show the prediction before the match  
* keep showing the prediction while the match is live  
* keep showing the prediction after the match is finished  
* evaluate the prediction against the actual final result when possible  
* apply this behavior to **all matches with prediction data**, not only radar matches

This specification is **implementation-binding**.  
 The implementation must not reinterpret the behavior described here.

---

# **2\. Problem Statement**

The current product behavior is incomplete:

* the match detail view already shows prediction data  
* after the match finishes, the prediction component disappears  
* the user cannot compare what was predicted versus what actually happened  
* the feature becomes non-verifiable and loses trust value

This is incorrect product behavior.

A prediction feature that does not survive into post-match evaluation is functionally incomplete.

---

# **3\. Core Product Decision**

## **3.1 Primary rule**

The prediction module in match detail is a **persistent contextual module**, not a pre-match-only widget.

## **3.2 Applicability rule**

This behavior applies to **all matches that have prediction data**.

It must **not** be restricted to radar matches.

## **3.3 Radar rule**

Radar status may affect highlighting, ranking, prominence, or surfacing of matches elsewhere in the product.

Radar status must **not** affect whether the prediction module appears in match detail or whether it persists after match completion.

---

# **4\. Scope**

## **Included**

This specification covers:

* match detail prediction module lifecycle  
* rendering rules by match status  
* post-match prediction outcome display  
* structured data requirements for evaluable predictions  
* UI hierarchy and visual rules  
* evaluation states  
* acceptance criteria  
* QA test matrix

## **Excluded**

This specification does **not** cover:

* prediction generation logic itself  
* radar ranking logic  
* list-card prediction UI outside match detail  
* map-card prediction UI outside match detail  
* prediction accuracy dashboards across many matches  
* historical analytics pages  
* notification logic  
* user-facing explanation of prediction model internals

---

# **5\. Definitions**

| Term | Meaning |
| ----- | ----- |
| Match Detail View | The detailed screen/panel for a single match |
| Prediction Module | The UI module in match detail showing prediction data |
| Prediction | Structured forecast generated for a match |
| Prediction Outcome | Evaluation of prediction against actual result |
| Radar Match | Editorially highlighted or prioritized match |
| Evaluable Prediction | Prediction stored in structured form and resolvable against final match result |
| Non-Evaluable Prediction | Prediction that cannot be programmatically resolved |

---

# **6\. Mandatory Business Rules**

## **BR-01**

If a match has prediction data, the match detail view **must render the prediction module**.

## **BR-02**

The prediction module **must remain visible** after the match is finished.

## **BR-03**

When the match is finished, the module **must switch into post-match evaluation mode** instead of disappearing.

## **BR-04**

This behavior applies to **all matches with prediction data**, regardless of whether the match belongs to radar.

## **BR-05**

If no prediction data exists for a match, the system must not invent or simulate a prediction.

## **BR-06**

Prediction evaluation must be deterministic and based on structured rules tied to prediction type.

## **BR-07**

If a prediction cannot be evaluated reliably, the module must show `No evaluable` rather than guessing.

## **BR-08**

The module must remain in the same logical position of the match detail view across all match states.

---

# **7\. Rendering Applicability**

The module must render for any match detail opened from any product entry point, provided prediction data exists.

This includes:

* radar matches  
* non-radar matches  
* matches opened from list views  
* matches opened from map views  
* matches opened from jornada flows  
* matches opened from league flows  
* matches opened from any other navigation source

Source of navigation must not change lifecycle behavior.

---

# **8\. Match State Modes**

The module must support the following match states:

* `scheduled`  
* `live`  
* `finished`  
* `unknown`

The module mode must be derived from match status.

## **8.1 Scheduled mode**

Show:

* prediction title  
* predicted outcome  
* prediction type  
* optional confidence  
* neutral badge: `Pendiente`

Do not show final evaluation.

## **8.2 Live mode**

Show:

* prediction title  
* predicted outcome  
* prediction type  
* optional confidence  
* in-progress badge: `En juego`

Do not show final evaluation yet.

## **8.3 Finished mode**

Show:

* prediction title  
* predicted outcome  
* final actual result  
* verdict badge:  
  * `Acertado`  
  * `Fallado`  
  * `Parcial`  
  * `No evaluable`

This is mandatory.

## **8.4 Unknown mode**

Show:

* prediction title  
* predicted outcome if available  
* neutral badge: `Sin evaluación`

Do not show a final verdict unless the system can evaluate safely.

---

# **9\. UI Positioning Rule**

The prediction module must remain in the same logical area of the match detail where prediction is currently displayed.

The implementation must not:

* move it to a detached lower section  
* create a second different post-match module elsewhere  
* duplicate prediction widgets in the same detail screen

The module must be **one component with mode switching**, not multiple independent components competing for space.

---

# **10\. Visual Design Rules**

The module must be visually discrete and readable.

## **Required design characteristics**

* compact card or panel  
* small badge-style status indicator  
* subtle border or surface separation  
* no glow  
* no celebratory effects  
* no intrusive animation  
* no oversized score treatment inside the module  
* no visual behavior that competes with the main match score/header

## **Design intent**

The module should communicate:

* what was predicted  
* what happened  
* whether the prediction was correct

It is informational, not theatrical.

---

# **11\. UI Content Hierarchy**

The internal content order of the module must be:

1. module title  
2. predicted outcome  
3. optional metadata  
4. actual result (finished mode only)  
5. prediction verdict

## **11.1 Module title**

Recommended label:

* `Pronóstico`

Allowed alternative:

* `Pronóstico vs resultado`

Use one consistently across the product.

## **11.2 Predicted outcome block**

Must always appear if prediction data exists.

Examples:

* `Ganador: Real Madrid`  
* `Doble oportunidad: Real Madrid o Empate`  
* `Ambos marcan: Sí`  
* `Más de 2.5 goles`  
* `Resultado exacto: 2 - 1`

## **11.3 Optional metadata block**

May include:

* confidence  
* generated time  
* source/model label if already supported elsewhere

This metadata is optional and must not crowd the component.

## **11.4 Actual result block**

Must appear in finished mode only.

Recommended label:

* `Resultado final`

Examples:

* `Resultado final: Real Madrid 2 - 1 Celta`  
* `Resultado final: 1 - 1`

## **11.5 Verdict block**

Must appear in finished mode if evaluation is possible or explicitly not possible.

Allowed verdict labels:

* `Acertado`  
* `Fallado`  
* `Parcial`  
* `No evaluable`

No other user-facing verdict labels are allowed in this version.

---

# **12\. Data Requirements**

Free text alone is not sufficient.

If the product wants post-match evaluation, the prediction must be stored in structured form.

## **12.1 Minimum required prediction structure**

```json
{
  "prediction": {
    "type": "winner",
    "label": "Ganador: Real Madrid",
    "value": "HOME",
    "confidence": "medium",
    "generatedAt": "2026-03-07T18:30:00Z"
  }
}
12.2 Minimum required prediction outcome structure
{
  "predictionOutcome": {
    "status": "hit",
    "evaluatedAt": "2026-03-07T22:15:00Z",
    "actualResult": {
      "home": 2,
      "away": 1
    }
  }
}
12.3 Combined example
{
  "prediction": {
    "type": "winner",
    "label": "Ganador: Real Madrid",
    "value": "HOME",
    "confidence": "medium",
    "generatedAt": "2026-03-07T18:30:00Z"
  },
  "predictionOutcome": {
    "status": "hit",
    "evaluatedAt": "2026-03-07T22:15:00Z",
    "actualResult": {
      "home": 2,
      "away": 1
    }
  }
}
13. Required Data Fields
13.1 Prediction object
Field	Type	Required	Description
type	string	yes	Prediction category
label	string	yes	User-facing prediction text
value	string/object/number	yes	Structured evaluable value
generatedAt	string (ISO)	yes	Timestamp when prediction was generated
confidence	string/number/null	no	Optional confidence indicator
13.2 Prediction outcome object
Field	Type	Required	Description
status	string	yes	Evaluation status
evaluatedAt	string (ISO)/null	no	Timestamp of evaluation
actualResult.home	number/null	no	Final home score
actualResult.away	number/null	no	Final away score
14. Allowed Prediction Types
The following prediction types are allowed in this version:

winner

double_chance

both_teams_score

over_under

exact_score

No other prediction type should be treated as evaluable unless explicitly added in a future specification.

15. Allowed Outcome Statuses
The following internal status values are allowed:

pending

in_progress

hit

miss

partial

not_evaluable

User-facing mapping
Internal status	UI label
pending	Pendiente
in_progress	En juego
hit	Acertado
miss	Fallado
partial	Parcial
not_evaluable	No evaluable
No other user-facing labels are allowed in this version.

16. Evaluation Rules by Prediction Type
Evaluation must be deterministic.

16.1 Winner
Example
Prediction:

Ganador: Real Madrid

Rule
if predicted side equals actual winner -> hit

otherwise -> miss

Draw rule
If match ends in draw and winner was predicted:

miss

16.2 Double chance
Examples
HOME_OR_DRAW

AWAY_OR_DRAW

HOME_OR_AWAY

Rule
if final outcome falls inside predicted set -> hit

otherwise -> miss

16.3 Both teams score
Example
Ambos marcan: Sí

Ambos marcan: No

Rule
compute whether both teams scored at least one goal

compare against predicted boolean

exact match -> hit

otherwise -> miss

16.4 Over/Under
Example
Más de 2.5 goles

Menos de 2.5 goles

Rule
compute total goals = home + away

compare against threshold and direction

exact logical match -> hit

otherwise -> miss

16.5 Exact score
Example
Resultado exacto: 2 - 1

Rule
if final home and away scores match exactly -> hit

otherwise -> miss

17. Partial Outcome Rule
partial may be used only if the product already supports compound or multi-part predictions and the evaluation framework can resolve them by subcomponent.

If compound predictions are not implemented in the current version, partial should not be emitted by default.

This version does not require compound prediction support.

18. Non-Evaluable Rule
The system must mark a prediction as not_evaluable when:

prediction type is unsupported

structured prediction value is missing

final result is unavailable or incomplete

the prediction is only narrative free text

deterministic evaluation cannot be guaranteed

The system must not guess.

19. Lifecycle Rules
19.1 Before match
If prediction exists and match is not started:

module visible

outcome status = pending

19.2 During match
If prediction exists and match is live:

module visible

outcome status = in_progress

19.3 After match
If prediction exists and final score is available:

module visible

system evaluates prediction outcome

actual result is displayed

verdict is displayed

19.4 Missing prediction
If no prediction exists:

module may be hidden

or product may show a neutral placeholder in a later spec

This version recommends hiding the module if no prediction exists.

20. Rendering Logic
20.1 Module visibility rule
if match.prediction exists:
    render PredictionDetailModule
else:
    do not render PredictionDetailModule
20.2 Mode resolution rule
if match.status == scheduled:
    mode = scheduled
elif match.status == live:
    mode = live
elif match.status == finished:
    mode = finished
else:
    mode = unknown
20.3 Radar independence rule
radar affects highlighting only
radar does not affect prediction module lifecycle
21. Component Contract
Recommended component name
PredictionDetailModule

Required props
Prop	Type	Required	Description
matchStatus	string	yes	Match lifecycle state
prediction	object	yes if module rendered	Structured prediction
predictionOutcome	object/null	no	Evaluated outcome
homeTeamName	string	yes	Home team label
awayTeamName	string	yes	Away team label
finalScoreHome	number/null	no	Final home score
finalScoreAway	number/null	no	Final away score
Derived UI values
The component must derive:

module mode

badge label

whether actual result should be shown

whether verdict should be shown

22. Backend / Domain Requirements
The backend or domain layer must expose enough data for post-match evaluation.

At minimum, the match detail payload must support:

structured prediction

match final score

outcome evaluation status or enough fields to compute it

evaluated timestamp if available

If evaluation is not precomputed backend-side, the frontend may compute verdict only if deterministic inputs are already present and stable.

Recommended priority:

backend computes outcome status

frontend renders result only

This avoids duplicated evaluation logic across clients.

23. Persistence Rule
If the application persists prediction data, it must persist the structured prediction needed for post-match evaluation.

Do not persist only narrative prose if the product expects verdict computation.

Structured prediction persistence is mandatory for evaluable prediction types.

24. Copy Rules
User-facing labels must remain short and clear.

Allowed status labels
Pendiente

En juego

Acertado

Fallado

Parcial

No evaluable

Sin evaluación

Disallowed style patterns
Do not use:

celebratory phrases

mocking tone

noisy commentary

editorial judgment

model self-praise

exaggerated confidence wording in the verdict line

This module is factual, not theatrical.

25. Non-Goals
The implementation must not:

make this behavior radar-only

create separate modules for radar and non-radar detail views

hide the prediction module after match completion

evaluate unsupported free-text predictions as if they were structured

introduce large visual effects

inject animations that compete with the match header

change existing prediction generation logic in this task unless strictly required for structured persistence

26. Acceptance Criteria
The implementation is accepted only if all conditions below are satisfied.

AC-01
If a match has prediction data and is scheduled, the match detail view displays the prediction module.

AC-02
If a match has prediction data and is live, the match detail view displays the prediction module.

AC-03
If a match has prediction data and is finished, the match detail view still displays the prediction module.

AC-04
In finished state, the module displays the predicted outcome and the final actual result.

AC-05
In finished state, the module displays a verdict badge using one of the allowed verdict labels.

AC-06
This behavior applies equally to radar and non-radar matches.

AC-07
Radar status does not control module visibility in match detail.

AC-08
If no prediction exists, the system does not fabricate one.

AC-09
If a prediction is not evaluable, the module shows No evaluable rather than inferring a verdict.

AC-10
Supported prediction types are evaluated deterministically according to the rules in this specification.

AC-11
The module remains in the same logical UI location before and after match completion.

AC-12
The module uses a discrete visual treatment and does not introduce intrusive styling.

27. QA Test Matrix
Test ID	Scenario	Expected Result
QA-01	Scheduled match with prediction	Module visible, predicted outcome shown, badge = Pendiente
QA-02	Live match with prediction	Module visible, predicted outcome shown, badge = En juego
QA-03	Finished match with winner prediction that was correct	Module visible, final result shown, verdict = Acertado
QA-04	Finished match with winner prediction that failed	Module visible, final result shown, verdict = Fallado
QA-05	Finished match with both teams score prediction	Verdict matches actual scoring pattern
QA-06	Finished match with over/under prediction	Verdict matches total goals threshold logic
QA-07	Finished match with exact score prediction	Verdict = Acertado only on exact score match
QA-08	Finished match with unsupported prediction type	Verdict = No evaluable
QA-09	Radar match with prediction	Same lifecycle behavior as non-radar match
QA-10	Non-radar match with prediction	Same lifecycle behavior as radar match
QA-11	Match without prediction	Module not rendered
QA-12	Finished match opened from any entry point	Module behavior remains identical
28. Implementation Constraints
The implementation must respect the following constraints:

must apply to all matches with prediction data

must not special-case radar for module lifecycle

must preserve match detail consistency

must use structured prediction data for evaluable modes

must support pre-match, live, and post-match rendering

must keep visual behavior discrete

must avoid duplicated business logic across multiple UI components

29. Recommended Implementation Strategy
Frontend
reuse existing prediction module area in match detail

convert it into a mode-aware component

add finished-state result/verdict rendering

keep styles compact and consistent

Backend
ensure structured prediction data is present in match detail payload

expose prediction outcome or expose enough data to compute it reliably

do not depend on radar to decide availability

QA
validate state transitions

validate evaluation correctness by prediction type

validate parity between radar and non-radar matches

30. Final Directive
The prediction module in match detail must behave as a persistent lifecycle-aware component for any match with prediction data.

The required behavior is:

if prediction exists:
    show prediction before match
    show prediction during live match
    show prediction + actual result + verdict after match
Radar status must not change this behavior.

No deviation from this rule is allowed in this version.
```

