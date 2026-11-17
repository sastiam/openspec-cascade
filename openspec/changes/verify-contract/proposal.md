# Proposal

## Why

The harness decides that a task is done only when its checks exit 0. Today, if a task contains `Verify:` anywhere, the harness turns every backticked `bun`/`npm`/`pnpm`/`yarn` command in the whole task into a check, including commands in the task's instructions. Words like "lint" or "build" anywhere in the prose also add checks. So a task that says "run the test file and see the new tests fail" gets that command as a check that must pass. A task whose goal is red tests can never be accepted, and `lint-tasks` does not catch it (finding 1 of the unattended run, `docs/superpowers/notes/2026-11-16-validacion-0b.md`).

This must be fixed before `autonomy-contract`. That change parks a task when its verification keeps failing, so "verification failed" has to mean that the task's declared checks failed, not that an instruction sentence was read as a check.

## What Changes

- **Verify marker.** A task's Verify segment starts at its Verify marker. The marker is the first continuation line that matches the `lint-tasks` rule `VERIFY_LINE`: an indented line that starts with an optional list marker (`-` or `*`) and then `Verify:`. If the task has no such line, the marker is the first `Verify:` on the task line itself that is outside backtick spans (the existing inline form, for example "Upgrade x. Verify: `bun audit` shows 0 advisories"). A `Verify:` inside backticks, or in the middle of a continuation line, is not a marker.
- **Only the Verify segment produces checks.** The segment is the text from the marker to the end of the task. All four detections read only the segment: the backtick command scan, the `lint`/`build` keywords, `both tsc`, and `E2E`. Commands and keywords before the marker no longer count.
- When the Verify segment names no recognized command, the default verify commands run, as today.
- "full verification" and `--full-gate` still read the whole task text. When a task has both "full verification" and a Verify segment, the full suite is added as today (only when the segment names no command), and commands before the marker are still ignored.
- **Ignored commands are reported.** A backticked package-manager command written before the marker is listed in the run log and in the dry-run plan, so the change in behavior is never silent.
- **New project setting `alwaysVerify`** (v1 runs only): a list of commands added to the checks of every task, including tasks without a Verify marker. It is meant for project-wide rules that must hold after any task, such as an architecture lint ("the application layer never imports infrastructure"). It is empty by default, so nothing changes for projects that do not set it.
  - Commands run exactly as written: no Nuxt `tsc` expansion, no `bun audit` exclusion, no package-manager rewrite.
  - Commands with shell operators are rejected when the config loads.
  - The docs-only fast-track treats them like any other check.
  - A task without its own checks but with `alwaysVerify` set is done only when the agent checked its box and the `alwaysVerify` checks pass.
  - Before the first task, the harness runs `alwaysVerify` once. If a check already fails, the run stops with a message that names the check, instead of failing every task.
  - The agent's prompt and the dry-run plan show the merged list of checks.
- **v2 mode.** v2 is being deprecated. `alwaysVerify` is not applied in v2; loading a config with `mode: "v2"` and a non-empty `alwaysVerify` prints a warning, not an error.
- Unchanged:
  - Tasks with neither a Verify marker nor "full verification" have no checks, unless `alwaysVerify` is set.
  - `--full-gate` behaves as today.
  - The docs-only fast-track (PR #47) is kept; a task that must never skip writes "full verification".
  - The rules about unsafe task commands (shell operators) and `bun audit` are kept.
- Docs: the README and `docs/cli.md` describe the Verify marker, the segment rule and `alwaysVerify`.

## Capabilities

### New Capabilities
- `task-verification`: which commands the harness runs to verify a task, where in the task they are read from, and which project-wide checks are added to every task in v1 runs.

### Modified Capabilities

None.

## Impact

- Code, task parsing: `parseTasks` and `verifyCommands` in `src/facade/tasks.ts`. `Task` gains an optional `verifyStart` field. New helpers `verifySegment`, `ignoredCommands` and `taskChecks` in the same file. The segment rule lives in `verifyCommands`, so v2 gets it too; only `alwaysVerify` is v1-only.
- Code, v1 run: `runTask`, `printPlan` and `execute` in `src/facade/cascade_facade.ts` (merged checks, checkbox rule for `alwaysVerify`-only tasks, ignored-command log, one baseline run of `alwaysVerify`).
- Config: required `alwaysVerify: readonly string[]` on `CascadeConfig`, default `[]`, set only from `.openspec-cascade.json` or programmatic overrides. No CLI flag, no environment variable, no exit-code changes. Files: `src/config/schemas.ts`, `src/config/constants.ts`, `src/config/loader.ts`.
- Untouched: `fast_track.ts`, `src/facade/v2_pipeline.ts`, `src/sdd/tasks_lint.ts`.
- Tests: `cascade.test.ts`, `test/config/loader.test.ts`, `test/facade/cascade_facade.test.ts`.
- Behavior: a task that relied on a command written before its Verify marker loses that check. This is intended, and the command is now listed as ignored. The fix is to put the command in the Verify line.
