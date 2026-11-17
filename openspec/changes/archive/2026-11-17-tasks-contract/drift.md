---
egm: drift
status: resolved
hash: a23a46187c9a2af87e8c2392cb7ff98cc1499c1059ff2241188f7986773951c8
---
## design.md

- **Nit: stale JSDoc in constants that the change made wrong.** The doc comment "Static checks on a change's tasks.md: code blocks and unchecked tasks without a `Verify:` line." at `src/config/constants.ts:538-540` still describes only the two old rules. It also now sits above the new private `MANUAL_STEP_PHRASES` array (`constants.ts:541-565`), not above `TASKS_LINT_CONSTANTS` (`constants.ts:567`), so the object that holds the new `manual-step`, `missing-check` and `manual-checkbox` constants has no accurate doc. `design.md:58` lists the JSDoc to update (the module doc and `formatFinding` in `tasks_lint.ts`, the module doc of `lint_tasks.ts`, and `lintChanges`) and does not cover this comment.
- **Nit: `MANUAL_STEP_PHRASES` is not in the design.** The design says `MANUAL_STEP_PATTERNS` is the list of regexes (`design.md:40-41`). The code adds a separate module-level `MANUAL_STEP_PHRASES` string array (`constants.ts:541-565`) and builds the patterns from it at `constants.ts:597-599` with `phrase.replace(/ /g, "\\s+")`. The phrases are put into the regex without escaping. That is safe for the current list, but nothing in the design or the code says phrases must not contain regex metacharacters.
- **Nit: Context line numbers no longer match the code.** The Context section (`design.md:9-16`) gives line numbers from before the change:
  - `lintTasks` is at `src/sdd/tasks_lint.ts:58`, not `:49`. `flushTask` is at `:63-76`, not `:54-59`. The fence skip is at `:80-83`, not `:63-66`. The block-end check is at `:93`, not `:76`. `formatFinding` is at `:165`, not `:87`.
  - `TASKS_LINT_CONSTANTS` is at `constants.ts:567-603`, not `:537-556`.
  - `runLintTasks` is at `src/cli/lint_tasks.ts:48`, not `:41`. `lintChange` is at `:33-43`, not `:32-36`.
  - `lintChanges` is at `src/facade/cascade_facade.ts:435-449`, not `:412-420`. The v1 report is at `:338-347`, not `:336-344`. `executeV2` is at `:380-429`, not `:357-406`.

## specs/tasks-lint/spec.md

- **Major: the "Dry run" scenario is only partly tested.** `spec.md:179-181` requires that "the lint does not run and the dry run prints its plan". The only test, `test/facade/cascade_facade.test.ts:421-428`, checks just `exitCode === 0` and `error === undefined`. Nothing checks that the plan was printed (`printPlan`, `cascade_facade.ts:331-332`).
- **Nit: the "Another repository" scenario has no dedicated test.** For `spec.md:125-127`, every CLI test in `test/cli/lint_tasks.test.ts` (for example `:61-62`) passes `--repo` pointing at a temporary repository, so it is covered only as a side effect. No test compares this against the default (`process.cwd()`, `src/cli/lint_tasks.ts:52`) to show that the given repository is used instead of the current directory.

## Triage (2026-11-17)

- Fixed (task 4.1, f637668): the "Dry run" test now asserts the printed plan; `TASKS_LINT_CONSTANTS` documents every rule and `MANUAL_STEP_PHRASES` documents that phrases go into the regex unescaped.
- Accepted without change: Context line numbers, `MANUAL_STEP_PHRASES` as a separate array, no dedicated test for "Another repository".
