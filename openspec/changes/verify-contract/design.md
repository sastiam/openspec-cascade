# Design

## Context

`verifyCommands(task, fullGate, options)` in `src/facade/tasks.ts:77-132` builds a task's checks. `parseTasks` folds indented continuation lines into `task.text`, so a task is one string. Today, once `\bVerify:` appears anywhere in that string, the function scans the whole string for backticked package-manager commands (line 97). It also adds `lint`, `build`, `both tsc` and `E2E` checks when those words appear in the prose, meaning the text with backtick spans removed (lines 117-128). If nothing is found, it falls back to `defaultVerify`.

`runTask` (`src/facade/cascade_facade.ts:607`) calls it once per task. An empty result means the harness only waits for the checkbox (line 699). `selectVerifyChecks` (`fast_track.ts`) then drops typecheck, test and build for docs-only changes.

`defaultVerify` and `fullVerify` are plain string lists in the config schema (`src/config/schemas.ts:460-463`, file schema at `515-518`). They have no safety validation.

## Goals / Non-Goals

**Goals:**
- Read checks only from the Verify segment.
- Add `alwaysVerify` with safety validation at config load.

**Non-Goals:**
- Changing the docs-only fast-track, "full verification", `--full-gate`, the `bun audit` exclusion, or the Nuxt `tsc` expansion.
- Linting tasks for commands written outside the Verify segment. Once those commands are ignored, they do no harm.

## Decisions

- **The Verify segment is a substring cut, not a new parser.** Find the first match of `\bVerify:` in `task.text` and keep the text from there to the end. Both existing scans then run on that segment: the backtick scan and the prose keyword scan. "full verification" detection and the `gated` rule keep using the whole text, because "full verification" is an instruction about verification wherever it is written. Alternative considered: parse the `Verify:` line separately in `parseTasks`. Rejected: it changes the `Task` type and every caller for no behavior gain.
- **No Verify marker: unchanged.** The segment rule applies only when a marker exists. Tasks with "full verification" and no marker keep scanning the whole text, so the existing tests for full-verification tasks stay valid.
- **`alwaysVerify` is appended in `runTask`, not in `verifyCommands`.** `verifyCommands` stays a function of the task text. `runTask` merges `verifyCommands(...)` with `ctx.config.alwaysVerify` into a de-duplicated list, preserving order: task checks first, then `alwaysVerify`. A task with no task checks but a non-empty `alwaysVerify` goes through the verification path: the harness runs the checks and then marks the box. Alternative considered: put it inside `verifyCommands` through `options.config`. Rejected: that mixes project policy into task parsing, and the v2 pipeline would pick it up implicitly.
- **Safety is checked when config loads.** The file schema adds `alwaysVerify: stringListSchema.readonly().optional()`, refined with `isSafeVerifyCommand`. The refine's error message names the first unsafe command. The resolved config defaults to an empty list in `src/config/constants.ts`. The config file is the only source: no CLI flag and no environment variable.
- **Fast-track applies to `alwaysVerify` too.** An architecture lint is classified `lint` or `other`, so it is never skipped. A test command in `alwaysVerify` is skipped on docs-only changes, like any other test check.

## Risks / Trade-offs

- [A project relied on a command written before `Verify:`] → That check disappears silently. Mitigation: the README and `docs/cli.md` state the rule. Moving the command into the Verify line restores it.
- [`alwaysVerify` makes tasks without Verify slower] → This is intended. The setting is opt-in and empty by default.
