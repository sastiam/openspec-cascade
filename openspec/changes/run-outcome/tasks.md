# Tasks

## Files

- Create: `src/park/format.ts`, `src/park/patch.ts`, `src/park/state.ts`, `src/park/summary.ts`, `src/status/next_step.ts`, `src/cli/status.ts`, and tests under `test/park/`, `test/status/`, `test/cli/status.test.ts`.
- Modify: `src/engine/rollback_buffer.ts`, `src/facade/cascade_facade.ts`, `src/facade/tasks.ts`, `src/cli/commands.ts`, `src/cli/spec_gate.ts`, `src/config/constants.ts`, `src/config/schemas.ts`, `src/config/loader.ts`, `test/facade/cascade_facade.test.ts`, `test/cli/spec_gate.test.ts`, `docs/cli.md`, `README.md`.
- Untouched: `src/facade/v2_pipeline.ts`, everything under `src/core/` except calling `PrePrReviewLoop`.

## 1. Rollback baseline

- [ ] 1.1 Test first, then implement. Extend `RollbackStateBuffer` so `snapshot()` also records a tree of the full working tree through a temporary index, and `rollback()` restores that tree after the reset and clean, as design.md describes. In a new `test/engine/rollback_tree.test.ts` with a real temporary git repo, cover both scenarios of "Rollback restores the task-start tree" and that excluded paths are left untouched.
  Verify: `bun test test/engine` passes, `bun run typecheck` passes and `bun run lint` passes.

## 2. Parked files

- [ ] 2.1 Test first, then implement. Create `src/park/format.ts` and `src/park/state.ts` with `PARK_CONSTANTS` in `src/config/constants.ts` (format version, folder name, answer heading, failure cap). In `test/park/format.test.ts`, cover writing a question park and a failure park, parsing them back, the "Answer read" scenario, an empty answer, an answer with only whitespace, a second round appended with the first round kept, and the failure cap note.
  Verify: `bun test test/park` passes, `bun run typecheck` passes and `bun run lint` passes.
- [ ] 2.2 Test first, then implement. Create `src/park/patch.ts` that captures the diff between a recorded tree and the current tree, excluding the change folder and the never-commit paths, with binary support, writing no file for an empty diff. In `test/park/patch.test.ts` with a real temporary repo, cover the "Patch excludes the change folder" scenario, an untracked new file being included, and the empty diff.
  Verify: `bun test test/park` passes, `bun run typecheck` passes and `bun run lint` passes.

## 3. Parking in the run loop

- [ ] 3.1 Test first, then implement. Add `--park` as an alias of `--resilient` in `src/config/loader.ts` and its help text. Change `runTask` to return a done or parked result as design.md describes, and make `runChange` park (patch, rollback, write, commit in that order), compute waiting tasks, and continue. With parking off, keep today's fatal and task-failure behavior. In `test/facade/cascade_facade.test.ts`, with the scripted engine and a real temporary repo, cover: both scenarios of "Tasks are parked instead of stopping the run", "Parking off", "Section barrier", and that a parked task is not reported as a human task.
  Verify: `bun test test/facade/cascade_facade.test.ts` passes, `bun run typecheck` passes and `bun run lint` passes.
- [ ] 3.2 Test first, then implement. Read parked state at the start of each change: skip unanswered parked tasks without a session, run answered ones with the parked file text and patch path appended to the prompt, and remove the parked files in the commit of a resumed task that passes. In `test/facade/cascade_facade.test.ts`, cover both scenarios of "Resume on the next run" and a resumed task that parks again keeping the first round.
  Verify: `bun test test/facade/cascade_facade.test.ts` passes, `bun run typecheck` passes and `bun run lint` passes.

## 4. Summary and exit code

- [ ] 4.1 Test first, then implement. Create `src/park/summary.ts` with `renderRunSummary`, add `EXIT_CODE_PARKED` to the exit code constants, add the parked and waiting task statuses and the partial change status, append and commit `run-summary.md` per change at the end of a run that is not a dry run, and print the same lists in the final report. In `test/park/summary.test.ts` and `test/facade/cascade_facade.test.ts`, cover every scenario of the `run-summary` spec delta, including the second run keeping the first section and the exit code 3.
  Verify: `bun test test/park` passes, `bun test test/facade/cascade_facade.test.ts` passes, `bun run typecheck` passes and `bun run lint` passes.

## 5. status

- [ ] 5.1 Test first, then implement. Add the `code-review` stage to `SPEC_GATE_CONSTANTS` with its report file, and cover both scenarios of the `spec-gate` delta in `test/cli/spec_gate.test.ts`.
  Verify: `bun test test/cli/spec_gate.test.ts` passes, `bun run typecheck` passes and `bun run lint` passes.
- [ ] 5.2 Test first, then implement. Create `src/status/next_step.ts` (pure `nextStep` and `gatherFacts`) and `src/cli/status.ts`, and register `status` as a subcommand. In `test/status/next_step.test.ts`, cover each stage of "Next-step rules" with one facts object per stage, and in `test/cli/status.test.ts` cover the JSON output, the archived change and invalid usage exiting 2, using temporary repos.
  Verify: `bun test test/status` passes, `bun test test/cli/status.test.ts` passes, `bun run typecheck` passes and `bun run lint` passes.

## 6. Code review before the PR

- [ ] 6.1 Test first, then implement. Add the strict optional `codeReview` object to the file schema and resolved config as design.md describes, and extract the review loop factory from `reviewCommand` in `src/cli/commands.ts` into a shared function that both `reviewCommand` and the facade use, keeping `reviewCommand` output and exit codes unchanged. In `test/config/loader.test.ts`, cover defaults, a full object, and an unknown key failing to load. Keep the existing review command tests passing.
  Verify: `bun test test/config/loader.test.ts` passes, `bun test test/cli` passes, `bun run typecheck` passes and `bun run lint` passes.
- [ ] 6.2 Test first, then implement. After a run that exits 0 with `codeReview.afterRun` set, run the review loop through the shared factory with an injected fake Greptile client, apply the fix-check-commit-or-restore rule, write and commit `code-review.md` in each change of the run with a pure `renderCodeReview`, and stamp it through the spec-gate stamp function following the threshold rule. In `test/facade/cascade_facade.test.ts`, cover every scenario of the `code-review-gate` spec delta and a Greptile error leaving an open stamp without changing the exit code.
  Verify: `bun test test/facade/cascade_facade.test.ts` passes, `bun run typecheck` passes and `bun run lint` passes.

## 7. Docs and full suite

- [ ] 7.1 Document in `docs/cli.md` (Spanish) and `README.md` (English): `--park` and its aliases, the parked file format and how to answer, waiting tasks, `run-summary.md`, exit code 3 (and that forja prints it as a failure until forja maps it), `status` and its stages, `codeReview` with its keys, `code-review.md` and the `code-review` stamp.
  Verify: `bun test` passes with zero failures, `bun run typecheck` passes and `bun run lint` passes.
