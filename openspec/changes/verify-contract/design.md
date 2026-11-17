# Design

Problem: instruction text in a task is read as checks, so a task that expects red tests can never pass (see [proposal.md](proposal.md)).

## Context

`verifyCommands(task, fullGate, options)` in `src/facade/tasks.ts` builds a task's checks. `parseTasks` folds indented continuation lines into `task.text` (joined with one space, indentation dropped), so a task is one string. Today, once `\bVerify:` appears anywhere in that string, `verifyCommands` scans the whole string for backticked package-manager commands. It also adds `lint`, `build` and `E2E` checks when those words appear in the prose (the text with backtick spans removed), and Nuxt `tsc` checks when `both tsc` appears in the text. If nothing is found, it falls back to `defaultVerify`. "full verification" adds `fullVerify` only when the backtick scan found nothing; `--full-gate` adds `fullVerify` to every committing task.

`lint-tasks` (`src/sdd/tasks_lint.ts`) already defines the marker it requires on unchecked tasks: `TASKS_LINT_CONSTANTS.VERIFY_LINE`, an indented line with an optional `-` or `*` list marker followed by `Verify:` and text.

In `CascadeFacade` (`src/facade/cascade_facade.ts`), `runTask` calls `verifyCommands` once per task and passes the result to `taskPrompt`, to the verification branch and to `selectVerifyChecks` (`fast_track.ts`). An empty result means the harness only waits for the agent to check the box. `printPlan` calls `verifyCommands` again for the dry-run plan. `execute` runs `preflight`, then either `executeV2` (mode v2) or the v1 loop over `runChange`.

`defaultVerify` and `fullVerify` are plain string lists in `CascadeConfigSchema` and `CascadeFileConfigSchema` (`src/config/schemas.ts`), with no safety validation. `isSafeVerifyCommand` lives in `src/facade/tasks.ts` and tests `HARDENING_CONSTANTS.SHELL_CONTROL_PATTERN` from `src/config/constants.ts`.

## Goals / Non-Goals

**Goals:**
- Define the Verify marker the same way `lint-tasks` does, and read checks only from the Verify segment.
- Report commands that the segment rule ignores.
- Add `alwaysVerify` for v1 runs, validated at config load, with a baseline run before the first task.

**Non-Goals:**
- `alwaysVerify` in v2 mode. v2 is being deprecated; `v2_pipeline.ts` is not changed. A v2 config with a non-empty `alwaysVerify` only gets a warning.
- Changing the docs-only fast-track, `--full-gate`, the `bun audit` exclusion or the Nuxt `tsc` expansion for task commands.
- Changing `lint-tasks`. Commands written outside the Verify segment are ignored and reported, so they do no harm.
- A CLI flag or environment variable for `alwaysVerify`.

## Decisions

### D1. The marker is recorded by `parseTasks`

`Task` gains an optional field `verifyStart?: number | null`: the index in `task.text` where the Verify segment starts. `parseTasks` sets it as follows:

1. On the task line, it finds the first `\bVerify:` outside backtick spans (backtick spans are blanked to spaces before the search). That is the inline marker, or `null` if there is none.
2. For each continuation line, before folding it, it tests the raw line against `TASKS_LINT_CONSTANTS.VERIFY_LINE`. The first matching line sets `verifyStart` to the index where that line's trimmed text begins in `task.text`. A continuation marker wins over an inline marker.
3. A task with neither keeps `verifyStart: null`.

A new helper `verifySegment(task): string | undefined` returns `task.text.slice(verifyStart)`, or `undefined` when `verifyStart` is `null`. When `verifyStart` is `undefined` (a `Task` built without `parseTasks`, as some tests do), the whole text is treated as the task line and the inline rule applies to it.

A `Verify:` inside backticks never starts the segment. A `Verify:` in the middle of a continuation line never starts it either, because `VERIFY_LINE` is anchored at the start of the line. `tasks.ts` imports `TASKS_LINT_CONSTANTS` from `src/config/constants.ts`, where `HARDENING_CONSTANTS` already comes from, so no new dependency direction is added.

### D2. All four detections read the segment

In `verifyCommands`, `source` is the Verify segment when there is one, and the whole text otherwise (tasks with "full verification" or `--full-gate` and no marker keep today's behavior). The backtick scan, the `lint`/`build`/`E2E` prose keywords (prose is `source` with backtick spans removed) and the `both tsc` pattern all read `source`. The early return becomes: no segment, no "full verification", not gated, so no checks.

"full verification" and the gated rule keep reading the whole text, because they are instructions about verification wherever they are written. When "full verification" and a Verify segment coexist, the rule is today's rule applied to the segment: `fullVerify` is added when the segment's backtick scan finds no command, and commands before the marker are ignored. `--full-gate` still adds `fullVerify` to every committing task.

### D3. Ignored commands are reported

A new helper `ignoredCommands(task): string[]` returns the backticked package-manager commands in the text before the marker (same pattern as the backtick scan), and `[]` when there is no marker. `runTask` writes a `verify_ignored` run-log event with the task id and the list when it is not empty. `printPlan` adds an `ignored=[...]` flag to the task's plan line.

### D4. One merged list, computed once

A new helper `taskChecks(task, config): { checks: string[]; checkboxRequired: boolean }` in `src/facade/tasks.ts` calls `verifyCommands(task, config.fullGate, { repoRoot: config.repo, config })` and appends `config.alwaysVerify`, de-duplicated and in order (task checks first). `checkboxRequired` is true when the task's own checks are empty.

`runTask` calls `taskChecks` once, right where it calls `verifyCommands` today, and uses `checks` for `taskPrompt`, for the verification branch and for `selectVerifyChecks`. So the agent is told about the project-wide checks. `printPlan` calls the same helper, so the dry-run plan shows the same list.

### D5. A task with only `alwaysVerify` needs its checkbox and its checks

Today, a task with checks is marked done by the harness after its checks pass, even if the agent did not check the box. That stays true for tasks with their own checks. When `checkboxRequired` is true and `checks` is not empty, `runTask` first requires the checkbox: if the box is unchecked, it sends the existing "still unchecked" prompt and retries. Only then does it run the checks. The task is done when both hold.

### D6. `alwaysVerify` runs exactly as written

`alwaysVerify` commands are appended after `verifyCommands` returns, so they skip every rewrite in it: no Nuxt `tsc` expansion, no `bunx nuxi prepare` prefix, no `bun audit` exclusion, no package-manager detection and no `db:generate` replacement. They do not need to start with a package-manager name. The fast-track still classifies them like any other check: an architecture lint is `lint` or `other` and is never skipped; a test command is skipped on docs-only changes.

### D7. Safety validation in the config layer

`src/config/schemas.ts` defines a shared `safeCommandListSchema`: `stringListSchema.readonly()` with a `superRefine` that finds the first entry matching `HARDENING_CONSTANTS.SHELL_CONTROL_PATTERN` and adds an issue whose message names that command. Nothing is imported from `src/facade`. The schema is used in two places, so both the config file and programmatic overrides are checked:

- `CascadeFileConfigSchema`: `alwaysVerify: safeCommandListSchema.optional()`.
- `CascadeConfigSchema` (the resolved config that `loadConfig` validates last): `alwaysVerify: safeCommandListSchema`.

Every place the key is added:

1. `CascadeConfig` interface in `src/config/schemas.ts`: `alwaysVerify: readonly string[]` (required).
2. `CascadeConfigSchema` in `src/config/schemas.ts`.
3. `CascadeFileConfigSchema` in `src/config/schemas.ts`.
4. `VERIFY_CONSTANTS.ALWAYS_VERIFY = []` in `src/config/constants.ts`, and `alwaysVerify` in `DEFAULT_RUNTIME_VALUES` in `src/config/schemas.ts`.
5. `candidateConfig` in `loadConfig` (`src/config/loader.ts`): `overrides.alwaysVerify ?? fileConfig.alwaysVerify ?? VERIFY_CONSTANTS.ALWAYS_VERIFY`.

### D8. v2 warning at load

After resolving `mode` and `alwaysVerify`, `loadConfig` writes `VERIFY_CONSTANTS.ALWAYS_VERIFY_V2_WARNING` with `console.warn` when `mode` is `v2` and `alwaysVerify` is not empty. The config still loads.

### D9. Baseline run before the first task

In `execute`, after the dry-run branch and before the first `runChange`, a new private method `checkAlwaysVerifyBaseline(ctx)` runs `alwaysVerify` once with `runVerificationPhase` in the repo, when the list is not empty. If a check fails, it throws `Fatal` with a message that starts with `VERIFY_CONSTANTS.ALWAYS_VERIFY_BASELINE_FAILED` and names the failing commands. `Fatal` is fail-closed (exit code 2), and no engine session has started. A dry run does not run the baseline.

## Alternatives Considered

- **Marker definition.** (a) Keep "first `\bVerify:` anywhere": no parsing change, but a mention inside instructions or backticks starts the segment, which is the bug class this change removes. (b) Only the `VERIFY_LINE` continuation line: matches `lint-tasks` exactly, but breaks existing inline tasks such as "Upgrade x. Verify: `bun audit` ...". (c) Chosen: `VERIFY_LINE` first, inline marker outside backticks as fallback. Costs one optional field on `Task`.
- **Where to record the marker.** (a) Re-detect it in `verifyCommands`: impossible, because `parseTasks` drops indentation when folding lines. (b) Join continuation lines with newlines: changes `task.text` for every regex and prompt that reads it. (c) A separate `verifyText` field: duplicates text and can drift from `text`. (d) Chosen: an index into `text`, so `text` is unchanged for every other caller.
- **Which detections read the segment.** (a) Only the backtick scan: keywords like "build" in the instructions would still add checks. (b) Chosen: all four detections. "full verification" and `--full-gate` stay on the whole text, because they are run-level instructions, not commands.
- **Ignored commands.** (a) Drop them silently: simplest, but a project loses a check without notice. (b) Fail the run: too strict for a behavior that is intended. (c) Chosen: log and show in the dry-run plan.
- **Where `alwaysVerify` is merged.** (a) Inside `verifyCommands` through `options.config`: mixes project policy into task parsing, applies the Nuxt and `bun audit` rewrites to project commands, and leaks into v2. (b) Chosen: `taskChecks`, called once in `runTask` and in `printPlan`, so the prompt, the gate and the plan cannot disagree.
- **Checkbox rule for `alwaysVerify`-only tasks.** (a) Mark the box when checks pass: the harness would close a task the agent never claimed to finish. (b) Chosen: require both. Tasks with their own checks keep today's rule, so no existing change behaves differently.
- **v2 support.** (a) Apply `alwaysVerify` in `v2_pipeline.ts` too: more code in a pipeline that is being removed. (b) Error on v2: blocks users who share one config between modes. (c) Chosen: v1 only, with a warning.
- **Safety validation.** (a) Reuse `isSafeVerifyCommand` from `src/facade/tasks.ts`: the config layer would import the facade, which inverts layering and creates an import cycle. (b) Validate in `runTask`: errors would appear after sessions have started. (c) Chosen: `HARDENING_CONSTANTS.SHELL_CONTROL_PATTERN` in a shared schema, on both the file schema and the resolved schema.
- **Baseline failure.** (a) Let every task fail on it: burns attempts and budget on a problem no task can fix. (b) Skip failing checks: hides a broken rule. (c) Chosen: run once before the first task and stop with a clear message.

## Risks / Trade-offs

- [A project relied on a command written before the Verify marker] → The check disappears. Mitigation: the command is listed in a `verify_ignored` run-log event and in the dry-run plan; the docs state the rule; moving the command into the Verify line restores it.
- [`alwaysVerify` already fails on the starting state] → Every task would fail. Mitigation: the baseline run stops before the first session with a message that names the check (D9).
- [`alwaysVerify` makes tasks without Verify slower] → Intended. The setting is opt-in and empty by default.
- [Security] → `.openspec-cascade.json` is trusted input written by the project owner, like `defaultVerify` and `fullVerify`. Still, `alwaysVerify` entries with shell operators (`;`, `&`, `|`, backticks, `<`, `>`, `$(`, `${`, line breaks) are rejected at load, so each entry is a single command.
- [v2 users set `alwaysVerify`] → It has no effect there. Mitigation: the warning at load (D8).
