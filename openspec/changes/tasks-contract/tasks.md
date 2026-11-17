# Tasks

## Files

- Modify: `src/sdd/tasks_lint.ts`, `src/config/constants.ts`, `src/cli/lint_tasks.ts`, `src/facade/cascade_facade.ts`, `test/sdd/tasks_lint.test.ts`, `test/cli/lint_tasks.test.ts`, `test/facade/cascade_facade.test.ts`, `docs/cli.md`, `README.md`.
- Untouched: `src/facade/tasks.ts` and the human-task regex.

## 1. manual-step rule

- [ ] 1.1 Test first, then implement. In `test/sdd/tasks_lint.test.ts`, add one test per scenario of the requirements "Manual steps in tasks.md are findings" and "Manual-step phrase list" (the two phrase-list scenarios loop over every listed phrase). Run that test file and see the new tests fail before changing source. Then add `RULE_MANUAL_STEP`, its message (it tells the author to move the step to manual.md) and `MANUAL_STEP_PATTERNS` (the English and Spanish phrases listed in the spec, as case-insensitive regexes with word boundaries) to `TASKS_LINT_CONSTANTS`, and evaluate the rule in `flushTask` over the block text with backtick spans removed, exempting blocks that match the human-task regex. No comments inside function bodies.
  Verify: `bun test test/sdd/tasks_lint.test.ts` passes, `bun run typecheck` passes and `bun run lint` passes.

## 2. manual.md

- [ ] 2.1 Test first, then implement. Export `lintManual(markdown)` and `parseManualSteps(markdown)` from `src/sdd/tasks_lint.ts` as design.md describes, with rule constants `RULE_MISSING_CHECK` and `RULE_MANUAL_CHECKBOX` and their messages in `TASKS_LINT_CONSTANTS`. Give `formatFinding` a file-name parameter defaulting to tasks.md. In `test/sdd/tasks_lint.test.ts`, cover every scenario of "manual.md steps need a Check line" and "manual.md has no checkboxes" plus a fenced block inside manual.md producing no finding, and cover `parseManualSteps` returning step and check pairs in order.
  Verify: `bun test test/sdd/tasks_lint.test.ts` passes, `bun run typecheck` passes and `bun run lint` passes.
- [ ] 2.2 Test first, then implement. Make `runLintTasks` in `src/cli/lint_tasks.ts` and `lintChanges` in `src/facade/cascade_facade.ts` also lint `manual.md` when it exists, printing its findings with the manual.md line format after the tasks.md findings of the same change. In `test/cli/lint_tasks.test.ts`, cover a change with a valid manual.md (exit 0), a change whose manual.md has a missing check (exit 1 with the exact line), and a change without manual.md (unchanged output). In `test/facade/cascade_facade.test.ts`, cover that a manual.md finding stops preflight before any engine session.
  Verify: `bun test test/cli/lint_tasks.test.ts` passes, `bun test test/facade/cascade_facade.test.ts` passes, `bun run typecheck` passes and `bun run lint` passes.

## 3. Final report and docs

- [ ] 3.1 Test first, then implement. In the final report of `execute()` in `src/facade/cascade_facade.ts`, after each change's status line, list the change's manual steps and their checks using `parseManualSteps`, only when manual.md exists and the run is not a dry run. In `test/facade/cascade_facade.test.ts`, cover both scenarios of "Manual steps are listed at the end of a run" by asserting on the reported lines.
  Verify: `bun test test/facade/cascade_facade.test.ts` passes, `bun run typecheck` passes and `bun run lint` passes.
- [ ] 3.2 In `docs/cli.md` (Spanish), update the `lint-tasks` row and add a short section on manual.md: format, the two rules, that the harness only lists the steps. In `README.md` (English), mention manual.md and the manual-step rule where tasks.md rules are described.
  Verify: `bun test` passes with zero failures, `bun run typecheck` passes and `bun run lint` passes.
