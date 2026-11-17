# Design

## Context

See `openspec/changes/autonomy-contract/brief.md` for the brainstorm, the seven-lens review and the decided scope. The code facts this design relies on:

- `RollbackStateBuffer.snapshot()` stores only the HEAD SHA (`src/engine/rollback_buffer.ts:513`). `rollback()` runs `git reset --hard <sha>` and `git clean -fd` with exclude flags (`:386-406`).
- In `runTask` (`src/facade/cascade_facade.ts:600-744`):
  - a `BLOCKED:` reply throws `Fatal` (`:658`);
  - exhausted attempts roll back when `rollbackOnFailure` is set and throw `TaskFailureError` (`:725-743`).
- In `runChange`:
  - the loop picks the first unchecked task that is not in the local `skipped` set (`:760`);
  - with `resilient`, a `TaskFailureError` adds the task to `skipped` (`:779-791`);
  - `skipped` also feeds `skippedHumanTasks` (`:765`), which is why failures print as human tasks.
- `execute()` prints the final report (`:336-344`). `run()` maps errors to exit 1 or 2 (`:141`, `:233`). `EXIT_CODE_CONSTANTS` has no 3.
- `resilient` comes from the CLI flag, the `CASCADE_RESILIENT` environment variable or the file key. It is resolved by `resolveResilientValue` (`src/config/loader.ts:474-500`, `:750`).
- `spec-gate` stages and their files are listed in `SPEC_GATE_CONSTANTS.STAGES` and `FILE_BY_STAGE` (`src/config/constants.ts:505-507`).
- The pre-PR review is `PrePrReviewLoop` (`src/core/pre_pr_loop.ts:44-97`), driven today by `reviewCommand` (`src/cli/commands.ts:201-237`). Its statuses are clean, needs_human, exhausted, stale, mismatch and empty. `GreptileReviewResult.confidence` is optional.

## Goals / Non-Goals

**Goals:**
- A correct rollback baseline.
- Parking with a stable file format.
- A run summary and exit code 3.
- `status`.
- Greptile before the PR, with a recorded report and a stamp.

**Non-Goals:**
- v2 mode.
- The K brake, `Depends:`, `DECISION:` and sensitive paths.
- Applying parked patches.
- Changing forja.

## Decisions

- **Tree snapshot with a temporary index.**
  - `snapshot()` also records a tree. It writes a temporary index file with `GIT_INDEX_FILE`, runs `git add -A` with the same exclude pathspecs as commits, then `git write-tree`. The result is a tree object holding tracked, modified and untracked files, without committing anything.
  - `rollback()` resets to the HEAD SHA as today and cleans with the excludes. It then restores the tree into the working tree with `git read-tree` into a temporary index followed by `git checkout-index -a -f`, and finally restores the real index to HEAD.
  - The checked boxes of earlier tasks live in `tasks.md`, which is tracked and modified, so they come back with the tree.
  - Alternative: commit every task. Rejected: it changes commit granularity for users of section mode.
- **Parking lives in a new module, `src/park/`.** Each file has one job:
  - `format.ts`: write and parse the parked file, header, rounds and answer. It is pure.
  - `patch.ts`: captures the diff between the task-start tree and the current tree, through a temporary index. It uses `--binary` and excludes the change folder and never-commit paths. An empty diff writes no file.
  - `state.ts`: reads `parked/*.md` for a change, as a map from task id to `{kind, answered, path}`.

  `runTask` returns a result instead of throwing for these cases: `{status: "done"}` or `{status: "parked", kind, reason}`. Only run-level failures throw: engine fatal, budget, commit failure, and a failed rollback. `runChange` owns the loop: it parks, writes, commits, computes waiting tasks and continues. With parking off, `runChange` turns a parked result back into today's `Fatal` and `TaskFailureError`, so behavior is unchanged.
- **The order of steps when parking:**
  1. Capture the patch, against the task-start tree.
  2. Roll back.
  3. Write `parked/<task>.md` and `.patch`.
  4. Commit only those paths with `chore(<change>): park <task>`, using the same exclude pathspecs.

  This order means a later rollback can never delete the files, and the next `git add -A` cannot sweep them into another commit.
- **The full text of the question or failure comes from the session result and the verification output.** It never comes from the jsonl log, which truncates to 500 characters. A failure is capped at `PARK_CONSTANTS.FAILURE_MAX_CHARS`, and the cap is noted in the file.
- **Waiting tasks are derived, never stored.**
  - At the start of each change and after each park, `runChange` builds the parked set from `state.ts`, plus the parks of this run.
  - A task waits when an earlier task in its section is parked, whether answered or not, and not yet done. A task in a later section never waits.
  - A parked task with an answer is runnable. Its prompt gets the parked file text and the patch path, appended after `taskPrompt` and before the remediation directives.
- **Resumed success.** When a resumed task passes, its parked files are removed with `git rm` before the task commit, so the removal goes into the task's own commit.
- **Run summary.** A pure renderer, `src/park/summary.ts` (`renderRunSummary(changeReport, startedAt, outcome)`), feeds both the console and the file. At the end of `execute()`, the harness appends the rendered section to each change's `run-summary.md` and commits it. Manual steps come from `parseManualSteps` (`tasks-contract`). `TaskRunRecord.status` gains `"parked"` and `"waiting"`, and `ChangeStatus` gains `"partial"`. `skippedHumanTasks` keeps only human-task skips.
- **Exit code 3** is `EXIT_CODE_CONSTANTS.EXIT_CODE_PARKED`. `run()` returns it when there is no error and some task is parked or waiting.
- **`status` is a pure function plus a thin CLI.**
  - `src/status/next_step.ts` exports `nextStep(facts): {stage, command, reason}`.
  - `facts` are gathered by `gatherFacts(repo, change, config)`: folder and archive presence, files present, lint findings through `lintTasks`, stamp results through the spec-gate evaluation functions, the parked state and unchecked tasks.
  - `src/cli/status.ts` follows the `spec_gate.ts` pattern and is registered as a subcommand.
- **Code review after the run.**
  - Config: `codeReview` is a strict optional object in the file schema, with `afterRun` (boolean), `base` (string, default `main`), `rounds` (positive integer, default `PRE_PR_CONSTANTS.MAX_ROUNDS`) and `minConfidence` (optional number). It is file-only, with no flag.
  - After `execute()` finishes, if the run outcome is 0 and `afterRun` is set, the facade builds the same bridge and loop as `reviewCommand`. A shared factory is extracted from `commands.ts` so both use it.
  - Before the loop, it records a tree snapshot with the same mechanism as the tasks. After the loop, if the tree changed, it runs `alwaysVerify` plus `defaultVerify` and commits or restores as the spec says.
  - It writes `code-review.md` into every change of the run, rendered by a pure `renderCodeReview(result)`. It commits the files and then stamps them through the spec-gate stamp function: `resolved` or `open` following the threshold rule.
  - Review errors are written to the report and leave the stamp `open`. They do not crash the run.
- **The `code-review` spec-gate stage** is one entry added to `STAGES` and `FILE_BY_STAGE`. The hash rules are unchanged.

## Risks / Trade-offs

- [Temporary-index tree capture misses ignored files] → Ignored files are not touched by `git clean -fd` without `-x`, so they survive a rollback anyway.
- [Exit code 3 surprises callers] → This is documented. `forja wt night` prints any non-zero exit as a failure, and a follow-up in forja can map 3 to "needs answers".
- [Greptile is unavailable or unauthenticated at night] → The error goes into `code-review.md`, the stamp is `open`, and the run's exit code is unchanged.
- [Large failure output] → It is capped, and the cap is recorded.
