# Proposal

## Why

An unattended run must end in a state the user can act on quickly. Today it does not:
- **A blocked task stops the run.** A `BLOCKED:` reply stops the whole run with the partial work left in the tree.
- **`--resilient` loses work.** It rolls back to HEAD, so in one-commit-per-section mode it also wipes earlier verified tasks of the section. It leaves no record, labels failures as "human tasks pending", and exits 0.
- **No lasting summary.** Nothing is written for the morning except the console and a log that keeps 500 characters per message.
- **No `status`.** There is no command that says which step comes next for a change.
- **Greptile comes too late.** It runs only after the PR is open, and the user then agrees with all its findings. The checks should happen before the PR, and the findings should be recorded so skills and cascade can improve.

These are roadmap pieces 2 (minimal), 6 (`status`) and 7 (Greptile gate). The design follows `openspec/changes/autonomy-contract/brief.md`, which holds the brainstorm, the seven-lens review and the decided scope.

## What Changes

- **Per-task rollback baseline.** When a task starts, the harness records the full working tree, including uncommitted work of earlier tasks in the same section and untracked files. A rollback restores that tree, not HEAD. This fixes the existing `--resilient` data loss.
- **Parking.** `--resilient` / `--continue-on-failure`, plus the new alias `--park`, now park the task instead of skipping it. Without the switch the behavior is as today.

  A task is parked when its reply has `BLOCKED: <reason>` (kind `question`) or when it runs out of attempts (kind `failure`). Parking does five things:
  1. Saves a patch of the task's work for the human.
  2. Rolls the task back.
  3. Writes `openspec/changes/<change>/parked/<task>.md`, with a header, the question or the full last failure, and a `## Answer` section.
  4. Commits the parked files as `chore(<change>): park <task>`.
  5. Continues with the next task.

  The remaining tasks of the same section wait. Other sections continue.

  On the next run:
  - a parked task with an empty answer is skipped without a session;
  - one with an answer is retried with the parked file in the prompt;
  - when it passes, its parked files are deleted in its commit.
- **Run summary and exit code.** The final report and a file `openspec/changes/<change>/run-summary.md` (one section per run, committed) list four things: done tasks with commits, parked tasks with the file to answer, waiting tasks, and human and manual steps. A run that ends with parked or waiting tasks exits **3**. Failures are no longer reported as human tasks.
- **`openspec-cascade status <change>`.** It prints the next step and its command, derived from files and stamps: explore, propose, fix tasks, spec review, answer parked tasks, run, code review, drift or archive.
- **Greptile before the PR.** This is opt-in through `codeReview.afterRun` in `.openspec-cascade.json`. After a run that exits 0, the harness runs the existing pre-PR review loop against `codeReview.base`.
  - Mechanical fixes are committed only if `alwaysVerify` and the default checks pass.
  - The findings are written to `code-review.md` in each change of the run, with every finding and its category, as material to improve skills and cascade.
  - The file is stamped with a new spec-gate stage, `code-review`: `resolved` when the review is clean and the confidence is at least `codeReview.minConfidence` (when set), and `open` otherwise.

## Capabilities

### New Capabilities
- `task-parking`: per-task rollback baseline, parking, waiting tasks and resume.
- `run-summary`: summary file, final report and exit code 3.
- `change-status`: the `status` subcommand and its next-step rules.
- `code-review-gate`: Greptile before the PR, `code-review.md`, the `code-review` stamp and the threshold.

### Modified Capabilities
- `spec-gate`: a third stage `code-review` with report `code-review.md`.

## Impact

- **Code.**
  - `src/engine/rollback_buffer.ts`: tree snapshot.
  - `src/facade/cascade_facade.ts`: `runTask`, `runChange`, `execute`, result types.
  - `src/facade/tasks.ts`: prompt addition for resumed tasks.
  - New `src/park/` (parked-file format, read and write, patch capture).
  - New `src/cli/status.ts` and `src/status/next_step.ts`.
  - `src/cli/spec_gate.ts` and its constants: the new stage.
  - `src/config/*`: the `--park` alias, `codeReview` keys, `EXIT_CODE_PARKED`.
  - `src/core/pre_pr_loop.ts`: called from the facade, unchanged.
- **Behavior.** With `--resilient`, a failed task now leaves a parked file and a commit, and the run exits 3 instead of 0. `forja wt night` treats any non-zero exit as a failure message. The forja side is outside this repo, and the docs say so.
- **Unchanged.** v2 mode, the K brake, `Depends:`, `DECISION:` and sensitive paths. The last two go to `autonomy-guard`.
