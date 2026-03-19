# /governance — SportsPulse Governance Wizard

When this skill is invoked, run a full governance audit in exactly 3 phases. Do not skip or reorder phases.

---

## PHASE 1 — AUDIT (collect all findings, no corrections yet)

Run ALL checks in parallel where possible. Do not report findings or make corrections until every check is complete.

### Bloque A — Calidad de código

**D1 — Tests**
Run: `pnpm -r test 2>&1 | tail -20`
Finding if: any test failures. Record: which packages, how many tests, file names.

**D11 — Build**
Run: `pnpm build 2>&1 | tail -20`
Finding if: any compilation errors.

**D12 — Server typecheck**
Run: `pnpm tsc --noEmit --project tsconfig.server.typecheck.json 2>&1 | tail -20`
Finding if: any type errors.

**D13 — Forbidden imports**
Run:
- `grep -r "from '@sportpulse/scoring\|from '@sportpulse/layout\|from '@sportpulse/signals\|from '@sportpulse/canonical" packages/web/src/ 2>/dev/null`
- `grep -r "from '@sportpulse/canonical\|from '@sportpulse/signals\|from '@sportpulse/scoring\|from '@sportpulse/layout" packages/api/src/ 2>/dev/null`
Finding if: any matches found. Record exact file:line locations.

### Bloque B — Estado del repositorio

**D9 — Cambios sin commit + tests rotos**
Run: `git status --short`
Finding if: there are modified/untracked files AND D1 also failed.

**D16 — Version bump gates**
Run: `git diff HEAD~5 -- packages/scoring/src packages/layout/src 2>/dev/null | grep -E "^\+" | grep -E "policyVersion|layoutAlgorithmVersion|snapshotSchemaVersion|BREAKING|semantic" | head -20`
Also check: `grep -r "policyVersion\|layoutAlgorithmVersion\|snapshotSchemaVersion" packages/scoring/src packages/layout/src packages/snapshot/src 2>/dev/null | head -10`
Finding if: recent commits touch scoring/layout semantics but no version bump visible.

**D17 — Dockerfile parity**
Run: `ls packages/ && grep "COPY packages/" Dockerfile 2>/dev/null`
Finding if: a package dir exists in `packages/` but has no `COPY packages/<name>` line in Dockerfile.

**D18 — Env parity**
Run: `grep -E "requireEnv|assertEnv|process\.env\." server/env-validator.ts 2>/dev/null | grep -oE '[A-Z_]{3,}' | sort -u`
Also: `grep -oE '^[A-Z_]+=?' .env.production.example 2>/dev/null | grep -oE '^[A-Z_]+' | sort -u`
Finding if: vars in env-validator not in .env.production.example.

### Bloque C — Gobernanza documental

**D3 — PLAN-INDEX coherencia**
Read: `memory/plans/PLAN-INDEX.md` and list all `memory/plans/*.md` files.
Finding if: any .md plan file exists but is not mentioned in PLAN-INDEX.md, or any plan shows a stale/incorrect status.

**D19 — Spec coverage de fases implementadas**
Read: `memory/plans/PLAN-INDEX.md`. Find all phases marked ✅ DONE that are Phase 11 or newer (post-MVP core: SP-PRED-V3, NEXUS, Liga MX, Back Office, SP-COMP-MODES, SP-GOVERNANCE-SKILL, etc.).
For each done phase, check if PLAN-INDEX.md has a `- Spec:` reference pointing to a file in `docs/specs/` or `docs/architecture/`.
Also run: `ls docs/specs/**/*.md docs/specs/*.md docs/architecture/*.md 2>/dev/null`
Finding if: any post-Phase-10 done phase has no corresponding spec file referenced in PLAN-INDEX.md AND no file in docs/specs/ or docs/architecture/ covers that feature by name/keyword.
Severity: MEDIUM
Auto-fix: git-ops creates the missing spec from the plan content.
Note: Phases 0–10 (MVP core) are covered by the original spec suite — no new spec needed for those.

**D7 — Findings OPEN en último governance audit**
Glob: most recent `memory/governance-audit-*.md` file.
Read it and find any findings marked as OPEN without a corresponding task.
Finding if: OPEN findings exist.

**D6 — PE audit freshness**
Run: `ls -t docs/audits/PE-audit-*.md 2>/dev/null | head -1`
Check if `packages/prediction/` has commits in last 7 days: `git log --oneline --since="7 days ago" -- packages/prediction/ 2>/dev/null | head -5`
Finding if: there is recent prediction work but the last PE audit is >7 days ago.

**D10 — Audit del día**
Check if `memory/governance-audit-YYYY-MM-DD.md` exists for today's date.
Finding: always note whether it exists (will be created at end regardless).

### Bloque D — Gobernanza operacional

**D5 — Git hook activo**
Read: `.claude/settings.json`
Finding if: no PreToolUse hook with Bash matcher that blocks `git commit` and `git push`.

**D4 — Tasks sin metadata**
Run TaskList tool.
Finding if: any task lacks `metadata.tier` or `metadata.agent`.

**D14 — Stale tasks**
Run TaskList tool (same result as D4).
Finding if: any task is in `in_progress` or `pending` status that appears to be completed work.

### Bloque E — Salud de memoria

**D2 — MEMORY.md tamaño**
Run: `wc -l /Users/andres/.claude/projects/-Users-andres-Documents-04-Flux-SportsPulse/memory/MEMORY.md`
Finding if: ≥185 lines (MEDIUM) or ≥200 lines (HIGH).

**D8 — Feedback orphans**
Glob: `memory/feedback_*.md` files.
Read: MEMORY.md
Finding if: any feedback_*.md file not referenced in MEMORY.md.

**D15 — Memory orphans**
Glob: all `memory/*.md` files (excluding MEMORY.md itself).
Read: MEMORY.md
Finding if: any memory file not referenced in MEMORY.md.

---

## PHASE 2 — REPORT

After ALL checks complete, output the full report in this exact format:

```
## Governance Audit — [TODAY'S DATE]

### Hallazgos ([N] total)

[list each finding with icon + severity + domain + description]
❌ [HIGH]   D[N] — [description]
⚠️ [MEDIUM] D[N] — [description]
ℹ️ [LOW]    D[N] — [description]

Si no hay hallazgos: "✅ Sin hallazgos — gobernanza conforme."

### Correcciones propuestas

[numbered list of proposed fixes, one per finding that has an auto-fix]
[for findings with no auto-fix, show them as ⚠️ requiere intervención manual]

[N] correcciones automáticas disponibles. [M] requieren intervención manual.

¿Aplicar todas las correcciones automáticas? (s/n)
```

Wait for the user's response before proceeding to Phase 3.

---

## PHASE 3 — FIX

Only execute after user confirms with "s", "si", "sí", or "yes".

Apply all auto-fix corrections in order: HIGH findings first, then MEDIUM, then LOW.

### Correction routing (MANDATORY — use correct agent for each fix)

| Finding | Agent | Action |
|---------|-------|--------|
| D1 — tests rotos en packages/web | frontend-engineer | Fix failing tests to match current component behavior |
| D1 — tests rotos en packages/api or backend | backend-engineer | Fix failing tests |
| D11/D12 — build/typecheck errors | backend-engineer | Diagnose and fix |
| D13 — forbidden imports | frontend-engineer (web) or backend-engineer (api) | Remove forbidden import |
| D3 — PLAN-INDEX stale | git-ops | Update PLAN-INDEX.md |
| D4 — tasks sin metadata | main instance | TaskUpdate with inferred tier/agent |
| D5 — git hook ausente | Show exact JSON to add to .claude/settings.json — do NOT auto-edit, ask user to confirm |
| D7 — findings OPEN sin task | main instance | TaskCreate for each OPEN finding |
| D8/D15 — memory orphans | git-ops | Add references to MEMORY.md |
| D17 — Dockerfile parity | git-ops | Show lines to add — do NOT auto-edit production files, show and confirm |
| D18 — env parity | git-ops | Show lines to add to .env.production.example |
| D19 — spec coverage faltante | git-ops | Create missing spec in docs/specs/ from plan content |

### After all corrections

Always — regardless of whether corrections were applied or skipped — save the audit result:

Create `memory/governance-audit-[TODAY'S DATE].md` with:
- Full findings table (ID, severity, description, status: FIXED/OPEN/MANUAL)
- Corrections applied
- Corrections skipped or manual
- Final verdict: CONFORME / PARCIALMENTE_CONFORME / NO_CONFORME

Then update `memory/MEMORY.md` to reference the new audit file in the Gobernanza section.

End with the agent declaration line:
`Agente: Claude Code (Sonnet) | Tokens: ~Xk / ~Xk`

---

## Severity definitions

- ❌ HIGH — blocks deployment or breaks tests/build
- ⚠️ MEDIUM — technical/documentary debt, not immediately breaking
- ℹ️ LOW — hygiene issues, low urgency

## Important rules

- NEVER correct anything before showing the full report and receiving confirmation
- NEVER skip Phase 1 — all 19 checks must run before reporting
- NEVER commit or push as part of corrections (git discipline rule)
- ALWAYS save the audit file at the end, even if no corrections were made
- Parallelize Phase 1 checks wherever possible (independent checks run together)
