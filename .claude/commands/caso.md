Universal Case Intake Protocol

When this command is invoked, enter guided intake mode.

Your first responsibility is not solving the issue.
Your first responsibility is classifying and anchoring the case correctly.

Core activation rule:
- Do not skip the wizard.
- Do not jump directly into diagnosis or implementation.
- If the user provides a long explanation immediately after invoking this command, treat it as preliminary context only and still run the wizard from Step 1.

Step 1 — Request Type
Always ask the user to choose exactly one:
1. Bug
2. Change
3. Feature
4. Review

Definitions:
- Bug = something existing behaves incorrectly
- Change = something existing behaves correctly but should be modified
- Feature = something new that does not exist yet
- Review = diagnosis is needed before deciding what to do

Step 2 — Project anchoring
You must treat the case as belonging to the current project unless the user explicitly says otherwise.

You must anchor the case to the current project by identifying or inferring:
- the project/repo/module involved
- the likely affected area
- the likely scope: frontend, backend, shared, infra, or unknown
- the relevant project conventions, domain concepts, and constraints

Do not solve the case as a generic abstract request if it belongs to an active project.

If the user does not know whether it is frontend or backend, infer it from symptoms instead of forcing them to decide.

Step 3 — Follow the route based on request type

For BUG ask:
- where the issue appears
- issue type
- reproduction steps
- expected behavior
- actual behavior
- frequency
- since when
- available evidence

For CHANGE ask:
- what part should change
- how it works today
- what should change exactly
- what must remain untouched
- whether the change is visual, functional, or both
- scope
- priority

For FEATURE ask:
- what should be added
- why it is needed
- where it should live
- who uses it
- inputs
- expected outputs
- whether something similar already exists
- constraints

For REVIEW ask:
- what was observed
- where it was observed
- what is concerning
- what outcome is wanted
- available evidence
- impact

Use compact structured questions.
Prefer numbered or closed options whenever possible.
Ask only the minimum required to reduce ambiguity.

Step 4 — Desired output

After the intake is sufficiently clear, determine the desired output.

If the desired output is already obvious from the user's message, reuse it and do not ask again.

If it is not obvious, ask the user to choose one primary output:
1. Diagnosis
2. Spec
3. Fix Plan
4. Implementation Guidance
5. Code Patch Proposal
6. Agent Prompt
7. QA Checklist
8. Test Cases
9. Documentation Update
10. Help Me Choose

You may accept optional secondary outputs, but there must always be one primary output.

Controlled tags only

Type tags:
- visual
- functional
- data
- api
- performance
- state
- navigation
- copy
- accessibility
- security
- refactor
- standardization

Scope tags:
- frontend
- backend
- shared
- infra
- unknown

Impact tags:
- low
- medium
- high
- critical
- unknown

Risk tags:
- regression-risk
- ui-risk
- data-risk
- scope-risk
- unknown-risk

Controlled output modes

Use only these output modes:
- diagnosis
- spec
- fix-plan
- implementation-guidance
- code-patch-proposal
- agent-prompt
- qa-checklist
- test-cases
- documentation-update
- help-me-choose

If the user chooses help-me-choose, recommend the most appropriate output based on the case and then provide it.

Mandatory output before any action

Before diagnosis, spec, fix plan, implementation guidance, code patch proposal, agent prompt, QA checklist, test cases, or documentation update, always output:

## Intake Summary
**Project:** [...]
**Title:** [...]
**Request type:** BUG | CHANGE | FEATURE | REVIEW
**Area:** frontend | backend | shared | infra | unknown
**Location:** [...]
**Problem/Need:** [...]
**Expected behavior:** [...]
**Actual behavior / Desired change:** [...]
**Evidence provided:** [...]
**Tags:** [...]
**Impact:** low | medium | high | critical | unknown
**Risks:** [...]
**Requested output:** diagnosis | spec | fix-plan | implementation-guidance | code-patch-proposal | agent-prompt | qa-checklist | test-cases | documentation-update | help-me-choose
**Secondary outputs:** [...]
**Open questions:** [...]

After that, output exactly one matching section:
- ## Next Questions
- ## Diagnosis
- ## Proposed Spec
- ## Proposed Fix Plan
- ## Implementation Guidance
- ## Code Patch Proposal
- ## Agent Prompt
- ## QA Checklist
- ## Test Cases
- ## Documentation Update
- ## Recommended Output

Never output a section that does not match the selected primary output.

Critical project rule:
Everything after intake must be incorporated into the current project context.
This means:
- use the current project structure
- use the current domain language
- use the current architecture and constraints
- avoid generic abstract recommendations when the case belongs to a real project

If the project context is missing, say so explicitly and ask only the minimum clarification needed.

Never:
- skip request-type selection
- skip project anchoring
- skip output selection or inference
- implement from weak assumptions
- ask bloated repetitive questionnaires
- treat a project-specific issue as a context-free exercise
- produce a different deliverable than the one the user asked for
