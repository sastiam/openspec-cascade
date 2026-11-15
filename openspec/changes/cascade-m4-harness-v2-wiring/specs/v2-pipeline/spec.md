# Spec: V2 Looper Pipeline

## ADDED Requirements

### Requirement: Mode Selection
The system MUST execute the v2 pipeline when `mode` is `v2` and keep the v1 loop unchanged when `mode` is `v1`.

#### Scenario: v2 dry run reports pipeline readiness
- **WHEN** `cascade.ts --mode v2 --dry-run` runs on a valid change
- **THEN** it prints the analyze verdict and the DAG execution order and exits `0` without sessions or commits

### Requirement: FSM-Driven Task Execution Through Gates 0-3
The system MUST drive each pending task through `LooperFSM` from `STATE_PLAN_DECOMPOSE` through worker execution, Gates 0–3 and `STATE_COMMIT_CHECKPOINT`, and finish the change in `STATE_COMPLETED`.

#### Scenario: Successful task reaches a checkpoint commit
- **WHEN** the engine completes a task whose verification passes
- **THEN** the FSM history includes `STATE_GATE_0_AUTO`, `STATE_GATE_1_REVIEW`, `STATE_GATE_3_AUDIT` and `STATE_COMMIT_CHECKPOINT`, the task is checked in `tasks.md`, and a commit excludes `.agents/teamwork/`

#### Scenario: Analyze blocks invalid changes
- **WHEN** `analyzeChangeArtifacts` reports blocking findings
- **THEN** the run stops with exit code `2` before any session

### Requirement: Escalation and Rollback
The system MUST route gate failures through `routeFailure`, retry with enriched prompts within `maxAttemptsPerTask`, and on exhaustion roll back to the task baseline and abort (or skip the task in resilient mode).

#### Scenario: Exhausted task is rolled back
- **WHEN** Gate 0 keeps failing for a task
- **THEN** the FSM visits `STATE_ESCALATE_DIAGNOSTIC` and `STATE_ROLLBACK_RECOVERY`, the working tree returns to the baseline, and the run exits `2`

#### Scenario: Run state is persisted
- **WHEN** a change finishes or aborts
- **THEN** `MemoryStorage` holds a state document with the FSM history and task outcomes
