# Spec Delta

## Purpose

Tells the user which step comes next for a change, and with which command, derived only from the files and stamps in the change folder.

## ADDED Requirements

### Requirement: status subcommand
`openspec-cascade status <change>` SHALL print the change's next stage, the command to run and the reason. It SHALL accept `--repo` and `--json`. It SHALL exit 0 when it can determine a stage, and 2 for invalid usage. It SHALL NOT change any file.

#### Scenario: JSON output
- **WHEN** `status my-change --json` runs
- **THEN** it prints a JSON object with `stage`, `command` and `reason`

### Requirement: Next-step rules
The next stage SHALL be the first that applies, in this order: `explore` (no folder or no proposal), `propose` (no `tasks.md`), `fix-tasks` (lint findings), `spec-review` (review stamp not resolved and fresh), `answer-parked` (a parked task without an answer), `run` (an unchecked task), `code-review` (only when `codeReview.afterRun` is on and its stamp is not resolved and fresh), `drift` (drift stamp not resolved and fresh), then `archive`. An archived change SHALL report `archived`.

#### Scenario: No tasks yet
- **WHEN** the change has a proposal and no `tasks.md`
- **THEN** the stage is `propose`

#### Scenario: Unanswered parked task
- **WHEN** the review stamp is resolved and fresh and `parked/2.1.md` has an empty answer
- **THEN** the stage is `answer-parked` and the reason names `parked/2.1.md`

#### Scenario: Ready to archive
- **WHEN** all tasks are checked and the review and drift stamps are resolved and fresh, and code review is off
- **THEN** the stage is `archive` and the command names `/openspec-archive-change <change>`

#### Scenario: Archived change
- **WHEN** the change exists only under `openspec/changes/archive/`
- **THEN** the stage is `archived`
