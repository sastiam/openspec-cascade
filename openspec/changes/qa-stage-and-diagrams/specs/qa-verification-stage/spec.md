# QA Verification Stage Specification

## ADDED Requirements

### Requirement: Autonomous QA Verification with Feedback Loop
The harness MUST run full verification commands and re-inject failure traces into agent retries.

#### Scenario: Verification failure
- **WHEN** a verification command (`bun test`, `tsc`, `lint`, `build`) fails
- **THEN** the harness captures stderr/stdout and includes it in the prompt for the next retry attempt.

### Requirement: 24/7 Failure Resilience and Git Rollback State Buffer
The harness MUST guarantee that when a task fails after exhausting maximum retry attempts (`maxAttemptsPerTask`), the working tree is cleanly restored via git rollback (`git reset --hard` and `git clean -fd`) so that broken modifications and untracked artifacts do not contaminate the repository or subsequent tasks.

#### Scenario: Task exhausts maximum attempts
- **WHEN** a task fails all retry attempts (e.g. 3 consecutive attempts)
- **THEN** the harness automatically executes a rollback buffer (`git reset --hard` and `git clean -fd` preserving excluded files)
- **AND** logs the rollback event with target commit reference and status
- **AND** leaves the repository working tree in a clean state matching the baseline before the task began.

#### Scenario: Resilient 24/7 autonomous mode
- **WHEN** cascade runs in resilient mode (`--resilient` or `CASCADE_RESILIENT=true`)
- **AND** a task fails after exhausting retries
- **THEN** the harness rolls back the task's changes to clean state, records the failed task, and continues executing remaining pending tasks.
