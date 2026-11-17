# Spec Delta

## Purpose

Leaves a plain-language record of each run inside the change and an exit code that tells callers whether a human is needed.

## ADDED Requirements

### Requirement: Summary file per change
At the end of a run that is not a dry run, the harness SHALL append to `openspec/changes/<change>/run-summary.md`, for each change in the run, a section headed with the run's start time and outcome. The section SHALL list done tasks with their commit, parked tasks with kind, first line and file path, waiting tasks with what they wait on, human tasks and manual steps. The harness SHALL commit the file as `chore(<change>): record run summary`.

#### Scenario: Run with a parked task
- **WHEN** a run finishes with 1.1 done and 2.1 parked
- **THEN** `run-summary.md` gains a section that lists 1.1 with its commit and 2.1 with its parked file path

#### Scenario: Second run
- **WHEN** a second run finishes on the same change
- **THEN** the file keeps the first section and adds a new one below it

### Requirement: Final report mirrors the summary
The final console report SHALL print the same lists as the summary file, followed by the path of each summary file. Failed or parked tasks SHALL NOT be reported as human tasks.

#### Scenario: Parked task is not a human task
- **WHEN** a task is parked
- **THEN** the report lists it as parked and not under human tasks

### Requirement: Exit code for runs that need a human
A run that ends without a fatal error but with at least one parked or waiting task SHALL exit with code 3. A run where every task is done or skipped as a human task SHALL exit 0. Fatal errors and crashes SHALL keep exit codes 2 and 1.

#### Scenario: Parked task exit code
- **WHEN** a run finishes with one parked task and no fatal error
- **THEN** the process exits 3
