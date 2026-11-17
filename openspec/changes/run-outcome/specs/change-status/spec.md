# Spec Delta

## Purpose

Tells the user which step comes next for a change, and with which command, derived only from the files, stamps and git history of the repository.

## ADDED Requirements

### Requirement: status subcommand
`openspec-cascade status <change>` SHALL print the change's next stage, the command to run and the reason. It SHALL accept `--repo` and `--json`, and check the change name like `spec-gate` does. It SHALL read `codeReview.afterRun` from the loaded config. It SHALL exit 0 when it can determine a stage, and 2 for invalid usage or an invalid config. It SHALL NOT change any file.

#### Scenario: JSON output
- **WHEN** `status my-change --json` runs
- **THEN** it prints a JSON object with `stage`, `command`, `reason` and `stale`, where `stale` lists stale parked files

#### Scenario: Invalid change name
- **WHEN** `status ../x` runs
- **THEN** it exits 2 with a usage error

#### Scenario: Invalid config
- **WHEN** the repo's `.openspec-cascade.json` has an unknown key
- **THEN** `status my-change` exits 2

### Requirement: Pure rules and gathered facts
The stage SHALL be computed by a pure `nextStep(facts)` function. A separate `gatherFacts` function SHALL read the repository to build the facts. `nextStep` SHALL NOT read files or run commands.

#### Scenario: Same facts, same stage
- **WHEN** `nextStep` is called twice with equal facts
- **THEN** it returns equal results without touching the file system

### Requirement: Next-step order
The next stage SHALL be the first that applies, in this order: `explore` (no folder or no proposal), `propose` (no `tasks.md`), `fix-tasks` (task findings), `spec-review` (review stamp not resolved and fresh), `answer-parked` (a non-stale parked task without an answer), `run` (an unchecked task), then the code review, drift and archive stages.

#### Scenario: No change folder
- **WHEN** the change has no folder and no archived folder
- **THEN** the stage is `explore` and the command is `/cascade:explore <change>`

#### Scenario: No tasks yet
- **WHEN** the change has a proposal and no `tasks.md`
- **THEN** the stage is `propose` and the command is `/cascade:openspec-propose <change>`

#### Scenario: Task findings
- **WHEN** `tasks.md` has a linter finding
- **THEN** the stage is `fix-tasks` and the command is `openspec-cascade lint-tasks --changes <change>`

#### Scenario: Review not done
- **WHEN** the tasks are clean and `review.md` is missing
- **THEN** the stage is `spec-review` and the command is `/cascade:cascade-spec-review <change>`

#### Scenario: Unanswered parked task
- **WHEN** the review stamp is resolved and fresh and `parked/2.1.md` has an empty answer
- **THEN** the stage is `answer-parked` and the reason names `parked/2.1.md`

#### Scenario: Stale parked file does not block
- **WHEN** the only parked file is stale and task 2.1 is unchecked
- **THEN** the stage is `run`, the command is `openspec-cascade --changes <change> --park`, and `stale` lists the parked file

### Requirement: Final stages
After `run`, the stage SHALL be `code-review` when `codeReview.afterRun` is on and its stamp is not resolved and fresh, then `drift` when the drift stamp is not resolved and fresh, then `archive`. An archived change SHALL report `archived` with an empty command.

#### Scenario: Drift not done
- **WHEN** all tasks are checked, code review is off and `drift.md` is missing
- **THEN** the stage is `drift` and the command is `/cascade:cascade-spec-drift <change>`

#### Scenario: Ready to archive
- **WHEN** all tasks are checked and the review and drift stamps are resolved and fresh, and code review is off
- **THEN** the stage is `archive` and the command is `/cascade:openspec-archive-change <change>`

#### Scenario: Code changed after the review
- **WHEN** code review is on, its stamp is resolved, and a commit after the reviewed HEAD changed `src/a.ts`
- **THEN** the stage is `code-review` and the command is `openspec-cascade --changes <change>`

#### Scenario: Archived change
- **WHEN** the change exists only under `openspec/changes/archive/`
- **THEN** the stage is `archived`
