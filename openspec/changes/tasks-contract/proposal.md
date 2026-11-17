# Proposal

## Why

`tasks.md` often asks for steps the agent cannot do, for example "deploy to staging", "the user must run this" or "verify manually in the console". In unattended runs these tasks either loop until they run out of attempts or get checked off without any real verification. Work that a human really has to do (deploy, approve, a console setting) has no place in the change, so it is mixed into `tasks.md` or forgotten. Roadmap piece 4 already covered code blocks and missing `Verify:` lines (`lint-tasks`). Two parts were still open: manual steps, and `manual.md`.

## What Changes

- New `lint-tasks` rule `manual-step`. An unchecked task whose text asks for a human or manual action is a finding. Phrases are matched in English and Spanish ("manually", "by hand", "the user must", "ask the user", "deploy to", "manualmente", "a mano", "el usuario debe", "despliega en"…). Text inside backtick spans is ignored. The three phrases cascade already skips as human tasks ("open the PR", "git push", "decide the delivery") are not findings, so existing changes keep working.
- New optional file `openspec/changes/<change>/manual.md`. It lists the steps a human does, each with an indented `Check:` line that says how to confirm the step read-only. It has no checkboxes, so OpenSpec does not count it as tasks. `lint-tasks` also checks `manual.md` when it exists:
  - a checkbox is a finding (`manual-checkbox`);
  - a step without a `Check:` line is a finding (`missing-check`).
- At the end of a run, the final report lists each change's manual steps with their checks. This version only lists them; nothing runs them.
- Docs: `docs/cli.md` and `README.md` describe the rule and `manual.md`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities
- `tasks-lint`: two new requirements. Manual steps in `tasks.md` are findings. `manual.md` is linted when present.

## Impact

- Code: `src/sdd/tasks_lint.ts` (new rule; `manual.md` lint), `src/config/constants.ts` (`TASKS_LINT_CONSTANTS`: rule names, messages, phrase list), `src/cli/lint_tasks.ts` and `lintChanges` in `src/facade/cascade_facade.ts` (also read `manual.md`), the final report in `CascadeFacade.execute`.
- Behavior: a change whose unchecked tasks contain manual phrasing now fails preflight with exit 2, like code blocks today. Checked tasks are never linted, so finished changes are unaffected.
- Tests: `test/sdd/tasks_lint.test.ts` (or the existing tasks-lint test file), `test/cli/lint_tasks.test.ts`, `test/facade/cascade_facade.test.ts`.
