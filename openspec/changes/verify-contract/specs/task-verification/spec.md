# Spec Delta

## Purpose

Defines which commands the harness runs to decide that a task is verified: the commands read from the task's `Verify:` segment, the defaults, and the project-wide checks added to every task.

## ADDED Requirements

### Requirement: Checks come only from the Verify segment
When a task contains a `Verify:` marker, the harness SHALL build the task's checks only from the task's Verify segment. The Verify segment is the text from the first `Verify:` marker to the end of the task, including its continuation lines. Backticked commands and check keywords (`lint`, `build`, `both tsc`, `E2E`) that appear before the marker SHALL NOT produce checks. If the Verify segment yields no recognized command, the harness SHALL use the default verify commands.

#### Scenario: Command in the instructions is not a check
- **WHEN** a task says "Run `bun test test/a.test.ts` and see the new tests fail" and its Verify segment is "Verify: `bun run typecheck` passes"
- **THEN** the task's checks are `bun run typecheck` and do not include `bun test test/a.test.ts`

#### Scenario: Keyword in the instructions is not a check
- **WHEN** a task says "Update the build docs" and its Verify segment is "Verify: `bun test` passes"
- **THEN** the task's checks do not include a build command

#### Scenario: Commands in the Verify segment are checks
- **WHEN** a task's Verify segment is on an indented continuation line and names `bun test`, `bun run typecheck` and `bun run lint`
- **THEN** the task's checks are exactly those three commands

#### Scenario: Verify segment without a recognized command
- **WHEN** a task's Verify segment is "Verify: the page renders the new title"
- **THEN** the task's checks are the default verify commands

#### Scenario: Full verification without a Verify marker
- **WHEN** a task has no `Verify:` marker and says "Run full verification: `bun test`, `bun run build`"
- **THEN** the task's checks are the same as before this change

#### Scenario: Task without Verify and without full verification
- **WHEN** a task has neither a `Verify:` marker nor "full verification", and `alwaysVerify` is empty
- **THEN** the task has no checks, and only its checkbox decides that it is done, as before this change

### Requirement: Project-wide checks run for every task
The harness SHALL add every command listed in the project setting `alwaysVerify` to the checks of every task, including tasks without a `Verify:` marker. A command SHALL appear at most once in a task's checks. `alwaysVerify` commands SHALL be subject to the same command safety rules as task commands. They SHALL also be subject to the same docs-only fast-track rules. When `alwaysVerify` is absent or empty, the checks SHALL be the same as without the setting.

#### Scenario: Architecture lint on a task with Verify
- **WHEN** `alwaysVerify` is `["bun run lint:arch"]` and a task's Verify segment names `bun test`
- **THEN** the task's checks are `bun test` and `bun run lint:arch`

#### Scenario: Architecture lint on a task without Verify
- **WHEN** `alwaysVerify` is `["bun run lint:arch"]` and a task has no `Verify:` marker
- **THEN** the task's checks are `bun run lint:arch`, and the task is done only when that check exits 0

#### Scenario: Duplicate command
- **WHEN** `alwaysVerify` is `["bun run lint"]` and a task's Verify segment also names `bun run lint`
- **THEN** `bun run lint` appears once in the task's checks

#### Scenario: Unsafe command in alwaysVerify
- **WHEN** `alwaysVerify` contains a command with a shell operator such as `bun run lint && rm -rf dist`
- **THEN** loading the configuration fails with an error that names the command, before any task runs
