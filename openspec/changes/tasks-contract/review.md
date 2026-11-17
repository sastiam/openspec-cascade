---
egm: review
status: open
hash: 7d05c9dd7fdcd53956cba91613cfeab184c6a0bd79cd4c25ebca9c7d78e3f4a0
---
# Review: tasks-contract (EGM stage 7)

Status: findings open, pending triage.

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
