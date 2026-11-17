# Design

## Context

See `openspec/changes/autonomy-contract/brief.md` for the brainstorm, the seven-lens review and the scope decided on 2026-11-16. This change is **v1 only**: v2 mode is being deprecated, and `src/facade/v2_pipeline.ts` is not touched.

This change runs in a second unattended run, after `verify-contract`, `tasks-contract`, `project-manifest` and `cascade-explore` are implemented on the same branch. It relies on `alwaysVerify` and `taskChecks` (`verify-contract`), `parseManualSteps` and the tasks linter rules (`tasks-contract`), and the docs-parity rules of `test/docs/cli_docs.test.ts`.

The code facts this design relies on:

- **Rollback.** `RollbackStateBuffer.snapshot()` stores only the HEAD SHA (`src/engine/rollback_buffer.ts:513`). `rollback(targetRefOverride?, optionsOverride?)` (`:612`) calls `rollbackWorkingTree`, which runs `git reset --hard <sha>` and `git clean -fd` with exclude flags (`:386-422`). Commands go through a string `CommandRunner` that tests replace with mocks.
- **The buffer is shared.** Besides the v1 facade (`src/facade/cascade_facade.ts:623-631`), `src/facade/v2_pipeline.ts:234` and `src/gates/gate3_audit.ts` create a `RollbackStateBuffer`. `test/engine/rollback.test.ts`, `test/gates/gate3.test.ts` and `resilience.test.ts` assert its audit trail and the exact commands sent to mock runners.
- **Audit-log backup.** `rollbackWorkingTree` reads registered audit logs into memory before the reset and writes them back after the clean (`:370-435`). This is the only existing pattern for keeping a tracked file across a hard reset.
- **Temporary-index snapshot.** `ShadowCommitManager` (`src/integration/greptile/shadow.ts`) already builds a tree of the working tree through an isolated `GIT_INDEX_FILE` in a temporary directory: `read-tree HEAD`, `add -A` with `:(exclude)` pathspecs, `write-tree` (private `snapshot()`, `:128-151`). `workingTreeDiff()` (`:104`) diffs that snapshot against a ref. The exclusions are fixed to `GREPTILE_CONSTANTS.SHADOW_EXCLUDED_PATHS`.
- **`runTask`** (`cascade_facade.ts:600-744`):
  - a `BLOCKED:` reply throws `Fatal` (`:657-658`);
  - exhausted attempts roll back when `rollbackOnFailure` is set and throw `TaskFailureError` (`:725-743`); a failed rollback is only printed.
  - verification failures come from `runVerificationPhase` (`qa.ts`) as `failures[]` with `command`, `exitCode` and raw `output`.
- **`runChange`** (`:746-797`):
  - the loop picks the first unchecked task that is not in the local `skipped` set (`:760`);
  - with `resilient`, a `TaskFailureError` adds the task to `skipped` (`:779-791`);
  - `skipped` also feeds `skippedHumanTasks` (`:765`), which is why failures print as human tasks.
- **Commits.** `commitChanges` runs `git add -A -- . :!<excludes>` and commits everything staged (`:582-598`). In section mode, only the last task of a section commits (`:707-716`). Messages are cut to `CONSTANTS.COMMIT_MESSAGE_MAX_LENGTH` (100).
- **Preflight** fails on a dirty tree, ignoring `neverCommit` and `WORKSPACE_EXCLUDES` (`:443-456`).
- **Report and exit codes.** `execute()` prints the final report (`:336-344`). `run()` maps errors to exit 1 (crash) or 2 (fail-closed) (`:233-249`). `EXIT_CODE_CONSTANTS` (`src/config/constants.ts:9-16`) has no 3.
- **Config.** `resilient` comes from `--resilient`, `--continue-on-failure`, `CASCADE_RESILIENT`, `CASCADE_CONTINUE_ON_FAILURE` or the file key. It is resolved by `resolveResilientValue` (`src/config/loader.ts:474-500`, `:750`). `rollbackOnFailure` comes from `--rollback`/`--no-rollback`, `CASCADE_ROLLBACK_ON_FAILURE`, `CASCADE_GIT_ROLLBACK` or the file key, resolved at `:740-745`. The final config is validated by `parseWithConfigError` (`:812`), and `ConfigValidationError` exits 2. A config key lives in four places: the `CascadeConfig` interface, `CascadeConfigSchema` (resolved), `CascadeFileConfigSchema` (strict file schema), all in `src/config/schemas.ts`, and `candidateConfig` in `loadConfig` (`src/config/loader.ts`).
- **spec-gate.** Stages and files are in `SPEC_GATE_CONSTANTS.STAGES` and `FILE_BY_STAGE` (`constants.ts:504-532`). The marker keys are `egm`, `status` and `hash` (`MARKER_KEYS`). `evaluateStage` checks presence, status and the change hash (`src/sdd/spec_marker.ts:105-113`) and is synchronous. `folderFailureOf` (`src/cli/spec_gate.ts:59`) is private.
- **Greptile.** `GreptileReviewResult.confidence` is optional (`src/integration/greptile/client.ts:37`). The bridge drops it: `CachedReview` has no `confidence`, and `isCachedReview` does not know it (`src/integration/greptile/bridge.ts:18-54`, `:125-131`). The bridge discards a review faster than `SDD_CONSTANTS.SDD_MIN_REVIEW_DURATION_SECONDS` (`bridge.ts:112-122`).
- **Pre-PR loop.** `PrePrReviewLoop` (`src/core/pre_pr_loop.ts:44-97`) is driven today by `reviewCommand` (`src/cli/commands.ts:201-237`), which builds its own engine and gives the fixer no budget or settings. Its statuses are clean, needs_human, exhausted, stale, mismatch and empty. `maxRounds` is clamped to `PRE_PR_CONSTANTS.MAX_ROUNDS` (3). `reviewCommand` does not read `greptile.enabled`, `greptile.timeoutMs` or `greptile.cacheDir`.
- **Default checks.** `verifyCommands` falls back to `config.defaultVerify`, else the detected package manager's test and lint commands, else `CONSTANTS.DEFAULT_VERIFY` (`src/facade/tasks.ts:87-89`).
- **Existing `src/core` imports.** The facade already imports `src/core/harness_injector` and `src/core/self_improver` (`cascade_facade.ts:37-38`).
- **Tests that this change breaks on purpose.** `test/e2e/tier3_combinations/cli_stack_pm_combinations.test.ts` runs `--no-rollback --resilient --dry-run` expecting exit 0 (lines ~35-60) and expects `rollbackOnFailure: false` with `resilient: true` from `CASCADE_GIT_ROLLBACK=false` plus `CASCADE_CONTINUE_ON_FAILURE=true` (~95-107). `test/facade/cascade_facade.test.ts` (~124) asserts that `git log -1` is the feat commit; the summary commit now comes after it.

## Goals / Non-Goals

**Goals:**
- A correct per-task rollback baseline for v1, without changing the buffer's behavior for v2 and gate 3.
- Parking with a stable file format, committed with path-limited commits.
- A run summary and a stated exit code mapping.
- `status`.
- Greptile before the PR, with a recorded report and a HEAD-bound stamp.

**Non-Goals:**
- v2 mode (being deprecated).
- The K brake, `Depends:`, `DECISION:` and sensitive paths (`autonomy-guard`).
- Applying parked patches.
- Keeping tracked excluded files (such as a tracked `.atl`) across a rollback.
- Changing forja.

## Scope decisions (2026-11-17, user decision)

- The per-task baseline fix, `status` and the Greptile gate are part of this change, although the brief kept the baseline fix separate and did not cover the other two.
- This change ships in one PR together with four sibling changes: `verify-contract`, `tasks-contract`, `project-manifest` and `cascade-explore`. It is implemented after them on the same branch.
- From the brief's dropped items, "print what was read on relaunch" is restored in a simple form: one line per parked task (answered, waiting for answer, stale).
- The reserved answers `retry` and `skip` stay dropped. Any non-empty answer already means retry. Skipping is done by checking the task in `tasks.md`. `approve` belongs to `autonomy-guard`.

## Decisions

Each decision states the choice and the reason. Decisions are grouped by capability.

### task-parking

**D1. Tree snapshot, opt-in, through the shadow temp index.**
- Choice: `ShadowCommitManager` gains a public `snapshotTree(repoPath, excludes): Promise<string>` that returns the tree SHA. It reuses the private `snapshot()` steps (temp directory index, `read-tree HEAD`, `add -A -- . :(exclude)<path>...`, `write-tree`) with a caller-given exclude list, creates no commit and no ref, and removes the temp directory in `finally`. The private `snapshot()` calls it with `SHADOW_EXCLUDED_PATHS`, so the Greptile path is unchanged.
- `RollbackBufferOptions` gains `restoreTree?: boolean` (default false) and `shadow?: ShadowCommitManager`. Only the v1 facade sets `restoreTree: true`. With it on, `snapshot()` also calls `snapshotTree(cwd, excludes)` and keeps the tree SHA.
- A failed tree capture never throws: the buffer calls `hooks.log("rollback_tree_snapshot_failed", {error})`, keeps no tree and falls back to HEAD-only rollback. The tree capture adds no audit entries; the existing snapshot audit entry is unchanged.
- Why: v2 and gate 3 keep exactly today's commands and audit trail, so their mock-runner tests keep passing. Reusing `ShadowCommitManager` avoids a second temp-index implementation and an inline `GIT_INDEX_FILE=... git ...` shell prefix through the string runner, which would be hard to quote and to mock.
- Alternative: an inline `GIT_INDEX_FILE` prefix through the buffer's `CommandRunner`. Rejected for the reasons above.

**D2. Tree restore with `read-tree -u --reset`.**
- Choice: `rollback()` resets to the HEAD SHA and cleans with the excludes, as today. When a tree was recorded, and no `targetRefOverride` is passed, it then runs `git read-tree -u --reset <tree>` on the real index through the buffer's runner, which makes the working tree match the snapshot tree, and `git reset -q` (mixed), which puts the real index back on HEAD and leaves the files alone. An explicit `targetRefOverride` means the caller wants that ref, so the tree restore is skipped.
- A failure of either restore command makes `rollback()` return `success: false` with the error, like a failed reset.
- Why: unlike `checkout-index`, `read-tree -u` removes files that are in HEAD but not in the tree, so files deleted before the task stay deleted. The checked boxes of earlier tasks live in `tasks.md`, so they come back with the tree.
- Ignored files are not in the tree and are not removed by `git clean -fd` (no `-x`), so ignored files created by the task survive a rollback. This is accepted and documented.

**D3. Exclude lists and what they protect.**
- Rollback, snapshot and harness commits use the facade's list: `config.neverCommit` plus `V2_PIPELINE_CONSTANTS.WORKSPACE_EXCLUDES`. The rollback buffer adds its `ROLLBACK_CONSTANTS` protected directories. None of these covers the change folder, so `tasks.md` and `parked/` are part of the snapshot.
- Choice: the guarantee covers **untracked** excluded paths only. `git reset --hard` reverts tracked files, excluded or not, as it does today, and the snapshot tree holds HEAD's version of tracked excluded paths. No backup of tracked excluded paths is added.
- Why: the audit-log backup in `rollback_buffer.ts` could be copied for tracked excluded paths, but it holds whole files in memory and is a separate feature. Excluded paths such as `.atl` are untracked in practice. The docs state the limit.
- The patch (D6) uses the same list plus the change folder `openspec/changes/<change>/` plus `PARK_CONSTANTS.PATCH_SECRET_GLOBS`.

**D4. Parking needs rollback.**
- Choice: when parking is on and `rollbackOnFailure` is false (from any of its sources, including `CASCADE_GIT_ROLLBACK`), `loadConfig` throws `ConfigValidationError` (exit 2).
- Why: without a rollback, the parked task's half-done work would land in the next commit.

**D5. `runTask` returns a result.**
- Choice: `runTask` returns `{status: "done", commit?}` or `{status: "parked", kind, reason, failureText, attempts, patch, leftOut}`. Before returning a parked result, it captures the patch (D6) and rolls back (D7 steps 1 and 2). Only run-level failures throw: engine fatal, budget, commit failure and a failed rollback. `runChange` owns the loop. With parking off, `runChange` turns a parked result back into today's `Fatal` and `TaskFailureError`, so behavior is unchanged.
- A failed rollback throws `RollbackFailedError` (new, in `resilience.ts` next to `TaskFailureError`, extends `Fatal`, so it is fail-closed and exits 2). It is thrown with parking on or off; today a failed rollback is only printed.
- Why: parking is a normal outcome, not an error.

**D6. Patch capture, with an interim secret rule.**
- Choice: `src/park/patch.ts` exports `capturePatch({repo, startTree, change, excludes, shadow}): Promise<{patch: string | undefined, leftOut: string[]}>`. It writes nothing. It takes the current tree with `shadow.snapshotTree(repo, excludes)` and runs:
  - `git diff --binary <startTree> <currentTree> -- . :(exclude)openspec/changes/<change> :(glob,exclude)**/.env* :(glob,exclude)**/*.pem :(glob,exclude)**/*.key :(glob,exclude)**/*.p12` for the patch;
  - `git diff --name-only <startTree> <currentTree> -- :(glob)**/.env* ...` for `leftOut`.
- `PARK_CONSTANTS.PATCH_SECRET_GLOBS` holds the four patterns as `**/` globs, so they match at any depth. `neverCommit` and the other excludes are never in either tree, so they never reach the patch and are not listed.
- An empty diff returns `patch: undefined`. The facade writes `parked/<task>.patch` only when a patch exists, after the rollback.
- Why: the patch is committed and pushed, and the default `neverCommit` does not cover `.env*`. This rule is interim: `autonomy-guard` follows and owns sensitive paths.

**D7. Order of steps when parking.**
1. `runTask` captures the patch against the task-start tree (kept in memory).
2. `runTask` rolls back to the task-start tree.
3. `runChange`: if the tree now differs from HEAD (outside the excludes and the change's `parked/` folder), commit it through `commitChanges` as `chore(<change>): <section title> (partial, <task> parked)`, cut to `COMMIT_MESSAGE_MAX_LENGTH`. This is the verified but uncommitted work of earlier tasks. It applies in both commit modes; in section mode it is the earlier tasks of the section. The change's `parked/` folder is passed as an extra exclude, so answers the user typed for other tasks are not swept in.
4. `runChange` writes `parked/<task>.md` and, when there is a patch, `parked/<task>.patch`.
5. `runChange` commits only those paths: `git add -- <paths>` then `git commit -m "chore(<change>): park <task>" -- <paths>`.

Why: the partial commit keeps verified work out of later sections' commits and leaves the next run a clean tree. A later rollback can never delete committed parked files, and no `git add -A` can sweep them into another commit.

**D8. Path-limited harness commits.**
- Every commit the harness makes for its own records (parked files, `run-summary.md`, `code-review.md`) stages and commits only the named paths (`git add -- <paths>`, `git commit -- <paths>`). Deletions use `git rm -- <paths>`. They never use `git add -A`.

**D9. Parked file format.**
- Choice: `src/park/format.ts` is pure. It writes and parses a header (`format`, `task`, `kind`, `task-hash`, `attempts`, `parked-at`, `rounds`), one `## Round <n> (<kind>, <date>)` section per park, and a final `## Answer` section. Each round starts with a `patch: parked/<task>.patch` or `patch: none` line and a `left-out: <comma-separated paths>` or `left-out: none` line, then the question or failure text. When a new round is appended, the previous answer moves into its round as `### Answer` and the final `## Answer` is emptied. The spec gives a two-round example.
- Dates are ISO 8601 UTC with seconds and `Z`, no milliseconds (`2026-11-17T03:10:00Z`).
- `task-hash` is the sha256 of `Task.text` as returned by `parseTasks` (`src/facade/tasks.ts:24`).
- Failure text: for a failed check, the raw `failures[].output` of the last verification, each block headed by `$ <command> (exit <code>)`, blocks joined by a blank line. When there is no verification output, the last session result, else the session error reason. It never comes from the jsonl log, which truncates to 500 characters.
- The failure text is capped at `PARK_CONSTANTS.FAILURE_MAX_CHARS = 20000`, keeping the last characters, with the note "Output truncated to the last 20000 characters."

**D10. Parked state and stale files.**
- `src/park/state.ts` reads `parked/*.md` for a change and returns, per file, `{task, kind, answered, answer, stale, staleReason, path}`.
- A file is stale when its task id is missing from `tasks.md`, the task is checked, or the `task-hash` differs. A stale file is ignored for scheduling (the task runs or stays done as if not parked), is reported as stale in the summary and in `status`, and never makes a task skip.

**D11. Waiting tasks are derived, never stored.**
- At the start of each change and after each park, `runChange` builds the parked set from `state.ts` plus the parks of this run.
- A task waits when an earlier unchecked task in its section is parked (answered or not). A task in a later section never waits.

**D12. Resume.**
- On relaunch, the harness prints one line per parked file: `<task>: answered`, `<task>: waiting for answer` or `<task>: stale (<why>)`.
- An unanswered parked task is skipped without a session. An answered one runs with a resume block appended after `taskPrompt` and before the remediation directives. The block is built by `resumeContext(parkedText, patchPath)` in `src/facade/tasks.ts`:
  `This task was parked before. The parked file below holds the earlier rounds and the human answer under "## Answer". Use the answer. The patch of the earlier attempt is at <patchPath>; read it as a hint and do not apply it blindly.` followed by the parked file text. With no patch, the patch sentence reads `There is no patch of the earlier attempt.`
- Answering: the user edits `## Answer` and does not need to commit. Preflight treats uncommitted edits under `openspec/changes/<change>/parked/` of each listed change as allowed, like `neverCommit` paths. The docs say so.
- When a resumed task passes, its parked files are deleted from disk right after its checks pass. The deletion is staged by the next commit that holds its work (its own commit, or the section commit in section mode), because `commitChanges` stages with `git add -A`.
- A resumed task that parks again appends a round. Its rollback restores the start tree, which holds the answered file.

### run-summary

**D13. One pure renderer, written in a `finally` path.**
- `src/park/summary.ts` exports `renderRunSummary(changeReport, startedAt, outcome)`. It feeds both the console and the file.
- `execute()` writes the summary in a `finally` block, so it is also written when the run stops on budget, engine fatal or commit failure. The outcome is `ok`, `partial` or `stopped: <reason>`. It is skipped for dry runs and after `RollbackFailedError`, because the tree state is then unknown.
- The section is appended to each change's `run-summary.md` and committed path-limited as `chore(<change>): record run summary`, only when something ran or changed in that change. A failed summary commit is printed and does not change the exit code.
- Manual steps come from `parseManualSteps` (`tasks-contract`) applied to the change's `manual.md` text, or `[]` when there is no `manual.md`.

**D14. Records, statuses and exit codes.**
- `TaskRunRecord` gains `status: "parked" | "waiting"` (besides `done`, `failed`, `skipped`) and `commit?: string`. A task that commits records its commit SHA. In section mode, a done task that did not commit itself gets the SHA of the section commit, or of the partial commit when a later task of its section parks.
- `ChangeRunReport` gains `parked: {taskId, kind, firstLine, path}[]`, `waiting: {taskId, waitsOn}[]`, `stale: {path, reason}[]` and `manualSteps: {step, check}[]`.
- `ChangeStatus` gains `"partial"`: at least one task parked or waiting at the end of the run. `skippedHumanTasks` keeps only human-task skips.
- Exit codes: 0 everything done, 1 crash, 2 fatal or fail-closed, 3 parked or waiting tasks without a run-level error. The signal codes 124, 130 and 143 are unchanged. 3 is `EXIT_CODE_CONSTANTS.EXIT_CODE_PARKED`.

### change-status

**D15. Pure rules, impure facts.**
- `src/status/next_step.ts` exports the pure `nextStep(facts): {stage, command, reason}`.
- `src/status/facts.ts` exports `gatherFacts(repo, change, config)`, which reads the repo: folder and archive presence (through `folderFailureOf`, now exported from `src/cli/spec_gate.ts`), files present, task findings through `lintTasks`, stamp results through `evaluateStage` (including the HEAD check of D20), the parked state and unchecked tasks.
- `src/cli/status.ts` follows the `spec_gate.ts` pattern and is registered as a subcommand: `status <change> [--repo <path>] [--json]`. The positional change name is checked with `validChangeName`. It loads the config with `loadConfig({argv: ["--repo", repo], cwd: repo, env: process.env})` to read `codeReview.afterRun`. A `ConfigValidationError` or invalid usage exits 2.

Stages, commands and reasons:

| Stage | Command | Reason |
|---|---|---|
| `explore` | `/cascade:explore <change>` | `no change folder` or `no proposal.md` |
| `propose` | `/cascade:openspec-propose <change>` | `no tasks.md` |
| `fix-tasks` | `openspec-cascade lint-tasks --changes <change>` | `<n> task findings` |
| `spec-review` | `/cascade:cascade-spec-review <change>` | `review <missing\|open\|stale\|malformed> (review.md)` |
| `answer-parked` | `openspec-cascade --changes <change> --park` | `waiting for answer: <path>[, <path>...]` |
| `run` | `openspec-cascade --changes <change> --park` | `<n> unchecked tasks, next <id>` |
| `code-review` | `openspec-cascade --changes <change>` | `code-review <missing\|open\|stale\|malformed> (code-review.md)` |
| `drift` | `/cascade:cascade-spec-drift <change>` | `drift <missing\|open\|stale\|malformed> (drift.md)` |
| `archive` | `/cascade:openspec-archive-change <change>` | `all tasks done and stamps fresh` |
| `archived` | (empty string) | `archived at <archive path>` |

The `code-review` command reruns the change: with every task checked, the run exits 0 and the review step runs.

### code-review-gate

**D16. Confidence flows through the bridge.**
- `CachedReview` and `GreptileBridgeResult` gain `confidence?: number`. The bridge copies it from the client result, and `isCachedReview` accepts it when absent or a number. A cached review without it counts as "not reported".
- The review source captures the confidence of the last review it returned. `pre_pr_loop.ts` is not changed.

**D17. Shared factory and renderer.**
- `src/review/factory.ts` exports `createReviewLoop({client, repo, base, rounds, runFixerSession, onRound?}): {loop, lastConfidence()}`. It creates the bridge and the `PrePrReviewLoop`; its source records the confidence of each bridge result for `lastConfidence()`. The fixer prompt builder moves from `reviewCommand` into `factory.ts` unchanged, as `buildFixerPrompt(mechanical, round)`, so `reviewCommand` output and exit codes stay identical.
- `src/review/render.ts` exports the pure `renderCodeReview(result, context)`.
- The review step does not read `greptile.enabled`, `greptile.timeoutMs` or `greptile.cacheDir`, like `reviewCommand` today. `codeReview.afterRun` is the only switch. Honoring the `greptile` keys is a follow-up.

**D18. The review step.**
- Config: `codeReview` is a strict optional object with `afterRun` (boolean), `base` (string, default `main`), `rounds` (integer from 1 to `PRE_PR_CONSTANTS.MAX_ROUNDS`, default that maximum, higher values rejected) and `minConfidence` (optional number). It is file-only, with no flag. It is added in the four config places: the `CascadeConfig` interface, `CascadeConfigSchema`, `CascadeFileConfigSchema` and `candidateConfig` in `loadConfig`; its defaults live in `CODE_REVIEW_CONSTANTS` in `src/config/constants.ts`.
- It runs in `run()` after `execute()` returns with outcome 0, after the run summary commit, so its record commits are the last ones.
- A private facade method `reviewAfterRun(ctx): Promise<ReviewStepResult>` returns `{status, confidence, restoreReason?, error?}`. Tests assert on this value.
- Before the loop it records the HEAD SHA and a tree snapshot (D1).
- The fixer goes through the facade's `runSession`, so it uses the run's engine, `config.settings`, budget accounting and logging.
- Checks: `alwaysVerify` plus the default checks, where the default checks use the same fallback as `verifyCommands` (`config.defaultVerify`, else the package manager's test and lint commands, else `CONSTANTS.DEFAULT_VERIFY`). The fallback is extracted from `verifyCommands` into an exported `defaultChecks(repo, config)` in `src/facade/tasks.ts`, so both use one rule.
- After the loop: if HEAD moved (the fixer committed), or a check fails, the harness resets to the pre-review HEAD and restores the pre-review tree, and records why. If the tree changed and the checks pass, it commits `fix: apply Greptile review fixes`.
- Any error in the step, including a budget stop, restores the pre-review state, is written to the report, leaves the stamp `open`, and does not change the exit code.
- The fake Greptile client is injected through `CascadeFacadeDependencies.greptileClient`; the engine is already injectable through `CascadeFacadeDependencies.engine`.

**D19. One branch-wide review, written to every change.**
- The review covers the branch diff against `codeReview.base`, so it is the same for every change of the run. The same content is written to each change's `code-review.md`. This duplication is deliberate: each change carries its own record and stamp.

**D20. Stamp before commit, bound to HEAD.**
- The harness renders `code-review.md`, stamps it (status, change hash and `head: <reviewed HEAD SHA>`), then commits each change's file in a single path-limited `chore(<change>): record code review` commit. The reviewed HEAD is the HEAD after the fix commit, if there is one. There is no separate stamp commit, and the tree is clean afterwards.
- `SpecMarker` gains `head?: string`. `parseMarker` reads it, and a `code-review` marker without `head` is malformed. `renderMarker` writes `head` only for `code-review`. `MARKER_KEYS` gains `head`, so `stripMarker` removes it.
- Freshness lives in a new `src/sdd/head_freshness.ts`: `headFreshness(repo, head, runGit = spawnSyncGit): "fresh" | "unknown-head" | "code-changed"`, where `GitRunner = (args: readonly string[], cwd: string) => {status: number, stdout: string}` and `spawnSyncGit` wraps `spawnSync("git", ...)`. It runs `git cat-file -e <head>^{commit}` and `git diff --name-only <head> HEAD`. A diff that only touches `code-review.md` files is fresh.
- `evaluateStage(changeDir, stage, options?: {repo?, runGit?})` calls it for `code-review` after the hash check, with `repo` defaulting to the repository root three levels above `changeDir`. Any result other than `fresh` is `stale`. `evaluateStage` stays synchronous.

### spec-gate

**D21. One more stage.**
- `code-review` is added to `STAGES` and `FILE_BY_STAGE`, and `head` to `MARKER_KEYS`. `spec-gate stamp --stage code-review` writes the current HEAD. `spec-gate check --stage code-review` applies D20 and reports `stale` when it fails. The rules for `review` and `drift` are unchanged.

### Recorded exception

**D22. The facade calls `src/core/pre_pr_loop.ts`.**
- The brief said new code must not import from `src/core`. This change accepts one exception: the facade (through `src/review/factory.ts`) uses `PrePrReviewLoop`. Pruning `src/core` must keep `pre_pr_loop.ts`. It is not moved in this change.

## Alternatives Considered

- **`git stash create` vs a temporary-index tree.** `stash create` skips untracked files unless combined with other steps, and its commit object is easy to confuse with the user's stashes. Chosen: temporary-index `write-tree`.
- **Inline `GIT_INDEX_FILE` shell prefix vs `ShadowCommitManager.snapshotTree`.** The inline prefix duplicates the shadow code and goes through the string runner. Chosen: extract and reuse the shadow snapshot.
- **Tree restore for every buffer user vs opt-in.** Always-on changes the commands seen by v2 and gate 3 and their tests. Chosen: opt-in `restoreTree`, set only by the v1 facade.
- **Backup of tracked excluded paths vs limiting the guarantee.** A backup modeled on the audit-log backup would keep tracked excluded files, at the cost of in-memory copies. Chosen: limit the guarantee to untracked excluded paths.
- **Git ref (`refs/parked/...`) vs committed patch.** A ref rebases better but needs cleanup and pushing, and is invisible in the PR. Chosen: committed `.patch` next to the parked file.
- **Stored vs derived state.** Storing waiting tasks and parked state in a state file drifts from `tasks.md`. Chosen: derived on every run from `tasks.md` and `parked/`.
- **Committing answers vs allowing uncommitted answers.** Requiring a commit of the answer adds a step for the user. Chosen: preflight allows uncommitted edits under the change's `parked/` folder.
- **Greptile inside the facade vs a separate step.** A separate command after the run would need forja changes and would lose the run's engine, budget and settings. Chosen: inside the facade, after the summary, opt-in.
- **Per-branch vs per-change report.** One report at the branch level has no change folder to live in and no stamp. Chosen: the same branch-wide review written to each change.
- **Exit code vs JSON outcome.** A JSON file is richer but every caller would need to parse it. Chosen: exit code 3, with `run-summary.md` and `status --json` for detail.
- **Commit every task vs tree snapshot.** Committing each task fixes the baseline too, but changes commit granularity for section-mode users. Chosen: tree snapshot, plus a partial commit only when a task parks.
- **`checkout-index` vs `read-tree -u --reset` for restore.** `checkout-index` does not delete files removed before the task. Chosen: `read-tree -u --reset` then `git reset -q`.

## Risks / Trade-offs

- [Ignored files created by a task survive rollback] → Documented. The sandbox stays the first line of defense.
- [Tracked excluded files are reverted by rollback] → Same as today; documented.
- [Tree capture fails] → Logged, falls back to HEAD-only rollback, which is today's behavior.
- [Exit code 3 surprises callers] → Documented. `forja wt night` prints any non-zero exit as a failure, and a follow-up in forja can map 3 to "needs answers".
- [Greptile is unavailable or unauthenticated at night] → The error goes into `code-review.md`, the stamp is `open`, and the exit code is unchanged.
- [Large failure output] → Capped at 20000 characters, and the cap is noted.
- [Interim secret rule misses a secret file name] → `autonomy-guard` follows with sensitive paths; until then only the four patterns plus `neverCommit` are left out.
- [Summary commit fails after a commit failure] → The file stays written and the error is printed; the next run's preflight then reports the dirty tree.

## Migration Plan

- Existing `--resilient` users: a failed task now leaves `parked/<task>.md`, a patch, a park commit and possibly a partial commit, and the run exits 3 instead of 0. The run summary is committed to each change.
- `--resilient --no-rollback` (or `rollbackOnFailure: false`, `CASCADE_ROLLBACK_ON_FAILURE=false` or `CASCADE_GIT_ROLLBACK=false` with parking on) now fails at load with exit 2. Drop one of the two settings.
- A failed rollback now stops the run with exit 2, with parking on or off.
- `forja wt night` prints any non-zero exit, including 3, as a failure until forja maps 3. The docs say so.
- Users without `--resilient` and without `codeReview` see only the new summary file, the final report layout and the per-task baseline fix.
- Existing `review.md` and `drift.md` stamps keep working; only `code-review` uses the `head` key.

## Open Questions

None.
