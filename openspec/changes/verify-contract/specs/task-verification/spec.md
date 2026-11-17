# Spec Delta

## Purpose

Defines which commands the harness runs to decide that a task is verified: the commands read from the task's Verify segment, the defaults, and the project-wide checks added to every task in v1 runs.

In the scenarios, a task is written as its tasks.md lines; a line that starts with two spaces is a continuation line. Unless a scenario says otherwise, checks are computed without a repo root or config, as `cascade.test.ts` does. Scenarios that set `alwaysVerify` compute the merged checks for a config loaded from a directory without `package.json`.

In a v1 run that is not a dry run, the tasks.md preflight rejects every unchecked task without an indented Verify line before any session, so the inline marker and tasks without a marker are reached only by dry-run plans and direct callers.

## ADDED Requirements

### Requirement: Verify marker
The Verify marker of a task SHALL be its first continuation line that matches the `lint-tasks` rule `VERIFY_LINE`: an indented line with an optional `-` or `*` list marker followed by `Verify:` and text. If no continuation line matches, the marker SHALL be the first `Verify:` on the task line outside backtick spans. A `Verify:` inside backticks or in the middle of a continuation line SHALL NOT be a marker.

#### Scenario: Marker on a continuation line
- **WHEN** a task is "- [ ] 1.1 Add the parser. Run `bun test test/a.test.ts` and see the new tests fail." followed by "  Verify: `bun run typecheck` passes"
- **THEN** the task's checks are exactly ["bun run typecheck"]

#### Scenario: Marker mentioned inside the instructions
- **WHEN** a task is "- [ ] 1.1 Teach the guide that `Verify:` starts the checks; run `bun run docs:gen`." followed by "  Then mention Verify: in the summary and run `bun run docs:check`." and "  Verify: `bun test` passes"
- **THEN** the task's checks are exactly ["bun test"]

#### Scenario: Mention without a marker
- **WHEN** a task is only "- [ ] 1.1 Teach the guide that `Verify:` starts the checks; run `bun run docs:gen`."
- **THEN** the task has no Verify segment and no checks

#### Scenario: Inline marker on the task line
- **WHEN** a task is "- [ ] 1.1 Run `bun run gen` first. Verify: `bun test` passes." with no continuation line
- **THEN** the task's checks are exactly ["bun test"]

#### Scenario: Continuation marker wins over an inline marker
- **WHEN** a task is "- [ ] 1.1 Write the guide. Verify: `bun run docs:old` is gone." followed by "  Verify: `bun test` passes"
- **THEN** the task's checks are exactly ["bun test"]

### Requirement: Checks come only from the Verify segment
When a task has a Verify marker, the harness SHALL build its checks only from the Verify segment, the text from the marker to the end of the task. The backtick command scan and the `lint`, `build`, `both tsc` and `E2E` detections SHALL read only the segment. If the segment yields no recognized command, the harness SHALL use the default verify commands.

#### Scenario: Keywords in the instructions are not checks
- **WHEN** a task is "- [ ] 1.1 Update the build docs and fix the lint warnings about E2E runs; both tsc programs stay as they are." followed by "  Verify: `bun test` passes"
- **THEN** the task's checks are exactly ["bun test"]

#### Scenario: Keywords in the Verify segment are checks
- **WHEN** a task is "- [ ] 1.1 Add the page." followed by "  Verify: the build passes and both tsc programs pass"
- **THEN** the task's checks are exactly ["bunx nuxi prepare", "bun run build", "bunx tsc --noEmit -p .nuxt/tsconfig.server.json", "bunx tsc --noEmit -p .nuxt/tsconfig.app.json"]

#### Scenario: Verify segment without a recognized command
- **WHEN** a task is "- [ ] 1.1 Change the title." followed by "  Verify: the page renders the new title"
- **THEN** the task's checks are exactly ["bun test", "bun run lint"]

#### Scenario: Full verification without a Verify marker
- **WHEN** a task is "- [ ] T013 Framework batch. Run full verification." with no Verify marker
- **THEN** the task's checks are exactly ["bunx nuxi prepare", "bun test", "bun run lint", "bunx tsc --noEmit -p .nuxt/tsconfig.server.json", "bunx tsc --noEmit -p .nuxt/tsconfig.app.json", "bun run build", "bun run test:e2e"], the same as before this change

#### Scenario: Task without Verify and without full verification
- **WHEN** a task is only "- [ ] 1.1 Change the title." and `alwaysVerify` is empty
- **THEN** `verifyCommands` returns [] and the merged checks are [], as before this change. In a v1 run the tasks.md preflight rejects such an unchecked task before any session, so only dry-run plans and direct callers see this case

### Requirement: Full verification with a Verify segment
"full verification" and `--full-gate` SHALL be detected in the whole task text. When a task has both "full verification" and a Verify segment, the harness SHALL add the full verify commands only when the segment's backtick scan finds no command, and SHALL ignore commands before the marker. Such a task SHALL never be shortened by the docs-only fast-track.

#### Scenario: Full verification and a segment without commands
- **WHEN** a task is "- [ ] 1.1 Run full verification. Earlier notes mention `bun run db:check`." followed by "  Verify: the suite is green"
- **THEN** the task's checks are exactly ["bunx nuxi prepare", "bun test", "bun run lint", "bunx tsc --noEmit -p .nuxt/tsconfig.server.json", "bunx tsc --noEmit -p .nuxt/tsconfig.app.json", "bun run build", "bun run test:e2e"]

#### Scenario: Full verification and a segment with a command
- **WHEN** a task is "- [ ] 1.1 Run full verification." followed by "  Verify: `bun test` passes"
- **THEN** the task's checks are exactly ["bun test"], and the docs-only fast-track skips none of them

### Requirement: Ignored commands are reported
When a task has a Verify marker, the harness SHALL list as ignored every backticked package-manager command written before the marker, as written. In a v1 run it SHALL write a `verify_ignored` run-log event with the change, the task id and the commands. In a dry run it SHALL show them as an `ignored=[...]` flag after the `verify=[...]` flag of the task's plan line.

#### Scenario: Command before the marker is reported
- **WHEN** a task is "- [ ] 1.1 Run `bun test test/a.test.ts` and see it fail." followed by "  Verify: `bun run typecheck` passes"
- **THEN** the ignored commands are exactly ["bun test test/a.test.ts"], the run log has a `verify_ignored` event for task 1.1 with that list, and the dry-run plan line for 1.1 contains "verify=[bun run typecheck] ignored=[bun test test/a.test.ts]"

#### Scenario: Nothing to report
- **WHEN** a task is "- [ ] 1.1 Verify: `bun test`. Commit `feat(api)`", whose marker starts its text
- **THEN** the ignored commands are empty, no `verify_ignored` event is written, and the plan line has no "ignored=" flag

### Requirement: Project-wide checks in v1 runs
In a v1 run, the harness SHALL add every command in the project setting `alwaysVerify` to the checks of every task, after the task's own checks, each command at most once. The merged list SHALL be the one shown to the agent, gated, passed to the docs-only fast-track and shown in the dry-run plan. `alwaysVerify` commands SHALL run exactly as written. When `alwaysVerify` is empty, checks SHALL be as without it.

#### Scenario: Architecture check on a task with Verify
- **WHEN** `alwaysVerify` is ["bun run arch:check"] and a task is "- [ ] 1.1 Create the module." followed by "  Verify: `bun test` passes"
- **THEN** the task's checks are exactly ["bun test", "bun run arch:check"], and the agent's prompt and the dry-run plan show both

#### Scenario: Duplicate command
- **WHEN** `alwaysVerify` is ["bun run arch:check"] and a task is "- [ ] 1.1 Create the module." followed by "  Verify: `bun run arch:check` passes"
- **THEN** the task's checks are exactly ["bun run arch:check"]

#### Scenario: Commands run as written
- **WHEN** `alwaysVerify` is ["bunx tsc --noEmit", "bun audit"] and a task is "- [ ] 1.1 Create the module." followed by "  Verify: `bun test` passes"
- **THEN** the task's checks are exactly ["bun test", "bunx tsc --noEmit", "bun audit"], with no Nuxt expansion and no `bun audit` exclusion

#### Scenario: Empty setting
- **WHEN** `alwaysVerify` is [] and a task is "- [ ] 1.1 Create the module." followed by "  Verify: `bun test` passes"
- **THEN** the task's checks are exactly ["bun test"], the same as before this change

### Requirement: alwaysVerify configuration
`alwaysVerify` SHALL be a list of strings set only in `.openspec-cascade.json` or programmatic overrides, with an empty default, and no CLI flag or environment variable. A list with a command that contains a shell operator SHALL fail to load with an error that names the first such command, for both the file and overrides.

#### Scenario: Absent key
- **WHEN** the config file has no `alwaysVerify` key and no override sets it
- **THEN** the loaded `alwaysVerify` is []

#### Scenario: Valid list
- **WHEN** the config file sets `alwaysVerify` to ["bun run arch:check", "bun test"]
- **THEN** the loaded `alwaysVerify` is exactly that list, in that order

#### Scenario: Unsafe command in the config file
- **WHEN** the config file sets `alwaysVerify` to ["bun run arch:check", "bun run lint && rm -rf dist"]
- **THEN** loading fails with a configuration error whose message contains "bun run lint && rm -rf dist", before any task runs

#### Scenario: Unsafe command in overrides
- **WHEN** programmatic overrides set `alwaysVerify` to ["bun test | tee out.txt"]
- **THEN** loading fails with a configuration error whose message contains "bun test | tee out.txt"

### Requirement: alwaysVerify baseline before the first task
Before the first task of a v1 run that is not a dry run, when `alwaysVerify` is not empty, the harness SHALL run every `alwaysVerify` command once. If any exits non-zero, the run SHALL stop with the fail-closed exit code before any engine session, with a message that starts with the baseline-failure text and names each failing command. The baseline SHALL NOT print per-command check lines.

#### Scenario: Baseline fails
- **WHEN** `alwaysVerify` is ["bun run arch:check"] and that script exits 1 on the starting state
- **THEN** the run exits with code 2, no engine session runs, and the error message contains "bun run arch:check"

#### Scenario: Baseline passes
- **WHEN** `alwaysVerify` is ["bun run arch:check"] and that script exits 0 on the starting state
- **THEN** the tasks run as usual

#### Scenario: Dry run
- **WHEN** the run is a dry run and `alwaysVerify` is not empty
- **THEN** the baseline does not run

### Requirement: alwaysVerify in v2 mode
`alwaysVerify` SHALL NOT be applied in v2 runs. Loading a configuration with mode v2 and a non-empty `alwaysVerify` SHALL print a warning that names `alwaysVerify` and v2, and SHALL NOT fail.

#### Scenario: v2 config with alwaysVerify
- **WHEN** the config file sets `mode` to "v2" and `alwaysVerify` to ["bun run arch:check"]
- **THEN** the config loads, and one warning is printed that contains "alwaysVerify" and "v2"

#### Scenario: v1 config with alwaysVerify
- **WHEN** the config file sets `mode` to "v1" and `alwaysVerify` to ["bun run arch:check"]
- **THEN** the config loads and no warning is printed
