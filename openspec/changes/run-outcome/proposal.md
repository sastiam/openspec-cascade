# Proposal

## Why

An unattended run must end in a state the user can act on quickly. Today it does not:
- **A blocked task stops the run.** A `BLOCKED:` reply stops the whole run with the partial work left in the tree.
- **`--resilient` loses work.** It rolls back to HEAD, so in one-commit-per-section mode it also wipes earlier verified tasks of the section. It leaves no record, labels failures as "human tasks pending", and exits 0.
- **No lasting summary.** Nothing is written for the morning except the console and a log that keeps 500 characters per message.
- **No `status`.** There is no command that says which step comes next for a change.
- **Greptile comes too late.** It runs only after the PR is open, and the user then agrees with all its findings. The checks should happen before the PR, and the findings should be recorded so skills and cascade can improve.

These are roadmap pieces 2 (minimal), 6 (`status`) and 7 (Greptile gate). The design follows `openspec/changes/autonomy-contract/brief.md`, which holds the brainstorm, the seven-lens review and the scope decided on 2026-11-16.

**v1 only.** v2 mode is being deprecated. Everything in this change applies to v1 runs only. v2 runs keep their current behavior and get none of the new features.

## Scope decisions (2026-11-17, user decision)

The scope differs from the brief on purpose:
- **The per-task baseline fix is in this change.** The brief planned it as a separate, earlier change. It is now section 1 of this change, because parking cannot work without it.
- **`status` and the Greptile gate are in this change.** The brief did not cover them.
- **One PR.** This change ships in one PR together with four sibling changes, including `verify-contract` and `tasks-contract`.
- **Restored from the brief, in a simple form:** on relaunch, the harness prints one line per parked task: answered, waiting for answer, or stale.
- **Dropped from the brief:** the reserved answers `retry` and `skip`. Any non-empty answer already means "retry with this answer". To skip a task, the user checks it in `tasks.md`; its parked file is then ignored and reported as stale. `approve` belongs to `autonomy-guard`.

## What Changes

- **Per-task rollback baseline.** When a v1 task starts, the harness records the full working tree, including uncommitted work of earlier tasks and untracked files. A rollback restores that tree, not HEAD. Files deleted before the task stay deleted. This fixes the existing `--resilient` data loss. The tree restore is opt-in in the shared rollback buffer and only the v1 facade turns it on, so v2 and gate 3 keep today's behavior. Untracked excluded paths (such as `.atl`) are left alone; tracked files are reverted as today. A failed rollback now stops the run with exit 2.
- **Parking.** `--resilient` / `--continue-on-failure`, plus the new alias `--park`, now park the task instead of skipping it. Without the switch the behavior is as today. Parking with rollback off (`--no-rollback` or `rollbackOnFailure: false`) is a config error (exit 2).

  A task is parked when its reply has `BLOCKED: <reason>` (kind `question`) or when it runs out of attempts (kind `failure`). Parking does six things, in this order:
  1. Captures a patch of the task's work for the human. Secret-looking paths are left out and listed by name only.
  2. Rolls the task back to its start tree.
  3. Commits the verified but uncommitted work of earlier tasks as `chore(<change>): <section title> (partial, <task> parked)`, when there is any.
  4. Writes `openspec/changes/<change>/parked/<task>.md` (header, rounds, `## Answer`) and the patch.
  5. Commits only the parked files as `chore(<change>): park <task>`.
  6. Continues with the next runnable task.

  The remaining tasks of the same section wait. Other sections continue.

  On the next run:
  - one line per parked task says whether it is answered, waiting for an answer, or stale;
  - a parked task with an empty answer is skipped without a session;
  - one with an answer is retried with the parked file in the prompt; the answer does not need to be committed;
  - when it passes, its parked files are deleted in the commit that holds its work;
  - a stale parked file (task gone, task checked, or task text changed) is ignored for scheduling.
- **Run summary and exit code.** The final report and a file `openspec/changes/<change>/run-summary.md` (one section per run, committed) list done tasks with commits, parked tasks with the file to answer, waiting tasks, stale parked files, and human and manual steps. The summary is also written when the run stops on a run-level error. Exit codes: 0 all done, 1 crash, 2 fatal or fail-closed, 3 parked or waiting tasks. Failures are no longer reported as human tasks.
- **`openspec-cascade status <change>`.** It prints the next step and its command, derived from files, stamps and git: explore, propose, fix tasks, spec review, answer parked tasks, run, code review, drift or archive.
- **Greptile before the PR.** This is opt-in through `codeReview.afterRun` in `.openspec-cascade.json`. After a run that exits 0, the harness runs the existing pre-PR review loop against `codeReview.base`.
  - The fixer uses the run's engine, settings and budget. Fixes are committed only if `alwaysVerify` and the default checks pass. On a failed check, or if the fixer committed on its own, the harness resets to the pre-review HEAD and tree.
  - Greptile's confidence now flows through the bridge, so `codeReview.minConfidence` can work.
  - One branch-wide review is written to `code-review.md` in each change of the run, with every finding and its category, as material to improve skills and cascade.
  - The file is stamped with a new spec-gate stage, `code-review`, before it is committed. The stamp records the reviewed HEAD, so it goes stale when the code changes.

## Capabilities

### New Capabilities
- `task-parking`: per-task rollback baseline, parking, waiting tasks, stale parked files and resume.
- `run-summary`: summary file, final report and exit codes.
- `change-status`: the `status` subcommand and its next-step rules.
- `code-review-gate`: Greptile before the PR, `code-review.md`, the `code-review` stamp and the threshold.

### Modified Capabilities
- `spec-gate`: a third stage `code-review` with report `code-review.md` and a HEAD-based freshness rule.

## Impact

- **Dependencies.** This change is implemented in a second unattended run, after `verify-contract` (`alwaysVerify`), `tasks-contract` (`parseManualSteps`, tasks linter rules), `project-manifest` and `cascade-explore` on the same branch.
- **Code.**
  - `src/engine/rollback_buffer.ts`: opt-in tree snapshot and tree restore (`restoreTree`).
  - `src/integration/greptile/shadow.ts`: a public `snapshotTree` extracted from the shadow snapshot.
  - `resilience.ts`: `RollbackFailedError`.
  - `src/sdd/head_freshness.ts` (new): the HEAD freshness check.
  - `src/facade/cascade_facade.ts`: `runTask`, `runChange`, `execute`, `run`, result types, the review step and a `greptileClient` dependency.
  - `src/facade/tasks.ts`: prompt addition for resumed tasks.
  - New `src/park/` (parked-file format, state, patch capture, summary renderer).
  - New `src/status/` (`next_step.ts`, `facts.ts`) and `src/cli/status.ts`.
  - New `src/review/` (`factory.ts`, `render.ts`).
  - `src/integration/greptile/bridge.ts`: carries `confidence`.
  - `src/sdd/spec_marker.ts`, `src/cli/spec_gate.ts` and their constants: the new stage and its `head` key.
  - `src/cli/commands.ts`: `reviewCommand` uses the shared factory; `status` registered.
  - `src/config/*`: the `--park` alias, the parking-needs-rollback check, `codeReview` keys, `EXIT_CODE_PARKED`, `PARK_CONSTANTS`.
  - `src/core/pre_pr_loop.ts`: called from the facade, unchanged. This is a recorded exception to "no new imports from `src/core`".
- **Tests changed on purpose.** `test/e2e/tier3_combinations/cli_stack_pm_combinations.test.ts` (parking with rollback off) and `test/facade/cascade_facade.test.ts` (the last commit is now the summary commit).
- **Behavior.** With `--resilient`, a failed task now leaves a parked file and commits, and the run exits 3 instead of 0. `--resilient --no-rollback` now fails to load. `forja wt night` treats any non-zero exit as a failure message. The forja side is outside this repo, and the docs say so.
- **Unchanged.** v2 mode, the K brake, `Depends:`, `DECISION:` and sensitive paths. The last two go to `autonomy-guard`, which follows this change and replaces the interim secret rule for patches.
