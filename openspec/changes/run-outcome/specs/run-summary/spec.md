# Spec Delta

## Purpose

Leaves a plain-language record of each v1 run inside the change and an exit code that tells callers whether a human is needed. v2 mode is being deprecated and is not covered.

## ADDED Requirements

### Requirement: Summary file per change
At the end of a run that is not a dry run, the harness SHALL append to `openspec/changes/<change>/run-summary.md`, for each change where something ran or changed, a section headed with the run's start time and outcome. The outcome SHALL be `ok`, `partial` or `stopped: <reason>`.

#### Scenario: Run with a parked task
- **WHEN** a run finishes with 1.1 done and 2.1 parked
- **THEN** `run-summary.md` gains a section with outcome `partial` that lists 1.1 with its commit and 2.1 with its parked file path

#### Scenario: Second run
- **WHEN** a second run finishes on the same change
- **THEN** the file keeps the first section and adds a new one below it

### Requirement: Summary content
Each section SHALL list done tasks with their commit, parked tasks with kind, first line and file path, waiting tasks with the task they wait on, stale parked files with the reason, human tasks, and manual steps.

#### Scenario: Waiting and stale entries
- **WHEN** 1.3 waits on parked 1.2 and `parked/4.1.md` is stale because task 4.1 no longer exists
- **THEN** the section lists `1.3` as waiting on `1.2` and `parked/4.1.md` as stale with the reason

### Requirement: Summary commit
The harness SHALL commit each written `run-summary.md` with a path-limited commit `chore(<change>): record run summary`. It SHALL NOT write or commit a summary for a change where no task ran, parked, waited or changed state. A failed summary commit SHALL be printed and SHALL NOT change the exit code.

#### Scenario: No-op run
- **WHEN** a run finds every task of a change already done and nothing changes
- **THEN** no section is appended and no summary commit is made for that change

### Requirement: Summary on a stopped run
When the run stops on a run-level error (budget, engine fatal, commit failure), the harness SHALL still write and commit the summary with outcome `stopped: <reason>`. It SHALL NOT write a summary for a dry run or after a failed rollback.

#### Scenario: Budget stop
- **WHEN** the total budget is exceeded after task 1.1 is done
- **THEN** `run-summary.md` gains a section with outcome `stopped: <budget message>` listing 1.1 as done, and the process exits 2

#### Scenario: Failed rollback
- **WHEN** a rollback fails during the run
- **THEN** no summary is written and the process exits 2

### Requirement: Final report mirrors the summary
The final console report SHALL print the same lists as the summary file, followed by the path of each summary file. Failed or parked tasks SHALL NOT be reported as human tasks.

#### Scenario: Parked task is not a human task
- **WHEN** a task is parked
- **THEN** the report lists it as parked and not under human tasks

### Requirement: Task and change statuses
A task record SHALL have status `done`, `failed`, `skipped`, `parked` or `waiting`. A change SHALL have status `partial` when at least one of its tasks is parked or waiting at the end of the run.

#### Scenario: Partial change
- **WHEN** a run ends with task 1.2 of change `a` parked
- **THEN** the run result reports change `a` with status `partial` and task 1.2 with status `parked`

### Requirement: Exit codes
The run SHALL exit 0 when every task is done or skipped as a human task, 1 on a crash, 2 on a fatal or fail-closed error, and 3 when it ends without a run-level error but with at least one parked or waiting task. The signal exit codes SHALL stay unchanged.

#### Scenario: Parked task exit code
- **WHEN** a run finishes with one parked task and no fatal error
- **THEN** the process exits 3
