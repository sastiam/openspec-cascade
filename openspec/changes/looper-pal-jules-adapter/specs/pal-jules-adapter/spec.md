# Spec Delta: Adaptador Google Jules (Jules Tools CLI)

## Purpose

Conecta el looper con Jules mediante sesiones remotas asíncronas orquestadas por la CLI `jules remote`.

## ADDED Requirements

### Requirement: Remote Session Delegation
The adapter SHALL create a Jules remote session for a task and return its session identifier.

#### Scenario: Task delegated to a repository
- **WHEN** a task prompt and repository are provided
- **THEN** the adapter runs `jules remote new` with the repo and prompt and captures the session ID

#### Scenario: Parallel sessions requested
- **WHEN** a parallelism greater than one is requested
- **THEN** the adapter passes `--parallel <n>` and tracks every resulting session

### Requirement: Session Lifecycle Normalization
The adapter SHALL poll session status and emit canonical PAL events for each state transition.

#### Scenario: Session completes
- **WHEN** polling reports the session as completed
- **THEN** the adapter pulls results with `jules remote pull --session <id>` and emits a completion event

#### Scenario: Polling exceeds timeout
- **WHEN** the configured timeout elapses before completion
- **THEN** the adapter emits a typed timeout error

### Requirement: Environment Preconditions
The adapter SHALL fail with a typed error when the Jules CLI is missing or unauthenticated.

#### Scenario: CLI not installed
- **WHEN** the `jules` binary is not found
- **THEN** the adapter raises an error indicating `npm install -g @google/jules`

### Requirement: Finished Session With Empty Status
A session whose status column is empty MAY have finished its work. The adapter SHALL pull such a session once per poll and treat a non-empty diff as completion, and SHALL keep the awaiting-input policy when the pull is empty or fails.

#### Scenario: Finished session with empty status yields a diff
- **WHEN** a session shows an empty status and `jules remote pull --session <id>` returns a diff
- **THEN** the adapter emits a completed transition for that session without raising an awaiting-input error, and does not pull it again when assembling the result

#### Scenario: Empty status with no changes keeps the awaiting-input policy
- **WHEN** a session shows an empty status and the pull reports no changes
- **THEN** the adapter counts an awaiting-input poll and applies the configured policy after the poll limit

#### Scenario: Failed pull is treated as not ready
- **WHEN** a session shows an empty status and the pull command fails
- **THEN** the adapter treats the session as not ready, counts an awaiting-input poll, and does not crash the watch

### Requirement: Batch Execution
The adapter SHALL run a batch of independent tasks as one remote session per task, in waves of at most `maxConcurrent` sessions, and SHALL report one outcome per task.

#### Scenario: Batch with one session per task
- **WHEN** `runBatch` is called with several tasks and no repository override
- **THEN** the adapter creates exactly one session per task with `jules remote new` and returns results in input order

#### Scenario: Concurrency bound respected
- **WHEN** a batch has more tasks than `maxConcurrent`
- **THEN** the adapter creates no more sessions than `maxConcurrent` before the current wave has been watched and pulled

#### Scenario: Invalid concurrency rejected
- **WHEN** `maxConcurrent` is outside 1-5 or not an integer
- **THEN** the adapter raises an invalid-request error before creating any session

#### Scenario: One task's failure does not abort the others
- **WHEN** one task fails to create, fails remotely, times out, or needs input
- **THEN** that task's outcome records the failure and the remaining tasks still complete with their own outcomes

#### Scenario: Outcomes are classified per task
- **WHEN** a wave finishes
- **THEN** each task reports `diff` (with the patch), `empty`, `failed`, `timeout` or `needs_input`

#### Scenario: One list poll serves the wave
- **WHEN** several sessions of a wave are watched
- **THEN** each poll issues a single `jules remote list --session` call covering all of them

#### Scenario: Prompt composed with its constraints
- **WHEN** `buildJulesPrompt` is given a goal, files, a verify command and optional constraints
- **THEN** the prompt names the exact files, the verify command, the instruction not to modify other files and the instruction not to open a pull request
