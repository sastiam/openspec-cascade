# Proposal

## Why

`tasks.md` often asks for steps the agent cannot do, for example "deploy to staging", "the user must run this" or "verify manually in the console". In unattended runs these tasks either loop until they run out of attempts or get checked off without any real verification. Work that a human really has to do (deploy, approve, a console setting) has no place in the change, so it is mixed into `tasks.md` or forgotten. Roadmap piece 4 already covered code blocks and missing `Verify:` lines (`lint-tasks`). Two parts were still open: manual steps, and `manual.md`.

## What Changes

- New `lint-tasks` rule `manual-step`. An unchecked task whose text asks for a human or manual action is a finding. Phrases are matched in English and Spanish ("manually", "by hand", "the user must run", "ask the user", "deploy to staging", "check in the console", "manualmente", "a mano", "el usuario debe", "ejecuta tú"…), case-insensitively, as whole phrases with Unicode-aware boundaries. Text inside backtick spans is ignored; this is the documented escape hatch. Tasks that cascade already skips as human tasks ("open the PR", "git push", "decide the delivery") are not findings, so existing changes keep working.
- New optional file `openspec/changes/<change>/manual.md`. It lists the steps a human does as top-level list items, each with an indented `Check:` line that says how to confirm the step read-only. It has no checkboxes, so OpenSpec does not count it as tasks. `lint-tasks` and the preflight also check `manual.md` when it exists:
  - a checkbox is a finding (`manual-checkbox`);
  - a step without a `Check:` line is a finding (`missing-check`).
- The preflight fatal header becomes the neutral `lint-tasks failed; fix these findings before running:`, since findings can now come from either file.
- At the end of a v1 run, the final report lists each change's manual steps with their checks, one `  manual: <step> — check: <check>` line per step. This version only lists them; nothing runs them. The v2 pipeline is being deprecated and its report is out of scope.
- Docs: `docs/cli.md` describes the rule, the backtick escape and `manual.md`; the `README.md` "Human tasks" bullet gains one sentence on `manual.md` and the `manual-step` rule.

## Capabilities

### New Capabilities

None.

### Modified Capabilities
- `tasks-lint`: five new requirements (manual steps in `tasks.md` are findings; the phrase list; `manual.md` steps need a `Check:` line; `manual.md` has no checkboxes; manual steps are listed at the end of a v1 run). Three existing requirements are modified to cover `manual.md`: "lint-tasks subcommand", "lint-tasks output and exit codes" and "Preflight before any engine session".

## Impact

- Code: `src/sdd/tasks_lint.ts` (new rule; `lintManual`, `parseManualSteps`; `formatFinding` file-name parameter), `src/config/constants.ts` (`TASKS_LINT_CONSTANTS`: rule names, messages, `CODE_SPAN`, phrase patterns, `manual.md` line patterns, renamed `FATAL_HEADER`), `src/cli/lint_tasks.ts` and `lintChanges` in `src/facade/cascade_facade.ts` (also read `manual.md`, through a new private `manualPath` in the facade), the v1 final report in `CascadeFacade.execute`.
- Behavior: `lint-tasks` exits 1 when `tasks.md` or `manual.md` has findings. The preflight stops the run with a fatal error (exit 2) when a listed change's open tasks contain manual phrasing or its `manual.md` breaks a rule, in v1 and v2, like code blocks today. Checked tasks are never linted, so finished changes are unaffected.
- Rollout: open changes with manual phrasing will fail preflight after merge. Run `lint-tasks` over the open changes before merging. Known case: task 5.1 of `run-outcome` says "manual steps" in bare prose; this change puts the phrase in backticks.
- Tests: `test/sdd/tasks_lint.test.ts`, `test/cli/lint_tasks.test.ts`, `test/facade/cascade_facade.test.ts`.
- No security or scalability impact: local markdown parsing only.
