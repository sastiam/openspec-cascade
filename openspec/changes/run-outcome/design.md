# Design

## Context

See `openspec/changes/autonomy-contract/brief.md` for the brainstorm, the seven-lens review and the scope decided on 2026-11-16. This change is **v1 only**: v2 mode is being deprecated, and `src/facade/v2_pipeline.ts` is not touched.

The code facts this design relies on:

- **Rollback.** `RollbackStateBuffer.snapshot()` stores only the HEAD SHA (`src/engine/rollback_buffer.ts:513`). `rollback()` runs `git reset --hard <sha>` and `git clean -fd` with exclude flags (`:386-422`). The facade passes `config.neverCommit` plus `V2_PIPELINE_CONSTANTS.WORKSPACE_EXCLUDES` as excludes (`src/facade/cascade_facade.ts:623-631`), and the buffer adds its own `ROLLBACK_CONSTANTS` protected directories.
- **`runTask`** (`cascade_facade.ts:600-744`):
  - a `BLOCKED:` reply throws `Fatal` (`:657-658`);
  - exhausted attempts roll back when `rollbackOnFailure` is set and throw `TaskFailureError` (`:725-743`).
- **`runChange`** (`:746-797`):
  - the loop picks the first unchecked task that is not in the local `skipped` set (`:760`);
  - with `resilient`, a `TaskFailureError` adds the task to `skipped` (`:779-791`);
  - `skipped` also feeds `skippedHumanTasks` (`:765`), which is why failures print as human tasks.
- **Commits.** `commitChanges` runs `git add -A -- . :!<excludes>` and commits everything staged (`:582-598`). In section mode, only the last task of a section commits (`:707-716`).
- **Preflight** fails on a dirty tree, ignoring `neverCommit` and `WORKSPACE_EXCLUDES` (`:443-456`).
- **Report and exit codes.** `execute()` prints the final report (`:336-344`). `run()` maps errors to exit 1 (crash) or 2 (fail-closed) (`:233-249`). `EXIT_CODE_CONSTANTS` (`src/config/constants.ts:9-16`) has no 3.
- **Config.** `resilient` comes from `--resilient`, `--continue-on-failure`, `CASCADE_RESILIENT`, `CASCADE_CONTINUE_ON_FAILURE` or the file key. It is resolved by `resolveResilientValue` (`src/config/loader.ts:474-500`, `:750`). `rollbackOnFailure` is resolved at `:740`. The final config is validated by `parseWithConfigError` (`:812`), and `ConfigValidationError` exits 2.
- **spec-gate.** Stages and files are in `SPEC_GATE_CONSTANTS.STAGES` and `FILE_BY_STAGE` (`constants.ts:504-532`). The marker keys are `egm`, `status` and `hash` (`MARKER_KEYS`). `evaluateStage` checks presence, status and the change hash (`src/sdd/spec_marker.ts:105-113`).
- **Greptile.** `GreptileReviewResult.confidence` is optional (`src/integration/greptile/client.ts:37`). The bridge drops it: `CachedReview` has no `confidence`, and `isCachedReview` does not know it (`src/integration/greptile/bridge.ts:18-54`, `:125-131`).
- **Pre-PR loop.** `PrePrReviewLoop` (`src/core/pre_pr_loop.ts:44-97`) is driven today by `reviewCommand` (`src/cli/commands.ts:201-237`), which builds its own engine and gives the fixer no budget or settings. Its statuses are clean, needs_human, exhausted, stale, mismatch and empty. `maxRounds` is clamped to `PRE_PR_CONSTANTS.MAX_ROUNDS` (3).
- **Existing `src/core` imports.** The facade already imports `src/core/harness_injector` and `src/core/self_improver` (`cascade_facade.ts:37-38`).

## Goals / Non-Goals

**Goals:**
- A correct per-task rollback baseline.
- Parking with a stable file format, committed with path-limited commits.
- A run summary and a stated exit code mapping.
- `status`.
- Greptile before the PR, with a recorded report and a HEAD-bound stamp.

**Non-Goals:**
- v2 mode (being deprecated).
- The K brake, `Depends:`, `DECISION:` and sensitive paths (`autonomy-guard`).
- Applying parked patches.
- Changing forja.

## Scope decisions (2026-11-17, user decision)

- The per-task baseline fix, `status` and the Greptile gate are part of this change, although the brief kept the baseline fix separate and did not cover the other two.
- This change ships in one PR together with four sibling changes, including `verify-contract` and `tasks-contract`. `parseManualSteps` comes from `tasks-contract`.
- From the brief's dropped items, "print what was read on relaunch" is restored in a simple form: one line per parked task (answered, waiting for answer, stale).
- The reserved answers `retry` and `skip` stay dropped. Any non-empty answer already means retry. Skipping is done by checking the task in `tasks.md`. `approve` belongs to `autonomy-guard`.

## Decisions

Each decision states the choice and the reason. Decisions are grouped by capability.

### task-parking

**D1. Tree snapshot through a temporary index.**
- Choice: `snapshot()` keeps the HEAD SHA and also records a tree. It creates a temporary index file under the git directory with a unique name (`<git-dir>/cascade-index-<uuid>`), seeds it from HEAD with `git read-tree HEAD`, runs `git add -A -- . :!<excludes>` with `GIT_INDEX_FILE` set, and runs `git write-tree`. The temporary index is removed in a `finally` block, also on failure.
- Why: the tree holds tracked, modified and untracked files without creating a commit or touching the real index.

**D2. Tree restore with `read-tree -u --reset`.**
- Choice: `rollback()` resets to the HEAD SHA and cleans with the excludes, as today. It then runs `git read-tree -u --reset <tree>` on the real index, which makes the working tree match the snapshot tree, and `git reset -q` (mixed), which puts the real index back on HEAD and leaves the files alone.
- Why: unlike `checkout-index`, `read-tree -u` removes files that are in HEAD but not in the tree, so files deleted before the task stay deleted. The checked boxes of earlier tasks live in `tasks.md`, so they come back with the tree.
- Ignored files are not in the tree and are not removed by `git clean -fd` (no `-x`), so ignored files created by the task survive a rollback. This is accepted and documented.

**D3. Exclude lists.**
- Rollback, snapshot and harness commits use the facade's list: `config.neverCommit` plus `V2_PIPELINE_CONSTANTS.WORKSPACE_EXCLUDES`. The rollback buffer adds its `ROLLBACK_CONSTANTS` protected directories. None of these covers the change folder, so `tasks.md` and `parked/` are part of the snapshot.
- The patch (D6) uses the same list plus the change folder `openspec/changes/<change>/` plus `PARK_CONSTANTS.PATCH_SECRET_GLOBS`.

**D4. Parking needs rollback.**
- Choice: when parking is on and `rollbackOnFailure` is false, `loadConfig` throws `ConfigValidationError` (exit 2).
- Why: without a rollback, the parked task's half-done work would land in the next commit.

**D5. `runTask` returns a result.**
- Choice: `runTask` returns `{status: "done"}` or `{status: "parked", kind, reason, failureText, attempts}`. Only run-level failures throw: engine fatal, budget, commit failure and a failed rollback. `runChange` owns the loop. With parking off, `runChange` turns a parked result back into today's `Fatal` and `TaskFailureError`, so behavior is unchanged.
- Why: parking is a normal outcome, not an error.

**D6. Patch capture, with an interim secret rule.**
- Choice: `src/park/patch.ts` builds the current tree through a temporary index (as in D1) and runs `git diff --binary <startTree> <currentTree>` with the exclude list of D3. It leaves out any path matching `PARK_CONSTANTS.PATCH_SECRET_GLOBS` (`.env*`, `*.pem`, `*.key`, `*.p12`) or `config.neverCommit`, and returns those paths by name so the parked file lists them. An empty diff writes no patch file.
- Why: the patch is committed and pushed, and the default `neverCommit` does not cover `.env*`. This rule is interim: `autonomy-guard` follows and owns sensitive paths.

**D7. Order of steps when parking.**
1. Capture the patch against the task-start tree (kept in memory).
2. Roll back to the task-start tree.
3. If the tree now differs from HEAD (outside the excludes), commit it through `commitChanges` as `chore(<change>): <section title> (partial, <task> parked)`. This is the verified but uncommitted work of earlier tasks. It applies in both commit modes; in section mode it is the earlier tasks of the section.
4. Write `parked/<task>.md` and `parked/<task>.patch`.
5. Commit only those paths: `git add -- <paths>` then `git commit -m "chore(<change>): park <task>" -- <paths>`.

Why: the partial commit keeps verified work out of later sections' commits and leaves the next run a clean tree. A later rollback can never delete committed parked files, and no `git add -A` can sweep them into another commit.

**D8. Path-limited harness commits.**
- Every commit the harness makes for its own records (parked files, `run-summary.md`, `code-review.md`) stages and commits only the named paths (`git add -- <paths>`, `git commit -- <paths>`). Deletions use `git rm -- <paths>`. They never use `git add -A`.

**D9. Parked file format.**
- Choice: `src/park/format.ts` is pure. It writes and parses a header (`format`, `task`, `kind`, `task-hash`, `attempts`, `parked-at`, `rounds`), one `## Round <n> (<kind>, <date>)` section per park, and a final `## Answer` section. When a new round is appended, the previous answer moves into its round as `### Answer` and the final `## Answer` is emptied. The spec gives a two-round example.
- `task-hash` is the sha256 of `Task.text` as returned by `parseTasks` (`src/facade/tasks.ts:24`).
- Failure text is capped at `PARK_CONSTANTS.FAILURE_MAX_CHARS = 20000`, keeping the last characters, with the note "Output truncated to the last 20000 characters."
- Failure text source: the last verification output. When there is none, the last session result, else the session error reason. It never comes from the jsonl log, which truncates to 500 characters.

**D10. Parked state and stale files.**
- `src/park/state.ts` reads `parked/*.md` for a change and returns, per file, `{task, kind, answered, stale, path}`.
- A file is stale when its task id is missing from `tasks.md`, the task is checked, or the `task-hash` differs. A stale file is ignored for scheduling (the task runs or stays done as if not parked), is reported as stale in the summary and in `status`, and never makes a task skip.

**D11. Waiting tasks are derived, never stored.**
- At the start of each change and after each park, `runChange` builds the parked set from `state.ts` plus the parks of this run.
- A task waits when an earlier unchecked task in its section is parked (answered or not). A task in a later section never waits.

**D12. Resume.**
- On relaunch, the harness prints one line per parked file: `<task>: answered`, `<task>: waiting for answer` or `<task>: stale (<why>)`.
- An unanswered parked task is skipped without a session. An answered one runs with the parked file text and the patch path appended after `taskPrompt` and before the remediation directives.
- When a resumed task passes, its parked files are removed with `git rm` before the commit that holds its work: its own commit, or the section commit in section mode.
- A resumed task that parks again appends a round.

### run-summary

**D13. One pure renderer, written in a `finally` path.**
- `src/park/summary.ts` exports `renderRunSummary(changeReport, startedAt, outcome)`. It feeds both the console and the file.
- `execute()` writes the summary in a `finally` block, so it is also written when the run stops on budget, engine fatal or commit failure. The outcome is `ok`, `partial` or `stopped: <reason>`. It is skipped for dry runs and after a failed rollback, because the tree state is then unknown.
- The section is appended to each change's `run-summary.md` and committed path-limited as `chore(<change>): record run summary`, only when something ran or changed in that change. A failed summary commit is printed and does not change the exit code.
- Manual steps come from `parseManualSteps` (`tasks-contract`).

**D14. Statuses and exit codes.**
- `TaskRunRecord.status` gains `"parked"` and `"waiting"`. `ChangeStatus` gains `"partial"`: at least one task parked or waiting at the end of the run. `skippedHumanTasks` keeps only human-task skips.
- Exit codes: 0 everything done, 1 crash, 2 fatal or fail-closed, 3 parked or waiting tasks without a run-level error. The signal codes 124, 130 and 143 are unchanged. 3 is `EXIT_CODE_CONSTANTS.EXIT_CODE_PARKED`.

### change-status

**D15. Pure rules, impure facts.**
- `src/status/next_step.ts` exports the pure `nextStep(facts): {stage, command, reason}`.
- `src/status/facts.ts` exports `gatherFacts(repo, change, config)`, which reads the repo: folder and archive presence, files present, task findings through `lintTasks`, stamp results through the spec-gate evaluation functions (including the HEAD check), the parked state and unchecked tasks.
- `src/cli/status.ts` follows the `spec_gate.ts` pattern and is registered as a subcommand.

### code-review-gate

**D16. Confidence flows through the bridge.**
- `CachedReview` and `GreptileBridgeResult` gain `confidence?: number`. The bridge copies it from the client result, and `isCachedReview` accepts it when absent or a number. A cached review without it counts as "not reported".
- The facade's review source captures the confidence of the last review it returned. `pre_pr_loop.ts` is not changed.

**D17. Shared factory and renderer.**
- `src/review/factory.ts` builds the bridge and the `PrePrReviewLoop` from a client, a repo, a base, rounds and a fixer session function. `reviewCommand` and the facade both use it; `reviewCommand` output and exit codes do not change.
- `src/review/render.ts` exports the pure `renderCodeReview(result, context)`.

**D18. The review step.**
- Config: `codeReview` is a strict optional object in the file schema, with `afterRun` (boolean), `base` (string, default `main`), `rounds` (integer from 1 to `PRE_PR_CONSTANTS.MAX_ROUNDS`, default that maximum, higher values rejected) and `minConfidence` (optional number). It is file-only, with no flag.
- It runs in `run()` after `execute()` returns with outcome 0, after the run summary commit, so its commit is the last one.
- Before the loop it records the HEAD SHA and a tree snapshot (D1).
- The fixer goes through the facade's `runSession`, so it uses the run's engine, `config.settings`, budget accounting and logging.
- After the loop: if HEAD moved (the fixer committed), or `alwaysVerify` plus `defaultVerify` fail, the harness resets to the pre-review HEAD and restores the pre-review tree, and records why. If the tree changed and the checks pass, it commits `fix: apply Greptile review fixes`.
- Any error in the step, including a budget stop, restores the pre-review state, is written to the report, leaves the stamp `open`, and does not change the exit code.
- The fake Greptile client is injected through `CascadeFacadeDependencies.greptileClient`; the engine is already injectable through `CascadeFacadeDependencies.engine`.

**D19. One branch-wide review, written to every change.**
- The review covers the branch diff against `codeReview.base`, so it is the same for every change of the run. The same content is written to each change's `code-review.md`. This duplication is deliberate: each change carries its own record and stamp.

**D20. Stamp before commit, bound to HEAD.**
- The harness renders `code-review.md`, stamps it (status, change hash and `head: <reviewed HEAD SHA>`), then commits each change's file in a single path-limited `chore(<change>): record code review` commit. There is no separate stamp commit, and the tree is clean afterwards.
- The marker for stage `code-review` gains the key `head`. Freshness: the stamp is stale when the change hash differs, or when HEAD differs from `head` in any path other than `code-review.md` files (`git diff --name-only <head> HEAD`), or when `head` is not a known commit. This allows the stamp's own record commit without allowing any code change.

### spec-gate

**D21. One more stage.**
- `code-review` is added to `STAGES` and `FILE_BY_STAGE`, and `head` to `MARKER_KEYS`. `spec-gate stamp --stage code-review` writes the current HEAD. `spec-gate check --stage code-review` applies D20 and reports `stale` when it fails. The rules for `review` and `drift` are unchanged.

### Recorded exception

**D22. The facade calls `src/core/pre_pr_loop.ts`.**
- The brief said new code must not import from `src/core`. This change accepts one exception: the facade (through `src/review/factory.ts`) uses `PrePrReviewLoop`. Pruning `src/core` must keep `pre_pr_loop.ts`. It is not moved in this change.

## Alternatives Considered

- **`git stash create` vs a temporary-index tree.** `stash create` skips untracked files unless combined with other steps, and its commit object is easy to confuse with the user's stashes. Chosen: temporary-index `write-tree`.
- **Git ref (`refs/parked/...`) vs committed patch.** A ref rebases better but needs cleanup and pushing, and is invisible in the PR. Chosen: committed `.patch` next to the parked file.
- **Stored vs derived state.** Storing waiting tasks and parked state in a state file drifts from `tasks.md`. Chosen: derived on every run from `tasks.md` and `parked/`.
- **Greptile inside the facade vs a separate step.** A separate command after the run would need forja changes and would lose the run's engine, budget and settings. Chosen: inside the facade, after the summary, opt-in.
- **Per-branch vs per-change report.** One report at the branch level has no change folder to live in and no stamp. Chosen: the same branch-wide review written to each change.
- **Exit code vs JSON outcome.** A JSON file is richer but every caller would need to parse it. Chosen: exit code 3, with `run-summary.md` and `status --json` for detail.
- **Commit every task vs tree snapshot.** Committing each task fixes the baseline too, but changes commit granularity for section-mode users. Chosen: tree snapshot, plus a partial commit only when a task parks.
- **`checkout-index` vs `read-tree -u --reset` for restore.** `checkout-index` does not delete files removed before the task. Chosen: `read-tree -u --reset` then `git reset -q`.

## Risks / Trade-offs

- [Ignored files created by a task survive rollback] → Documented. The sandbox stays the first line of defense.
- [Exit code 3 surprises callers] → Documented. `forja wt night` prints any non-zero exit as a failure, and a follow-up in forja can map 3 to "needs answers".
- [Greptile is unavailable or unauthenticated at night] → The error goes into `code-review.md`, the stamp is `open`, and the exit code is unchanged.
- [Large failure output] → Capped at 20000 characters, and the cap is noted.
- [Interim secret rule misses a secret file name] → `autonomy-guard` follows with sensitive paths; until then only the four patterns plus `neverCommit` are left out.
- [Summary commit fails after a commit failure] → The file stays written and the error is printed; the next run's preflight then reports the dirty tree.

## Migration Plan

- Existing `--resilient` users: a failed task now leaves `parked/<task>.md`, a patch, a park commit and possibly a partial commit, and the run exits 3 instead of 0. The run summary is committed to each change.
- `--resilient --no-rollback` (or `rollbackOnFailure: false` with parking on) now fails at load with exit 2. Drop one of the two settings.
- `forja wt night` prints any non-zero exit, including 3, as a failure until forja maps 3. The docs say so.
- Users without `--resilient` and without `codeReview` see only the new summary file, the final report layout and the per-task baseline fix.
- Existing `review.md` and `drift.md` stamps keep working; only `code-review` uses the `head` key.

## Open Questions

None.
