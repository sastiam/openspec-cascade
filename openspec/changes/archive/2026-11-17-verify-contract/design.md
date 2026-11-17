# Design

Problem: instruction text in a task is read as checks, so a task that expects red tests can never pass (see [proposal.md](proposal.md)).

## Context

`verifyCommands(task, fullGate, options)` in `src/facade/tasks.ts` builds a task's checks. `parseTasks` folds indented continuation lines into `task.text` (joined with one space, indentation dropped), so a task is one string. Today, once `\bVerify:` appears anywhere in that string, `verifyCommands` scans the whole string for backticked package-manager commands. It also adds `lint`, `build` and `E2E` checks when those words appear in the prose (the text with backtick spans removed), and Nuxt `tsc` checks when `both tsc` appears in the text. If nothing is found, it falls back to `defaultVerify`. "full verification" adds `fullVerify` only when the backtick scan found nothing; `--full-gate` adds `fullVerify` to every committing task.

`lint-tasks` (`src/sdd/tasks_lint.ts`) already defines the marker it requires on unchecked tasks: `TASKS_LINT_CONSTANTS.VERIFY_LINE`, an indented line with an optional `-` or `*` list marker followed by `Verify:` and text.

In `CascadeFacade` (`src/facade/cascade_facade.ts`), `execute` first runs `preflight`. `preflight` calls `lintChanges`, which runs `lintTasks` on the tasks.md of every listed change and throws `Fatal` (exit code 2) before any engine session when an unchecked task has no indented Verify line. A dry run is not linted. So in a real v1 run, and in v2, every unchecked task that reaches a session has an indented Verify line; only dry-run plans, unit tests and other direct callers of `verifyCommands` see tasks without one.

After `preflight`, `execute` either runs `executeV2` (mode v2), prints the plan (dry run) or loops over `runChange`. `runTask` calls `verifyCommands` once per task and passes the result to `taskPrompt`, to the verification branch and to `selectVerifyChecks` (`fast_track.ts`, with `forceFull` true when `--full-gate` is set or the whole task text says "full verification"). An empty result means the harness only waits for the agent to check the box. `printPlan` calls `verifyCommands` again for the dry-run plan and prints one line per pending task: `  <id> <flags>`, with the flags `HUMAN-SKIP`, `commit=...` and `verify=[a | b]` in that order.

`defaultVerify` and `fullVerify` are plain string lists in `CascadeConfigSchema` and `CascadeFileConfigSchema` (`src/config/schemas.ts`), with no safety validation. `CascadeFileConfigSchema` is a strict object, so an unknown key fails to load today. `isSafeVerifyCommand` lives in `src/facade/tasks.ts` and tests `HARDENING_CONSTANTS.SHELL_CONTROL_PATTERN` from `src/config/constants.ts`.

`runVerificationPhase` (`qa.ts`) runs a list of commands. Its `say` hook prints `  check: <command>` and a result line per command; its `log` hook writes a `check` event. `stopOnFirstFailure` defaults to true.

## Goals / Non-Goals

**Goals:**
- Define the Verify marker the same way `lint-tasks` does, and read checks only from the Verify segment.
- Report commands that the segment rule ignores.
- Add `alwaysVerify` for v1 runs, validated at config load, with a baseline run before the first task.

**Non-Goals:**
- `alwaysVerify` in v2 mode. v2 is being deprecated; `v2_pipeline.ts` is not changed. A v2 config with a non-empty `alwaysVerify` only gets a warning.
- Changing the docs-only fast-track, `--full-gate`, the `bun audit` exclusion or the Nuxt `tsc` expansion for task commands.
- Changing `lint-tasks` or `lintChanges`. Commands written outside the Verify segment are ignored and reported, so they do no harm.
- A CLI flag or environment variable for `alwaysVerify`.
- A special done rule for tasks without their own checks. The preflight already rejects such tasks in real runs, so a rule for them could never apply.

## Decisions

### D1. The marker is recorded by `parseTasks`

`Task` gains an optional field `verifyStart?: number | null`: the index in `task.text` where the Verify segment starts. `parseTasks` sets it as follows:

1. On the task line, it finds the first `\bVerify:` outside backtick spans (backtick spans are blanked to spaces before the search). That is the inline marker, or `null` if there is none.
2. For each continuation line, before folding it, it tests the raw line against `TASKS_LINT_CONSTANTS.VERIFY_LINE`. The first matching line sets `verifyStart` to the index where that line's trimmed text begins in `task.text`. A continuation marker wins over an inline marker.
3. A task with neither keeps `verifyStart: null`.

So for an unchecked task parsed by `parseTasks` that has no inline marker, `verifyStart !== null` exactly when `lintTasks` accepts the task. An inline-only task has a non-null `verifyStart` but is rejected by the lint.

A new helper `verifySegment(task: Task): string | undefined` returns `task.text.slice(verifyStart)`, or `undefined` when `verifyStart` is `null`. When `verifyStart` is `undefined` (a `Task` built without `parseTasks`, as some tests do), the whole text is treated as the task line and the inline rule applies to it.

A `Verify:` inside backticks never starts the segment. A `Verify:` in the middle of a continuation line never starts it either, because `VERIFY_LINE` is anchored at the start of the line. `tasks.ts` imports `TASKS_LINT_CONSTANTS` from `src/config/constants.ts`, where `HARDENING_CONSTANTS` already comes from, so no new dependency direction is added.

The inline fallback exists for compatibility, not for real runs: it keeps existing unit and end-to-end callers and dry-run plans working (for example the dry-run journey task "1.3 Verify: `bun test`. Commit `feat(api)`"). The lint already requires the indented form before any session.

### D2. All four detections read the segment

In `verifyCommands`, `source` is the Verify segment when there is one, and the whole text otherwise (tasks with "full verification" or `--full-gate` and no marker keep today's behavior). The backtick scan, the `lint`/`build`/`E2E` prose keywords (prose is `source` with backtick spans removed) and the `both tsc` pattern all read `source`. The early return becomes: no segment, no "full verification", not gated, so no checks.

"full verification" and the gated rule keep reading the whole text, because they are instructions about verification wherever they are written. When "full verification" and a Verify segment coexist, the rule is today's rule applied to the segment: `fullVerify` is added when the segment's backtick scan finds no command, and commands before the marker are ignored. `--full-gate` still adds `fullVerify` to every committing task. `runTask` keeps computing `forceFull` from the whole text, so such a task is never shortened by the fast-track.

### D3. Ignored commands are reported

A new helper `ignoredCommands(task: Task): string[]` returns the backticked commands in the text before the marker that match the same package-manager pattern as the backtick scan (`bun`, `bunx`, `npm`, `pnpm`, `yarn`, or `tsc --noEmit`), trimmed, in order and without duplicates. It applies no other filter or rewrite: no safety test, no `bun audit` exclusion, no `tsc` expansion and no `db:generate` replacement, so each command is reported as written. It returns `[]` when there is no marker.

`runTask` writes a `verify_ignored` run-log event with the payload `{ change, taskId, commands }` when the list is not empty, once per task (before the first session of the task). `printPlan` adds the flag `ignored=[a | b]` (commands joined with `" | "`, like `verify=[...]`) after the `verify=[...]` flag, only when the list is not empty. Existing plan lines do not change: the dry-run journey test (`test/e2e/tier4_scenarios/dry_run_cascade_journey.test.ts`) expects `1.3 commit=feat(api) verify=[bun test]` for a task whose inline marker is at the start of its text, so nothing is ignored and no flag is added.

### D4. One merged list, computed once

A new exported helper `taskChecks(task: Task, config: CascadeConfig): string[]` in `src/facade/tasks.ts` calls `verifyCommands(task, config.fullGate, { repoRoot: config.repo, config })` and appends `config.alwaysVerify`, de-duplicated and in order (task checks first).

`runTask` calls `taskChecks` once, right where it calls `verifyCommands` today, and uses the result for `taskPrompt`, for the verification branch and for `selectVerifyChecks`. So the agent is told about the project-wide checks, and the done rule is today's rule: when the merged list is not empty, the harness marks the task done after its checks pass; when it is empty, the agent's checkbox decides. `printPlan` calls the same helper, so the dry-run plan shows the same list.

### D5. `alwaysVerify` runs exactly as written

`alwaysVerify` commands are appended after `verifyCommands` returns, so they skip every rewrite in it: no Nuxt `tsc` expansion, no `bunx nuxi prepare` prefix, no `bun audit` exclusion, no package-manager detection and no `db:generate` replacement. They do not need to start with a package-manager name. The fast-track still classifies them like any other check: an architecture check such as `bun run arch:check` is `other` and is never skipped; a test command is skipped on docs-only changes.

### D6. Safety validation in the config layer

`src/config/schemas.ts` defines a shared `safeCommandListSchema`: `stringListSchema.readonly()` with a `superRefine` that finds the first entry matching `HARDENING_CONSTANTS.SHELL_CONTROL_PATTERN` and adds an issue whose message names that command. Nothing is imported from `src/facade`. The schema is used in two places, so both the config file and programmatic overrides are checked:

- `CascadeFileConfigSchema`: `alwaysVerify: safeCommandListSchema.optional()`.
- `CascadeConfigSchema` (the resolved config that `loadConfig` validates last): `alwaysVerify: safeCommandListSchema`.

Every place the key is added:

1. `CascadeConfig` interface in `src/config/schemas.ts`: `alwaysVerify: readonly string[]` (required).
2. `CascadeConfigSchema` in `src/config/schemas.ts`.
3. `CascadeFileConfigSchema` in `src/config/schemas.ts`.
4. `VERIFY_CONSTANTS.ALWAYS_VERIFY: [] as readonly string[]` in `src/config/constants.ts`, and `alwaysVerify: VERIFY_CONSTANTS.ALWAYS_VERIFY` in `DEFAULT_RUNTIME_VALUES` in `src/config/schemas.ts`.
5. `candidateConfig` in `loadConfig` (`src/config/loader.ts`): `overrides.alwaysVerify ?? fileConfig.alwaysVerify ?? VERIFY_CONSTANTS.ALWAYS_VERIFY`.

### D7. v2 warning at load

After resolving `mode` and `alwaysVerify`, `loadConfig` calls `console.warn(VERIFY_CONSTANTS.ALWAYS_VERIFY_V2_WARNING)` once when `mode` is `v2` and `alwaysVerify` is not empty. The config still loads. The exact text is:

`ALWAYS_VERIFY_V2_WARNING: "alwaysVerify is ignored in v2 mode; it applies to v1 runs only."`

### D8. Baseline run before the first task

In `execute`, after the v2 branch and the dry-run branch and before the first `runChange`, a new private method `checkAlwaysVerifyBaseline(ctx: RunContext): Promise<void>` runs `alwaysVerify` once when the list is not empty. It calls `runVerificationPhase` with `commands: ctx.config.alwaysVerify`, `cwd: ctx.config.repo`, `timeoutMs: ctx.config.commandTimeoutMs`, `stopOnFirstFailure: false` and `hooks` with only `log` (no `say`). Without `say`, the baseline prints no `check:` lines, so a test that counts a check line per task still sees each command once. With `stopOnFirstFailure: false`, every failing command is found.

If a check fails, it throws `Fatal` with the message `` `${VERIFY_CONSTANTS.ALWAYS_VERIFY_BASELINE_FAILED} ${failures.map((failure) => failure.command).join(", ")}` ``. The exact text of the constant is:

`ALWAYS_VERIFY_BASELINE_FAILED: "alwaysVerify fails before the first task; fix the project or the alwaysVerify setting. Failing commands:"`

`Fatal` is fail-closed (exit code 2), and no engine session has started. A dry run and a v2 run do not run the baseline.

## Test fixtures

The facade tests in tasks 3.1 and 3.2 use these literals, in the "alwaysVerify" describe block of `test/facade/cascade_facade.test.ts`. Each test creates a repo with `createTempGitRepo`, writes `package.json`, adds the change `add-greeting` with `addOpenSpecChange`, runs `commitFixture`, and runs `new CascadeFacade({ engine, output: captureOutput(), resilience: false })` with `configFor(repo, "add-greeting", overrides)`. Numeric expectations use named constants, for example `const FAIL_CLOSED_EXIT_CODE = 2;`.

- **Scripts.** `package.json` is `{ "scripts": { "arch:check": "echo ok", "unit:check": "echo ok", "smoke:test": "echo ok" } }`, except where a fixture says otherwise.
- **Task A** (marker with a command): `"## 1. Build"`, `"- [ ] 1.1 Create the greeting module"`, ``"  Verify: `bun run unit:check` passes"``.
- **Task B** (command before the marker): `"## 1. Build"`, ``"- [ ] 1.1 Run `bun test test/a.test.ts` and see it fail."``, ``"  Verify: `bun run unit:check` passes"``.
- **Task C** (full verification with a segment): `"## 1. Build"`, `"- [ ] 1.1 Run full verification."`, ``"  Verify: `bun run smoke:test` passes"``.
- **Engine.** `new WorkingEngine(completeTask("add-greeting"))`, except for Task C, where the engine writes only `NOTES.md` and checks box 1.1, so the change is docs-only.

| Test | Task | Overrides | Assertions |
|---|---|---|---|
| Architecture check on a task with Verify | A | `alwaysVerify: ["bun run arch:check"]` | exit code 0; output lines contain `  check: bun run unit:check` and exactly one `  check: bun run arch:check`; `engine.prompts[0]` contains `bun run arch:check`; a second run with `dryRun: true` prints a line containing `verify=[bun run unit:check \| bun run arch:check]` |
| Command before the marker is reported | B | `alwaysVerify: []` | exit code 0; no output line contains `check: bun test test/a.test.ts`; the run-log file has one line with `"event":"verify_ignored"`, `"taskId":"1.1"` and `"commands":["bun test test/a.test.ts"]`; a dry run prints a line containing `verify=[bun run unit:check] ignored=[bun test test/a.test.ts]` |
| Empty setting (regression guard) | A | `alwaysVerify: []` | exit code 0; output contains `  check: bun run unit:check`; no output line contains `arch:check` |
| Full verification keeps every check (regression guard) | C | `alwaysVerify: []` | exit code 0; output contains `  check: bun run smoke:test`; no output line contains `fast-track` |
| Baseline fails | A | `alwaysVerify: ["bun run arch:check"]`, `arch:check` is `exit 1` | exit code 2; `errorKind` is `fail_closed`; `engine.prompts` is empty; `result.error` contains `bun run arch:check` |
| Baseline passes (regression guard) | A | `alwaysVerify: ["bun run arch:check"]` | exit code 0; the task is done |
| Dry run (regression guard) | A | `alwaysVerify: ["bun run arch:check"]`, `arch:check` is `exit 1`, `dryRun: true` | exit code 0; `engine.prompts` is empty |

## Alternatives Considered

- **Marker definition.** (a) Keep "first `\bVerify:` anywhere": no parsing change, but a mention inside instructions or backticks starts the segment, which is the bug class this change removes. (b) Only the `VERIFY_LINE` continuation line: matches `lint-tasks` exactly, but breaks existing unit and end-to-end callers and dry-run plans that use the inline form, such as "Upgrade x. Verify: `bun audit` ...". (c) Chosen: `VERIFY_LINE` first, inline marker outside backticks as fallback. Real runs are unaffected by the fallback, because the lint already requires the indented form. Costs one optional field on `Task`.
- **Where to record the marker.** (a) Re-detect it in `verifyCommands`: impossible, because `parseTasks` drops indentation when folding lines. (b) Join continuation lines with newlines: changes `task.text` for every regex and prompt that reads it. (c) A separate `verifyText` field: duplicates text and can drift from `text`. (d) Chosen: an index into `text`, so `text` is unchanged for every other caller.
- **Which detections read the segment.** (a) Only the backtick scan: keywords like "build" in the instructions would still add checks. (b) Chosen: all four detections. "full verification" and `--full-gate` stay on the whole text, because they are run-level instructions, not commands.
- **Ignored commands.** (a) Drop them silently: simplest, but a project loses a check without notice. (b) Fail the run: too strict for a behavior that is intended. (c) Chosen: log and show in the dry-run plan, as written.
- **Where `alwaysVerify` is merged.** (a) Inside `verifyCommands` through `options.config`: mixes project policy into task parsing, applies the Nuxt and `bun audit` rewrites to project commands, and leaks into v2. (b) Chosen: `taskChecks`, called once in `runTask` and in `printPlan`, so the prompt, the gate and the plan cannot disagree.
- **Done rule for tasks with only `alwaysVerify` checks.** (a) Require both the checkbox and the checks (an earlier draft): unreachable in real v1 runs, because the preflight lint rejects every unchecked task without an indented Verify line before any session. (b) Chosen: no special rule; the merged list follows today's rule.
- **v2 support.** (a) Apply `alwaysVerify` in `v2_pipeline.ts` too: more code in a pipeline that is being removed. (b) Error on v2: blocks users who share one config between modes. (c) Chosen: v1 only, with a warning.
- **Safety validation.** (a) Reuse `isSafeVerifyCommand` from `src/facade/tasks.ts`: the config layer would import the facade, which inverts layering and creates an import cycle. (b) Validate in `runTask`: errors would appear after sessions have started. (c) Chosen: `HARDENING_CONSTANTS.SHELL_CONTROL_PATTERN` in a shared schema, on both the file schema and the resolved schema.
- **Baseline failure.** (a) Let every task fail on it: burns attempts and budget on a problem no task can fix. (b) Skip failing checks: hides a broken rule. (c) Chosen: run once before the first task and stop with a clear message.
- **Baseline output.** (a) Pass `say` like `runTask` does: prints `check:` lines before the first task, so per-task check lines appear twice in the output. (b) Chosen: `log` only; the failure message names the commands.

## Risks / Trade-offs

- [A project relied on a command written before the Verify marker] → The check disappears. Mitigation: the command is listed in a `verify_ignored` run-log event and in the dry-run plan; the docs state the rule; moving the command into the Verify line restores it.
- [`alwaysVerify` already fails on the starting state] → Every task would fail. Mitigation: the baseline run stops before the first session with a message that names the check (D8).
- [`alwaysVerify` makes every task slower] → Intended. The setting is opt-in and empty by default.
- [Security] → `.openspec-cascade.json` is trusted input written by the project owner, like `defaultVerify` and `fullVerify`. Still, `alwaysVerify` entries with shell operators (`;`, `&`, `|`, backticks, `<`, `>`, `$(`, `${`, line breaks) are rejected at load, so each entry is a single command.
- [v2 users set `alwaysVerify`] → It has no effect there. Mitigation: the warning at load (D7).
