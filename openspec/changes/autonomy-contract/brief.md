# Autonomy contract (piece 2)

* **Author:** Sebastian
* **Date:** 2026-11-16
* **Status:** brainstorm complete. Reviewed by 7 Goldfish lenses (design, codebase details, zoom-out, comprehension, implementation readiness, structural, inventive catalyst); all 7 completed. Scope and staging were decided by the author (see the end).

## Overview

An unattended cascade run must not stop because of one task. Today, in v1 `runTask` (`src/facade/cascade_facade.ts:600-744`):

- A reply ending in `BLOCKED: <reason>` throws `Fatal` (line 658). The whole run stops and the partial work stays in the tree.
- A task that uses up `maxAttemptsPerTask` rolls back (if `rollbackOnFailure`) and throws `TaskFailureError`. The run stops, unless `--resilient` is on.

The working hypothesis: park the task instead of stopping, keep going with work that does not depend on it, and leave the human a file to answer. The human answers in the morning and relaunches. The agent may decide small, reversible things alone and must say so (`DECISION:`). Code, not the prompt, stops it from committing changes to sensitive paths. A final plain-language summary says what was done, decided and parked.

Target user: one developer who plans changes with AI and lets cascade run them unattended. Changes are usually 2-10 tasks.

## Analysis

### What already exists (the concept understated it)

- `--resilient` / `--continue-on-failure` (`loader.ts:139`, default off) already does "roll back, skip, continue" for exhausted attempts (`cascade_facade.ts:779-791`). It writes nothing for the human. It labels the failed task as a "human task pending" (line 339), and the run still exits 0 (line 233).
- `RollbackStateBuffer`, `blockedReason` (`tasks.ts:137`), `detectAffectedFiles` (`fast_track.ts:34`), the commit exclusion pathspecs (`cascade_facade.ts:583-585`) and `ctx.tasks` with per-task status can all be reused.
- v2 (`src/core/escalation.ts` rung 6, `dag.ts` `cascadeBlockDownstream`) implements the same ideas but is used only in tests and is scheduled for pruning. The new code must not import from `src/core`.
- v2 mode (`v2_pipeline.ts:348`) also treats BLOCKED as fatal. This change should be v1 only.

### Blockers found in review

1. **Rollback goes back to HEAD, not to the start of the task** (confirmed: `rollback_buffer.ts:513` stores only the HEAD SHA, then `reset --hard` + `clean -fd`). In one-commit-per-section mode, earlier tasks of the section are verified and checked but not committed. Parking task 2.3 silently wipes 2.1 and 2.2 and their checkboxes. They are then re-run and paid for again. If the barrier parks the section's last task, the section never commits, and its leftovers land in the next section's commit. This bug already exists today under `--resilient`. Every other part of the design (the patch, the sensitive-path diff, the rollback) needs a correct per-task baseline: a tree snapshot at task start (`git stash create` or a temporary-index `write-tree`), or a commit per verified task.
2. **Parked files can be lost or misfiled.** `git clean -fd` deletes untracked files, so parked files written before a rollback, or before a later task's rollback, disappear. If they survive, the next `git add -A` sweeps them into an unrelated commit, and on relaunch preflight stops with "Working tree is dirty". Fixed order: capture the patch, roll back, write `parked/`, then commit it in its own commit (`chore(<change>): park <task>`), so it travels with the PR as roadmap rule 1 says.
3. **The patch can leak secrets into the PR.** A task parked because it touched `.env*` would write that content into `<task>.patch`, which is then committed and pushed. Default `neverCommit` does not cover `.env*`. Sensitive and `neverCommit` files must never have their content in a patch, only their names.
4. **A sensitive-path park can never pass.** If the task's purpose is a migration, the retry touches `migrations/` again and parks again, every night. There must be an explicit approval path, bound to the listed paths. The cheapest version applies the saved patch, runs Verify, and commits, with no agent session.

### Major findings

- **Outcome is not machine-readable.** A run that finishes with parked tasks needs its own exit code (today only 0, 1, 2, 124, 130 and 143 exist), a `parked` task status and a `partial` change status. `forja wt night` and a future `status` command depend on this.
- **The answer file needs a precise format.** It needs a header the machine reads: format version, task id, task-text hash, kind, base commit, attempts and date. A delimited answer block follows, and whitespace-only means unanswered. Reserved one-word answers are `retry`, `skip` and, for sensitive parks, `approve`. On relaunch, print what was read for each task. When a retry parks again, append a new round; never overwrite. Delete the file in the commit of the task once it succeeds.
- **Three park kinds, not two:** `question` (BLOCKED), `failure` (attempts exhausted, with the last verification output) and `approval` (sensitive path).
- **Tasks held by a dependency are not parked.** They get no file, show in the summary as "waiting on 1.2", and run by themselves once the blocker is resolved.
- **The brake (K) needs exact rules.** Only tasks that ran a session and then parked count. A done task resets the counter. The count spans changes, and the run stops cleanly with the summary, not with a crash. A cheaper detector than a fixed K: when a failure park happens, run Verify on the clean baseline. If that also fails, the environment is broken, so stop. `classifyFailure` in `escalation.ts` already sorts environment failures from task failures.
- **The patch is a hint, and that is the normal path.** `git apply --3way --check` runs first. On any failure the tree stays clean and the patch goes into the prompt as context only. If the task-text hash changed since parking, the patch is not applied. The patch excludes the change folder (`tasks.md`, `parked/`) and uses `--binary`.
- **Sensitive-path check.** It runs against the per-task baseline, after verification and before `markDone`. It includes untracked files and both sides of renames. Matching is case-insensitive on macOS, using globs (today only `startsWith` exists). The list is built-in ∪ project, add-only, unlike `neverCommit` which replaces. The built-in list must also cover files that control the harness: `.openspec-cascade.json`, `.claude/`, `.github/workflows/` and `package.json` scripts. A gitignored `.env` is invisible to git status, so the sandbox remains the first line of defense.
- **`DECISION:` is audit-only, not a gate.** Code only enforces paths, so the design must say so plainly. Decisions are collected across all attempts. They must be stored durably in the change (a commit trailer or `decisions.md`), because the run context is in memory only.
- **The log keeps 500 characters per agent message** (`constants.ts:179`). The question, the decisions and the failure must come from the full `outcome.result` and be written to the parked file.
- **Existing flags.** Parking replaces or redefines `--resilient`; do not add a third "continue" flag. Parking with `--no-rollback` is a config error.

### Inventive alternatives (ideal final result)

The inventive lens says all four tensions come from one choice: treating a human decision as something that happens during the run. Its ideal is a build-system model:

- A read-only pre-flight pass lists predictable questions before the human leaves.
- At night, reversible choices become recorded defaults (`D-007`), and commits that rely on them carry `Assumes: D-007`.
- In the morning, overriding a default rebuilds only the commits that depend on it.
- Parked work keeps the diagnosis, or a git ref, not a loose patch.

This is the long-term direction, not this change. The pre-flight question harvest overlaps with piece 3 (`/cascade:explore`).

### Zoom-out (smallest useful version)

About 70% exists behind `--resilient`. Smallest version (one PR, about 100-200 lines plus tests):

1. Fix the per-task baseline.
2. Route BLOCKED through the parking path (v1 only).
3. Write `parked/<task>.md` after the rollback and commit it.
4. Apply the section barrier to the rest of the section.
5. Add a parked status, an exit code and parked tasks in the existing final report.
6. On relaunch, skip unanswered parked tasks and retry answered ones with the parked file in the prompt.

Deferred until a real run shows the need:

- `Depends:`
- the K brake
- `--3way` apply
- `DECISION:` enforcement
- `sensitivePaths`
- the N-decisions flag

## Goals vs. Non-Goals

* **In-Scope Goals:**
  - Parking for `BLOCKED:` and exhausted attempts in v1, with a committed `parked/<task>.md` in a defined format.
  - A section barrier for the tasks that follow.
  - Relaunch semantics: unanswered parks cost zero sessions, answered ones are retried, and running twice with no new answers changes nothing.
  - A `parked` status, a dedicated exit code, and parked tasks in the final summary, written to a file in the change.
  - Deterministic tests with a scripted fake engine and a real temporary git repo.
* **Out-of-Scope Non-Goals:**
  - v2 mode.
  - Porting the v2 DAG.
  - The per-task rollback baseline. It is a prerequisite change, not part of this one.
  - Deferred: `Depends:`, the K brake, `git apply --3way`, `DECISION:` and sensitive paths (moved to `autonomy-guard`).
  - The verification contract (which commands count; fast-track vs. `Verify:`). That is a separate, earlier change.
  - The pre-flight question harvest (piece 3).
  - Goldfish inside the run.

## Alternatives Weighed

- **Keep BLOCKED fatal and rely on `--resilient` for failures.** Rejected: BLOCKED is the main reason an unattended run stops, and `--resilient` leaves no record for the human.
- **Reuse v2 escalation/DAG (`src/core`).** Rejected: it ties the contract to code the roadmap plans to prune, and the v2 DAG port was already discarded.
- **Auto-apply the parked patch on resume as a requirement.** Rejected: the patch never passed verification and the tree has moved. It stays a hint, with `--check` first.
- **Store the parked patch as a git ref (`refs/parked/...`).** Open, an inventive-lens suggestion: better rebasing, but hidden refs need cleanup and pushing. A committed `.patch` plus a recorded base commit is simpler.
- **Answer by editing `tasks.md` instead of a parked file.** Rejected as the main path: renumbering orphans answers, and editing the task text makes the spec-gate review stamp stale. Editing the task text stays a supported alternative.

## Key Decisions & Staging for Next Steps

Decided by the author on 2026-11-16:

1. **Scope: the smallest version.** This change covers six things:
   - parking for `BLOCKED:` and exhausted attempts (v1 only);
   - a committed `parked/<task>.md` in a defined format, written after the rollback;
   - a section barrier;
   - relaunch semantics: unanswered parks cost zero sessions, answered ones are retried with the parked file in the prompt;
   - a `parked` status and a dedicated exit code;
   - parked tasks in the final summary.

   Deferred until a real run shows the need: `Depends:`, the K brake, `git apply --3way`, `DECISION:` enforcement, `sensitivePaths` and the N-decisions flag. The saved patch is kept for the human and mentioned in the prompt, never applied automatically.
2. **The per-task baseline fix is its own small change, before this one.** It fixes the live `--resilient` bug, and this change depends on it.
3. **Parking replaces `--resilient`.** No third "continue" flag. The design states what happens to the old flag (alias or removal).
4. **Exit code 3** means "finished with parked tasks".
5. **The summary is a file in the change, and is also printed.** This closes the roadmap's open question about where the morning summary lives.

Staging:

1. `verify-contract`: only `Verify:` lines are verification, and fast-track never skips an explicit `Verify:`.
2. Per-task rollback baseline, so rollback restores the tree at task start rather than HEAD.
3. `autonomy-contract`: this brief, smallest version.
4. `autonomy-guard`: `DECISION:` and sensitive paths, with the review findings already recorded here. These are:
   - no secret content in patches;
   - an approval path for sensitive parks;
   - harness-control files in the built-in list;
   - glob matching.

Long-term direction, not scheduled: the inventive lens's build-system model. Questions are asked before the run (overlaps with piece 3), reversible defaults are recorded during the run, and overriding a default rebuilds only the commits that depend on it.
