# Tasks

## Files

- Create: `src/sdd/tasks_lint.ts`, `src/cli/lint_tasks.ts`, `src/cli/change_args.ts`, `test/sdd/tasks_lint.test.ts`, `test/cli/lint_tasks.test.ts`, `test/facade/tasks.test.ts`.
- Modify: `src/config/constants.ts`, `src/cli/commands.ts`, `src/cli/spec_gate.ts`, `src/facade/tasks.ts`, `src/facade/cascade_facade.ts`, `test/facade/cascade_facade.test.ts`, `test/e2e/helpers/temp_repo.ts`, `docs/cli.md`, `README.md`, `docs/superpowers/specs/2026-11-16-cascade-puzzle-roadmap.md`, `plugins/cascade/commands/cascade-looper.md`.
- Untouched: every other file, including the `tasks.md` of the 29 existing changes and `src/facade/v2_pipeline.ts`.

## 1. Pure lint and line splitting

- [x] 1.1 Add `TASKS_LINT_CONSTANTS` in `src/config/constants.ts` with these values: file name `tasks.md`, token `Verify:`, rule IDs `no-code-block` and `missing-verify`, the fence opener, the fence closer, the unchecked-task and `Verify:` patterns, the line-ending pattern and BOM, the line number base 1, and one message with a fix hint per rule.
  Verify: `bun run typecheck` passes and `bun run lint` passes.
- [x] 1.2 Write the failing tests in `test/sdd/tasks_lint.test.ts` for `lintTasks` and for the line-splitting function. Build fixtures from string arrays, because the fixture text itself contains backtick fences. Each case lists the input and the expected findings as `{line, rule}`:
  Verify: `bun test test/sdd/tasks_lint.test.ts` fails because `lintTasks` does not exist yet.
  - Clean file with two unchecked tasks, each with an indented Verify: no findings.
  - Three-backtick fence on line 5: one `no-code-block` on line 5. Same with a language name after the backticks, and with three tildes.
  - Tilde fence whose body holds three backticks: one finding. Four-backtick fence with a three-backtick line inside: one finding, the inner line does not close it.
  - Indented fence opener: one finding. Unclosed fence: one finding on the opening line, and no `missing-verify` for tasks after it.
  - One line with three backticks, text, three backticks: no finding. Inline single backticks in a Verify: no finding.
  - Unchecked task with no Verify: one `missing-verify` on the task line. Task without an ID: same. Checked task with no Verify, in lowercase and uppercase: no finding.
  - Verify on the task line only; lowercase verify; bold Verify; empty Verify; Verify after a blank line: each gives one `missing-verify`.
  - Verify with a dash or star list marker, and with a tab indent: no finding.
  - Verify inside a fence for an unchecked task: one `no-code-block` and one `missing-verify`.
  - Nested checkbox line inside a task block: part of the parent block, no separate finding.
  - Heading right after a task: ends the block. Last task at the end of the file with no trailing newline: handled.
  - Fence on line 9 and task without Verify on line 3: the line 3 finding comes first.
  - CRLF, CR and BOM variants of the same file: identical findings and line numbers. Empty file: no findings.
  - `formatFinding("demo", finding)` returns `demo: tasks.md:<line>: <rule> <message>`.
- [x] 1.3 Add a failing test in the new `test/facade/tasks.test.ts` for `parseTasks` on CRLF, CR and BOM input, then add a `normalizeLines` function (strip BOM, split on `\r\n?|\n`), use it in `parseTasks` in `src/facade/tasks.ts`, and export it for the lint.
  Verify: `bun test test/facade` passes for the parser tests, including the CRLF, CR and BOM cases.
- [x] 1.4 Implement `lintTasks` and `formatFinding` in `src/sdd/tasks_lint.ts` so the tests of 1.2 pass, reading every pattern and message from `TASKS_LINT_CONSTANTS`.
  Verify: `bun test test/sdd/tasks_lint.test.ts` passes and `bun run lint` passes.
- [x] 1.5 Add an agreement test in `test/sdd/tasks_lint.test.ts` that imports `parseTasks` from `src/facade/tasks.ts`: for LF, CRLF, CR and BOM input, every unchecked task with an ID that the lint accepts has `Verify:` in the text `parseTasks` returns, and a Verify separated by a blank line is absent from the parsed text. A task without an ID is outside this test.
  Verify: `bun test test/sdd/tasks_lint.test.ts` passes with the agreement test included.

## 2. CLI subcommand and docs

- [x] 2.1 Move `validChangeName`, `changeDirOf`, the `--changes` comma and repeat parser, the usage error class and the output type out of `src/cli/spec_gate.ts` into `src/cli/change_args.ts` as `validChangeName`, `changeDirOf`, `parseChangeNames`, `CliUsageError` and `CliOutput`, and make `spec_gate.ts` import them without changing its behavior.
  Verify: `bun test test/cli/spec_gate.test.ts` passes unchanged and `bun run typecheck` passes.
- [x] 2.2 Write the failing CLI tests in `test/cli/lint_tasks.test.ts`, mirroring `test/cli/spec_gate.test.ts`:
  Verify: `bun test test/cli/lint_tasks.test.ts` fails because the subcommand does not exist yet.
  - Exit 0 and the line `lint-tasks: ok (a,b)` on stdout for two clean changes, passed once as a comma list and once as repeated flags.
  - Exit 1 with findings from two changes on stderr in the `<change>: tasks.md:<line>: <rule> <message>` form, all findings of both changes reported.
  - Exit 2 and a `USAGE: cascade lint-tasks:` line for missing `--changes`, an invalid change name, an unknown flag and a missing `tasks.md`.
  - `--repo` points the command at another repository.
  - An old-style `tasks.md` with unchecked tasks and prose "verify with" fails with one finding per task.
- [x] 2.3 Implement `runLintTasks(argv, output)` in `src/cli/lint_tasks.ts`, add `"lint-tasks"` to `CLI_COMMAND_CONSTANTS.SUBCOMMANDS` and a case in `src/cli/commands.ts`, add a `lint-tasks` row to the subcommand table of `docs/cli.md` in Spanish (usage, findings on stderr, exit `0`, `1`, `2`, and that a missing `tasks.md` is exit 2 while `spec-gate check` exits 1 for a missing report), add `cascade.ts lint-tasks` to `README.md` next to the other subcommands, and change row 4 and the lint bullet of section 4 in the roadmap file to say that the code-block and `Verify:` rules are done and manual verbs are deferred.
  Verify: `bun test test/cli test/docs` passes, `bun run typecheck` passes and `bun run lint` passes.

## 3. Preflight

- [x] 3.1 Write the failing facade tests in `test/facade/cascade_facade.test.ts`, building repositories with `addOpenSpecChange`: a listed change with a finding stops the run with `Fatal` before any engine session, in default mode and in `--mode v2`; a finding in the second listed change stops the run before the first change starts; a dry run does not lint; a change that was not listed is not linted; a listed change with no `tasks.md` is left to the existing handling; the lint runs once per run.
  Verify: `bun test test/facade` fails on the new tests only.
- [x] 3.2 Add a `lintChanges(ctx)` call inside `preflight` in `src/facade/cascade_facade.ts` that reads each listed `tasks.md` that exists, runs `lintTasks`, skips dry-run, and throws `Fatal` with the findings grouped by change in the `formatFinding` form. In the same task, update the fixtures that now fail, starting with `test/facade/cascade_facade.test.ts` (the `TASKS` constant, the `Verify:` fixtures and the human-task fixture) and the default `tasks.md` in `test/e2e/helpers/temp_repo.ts`, adding an indented `Verify:` line to each unchecked task.
  Verify: `bun test` passes.
- [x] 3.3 Update `plugins/cascade/commands/cascade-looper.md` with one sentence that the facade lints every listed change before any session starts and stops on findings, and update the `night-run` paragraph of `docs/cli.md` (the paragraph below the `spec-gate` cycle, not the subcommand table) to say the same.
  Verify: `bun test test/docs test/plugin` passes and `bun run cascade.ts lint-tasks --changes tasks-lint` exits 0.

## 4. Integration

- [x] 4.1 Run the full suite and the lint on this change's own `tasks.md`.
  Verify: `bun run typecheck`, `bun run lint` and `bun test` all exit 0, and `bun run cascade.ts lint-tasks --changes tasks-lint` exits 0.
