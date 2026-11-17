# Tasks

## Files

- Modify: `src/facade/tasks.ts`, `src/facade/cascade_facade.ts`, `src/config/schemas.ts`, `src/config/loader.ts`, `src/config/constants.ts`, `cascade.test.ts`, `test/config/loader.test.ts`, `test/facade/cascade_facade.test.ts`, `docs/cli.md`, `README.md`.
- Untouched: `fast_track.ts`, `src/facade/v2_pipeline.ts`, every file under `src/core/`.

## 1. Verify segment

- [ ] 1.1 Test first, then implement, in this one task. In `cascade.test.ts`, add a describe block "verifyCommands reads only the Verify segment" with one test per scenario of the first requirement in the `task-verification` spec delta: command in the instructions, keyword in the instructions, commands in the Verify segment on a continuation line, Verify segment without a recognized command, full verification without a marker, and a task with neither. Each test builds its task with `parseTasks` from a literal tasks.md string and asserts the exact command list. Run the root test file and see the new tests fail before changing source. Then change `verifyCommands` in `src/facade/tasks.ts` as design.md says: when the marker exists, both the backtick scan and the prose keyword scan read only the text from the first marker to the end. The "full verification" and gated rules keep reading the whole text. The existing tests in `cascade.test.ts` must keep passing unchanged. No comments inside function bodies.
  Verify: `bun test cascade.test.ts` passes, `bun run typecheck` passes and `bun run lint` passes.

## 2. alwaysVerify

- [ ] 2.1 Test first, then implement. Add the optional `alwaysVerify` list to the file config schema in `src/config/schemas.ts` and to the resolved config, with an empty default in `src/config/constants.ts` and resolution in `src/config/loader.ts` (file config only, no CLI flag, no environment variable). Reject a list that contains a command failing `isSafeVerifyCommand`, with an error message that names the command. In `test/config/loader.test.ts`, cover: absent key gives an empty list, a valid list is kept in order, and an unsafe command fails to load with its text in the message.
  Verify: `bun test test/config/loader.test.ts` passes, `bun run typecheck` passes and `bun run lint` passes.
- [ ] 2.2 Test first, then implement. In `runTask` (`src/facade/cascade_facade.ts`), merge the task checks with `ctx.config.alwaysVerify` into one list without duplicates, task checks first. A task without task checks but with `alwaysVerify` set goes through the verification path, so the harness marks its box only after the checks pass. In `test/facade/cascade_facade.test.ts`, using the existing temporary repo and scripted engine helpers, cover the three `alwaysVerify` scenarios of the spec delta: with Verify, without Verify, and the duplicate command. Assert which commands ran. Also cover that with an empty `alwaysVerify` a task without Verify is still accepted by its checkbox alone.
  Verify: `bun test test/facade/cascade_facade.test.ts` passes, `bun run typecheck` passes and `bun run lint` passes.

## 3. Docs and full suite

- [ ] 3.1 In `docs/cli.md`, in the section about verification commands from tasks.md, state that commands are read only from the text after the `Verify:` marker and that commands or keywords written before it are ignored. Add `alwaysVerify` to the configuration documentation with one example (an architecture lint) and its safety rule. In `README.md`, update the "Checks are the oracle" bullet the same way. Keep `docs/cli.md` in Spanish and `README.md` in English.
  Verify: `bun test` passes with zero failures, `bun run typecheck` passes and `bun run lint` passes.
