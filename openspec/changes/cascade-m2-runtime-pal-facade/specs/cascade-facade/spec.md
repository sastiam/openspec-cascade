# Spec: Cascade Facade

## ADDED Requirements

### Requirement: CascadeFacade Orchestrates Runs
The system MUST expose `CascadeFacade.run(config)` that performs preflight, dry-run planning or task execution, verification, commits and rollback, and returns a structured `CascadeRunResult` with `exitCode`, per-change status, task outcomes, rollbacks, telemetry summary and total cost.

#### Scenario: Dry run returns plan without side effects
- **WHEN** `run` executes with `dryRun: true` on a repository with pending tasks
- **THEN** it returns `exitCode` `0`, lists each change with its pending task count, writes no log file and creates no commit

#### Scenario: Fail-closed errors map to exit code 2
- **WHEN** preflight raises `Fatal`, `ProtectedBranchError`, `BudgetExceededError` or `ConfigValidationError`
- **THEN** `run` returns `exitCode` `2` with the error message in `error`

### Requirement: Thin CLI Adapter
The system MUST keep `cascade.ts` as a thin adapter that parses arguments, loads configuration, delegates to `CascadeFacade` and preserves its historical exports and exit codes.

#### Scenario: Historical exports remain available
- **WHEN** consumers import `parseTasks`, `verifyCommands`, `taskPrompt`, `runChecks`, `blockedReason`, `commitTypeOf`, `commitsPerSection`, `isLastOfSection` and `runCli` from `cascade.ts`
- **THEN** all exports resolve with unchanged behavior
