\# UNIVERSAL\_CASE\_INTAKE\_PROTOCOL.md

Version: 2.0  
Status: Reusable  
Scope: Structured intake, triage, and output-selection protocol for software requests in any Claude project  
Audience: Claude project instructions, implementation agents, repo-level guidance

\---

\# 1\. Purpose

This specification defines a universal intake and triage protocol for software work.

The protocol exists to reduce ambiguity before diagnosis, specification, planning, or implementation.

It must be reusable across different projects and repositories.

Its goals are to ensure that requests are:  
\- classified correctly  
\- anchored to the current project context  
\- clarified with minimal but sufficient questions  
\- summarized before action  
\- handled without weak assumptions  
\- incorporated into the current project instead of being solved abstractly  
\- routed to the output the user actually wants

\---

\# 2\. Trigger

The protocol is activated when the user starts a message with:

\`/caso\`

Examples:  
\- \`/caso\`  
\- \`/caso score final no aparece\`  
\- \`/caso quiero cambiar badges de estado\`  
\- \`/caso esta pantalla se siente rota\`

When this trigger appears, the assistant must enter guided intake mode.

It must not jump directly into solution mode.

If the user writes a long explanation immediately after \`/caso\`, that text must be treated as preliminary context only. The intake flow must still begin at Step 1\.

\---

\# 3\. Core Principle

Every case must be interpreted inside the current project context.

The assistant must assume that the case belongs to the active project unless the user explicitly says otherwise.

The assistant must incorporate the case into the current project by considering:  
\- the current repository or codebase  
\- the current architecture  
\- naming conventions  
\- domain concepts  
\- existing modules and components  
\- current UX/UI patterns  
\- existing APIs and data flows  
\- implementation constraints already present in the project

The assistant must not solve the case as a generic abstract exercise if it belongs to a real project.

\---

\# 4\. Mandatory Intake Sequence

\#\# Step 1 — Request Type

The assistant must always ask the user to choose one request type:

1\. Bug  
2\. Change  
3\. Feature  
4\. Review

Definitions:  
\- Bug \= something existing behaves incorrectly  
\- Change \= something existing behaves correctly but should be modified  
\- Feature \= something new that does not exist yet  
\- Review \= diagnosis is needed before deciding what to do

This step must never be skipped.

\---

\#\# Step 2 — Project Anchoring

Before deeper intake, the assistant must anchor the case to the current project.

The assistant must identify, infer, or ask for the smallest possible clarification regarding:  
\- which project/repo/module the case belongs to  
\- where in the project the issue/change/feature appears  
\- whether the affected area is likely frontend, backend, shared, infra, or unknown

If the user does not know whether the issue is frontend or backend, the assistant must infer it from symptoms instead of forcing the user to decide.

\---

\#\# Step 3 — Common Intake Fields

The assistant must gather these common fields:  
\- title  
\- request type  
\- location  
\- affected area  
\- problem or need  
\- expected behavior  
\- actual behavior or desired change  
\- available evidence  
\- impact level  
\- uncertainty or open questions

\---

\#\# Step 4 — Desired Output

After the core intake is sufficiently clear, the assistant must determine the desired output.

If the desired output is already explicit in the user request, the assistant must reuse it and must not ask again.

If it is not explicit, the assistant must ask the user to choose one primary output:

1\. Diagnosis  
2\. Spec  
3\. Fix Plan  
4\. Implementation Guidance  
5\. Code Patch Proposal  
6\. Agent Prompt  
7\. QA Checklist  
8\. Test Cases  
9\. Documentation Update  
10\. Help Me Choose

The assistant may accept optional secondary outputs, but it must always identify one primary output.

The assistant must not proceed into solution mode without knowing or reasonably inferring the intended output.

\---

\# 5\. Request-Type Routes

\#\# 5.1 Bug Route

Ask for:

1\. Where the issue appears:  
   \- screen / UI  
   \- component  
   \- flow  
   \- module  
   \- API  
   \- data / database  
   \- infrastructure  
   \- unknown

2\. Issue type:  
   \- visual  
   \- functional  
   \- incorrect data  
   \- inconsistent state  
   \- performance  
   \- integration / API  
   \- console / log error  
   \- unknown

3\. Reproduction steps

4\. Expected behavior

5\. Actual behavior

6\. Frequency:  
   \- always  
   \- intermittent  
   \- happened once  
   \- unknown

7\. Since when:  
   \- always existed  
   \- after a recent change  
   \- unknown

8\. Evidence available:  
   \- screenshot  
   \- video  
   \- logs  
   \- stack trace  
   \- API response  
   \- none

\---

\#\# 5.2 Change Route

Ask for:

1\. What part should change:  
   \- screen  
   \- component  
   \- flow  
   \- endpoint  
   \- data model  
   \- copy / text  
   \- visual style  
   \- standardization  
   \- unknown

2\. How it works today

3\. What should change exactly

4\. What must remain untouched

5\. Change type:  
   \- visual  
   \- functional  
   \- both  
   \- unknown

6\. Scope:  
   \- one area  
   \- multiple areas  
   \- unknown

7\. Priority:  
   \- low  
   \- medium  
   \- high  
   \- critical

\---

\#\# 5.3 Feature Route

Ask for:

1\. What should be added

2\. Why it is needed

3\. Where it should live:  
   \- new screen  
   \- existing screen  
   \- backend / service  
   \- internal process  
   \- unknown

4\. Who uses it:  
   \- end user  
   \- admin / operator  
   \- system / internal  
   \- unknown

5\. Inputs

6\. Expected outputs / results

7\. Whether something similar already exists:  
   \- yes  
   \- no  
   \- unknown

8\. Constraints:  
   \- visual  
   \- technical  
   \- performance  
   \- security  
   \- none  
   \- unknown

\---

\#\# 5.4 Review Route

Ask for:

1\. What was observed

2\. Where it was observed

3\. What is concerning

4\. What outcome is wanted:  
   \- diagnosis  
   \- spec  
   \- fix plan  
   \- implementation guidance

5\. Evidence available:  
   \- screenshot  
   \- video  
   \- logs  
   \- stack trace  
   \- API response  
   \- none

6\. Impact:  
   \- low  
   \- medium  
   \- high  
   \- critical  
   \- unknown

\---

\# 6\. Controlled Tags

After intake, the assistant must assign tags from these controlled sets only.

\#\# Type tags  
\- visual  
\- functional  
\- data  
\- api  
\- performance  
\- state  
\- navigation  
\- copy  
\- accessibility  
\- security  
\- refactor  
\- standardization

\#\# Scope tags  
\- frontend  
\- backend  
\- shared  
\- infra  
\- unknown

\#\# Impact tags  
\- low  
\- medium  
\- high  
\- critical  
\- unknown

\#\# Risk tags  
\- regression-risk  
\- ui-risk  
\- data-risk  
\- scope-risk  
\- unknown-risk

\---

\# 7\. Controlled Output Modes

The assistant must use only these output modes as the primary requested deliverable.

\#\# Output modes  
\- diagnosis  
\- spec  
\- fix-plan  
\- implementation-guidance  
\- code-patch-proposal  
\- agent-prompt  
\- qa-checklist  
\- test-cases  
\- documentation-update  
\- help-me-choose

\#\# Output mode definitions

\#\#\# diagnosis  
Use when the user wants to understand the issue, root cause, scope, or likely source before deciding what to do.

\#\#\# spec  
Use when the user wants a structured implementation-ready specification.

\#\#\# fix-plan  
Use when the user wants a tactical plan to correct or modify something with steps, risks, dependencies, and sequencing.

\#\#\# implementation-guidance  
Use when the user wants concrete guidance to implement the change in the current project, but not necessarily a literal patch.

\#\#\# code-patch-proposal  
Use when the user wants concrete proposed code changes, patch structure, or implementation-level modifications.

\#\#\# agent-prompt  
Use when the user wants a prompt that can be given to Claude or another coding agent to execute the task.

\#\#\# qa-checklist  
Use when the user wants a validation checklist for manual or semi-structured QA.

\#\#\# test-cases  
Use when the user wants functional, integration, or technical test cases.

\#\#\# documentation-update  
Use when the user wants project documentation text, changelog text, internal notes, or implementation documentation.

\#\#\# help-me-choose  
Use when the user does not know which deliverable is most useful. In that case, the assistant must recommend the most appropriate primary output based on the case.

\---

\# 8\. Mandatory Output Before Any Action

Before proposing diagnosis, spec, plan, implementation guidance, code patch proposal, agent prompt, QA checklist, test cases, or documentation update, the assistant must always output:

\#\# Intake Summary  
\*\*Project:\*\* \[...\]  
\*\*Title:\*\* \[...\]  
\*\*Request type:\*\* BUG | CHANGE | FEATURE | REVIEW  
\*\*Area:\*\* frontend | backend | shared | infra | unknown  
\*\*Location:\*\* \[...\]  
\*\*Problem/Need:\*\* \[...\]  
\*\*Expected behavior:\*\* \[...\]  
\*\*Actual behavior / Desired change:\*\* \[...\]  
\*\*Evidence provided:\*\* \[...\]  
\*\*Tags:\*\* \[...\]  
\*\*Impact:\*\* low | medium | high | critical | unknown  
\*\*Risks:\*\* \[...\]  
\*\*Requested output:\*\* diagnosis | spec | fix-plan | implementation-guidance | code-patch-proposal | agent-prompt | qa-checklist | test-cases | documentation-update | help-me-choose  
\*\*Secondary outputs:\*\* \[...\]  
\*\*Open questions:\*\* \[...\]

This summary is mandatory.

The assistant must not skip it.

\---

\# 9\. Allowed Next Step After Intake Summary

After the Intake Summary, the assistant must produce the section that matches the selected primary output.

Allowed section headers:  
\- \`\#\# Next Questions\`  
\- \`\#\# Diagnosis\`  
\- \`\#\# Proposed Spec\`  
\- \`\#\# Proposed Fix Plan\`  
\- \`\#\# Implementation Guidance\`  
\- \`\#\# Code Patch Proposal\`  
\- \`\#\# Agent Prompt\`  
\- \`\#\# QA Checklist\`  
\- \`\#\# Test Cases\`  
\- \`\#\# Documentation Update\`  
\- \`\#\# Recommended Output\`

The assistant must not produce a mismatched section.

If the user selected \`help-me-choose\`, the assistant must:  
1\. recommend the best primary output  
2\. explain briefly why  
3\. then provide that output

\---

\# 10\. Project Incorporation Rule

This protocol is not purely descriptive.

Once a case is understood, the assistant must treat it as work to be incorporated into the current project.

That means any diagnosis, spec, plan, or implementation guidance must be framed in terms of:  
\- the current project structure  
\- the current module or feature boundaries  
\- the current codebase conventions  
\- the current domain language  
\- the current technical constraints

If the current project context is missing, the assistant must say so explicitly and ask only the minimum clarification needed.

It must not silently generalize.

\---

\# 11\. Anti-Patterns

The assistant must not:  
1\. Jump directly to implementation after \`/caso\`  
2\. Pretend unclear cases are clear  
3\. Force the user to decide technical boundaries they cannot know  
4\. Use uncontrolled or infinite tag vocabularies  
5\. Ignore the active project context  
6\. Rewrite the case in abstract terms that disconnect it from the real project  
7\. Ask long, bloated, repetitive questionnaires  
8\. Produce a deliverable different from the user’s intended output  
9\. Ask for the desired output again if it is already explicit  
10\. Treat a project-specific issue as a context-free exercise

\---

\# 12\. Efficiency Rules

The wizard must be efficient.

\- Prefer short structured questions  
\- Prefer numbered options  
\- Reuse title/context already provided by the user  
\- Ask only the minimum required to reduce ambiguity  
\- Stop asking when there is enough information for a reliable Intake Summary  
\- Do not ask the user things that can be inferred from the project context or from already provided symptoms

\---

\# 13\. Completion Standard

This protocol is considered correctly executed only if:  
1\. The request type was explicitly chosen  
2\. The case was anchored to the current project  
3\. Ambiguity was reduced through structured intake  
4\. The desired output was explicitly chosen or reliably inferred  
5\. An Intake Summary was produced  
6\. The next step matched the selected output  
7\. No implementation was proposed from weak assumptions  
