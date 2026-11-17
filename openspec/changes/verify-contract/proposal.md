# Proposal

## Why

The harness decides that a task is done only when its checks exit 0. Today, if a task has a `Verify:` line, the harness turns every backticked `bun`/`npm`/`pnpm`/`yarn` command in the whole task into a check, including commands in the task's instructions. Words like "lint" or "build" anywhere in the prose also add checks. So a task that says "run the test file and see the new tests fail" gets that command as a check that must pass. A task whose goal is red tests can never be accepted, and `lint-tasks` does not catch it (finding 1 of the unattended run, `docs/superpowers/notes/2026-11-16-validacion-0b.md`).

This must be fixed before `autonomy-contract`. That change parks a task when its verification keeps failing, so "verification failed" has to mean that the task's declared checks failed, not that an instruction sentence was read as a check.

## What Changes

- Only the `Verify:` segment of a task produces checks. The segment is the text from the `Verify:` marker to the end of the task, including its continuation lines. Backticked commands and the shorthand words (`lint`, `build`, `both tsc`, `E2E`) before the marker no longer count.
- When the `Verify:` segment names no recognized command, the default verify commands run, as today.
- New project setting `alwaysVerify`: a list of commands added to the checks of every task, including tasks without a `Verify:` line. It is meant for project-wide rules that must hold after any task, such as an architecture lint ("the application layer never imports infrastructure"). The setting is empty by default, so nothing changes for projects that do not set it. The commands follow the same safety rules as task commands, and the docs-only fast-track treats them like any other check.
- Unchanged:
  - Tasks with neither `Verify:` nor "full verification" have no checks.
  - "full verification" and `--full-gate` behave as today.
  - The docs-only fast-track (PR #47) is kept; a task that must never skip writes "full verification".
  - The rules about unsafe commands (shell operators) and `bun audit` are kept.
- Docs: the README and `docs/cli.md` say that checks come only from the `Verify:` segment.

## Capabilities

### New Capabilities
- `task-verification`: which commands the harness runs to verify a task, where in the task they are read from, and which project-wide checks are added to every task.

### Modified Capabilities

None.

## Impact

- Code: `verifyCommands` in `src/facade/tasks.ts`. Its callers (`runTask` in `src/facade/cascade_facade.ts`, the v2 pipeline) are unchanged.
- Tests: `cascade.test.ts`, which holds the `verifyCommands` cases, plus new cases for the segment rule. Other callers in `test/` are checked for changed expectations.
- Behavior: a task that relied on a command written before its `Verify:` marker loses that check. This is intended. The fix is to put the command in the `Verify:` line.
- Config: a new optional `alwaysVerify` key in `.openspec-cascade.json` (schema, loader, docs). No CLI flag and no exit-code changes.
- Code: the check list built in `runTask` (`src/facade/cascade_facade.ts`) gains the `alwaysVerify` commands. Tasks without a `Verify:` line run their checks when `alwaysVerify` is set, instead of only checking the checkbox.
