---
egm: review
status: resolved
hash: e47f4ca5cedc7b03508cb7b6c4c6f6d5aaad8b2b954aba3d26508d0f86d33b8e
---
# Review: tasks-contract (EGM stage 7)

Status: triaged; all findings addressed or withdrawn.

## Blockers
- JavaScript `\b` does not treat "ú" as a word character, so "ejecuta tú" can never match; use Unicode lookarounds with the `u` flag.
- No Alternatives section (manual.md vs a marker in tasks.md, block vs warn, constants vs manifest).

## Major
- v2 prints its own final report (`executeV2`), so manual steps would only be listed in v1.
- False positives: "in the console", "the user must/should", "deploy to" hit legitimate tasks and block the whole run; narrow the phrases or document an escape.
- The human-task exemption must test the raw block (spans kept), as the runner does; otherwise "run `git push`" becomes a finding.
- manual.md format underspecified: list markers other than `- `, both rules on one step, `Check:` form rules, parse result for missing check.
- "The same span regex" does not exist as a constant; name a new `CODE_SPAN` constant.
- The preflight header says "tasks.md failed lint-tasks" even for manual.md findings.
- The delta changes behavior fixed by three existing requirements (subcommand scope, output format, preflight) without MODIFIED entries.
- Code-span scenario does not test span removal (no phrase inside the span).
- Docs task verify cannot observe the docs.

## Nits
- Exit code wording (lint-tasks exits 1, preflight stops fatal); inflections/plurals; proposal says two requirements, there are five.

## Stage 9 (implementation readiness, codebase details, style)

Findings were applied to the artifacts on 2026-11-17. Main points:
- Regression-guard tests are exempt from the red-first rule; behavior-changing tests must fail first.
- Every subcommand or flag is documented in the same task that adds it (docs-parity test), and the last code task runs the whole suite.
- Verify lines use only commands the harness runs (`bun ...`); doc content checks use `bun -e`, not grep.
- Exact literals, fixtures and helper names are given in design.md and tasks.md; ESLint rules (no magic numbers, explicit return types) are stated.

## Triage resolution

- Stage 7 decisions taken by the author on 2026-11-17: v1 only (v2 is being deprecated); read-only investigation with a declared AWS profile and MCP read verbs; manifest with `profile` and `hosts`; doctor runs project checks only with `--run-project-checks`; manifest validated loosely during runs; explore runs propose inline; narrowed manual-step phrases.
- Decision "checkbox plus checks for tasks without Verify" was withdrawn: the preflight lint already rejects such tasks, so the case cannot occur in real runs.
- All remaining findings were addressed in the artifacts; none were declined.
