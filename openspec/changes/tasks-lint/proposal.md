# Proposal

## Why

The roadmap (piece 4) says `tasks.md` must hold only what an agent can do and verify: the expected outcome and a `Verify:` line, never lines of code. Today nothing enforces that. A rule written in a prompt can be ignored by the agent; a command with an exit code, run by the looper before any engine session starts, cannot. Piece 4 is small and executable, so it goes first.

## What Changes

- New pure function `lintTasks(markdown)` in `src/sdd/tasks_lint.ts` with two rules:
  - `no-code-block`: any fenced code block (three or more backticks or tildes) anywhere in `tasks.md` is a finding.
  - `missing-verify`: every unchecked top-level task (`- [ ]` at column 0) needs an indented `Verify:` line inside its block. Checked tasks (`- [x]`) are not linted, because the runner never executes them.
- New subcommand `lint-tasks --changes <a,b> [--repo <path>]`. Findings go to stderr; exit `0` clean, `1` findings, `2` invalid usage (missing or invalid `--changes`, invalid change name, missing `tasks.md`).
- `CascadeFacade` lints every change listed in `--changes` once, inside the existing `preflight`, before the v1/v2 split and before any engine session starts. Findings stop the run with `Fatal`. Dry-run does not lint.
- `parseTasks` normalizes `\r\n?` line endings and strips a leading BOM, so the runner and the lint see the same tasks in CRLF, CR and BOM files.
- Existing test fixtures that write a `tasks.md` without an indented `Verify:` line are updated.
- Shared CLI argument helpers (change-name validation, `--changes` parsing, change directory, usage error, output type) move out of `spec_gate.ts` into one module that both subcommands use.
- Docs: `docs/cli.md`, `README.md`, the roadmap, and the `cascade-looper` command prompt.

There is no skip marker. The 29 existing changes have every task checked, so they pass without edits.

Out of scope: manual verbs with checkboxes and `manual.md` (deferred in the roadmap), indented (four-space) code blocks, long one-line commands, fences inside blockquotes, a rule that requires `Verify:` to hold a runnable command, re-linting during a run, and a findings file.

## Capabilities

### New Capabilities
- `tasks-lint`: static checks on a change's `tasks.md` (code blocks, missing `Verify:`), the `lint-tasks` subcommand and its exit codes, and the preflight that stops a run before any engine session starts.

### Modified Capabilities

None. There are no existing specs under `openspec/specs/`.

## Impact

- New: `src/sdd/tasks_lint.ts`, `src/cli/lint_tasks.ts`, `src/cli/change_args.ts`, `test/sdd/tasks_lint.test.ts`, `test/cli/lint_tasks.test.ts`.
- Edited: `src/config/constants.ts`, `src/cli/commands.ts`, `src/cli/spec_gate.ts`, `src/facade/tasks.ts`, `src/facade/cascade_facade.ts`, `test/facade/cascade_facade.test.ts`, `test/e2e/helpers/temp_repo.ts` (fixtures), `docs/cli.md`, `README.md`, `docs/superpowers/specs/2026-11-16-cascade-puzzle-roadmap.md`, `plugins/cascade/commands/cascade-looper.md`.
- Behavior change for users: a change with a fence in `tasks.md`, or an unchecked task without `Verify:`, is rejected before any task runs.
