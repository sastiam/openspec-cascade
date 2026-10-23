# Spec Delta: Antigravity CLI Engine

## Purpose

Enables executing OpenSpec cascade tasks autonomously using the Antigravity CLI (`agy`) as an alternative agent engine.

## ADDED Requirements

### Requirement: Engine Selection
The CLI harness SHALL accept `--engine antigravity` and alias `--engine agy` to select the Antigravity CLI engine.

#### Scenario: User selects antigravity engine
- **WHEN** user specifies `--engine antigravity` or `--engine agy`
- **THEN** the harness selects the Antigravity engine and runs task sessions using `agy`

#### Scenario: User passes unknown engine
- **WHEN** user specifies an unrecognized engine flag
- **THEN** the harness throws an error listing supported engines including claude, opencode, and antigravity

### Requirement: Session Execution and Streaming
The Antigravity engine SHALL spawn `agy` in non-interactive print mode with streaming JSON output and auto-approved permissions.

#### Scenario: Running a task prompt
- **WHEN** a task session starts
- **THEN** the engine spawns `agy -p "<prompt>" --output-format stream-json --dangerously-skip-permissions` in the repository working directory

#### Scenario: Resuming an existing session
- **WHEN** a task retry or continuation specifies an existing session ID
- **THEN** the engine appends `--conversation <id>` to resume the session

### Requirement: Event Stream Processing and Progress Logging
The Antigravity engine SHALL process NDJSON events from `agy` to track progress, log tool execution, and capture usage metrics.

#### Scenario: Tool call event received
- **WHEN** a step update event with a tool call is parsed
- **THEN** the engine triggers tool hooks to update progress display and record logs

#### Scenario: Text delta received
- **WHEN** a step update event with assistant text delta is parsed
- **THEN** the engine streams the text to the log and live progress display

#### Scenario: Session completion
- **WHEN** a result event with status SUCCESS is received
- **THEN** the engine returns a completed outcome with final text, conversation ID, and token usage

### Requirement: Model and Effort Configuration
The Antigravity engine SHALL default to `gemini-3.8-flash-high` and support custom model and reasoning effort configuration.

#### Scenario: Default model selection
- **WHEN** no model environment variable is set
- **THEN** the engine uses `gemini-3.8-flash-high`

#### Scenario: Custom model and effort override
- **WHEN** `CASCADE_MODEL` or `CASCADE_EFFORT` are provided
- **THEN** the engine passes `--model <model>` and `--effort <effort>` to `agy`
