# Spec: Harness Injector

## ADDED Requirements

### Requirement: Deterministic Sectioned Execution Context
The system MUST build an `InjectedHarness` from a change, a task and optional Greptile context and remediation directives, containing ordered sections with token estimates and a combined prompt.

#### Scenario: Artifacts, constitution and task are injected
- **WHEN** `buildExecutionContext` runs for a change with proposal, design, specs, tasks and an `openspec/project.md` constitution
- **THEN** the prompt contains the task id and text, each artifact's content, the constitution, and the harness rules, in a stable order

#### Scenario: Optional sections appear only when provided
- **WHEN** Greptile context or remediation directives are supplied
- **THEN** `greptile` and `remediation` sections are included, and omitted otherwise

#### Scenario: Determinism and truncation
- **WHEN** the same input is built twice, and an artifact exceeds `MAX_ARTIFACT_CHARS`
- **THEN** both prompts are identical and the oversized artifact is truncated with a marker
