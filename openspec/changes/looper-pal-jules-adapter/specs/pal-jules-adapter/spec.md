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
