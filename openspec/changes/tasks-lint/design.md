# Design

## Context

Agents that run a change read `tasks.md`. If it holds code, or a task has no way to check it is done, the agent either copies the code or guesses. A rule in a prompt does not prevent that, because the agent can ignore it. A check that runs in code and stops the run cannot be ignored. See proposal.md for the full motivation; `brief.md` in this folder records the ideation review that led here.

Existing code this design builds on:

- `src/cli/spec_gate.ts` is the model for the new subcommand: `parseArgs`, an output sink, exit codes from `EXIT_CODE_CONSTANTS`, and the change-name pattern in `HARDENING_CONSTANTS`. Its helpers (`validChangeName`, `changeDirOf`, the `--changes` parser, the usage error class) are private.
- "The looper" in this document means `CascadeFacade` in `src/facade/cascade_facade.ts`. `execute()` calls `preflight(ctx)`, then sends `--mode v2` to `executeV2`, dry-run to `printPlan`, and the default v1 mode to `runChange` per change. `night-run` is prose in `docs/cli.md`, so it cannot enforce anything.
- `parseTasks` in `src/facade/tasks.ts` decides which tasks the runner sees. A task is a `- [ ]`, `- [x]` or `- [X]` line at column 0 followed by an ID; its text is the task line plus the indented lines after it; a blank or non-indented line ends it. `verifyCommands` looks for `Verify:` in that text. It splits lines on `\n` only, so a CRLF file yields no tasks.
- Every existing change has all tasks checked and no fenced block, so the new rules pass them untouched.

## Goals / Non-Goals

**Goals:**
- The lint and the runner see the same tasks: a `Verify:` the lint accepts is a `Verify:` the runner reads.
- No engine session starts on a `tasks.md` with a finding, in every execution mode.
- One copy of the CLI argument helpers.

**Non-Goals:**
- Not detected: indented (four-space) code blocks, long one-line commands, fences inside blockquotes, `Verify:` text that holds no runnable command, edits to `tasks.md` made during a run.
- Not implemented: manual verbs with checkboxes and `manual.md` (deferred in the roadmap).
- No warnings: every finding blocks.

## Decisions

1. **Pure function in `src/sdd/tasks_lint.ts`.** `lintTasks(markdown): Finding[]` with `Finding = { line, rule, message }`, 1-based lines, rule IDs `no-code-block` and `missing-verify`, findings sorted by line. A `formatFinding(change, finding)` helper in the same module renders the `<change>: tasks.md:<line>: <rule> <message>` line, so the CLI and the preflight print the same text. Constants (file name, patterns, rule IDs, messages) go in `TASKS_LINT_CONSTANTS` next to `SPEC_GATE_CONSTANTS`; the `Verify:` token lives inside its pattern, not in a constant of its own. Alternative: a rule registry. Rejected until a third rule exists; two functions need no registry.

2. **Rules.** `no-code-block` applies to the whole file. `missing-verify` applies to unchecked column-0 tasks only, because the runner executes only unchecked tasks and this keeps all existing changes passing without edits. A fenced block hides its lines from `missing-verify`. The spec holds the exact behavior; the patterns live in `TASKS_LINT_CONSTANTS` and are covered by the case table in task 1.2. Alternative: lint checked tasks too. Rejected: it fails all existing changes and needs an opt-out, which becomes a bypass inside the file the agent can edit.

3. **One line-splitting rule for lint and runner.** `parseTasks` is fixed to strip a BOM and split on `\r\n?|\n`, using a `normalizeLines` function defined in `src/sdd/tasks_lint.ts` and imported by `parseTasks`. It lives there and not in `src/facade/tasks.ts` so that the `sdd` module does not depend on the facade module and its many imports; the direction `facade → sdd` already exists. This makes the first Goal true for CRLF, CR and BOM. Alternatives: a shared task tokenizer (more abstraction than the problem needs, since only the ID requirement differs), or a lint finding when the runner sees fewer tasks (reproduces parser quirks). The change alters runner behavior for CRLF files: tasks the runner skipped before now run. An agreement test checks that every unchecked task with an ID that the lint accepts has `Verify:` in the text `parseTasks` returns, on LF, CRLF, CR and BOM input. An unchecked task without an ID fails the lint on a missing `Verify:` and is never seen by the runner; the message does not hide this.

4. **`lint-tasks` CLI in `src/cli/lint_tasks.ts`.** `runLintTasks(argv, output)` mirrors `runSpecGate`: it never throws and returns the exit code. `--changes` (repeated or comma separated, duplicates removed), `--repo` defaulting to the working directory. Findings go to stderr, `lint-tasks: ok (<names>)` to stdout, usage errors as `USAGE: cascade lint-tasks: <message>` with exit 2. A missing `tasks.md` is exit 2: the input is required, and `runChange` already treats the same case as a fatal error. `spec-gate check` exits 1 for a missing report because the report is a generated artifact that may legitimately not exist yet. `docs/cli.md` records the difference.

5. **Shared helpers.** `validChangeName`, `changeDirOf`, the `--changes` parser, a shared usage error and the output type move to `src/cli/change_args.ts` as a pure move. `SpecGateOutput` becomes a neutral `CliOutput` type there; `spec_gate.ts` keeps `SpecGateOutput` as an alias and `commands.ts` re-exports `CliOutput`, so existing importers keep working. The shared `--changes` parser removes duplicate names for both subcommands, so `spec-gate` now lists a repeated name once; this is the only behavior change of the move. `changeDirOf` keeps reading the `openspec` and `changes` directory names from `SPEC_GATE_CONSTANTS`; renaming those constants is out of scope. Alternatives: leave the helpers private and copy about 40 lines (they drift), or add the lint as a `spec-gate` action.

6. **Separate subcommand, not a `spec-gate` action.** `spec-gate` checks the freshness of hash-stamped reports and requires `--stage`. This lint is a pure function of one file with no stamp and a different exit rule for a missing file. The cost is a second argument parser, reduced by decision 5.

7. **Preflight at the existing choke point.** A `lintChanges(ctx)` call inside `preflight(ctx)` lints every change in `--changes` before the v1/v2 split, and throws `Fatal` with a fixed header line followed by all findings, grouped by change, in the CLI line format. `lintChanges` runs first in `preflight`, before the `--settings`, protected-branch and dirty-tree checks; it needs no git, so a finding is reported before any git error on the same run. It skips dry-run, because a dry run starts no session. A listed change with no `tasks.md` is skipped by the lint; the existing handling reports it. Alternatives: a lint inside `runChange` (v1 only, and change B is linted after change A has run), a shell call from a prompt (the agent can skip it), a hash-based re-lint before every task (a new mid-run failure mode for a gap accepted as a non-goal), and a findings file in the change folder (stderr and `Fatal` already carry the same information). The `night-run` prose and the `cascade-looper` command prompt say the facade enforces the lint.

8. **Existing test fixtures change.** Facade and end-to-end tests that write a `tasks.md` without an indented `Verify:` line fail the preflight. They are updated, not exempted: `test/facade/cascade_facade.test.ts`, `test/e2e/helpers/temp_repo.ts`, and any other test that starts a run through `CascadeFacade` and fails.

## Risks / Trade-offs

- [A person or agent edits `tasks.md` of a later change in the same cascade] → All listed changes are linted before the first session starts, so the lint reads them before any agent runs.
- [The lint blocks a night run on a false positive] → Likelihood low, since the rules are two plain patterns; the finding names the line and a fix hint. The cost of a false positive is one failed start, not lost work.
- [Linting only unchecked tasks leaves a fence in a checked task's block unreported as `missing-verify`] → `no-code-block` still covers the whole file.
- [Code hidden in indented blocks or long one-liners; `Verify:` text with no runnable command] → Known gaps in Non-Goals. The runner falls back to the default verification for a `Verify:` it cannot extract a command from.
- [`parseTasks` now runs CRLF files that it used to skip] → Intended; recorded in decision 3 and covered by a parser test.
- [An unclosed fence hides every later task] → One finding on the opening line; fixing it shows the next findings, if any.
- [Scale] → Linear in file size; a `tasks.md` has tens of lines.

## Migration Plan

1. Group 1 of tasks.md: constants, the line-splitting fix and the pure lint, with tests. Nothing calls the lint yet.
2. Group 2: shared helpers, the CLI and its docs, in one group so the docs test stays green.
3. Group 3: the preflight, the fixture updates and the looper docs, landing together so the suite is never red.
4. Rollback: revert the group 3 commit. Groups 1 and 2 are harmless without a caller. The `parseTasks` fix stays unless it is reverted on its own.

## Open Questions

None.
